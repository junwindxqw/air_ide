// 提交面板（P3-3）：message 编辑、amend、sign-off、身份预检、hook 输出展示、
// 最近提交信息 ↑↓ 复用、撤销上一次提交（reset --soft HEAD~1）。
import { useEffect, useRef, useState } from 'react'
import {
  gitCommit,
  gitIdentityReady,
  gitSetIdentity,
  gitUndoCommit,
  gitStatus,
  type RepoStatus,
} from '@/ipc/git'
import { useUiStore } from '@/app/uiStore'

/** 最近提交信息（↑↓ 复用，3.7.3）。 */
const RECENT_MESSAGES_KEY = 'air.recentCommitMessages'
const MAX_RECENT = 10

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_MESSAGES_KEY) ?? '[]')
  } catch {
    return []
  }
}

function pushRecent(msg: string) {
  const list = loadRecent().filter((m) => m !== msg)
  list.unshift(msg)
  localStorage.setItem(RECENT_MESSAGES_KEY, JSON.stringify(list.slice(0, MAX_RECENT)))
}

export function CommitPanel({ onCommitted }: { onCommitted?: () => void }) {
  const root = useUiStore((s) => s.workspaceRoot)
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [signoff, setSignoff] = useState(false)
  const [identityOk, setIdentityOk] = useState<boolean | null>(null)
  const [identityForm, setIdentityForm] = useState({ name: '', email: '', scope: 'local' as 'local' | 'global' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recentIdx, setRecentIdx] = useState(-1)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const stagedCount = status?.staged.length ?? 0

  const refresh = async () => {
    if (!root) return
    try {
      const s = await gitStatus(root)
      setStatus(s)
    } catch {
      setStatus(null)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  // 身份预检（3.12.6：缺失时内联表单补齐）
  useEffect(() => {
    if (!root) return
    void gitIdentityReady(root).then(setIdentityOk)
  }, [root])

  const doCommit = async () => {
    if (!root) return
    if (!message.trim()) {
      setError('提交信息不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await gitCommit(root, message, amend, signoff)
      pushRecent(message)
      setMessage('')
      setAmend(false)
      await refresh()
      onCommitted?.()
      window.dispatchEvent(new CustomEvent('air:git-changed'))
    } catch (e) {
      // 3.15：hook 失败等错误保留 git 原文（可展开）
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doUndo = async () => {
    if (!root) return
    if (!window.confirm('撤销上一次提交（reset --soft HEAD~1）？改动将保留在暂存区。')) return
    setBusy(true)
    try {
      await gitUndoCommit(root)
      await refresh()
      onCommitted?.()
      window.dispatchEvent(new CustomEvent('air:git-changed'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const saveIdentity = async () => {
    if (!root) return
    try {
      await gitSetIdentity(root, identityForm.name, identityForm.email, identityForm.scope)
      setIdentityOk(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!root) return null

  return (
    <div className="commit-panel">
      {identityOk === false && (
        <div className="commit-identity">
          <div className="commit-identity-title">Git 身份未配置（3.12.6）</div>
          <input
            className="commit-input"
            placeholder="user.name"
            value={identityForm.name}
            onChange={(e) => setIdentityForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            className="commit-input"
            placeholder="user.email"
            value={identityForm.email}
            onChange={(e) => setIdentityForm((f) => ({ ...f, email: e.target.value }))}
          />
          <div className="commit-identity-row">
            <label>
              <input
                type="radio"
                checked={identityForm.scope === 'local'}
                onChange={() => setIdentityForm((f) => ({ ...f, scope: 'local' }))}
              />
                仅此仓库
            </label>
            <label>
              <input
                type="radio"
                checked={identityForm.scope === 'global'}
                onChange={() => setIdentityForm((f) => ({ ...f, scope: 'global' }))}
              />
                全局
            </label>
            <button
              className="commit-btn"
              disabled={!identityForm.name.trim() || !identityForm.email.trim()}
              onClick={() => void saveIdentity()}
            >
              保存
            </button>
          </div>
        </div>
      )}

      <textarea
        ref={textareaRef}
        className="commit-message"
        placeholder={`提交信息（暂存 ${stagedCount} 个文件）\n↑↓ 复用最近提交信息`}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          // ↑↓ 复用最近提交信息（3.7.3）
          const recent = loadRecent()
          if (e.key === 'ArrowUp' && recent.length > 0) {
            e.preventDefault()
            const next = Math.min(recentIdx + 1, recent.length - 1)
            setRecentIdx(next)
            setMessage(recent[next])
          }
          if (e.key === 'ArrowDown' && recentIdx >= 0) {
            e.preventDefault()
            const next = recentIdx - 1
            setRecentIdx(next)
            setMessage(next < 0 ? '' : recent[next])
          }
          // Ctrl+Enter 提交
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void doCommit()
          }
        }}
      />

      <div className="commit-options">
        <label className="commit-check">
          <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
          amend（修订上一次提交）
        </label>
        <label className="commit-check">
          <input type="checkbox" checked={signoff} onChange={(e) => setSignoff(e.target.checked)} />
          sign-off
        </label>
      </div>

      <div className="commit-actions">
        <button
          className="commit-btn primary"
          disabled={busy || stagedCount === 0 || identityOk === false}
          onClick={() => void doCommit()}
          title="Ctrl+Enter"
        >
          {busy ? '提交中…' : '提交'}
        </button>
        <button className="commit-btn" disabled={busy} onClick={() => void doUndo()} title="reset --soft HEAD~1">
          撤销上次提交
        </button>
      </div>

      {error && (
        <div className="commit-error">
          <div className="commit-error-title">操作失败（git 原文）：</div>
          <pre className="commit-error-body">{error}</pre>
        </div>
      )}
    </div>
  )
}

