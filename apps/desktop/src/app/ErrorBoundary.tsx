// 全局错误边界（P5-3）：渲染崩溃不白屏，给出崩溃 ID、日志目录与重载入口。
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logFrontend, newCrashId, openLogDir } from '@/ipc/logging'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  crashId: string | null
  logPath: string | null
  copied: boolean
}

const REPORT_WINDOW_MS = 60_000
const MAX_REPORTS_PER_WINDOW = 20

let windowStartedAt = 0
let reportsInWindow = 0

/** 限流：异常风暴时只保留前若干条，避免日志刷屏。 */
function shouldReport(): boolean {
  const now = Date.now()
  if (now - windowStartedAt >= REPORT_WINDOW_MS) {
    windowStartedAt = now
    reportsInWindow = 0
  }
  reportsInWindow += 1
  return reportsInWindow <= MAX_REPORTS_PER_WINDOW
}

/** 全局捕获：window.onerror 与 unhandledrejection（模块加载即生效）。 */
export function installGlobalErrorReporting(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (event) => {
    if (!shouldReport()) return
    const err = event.error instanceof Error ? event.error : null
    const message = event.message || err?.message || '未知脚本错误'
    const location = `${event.filename || '(unknown)'}:${event.lineno}:${event.colno}`
    void logFrontend('error', `window.onerror: ${message}`, `${location}\n${err?.stack ?? ''}`, newCrashId())
  })

  window.addEventListener('unhandledrejection', (event) => {
    if (!shouldReport()) return
    const reason = event.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? (reason.stack ?? '') : ''
    void logFrontend('error', `unhandledrejection: ${message}`, stack, newCrashId())
  })
}

installGlobalErrorReporting()

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, crashId: null, logPath: null, copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const crashId = newCrashId()
    this.setState({ crashId })
    console.error('ErrorBoundary 捕获:', error, info.componentStack)
    void logFrontend(
      'error',
      `React 渲染错误: ${error.message}`,
      `${info.componentStack ?? ''}\n${error.stack ?? ''}`,
      crashId,
    )
  }

  private async handleOpenLogs(): Promise<void> {
    try {
      this.setState({ logPath: await openLogDir() })
    } catch (e) {
      this.setState({ logPath: `打开失败：${e instanceof Error ? e.message : String(e)}` })
    }
  }

  private async handleCopy(): Promise<void> {
    const id = this.state.crashId
    if (!id) return
    try {
      await navigator.clipboard.writeText(id)
      this.setState({ copied: true })
    } catch {
      // 剪贴板不可用时保持可手动选择文本
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="error-boundary">
        <h1>Air IDE 遇到问题</h1>
        <p>界面渲染发生错误，你的文件与 Git 数据不受影响。</p>
        <pre className="error-boundary-detail">{this.state.error.message}</pre>
        <div className="error-boundary-actions">
          <button className="commit-btn primary" onClick={() => window.location.reload()}>
            重新加载
          </button>
          <button className="commit-btn" onClick={() => void this.handleOpenLogs()}>
            打开日志目录
          </button>
        </div>
        {this.state.crashId && (
          <div className="error-boundary-actions">
            <span className="error-boundary-hint">崩溃 ID：</span>
            <code className="error-boundary-hint" style={{ userSelect: 'text' }}>
              {this.state.crashId}
            </code>
            <button className="commit-btn" onClick={() => void this.handleCopy()}>
              {this.state.copied ? '已复制' : '复制'}
            </button>
          </div>
        )}
        {this.state.logPath && <span className="error-boundary-hint">日志目录：{this.state.logPath}</span>}
      </div>
    )
  }
}
