# P5-5：把 release 产物打成便携版 zip。
# 便携版 = 解压即运行，不写注册表、不建快捷方式、不注册卸载项。
# 注意：配置/会话/日志仍写入 %APPDATA%\AirIDE 与 %LOCALAPPDATA%\AirIDE（与安装版共用）。
param(
    [string]$RepoRoot = '',
    [string]$TargetDir = ''
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}
if (-not $TargetDir) {
    $TargetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $RepoRoot 'target' }
}
$releaseDir = Join-Path $TargetDir 'release'
$exePath = Join-Path $releaseDir 'air-ide.exe'
if (-not (Test-Path $exePath)) {
    throw "未找到 $exePath，请先执行 pnpm build（tauri build）。"
}

$conf = Get-Content (Join-Path $RepoRoot 'apps\desktop\src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$version = $conf.version

$outDir = Join-Path $releaseDir 'bundle\portable'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$zipPath = Join-Path $outDir ("Air IDE_{0}_x64-portable.zip" -f $version)

$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("air-ide-portable-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
try {
    $stagedExe = Join-Path $stage 'Air IDE.exe'
    Copy-Item $exePath $stagedExe
    $readme = @"
Air IDE 便携版（v$version）

- 解压到任意目录，双击 "Air IDE.exe" 即可运行，无需安装。
- 不写注册表、不创建开始菜单/桌面快捷方式、不注册卸载项。
- 配置、会话与日志仍保存在 %APPDATA%\AirIDE 和 %LOCALAPPDATA%\AirIDE
  （与安装版共用）；要彻底清理请手动删除这两个目录。
- 依赖系统 WebView2 Runtime：若启动提示缺失，请先联网安装 Microsoft Edge WebView2 Runtime。
  便携版本身不会自动联网安装 WebView2。
- 升级：退出后解压新版本覆盖 exe 即可。
- 产物未签名：首次运行如遇 SmartScreen，选择「更多信息 -> 仍要运行」。
"@
    Set-Content -Path (Join-Path $stage '便携版说明.txt') -Value $readme -Encoding UTF8

    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
}
finally {
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}

$zipSize = (Get-Item $zipPath).Length
$exeSize = (Get-Item $exePath).Length
Write-Host ("便携版: {0}" -f $zipPath)
Write-Host ("  体积: {0:N2} MB（exe {1:N2} MB）" -f ($zipSize / 1MB), ($exeSize / 1MB))
