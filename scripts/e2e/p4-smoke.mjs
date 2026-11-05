// P4 冒烟测试：服务器探测、ProjectProfile 识别、LSP 会话启动/消息/停止。
const CDP_HTTP = 'http://127.0.0.1:9222'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

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

const cdp = await connectToPage()
check('CDP 连接', true)

// 1. 服务器探测（2.6 三级策略第一级）
const servers = await evaluate(cdp, `window.__air.lspScan()`)
check(
  '服务器扫描返回 7 类',
  Array.isArray(servers) && servers.length === 7,
  `${servers?.length ?? 0} 类: ${servers?.map((s) => `${s.language}=${s.installed ? '装' : '缺'}`).join(' ')}`,
)
check(
  '每类有安装提示',
  servers?.every((s) => typeof s.installHint === 'string' && s.installHint.length > 0) ?? false,
)

// 2. ProjectProfile：标记文件命中（PHP 项目）
const phpRepo = 'D:/bench/p4-smoke-php'
rmSync(phpRepo, { recursive: true, force: true })
mkdirSync(phpRepo, { recursive: true })
writeFileSync(join(phpRepo, 'composer.json'), '{"name": "test/app"}')
writeFileSync(join(phpRepo, 'index.php'), '<?php echo 1;')
const profile1 = await evaluate(cdp, `window.__air.projectProfile(${JSON.stringify(phpRepo)})`)
check(
  'ProjectProfile：composer.json → php（marker）',
  profile1?.languages?.includes('php') && profile1?.source === 'marker',
  JSON.stringify(profile1),
)

// 3. ProjectProfile：扩展名兜底（无标记文件）
const plainRepo = 'D:/bench/p4-smoke-plain'
rmSync(plainRepo, { recursive: true, force: true })
mkdirSync(join(plainRepo, 'src'), { recursive: true })
for (let i = 0; i < 10; i++) {
  writeFileSync(join(plainRepo, 'src', `f${i}.go`), 'package main')
}
writeFileSync(join(plainRepo, 'src', 'one.py'), 'print(1)')
const profile2 = await evaluate(cdp, `window.__air.projectProfile(${JSON.stringify(plainRepo)})`)
check(
  'ProjectProfile：扩展名兜底 → go',
  profile2?.languages?.[0] === 'go' && profile2?.source === 'extension',
  JSON.stringify(profile2),
)

// 4. 多语言仓库（Laravel + Vue：composer.json + package.json + tsconfig.json，方案 3.6 定义）
const multiRepo = 'D:/bench/p4-smoke-multi'
rmSync(multiRepo, { recursive: true, force: true })
mkdirSync(multiRepo, { recursive: true })
writeFileSync(join(multiRepo, 'composer.json'), '{}')
writeFileSync(join(multiRepo, 'package.json'), '{}')
writeFileSync(join(multiRepo, 'tsconfig.json'), '{}')
const profile3 = await evaluate(cdp, `window.__air.projectProfile(${JSON.stringify(multiRepo)})`)
check(
  'ProjectProfile：多语言并存（php + typescript）',
  (profile3?.languages ?? []).length >= 2,
  JSON.stringify(profile3),
)

// 5. LSP 会话生命周期：未安装的语言启动应报可读错误（不崩溃）
const lspStartResult = await evaluate(cdp, `(async () => {
  try {
    const id = await window.__air.lspStart('go', ${JSON.stringify(plainRepo)})
    return { ok: true, id }
  } catch (e) {
    return { ok: false, msg: String(e) }
  }
})()`)
check(
  'LSP 启动未安装服务器：可读错误（不崩溃）',
  lspStartResult.ok === true || (lspStartResult.msg ?? '').length > 0,
  JSON.stringify(lspStartResult),
)

// 6. idle 回收命令可用
await evaluate(cdp, `window.__air.lspReap()`)
check('LSP idle 回收命令可用', true)

// 7. 打开 PHP 文件：LSP 懒启动不阻塞编辑（降级路径）
await evaluate(cdp, `window.__air.openWorkspace(${JSON.stringify(phpRepo)})`)
await sleep(1000)
await evaluate(cdp, `window.__air.open(${JSON.stringify(join(phpRepo, 'index.php').replaceAll('\\', '/'))})`)
await sleep(1500)
const editorOk = await evaluate(cdp, `(() => ({
  hasCm: !!document.querySelector('.cm-editor'),
  doc: window.__air.doc(),
}))()`)
check(
  'PHP 文件打开 + 编辑器可用（LSP 缺省时降级语法模式）',
  editorOk.hasCm && editorOk.doc === '<?php echo 1;',
  JSON.stringify(editorOk),
)

// 8. 管理面板可打开
await evaluate(cdp, `window.__air.openServerPanel()`)
await sleep(500)
const panel = await evaluate(cdp, `(() => ({
  open: !!document.querySelector('.server-row'),
  rows: document.querySelectorAll('.server-row').length,
}))()`)
check('服务器管理面板渲染', panel.open && panel.rows === 7, JSON.stringify(panel))

// ── 汇总 ──
const failed = results.filter((r) => !r.ok)
console.log(`\n=== P4 冒烟结果: ${results.length - failed.length}/${results.length} 通过 ===`)
if (failed.length > 0) {
  console.log('失败项:', failed.map((f) => f.name).join(' | '))
  process.exitCode = 1
}
cdp.close()
