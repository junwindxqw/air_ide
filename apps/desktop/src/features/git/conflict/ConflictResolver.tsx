// 冲突解决浮层：逐块选择「当前 / 传入 / 两者保留」+ 整文件一键解决 + 实时结果预览。
// 结果栏在体积允许时可直接编辑；保存走现有 fs 写盘 IPC，可选 git add。
import { useEffect, useMemo, useState } from 'react'
import { fsWriteFile } from '@/ipc/fs'
import { normalizeError } from '@/ipc/invoke'
import { gitStageFile } from '@/ipc/git'
import { useUiStore } from '@/app/uiStore'
import {
  MANUAL_EDIT_LIMIT_BYTES,
  formatBytes,
  useConflictStore,
} from './store'
import {
  allChoices,
  hasConflictMarkers,
  resolveConflictText,
  type ConflictHunk,
  type ResolutionChoice,
} from './markers'
import './conflict.css'

const CHOICES: Array<{ value: ResolutionChoice; label: string }> = [
  { value: 'ours', label: '采用当前' },
  { value: 'theirs', label: '采用传入' },
  { value: 'both', label: '两者保留' },
]

function sectionText(lines: string[]): string {
  if (lines.length === 0) return ''
  return lines.join('\n')
}

function HunkCard({
  hunk,
  choice,
  onChoose,
}: {
  hunk: ConflictHunk
  choice: ResolutionChoice | undefined
  onChoose: (choice: ResolutionChoice) => void
}) {
  const oursLabel = hunk.oursLabel || '当前'
  const theirsLabel = hunk.theirsLabel || '传入'
  const bothText = [...hunk.ours, ...hunk.theirs].join('\n')

  return (
    <div className={`conflict-hunk${hunk.complete ? '' : ' broken'}`}>
      <div className="conflict-hunk-head">
        <span className="conflict-hunk-title">
          第 {hunk.index + 1} 块 · 行 {hunk.startLine + 1}–{hunk.endLine + 1}
        </span>
        {!hunk.complete && <span className="conflict-badge-broken">标记异常</span>}
        {choice && <span className="conflict-badge-chosen">已选择</span>}
      </div>

      <div className="conflict-hunk-choices">
        {CHOICES.map((c) => (
          <button
            key={c.value}
            className={`conflict-choice${choice === c.value ? ' selected' : ''}`}
            onClick={() => onChoose(c.value)}
            title={c.value === 'both' ? '先当前、后传入' : undefined}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="conflict-sides">
        <div className="conflict-side ours">
          <div className="conflict-side-title">本地（{oursLabel}）</div>
          <pre className="conflict-side-text">
            {sectionText(hunk.ours) || <span className="conflict-empty">（空）</span>}
          </pre>
        </div>
        {hunk.base !== null && (
          <div className="conflict-side base">
            <div className="conflict-side-title">基准（{hunk.baseLabel || 'base'}）</div>
            <pre className="conflict-side-text">
              {sectionText(hunk.base) || <span className="conflict-empty">（空）</span>}
            </pre>
          </div>
        )}
        <div className="conflict-side theirs">
          <div className="conflict-side-title">传入（{theirsLabel}）</div>
          <pre className="conflict-side-text">
            {sectionText(hunk.theirs) || <span className="conflict-empty">（空）</span>}
          </pre>
        </div>
      </div>

      {choice === 'both' && (
        <div className="conflict-both-preview">两者保留结果：{bothText || '（空）'}</div>
      )}

      {hunk.problems.length > 0 && (
        <ul className="conflict-problems">
          {hunk.problems.map((p, i) => (
            <li key={`${p.kind}-${i}`}>{p.message}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ConflictResolver() {
  const relPath = useConflictStore((s) => s.path)
  const loaded = useConflictStore((s) => s.loaded)
  const parsed = useConflictStore((s) => s.parsed)
  const loading = useConflictStore((s) => s.loading)
  const error = useConflictStore((s) => s.error)
  const close = useConflictStore((s) => s.close)
  const retry = useConflictStore((s) => s.retry)
  const markResolved = useConflictStore((s) => s.markResolved)
  const root = useUiStore((s) => s.workspaceRoot)

  const [choices, setChoices] = useState<Record<number, ResolutionChoice>>({})
  const [manualText, setManualText] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // 切换文件即重置逐块选择与手动编辑
  useEffect(() => {
    setChoices({})
    setManualText(null)
    setSaving(false)
    setSaveError(null)
  }, [relPath])

  useEffect(() => {
    if (!relPath) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [relPath, close])

  const preview = useMemo(
    () => (parsed ? resolveConflictText(parsed.lines, parsed.hunks, choices) : null),
    [parsed, choices],
  )

  if (!relPath) return null

  const editable = !!loaded && loaded.meta.size <= MANUAL_EDIT_LIMIT_BYTES
  const finalText = manualText ?? preview?.text ?? ''
  const unresolvedCount = preview?.unresolved.length ?? 0
  const problems = parsed?.problems ?? []

  let blockReason = ''
  if (hasConflictMarkers(finalText)) {
    blockReason = '结果中仍残留 <<<<<<< / >>>>>>> 冲突标记'
  } else if (manualText === null && problems.length > 0) {
    blockReason = `存在 ${problems.length} 处异常冲突标记，请先修复标记结构`
  } else if (manualText === null && unresolvedCount > 0) {
    blockReason = `还有 ${unresolvedCount} 个冲突块未选择`
  }

  const choose = (hunkIndex: number, choice: ResolutionChoice) => {
    setSaveError(null)
    // 修改块选择会让手动编辑失效，避免两边内容悄悄错位
    setManualText(null)
    setChoices((prev) => ({ ...prev, [hunkIndex]: choice }))
  }

  const chooseAll = (choice: ResolutionChoice) => {
    if (!parsed) return
    setSaveError(null)
    setManualText(null)
    setChoices(allChoices(parsed.hunks, choice))
  }

  const save = async (withStage: boolean) => {
    if (!root || !relPath || !loaded || !parsed || saving || blockReason) return
    setSaving(true)
    setSaveError(null)
    try {
      await fsWriteFile({
        path: loaded.meta.path,
        text: finalText,
        encoding: loaded.meta.encoding,
        eol: loaded.meta.eol === 'mixed' ? 'lf' : loaded.meta.eol,
        hasBom: loaded.meta.hasBom,
      })
    } catch (e) {
      setSaveError(`写盘失败（文件未被修改）：${normalizeError(e).message}`)
      setSaving(false)
      return
    }

    markResolved(relPath)

    if (withStage) {
      try {
        await gitStageFile(root, relPath)
      } catch (e) {
        window.dispatchEvent(new CustomEvent('air:git-changed'))
        setSaveError(`文件已保存，但 git add 失败：${normalizeError(e).message}`)
        setSaving(false)
        return
      }
    }

    window.dispatchEvent(new CustomEvent('air:git-changed'))
    setSaving(false)
    close()
  }

  const total = parsed?.hunks.length ?? 0
  const resolvedCount = total - unresolvedCount

  return (
    <div className="conflict-overlay" role="dialog" aria-label="冲突解决">
      <div className="conflict-toolbar">
        <span className="conflict-file" title={loaded?.meta.path ?? relPath}>
          {relPath}
        </span>
        {loaded && (
          <span className="conflict-meta">
            {loaded.meta.encoding.toUpperCase()}
            {loaded.meta.eol !== 'lf' ? ` · ${loaded.meta.eol.toUpperCase()}` : ''}
            {loaded.meta.hasBom ? ' · BOM' : ''} · {formatBytes(loaded.meta.size)}
          </span>
        )}
        {parsed && (
          <span className="conflict-count">
            已解决 {resolvedCount} / {total} 块
          </span>
        )}
        <span className="conflict-spacer" />
        {parsed && (
          <span className="conflict-bulk">
            <button className="conflict-btn" onClick={() => chooseAll('ours')} disabled={saving}>
              全部采用当前
            </button>
            <button className="conflict-btn" onClick={() => chooseAll('theirs')} disabled={saving}>
              全部采用传入
            </button>
            <button className="conflict-btn" onClick={() => chooseAll('both')} disabled={saving}>
              全部两者保留
            </button>
          </span>
        )}
        <button className="conflict-btn" onClick={close} disabled={saving} title="关闭 (Esc)">
          ×
        </button>
      </div>

      {loading && <div className="conflict-message">读取文件中…</div>}

      {!loading && error && (
        <div className="conflict-message">
          <div className="conflict-error">{error}</div>
          <div className="conflict-message-actions">
            <button className="conflict-btn" onClick={() => void retry()}>
              重新读取
            </button>
            <button className="conflict-btn" onClick={close}>
              关闭
            </button>
          </div>
        </div>
      )}

      {!loading && !error && parsed && preview && (
        <div className="conflict-body">
          <div className="conflict-hunks">
            {parsed.hunks.map((h) => (
              <HunkCard
                key={h.index}
                hunk={h}
                choice={choices[h.index]}
                onChoose={(choice) => choose(h.index, choice)}
              />
            ))}
          </div>

          <div className="conflict-result">
            <div className="conflict-result-head">
              <span>结果（实时预览）</span>
              {manualText !== null && (
                <button className="conflict-link" onClick={() => setManualText(null)}>
                  还原为自动结果
                </button>
              )}
            </div>
            {editable ? (
              <textarea
                className="conflict-result-edit"
                value={finalText}
                onChange={(e) => {
                  setSaveError(null)
                  setManualText(e.target.value)
                }}
                spellCheck={false}
                aria-label="解决后的文件内容"
              />
            ) : (
              <div className="conflict-result-readonly">
                <pre className="conflict-result-text">{finalText}</pre>
                <div className="conflict-limit-note">
                  文件超过 {formatBytes(MANUAL_EDIT_LIMIT_BYTES)}，结果栏只提供只读预览；
                  逐块选择仍然可用。
                </div>
              </div>
            )}

            {problems.length > 0 && (
              <div className="conflict-problems-global">
                {problems.slice(0, 5).map((p, i) => (
                  <div key={`${p.kind}-${i}`}>{p.message}</div>
                ))}
                {problems.length > 5 && <div>还有 {problems.length - 5} 条异常…</div>}
              </div>
            )}

            {saveError && <div className="conflict-error">{saveError}</div>}
            {blockReason && <div className="conflict-block-reason">{blockReason}</div>}

            <div className="conflict-actions">
              <button
                className="conflict-btn primary"
                onClick={() => void save(false)}
                disabled={saving || !!blockReason}
              >
                {saving ? '保存中…' : '保存'}
              </button>
              <button
                className="conflict-btn"
                onClick={() => void save(true)}
                disabled={saving || !!blockReason}
                title="保存后执行 git add（标记为已解决）"
              >
                保存并暂存
              </button>
              {manualText !== null && <span className="conflict-manual-hint">已手动编辑结果</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
