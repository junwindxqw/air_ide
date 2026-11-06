// P5-7：设置页「更新」区块。展示当前版本、检查/下载/安装状态与失败原因。
import { useEffect, useState } from 'react'
import { progressPercent, useUpdaterStore } from '@/features/settings/updaterRuntime'

function formatTime(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function UpdaterPanel() {
  const phase = useUpdaterStore((s) => s.phase)
  const update = useUpdaterStore((s) => s.update)
  const progress = useUpdaterStore((s) => s.progress)
  const error = useUpdaterStore((s) => s.error)
  const lastCheckedAt = useUpdaterStore((s) => s.lastCheckedAt)
  const check = useUpdaterStore((s) => s.check)
  const downloadAndInstall = useUpdaterStore((s) => s.downloadAndInstall)
  const dismiss = useUpdaterStore((s) => s.dismiss)

  const [currentVersion, setCurrentVersion] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then((v) => {
        if (alive) setCurrentVersion(v)
      })
      .catch(() => {
        if (alive) setCurrentVersion(null)
      })
    return () => {
      alive = false
    }
  }, [])

  const percent = progressPercent(progress)
  const busy = phase === 'checking' || phase === 'downloading' || phase === 'installing' || phase === 'restarting'

  return (
    <div className="updater-panel">
      <div className="updater-line">
        <span>当前版本</span>
        <span className="updater-muted">{currentVersion ?? '未知（非桌面环境）'}</span>
      </div>

      {phase === 'checking' && <div className="updater-status">正在检查更新…</div>}

      {phase === 'up-to-date' && (
        <div className="updater-status ok">
          已是最新版本{lastCheckedAt ? `（${formatTime(lastCheckedAt)} 检查）` : ''}
        </div>
      )}

      {phase === 'available' && update && (
        <div className="updater-card">
          <div className="updater-card-title">发现新版本 {update.version}</div>
          {update.notes && <div className="updater-notes">{update.notes}</div>}
          <div className="updater-actions">
            <button className="external-btn primary" onClick={() => void downloadAndInstall()}>
              下载并安装
            </button>
            <button className="external-btn" onClick={() => void dismiss()}>
              稍后
            </button>
          </div>
        </div>
      )}

      {phase === 'downloading' && (
        <div className="updater-status">
          <div>
            正在下载 {update?.version ?? ''}
            {percent !== undefined ? ` ${percent}%` : ''}
          </div>
          {percent !== undefined && (
            <div className="updater-progress">
              <div className="updater-progress-fill" style={{ width: `${percent}%` }} />
            </div>
          )}
        </div>
      )}

      {phase === 'installing' && <div className="updater-status">校验通过，正在安装，应用即将重启…</div>}
      {phase === 'restarting' && <div className="updater-status">安装完成，正在重启…</div>}

      {phase === 'error' && error && (
        <div className="updater-card error">
          <div className="updater-card-title">{error.title}</div>
          <div className="updater-hint">{error.hint}</div>
          <div className="updater-raw">
            详情：{error.raw}
            {error.silent ? '（启动静默检查）' : ''}
          </div>
          <div className="updater-actions">
            {update && (
              <button className="external-btn primary" onClick={() => void downloadAndInstall()}>
                重试下载安装
              </button>
            )}
            <button className="external-btn" onClick={() => void check()}>
              重新检查
            </button>
          </div>
        </div>
      )}

      {(phase === 'idle' || phase === 'up-to-date') && (
        <div className="updater-actions">
          <button className="external-btn" onClick={() => void check()} disabled={busy}>
            检查更新
          </button>
        </div>
      )}
    </div>
  )
}
