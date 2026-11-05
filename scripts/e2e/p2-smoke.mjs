// P2 冒烟测试：双栏 diff / 词级高亮 / 折叠 / 导航 / 已读 / 忽略空白 / log 视图。
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

// ── 夹具：git 仓库 + 单文件多处变更 ──
const REPO = 'D:/bench/p2-smoke'
rmSync(REPO, { recursive: true, force: true })
mkdirSync(join(REPO, 'src'), { recursive: true })
writeFileSync(
  join(REPO, 'src', 'OrderService.php'),
  '<?php\nclass OrderService {\n  public function pay($price) {\n    return $price;\n  }\n}\n',
)
execSync(`git init -q && git config user.email t@t.com && git config user.name t && git add -A && git commit -qm init`, { cwd: REPO, shell: 'bash' })

// 制造多处变更（词级 + 行级 + 纯空白）
writeFileSync(
  join(REPO, 'src', 'OrderService.php'),
  '<?php\nclass OrderService {\n  public function payNow($price) {\n    return $price * 100;\n  }\n\n  public function refund() {}\n}\n',
)

const cdp = await connectToPage()
check('CDP 连接', true)

// 1. 打开工作区 + 打开双栏 diff
await evaluate(cdp, `window.__air.openWorkspace(${JSON.stringify(REPO)})`)
await sleep(1200)
await evaluate(cdp, `window.__air.openDiffFor(${JSON.stringify('src/OrderService.php')})`)
await sleep(1500)

const split = await evaluate(cdp, `(() => ({
  open: !!document.querySelector('.split-diff'),
  panes: document.querySelectorAll('.split-diff-pane').length,
  editors: document.querySelectorAll('.split-diff-editor .cm-editor').length,
  toolbar: document.querySelector('.split-diff-toolbar')?.textContent ?? '',
}))()`)
check(
  '双栏 diff 打开（两栏 + 两个 CM6 实例）',
  split.open && split.panes === 2 && split.editors === 2,
  JSON.stringify(split),
)

// 2. 行级着色：add/delete 行存在
const colors = await evaluate(cdp, `(() => ({
  addLines: document.querySelectorAll('.diff-line-add').length,
  delLines: document.querySelectorAll('.diff-line-delete').length,
}))()`)
check(
  '行级着色（新增/删除行）',
  colors.addLines > 0 && colors.delLines > 0,
  JSON.stringify(colors),
)

// 3. 词级高亮：pay → payNow 的标识符整体高亮
const words = await evaluate(cdp, `(() => ({
  wordAdd: document.querySelectorAll('.cm-diff-word-add').length,
  wordDel: document.querySelectorAll('.cm-diff-word-del').length,
}))()`)
check(
  '词级高亮（mark decoration）',
  words.wordAdd > 0 && words.wordDel > 0,
  JSON.stringify(words),
)

// 4. F7 导航 + 已读进度
await evaluate(cdp, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7' }))`)
await sleep(300)
const nav = await evaluate(cdp, `document.querySelector('.diff-nav-count')?.textContent ?? ''`)
const read = await evaluate(cdp, `document.querySelector('.diff-read-progress')?.textContent ?? ''`)
check('F7 导航 + 已读进度', nav.length > 0 && read.includes('已读'), `nav=${nav} read=${read}`)

// 5. 折叠上下文
await evaluate(cdp, `(() => {
  const btns = [...document.querySelectorAll('.diff-toggle')]
  const fold = btns.find((b) => b.textContent === '折叠')
  fold?.click()
})()`)
await sleep(600)
const folded = await evaluate(cdp, `(() => ({
  contextHidden: document.querySelectorAll('.diff-line-add').length,
  hasGap: [...document.querySelectorAll('.cm-line')].some((l) => l.textContent.includes('行未变更')),
}))()`)
check(
  '折叠纯上下文（变更行仍在 + 出现未变更占位）',
  folded.contextHidden > 0 && folded.hasGap,
  JSON.stringify(folded),
)

// 6. 忽略空白开关（-w）：先提交修改版，再只加行尾空格 → unstaged diff 仅空白
writeFileSync(
  join(REPO, 'src', 'OrderService.php'),
  '<?php\nclass OrderService {\n  public function payNow($price) {\n    return $price * 100;\n  }\n\n  public function refund() {}\n}\n',
)
execSync('git add -A && git commit -qm changed', { cwd: REPO, shell: 'bash' })
writeFileSync(
  join(REPO, 'src', 'OrderService.php'),
  '<?php\nclass OrderService {\n  public function payNow($price) {   \n    return $price * 100;   \n  }\n\n  public function refund() {}\n}\n',
)
await evaluate(cdp, `window.__air.openWorkspace(${JSON.stringify(REPO)})`)
await sleep(1200)
await evaluate(cdp, `window.__air.openDiffFor(${JSON.stringify('src/OrderService.php')})`)
await sleep(1500)
const beforeWs = await evaluate(cdp, `document.querySelector('.diff-nav-count')?.textContent ?? ''`)
await evaluate(cdp, `(() => {
  const btns = [...document.querySelectorAll('.diff-toggle')]
  btns.find((b) => b.textContent === '-w')?.click()
})()`)
await sleep(1500)
const afterWs = await evaluate(cdp, `document.querySelector('.diff-nav-count')?.textContent ?? ''`)
check(
  '忽略空白差异（-w 后 hunk 归零）',
  beforeWs.includes('/ 1') && afterWs.includes('/ 0'),
  `before=${beforeWs} after=${afterWs}`,
)

// 7. Log 视图
await evaluate(cdp, `window.__air.closeDiff()`)
await sleep(300)
await evaluate(cdp, `(() => {
  const tabs = [...document.querySelectorAll('.tw-tab')]
  tabs.find((t) => t.textContent === 'Log')?.click()
})()`)
await sleep(1200)
const log = await evaluate(cdp, `(() => ({
  rows: document.querySelectorAll('.log-row').length,
  first: document.querySelector('.log-subject')?.textContent ?? '',
}))()`)
check(
  'Git Log 视图（提交记录渲染）',
  log.rows >= 2 && log.first === 'changed',
  JSON.stringify(log),
)

// 8. Esc 关闭 diff（回归）
await evaluate(cdp, `window.__air.openDiffFor(${JSON.stringify('src/OrderService.php')})`)
await sleep(1000)
await evaluate(cdp, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
await sleep(300)
const closed = await evaluate(cdp, `!document.querySelector('.split-diff')`)
check('Esc 关闭 diff', closed)

// ── 汇总 ──
const failed = results.filter((r) => !r.ok)
console.log(`\n=== P2 冒烟结果: ${results.length - failed.length}/${results.length} 通过 ===`)
if (failed.length > 0) {
  console.log('失败项:', failed.map((f) => f.name).join(' | '))
  process.exitCode = 1
}
cdp.close()

