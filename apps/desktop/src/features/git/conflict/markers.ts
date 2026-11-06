// Git 冲突标记解析与合并（纯函数，可单测）。
// 输入是「已解码」的文本：编码（UTF-8 / GB18030 …）由 fs 层负责，
// 这里只把 CRLF / CR 归一到 \n，再按行识别冲突块。
//
// 支持的块形态：
//   <<<<<<< 当前分支
//   当前内容
//   ||||||| 基准            ← diff3 可选段
//   基准内容
//   =======
//   传入内容
//   >>>>>>> 传入分支

export type ResolutionChoice = 'ours' | 'theirs' | 'both'

export type ConflictProblemKind =
  | 'nested-start'
  | 'duplicate-separator'
  | 'duplicate-base'
  | 'missing-separator'
  | 'missing-end'
  | 'stray-separator'
  | 'stray-end'
  | 'stray-base'

export interface ConflictProblem {
  kind: ConflictProblemKind
  /** 0 基行号 */
  line: number
  message: string
}

export interface ConflictHunk {
  /** 块序号（从 0 开始，跨文件唯一） */
  index: number
  /** `<<<<<<<` 的 0 基行号 */
  startLine: number
  /** `>>>>>>>` 的 0 基行号；不完整块为最后一行 */
  endLine: number
  oursLabel: string
  /** diff3 的 `|||||||` 标签；无基准段为 null */
  baseLabel: string | null
  theirsLabel: string
  ours: string[]
  base: string[] | null
  theirs: string[]
  /** 标记结构是否完整（缺分隔行/结束行则为 false） */
  complete: boolean
  problems: ConflictProblem[]
}

export interface ParseConflictResult {
  /** 归一换行后的原始行（含末尾空行，保证 join('\n') 可还原） */
  lines: string[]
  hunks: ConflictHunk[]
  /** 全部异常（含 hunks 内的），按行号排序 */
  problems: ConflictProblem[]
}

export interface ResolveResult {
  text: string
  /** 未选择（或结构异常）的块序号，保留原始标记 */
  unresolved: number[]
}

const START_RE = /^<{7,}(?:\s+(.*))?$/
const BASE_RE = /^\|{7,}(?:\s+(.*))?$/
const SEPARATOR_RE = /^={7,}$/
const END_RE = /^>{7,}(?:\s+(.*))?$/

function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

interface PendingHunk {
  startLine: number
  oursLabel: string
  baseLabel: string | null
  theirsLabel: string
  ours: string[]
  base: string[] | null
  theirs: string[]
  section: 'ours' | 'base' | 'theirs'
  separatorSeen: boolean
  problems: ConflictProblem[]
}

function labelOf(group: string | undefined, fallback: string): string {
  const label = (group ?? '').trim()
  return label || fallback
}

/** 识别文本中的冲突块；结构异常不抛出，统一收集到 problems。 */
export function parseConflictMarkers(text: string): ParseConflictResult {
  const lines = normalizeEol(text).split('\n')
  const hunks: ConflictHunk[] = []
  const problems: ConflictProblem[] = []
  let pending: PendingHunk | null = null

  const contentTarget = (p: PendingHunk): string[] => {
    if (p.section === 'base') return p.base ?? (p.base = [])
    if (p.section === 'theirs') return p.theirs
    return p.ours
  }

  const finish = (complete: boolean, endLine: number, endLabel?: string): void => {
    if (!pending) return
    const p = pending
    if (!p.separatorSeen) {
      p.problems.push({
        kind: 'missing-separator',
        line: p.startLine,
        message: `第 ${p.startLine + 1} 行的冲突块缺少 ======= 分隔行`,
      })
    }
    if (!complete) {
      p.problems.push({
        kind: 'missing-end',
        line: p.startLine,
        message: `第 ${p.startLine + 1} 行的冲突块缺少 >>>>>>> 结束行`,
      })
    }
    if (endLabel) p.theirsLabel = endLabel
    // 缺分隔行的块同样不可自动合并：一律按结构异常处理
    const structuralComplete = complete && p.separatorSeen
    const hunk: ConflictHunk = {
      index: hunks.length,
      startLine: p.startLine,
      endLine: Math.max(endLine, p.startLine),
      oursLabel: p.oursLabel,
      baseLabel: p.baseLabel,
      theirsLabel: p.theirsLabel,
      ours: p.ours,
      base: p.base,
      theirs: p.theirs,
      complete: structuralComplete,
      problems: p.problems,
    }
    hunks.push(hunk)
    problems.push(...p.problems)
    pending = null
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]

    if (!pending) {
      const start = START_RE.exec(line)
      if (start) {
        pending = {
          startLine: i,
          oursLabel: labelOf(start[1], '当前'),
          baseLabel: null,
          theirsLabel: '传入',
          ours: [],
          base: null,
          theirs: [],
          section: 'ours',
          separatorSeen: false,
          problems: [],
        }
        continue
      }
      if (SEPARATOR_RE.test(line)) {
        problems.push({
          kind: 'stray-separator',
          line: i,
          message: `第 ${i + 1} 行出现孤立的 =======（没有对应的 <<<<<<<）`,
        })
      } else if (END_RE.test(line)) {
        problems.push({
          kind: 'stray-end',
          line: i,
          message: `第 ${i + 1} 行出现孤立的 >>>>>>>（没有对应的 <<<<<<<）`,
        })
      } else if (BASE_RE.test(line)) {
        problems.push({
          kind: 'stray-base',
          line: i,
          message: `第 ${i + 1} 行出现孤立的 |||||||（没有对应的 <<<<<<<）`,
        })
      }
      continue
    }

    const p = pending
    const start = START_RE.exec(line)
    if (start) {
      p.problems.push({
        kind: 'nested-start',
        line: i,
        message: `第 ${i + 1} 行出现嵌套的 <<<<<<<，已按普通内容处理`,
      })
      contentTarget(p).push(line)
      continue
    }

    const base = BASE_RE.exec(line)
    if (base) {
      if (p.section === 'ours' && p.base === null) {
        p.baseLabel = labelOf(base[1], '基准')
        p.base = []
        p.section = 'base'
      } else {
        p.problems.push({
          kind: 'duplicate-base',
          line: i,
          message: `第 ${i + 1} 行出现重复或位置错误的 |||||||，已按普通内容处理`,
        })
        contentTarget(p).push(line)
      }
      continue
    }

    if (SEPARATOR_RE.test(line)) {
      if (!p.separatorSeen && (p.section === 'ours' || p.section === 'base')) {
        p.separatorSeen = true
        p.section = 'theirs'
      } else {
        p.problems.push({
          kind: 'duplicate-separator',
          line: i,
          message: `第 ${i + 1} 行出现重复的 =======，已按普通内容处理`,
        })
        contentTarget(p).push(line)
      }
      continue
    }

    const end = END_RE.exec(line)
    if (end) {
      finish(true, i, labelOf(end[1], ''))
      continue
    }

    contentTarget(p).push(line)
  }

  if (pending) finish(false, lines.length - 1)

  problems.sort((a, b) => a.line - b.line)
  return { lines, hunks, problems }
}

/** 是否仍残留冲突标记（保存前的兜底校验；孤立分隔行不算，避免误伤正文）。 */
export function hasConflictMarkers(text: string): boolean {
  return normalizeEol(text)
    .split('\n')
    .some((line) => START_RE.test(line) || BASE_RE.test(line) || END_RE.test(line))
}

/** 一个块的可用选项（空段显示为占位文本）。 */
export function choiceContent(hunk: ConflictHunk, choice: ResolutionChoice): string[] {
  if (choice === 'ours') return hunk.ours
  if (choice === 'theirs') return hunk.theirs
  return [...hunk.ours, ...hunk.theirs]
}

/** 生成「全部采用 X」的 choices。 */
export function allChoices(
  hunks: ConflictHunk[],
  choice: ResolutionChoice,
): Record<number, ResolutionChoice> {
  const out: Record<number, ResolutionChoice> = {}
  for (const h of hunks) out[h.index] = choice
  return out
}

/** 按块选择合并为完整文本；未选择/结构异常的块原样保留并计入 unresolved。 */
export function resolveConflictText(
  lines: string[],
  hunks: ConflictHunk[],
  choices: Record<number, ResolutionChoice>,
): ResolveResult {
  const byStart = new Map<number, ConflictHunk>()
  for (const h of hunks) byStart.set(h.startLine, h)

  const out: string[] = []
  const unresolved: number[] = []
  let i = 0

  while (i < lines.length) {
    const hunk = byStart.get(i)
    if (!hunk) {
      out.push(lines[i])
      i += 1
      continue
    }

    const choice = choices[hunk.index]
    if (!hunk.complete || choice === undefined) {
      for (let k = hunk.startLine; k <= hunk.endLine && k < lines.length; k += 1) {
        out.push(lines[k])
      }
      unresolved.push(hunk.index)
    } else {
      out.push(...choiceContent(hunk, choice))
    }
    i = hunk.endLine + 1
  }

  return { text: out.join('\n'), unresolved }
}
