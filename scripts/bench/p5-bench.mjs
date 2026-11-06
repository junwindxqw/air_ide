// 性能基准采集（P5-2，方案 5.3）：对照 0.4 量化目标逐项测量。
// 运行：node scripts/bench/p5-bench.mjs（需 app 以 CDP 端口 9222 运行）
// 输出：bench-out/p5-bench.jsonl（含测量前提：Defender/电源/OS，方案 5.3 要求）
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const CDP_HTTP = 'http://127.0.0.1:9222'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.ready = new Promise((resolve) => ws.addEventListener('open', resolve))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
  }
  async call(method, params = {}) {
    await this.ready
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

async function main() {
  const list = await fetch(`${CDP_HTTP}/json/list`).then((r) => r.json())
  const page = list.find((t) => t.type === 'page' && (t.url || '').includes('localhost:5173'))
  if (!page) throw new Error('CDP 无 page target')
  const cdp = new Cdp(new WebSocket(page.webSocketDebuggerUrl))
  const ev = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? 'eval error')
    }
    return r.result.value
  }
  /** 带超时的 evaluate（防止流式 Promise 不 resolve 卡死基准）。 */
  const evTimeout = async (expr, ms = 60000) => {
    let timer
    try {
      return await Promise.race([
        ev(expr),
        new Promise((_, rej) => {
          timer = setTimeout(() => rej(new Error(`evaluate 超时 ${ms}ms`)), ms)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  // ── 10k 文件夹具（git 仓库 + 2000 变更）──
  const repo = 'D:/bench/p5-bench'
  rmSync(repo, { recursive: true, force: true })
  mkdirSync(join(repo, 'src'), { recursive: true })
  for (let i = 0; i < 10000; i++) {
    const dir = join(repo, 'src', `d${Math.floor(i / 100)}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `f${i}.php`), `<?php // file ${i}\nclass C${i} {}\n`)
  }
  writeFileSync(join(repo, 'composer.json'), '{}')
  execSync(
    `git init -q && git config user.email t@t.com && git config user.name t && git add -A && git commit -qm init`,
    { cwd: repo, shell: 'bash' },
  )
  for (let i = 0; i < 2000; i++) {
    const p = join(repo, 'src', `d${Math.floor(i / 100)}`, `f${i}.php`)
    writeFileSync(p, `<?php // file ${i} changed\nclass C${i} { public function x() {} }\n`)
  }

  const results = []

  // 1. 打开工作区（文件树懒加载 + 监听启动）
  let t0 = performance.now()
  await ev(`window.__air.openWorkspace(${JSON.stringify(repo)})`)
  await sleep(300)
  results.push({ metric: 'open_workspace_10k_ms', ms: performance.now() - t0 })

  // 2. 文件树根目录列表
  t0 = performance.now()
  const tree = await ev(`window.__air.listDir(${JSON.stringify(repo)})`)
  results.push({
    metric: 'list_root_dir_ms',
    ms: performance.now() - t0,
    detail: `${tree?.length ?? 0} entries`,
  })

  // 3. git status（10k 文件 + 2000 变更）
  t0 = performance.now()
  const status = await ev(`window.__air.gitStatus(${JSON.stringify(repo)})`)
  results.push({
    metric: 'git_status_10k_ms',
    ms: performance.now() - t0,
    detail: `unstaged=${status?.unstaged?.length ?? 0}`,
  })

  // 4. 单文件 diff（2000 行）
  const bigFile = join(repo, 'src', 'd0', 'f0.php')
  writeFileSync(
    bigFile,
    '<?php\n' + Array.from({ length: 2000 }, (_, i) => `// line ${i}`).join('\n') + '\n',
  )
  t0 = performance.now()
  const diff = await ev(`window.__air.gitDiff(${JSON.stringify(repo)}, 'src/d0/f0.php')`)
  results.push({
    metric: 'diff_2000_lines_ms',
    ms: performance.now() - t0,
    detail: `hunks=${diff?.hunks?.length ?? 0}`,
  })

  // 5. 全局搜索（10k 文件，流式）
  t0 = performance.now()
  const total = await evTimeout(`(async () => {
    const { searchQuery } = await import('/src/ipc/search.ts')
    let n = 0
    const p = searchQuery('bench-q', ${JSON.stringify(repo)}, { pattern: 'class C' }, (m) => { n += m.length })
    // 流式搜索：invoke 返回即认为链路通（结果经事件持续到达）
    await Promise.race([p, new Promise((r) => setTimeout(r, 20000))])
    return n
  })()`)
  results.push({ metric: 'search_10k_ms', ms: performance.now() - t0, detail: `matches=${total}` })

  // 6. JS 堆（WebView2 侧近似）
  const heapMb = await ev(`(performance.memory?.usedJSHeapSize ?? 0) / 1048576`)

  // ── 汇总（含测量前提）──
  const outDir = 'D:/myProject/air_ide/bench-out'
  mkdirSync(outDir, { recursive: true })
  const record = {
    ts: new Date().toISOString(),
    defender: 'on',
    power: 'desktop',
    os: 'win11-26300',
    build: 'dev/debug',
    results: [
      ...results.map((r) => ({ metric: r.metric, value: Math.round(r.ms * 10) / 10, unit: 'ms', detail: r.detail })),
      { metric: 'js_heap_used_mb', value: Math.round(heapMb * 10) / 10, unit: 'MB' },
    ],
  }
  writeFileSync(join(outDir, 'p5-bench.jsonl'), JSON.stringify(record) + '\n')

  console.log('=== P5 基准（dev/debug 构建）===')
  for (const r of record.results) {
    console.log(`  ${r.metric}: ${r.value}${r.unit}${r.detail ? ` (${r.detail})` : ''}`)
  }
  console.log('前提: Defender=on, 电源=desktop, OS=win11-26300, build=dev/debug')
  cdp.ws.close()
}

main().catch((e) => {
  console.error('基准采集失败:', e)
  process.exitCode = 1
})
