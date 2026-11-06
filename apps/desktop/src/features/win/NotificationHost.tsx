// 系统通知不可用时的应用内提示（右下角浮层）。
import { useNotificationStore } from './notifyStore'

export function NotificationHost() {
  const messages = useNotificationStore((s) => s.messages)
  const dismiss = useNotificationStore((s) => s.dismiss)
  if (messages.length === 0) return null

  return (
    <div className="notify-host" role="status" aria-live="polite">
      {messages.map((m, i) => (
        <div key={`${m.scene ?? 'notice'}-${i}`} className={`notify-item ${m.level}`}>
          <div className="notify-title">{m.title}</div>
          <div className="notify-body">{m.body}</div>
          <button className="diff-close" onClick={() => dismiss(i)} aria-label="关闭提示">
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
