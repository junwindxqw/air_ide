// 命令面板（Ctrl+Shift+A，2.10）：只放命令，文件跳转走快速打开（3.16）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { allCommands, executeCommand, type Command } from '@/features/command/registry'
import { nucleoScore } from '@/features/command/fuzzy'

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const commands = useMemo<Command[]>(() => allCommands(), [])
  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    return commands
      .map((c) => ({ c, score: nucleoScore(`${c.category} ${c.title}`, query) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c)
  }, [commands, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      inputRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  const runSelected = async () => {
    const cmd = filtered[selected]
    if (!cmd) return
    onClose()
    await executeCommand(cmd.id)
  }

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="输入命令名…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelected((s) => Math.min(s + 1, filtered.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected((s) => Math.max(s - 1, 0))
            }
            if (e.key === 'Enter') void runSelected()
          }}
        />
        <div className="palette-list">
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              className={`palette-item${i === selected ? ' selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => {
                onClose()
                void executeCommand(cmd.id)
              }}
            >
              <span className="palette-cat">{cmd.category}</span>
              <span className="palette-title">{cmd.title}</span>
              {cmd.keybinding && <span className="palette-key">{cmd.keybinding}</span>}
            </div>
          ))}
          {filtered.length === 0 && <div className="palette-empty">无匹配命令</div>}
        </div>
      </div>
    </div>
  )
}
