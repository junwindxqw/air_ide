# P5-5：安装 / 卸载 / 残留 / 便携版自动化验收。
# 用法：powershell -ExecutionPolicy Bypass -File scripts\install\test-install.ps1 `
#         -InstallerPath "target\release\bundle\nsis\Air IDE_0.1.0_x64-setup.exe" `
#         -PortableZipPath "target\release\bundle\portable\Air IDE_0.1.0_x64-portable.zip"
param(
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [string]$PortableZipPath = ''
)

$ErrorActionPreference = 'Stop'

$installDir = Join-Path $env:LOCALAPPDATA 'Air IDE'
$startMenuLnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Air IDE.lnk'
$startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Air IDE'
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Air IDE.lnk'
$uninstKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Air IDE'
$manuKey = 'HKCU:\Software\airide'

$results = New-Object System.Collections.Generic.List[object]
function Add-Result([string]$name, [bool]$ok, [string]$detail) {
    $results.Add([pscustomobject]@{ Check = $name; Ok = $ok; Detail = $detail })
}
function Wait-Until([scriptblock]$probe, [int]$seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (& $probe) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return (& $probe)
}
function Stop-AirIde {
    Get-Process -Name 'air-ide' -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 500
}

if (Get-Process -Name 'air-ide' -ErrorAction SilentlyContinue) {
    throw '检测到 air-ide 正在运行，请先关闭再执行本脚本。'
}
if (-not (Test-Path $InstallerPath)) { throw "安装包不存在: $InstallerPath" }

Write-Host '== 1. 静默安装 (/S) ==' -ForegroundColor Cyan
$setup = Start-Process -FilePath $InstallerPath -ArgumentList '/S' -Wait -PassThru
Add-Result '安装器退出码' ($setup.ExitCode -eq 0) "exit=$($setup.ExitCode)"
$installed = Wait-Until { Test-Path (Join-Path $installDir 'air-ide.exe') } 30
Add-Result '安装目录与主程序' $installed $installDir
Add-Result '开始菜单快捷方式' (Test-Path $startMenuLnk) $startMenuLnk
Add-Result '桌面快捷方式' (Test-Path $desktopLnk) $desktopLnk
$keyExists = Test-Path $uninstKey
$keyValues = if ($keyExists) { Get-ItemProperty $uninstKey } else { $null }
Add-Result '卸载项注册表键' $keyExists $uninstKey
if ($keyExists) {
    Add-Result '卸载项 DisplayVersion' ($keyValues.DisplayVersion -eq '0.1.0') "$($keyValues.DisplayVersion)"
    Add-Result '卸载项 InstallLocation' ($keyValues.InstallLocation -eq "`"$installDir`"") "$($keyValues.InstallLocation)"
    Add-Result '卸载项 UninstallString' ($keyValues.UninstallString -eq "`"$installDir\uninstall.exe`"") "$($keyValues.UninstallString)"
}

Write-Host '== 2. 启动并检查窗口 ==' -ForegroundColor Cyan
$app = Start-Process -FilePath (Join-Path $installDir 'air-ide.exe') -PassThru
$windowOk = Wait-Until {
    $p = Get-Process -Id $app.Id -ErrorAction SilentlyContinue
    $p -and $p.MainWindowHandle -ne 0 -and $p.MainWindowTitle -ne ''
} 20
$proc = Get-Process -Id $app.Id -ErrorAction SilentlyContinue
Add-Result '进程存活' ([bool]$proc) "pid=$($app.Id)"
Add-Result '主窗口可创建' ([bool]$windowOk) ("title=" + $(if ($proc) { $proc.MainWindowTitle } else { '<exited>' }))
Add-Result '窗口响应' ([bool]($proc -and $proc.Responding)) ("responding=" + $(if ($proc) { $proc.Responding } else { '<exited>' }))
Stop-AirIde

Write-Host '== 3. 静默卸载 (/S) ==' -ForegroundColor Cyan
$uninstaller = Join-Path $installDir 'uninstall.exe'
if (-not (Test-Path $uninstaller)) { throw "卸载器不存在: $uninstaller" }
$un = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
Add-Result '卸载器退出码' ($un.ExitCode -eq 0) "exit=$($un.ExitCode)"
$dirGone = Wait-Until { -not (Test-Path $installDir) } 30
Add-Result '安装目录已删除' $dirGone $installDir
Add-Result '开始菜单快捷方式已删除' (-not (Test-Path $startMenuLnk)) $startMenuLnk
Add-Result '桌面快捷方式已删除' (-not (Test-Path $desktopLnk)) $desktopLnk
$uninstGone = Wait-Until { -not (Test-Path $uninstKey) } 20
Add-Result '卸载项注册表键已删除' $uninstGone $uninstKey
Add-Result '安装位置注册表键已删除' (-not (Test-Path $manuKey)) $manuKey

$appData = Join-Path $env:APPDATA 'com.airide.app'
$localAppData = Join-Path $env:LOCALAPPDATA 'com.airide.app'
Add-Result '用户数据目录保留（预期行为）' (Test-Path $appData) $appData
Add-Result '本地缓存目录保留（预期行为）' (Test-Path $localAppData) $localAppData

if ($PortableZipPath) {
    Write-Host '== 4. 便携版解压运行 ==' -ForegroundColor Cyan
    if (-not (Test-Path $PortableZipPath)) { throw "便携 zip 不存在: $PortableZipPath" }
    $portableDir = Join-Path ([System.IO.Path]::GetTempPath()) ("air-ide-portable-test-" + [guid]::NewGuid().ToString('N'))
    Expand-Archive -Path $PortableZipPath -DestinationPath $portableDir -Force
    $portableExe = Join-Path $portableDir 'Air IDE.exe'
    Add-Result '便携包内含主程序' (Test-Path $portableExe) $portableExe

    $pApp = Start-Process -FilePath $portableExe -PassThru
    $pWindow = Wait-Until {
        $p = Get-Process -Id $pApp.Id -ErrorAction SilentlyContinue
        $p -and $p.MainWindowHandle -ne 0 -and $p.MainWindowTitle -ne ''
    } 20
    $pProc = Get-Process -Id $pApp.Id -ErrorAction SilentlyContinue
    Add-Result '便携版进程存活' ([bool]$pProc) "pid=$($pApp.Id)"
    Add-Result '便携版主窗口可创建' ([bool]$pWindow) ("title=" + $(if ($pProc) { $pProc.MainWindowTitle } else { '<exited>' }))
    Add-Result '便携版未写卸载项' (-not (Test-Path $uninstKey)) $uninstKey
    Add-Result '便携版未写厂商注册表键' (-not (Test-Path $manuKey)) $manuKey
    Stop-AirIde
    Remove-Item $portableDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
$results | Format-Table -AutoSize
$failed = $results | Where-Object { -not $_.Ok }
Write-Host ("通过 {0}/{1}" -f ($results.Count - $failed.Count), $results.Count)
if ($failed) {
    $failed | Format-Table -AutoSize
    exit 1
}
exit 0
