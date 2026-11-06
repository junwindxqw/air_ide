// P3 冒烟测试：hunk 级 stage/unstage/discard、提交、分支、命令条。
const CDP_HTTP = 'http://127.0.0.1:9222'

import { createReporter } from './lib/harness.mjs'

const { check, skip, finish } = createReporter('p3-smoke', 'P3 冒烟')

import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
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

// ── 夹具：git 仓库 + 两处独立变更（两个 hunk）──
const REPO = 'D:/bench/p3-smoke'
rmSync(REPO, { recursive: true, force: true })
mkdirSync(join(REPO, 'src'), { recursive: true })
const base = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n') + '\n'
writeFileSync(join(REPO, 'src', 'Service.php'), base)
execSync(`git init -q && git config user.email t@t.com && git config user.name t && git config core.autocrlf false && git add -A && git commit -qm init`, { cwd: REPO })

const modified = base.split('\n')
modified[1] = 'CHANGED-2'
modified[12] = 'CHANGED-13'
writeFileSync(join(REPO, 'src', 'Service.php'), modified.join('\n'))

const cdp = await connectToPage()
check('CDP 连接', true)

await evaluate(cdp, `window.__air.openWorkspace(${JSON.stringify(REPO)})`)
await sleep(1200)

// 1. status 显示未暂存变更
const status = await evaluate(cdp, `window.__air.gitStatus(${JSON.stringify(REPO)})`)
check(
  'status：Service.php 在未暂存',
  status?.unstaged?.some((e) => e.path === 'src/Service.php') ?? false,
  JSON.stringify(status?.unstaged?.map((e) => e.path) ?? []),
)

// 2. 文件级 stage（复选框）
await evaluate(cdp, `window.__air.stageFile(${JSON.stringify('src/Service.php')})`)
await sleep(800)
const afterStage = await evaluate(cdp, `window.__air.gitStatus(${JSON.stringify(REPO)})`)
check(
  '文件级 stage 生效',
  afterStage?.staged?.some((e) => e.path === 'src/Service.php') ?? false,
  JSON.stringify(afterStage?.staged?.map((e) => e.path) ?? []),
)

// 3. hunk 级 unstage（第一个 hunk）
const rawCached = await evaluate(cdp, `window.__air.gitDiffRaw(${JSON.stringify(REPO)}, 'src/Service.php', true)`)
check('取到 cached 原始 diff（含 2 个 hunk）', (rawCached?.match(/@@ -/g) ?? []).length === 2, `hunks=${(rawCached?.match(/@@ -/g) ?? []).length}`)
await evaluate(cdp, `window.__air.applyHunk(${JSON.stringify(REPO)}, 'src/Service.php', 0, 'unstage', ${JSON.stringify(rawCached)})`)
await sleep(800)
const afterUnstage = await evaluate(cdp, `window.__air.gitStatus(${JSON.stringify(REPO)})`)
// 两个 hunk 的文件：unstage 第一个后，第二个仍在暂存区（staged 仍有），
// 第一个回到未暂存（unstaged 出现）
check(
  'hunk 级 unstage（第一个 hunk 回到未暂存，第二个仍暂存）',
  (afterUnstage?.unstaged?.some((e) => e.path === 'src/Service.php') ?? false) &&
    (afterUnstage?.staged?.some((e) => e.path === 'src/Service.php') ?? false),
  `staged=${JSON.stringify(afterUnstage?.staged?.map((e) => e.path) ?? [])} unstaged=${JSON.stringify(afterUnstage?.unstaged?.map((e) => e.path) ?? [])}`,
)

// 4. hunk 级 stage（重新暂存第一个 hunk）
const rawUnstaged = await evaluate(cdp, `window.__air.gitDiffRaw(${JSON.stringify(REPO)}, 'src/Service.php', false)`)
await evaluate(cdp, `window.__air.applyHunk(${JSON.stringify(REPO)}, 'src/Service.php', 0, 'stage', ${JSON.stringify(rawUnstaged)})`)
await sleep(800)
const afterStage2 = await evaluate(cdp, `window.__air.gitStatus(${JSON.stringify(REPO)})`)
check(
  'hunk 级 stage（暂存第一个 hunk 后unstaged 只剩第二个 hunk 的文件态）',
  (afterStage2?.staged?.some((e) => e.path === 'src/Service.php') ?? false),
  `staged=${afterStage2?.staged?.length ?? 0} unstaged=${afterStage2?.unstaged?.length ?? 0}`,
)

// 5. 提交（message 走 stdin；模板里的 \n 需转义为字面两字符）
await evaluate(cdp, `window.__air.gitCommit(${JSON.stringify(REPO)}, 'P3 冒烟提交\\n\\n验证 hunk 级暂存', false, false)`)
await sleep(1000)
const afterCommit = await evaluate(cdp, `window.__air.gitStatus(${JSON.stringify(REPO)})`)
check(
  '提交成功（staged 清空）',
  (afterCommit?.staged?.length ?? -1) === 0,
  `staged=${JSON.stringify(afterCommit?.staged ?? [])}`,
)
const logOut = execSync('git log --oneline', { cwd: REPO, encoding: 'utf8' })
check('提交信息含中文', logOut.includes('P3 冒烟提交'), logOut.split('\n')[0])

// 6. 撤销上一次提交
await evaluate(cdp, `window.__air.gitUndoCommit(${JSON.stringify(REPO)})`)
await sleep(800)
const logAfterUndo = execSync('git log --oneline', { cwd: REPO, encoding: 'utf8' })
check('撤销提交生效（log 回到 init）', !logAfterUndo.includes('P3 冒烟提交'), logAfterUndo.split('\n')[0])

// 7. 分支操作
const branches = await evaluate(cdp, `window.__air.gitBranches(${JSON.stringify(REPO)})`)
check('分支列表（master 当前）', branches?.some((b) => b.isCurrent) ?? false, JSON.stringify(branches?.map((b) => b.name)))
await evaluate(cdp, `window.__air.gitBranchCreate(${JSON.stringify(REPO)}, 'feature-x')`)
await sleep(600)
const branches2 = await evaluate(cdp, `window.__air.gitBranches(${JSON.stringify(REPO)})`)
check('新建分支 feature-x', branches2?.some((b) => b.name === 'feature-x') ?? false, JSON.stringify(branches2?.map((b) => b.name)))

// 8. 命令条：从命令面板打开 → 真实执行 status --short → 读取输出与退出码
await evaluate(cdp, `window.__air.openPalette()`)
await sleep(300)
const openedBar = await evaluate(cdp, `(() => {
  const items = [...document.querySelectorAll('.palette-item')]
  const item = items.find((el) => el.textContent.includes('Git 命令条'))
  if (!item) return { ok: false, items: items.map((el) => el.textContent) }
  item.click()
  return { ok: true }
})()`)
check('命令条可从命令面板打开', openedBar.ok === true, JSON.stringify(openedBar))

if (openedBar.ok) {
  await sleep(500)
  const typed = await evaluate(cdp, `(() => {
    const input = document.querySelector('.command-bar-input')
    if (!input) return { ok: false, reason: '未找到 .command-bar-input' }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'status --short')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true, value: input.value }
  })()`)
  check('命令条输入框写入 status --short', typed.ok === true && typed.value === 'status --short', JSON.stringify(typed))

  await sleep(200)
  const clicked = await evaluate(cdp, `(() => {
    const btn = [...document.querySelectorAll('.command-bar .commit-btn.primary')]
      .find((b) => b.textContent.trim() === '执行')
    if (!btn) return false
    btn.click()
    return true
  })()`)
  check('命令条执行按钮可点击', clicked === true)

  await sleep(1500)
  const cmdOut = await evaluate(cdp, `document.querySelector('.command-bar-output')?.textContent ?? ''`)
  check(
    '命令条执行 status --short（退出码 0 且输出含变更文件）',
    cmdOut.includes('退出码 0') && cmdOut.includes('src/Service.php'),
    JSON.stringify(cmdOut),
  )
  await evaluate(cdp, `window.__air.closeOverlays()`)
  await sleep(300)
}

// 9. discard hunk（工作区还原）
// soft-reset 后改动在暂存区，先 unstage 让它们回到未暂存态
await evaluate(cdp, `window.__air.unstageFile(${JSON.stringify('src/Service.php')})`)
await sleep(800)
const rawForDiscard = await evaluate(cdp, `window.__air.gitDiffRaw(${JSON.stringify(REPO)}, 'src/Service.php', false)`)
check('unstage 后取到 unstaged diff（2 hunks）', (rawForDiscard?.match(/@@ -/g) ?? []).length === 2, `hunks=${(rawForDiscard?.match(/@@ -/g) ?? []).length}`)
await evaluate(cdp, `window.__air.applyHunk(${JSON.stringify(REPO)}, 'src/Service.php', 0, 'discard', ${JSON.stringify(rawForDiscard)})`)
await sleep(800)
const afterDiscard = readFileSync(join(REPO, 'src', 'Service.php'), 'utf8')
check(
  'discard 第一个 hunk（line2 还原，line13 变更保留）',
  afterDiscard.split('\n')[1] === 'line2' && afterDiscard.split('\n')[12] === 'CHANGED-13',
  `line2=${JSON.stringify(afterDiscard.split('\n')[1])} line13=${JSON.stringify(afterDiscard.split('\n')[12])}`,
)

// ── 汇总 ──
finish('P3 冒烟')
cdp.close()
