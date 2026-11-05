// 生成 1024x1024 源图标 PNG（纯 Node，无依赖）。
// 用法：node scripts/gen-icons.mjs apps/desktop/src-tauri/icons-src/air-1024.png
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// [[NEXT]]

// 7x8 "A" 点阵
const GLYPH = [
  '.XXXXX.',
  'XX...XX',
  'XX...XX',
  'XX...XX',
  'XXXXXXX',
  'XX...XX',
  'XX...XX',
  'XX...XX',
]

const W = 1024
const H = 1024
const CELL = 128 // 7*128=896 宽，8*128=1024 高，水平留 64px 边距

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function px(x, y) {
  // 判定像素属于 A 字形还是背景
  const gx = Math.floor((x - 64) / CELL)
  const gy = Math.floor(y / CELL)
  const inX = gx >= 0 && gx < 7
  const on = inX && gy >= 0 && gy < 8 && GLYPH[gy][gx] === 'X'
  return on ? [0x35, 0x74, 0xf0, 0xff] : [0x1e, 0x1f, 0x22, 0xff]
}

const out = process.argv[2]
if (!out) {
  console.error('usage: node scripts/gen-icons.mjs <out.png>')
  process.exit(1)
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
// 每行前缀 filter byte 0
const raw = Buffer.alloc(H * (1 + W * 4))
for (let y = 0; y < H; y++) {
  const rowStart = y * (1 + W * 4)
  raw[rowStart] = 0
  for (let x = 0; x < W; x++) {
    const [r, g, b, a] = px(x, y)
    const o = rowStart + 1 + x * 4
    raw[o] = r
    raw[o + 1] = g
    raw[o + 2] = b
    raw[o + 3] = a
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`written: ${out} (${png.length} bytes)`)

