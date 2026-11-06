// P5-2 release 性能采集：冷启动 / 空闲内存 / 10k 基准 / 大文件 / diff 渲染 / 搜索首批。
// 运行：node scripts/bench/p5-release.mjs [exe 路径]
// 前提：Defender / 电源 / OS 自动记录（方案 5.3 要求三个条件必须标注）。
//
// 手法：
//  - 临时改写 %APPDATA%\AirIDE\session.json 让 release 包恢复「10k 夹具工作区」与「大文件」，
//    结束后（含异常）原样还原，不动用户真实会话。
//  - 前端埋点（src/app/perf.ts）经 WEBVIEW2 的 CDP 读取 performance.measure。
//  - 后端 IPC 耗时经 window.__TAURI_INTERNALS__.invoke 直接调用（release 同样可用）。
//  - 每个后端指标重复 3 次取中位数，压低 Defender/磁盘缓存造成的抖动。
import { spawn, execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, renameSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const EXE = process.argv[2] ?? 'D:/myProject/air_ide/target/release/air-ide.exe'
const REPO = 'D:/bench/p5-bench'
const BIG = 'D:/bench/p5-big.php'
const FIXTURE_MARK = '.p5-fixture-v2'
// 不与手工调试实例的 9222 抢端口，避免误连到别的窗口
const CDP_PORT = 9333
const CDP_HTTP = `http://127.0.0.1:${CDP_PORT}`
const OUT = 'D:/myProject/air_ide/bench-out'
const APPDATA_DIR = join(process.env.APPDATA ?? '', 'AirIDE')
const SESSION = join(APPDATA_DIR, 'session.json')
const BENCH = join(process.env.LOCALAPPDATA ?? '', 'AirIDE', 'bench.jsonl')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const median = (arr) => {
  const a = arr.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((x, y) => x - y)
  return a.length ? a[Math.floor(a.length / 2)] : null
}
const round1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : null)

// ── 夹具（v2：干净基线 + 2001 个已修改文件，其中 f0.php 是 2000 行 diff）────
const F0_BASE = '<?php\n' + Array.from({ length: 2000 }, (_, i) => `// line ${i}`).join('\n') + '\n'
const F0_MODIFIED = '<?php\n' + Array.from({ length: 2000 }, (_, i) => `// line ${i} changed`).join('\n') + '\n'

function ensureRepo() {
  if (existsSync(join(REPO, FIXTURE_MARK))) return
  rmSync(REPO, { recursive: true, force: true })
  mkdirSync(join(REPO, 'src'), { recursive: true })
  for (let i = 0; i < 10000; i++) {
    const dir = join(REPO, 'src', `d${Math.floor(i / 100)}`)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `f${i}.php`), i === 0 ? F0_BASE : `<?php // file ${i}\nclass C${i} {}\n`)
  }
  writeFileSync(join(REPO, 'composer.json'), '{}')
  execSync(
    'git init -q && git config core.autocrlf false && git config user.email t@t.com && git config user.name t && git add -A && git commit -qm init && git tag base',
    { cwd: REPO, stdio: 'ignore', maxBuffer: 64 * 1024 * 1024 },
  )
  // 2000 个文件改动 + f0.php 的 2000 行 diff
  for (let i = 0; i < 2000; i++) {
    const p = join(REPO, 'src', `d${Math.floor(i / 100)}`, `f${i}.php`)
    writeFileSync(p, i === 0 ? F0_MODIFIED : `<?php // file ${i} changed\nclass C${i} { public function x() {} }\n`)
  }
  writeFileSync(join(REPO, FIXTURE_MARK), 'v2')
}

function ensureBigFile() {
  if (existsSync(BIG) && readFileSync(BIG).length > 9 * 1024 * 1024) return
  const lines = []
  let size = 0
  let i = 0
  // 约 9.9MB（低于 10MiB 只读阈值，保持可编辑，对应 0.4「10MB 可编辑上限」）
  while (size < 9_900_000) {
    const line = `// padding line ${i} 0123456789012345678901234567890123456789\n`
    lines.push(line)
    size += Buffer.byteLength(line)
    i++
  }
  lines.push('<?php\necho "big file tail";\n')
  writeFileSync(BIG, lines.join(''))
}

// ── 测量前提 ──────────────────────────────────────────
function preconditions() {
  const ps = (cmd) => {
    try {
      return execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  }
  const defender = ps('(Get-MpPreference -ErrorAction SilentlyContinue).DisableRealtimeMonitoring')
  const os = ps('(Get-CimInstance Win32_OperatingSystem).Caption + " build " + (Get-CimInstance Win32_OperatingSystem).BuildNumber')
  const power = ps('(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Measure-Object BatteryStatus -Average).Average')
  return {
    defender: defender === 'True' ? 'off' : 'on',
    power: power === '' ? 'desktop' : power === '2' ? 'ac' : 'battery',
    os,
  }
}

/**
 * 内存两种口径：
 *  A（P0/0.4 回归口径）主进程 + 直接子进程（WebView2 browser）
 *  B（参考）递归全部子孙进程（含 renderer/GPU/utility）
 */
function workingSetBreakdown(pid) {
  const script = `
$root = ${pid}
$app = Get-Process -Id $root -ErrorAction SilentlyContinue
if (-not $app) { Write-Output "0"; Write-Output "0"; Write-Output ""; exit }
$direct = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.ParentProcessId -eq $root })
$directWs = ($direct | Measure-Object WorkingSetSize -Sum).Sum
if ($null -eq $directWs) { $directWs = 0 }
$p0 = [math]::Round(($app.WorkingSet64 + $directWs) / 1MB, 1)
$ids = New-Object System.Collections.Generic.List[int]
$ids.Add([int]$root)
for ($i = 0; $i -lt $ids.Count; $i++) {
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($ids[$i])" -ErrorAction SilentlyContinue
  foreach ($c in $children) { $ids.Add([int]$c.ProcessId) }
}
$sum = 0
$parts = @()
foreach ($procId in $ids) {
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($p) {
    $sum += $p.WorkingSet64
    $parts += ("{0}:{1}" -f $p.ProcessName, [math]::Round($p.WorkingSet64 / 1MB))
  }
}
Write-Output $p0
Write-Output ([math]::Round($sum / 1MB, 1))
Write-Output ($parts -join ', ')
`
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((s) => s.trim())
    const p0 = Number(out[0])
    const all = Number(out[1])
    return { p0, all, detail: out[2] ?? '' }
  } catch {
    return null
  }
}

// ── 会话临时改写 ──────────────────────────────────────
let sessionBackup = null
function backupSession() {
  mkdirSync(APPDATA_DIR, { recursive: true })
  sessionBackup = join(APPDATA_DIR, 'session.p5-bench.bak')
  if (existsSync(SESSION)) copyFileSync(SESSION, sessionBackup)
  else sessionBackup = null
}
function writeSession(workspaceRoot, openFiles = [], activeFile = null) {
  mkdirSync(APPDATA_DIR, { recursive: true })
  writeFileSync(SESSION, JSON.stringify({ workspaceRoot, openFiles, activeFile, schemaVersion: 1 }, null, 2))
}
function restoreSession() {
  if (sessionBackup && existsSync(sessionBackup)) renameSync(sessionBackup, SESSION)
  else rmSync(SESSION, { force: true })
}

// ── 应用进程与 CDP ────────────────────────────────────
function launch() {
  return spawn(EXE, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}` },
    stdio: 'ignore',
  })
}

function killTree(proc) {
  if (!proc?.pid) return
  try {
    execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    try {
      proc.kill()
    } catch {}
  }
}

async function cdpConnect(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const list = await fetch(`${CDP_HTTP}/json/list`).then((r) => r.json())
      const page = list.find((t) => t.type === 'page')
      if (page) return connectWs(page.webSocketDebuggerUrl)
    } catch {}
    await sleep(200)
  }
  throw new Error('CDP 连接超时（release 包未带 remote-debugging-port？）')
}

async function connectWs(url) {
  const ws = new WebSocket(url)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  const cdp = {
    ws,
    id: 0,
    pending: new Map(),
    call(method, params = {}) {
      const id = ++cdp.id
      return new Promise((resolve, reject) => {
        cdp.pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })
    },
    async eval(expr, timeoutMs = 30000) {
      const r = await Promise.race([
        cdp.call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`evaluate 超时 ${timeoutMs}ms`)), timeoutMs)),
      ])
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval error')
      return r.result?.value
    },
  }
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && cdp.pending.has(m.id)) {
      const { resolve, reject } = cdp.pending.get(m.id)
      cdp.pending.delete(m.id)
      if (m.error) reject(new Error(m.error.message))
      else resolve(m.result)
    }
  })
  return cdp
}

/** 轮询前端 performance.measure，取同名最后一条。 */
async function waitMeasure(cdp, name, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const list = await cdp.eval(`performance.getEntriesByType('measure').map(e => ({n: e.name, ms: e.duration}))`)
    const hit = list.filter((e) => e.n === name)
    if (hit.length > 0) return round1(hit[hit.length - 1].ms)
    await sleep(100)
  }
  return null
}

function benchLines() {
  if (!existsSync(BENCH)) return 0
  return readFileSync(BENCH, 'utf8').split('\n').filter(Boolean).length
}

/** 冷启动：进程创建 → 前端首帧打点落盘（app_report_benchmark 的 cold_start_interactive_ms）。 */
async function coldStartOnce() {
  const before = benchLines()
  const t0 = performance.now()
  const proc = launch()
  try {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error(`应用进程提前退出（code=${proc.exitCode}）：单实例锁被其他 Air IDE 占用？`)
      if (benchLines() > before) return Math.round(performance.now() - t0)
      await sleep(25)
    }
    return null
  } finally {
    killTree(proc)
    await sleep(800)
  }
}

async function openApp(sessionRepo, openFiles = [], activeFile = null) {
  writeSession(sessionRepo, openFiles, activeFile)
  const proc = launch()
  await sleep(400)
  if (proc.exitCode !== null) {
    throw new Error(`应用进程提前退出（code=${proc.exitCode}）：单实例锁被其他 Air IDE 占用？`)
  }
  const cdp = await cdpConnect()
  return { proc, cdp }
}

// ── 主流程 ────────────────────────────────────────────
const results = []
const record = (metric, value, unit, detail) =>
  results.push({ metric, value: value ?? null, unit, detail: detail ?? undefined })

async function main() {
  if (!existsSync(EXE)) throw new Error(`release 包不存在: ${EXE}（先跑 pnpm build）`)
  ensureRepo()
  ensureBigFile()
  backupSession()
  const pre = preconditions()
  console.log(`前提: Defender=${pre.defender}, 电源=${pre.power}, OS=${pre.os}`)

  // 冷启动 ×3 取中位数（每次都是进程创建 → 首帧打点）
  const colds = []
  for (let i = 0; i < 3; i++) {
    writeSession(REPO, [], null)
    const ms = await coldStartOnce()
    if (ms !== null) colds.push(ms)
  }
  record('cold_start_ms', median(colds), 'ms', `3 次中位数：${colds.join('/')}ms（25ms 轮询粒度）`)

  // ── 10k 工作区：树 / status / 内存 / 搜索 / diff ──
  const app1 = await openApp(REPO, [], null)
  try {
    const cdp = app1.cdp
    const treeMs = await waitMeasure(cdp, 'air.tree_root', 15000)
    const statusMark = await waitMeasure(cdp, 'air.git_status', 15000)
    record('tree_root_10k_ms', treeMs, 'ms', `前端埋点（IPC+首次渲染），${REPO}`)
    record('git_status_10k_ms', statusMark, 'ms', '前端埋点（含 IPC），首次')

    // 后端直测 ×3：git status
    await cdp.eval(`window.__TAURI_INTERNALS__.invoke('git_status', { repo: ${JSON.stringify(REPO)} })`) // 预热
    const statusSamples = []
    for (let i = 0; i < 3; i++) {
      const r = await cdp.eval(`(async () => {
        const t0 = performance.now();
        const s = await window.__TAURI_INTERNALS__.invoke('git_status', { repo: ${JSON.stringify(REPO)} });
        return { ms: performance.now() - t0, n: (s.staged.length + s.unstaged.length + s.untracked.length) };
      })()`)
      statusSamples.push(r.ms)
      if (i === 2) record('git_status_ipc_10k_ms', round1(median(statusSamples)), 'ms', `${r.n} entries；3 次：${statusSamples.map(round1).join('/')}ms`)
    }

    // 根目录列表 ×3
    const listSamples = []
    for (let i = 0; i < 3; i++) {
      const r = await cdp.eval(`(async () => {
        const t0 = performance.now();
        await window.__TAURI_INTERNALS__.invoke('fs_list_dir', { dir: ${JSON.stringify(REPO)} });
        return performance.now() - t0;
      })()`)
      listSamples.push(r)
    }
    record('list_root_dir_ms', round1(median(listSamples)), 'ms', `3 次：${listSamples.map(round1).join('/')}ms`)

    // 空闲内存（重操作之前；10k 工作区已加载 + Changes 列表已渲染）
    await sleep(4000)
    const mem = workingSetBreakdown(app1.proc.pid)
    record('idle_memory_10k_workspace_mb', mem?.p0 ?? null, 'MB', `P0 口径；全部子进程 ${mem?.all ?? '?'}MB（${mem?.detail ?? '采集失败'}）`)

    // 搜索首批 ×3（每次不同 qid；监听 search://batch 首批到达）
    const searchSamples = []
    for (let i = 0; i < 3; i++) {
      const r = await cdp.eval(`(async () => {
        const sb = window.__TAURI_INTERNALS__;
        let firstMs = null;
        let qstart = 0;
        const cb = sb.transformCallback(() => { if (firstMs === null) firstMs = performance.now() - qstart; });
        const eventId = await sb.invoke('plugin:event|listen', { event: 'search://batch', target: { kind: 'AnyLabel', label: 'main' }, handler: cb });
        const qid = 'bench-' + Date.now();
        qstart = performance.now();
        const p = sb.invoke('search_query', { queryId: qid, root: ${JSON.stringify(REPO)}, pattern: 'class C', regex: false, caseSensitive: false, wholeWord: false });
        const deadline = performance.now() + 30000;
        while (firstMs === null && performance.now() < deadline) await new Promise(r => setTimeout(r, 5));
        const total = await p;
        try { await sb.invoke('plugin:event|unlisten', { event: 'search://batch', eventId }); } catch {}
        return { firstMs, total };
      })()`)
      if (r.firstMs !== null) searchSamples.push(r.firstMs)
      if (i === 2) record('search_first_batch_10k_ms', round1(median(searchSamples)), 'ms', `3 次：${searchSamples.map(round1).join('/')}ms；total=${r.total}`)
    }

    // diff 后端 ×3（两条 IPC：解析 + 原文）
    const diffSamples = []
    for (let i = 0; i < 3; i++) {
      const r = await cdp.eval(`(async () => {
        const file = 'src/d0/f0.php';
        const repo = ${JSON.stringify(REPO)};
        const t0 = performance.now();
        const r = await window.__TAURI_INTERNALS__.invoke('git_diff_with_raw', { repo, path: file, staged: false, ignoreWhitespace: false });
        const t1 = performance.now();
        return { parsed: t1 - t0, raw: 0, hunks: r.diff.hunks?.length ?? 0 };
      })()`)
      diffSamples.push(r.parsed + r.raw)
      if (i === 2)
        record(
          'diff_backend_ms',
          round1(median(diffSamples)),
          'ms',
          `3 次：${diffSamples.map(round1).join('/')}ms；单次 IPC 同时返回解析+原文，${r.hunks} hunks`,
        )
    }

    // diff 渲染：双击 Changes 里 f0.php → 双栏首帧
    const clicked = await cdp
      .eval(`(() => {
        const rows = Array.from(document.querySelectorAll('.changes-row'));
        const row = rows.find((r) => (r.querySelector('.changes-path')?.textContent ?? '').endsWith('src/d0/f0.php'));
        if (!row) return false;
        row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        return true;
      })()`)
      .catch(() => false)
    const diffMs = clicked ? await waitMeasure(cdp, 'air.diff_render', 15000) : null
    const fetchMs = clicked ? await waitMeasure(cdp, 'air.diff_fetch', 15000) : null
    record(
      'diff_2000_lines_ms',
      diffMs,
      'ms',
      clicked ? `双击 Changes 行 → 双栏首帧（含 IPC+解析+建视图）；其中取数 ${fetchMs ?? '?'}ms` : 'Changes 面板无行（跳转失败）',
    )
  } finally {
    killTree(app1.proc)
    await sleep(1500)
  }

  // ── 空载内存：无工作区启动，作为 0.4「空闲内存」口径基准 ──
  const appIdle = await openApp(null, [], null)
  let idleMem = null
  try {
    await sleep(5000)
    idleMem = workingSetBreakdown(appIdle.proc.pid)
  } finally {
    killTree(appIdle.proc)
    await sleep(1500)
  }
  // 0.4 空闲内存口径（P0 同口径：主进程 + WebView2 browser 进程）
  record('idle_memory_empty_mb', idleMem?.p0 ?? null, 'MB', `全部子进程 ${idleMem?.all ?? '?'}MB（${idleMem?.detail ?? '采集失败'}）`)

  // ── 大文件：会话恢复为唯一打开文件 ──
  const BIGBODY_MB = (readFileSync(BIG).length / 1024 / 1024).toFixed(2)
  const app2 = await openApp(REPO, [{ path: BIG, cursorLine: 1, cursorCol: 1, preview: false }], BIG)
  let bigMs = null
  let bigReadMs = null
  let readIpcMs = null
  let readIpcLen = 0
  let readIpcErr = null
  try {
    bigMs = await waitMeasure(app2.cdp, 'air.open_file', 30000)
    bigReadMs = await waitMeasure(app2.cdp, 'air.open_file_read', 15000)
    // 读盘 IPC 本体：区分「磁盘/Defender 扫描」与「编辑器建文档/渲染」
    // fs_read_file 返回 [meta_len][meta JSON][utf8 文本] 的 ArrayBuffer 信封
    const r = await app2.cdp.eval(`(async () => {
      const t0 = performance.now();
      const f = await window.__TAURI_INTERNALS__.invoke('fs_read_file', { path: ${JSON.stringify(BIG)} });
      return { ms: performance.now() - t0, bytes: f.byteLength };
    })()`)
    readIpcMs = round1(r.ms)
    readIpcLen = r.bytes
  } catch (e) {
    readIpcErr = String(e)
  } finally {
    killTree(app2.proc)
  }
  record('open_big_file_ms', bigMs, 'ms', `${BIGBODY_MB}MB 文本读盘→编辑器首帧；其中读盘 ${bigReadMs ?? '?'}ms`)
  record(
    'big_file_read_ipc_ms',
    readIpcMs,
    'ms',
    readIpcErr ? `采集失败: ${readIpcErr}` : `fs_read_file 单次，信封 ${(readIpcLen / 1024 / 1024).toFixed(2)}MB`,
  )

  // ── 输出 ──
  mkdirSync(OUT, { recursive: true })
  const full = { ts: new Date().toISOString(), build: 'release', exe: EXE, ...pre, results }
  writeFileSync(join(OUT, 'p5-release.jsonl'), JSON.stringify(full) + '\n', { flag: 'a' })
  console.log('\n=== P5-2 release 性能 ===')
  for (const r of results) console.log(`  ${r.metric}: ${r.value ?? 'n/a'}${r.unit}${r.detail ? ` (${r.detail})` : ''}`)
  console.log(`结果追加到 ${join(OUT, 'p5-release.jsonl')}`)
}

main()
  .catch((e) => {
    console.error('P5 基准失败:', e)
    process.exitCode = 1
  })
  .finally(() => {
    try {
      restoreSession()
    } catch (e) {
      console.error('会话还原失败（备份保留在 session.p5-bench.bak）:', e)
    }
  })
