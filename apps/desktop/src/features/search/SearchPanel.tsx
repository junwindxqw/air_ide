// 全局搜索面板（Ctrl+Shift+F，P1）：流式结果 + 分组折叠 + 跳转定位。
import { useEffect, useRef, useState } from 'react'
import { nextQueryId, searchQuery, searchCancel, type SearchMatch } from '@/ipc/search'
import { useUiStore } from '@/app/uiStore'
import { useEditorStore } from '@/features/editor/store'
import { perfStart, perfEnd } from '@/app/perf'

interface FileGroup {
  path: string
  matches: SearchMatch[]
  collapsed: boolean
}

export function SearchPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pattern, setPattern] = useState('')
  const [useRegex, setUseRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [groups, setGroups] = useState<FileGroup[]>([])
  const [total, setTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const root = useUiStore((s) => s.workspaceRoot)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queryIdRef = useRef<string | null>(null)

  // 防抖 300ms 后发起搜索；改词先取消在途（3.5）
  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!pattern.trim() || !root) {
      setGroups([])
      setTotal(0)
      return
    }
    debounceRef.current = setTimeout(() => {
      void runSearch()
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, useRegex, caseSensitive, wholeWord, open, root])

  const runSearch = async () => {
    if (!root) return
    // 取消在途查询
    if (queryIdRef.current) await searchCancel(queryIdRef.current)
    const qid = nextQueryId()
    queryIdRef.current = qid
    setSearching(true)
    setGroups([])
    setTotal(0)
    // 首批结果计时（方案 5.3；不含输入防抖）
    perfStart('air.search_first_batch')
    let firstBatch = true
    try {
      const count = await searchQuery(qid, root, { pattern, regex: useRegex, caseSensitive, wholeWord }, (batch) => {
        if (firstBatch) {
          firstBatch = false
          perfEnd('air.search_first_batch')
        }
        setGroups((prev) => mergeBatch(prev, batch))
      })
      if (queryIdRef.current === qid) setTotal(count)
    } catch (e) {
      console.error('搜索失败', e)
    } finally {
      if (queryIdRef.current === qid) setSearching(false)
    }
  }

  if (!open) return null

  const toggleGroup = (path: string) =>
    setGroups((prev) =>
      prev.map((g) => (g.path === path ? { ...g, collapsed: !g.collapsed } : g)),
    )

  const jumpTo = async (m: SearchMatch) => {
    onClose()
    await useEditorStore.getState().openFile(m.path)
    // 光标定位由 CodeEditor 的 pending.cursor 支持；P1 简化：仅打开文件
    console.debug(`跳转 ${m.path}:${m.line}:${m.col}`)
  }

  return (
    <div className="search-panel">
      <div className="search-input-row">
        <input
          className="search-input"
          autoFocus
          placeholder="全局搜索（正则/大小写/整词）"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
          }}
        />
        <button
          className={`search-toggle${useRegex ? ' on' : ''}`}
          title="正则表达式"
          onClick={() => setUseRegex((v) => !v)}
        >
          .*
        </button>
        <button
          className={`search-toggle${caseSensitive ? ' on' : ''}`}
          title="区分大小写"
          onClick={() => setCaseSensitive((v) => !v)}
        >
          Aa
        </button>
        <button
          className={`search-toggle${wholeWord ? ' on' : ''}`}
          title="整词匹配"
          onClick={() => setWholeWord((v) => !v)}
        >
          ab
        </button>
        <span className="search-status">
          {searching ? '搜索中…' : `${total} 个结果`}
        </span>
      </div>
      <div className="search-results">
        {groups.map((g) => (
          <div key={g.path} className="search-group">
            <div className="search-group-header" onClick={() => toggleGroup(g.path)}>
              <span className="search-twisty">{g.collapsed ? '▸' : '▾'}</span>
              <span className="search-group-path" title={g.path}>
                {g.path}
              </span>
              <span className="search-group-count">{g.matches.length}</span>
            </div>
            {!g.collapsed &&
              g.matches.map((m, i) => (
                <div
                  key={`${m.path}:${m.line}:${i}`}
                  className="search-match"
                  onClick={() => void jumpTo(m)}
                  title={`${m.path}:${m.line}`}
                >
                  <span className="search-line-no">{m.line}</span>
                  <span className="search-line-text">{m.text}</span>
                </div>
              ))}
          </div>
        ))}
        {groups.length === 0 && pattern && !searching && (
          <div className="tree-empty">无结果</div>
        )}
      </div>
    </div>
  )
}

/** 把一批匹配合并进分组（保持文件顺序稳定）。 */
function mergeBatch(prev: FileGroup[], batch: SearchMatch[]): FileGroup[] {
  const groups = [...prev]
  for (const m of batch) {
    let g = groups.find((x) => x.path === m.path)
    if (!g) {
      g = { path: m.path, matches: [], collapsed: false }
      groups.push(g)
    }
    g.matches.push(m)
  }
  return groups
}
