// P5-6「集成系统」开关：真实写入/清理 HKCU 注册表（右键菜单 + 文件关联候选）。
// 启动时不会自动注册，用户在这里手动启用/关闭；失败反馈区分权限拒绝（如取消 UAC）。
import { useEffect, useState } from 'react'
import { winIpc, describeIntegrationError, type ShellIntegrationStatus } from '@/ipc/win'

export function WindowsIntegration() {
  const [status, setStatus] = useState<ShellIntegrationStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const refresh = async () => {
    try {
      setStatus(await winIpc.status())
    } catch (e) {
      setMessage(`读取集成状态失败：${describeIntegrationError(e)}`)
      setFailed(true)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = async () => {
    if (!status || busy) return
    const enable = !status.registered
    setBusy(true)
    setMessage(null)
    setFailed(false)
    try {
      const next = await winIpc.setIntegration(enable)
      setStatus(next)
      setMessage(enable ? '已启用：文件夹右键菜单与文件关联候选已注册' : '已关闭系统集成')
    } catch (e) {
      setMessage(describeIntegrationError(e))
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-row-col">
      <label className="settings-row">
        <span>集成系统（文件夹右键 / 文件关联）</span>
        <input
          type="checkbox"
          checked={status?.registered ?? false}
          disabled={!status?.supported || busy}
          onChange={() => void toggle()}
        />
      </label>
      {!status?.supported && <p className="settings-hint">仅 Windows 支持该集成。</p>}
      {status?.supported && (
        <p className="settings-hint">
          启动时不会自动注册；开启后在资源管理器右键文件夹可用「用 Air IDE 打开」，
          文件关联仅加入「打开方式」候选，不抢占默认程序。
          {status.exePath ? ` 当前程序：${status.exePath}` : ''}
        </p>
      )}
      {busy && <p className="settings-hint">正在写入系统设置…</p>}
      {message && (
        <p className={failed ? 'settings-hint defender-result error' : 'settings-hint'}>
          {message}
        </p>
      )}
    </div>
  )
}
