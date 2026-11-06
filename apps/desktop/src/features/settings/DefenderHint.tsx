// Defender 提示（3.12.5 / P5-6）：只有 Defender 实时保护确实开启且目录未排除时才提示，
// 附加入排除项命令（必须用户确认后才执行，不静默改系统安全设置）。
import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { winIpc, type DefenderStatus } from '@/ipc/win'
import { useUiStore } from '@/app/uiStore'
import { useExplorerStore } from '@/features/explorer/store'
import { useSettingsStore } from '@/features/settings/settingsRuntime'

const HINT_DISMISSED_KEY = 'air.defenderHintDismissed'

export function DefenderHint() {
  const root = useUiStore((s) => s.workspaceRoot)
  const hintEnabled = useSettingsStore((s) => s.settings.system.defenderHint)
  const [fileCount, setFileCount] = useState(0)
  const [status, setStatus] = useState<DefenderStatus | null>(null)
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(HINT_DISMISSED_KEY) === '1',
  )
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const childCount = useExplorerStore((s) => s.children.get(s.root ?? '')?.length ?? 0)

  // 统计文件数（懒加载近似：根目录项数 + 已展开目录项数；>5000 才提示）
  useEffect(() => {
    if (!root) return
    let total = 0
    for (const entries of useExplorerStore.getState().children.values()) {
      total += entries.length
    }
    setFileCount(total)
  }, [root, childCount])

  // 真实状态：实时保护是否开启 / 是否已在排除项中
  useEffect(() => {
    setStatus(null)
    setResult(null)
    setFailed(false)
    if (!root) return
    let cancelled = false
    void winIpc
      .defenderStatus(root)
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch(() => {
        if (!cancelled) setStatus({ realtimeEnabled: null, excluded: null })
      })
    return () => {
      cancelled = true
    }
  }, [root])

  const realtimeOn = status?.realtimeEnabled === true
  const alreadyExcluded = status?.excluded === true

  // 状态未知（读不到注册表）也按「不可确认」处理，不打扰用户
  if (!root || !hintEnabled || dismissed) return null
  if (!realtimeOn || alreadyExcluded || fileCount < 5000) return null

  const addExclusion = async () => {
    setRunning(true)
    setResult(null)
    setFailed(false)
    try {
      // 经 Rust 执行 PowerShell（参数数组，不经 shell 拼接）
      await invoke('app_add_defender_exclusion', { path: root })
      setResult('已加入排除项（用户确认后执行）')
      setStatus(await winIpc.defenderStatus(root))
    } catch (e) {
      setFailed(true)
      setResult(`失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="defender-hint" role="status">
      <span>
        Windows Defender 实时保护已开启，项目文件较多（约 {fileCount} 项已列出），
        实时扫描可能让首次 status 变慢。可将本目录加入排除项：
      </span>
      <code className="defender-cmd">Add-MpPreference -ExclusionPath "{root}"</code>
      <button className="commit-btn" disabled={running} onClick={() => void addExclusion()}>
        {running ? '执行中…' : '加入排除项'}
      </button>
      <button
        className="commit-btn"
        onClick={() => {
          localStorage.setItem(HINT_DISMISSED_KEY, '1')
          setDismissed(true)
        }}
      >
        不再提示
      </button>
      {result && (
        <span className={failed ? 'defender-result error' : 'defender-result'}>{result}</span>
      )}
    </div>
  )
}
