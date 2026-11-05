// Changes 面板（P1-10 最小 diff）：status 列表 + 双击开只读 unified diff。
// P3 才加 stage 复选框与 hunk 操作（方案 4 / Phase 3）。
import { useEffect, useMemo, useCallback, useState } from 'react'
import { gitStatus, gitStageFile, gitUnstageFile, type RepoStatus } from '@/ipc/git'
import { useUiStore } from '@/app/uiStore'
import { useDiffOverlay } from '@/features/git/openDiff'

export function ChangesPanel() {
  const root = useUiStore((s) => s.workspaceRoot)
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const openDiff = useDiffOverlay((s) => s.open)

  const refresh = useCallback(async () => {
    if (!root) {
      setStatus(null)
      return
    }
    try {
      const s = await gitStatus(root)
      setStatus(s)
      setError(null)
    } catch (e) {
      // 非 Git 仓库：显示空态（3.6），不报错轰炸
      setStatus(null)
      setError(e instanceof Error && e.message.includes('非 Git') ? null : String(e))
    }
  }, [root])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // git 变更广播（提交/hunk 操作/命令条/外部改动）
  useEffect(() => {
    const h = () => void refresh()
    window.addEventListener('air:git-changed', h)
    return () => window.removeEventListener('air:git-changed', h)
  }, [refresh])

  const allEntries = useMemo(() => {
    if (!status) return []
    return [
      ...status.conflicted.map((e) => ({ ...e, group: '冲突' })),
      ...status.staged.map((e) => ({ ...e, group: '已暂存' })),
      ...status.unstaged.map((e) => ({ ...e, group: '未暂存' })),
      ...status.untracked.map((e) => ({ ...e, group: '未跟踪' })),
    ]
  }, [status])

  if (!root) return <div className="changes-empty">打开文件夹后显示改动</div>
  if (error) return <div className="changes-empty">{error}</div>
  if (!status) return <div className="changes-empty">非 Git 仓库</div>

  /** 复选框：勾选 = stage，取消 = unstage（3.7.1）。 */
  const toggleStage = async (path: string, currentlyStaged: boolean) => {
    try {
      if (currentlyStaged) {
        await gitUnstageFile(root, path)
      } else {
        await gitStageFile(root, path)
      }
      await refresh()
      window.dispatchEvent(new CustomEvent('air:git-changed'))
    } catch (e) {
      console.error('stage 操作失败', e)
    }
  }

  return (
    <div className="changes-panel">
      <div className="changes-header">
        <span className="changes-branch" title={status.upstream ?? undefined}>
          {status.branch}
          {status.ahead > 0 && <span className="changes-ahead"> ↑{status.ahead}</span>}
          {status.behind > 0 && <span className="changes-behind"> ↓{status.behind}</span>}
        </span>
        <button className="changes-refresh" onClick={() => void refresh()} aria-label="刷新">
          ↻
        </button>
      </div>

      {allEntries.length === 0 && <div className="changes-empty">没有改动</div>}

      {(['冲突', '未暂存', '未跟踪', '已暂存'] as const).map((group) => {
        const entries = allEntries.filter((e) => e.group === group)
        if (entries.length === 0) return null
        return (
          <div key={group} className="changes-group">
            <div className="changes-group-title">
              {group} ({entries.length})
            </div>
            {entries.map((e) => {
              const staged = group === '已暂存'
              const conflicted = group === '冲突'
              return (
                <div
                  key={`${group}-${e.path}`}
                  className="changes-row"
                  onDoubleClick={() => void openDiff(e.path)}
                  title={`${e.path}（双击查看 diff）`}
                >
                  {!conflicted && (
                    <input
                      type="checkbox"
                      className="changes-check"
                      checked={staged}
                      onChange={() => void toggleStage(e.path, staged)}
                      onClick={(ev) => ev.stopPropagation()}
                      title={staged ? '取消暂存' : '暂存此文件'}
                    />
                  )}
                  <span className={`changes-kind kind-${e.kind}`}>
                    {e.kind[0].toUpperCase()}
                  </span>
                  <span className="changes-path">{e.path}</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
