// 首次启动引导（P5-4）：欢迎页 + 三步引导（打开项目 / 快捷键 / 语言服务器）。
// 引导状态持久化在 localStorage；跳过后不再自动展示。
import { useCallback, useEffect, useState } from 'react'
import { recentProjects, session as sessionIpc } from '@/ipc/session'
import { lspInstallServer, lspServersScan, type ServerInfo } from '@/ipc/lsp'
import { normalizeError } from '@/ipc/invoke'
import { openWorkspace } from '@/features/command/commands'
import { useOverlayStore } from '@/app/overlayStore'
import { isOnboardingDone, markOnboardingDone } from '@/features/onboarding/onboarding'
import '@/features/onboarding/onboarding.css'

/** 是否显示欢迎页：无工作区根 + 无历史会话时显示。 */
export function useShowWelcome(): boolean {
  const [show, setShow] = useState(false)
  useEffect(() => {
    void (async () => {
      const s = await sessionIpc.load()
      setShow(!s.workspaceRoot)
    })()
  }, [])
  return show
}

const STEP_TITLES = ['打开一个项目文件夹', '快捷键与命令面板', '语言服务器（可选）']

// 只列已在 App.tsx / commands.ts 注册的键位，避免文档与实现漂移。
const SHORTCUTS: Array<[string, string]> = [
  ['命令面板', 'Ctrl+Shift+A'],
  ['快速打开文件', 'Ctrl+Shift+N'],
  ['全局搜索', 'Ctrl+Shift+F'],
  ['Git 工具窗', 'Alt+9'],
  ['提交（聚焦提交框）', 'Ctrl+K'],
  ['设置', 'Ctrl+Alt+S'],
]

export function WelcomePage({ onDismiss }: { onDismiss: () => void }) {
  const [recent, setRecent] = useState<string[]>([])
  const [guideDone, setGuideDone] = useState(isOnboardingDone)
  const [step, setStep] = useState(0)

  useEffect(() => {
    void recentProjects.list().then(setRecent)
  }, [])

  const finishGuide = () => {
    markOnboardingDone()
    setGuideDone(true)
  }

  const openFolder = async () => {
    const path = await pickFolder()
    if (path) {
      finishGuide()
      await openWorkspace(path)
      onDismiss()
    }
  }

  return (
    <div className="welcome-page">
      <div className="welcome-card onb-card">
        <h1 className="welcome-title">Air IDE</h1>
        <p className="welcome-sub">读代码 · 看 Diff · 跑 Git —— 给「AI 写代码、人来审阅」的工作流</p>

        {!guideDone ? (
          <>
            <div className="onb-progress">
              {STEP_TITLES.map((title, i) => (
                <span key={title} className={`onb-dot${i <= step ? ' on' : ''}`} aria-hidden="true" />
              ))}
              <span className="onb-step-label">
                第 {step + 1} / {STEP_TITLES.length} 步
              </span>
            </div>
            <h2 className="onb-title">{STEP_TITLES[step]}</h2>

            {step === 0 && (
              <>
                <p className="onb-text">
                  选择一个文件夹作为工作区：Air IDE 会为它建立文件监听、Git 状态和语言服务器会话。
                </p>
                <button
                  className="commit-btn primary welcome-open"
                  onClick={() => void openFolder()}
                >
                  打开文件夹…
                </button>
              </>
            )}

            {step === 1 && (
              <>
                <p className="onb-text">
                  命令面板能搜索并执行全部命令，下面是最常用的键位（JetBrains 风格）。
                </p>
                <div className="onb-shortcuts">
                  {SHORTCUTS.map(([label, key]) => (
                    <div className="onb-shortcut" key={label}>
                      <span>{label}</span>
                      <code className="onb-key">{key}</code>
                    </div>
                  ))}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <p className="onb-text">
                  语言服务器提供补全、跳转与诊断；未安装时自动降级为语法模式（高亮、折叠仍可用）。
                </p>
                <LspStatus />
              </>
            )}

            <div className="onb-footer">
              <button className="commit-btn" onClick={finishGuide}>
                跳过引导
              </button>
              <span className="onb-spacer" />
              {step > 0 && (
                <button className="commit-btn" onClick={() => setStep(step - 1)}>
                  上一步
                </button>
              )}
              {step < STEP_TITLES.length - 1 ? (
                <button className="commit-btn primary" onClick={() => setStep(step + 1)}>
                  下一步
                </button>
              ) : (
                <button className="commit-btn primary" onClick={finishGuide}>
                  开始使用
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="welcome-actions">
              <button
                className="commit-btn primary welcome-open"
                onClick={() => void openFolder()}
              >
                打开文件夹…
              </button>
            </div>

            {recent.length > 0 && (
              <div className="welcome-recent">
                <div className="welcome-section-title">最近项目</div>
                {recent.slice(0, 5).map((p) => (
                  <button
                    key={p}
                    className="welcome-recent-item"
                    onClick={async () => {
                      await openWorkspace(p)
                      onDismiss()
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}

            <LspStatus compact />

            <div className="welcome-footer">
              <button className="commit-btn" onClick={onDismiss}>
                继续（不打开项目）
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── 语言服务器状态（真实探测，不假设后端可用） ──

type ScanState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; servers: ServerInfo[] }

function LspStatus({ compact = false }: { compact?: boolean }) {
  const [scan, setScan] = useState<ScanState>({ kind: 'loading' })
  const [installing, setInstalling] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const openServerPanel = useOverlayStore((s) => s.openServerPanel)

  const refresh = useCallback(async () => {
    setScan({ kind: 'loading' })
    try {
      setScan({ kind: 'ready', servers: await lspServersScan() })
    } catch (e) {
      setScan({ kind: 'error', message: normalizeError(e).message })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (scan.kind === 'loading') {
    return compact ? null : <div className="onb-text">正在检测语言服务器…</div>
  }

  if (scan.kind === 'error') {
    return (
      <div className="onb-notice onb-notice-error" role="alert">
        无法读取语言服务器状态：{scan.message}
        <div className="onb-actions">
          <button className="commit-btn" onClick={() => void refresh()}>
            重新检测
          </button>
          <button className="commit-btn" onClick={openServerPanel}>
            打开语言服务器管理
          </button>
        </div>
      </div>
    )
  }

  const missing = scan.servers.filter((s) => !s.installed)

  if (compact) {
    if (missing.length === 0) return null
    return (
      <div className="welcome-servers">
        <div className="welcome-section-title">语言服务器未安装（{missing.length}）</div>
        <div className="welcome-hint">
          未安装时编辑器降级为语法模式。可在命令面板搜「语言服务器管理」查看安装方式。
        </div>
        <div className="onb-actions">
          <button className="commit-btn" onClick={openServerPanel}>
            查看安装入口
          </button>
        </div>
      </div>
    )
  }

  const installPhp = async () => {
    setInstalling(true)
    setNotice(null)
    try {
      const path = await lspInstallServer('php')
      setNotice({ kind: 'ok', text: `PHPantom 已安装到 ${path}，重新打开 PHP 文件即可启用。` })
      await refresh()
    } catch (e) {
      // 下载源/校验/解压都可能失败：展示后端原文，并给手动兜底路径
      setNotice({
        kind: 'error',
        text:
          `安装失败：${normalizeError(e).message}。` +
          '可稍后重试，或手动下载后放入 %LOCALAPPDATA%\\AirIDE\\servers\\ 目录，再点「重新检测」。',
      })
    } finally {
      setInstalling(false)
    }
  }

  return (
    <>
      {missing.length > 0 ? (
        <div className="onb-lsp-list">
          {missing.map((s) => (
            <div className="onb-lsp-row" key={s.language}>
              <div className="onb-lsp-name">{s.displayName}</div>
              <div className="onb-lsp-hint">{s.installHint}</div>
              {s.language === 'php' && (
                <div className="onb-actions">
                  <button
                    className="commit-btn primary"
                    disabled={installing}
                    onClick={() => void installPhp()}
                  >
                    {installing ? '下载中…' : '一键下载 PHPantom'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="onb-notice onb-notice-ok">
          已安装全部 {scan.servers.length} 个语言服务器，可直接编辑对应类型的文件。
        </div>
      )}

      {notice && (
        <div
          className={`onb-notice ${notice.kind === 'ok' ? 'onb-notice-ok' : 'onb-notice-error'}`}
          role="status"
        >
          {notice.text}
        </div>
      )}

      <div className="onb-actions">
        <button className="commit-btn" onClick={() => void refresh()}>
          重新检测
        </button>
        <button className="commit-btn" onClick={openServerPanel}>
          打开语言服务器管理
        </button>
      </div>
    </>
  )
}

/** 选文件夹（经命令面板已有的打开对话框命令）。 */
async function pickFolder(): Promise<string | null> {
  const { appOpenDialog } = await import('@/ipc/fs')
  return appOpenDialog('folder')
}
