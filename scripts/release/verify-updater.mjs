#!/usr/bin/env node
// P5-7：updater 验证脚本（Windows）。
//
// 模式 A（默认）：编译并运行 tests/updater_manifest.rs
//   用真实 tauri-plugin-updater 对本地静态服务器做 check/download，覆盖
//   有更新 / 无更新 / 签名错误 / 404 / 平台不匹配。
//   注意：tauri 的 test runtime 依赖 comctl32 v6，cargo 生成的测试 exe 没有清单，
//   直接运行会 0xc0000139；这里用 mt.exe 嵌入清单后再执行。
//
// 模式 B（--release-manifest <latest.json> --artifact <setup.exe> --sig <setup.exe.sig>）：
//   校验发布脚本产出的清单/签名与实际安装包是否匹配（minisign 同一实现）。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')
const isWin = process.platform === 'win32'
const cargo = isWin ? 'cargo.exe' : 'cargo'

function fail(message) {
  console.error(`\n[verify-updater] ${message}\n`)
  process.exit(1)
}

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

// ── 模式 B：发布产物验签 ──
if (args['release-manifest']) {
  const manifest = path.resolve(args['release-manifest'])
  const artifact = path.resolve(args.artifact ?? '')
  const sig = path.resolve(args.sig ?? '')
  for (const [name, file] of [['latest.json', manifest], ['artifact', artifact], ['sig', sig]]) {
    if (!file || !fs.existsSync(file)) fail(`缺少 ${name} 文件: ${file}`)
  }
  const result = spawnSync(
    cargo,
    ['test', '-p', 'air-ide', '--test', 'release_signature', '--', '--nocapture'],
    {
      cwd: repo,
      stdio: 'inherit',
      env: {
        ...process.env,
        AIR_IDE_VERIFY_MANIFEST: manifest,
        AIR_IDE_VERIFY_ARTIFACT: artifact,
        AIR_IDE_VERIFY_SIG: sig,
      },
    },
  )
  process.exit(result.status ?? 1)
}

// ── 模式 A：mock runtime 集成测试 ──
function findMt() {
  if (!isWin) return null
  const fromPath = spawnSync('where.exe', ['mt.exe'], { encoding: 'utf8' })
  if (fromPath.status === 0) {
    const first = fromPath.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0]
    if (first && fs.existsSync(first)) return first
  }
  const kits = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin'
  if (!fs.existsSync(kits)) return null
  const versions = fs
    .readdirSync(kits)
    .filter((d) => /^\d+\.\d+/.test(d))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .reverse()
  for (const v of versions) {
    for (const arch of ['x64', 'arm64', 'x86']) {
      const candidate = path.join(kits, v, arch, 'mt.exe')
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return null
}

const mt = findMt()
if (!mt) {
  fail('未找到 mt.exe（Windows SDK）。请安装 Windows 10/11 SDK 或设置 MT_EXE 环境变量后重试。')
}

console.log('[verify-updater] 编译 updater_manifest 测试…')
const build = spawnSync(
  cargo,
  ['test', '-p', 'air-ide', '--test', 'updater_manifest', '--no-run', '--message-format=json'],
  { cwd: repo, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
)
let testExe
for (const line of (build.stdout ?? '').split(/\r?\n/)) {
  if (!line.startsWith('{')) continue
  try {
    const msg = JSON.parse(line)
    if (msg.reason === 'compiler-artifact' && msg.target?.name === 'updater_manifest' && msg.executable) {
      testExe = msg.executable
    }
  } catch {
    // 忽略非 JSON 行
  }
}
if (!testExe) {
  console.error(build.stderr ?? '')
  fail('未找到 updater_manifest 测试可执行文件，编译可能失败。')
}

const manifestPath = path.join(repo, 'target', 'tmp', 'updater-test.manifest')
fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
fs.writeFileSync(
  manifestPath,
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*" />
    </dependentAssembly>
  </dependency>
</assembly>
`,
  'utf8',
)

console.log('[verify-updater] 嵌入 comctl32 v6 清单并运行测试…')
const embed = spawnSync(mt, ['-nologo', '-manifest', manifestPath, `-outputresource:${testExe};#1`], {
  encoding: 'utf8',
})
if (embed.status !== 0) fail(`mt.exe 嵌入清单失败: ${embed.stdout ?? ''}${embed.stderr ?? ''}`)

const run = spawnSync(testExe, ['--nocapture'], {
  cwd: repo,
  stdio: 'inherit',
  env: process.env,
})
process.exit(run.status ?? 1)
