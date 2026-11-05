// 分支菜单（P3-4）：切换/新建/删除分支，ahead/behind 显示。
import { useEffect, useState } from 'react'
import {
  gitBranches,
  gitBranchCreate,
  gitBranchDelete,
  gitCheckout,
  gitRemoteOp,
  type BranchInfo,
  type RemoteOp,
} from '@/ipc/git'
import { useUiStore } from '@/app/uiStore'

export function BranchMenu() {
  const root = useUiStore((s) => s.workspaceRoot)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    if (!root) return
    try {
      setBranches(await gitBranches(root))
    } catch {
      setBranches([])
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  // git 变更后刷新（提交/hunk 操作/命令条都会发）
  useEffect(() => {
    const h = () => void refresh()
    window.addEventListener('air:git-changed', h)
    return () => window.removeEventListener('air:git-changed', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  const current = branches.find((b) => b.isCurrent)

  const checkout = async (name: string) => {
    if (!root || busy) return
    setBusy(true)
    setError(null)
    try {
      await gitCheckout(root, name)
      await refresh()
      setOpen(false)
      window.dispatchEvent(new CustomEvent('air:git-changed'))
    } catch (e) {
      // git 拒绝（脏文件等）：原样展示 + 命令条入口提示（3.7.3）
      setError(
        `${e instanceof Error ? e.message : String(e)}\n\n可用 Git 命令条执行 stash 后重试。`,
      )
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    if (!root || !newName.trim()) return
    setBusy(true)
    try {
      await gitBranchCreate(root, newName.trim())
      setNewName('')
      setCreating(false)
      await refresh()
      window.dispatchEvent(new CustomEvent('air:git-changed'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (name: string) => {
    if (!root) return
    if (!window.confirm(`删除分支 ${name}？（未合并的提交需要强删）`)) return
    setBusy(true)
    try {
      await gitBranchDelete(root, name, false)
      await refresh()
      window.dispatchEvent(new CustomEvent('air:git-changed'))
    } catch (e) {
      // -d 失败 → 询问强删
      if (window.confirm(`安全删除失败：${e instanceof Error ? e.message : String(e)}\n\n强制删除（-D）？未合并的提交将丢失！`)) {
        try {
          await gitBranchDelete(root, name, true)
          await refresh()
          window.dispatchEvent(new CustomEvent('air:git-changed'))
        } catch (e2) {
          setError(e2 instanceof Error ? e2.message : String(e2))
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const remote = async (op: RemoteOp) => {
    if (!root) return
    setBusy(true)
    setError(null)
    const opId = `${op}-${Date.now().toString(36)}`
    try {
      const code = await gitRemoteOp(opId, root, op)
      if (code !== 0) {
        setError(`${op} 退出码 ${code}，详见输出面板`)
      }
      await refresh()
      window.dispatchEvent(new CustomEvent('air:git-changed'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!root) return null

  return (
    <div className="branch-menu">
      <button className="branch-current" onClick={() => setOpen((v) => !v)} disabled={busy}>
        <span className="branch-icon">⑂</span>
        {current?.name ?? 'HEAD'}
        {current?.upstream && <span className="branch-upstream"> → {current.upstream}</span>}
        <span className="branch-caret">▾</span>
      </button>

      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="context-menu branch-dropdown">
            <div className="menu-title">切换分支</div>
            {branches.map((b) => (
              <div key={b.name} className="menu-item branch-item">
                <span className="branch-item-name" onClick={() => void checkout(b.name)}>
                  {b.isCurrent ? '✓ ' : ''}
                  {b.name}
                </span>
                {!b.isCurrent && (
                  <button
                    className="branch-delete"
                    title={`删除 ${b.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      void remove(b.name)
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <div className="menu-sep" />
            {creating ? (
              <div className="branch-create-row">
                <input
                  className="menu-input"
                  autoFocus
                  placeholder="新分支名"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void create()
                    if (e.key === 'Escape') setCreating(false)
                  }}
                />
              </div>
            ) : (
              <button className="menu-item" onClick={() => setCreating(true)}>
                + 新建分支
              </button>
            )}
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => void remote('fetch')} disabled={busy}>
              ↻ fetch
            </button>
            <button className="menu-item" onClick={() => void remote('pull')} disabled={busy}>
              ↓ pull
            </button>
            <button className="menu-item" onClick={() => void remote('push')} disabled={busy}>
              ↑ push
            </button>
          </div>
        </>
      )}

      {error && <div className="branch-error">{error}</div>}
    </div>
  )
}

