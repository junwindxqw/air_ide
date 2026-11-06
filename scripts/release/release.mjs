#!/usr/bin/env node
// P5-7：一条命令产出「签名安装包 + .sig + latest.json + release-manifest.json」。
//
// 用法（仓库根目录）：
//   node scripts/release/release.mjs                 # 构建 + 签名 + 生成清单
//   node scripts/release/release.mjs --skip-build    # 用已有产物（仍会签名并生成清单）
//   node scripts/release/release.mjs --base-url https://example.com/releases/v0.2.0
//   node scripts/release/release.mjs --publish       # 用 gh 创建/上传 GitHub Release
//
// 签名私钥（绝不入库）按以下顺序解析：
//   1) TAURI_SIGNING_PRIVATE_KEY（内容或文件路径）
//   2) --key <path>
//   3) AIR_IDE_UPDATER_KEY_PATH / TAURI_SIGNING_PRIVATE_KEY_PATH
//   4) ~/.air-ide/air-ide-updater.key
// 缺失时直接报错退出：不产出无签名清单，避免把未签名产物冒充成可更新包。
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const isWin = process.platform === 'win32'
const desktopDir = path.join(repo, 'apps', 'desktop')
const tauriCli = path.join(desktopDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
// 跟随 CARGO_TARGET_DIR（相对路径按仓库根解析），避免与其它会话的构建目录互相踩。
const targetDir = path.resolve(repo, process.env.CARGO_TARGET_DIR || 'target')

function fail(message) {
  console.error(`\n[release] 错误：${message}\n`)
  process.exit(1)
}

function run(command, args, env = process.env, cwd = repo) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env })
  if (result.error) fail(`无法执行 ${command}: ${result.error.message}`)
  if (result.status !== 0) fail(`${command} ${args.join(' ')} 退出码 ${result.status}`)
}

/** 直接用 node 跑 Tauri CLI，绕开 Windows 上 .cmd 的 spawn 限制。 */
function runTauri(args, env = process.env) {
  run(process.execPath, [tauriCli, ...args], env, desktopDir)
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
const configPath = path.join(repo, 'apps/desktop/src-tauri/tauri.conf.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const version = config.version
const updaterConfig = config.plugins?.updater ?? {}

function resolveSigningKey() {
  const envKey = process.env.TAURI_SIGNING_PRIVATE_KEY
  if (envKey && envKey.trim()) {
    const value = envKey.trim()
    return { value, path: fs.existsSync(value) ? value : null }
  }
  const candidates = [
    args.key,
    process.env.AIR_IDE_UPDATER_KEY_PATH,
    process.env.TAURI_SIGNING_PRIVATE_KEY_PATH,
    path.join(os.homedir(), '.air-ide', 'air-ide-updater.key'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { value: candidate, path: candidate }
  }
  fail(
    [
      '未找到 updater 签名私钥，拒绝生成未签名清单。',
      '先生成密钥（放在仓库外，不要提交）：',
      '  pnpm --filter desktop exec tauri signer generate -w "%USERPROFILE%\\.air-ide\\air-ide-updater.key"',
      '然后任选其一注入：',
      '  $env:TAURI_SIGNING_PRIVATE_KEY = "<私钥内容或文件路径>"',
      '  $env:AIR_IDE_UPDATER_KEY_PATH = "D:\\keys\\air-ide-updater.key"',
      '  node scripts/release/release.mjs --key D:\\keys\\air-ide-updater.key',
      '公钥需与 tauri.conf.json 的 plugins.updater.pubkey 一致。',
    ].join('\n'),
  )
}

const key = resolveSigningKey()
const buildEnv = { ...process.env }
// tauri build 只认 TAURI_SIGNING_PRIVATE_KEY（内容）；同时传入路径形式会被当成 base64 非法内容。
buildEnv.TAURI_SIGNING_PRIVATE_KEY = key.path ? fs.readFileSync(key.path, 'utf8').trim() : key.value
delete buildEnv.TAURI_SIGNING_PRIVATE_KEY_PATH

console.log(`[release] 版本 ${version}，签名私钥来源：${key.path ?? 'TAURI_SIGNING_PRIVATE_KEY（内容）'}`)
console.log(`[release] 构建产物目录：${targetDir}`)

function decodeBase64Text(s) {
  const clean = s.replace(/\s/g, '').replace(/=/g, '')
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  let buffer = 0
  let bits = 0
  for (const ch of clean) {
    const idx = table.indexOf(ch)
    if (idx < 0) fail('签名不是合法的 base64')
    buffer = (buffer << 6) | idx
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out += String.fromCharCode((buffer >> bits) & 0xff)
    }
  }
  return out
}

function ensureSignature(file) {
  const sigPath = `${file}.sig`
  const stale =
    !fs.existsSync(sigPath) ||
    fs.statSync(sigPath).mtimeMs < fs.statSync(file).mtimeMs ||
    fs.statSync(sigPath).size === 0
  if (stale) {
    console.log(`[release] 签名 ${path.basename(file)}`)
    runTauri(['signer', 'sign', '--app-version', version, file], buildEnv)
  }
  if (!fs.existsSync(sigPath) || fs.statSync(sigPath).size === 0) {
    fail(`签名失败：${sigPath} 不存在或为空，不能生成可更新清单`)
  }
  const signature = fs.readFileSync(sigPath, 'utf8').trim()
  const decoded = decodeBase64Text(signature)
  if (updaterConfig.requireSignedVersion && !decoded.includes(`version:${version}`)) {
    fail(
      `签名未绑定版本 ${version}（requireSignedVersion=true）。` +
        `请确认使用 --app-version ${version} 重新签名，不要用旧签名冒充新版本。`,
    )
  }
  return signature
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function findArtifact(dir, pattern) {
  if (!fs.existsSync(dir)) return null
  const matches = fs
    .readdirSync(dir)
    .filter((name) => pattern.test(name) && !name.endsWith('.sig'))
  const withVersion = matches.filter((name) => name.includes(`_${version}_`))
  if (withVersion[0]) return path.join(dir, withVersion[0])
  return matches[0] ? path.join(dir, matches[0]) : null
}

// 1) 构建（含前端构建，tauri build 会执行 beforeBuildCommand）
if (!args['skip-build']) {
  console.log('[release] 构建 NSIS 安装包（tauri build）…')
  runTauri(['build'], buildEnv)
} else {
  console.log(`[release] 跳过构建，使用 ${path.join(targetDir, 'release')} 下已有产物`)
}

// 2) 收集产物
const bundleDir = path.join(targetDir, 'release', 'bundle')
let installer = findArtifact(path.join(bundleDir, 'nsis'), /_x64-setup\.exe$/)
if (!installer) fail(`未找到 NSIS 安装包（${bundleDir}\\nsis），请先构建或去掉 --skip-build`)

let portable = findArtifact(path.join(bundleDir, 'portable'), /_x64-portable\.zip$/)
if (!portable && !args['skip-portable']) {
  console.log('[release] 未找到便携 zip，调用 scripts/install/make-portable.ps1 生成…')
  run(
    isWin ? 'powershell.exe' : 'pwsh',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(repo, 'scripts/install/make-portable.ps1'),
      '-TargetDir',
      targetDir,
    ],
    buildEnv,
  )
  portable = findArtifact(path.join(bundleDir, 'portable'), /_x64-portable\.zip$/)
}

// 3) 签名（安装包必须有 .sig；便携 zip 也签名，便于人工核对）
const installerSig = ensureSignature(installer)
const portableSig = portable ? ensureSignature(portable) : null
if (!portable) {
  console.warn('[release] 警告：没有便携 zip，release-manifest.json 只包含 NSIS 安装包')
}

// 4) GitHub Releases 资产 URL（默认由 updater endpoint 推导）
const endpoint = updaterConfig.endpoints?.[0] ?? ''
const baseUrl =
  args['base-url'] ??
  (() => {
    const match = endpoint.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/releases\/latest\/download\//)
    if (match) return `${match[1]}/releases/download/v${version}`
    return endpoint ? endpoint.replace(/\/latest\.json$/, '') : `https://example.invalid/v${version}`
  })()

const assetUrl = (file) => `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(path.basename(file))}`

const notes =
  (args['notes-file'] && fs.readFileSync(path.resolve(args['notes-file']), 'utf8').trim()) ||
  (typeof args.notes === 'string' ? args.notes : `Air IDE v${version}`)

const pubDate = new Date().toISOString()
const latest = {
  version,
  notes,
  pub_date: pubDate,
  platforms: {
    // 安装版（NSIS）走的条目
    'windows-x86_64-nsis': {
      url: assetUrl(installer),
      signature: installerSig,
    },
    // 非 NSIS 安装类型的兜底条目：同样指向安装包，避免便携版误拿 zip
    'windows-x86_64': {
      url: assetUrl(installer),
      signature: installerSig,
    },
  },
}

const releaseManifest = {
  version,
  pub_date: pubDate,
  notes,
  base_url: baseUrl,
  assets: [
    {
      type: 'nsis',
      name: path.basename(installer),
      url: assetUrl(installer),
      size: fs.statSync(installer).size,
      sha256: sha256(installer),
      signature: installerSig,
    },
    ...(portable
      ? [
          {
            type: 'portable',
            name: path.basename(portable),
            url: assetUrl(portable),
            size: fs.statSync(portable).size,
            sha256: sha256(portable),
            signature: portableSig,
          },
        ]
      : []),
  ],
}

const outDir = path.resolve(args.out ?? path.join(targetDir, 'release', 'updater', `v${version}`))
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`, 'utf8')
fs.writeFileSync(
  path.join(outDir, 'release-manifest.json'),
  `${JSON.stringify(releaseManifest, null, 2)}\n`,
  'utf8',
)

console.log(`\n[release] 完成，上传资产：`)
for (const asset of releaseManifest.assets) {
  console.log(`  - ${asset.name}  (${asset.size} bytes, sha256 ${asset.sha256})`)
  console.log(`    ${asset.url}`)
}
console.log(`  - latest.json → ${assetUrl(path.join(outDir, 'latest.json'))}`)
console.log(`  - release-manifest.json → ${assetUrl(path.join(outDir, 'release-manifest.json'))}`)
console.log(`\n本地清单：${outDir}`)

// 5) 可选：发布到 GitHub Releases
if (args.publish) {
  const tag = `v${version}`
  console.log(`[release] 通过 gh 发布 ${tag}…`)
  const view = spawnSync('gh', ['release', 'view', tag], { cwd: repo, stdio: 'ignore' })
  if (view.status !== 0) {
    run('gh', ['release', 'create', tag, '--title', `Air IDE ${tag}`, '--notes', notes])
  }
  run('gh', [
    'release',
    'upload',
    tag,
    installer,
    `${installer}.sig`,
    path.join(outDir, 'latest.json'),
    path.join(outDir, 'release-manifest.json'),
    ...(portable ? [portable, `${portable}.sig`] : []),
    '--clobber',
  ])
  console.log(`[release] 已上传到 GitHub Release ${tag}`)
}

console.log('\n[release] 校验清单与签名：')
console.log(
  `  node scripts/release/verify-updater.mjs --release-manifest ${JSON.stringify(
    path.join(outDir, 'latest.json'),
  )} --artifact ${JSON.stringify(installer)} --sig ${JSON.stringify(`${installer}.sig`)}`,
)
