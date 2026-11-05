// Changes 面板（P1-10 最小 diff）：status 列表 + 双击开只读 unified diff。
// P3 才加 stage 复选框与 hunk 操作（方案 4 / Phase 3）。
import { useEffect, useMemo, useCallback, useState } from 'react'
import { gitStatus, gitDiffFile, type RepoStatus, type FileDiff } from '@/ipc/git'
import { useUiStore } from '@/app/uiStore'

export function ChangesPanel() {
  const root = useUiStore((s) => s.workspaceRoot)
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [diff, setDiff] = useState<{ path: string; diff: FileDiff } | null>(null)

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

  const openDiff = async (path: string) => {
    try {
      const d = await gitDiffFile(root, path, false)
      setDiff({ path, diff: d })
    } catch (e) {
      console.error('diff 失败', e)
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
            {entries.map((e) => (
              <div
                key={`${group}-${e.path}`}
                className="changes-row"
                onDoubleClick={() => void openDiff(e.path)}
                title={`${e.path}（双击查看 diff）`}
              >
                <span className={`changes-kind kind-${e.kind}`}>{e.kind[0].toUpperCase()}</span>
                <span className="changes-path">{e.path}</span>
              </div>
            ))}
          </div>
        )
      })}

      {diff && (
        <DiffViewer path={diff.path} diff={diff.diff} onClose={() => setDiff(null)} />
      )}
    </div>
  )
}

/** 只读 unified diff 视图（P1 最小 diff）：行级着色 + hunk 头。 */
function DiffViewer({
  path,
  diff,
  onClose,
}: {
  path: string
  diff: FileDiff
  onClose: () => void
}) {
  return (
    <div className="diff-viewer">
      <div className="diff-header">
        <span className="diff-path" title={path}>
          {path}
        </span>
        <button className="diff-close" onClick={onClose} aria-label="关闭 diff">
          ×
        </button>
      </div>
      {diff.isBinary && <div className="diff-binary">二进制文件，无文本差异</div>}
      {diff.hunks.length === 0 && !diff.isBinary && (
        <div className="diff-empty">无差异</div>
      )}
      {diff.hunks.map((hunk, hi) => (
        <div key={hi} className="diff-hunk">
          <div className="diff-hunk-header">{hunk.header}</div>
          {hunk.lines.map((line, li) => (
            <div key={li} className={`diff-line diff-${line.kind}`}>
              <span className="diff-sign">
                {line.kind === 'add' ? '+' : line.kind === 'delete' ? '-' : ' '}
              </span>
              <span className="diff-text">{line.text || ' '}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
