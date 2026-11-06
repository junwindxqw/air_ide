#!/usr/bin/env node
// P5-7：本地更新源（静态服务器），用于验证 updater 的四种清单响应。
//
// 用法：
//   node scripts/release/local-update-server.mjs --dir target/local-update --port 8712 --mode ok
//   --mode ok | no-update | bad-signature | 404
//   --current-version 0.1.0   （no-update 模式用当前版本伪造清单）
//
// 日志会打印每个请求（时间、方法、路径、User-Agent），便于确认客户端行为。
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const [key, inline] = token.slice(2).split('=')
    args[key] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const dir = path.resolve(args.dir ?? 'target/local-update')
const port = Number(args.port ?? 8712)
const mode = args.mode ?? 'ok'
const currentVersion = args['current-version'] ?? '0.1.0'
const manifestFile = path.join(dir, 'latest.json')

function log(message) {
  console.log(`[server ${new Date().toISOString()}] ${message}`)
}

function readManifest() {
  const raw = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  if (mode === 'no-update') raw.version = currentVersion
  if (mode === 'bad-signature') {
    for (const platform of Object.values(raw.platforms)) {
      const sig = platform.signature
      const idx = Math.floor(sig.length / 2)
      platform.signature = `${sig.slice(0, idx)}${sig[idx] === 'A' ? 'B' : 'A'}${sig.slice(idx + 1)}`
    }
  }
  return JSON.stringify(raw)
}

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  log(`${req.method} ${pathname} UA=${req.headers['user-agent'] ?? '-'}`)

  if (pathname === '/latest.json') {
    if (mode === '404') {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('404 not found')
      return
    }
    try {
      const body = readManifest()
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(body)
    } catch (e) {
      log(`读取清单失败: ${e}`)
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('manifest error')
    }
    return
  }

  const file = path.join(dir, pathname.replace(/^\//, ''))
  if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('404 not found')
    return
  }
  const body = fs.readFileSync(file)
  res.writeHead(200, {
    'content-type': pathname.endsWith('.json') ? 'application/json' : 'application/octet-stream',
    'content-length': String(body.length),
  })
  res.end(body)
  log(`200 ${pathname} (${body.length} bytes)`)
})

server.listen(port, '127.0.0.1', () => {
  log(`更新源已启动 http://127.0.0.1:${port}/latest.json  dir=${dir} mode=${mode}`)
})
