// P5 基准快速版（P5-2）：对已建好的 10k 夹具直接测量，输出到控制台。
// 夹具由 p5-bench.mjs 预建（D:/bench/p5-bench，git 仓库 + 2000 变更）。
const CDP = 'http://127.0.0.1:9222'
const REPO = 'D:/bench/p5-bench'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await fetch(`${CDP}/json/list`).then((r) => r.json())
const page = list.find((t) => t.type === 'page' && (t.url || '').includes('localhost:5173'))
if (!page) {
  console.error('无 CDP page（app 启动并指向 5173？）')
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result)
    pending.delete(m.id)
  }
})
await new Promise((r) => ws.addEventListener('open', r))
const call = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const ev = async (expr, timeoutMs = 90000) => {
  let timer
  try {
    return await Promise.race([
      call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(
        (r) => {
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'err')
          return r.result.value
        },
      ),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error(`超时 ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const out = []
const bench = async (name, fn) => {
  const t0 = performance.now()
  try {
    const detail = await fn()
    out.push({ name, ms: performance.now() - t0, detail })
    console.log(`${name}: ${(performance.now() - t0).toFixed(1)}ms ${detail ?? ''}`)
  } catch (e) {
    out.push({ name, ms: performance.now() - t0, error: String(e) })
    console.log(`${name}: ERROR ${e}`)
  }
}

await bench('open_workspace_10k', () => ev(`window.__air.openWorkspace(${JSON.stringify(REPO)})`).then(() => sleep(500)))
await bench('list_root_dir', () => ev(`window.__air.listDir(${JSON.stringify(REPO)})`).then((r) => `${r?.length ?? 0} entries`))
await bench('git_status_10k', () =>
  ev(`window.__air.gitStatus(${JSON.stringify(REPO)})`).then((s) => `unstaged=${s?.unstaged?.length ?? 0}`))
await bench('git_diff_2000lines', () =>
  ev(`window.__air.gitDiff(${JSON.stringify(REPO)}, 'src/d0/f0.php')`).then((d) => `hunks=${d?.hunks?.length ?? 0}`))
await bench('lsp_scan', () => ev(`window.__air.lspScan()`).then((s) => `${s?.length ?? 0} servers`))
await bench('project_profile', () =>
  ev(`window.__air.projectProfile(${JSON.stringify(REPO)})`).then((p) => `${p?.languages?.join(',')}`))
await bench('js_heap_mb', () =>
  ev(`(performance.memory?.usedJSHeapSize ?? 0) / 1048576`).then((v) => `${v.toFixed(1)}MB`))

console.log('\n=== 汇总 ===')
for (const r of out) console.log(`  ${r.name}: ${r.ms.toFixed(1)}ms${r.error ? ' ERROR' : ''}`)
console.log('前提: Defender=on, 台式机, Win11 26300, dev/debug 构建')
ws.close()
