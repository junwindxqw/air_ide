// Git 命令条（D2）：跑任意 git 命令，流式输出（解决 rebase 中断、stash、
// cherry-pick 等 UI 未覆盖场景）。白名单在 Rust 侧（禁 clean/gc 等）。
import { useEffect, useRef, useState } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { gitRun, gitRunCancel } from '@/ipc/git'
import { useUiStore } from '@/app/uiStore'

export function CommandBar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const root = useUiStore((s) => s.workspaceRoot)
  const [input, setInput] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const opIdRef = useRef<string>('')

  // 订阅 git://output（按 opId 过滤）
  useEffect(() => {
    if (!open) return
    let unlisten: UnlistenFn | null = null
    void listen<{ opId: string; stream: string; chunk: string }>('git://output', (e) => {
      if (e.payload.opId !== opIdRef.current) return
      setLines((prev) => [...prev, `[${e.payload.stream}] ${e.payload.chunk}`])
    }).then((f) => {
      unlisten = f
    })
    return () => {
      unlisten?.()
    }
  }, [open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // 自动滚动到底部
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [lines])

  if (!open || !root) return null

  const run = async () => {
    const trimmed = input.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setLines([])
    setExitCode(null)
    const opId = `cmd-${Date.now().toString(36)}`
    opIdRef.current = opId
    try {
      // 简单分词（不支持引号嵌套；复杂命令用外部终端）
      const args = trimmed.split(/\s+/)
      const code = await gitRun(opId, root, args)
      setExitCode(code)
      setLines((prev) => [...prev, `— 退出码 ${code} —`])
    } catch (e) {
      setLines((prev) => [...prev, `错误: ${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setBusy(false)
      window.dispatchEvent(new CustomEvent('air:git-changed'))
    }
  }

  return (
    <div className="command-bar">
      <div className="command-bar-input-row">
        <span className="command-bar-prefix">git</span>
        <input
          ref={inputRef}
          className="command-bar-input"
          placeholder="命令参数，如 status / rebase --abort / stash list"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
            if (e.key === 'Escape') onClose()
          }}
          disabled={busy}
        />
        {busy ? (
          <button className="commit-btn" onClick={() => void gitRunCancel(opIdRef.current)}>
            取消
          </button>
        ) : (
          <button className="commit-btn primary" onClick={() => void run()}>
            执行
          </button>
        )}
        <button className="commit-btn" onClick={onClose} title="关闭 (Esc)">
          ×
        </button>
      </div>
      <div className="command-bar-output" ref={outputRef}>
        {lines.map((l, i) => (
          <div key={i} className="command-bar-line">
            {l}
          </div>
        ))}
        {lines.length === 0 && <div className="command-bar-hint">输出显示在这里（git 原文，不截断）</div>}
      </div>
      {exitCode !== null && exitCode !== 0 && (
        <div className="command-bar-warn">命令未成功（退出码 {exitCode}）</div>
      )}
    </div>
  )
}
