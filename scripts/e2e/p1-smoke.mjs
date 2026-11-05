// P1 冒烟测试：文件树 / 多 tab / 命令面板 / 快速打开 / 全局搜索 / 最小 diff / 外部修改三态。
// 前置：app 以 --remote-debugging-port=9222 启动，vite dev server 在 5173。
const CDP_HTTP = 'http://127.0.0.1:9222'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// [[NEXT]]

import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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

// ── 测试夹具：git 仓库 + 多文件 ──
import { execSync } from 'node:child_process'

const REPO = 'D:/bench/p1-smoke'
rmSync(REPO, { recursive: true, force: true })
mkdirSync(join(REPO, 'src'), { recursive: true })
writeFileSync(join(REPO, 'src', 'OrderService.php'), '<?php\nclass OrderService {\n  public function pay() {}\n}\n')
writeFileSync(join(REPO, 'src', 'RefundService.php'), '<?php\nclass RefundService {}\n')
writeFileSync(join(REPO, 'README.md'), '# P1 smoke\n')
mkdirSync(join(REPO, 'node_modules', 'junk'), { recursive: true })
writeFileSync(join(REPO, 'node_modules', 'junk', 'x.js'), 'junk')

// git init + 首次提交（最小 diff 需要仓库基线）
execSync(`git init -q && git config user.email t@t.com && git config user.name t && git add -A && git commit -qm init`, { cwd: REPO, shell: 'bash' })

const cdp = await connectToPage()
check('CDP 连接', true)

// 1. 打开工作区 → 文件树渲染
await evaluate(cdp, `window.__air.openWorkspace(${JSON.stringify(REPO)})`)
await sleep(1200)
const tree = await evaluate(cdp, `(() => {
  const rows = [...document.querySelectorAll('.tree-row .tree-name')].map((n) => n.textContent)
  return { rows, hasTree: !!document.querySelector('.file-tree') }
})()`)
check(
  '文件树渲染（含 node_modules 过滤）',
  tree.hasTree && tree.rows.includes('src') && tree.rows.includes('README.md') && !tree.rows.includes('node_modules'),
  JSON.stringify(tree.rows),
)

// 2. 展开 src → 懒加载子目录
const clickResult = await evaluate(cdp, `(() => {
  const rows = [...document.querySelectorAll('.tree-row')]
  const src = rows.find((r) => r.textContent.includes('src'))
  if (!src) return { found: false, rows: rows.length }
  src.click()
  return { found: true }
})()`)
await sleep(800)
const dbg = await evaluate(cdp, `window.__air.debugExplorer()`)
const treeExpanded = await evaluate(cdp, `[...document.querySelectorAll('.tree-row .tree-name')].map((n) => n.textContent)`)
check(
  '懒加载展开 src',
  treeExpanded.includes('OrderService.php') && treeExpanded.includes('RefundService.php'),
  `click=${JSON.stringify(clickResult)} store=${JSON.stringify(dbg)} rows=${JSON.stringify(treeExpanded)}`,
)

// 3. 多 tab：打开两个文件 → 两个 tab；预览 tab 语义
await evaluate(cdp, `window.__air.open(${JSON.stringify(join(REPO, 'src', 'OrderService.php'))})`)
await sleep(500)
await evaluate(cdp, `window.__air.open(${JSON.stringify(join(REPO, 'src', 'RefundService.php'))})`)
await sleep(500)
const tabs = await evaluate(cdp, `[...document.querySelectorAll('.tab .tab-name')].map((n) => n.textContent)`)
check('多 tab 打开（预览 tab 复用为 1 个）', tabs.length === 1 && tabs[0] === 'RefundService.php', JSON.stringify(tabs))

// 固定后再开 → 两个 tab
await evaluate(cdp, `window.__air.makePermanentActive()`)
await sleep(200)
await evaluate(cdp, `window.__air.open(${JSON.stringify(join(REPO, 'README.md'))})`)
await sleep(500)
const tabs2 = await evaluate(cdp, `[...document.querySelectorAll('.tab .tab-name')].map((n) => n.textContent)`)
check('固定 tab 后再开新文件 → 2 个 tab', tabs2.length === 2, JSON.stringify(tabs2))

// 4. 命令面板（Ctrl+Shift+A）
await evaluate(cdp, `window.__air.openPalette()`)
await sleep(400)
const palette = await evaluate(cdp, `(() => ({
  open: !!document.querySelector('.palette'),
  items: document.querySelectorAll('.palette-item').length,
}))()`)
check('命令面板打开且有命令', palette.open && palette.items > 5, JSON.stringify(palette))
await evaluate(cdp, `window.__air.closeOverlays()`)

// 5. 快速打开（Ctrl+Shift+N）：模糊匹配
await evaluate(cdp, `window.__air.openQuickOpen()`)
await sleep(800)
const quick = await evaluate(cdp, `(() => {
  const input = document.querySelector('.palette-input')
  if (!input) return { open: false }
  return { open: true, count: document.querySelectorAll('.palette-item').length }
})()`)
check('快速打开有文件候选', quick.open && quick.count > 0, JSON.stringify(quick))
await evaluate(cdp, `window.__air.closeOverlays()`)

// 6. 全局搜索：流式结果 + 分组
await evaluate(cdp, `window.__air.openSearch()`)
await sleep(400)
await evaluate(cdp, `(() => {
  const input = document.querySelector('.search-input')
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'OrderService')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
})()`)
await sleep(2500)
const search = await evaluate(cdp, `(() => ({
  groups: document.querySelectorAll('.search-group').length,
  status: document.querySelector('.search-status')?.textContent ?? '',
}))()`)
check('全局搜索返回分组结果', search.groups >= 1, JSON.stringify(search))
await evaluate(cdp, `window.__air.closeOverlays()`)

// 7. 最小 diff：git status + 双击打开 diff
// 先在仓库里制造变更（用 Write 工具已不可用，改用 git 命令 + 现有文件改写）
writeFileSync(join(REPO, 'src', 'OrderService.php'), '<?php\nclass OrderService {\n  public function pay() { return 1; }\n}\n')

const status = await evaluate(cdp, `window.__air.gitStatus(${JSON.stringify(REPO)})`)
check(
  'git status 解析（unstaged 含 OrderService.php）',
  status?.unstaged?.some((e) => e.path.includes('OrderService.php')) ?? false,
  JSON.stringify(status?.unstaged?.map((e) => e.path) ?? []),
)

const diff = await evaluate(cdp, `window.__air.gitDiff(${JSON.stringify(REPO)}, 'src/OrderService.php')`)
check(
  'git diff 解析（1 hunk，含 return 1 新增行）',
  (diff?.hunks?.length ?? 0) >= 1 && diff.hunks[0].lines.some((l) => l.text.includes('return 1')),
  `hunks=${diff?.hunks?.length}`,
)

// 8. 外部修改三态（3.11）：干净 tab 自动重载
await evaluate(cdp, `window.__air.open(${JSON.stringify(join(REPO, 'README.md'))})`)
await sleep(600)
const docBefore = await evaluate(cdp, `window.__air.doc()`)
// 外部改写（绕过 app）
writeFileSync(join(REPO, 'README.md'), '# P1 smoke\n外部修改了一行\n')
await sleep(2200) // 等监听合并 200ms + 重载
const docAfter = await evaluate(cdp, `window.__air.doc()`)
check(
  '干净 tab 外部修改自动重载',
  docAfter !== docBefore && (docAfter ?? '').includes('外部修改了一行'),
  `before=${JSON.stringify(docBefore)} after=${JSON.stringify(docAfter)}`,
)

// 9. 汇总
const failed = results.filter((r) => !r.ok)
console.log(`\n=== P1 冒烟结果: ${results.length - failed.length}/${results.length} 通过 ===`)
if (failed.length > 0) {
  console.log('失败项:', failed.map((f) => f.name).join(' | '))
  process.exitCode = 1
}
cdp.close()

