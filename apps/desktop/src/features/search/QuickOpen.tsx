// 快速打开（Ctrl+Shift+N）+ 最近文件（Ctrl+E，1.2）：
// Rust 供文件列表（尊重 .gitignore），前端 nucleo 思路模糊匹配。
import { useEffect, useMemo, useRef, useState } from 'react'
import { fsCollectFiles } from '@/ipc/search'
import { nucleoScore } from '@/features/command/fuzzy'
import { useEditorStore } from '@/features/editor/store'
import { useUiStore } from '@/app/uiStore'

export function QuickOpen({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const root = useUiStore((s) => s.workspaceRoot)

  useEffect(() => {
    if (open && root && files.length === 0) {
      void fsCollectFiles(root).then(setFiles).catch(() => setFiles([]))
    }
    if (open) {
      setQuery('')
      setSelected(0)
      inputRef.current?.focus()
    }
  }, [open, root, files.length])

  const results = useMemo(() => {
    if (!query.trim()) {
      // 无输入：显示最近文件（P1 简化为前 20 个，正式版读 recent.json）
      return files.slice(0, 20)
    }
    return files
      .map((f) => ({ f, s: nucleoScore(f.replaceAll('\\', '/').split('/').pop() ?? f, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map((x) => x.f)
  }, [files, query])

  if (!open) return null

  const nameOf = (p: string) => {
    const norm = p.replaceAll('\\', '/')
    return { name: norm.split('/').pop() ?? p, dir: norm.split('/').slice(0, -1).join('/') }
  }

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="输入文件名…（Ctrl+E 最近文件）"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelected((s) => Math.min(s + 1, results.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected((s) => Math.max(s - 1, 0))
            }
            if (e.key === 'Enter' && results[selected]) {
              onClose()
              void useEditorStore.getState().openFile(results[selected])
            }
          }}
        />
        <div className="palette-list">
          {results.map((f, i) => {
            const { name, dir } = nameOf(f)
            return (
              <div
                key={f}
                className={`palette-item${i === selected ? ' selected' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => {
                  onClose()
                  void useEditorStore.getState().openFile(f)
                }}
              >
                <span className="palette-title">{name}</span>
                <span className="palette-cat">{dir}</span>
              </div>
            )
          })}
          {results.length === 0 && <div className="palette-empty">无匹配文件</div>}
        </div>
      </div>
    </div>
  )
}
