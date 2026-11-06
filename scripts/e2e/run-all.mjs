// E2E 回归编排：按层级顺序执行脚本、汇总结果、支持指定 base 版本对比。
// 前置：开发态 app 已启动并开放 CDP（127.0.0.1:9222），vite dev server 在 5173。
// 所有套件共用同一个 app 实例，必须串行执行。
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const OUT_ROOT = join(REPO_ROOT, 'bench-out', 'e2e')

// 层级定义：冒烟=功能冒烟；回归=冒烟 + 平台适配（性能基准与人工清单见 docs/TESTING.md）
const LEVELS = {
  smoke: ['p0-smoke', 'p1-smoke', 'p2-smoke', 'p3-smoke', 'p4-smoke'],
  regression: ['p0-smoke', 'p1-smoke', 'p2-smoke', 'p3-smoke', 'p4-smoke', 'p0-windows'],
}

function parseArgs(argv) {
  const opts = { level: 'smoke', only: null, base: null, out: OUT_ROOT, allowRegressions: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    if (arg === '--level') opts.level = next()
    else if (arg.startsWith('--level=')) opts.level = arg.slice('--level='.length)
    else if (arg === '--only') opts.only = next()
    else if (arg.startsWith('--only=')) opts.only = arg.slice('--only='.length)
    else if (arg === '--base') opts.base = next()
    else if (arg.startsWith('--base=')) opts.base = arg.slice('--base='.length)
    else if (arg === '--out') opts.out = resolve(next())
    else if (arg.startsWith('--out=')) opts.out = resolve(arg.slice('--out='.length))
    else if (arg === '--allow-regressions') opts.allowRegressions = true
    else if (arg === '--help' || arg === '-h') opts.help = true
    else throw new Error(`未知参数: ${arg}`)
  }
  return opts
}

function usage() {
  console.log(`用法: node scripts/e2e/run-all.mjs --level <smoke|regression> [选项]

选项:
  --level <smoke|regression>  执行层级（默认 smoke）
  --only <id,id>              只跑指定套件（如 p3-smoke,p4-smoke）
  --base <ref|label>          记录基线版本；若 bench-out/e2e 下存在同基线旧报告则自动对比
  --out <dir>                 结果目录（默认 bench-out/e2e）
  --allow-regressions         对比发现回退时仍返回 0

层级:
  smoke      = p0/p1/p2/p3/p4 功能冒烟
  regression = smoke + p0-windows 平台适配

示例:
  node scripts/e2e/run-all.mjs --level smoke
  node scripts/e2e/run-all.mjs --level regression --base main
  node scripts/e2e/run-all.mjs --level smoke --only p3-smoke,p4-smoke`)
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
}

function runGit(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
}

async function cdpAvailable() {
  try {
    const r = await fetch('http://127.0.0.1:9222/json/list')
    if (!r.ok) return false
    const list = await r.json()
    return Array.isArray(list) && list.length > 0
  } catch {
    return false
  }
}

function runSuite(id, runDir) {
  const scriptPath = join(HERE, `${id}.mjs`)
  const resultFile = join(runDir, `${id}.json`)
  const logFile = join(runDir, `${id}.log`)
  const startedAt = Date.now()

  return new Promise((resolvePromise) => {
    console.log(`\n──── ${id} ────`)
    let stdout = ''
    let stderr = ''
    const child = spawn(process.execPath, [scriptPath], {
      cwd: REPO_ROOT,
      env: { ...process.env, AIR_E2E_RESULT_FILE: resultFile },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (d) => {
      stdout += d
      process.stdout.write(d)
    })
    child.stderr.on('data', (d) => {
      stderr += d
      process.stderr.write(d)
    })
    child.on('close', (code) => {
      writeFileSync(logFile, `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`, 'utf8')
      let result = null
      if (existsSync(resultFile)) {
        try {
          result = JSON.parse(readFileSync(resultFile, 'utf8'))
        } catch (e) {
          stderr += `\n[结果文件解析失败] ${String(e)}`
        }
      }
      resolvePromise({
        suite: id,
        exitCode: code,
        durationMs: Date.now() - startedAt,
        result,
        resultFile,
        logFile,
        stderr: stderr.trim() || null,
      })
    })
  })
}

function flatten(suites) {
  const map = new Map()
  for (const s of suites) {
    const results = s.result?.results ?? [{ status: 'FAIL', name: '套件未产出结果（脚本崩溃？）', detail: s.stderr ?? '' }]
    for (const r of results) map.set(`${s.suite}::${r.name}`, r.status)
  }
  return map
}

function compareRuns(current, baseline) {
  const base = flatten(baseline.suites ?? [])
  const cur = flatten(current.suites)
  const regressions = []
  const fixes = []
  const newTests = []
  const removedTests = []
  for (const [key, status] of cur) {
    if (!base.has(key)) newTests.push({ key, status })
    else if (base.get(key) === 'PASS' && status === 'FAIL') regressions.push({ key, base: 'PASS', current: status })
    else if (base.get(key) === 'FAIL' && status === 'PASS') fixes.push({ key, base: 'FAIL', current: status })
  }
  for (const [key, status] of base) {
    if (!cur.has(key)) removedTests.push({ key, status })
  }
  return { regressions, fixes, newTests, removedTests }
}

function findBaseline(baseRef, baseCommit, runDir) {
  const searchRoot = dirname(runDir)
  if (!existsSync(searchRoot)) return null
  const candidates = []
  for (const name of readdirSync(searchRoot)) {
    const dir = join(searchRoot, name)
    if (dir === runDir) continue
    const file = join(dir, 'summary.json')
    if (!existsSync(file)) continue
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'))
      if (data.baseRef === baseRef || (baseCommit && data.baseCommit === baseCommit)) {
        candidates.push({ path: file, mtime: statSync(file).mtimeMs, data })
      }
    } catch {
      // 损坏的历史报告忽略
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0] ?? null
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    usage()
    return
  }
  if (!LEVELS[opts.level]) throw new Error(`未知层级: ${opts.level}（可选 smoke/regression）`)

  const suiteIds = opts.only
    ? opts.only.split(',').map((s) => s.trim()).filter(Boolean)
    : LEVELS[opts.level]
  for (const id of suiteIds) {
    if (!existsSync(join(HERE, `${id}.mjs`))) throw new Error(`未知套件: ${id}`)
  }

  const startedAt = new Date().toISOString()
  const stamp = timestamp()
  const runDir = join(opts.out, `${stamp}-${opts.level}`)

  let baseCommit = null
  if (opts.base) {
    try {
      baseCommit = runGit(['rev-parse', '--verify', opts.base])
    } catch {
      baseCommit = null
    }
  }

  return (async () => {
    if (!(await cdpAvailable())) {
      console.error(`\n未检测到 CDP（http://127.0.0.1:9222/json/list）。
请先以开发态启动 app（另一终端）：
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
  pnpm dev
再重跑本命令。`)
      process.exitCode = 2
      return
    }

    mkdirSync(runDir, { recursive: true })

    console.log(`层级: ${opts.level}`)
    console.log(`套件: ${suiteIds.join(', ')}`)
    console.log(`结果目录: ${runDir}`)
    if (opts.base) console.log(`基线: ${opts.base}${baseCommit ? ` (${baseCommit.slice(0, 12)})` : '（不是 git ref，仅作标签）'}`)

    const suites = []
    for (const id of suiteIds) {
      suites.push(await runSuite(id, runDir))
    }

    const totals = { total: 0, passed: 0, failed: 0, skipped: 0, suitesFailed: 0 }
    for (const s of suites) {
      const t = s.result?.totals
      if (t) {
        totals.total += t.total
        totals.passed += t.passed
        totals.failed += t.failed
        totals.skipped += t.skipped
      } else {
        totals.failed += 1
      }
      if (s.exitCode !== 0) totals.suitesFailed += 1
    }

    const summary = {
      level: opts.level,
      startedAt,
      finishedAt: new Date().toISOString(),
      host: { node: process.version, platform: process.platform, release: process.release.name },
      baseRef: opts.base,
      baseCommit,
      suites,
      totals,
      compare: null,
    }

    if (opts.base) {
      const baseline = findBaseline(opts.base, baseCommit, runDir)
      if (baseline) {
        summary.compare = { baselinePath: baseline.path, baselineFinishedAt: baseline.data.finishedAt, ...compareRuns(summary, baseline.data) }
      }
    }

    const summaryPath = join(runDir, 'summary.json')
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
    // 带时间戳的顶层副本，便于直接引用
    writeFileSync(join(opts.out, `e2e-${opts.level}-${stamp}.json`), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

    console.log(`\n════ ${opts.level} 汇总 ════`)
    for (const s of suites) {
      const label = s.result ? `${s.result.totals.passed}/${s.result.totals.total} 通过, ${s.result.totals.skipped} 跳过` : '未产出结果'
      console.log(`${s.exitCode === 0 ? 'PASS' : 'FAIL'}  ${s.suite}: ${label} (${(s.durationMs / 1000).toFixed(1)}s)`)
    }
    console.log(`合计: ${totals.passed}/${totals.total} 通过, ${totals.failed} 失败, ${totals.skipped} 跳过`)

    if (summary.compare) {
      console.log(`\n对比基线: ${summary.compare.baselinePath}`)
      console.log(`回退: ${summary.compare.regressions.length}  修复: ${summary.compare.fixes.length}  新增: ${summary.compare.newTests.length}  缺失: ${summary.compare.removedTests.length}`)
      for (const r of summary.compare.regressions) console.log(`  回退 ${r.key}`)
    } else if (opts.base) {
      console.log('\n未找到同基线历史报告，本次仅记录基线，不对比。')
    }

    console.log(`\n结果: ${summaryPath}`)

    if (totals.suitesFailed > 0) process.exitCode = 1
    if (summary.compare?.regressions.length && !opts.allowRegressions) process.exitCode = 1
  })()
}

main().catch((e) => {
  console.error(`运行失败: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 2
})
