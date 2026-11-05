# P0 基准采集（方案 5.3）：PowerShell 采集，结果追加到 bench-out/bench.jsonl。
# 测量前提必须标注：Defender 状态、电源状态、系统版本——三者没标的数据不可比。
param(
    [string]$OutDir = "D:\myProject\air_ide\bench-out",
    [string]$ExePath = "D:\myProject\air_ide\target\debug\air-ide.exe"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# ── 测量前提 ──
$defender = (Get-MpPreference -ErrorAction SilentlyContinue).DisableRealtimeMonitoring
$defenderState = if ($defender -eq $true) { "off" } else { "on" }
$power = (Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Measure-Object BatteryStatus -Average).Average
$powerState = if ($null -eq $power) { "desktop" } elseif ($power -eq 2) { "ac" } else { "battery" }
$os = (Get-CimInstance Win32_OperatingSystem)
$osVer = "$($os.Caption) build $($os.BuildNumber)"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

function Write-Bench($metric, $value, $unit, $detail) {
    $rec = [ordered]@{ metric = $metric; value = [math]::Round($value, 1); unit = $unit; ts = $stamp; detail = $detail; defender = $defenderState; power = $powerState; os = $osVer }
    $line = ($rec | ConvertTo-Json -Compress)
    Add-Content -Path (Join-Path $OutDir "bench.jsonl") -Value $line
    Write-Host "  $metric = $([math]::Round($value,1))$unit ($detail)"
}

# ── 冷启动（进程创建 → 前端可交互打点）──
# app 启动时前端 effect 会写 app_report_benchmark('cold_start_interactive_ms')；
# 这里取进程创建到该文件出现新记录的时间差。
$benchFile = Join-Path $env:LOCALAPPDATA "AirIDE\bench.jsonl"
$before = if (Test-Path $benchFile) { (Get-Content $benchFile | Measure-Object -Line).Lines } else { 0 }
$t0 = Get-Date
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
$proc = Start-Process -FilePath $ExePath -PassThru
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    $now = if (Test-Path $benchFile) { (Get-Content $benchFile | Measure-Object -Line).Lines } else { 0 }
    if ($now -gt $before) { break }
    Start-Sleep -Milliseconds 50
}
$cold = ((Get-Date) - $t0).TotalMilliseconds
Write-Bench "cold_start_process_to_interactive" $cold "ms" "含 WebView2 冷启（dev 模式）"

# 等前端稳定后采集内存（按父进程过滤，只算本 app 的 WebView2）
Start-Sleep -Seconds 3
$app = Get-Process -Id $proc.Id
$wv = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.ParentProcessId -eq $proc.Id }
$wvWs = ($wv | Measure-Object WorkingSetSize -Sum).Sum
if ($null -eq $wvWs) { $wvWs = 0 }
Write-Bench "idle_memory_total_mb" ([double](($app.WorkingSet64 + $wvWs) / 1MB)) "MB" "app + webview2 子进程（按父进程过滤）"

Write-Host "`n前提: Defender=$defenderState, 电源=$powerState, OS=$osVer"
Write-Host "输出: $OutDir\bench.jsonl"
