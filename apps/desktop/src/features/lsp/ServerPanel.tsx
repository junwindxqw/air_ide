// 语言服务器管理面板（2.6）：探测结果 / 安装引导 / 停止重启 / 手动指定路径。
import { useEffect, useState } from 'react'
import { lspServersScan, lspInstallServer, lspStop, type ServerInfo } from '@/ipc/lsp'
import { getPoolSnapshot, subscribePool } from '@/features/lsp/pool'

export function ServerPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [servers, setServers] = useState<ServerInfo[]>([])
  const [installing, setInstalling] = useState<string | null>(null)
  const [installMsg, setInstallMsg] = useState<string | null>(null)
  const [, forceRender] = useState(0)

  const refresh = async () => {
    setServers(await lspServersScan())
    forceRender((n) => n + 1)
  }

  useEffect(() => {
    if (!open) return
    void refresh()
    const unsub = subscribePool(() => forceRender((n) => n + 1))
    return unsub
  }, [open])

  if (!open) return null

  const pool = getPoolSnapshot()
  const stateOf = (lang: string) => pool.find((p) => p.language === lang)?.state ?? 'stopped'

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="settings-page" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span>语言服务器</span>
          <button className="diff-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="settings-body">
          {servers.map((s) => {
            const state = stateOf(s.language)
            return (
              <div key={s.language} className="server-row">
                <div className="server-info">
                  <span className="server-name">{s.displayName}</span>
                  <span className={`server-badge ${s.installed ? 'ok' : 'missing'}`}>
                    {s.installed ? '已安装' : '未安装'}
                  </span>
                  {state !== 'stopped' && (
                    <span className={`server-badge state-${state}`}>
                      {state === 'running' ? '运行中' : state === 'starting' ? '启动中' : '已停止'}
                    </span>
                  )}
                </div>
                {s.installed ? (
                  <>
                    <div className="server-path" title={s.path ?? ''}>
                      {s.path}
                    </div>
                    <div className="server-actions">
                      <button
                        className="commit-btn"
                        onClick={async () => {
                          await lspStop(s.language)
                          await refresh()
                        }}
                        disabled={state === 'stopped'}
                      >
                        停止
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="server-hint">{s.installHint}</div>
                )}
                {!s.installed && s.language === 'php' && (
                  <div className="server-actions">
                    <button
                      className="commit-btn primary"
                      disabled={installing !== null}
                      onClick={async () => {
                        setInstalling(s.language)
                        setInstallMsg(null)
                        try {
                          const path = await lspInstallServer(s.language)
                          setInstallMsg(`已安装到 ${path}`)
                          await refresh()
                        } catch (e) {
                          setInstallMsg(
                            `下载失败: ${e instanceof Error ? e.message : String(e)}`,
                          )
                        } finally {
                          setInstalling(null)
                        }
                      }}
                    >
                      {installing === s.language ? '下载中…' : '一键下载'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          <div className="server-note">
            提示：未安装服务器时编辑器自动降级为语法模式（高亮/折叠/大纲仍可用）。
            PHP 服务器（PHPantom）可一键下载；其余语言请按上述提示的渠道手动安装，
            安装后点「刷新」重新探测。
            {installMsg && <div className="server-install-msg">{installMsg}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

