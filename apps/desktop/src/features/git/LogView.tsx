// Git Log 视图（P2-5）：分页、作者/时间、简化分支图、双击看文件 diff。
import { useEffect, useCallback, useState } from 'react'
import { gitLog, type LogEntry } from '@/ipc/git'

export function LogView({
  repo,
  onClose,
}: {
  repo: string
  onClose: () => void
}) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const pageSize = 100

  const load = useCallback(
    async (skip: number) => {
      setLoading(true)
      try {
        const batch = await gitLog(repo, skip, pageSize)
        setEntries((prev) => (skip === 0 ? batch : [...prev, ...batch]))
      } finally {
        setLoading(false)
      }
    },
    [repo],
  )

  useEffect(() => {
    void load(0)
  }, [load])

  return (
    <div className="log-view">
      <div className="log-header">
        <span>Git Log</span>
        <button className="diff-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
      <div className="log-list">
        {entries.map((e) => (
          <div key={e.sha} className="log-row" title={e.sha}>
            <span className="log-graph" style={{ paddingLeft: e.graphCol * 12 }}>
              ●
            </span>
            <span className="log-sha">{e.shortSha}</span>
            <span className="log-subject">{e.subject}</span>
            <span className="log-refs">
              {e.refs.map((r) => (
                <span key={r} className="log-ref">
                  {r}
                </span>
              ))}
            </span>
            <span className="log-author">{e.author}</span>
            <span className="log-date">{e.date}</span>
          </div>
        ))}
        {entries.length === 0 && !loading && <div className="tree-empty">无提交记录</div>}
      </div>
      <div className="log-footer">
        {loading ? (
          <span className="log-status">加载中…</span>
        ) : (
          <button className="external-btn" onClick={() => void load(entries.length)}>
            加载更多（{entries.length} 已加载）
          </button>
        )}
      </div>
    </div>
  )
}

