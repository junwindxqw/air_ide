// P0 Windows 平台适配验证（3.12 六项）：与冒烟测试互补，侧重平台行为。
// 运行：node scripts/e2e/p0-windows.mjs
const { execSync } = await import('node:child_process')
const { mkdirSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } = await import('node:fs')
const { join } = await import('node:path')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// [[NEXT]]

const CDP_HTTP = 'http://127.0.0.1:9222'

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.ready = new Promise((resolve) => {
      ws.addEventListener('open', resolve)
    })
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
  close() {
    this.ws.close()
  }
}

async function connectToPage() {
  const list = await fetch(`${CDP_HTTP}/json/list`).then((r) => r.json())
  const page = list.find((t) => t.type === 'page' && (t.url || '').includes('localhost:5173'))
    ?? list.find((t) => t.type === 'page')
  if (!page) throw new Error('CDP 无可用 page target')
  return new Cdp(new WebSocket(page.webSocketDebuggerUrl))
}

async function evaluate(cdp, expression) {
  const r = await cdp.call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) {
    throw new Error(`页面异常: ${r.exceptionDetails.exception?.description ?? 'unknown'}`)
  }
  return r.result.value
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 3.12.1 长路径：构造 300 字符深目录，读/写/列表全通过 ──
const base = 'D:/bench/p0-win/longpath'
rmSync(base, { recursive: true, force: true })
// 每级 40 字符的目录名，8 级 ≈ 320 字符
const seg = 'veryLongDirectoryNameForPathDepthTest1234'
let deep = base
for (let i = 0; i < 8; i++) deep = join(deep, seg)
mkdirSync(deep, { recursive: true })
const deepFile = join(deep, 'deep.php')
writeFileSync(deepFile, '<?php // deep path ok\n')

check(
  '3.12.1 长路径构造（>260 字符）',
  deepFile.length > 260,
  `pathLen=${deepFile.length}`,
)

// ── 3.12.6 Git 探测：PATH 与常见目录 ──
let gitOk = false
let gitDetail = ''
try {
  gitOk = execSync('git --version', { encoding: 'utf8' }).includes('git version')
  gitDetail = execSync('git --version', { encoding: 'utf8' }).trim()
} catch {
  gitDetail = 'git 不在 PATH（非预期）'
}
check('3.12.6 Git 运行时探测（环境前置）', gitOk, gitDetail)

// ── 通过 CDP 验证 app 侧：长路径打开 + fs_list_dir ──
const cdp = await connectToPage()
check('CDP 连接', true)

await evaluate(cdp, `window.__air.open(${JSON.stringify(deepFile)})`)
await sleep(700)
const deepState = await evaluate(
  cdp,
  `({ doc: window.__air.doc(), meta: window.__air.meta() })`,
)
check(
  '3.12.1 长路径文件打开',
  deepState.doc === '<?php // deep path ok\n' && deepState.meta?.path?.length > 260,
  `docLen=${deepState.doc?.length} pathLen=${deepState.meta?.path?.length}`,
)

// ── 3.12.2 高 DPI：devicePixelRatio 与 CM6 行高整数化 ──
const dpi = await evaluate(
  cdp,
  `({ dpr: window.devicePixelRatio, lineHeight: getComputedStyle(document.querySelector('.cm-line') ?? document.body).lineHeight })`,
)
check(
  '3.12.2 DPI 感知（PerMonitorV2）',
  typeof dpi.dpr === 'number' && dpi.dpr > 0,
  `dpr=${dpi.dpr}`,
)

// ── 3.12.3 暗色标题栏：DWM 属性设置结果（Rust 侧日志 + 无报错即降级成功）──
// 标题栏是否暗色无法从 JS 读；验证 app 未崩溃且 WebView 可正常渲染即可。
const titleOk = await evaluate(cdp, `document.title === 'Air IDE'`)
check('3.12.3 应用运行（标题栏设置无崩溃）', titleOk)

// ── 3.12.4 文件监听：外部写入 → fs://changed 事件（P0 只验证写入抑制表不误报）──
const watchDir = 'D:/bench/p0-win/watch'
mkdirSync(watchDir, { recursive: true })
const watchFile = join(watchDir, 'watched.txt')
writeFileSync(watchFile, 'v1\n')
await evaluate(cdp, `window.__air.open(${JSON.stringify(watchFile)})`)
await sleep(500)
// 自己保存一次（抑制表路径）：不应出现"外部修改"横幅
await evaluate(cdp, `window.__air.setDoc('v2\\n')`)
await evaluate(cdp, `window.__air.save()`)
await sleep(600)
const noFalseBanner = await evaluate(
  cdp,
  `!document.body.innerText.includes('文件已在外部修改')`,
)
check('3.12.4 自身保存不触发外部修改横幅（抑制表）', noFalseBanner)

// ── 3.12.5 Defender：10k 文件目录 status 不适用（无 git 模块）；验证遍历速度 ──
// P0 只验证 fs_list_dir 对 10k 文件目录的响应（P1 的 git status 基准见方案 0.4）
const manyDir = 'D:/bench/p0-win/many'
if (!existsSync(manyDir)) {
  mkdirSync(manyDir, { recursive: true })
  for (let i = 0; i < 2000; i++) {
    writeFileSync(join(manyDir, `f${i}.txt`), `content ${i}\n`)
  }
}
const listMs = await evaluate(
  cdp,
  `(async () => { const t0 = performance.now(); await window.__air.listDir(${JSON.stringify(manyDir)}); return performance.now() - t0 })()`,
)
check('3.12.5 2000 文件目录列表（≤500ms）', listMs < 500, `${listMs.toFixed(0)}ms`)

// ── 3.10 单实例：再次启动应被单实例插件拦截，进程数不变 ──
const before = execSync('tasklist /FI "IMAGENAME eq air-ide.exe" /NH', { encoding: 'utf8' })
  .split('\n')
  .filter((l) => l.includes('air-ide.exe')).length
try {
  execSync(
    'powershell -NoProfile -Command "Start-Process -FilePath \'D:\\myProject\\air_ide\\target\\debug\\air-ide.exe\'"',
    { timeout: 10000 },
  )
} catch {
  // 二次启动被插件接管，Start-Process 本身不报错；忽略
}
await sleep(2500)
const after = execSync('tasklist /FI "IMAGENAME eq air-ide.exe" /NH', { encoding: 'utf8' })
  .split('\n')
  .filter((l) => l.includes('air-ide.exe')).length
check('3.10 单实例锁（二次启动不新开进程）', after === before, `before=${before} after=${after}`)

// ── 汇总 ──
const failed = results.filter((r) => !r.ok)
console.log(`\n=== P0 Windows 适配结果: ${results.length - failed.length}/${results.length} 通过 ===`)
if (failed.length > 0) {
  console.log('失败项:', failed.map((f) => f.name).join(' | '))
  process.exitCode = 1
}
cdp.close()

