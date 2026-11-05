// 双栏 diff（P2-1）：两个只读 CM6 实例 + 同步滚动 + filler 行对齐 + 中间连接条。
// 数据源是 air-git 解析的 FileDiff（hunk 边界与 git diff 完全一致，3.7.2）。
// 词级高亮（P2-2）与 hunk 折叠（P2-3）在同一组件内叠加。
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  EditorState,
  Compartment,
  RangeSetBuilder,
  StateField,
  type Extension,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLineGutter,
  type DecorationSet,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import type { FileDiff, Hunk, DiffLine } from '@/ipc/git'
import { gitApplyHunk } from '@/ipc/git'
import { wordDiff } from '@/features/git/wordDiff'
import { useUiStore } from '@/app/uiStore'

type DisplayItem =
  | { kind: 'row'; row: DiffRow }
  | { kind: 'gap'; count: number; hunkIndex: number }

/** 行内词级高亮：对配对的 (del, add) 行做 wordDiff，生成 mark decoration。 */
function wordMarkField(
  items: DisplayItem[],
  side: 'left' | 'right',
): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildWordMarks(state.doc, items, side)
    },
    update(_v, t) {
      if (t.docChanged) return buildWordMarks(t.state.doc, items, side)
      return _v
    },
    provide: (f) => EditorView.decorations.from(f),
  })
}

function buildWordMarks(
  doc: { lines: number; line: (n: number) => { from: number } },
  items: DisplayItem[],
  side: 'left' | 'right',
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const cls = side === 'left' ? 'cm-diff-word-del' : 'cm-diff-word-add'
  // 只取 row 项与其文档行号
  const rowItems = items
    .map((d, i) => ({ d, lineNo: i + 1 }))
    .filter((x): x is { d: { kind: 'row'; row: DiffRow }; lineNo: number } => x.d.kind === 'row')
  rowItems.forEach(({ d, lineNo }, idx) => {
    if (lineNo > doc.lines) return
    const line = doc.line(lineNo)
    const row = d.row
    const mine = side === 'left' ? row.left : row.right
    if (!mine || mine.kind === 'context') return
    // 找同一 hunk 内的配对行（前一个或后一个对侧变更行）
    const pair = rowItems
      .slice(0, idx)
      .reverse()
      .find(
        (x) =>
          x.d.row.hunkIndex === row.hunkIndex &&
          (side === 'left' ? x.d.row.right : x.d.row.left)?.kind !== 'context' &&
          (side === 'left' ? x.d.row.right : x.d.row.left) != null,
      )
      ?.d.row
      ?? rowItems
        .slice(idx + 1)
        .find(
          (x) =>
            x.d.row.hunkIndex === row.hunkIndex &&
            (side === 'left' ? x.d.row.right : x.d.row.left)?.kind !== 'context' &&
            (side === 'left' ? x.d.row.right : x.d.row.left) != null,
        )?.d.row
    if (!pair) return
    const other = side === 'left' ? pair.right : pair.left
    if (!other || other.kind === 'context') return
    const oldText = side === 'left' ? mine.text : other.text
    const newText = side === 'left' ? other.text : mine.text
    const wd = wordDiff(oldText, newText)
    const ranges = side === 'left' ? wd.del : wd.add
    for (const r of ranges) {
      builder.add(line.from + r.start, line.from + r.end, Decoration.mark({ class: cls }))
    }
  })
  return builder.finish()
}

const themeCompartment = new Compartment()

/** 行对模型：split 视图的一行 = 左行 + 右行（任一为 null 表示 filler）。 */
export interface DiffRow {
  left: { text: string; kind: DiffLine['kind'] } | null
  right: { text: string; kind: DiffLine['kind'] } | null
  hunkIndex: number
}

/** 把 hunks 摊平成 split 行对：hunk 内的 delete 与 add 按序配对，context 成对。 */
export function buildSplitRows(hunks: Hunk[]): DiffRow[] {
  const rows: DiffRow[] = []
  hunks.forEach((hunk, hunkIndex) => {
    let i = 0
    const lines = hunk.lines
    while (i < lines.length) {
      const line = lines[i]
      if (line.kind === 'context') {
        rows.push({
          left: { text: line.text, kind: 'context' },
          right: { text: line.text, kind: 'context' },
          hunkIndex,
        })
        i += 1
      } else if (line.kind === 'delete') {
        // 收集连续 delete 与紧随的连续 add，按位配对
        const dels: string[] = []
        while (i < lines.length && lines[i].kind === 'delete') {
          dels.push(lines[i].text)
          i += 1
        }
        const adds: string[] = []
        while (i < lines.length && lines[i].kind === 'add') {
          adds.push(lines[i].text)
          i += 1
        }
        const max = Math.max(dels.length, adds.length)
        for (let k = 0; k < max; k++) {
          rows.push({
            left: k < dels.length ? { text: dels[k], kind: 'delete' } : null,
            right: k < adds.length ? { text: adds[k], kind: 'add' } : null,
            hunkIndex,
          })
        }
      } else {
        // 纯 add（无前导 delete）
        rows.push({ left: null, right: { text: line.text, kind: 'add' }, hunkIndex })
        i += 1
      }
    }
  })
  return rows
}

function readOnlyExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    drawSelection(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.editable.of(false),
    themeCompartment.of([]),
  ]
}

/** 行着色 StateField：lineKinds[i] 对应第 i+1 行的类型（null = filler/context）。 */
function lineKindField(
  lineKinds: Array<DiffLine['kind'] | null>,
): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildLineDecos(state.doc, lineKinds)
    },
    update(_value, transaction) {
      // 只读编辑器文档不变；视图变化不需要重建
      if (transaction.docChanged) {
        return buildLineDecos(transaction.state.doc, lineKinds)
      }
      return _value
    },
    provide: (f) => EditorView.decorations.from(f),
  })
}

function buildLineDecos(
  doc: { lines: number; line: (n: number) => { from: number; to: number } },
  lineKinds: Array<DiffLine['kind'] | null>,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const count = Math.min(doc.lines, lineKinds.length)
  for (let i = 0; i < count; i++) {
    const kind = lineKinds[i]
    if (kind !== 'add' && kind !== 'delete') continue
    const line = doc.line(i + 1)
    const cls = kind === 'add' ? 'diff-line-add' : 'diff-line-delete'
    builder.add(line.from, line.from, Decoration.line({ class: cls }))
  }
  return builder.finish()
}

export function SplitDiff({
  diff,
  onClose,
  ignoreWs = false,
  onToggleIgnoreWs,
  diffText,
  onHunkOp,
}: {
  diff: FileDiff
  onClose: () => void
  ignoreWs?: boolean
  onToggleIgnoreWs?: () => void
  /** 原始 git diff 文本（hunk 操作的 patch 源，3.7.2） */
  diffText?: string
  /** hunk 操作完成回调（刷新 Changes 列表） */
  onHunkOp?: () => void
}) {
  const leftParent = useRef<HTMLDivElement>(null)
  const rightParent = useRef<HTMLDivElement>(null)
  const [activeHunk, setActiveHunk] = useState(0)
  const repoRoot = useUiStore((s) => s.workspaceRoot)
  /** 已读标记（P2-4）：浏览过的 hunk 索引集合（不进 git，仅会话内） */
  const [readHunks, setReadHunks] = useState<Set<number>>(new Set())
  /** 折叠纯上下文行（P2-3：hunk 间上下文可折叠） */
  const [foldContext, setFoldContext] = useState(false)

  // F7 / Shift+F7 导航 + 浏览即已读
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F7') {
        e.preventDefault()
        setActiveHunk((h) => {
          const next = e.shiftKey ? Math.max(0, h - 1) : Math.min(diff.hunks.length - 1, h + 1)
          setReadHunks((prev) => new Set(prev).add(next))
          return next
        })
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [diff.hunks.length, onClose])

  // 初始定位第一个 hunk 并标记已读
  useEffect(() => {
    setActiveHunk(0)
    setReadHunks(new Set([0]))
  }, [diff.path])

  // hunk 级操作（3.7.2）：» 暂存 / « 取消暂存 / ✕ 丢弃
  const runHunkOp = async (hunkIndex: number, mode: 'stage' | 'unstage' | 'discard') => {
    if (!diffText || !repoRoot) return
    if (mode === 'discard') {
      const ok = window.confirm(
        `丢弃第 ${hunkIndex + 1} 个改动块的修改？此操作只影响工作区，不可撤销。`,
      )
      if (!ok) return
    }
    try {
      await gitApplyHunk(repoRoot, diff.path, hunkIndex, mode, diffText)
      onHunkOp?.()
      // 操作后重开 diff（hunk 边界已变）
      if (mode !== 'discard') onClose()
    } catch (e) {
      // 3.15：错误保留 git 原文 + 人话解释
      window.alert(`操作失败（未做任何修改）：\n${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const rows = useMemo(() => buildSplitRows(diff.hunks), [diff])
  // 折叠模式：连续纯上下文行合并为一条占位行
  const displayRows = useMemo(() => {
    if (!foldContext) return rows.map((r) => ({ kind: 'row' as const, row: r }))
    const out: Array<
      | { kind: 'row'; row: DiffRow }
      | { kind: 'gap'; count: number; hunkIndex: number }
    > = []
    let gap = 0
    let gapHunk = 0
    for (const r of rows) {
      const isContext = r.left?.kind === 'context' && r.right?.kind === 'context'
      if (isContext) {
        gap += 1
        gapHunk = r.hunkIndex
      } else {
        if (gap > 0) {
          out.push({ kind: 'gap', count: gap, hunkIndex: gapHunk })
          gap = 0
        }
        out.push({ kind: 'row', row: r })
      }
    }
    if (gap > 0) out.push({ kind: 'gap', count: gap, hunkIndex: gapHunk })
    return out
  }, [rows, foldContext])

  const leftText = useMemo(
    () =>
      displayRows
        .map((d) => (d.kind === 'row' ? (d.row.left?.text ?? '') : `⋯ ${d.count} 行未变更 ⋯`))
        .join('\n'),
    [displayRows],
  )
  const rightText = useMemo(
    () =>
      displayRows
        .map((d) => (d.kind === 'row' ? (d.row.right?.text ?? '') : `⋯ ${d.count} 行未变更 ⋯`))
        .join('\n'),
    [displayRows],
  )

  useEffect(() => {
    if (!leftParent.current || !rightParent.current) return
    const leftKinds = displayRows.map((d) =>
      d.kind === 'row' ? (d.row.left?.kind ?? null) : null,
    )
    const rightKinds = displayRows.map((d) =>
      d.kind === 'row' ? (d.row.right?.kind ?? null) : null,
    )
    const left = new EditorView({
      state: EditorState.create({
        doc: leftText,
        extensions: [
          ...readOnlyExtensions(),
          lineKindField(leftKinds),
          wordMarkField(displayRows, 'left'),
        ],
      }),
      parent: leftParent.current,
    })
    const right = new EditorView({
      state: EditorState.create({
        doc: rightText,
        extensions: [
          ...readOnlyExtensions(),
          lineKindField(rightKinds),
          wordMarkField(displayRows, 'right'),
        ],
      }),
      parent: rightParent.current,
    })
    // 同步滚动（双向）
    let syncing = false
    const sync = (from: EditorView, to: EditorView) => () => {
      if (syncing) return
      syncing = true
      to.scrollDOM.scrollTop = from.scrollDOM.scrollTop
      requestAnimationFrame(() => {
        syncing = false
      })
    }
    const l2r = sync(left, right)
    const r2l = sync(right, left)
    left.scrollDOM.addEventListener('scroll', l2r)
    right.scrollDOM.addEventListener('scroll', r2l)

    return () => {
      left.scrollDOM.removeEventListener('scroll', l2r)
      right.scrollDOM.removeEventListener('scroll', r2l)
      left.destroy()
      right.destroy()
    }
  }, [leftText, rightText, displayRows])

  return (
    <div className="split-diff">
      <div className="split-diff-toolbar">
        <span className="diff-file-name" title={diff.path}>
          {diff.path}
        </span>
        <button
          className="diff-nav-btn"
          onClick={() => setActiveHunk((h) => Math.max(0, h - 1))}
          disabled={activeHunk === 0}
          title="上一个改动 (Shift+F7)"
        >
          ↑
        </button>
        <span className="diff-nav-count">
          {activeHunk + 1} / {diff.hunks.length}
        </span>
        <button
          className="diff-nav-btn"
          onClick={() => setActiveHunk((h) => Math.min(diff.hunks.length - 1, h + 1))}
          disabled={activeHunk >= diff.hunks.length - 1}
          title="下一个改动 (F7)"
        >
          ↓
        </button>
        <span className="diff-toolbar-spacer" />
        {diffText && diff.hunks.length > 0 && (
          <span className="diff-hunk-ops">
            <button
              className="diff-op-btn"
              onClick={() => void runHunkOp(activeHunk, 'stage')}
              title="暂存此块 (»)"
            >
              » 暂存
            </button>
            <button
              className="diff-op-btn"
              onClick={() => void runHunkOp(activeHunk, 'unstage')}
              title="取消暂存 («)"
            >
              « 取消
            </button>
            <button
              className="diff-op-btn danger"
              onClick={() => void runHunkOp(activeHunk, 'discard')}
              title="丢弃此块（不可撤销）"
            >
              ✕ 丢弃
            </button>
          </span>
        )}
        <span className="diff-read-progress">
          已读 {readHunks.size} / {diff.hunks.length}
        </span>
        <button
          className={`diff-toggle${foldContext ? ' on' : ''}`}
          onClick={() => setFoldContext((v) => !v)}
          title="折叠未变更上下文"
        >
          折叠
        </button>
        <button
          className={`diff-toggle${ignoreWs ? ' on' : ''}`}
          onClick={() => onToggleIgnoreWs?.()}
          title="忽略空白差异 (-w)"
        >
          -w
        </button>
        <button className="diff-nav-btn" onClick={onClose} title="关闭 (Esc)">
          ×
        </button>
      </div>
      <div className="split-diff-body">
        <div className="split-diff-pane">
          <div className="split-diff-pane-title">本地（HEAD）</div>
          <div className="split-diff-editor" ref={leftParent} />
        </div>
        <div className="split-diff-pane">
          <div className="split-diff-pane-title">工作区</div>
          <div className="split-diff-editor" ref={rightParent} />
        </div>
      </div>
    </div>
  )
}

