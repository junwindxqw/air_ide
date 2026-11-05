// P0 冒烟测试（5.1 E2E）：Node 22 原生 WebSocket 直连 WebView2 CDP，零依赖。
// 前置：app 以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 启动。
const CDP_HTTP = 'http://127.0.0.1:9222'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// [[NEXT]]

import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'

// 极简 CDP 客户端：一个 WebSocket + 自增 id + Promise 队列
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
  if (!page) throw new Error('CDP 无可用 page target（app 未启动？）')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  return new Cdp(ws)
}

// evaluate：在页面里执行同步/异步表达式
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

// 1. 布局骨架
const layout = await evaluate(cdp, `(() => ({
  title: document.title,
  hasRoot: !!document.querySelector('#root'),
  hasToolWindow: !!document.querySelector('.tool-window'),
  hasStatusBar: !!document.querySelector('.status-bar'),
  hasCm: !!document.querySelector('.cm-editor'),
}))()`)
check(
  '布局骨架（工具窗/状态栏/编辑器）',
  layout.hasToolWindow && layout.hasStatusBar && layout.hasCm,
  JSON.stringify(layout),
)

// 2. 测试夹具：GBK / BOM / CRLF / 10MB
const testDir = 'D:/myProject/air_ide/bench-out/p0-smoke-fs'
mkdirSync(testDir, { recursive: true })

const gbkPath = `${testDir}/gbk.php`
const gbkBytes = Buffer.from([0xc4, 0xe3, 0xba, 0xc3, 0x50, 0x48, 0x50, 0x0a]) // 你好PHP\n
writeFileSync(gbkPath, gbkBytes)

const bomPath = `${testDir}/bom.php`
writeFileSync(
  bomPath,
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<?php echo 1;\n')]),
)

const crlfPath = `${testDir}/crlf.txt`
writeFileSync(crlfPath, 'a\r\nb\r\n')

const bigPath = `${testDir}/big.log`
if (!existsSync(bigPath) || statSync(bigPath).size !== 10 * 1024 * 1024) {
  const line = `${'x'.repeat(199)}\n`
  const buf = Buffer.from(line.repeat(Math.ceil((10 * 1024 * 1024) / line.length)))
  writeFileSync(bigPath, buf.subarray(0, 10 * 1024 * 1024))
}

// 3. GBK：打开显示 → 编辑 → 保存 → 字节级保真
await evaluate(cdp, `window.__air.open(${JSON.stringify(gbkPath)})`)
await sleep(700)
const gbkState = await evaluate(
  cdp,
  `({ doc: window.__air.doc(), meta: window.__air.meta() })`,
)
check(
  'GBK 打开并正确显示',
  gbkState.doc === '你好PHP\n' && gbkState.meta?.encoding === 'gb18030',
  `doc=${JSON.stringify(gbkState.doc)} enc=${gbkState.meta?.encoding}`,
)

await evaluate(cdp, `window.__air.setDoc('你好PHP+改\\n')`)
await evaluate(cdp, `window.__air.save()`)
await sleep(600)
const gbkAfter = readFileSync(gbkPath)
check(
  'GBK 保存保真（字节级）',
  gbkAfter.equals(
    Buffer.from([0xc4, 0xe3, 0xba, 0xc3, 0x50, 0x48, 0x50, 0x2b, 0xb8, 0xc4, 0x0a]),
  ),
  `bytes=${gbkAfter.toString('hex')}`,
)

// 4. BOM：检测 + 保存保留
await evaluate(cdp, `window.__air.open(${JSON.stringify(bomPath)})`)
await sleep(600)
const bomMeta = await evaluate(cdp, `window.__air.meta()`)
check('BOM 检测', bomMeta?.hasBom === true, `hasBom=${bomMeta?.hasBom}`)
await evaluate(cdp, `window.__air.save()`)
await sleep(500)
const bomAfter = readFileSync(bomPath)
check(
  'BOM 保存保留',
  bomAfter[0] === 0xef && bomAfter[1] === 0xbb && bomAfter[2] === 0xbf,
  `head=${bomAfter.subarray(0, 4).toString('hex')}`,
)

// 5. CRLF：归一为 \n + meta 标记 + 保存回写
await evaluate(cdp, `window.__air.open(${JSON.stringify(crlfPath)})`)
await sleep(600)
const crlfState = await evaluate(
  cdp,
  `({ doc: window.__air.doc(), meta: window.__air.meta() })`,
)
check(
  'CRLF 检测与归一',
  crlfState.meta?.eol === 'crlf' && crlfState.doc === 'a\nb\n',
  `eol=${crlfState.meta?.eol} doc=${JSON.stringify(crlfState.doc)}`,
)
await evaluate(cdp, `window.__air.save()`)
await sleep(500)
const crlfAfter = readFileSync(crlfPath)
check(
  'CRLF 保存保真',
  crlfAfter.toString('binary') === 'a\r\nb\r\n',
  `bytes=${crlfAfter.toString('hex')}`,
)

// 6. 10MB 文件 spike（0.4 阈值：≤600ms 可编辑）
const bigMs = await evaluate(
  cdp,
  `(async () => { const t0 = performance.now(); await window.__air.open(${JSON.stringify(bigPath)}); return performance.now() - t0 })()`,
)
const bigDocLen = await evaluate(cdp, `window.__air.doc()?.length ?? 0`)
check('10MB 打开（≤600ms 可编辑）', bigMs < 600, `${bigMs.toFixed(0)}ms docLen=${bigDocLen}`)

// 7. 汇总 + 释放
const failed = results.filter((r) => !r.ok)
console.log(`\n=== P0 冒烟结果: ${results.length - failed.length}/${results.length} 通过 ===`)
if (failed.length > 0) {
  console.log('失败项:', failed.map((f) => f.name).join(' | '))
  process.exitCode = 1
}
cdp.close()

