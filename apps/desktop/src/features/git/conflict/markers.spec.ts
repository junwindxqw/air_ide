import { describe, expect, it } from 'vitest'
import {
  allChoices,
  hasConflictMarkers,
  parseConflictMarkers,
  resolveConflictText,
  type ResolutionChoice,
} from '@/features/git/conflict/markers'

function resolve(text: string, choices: Record<number, ResolutionChoice>) {
  const parsed = parseConflictMarkers(text)
  return resolveConflictText(parsed.lines, parsed.hunks, choices)
}

describe('parseConflictMarkers 冲突识别', () => {
  it('解析单块冲突（含标签）', () => {
    const text = [
      'line1',
      '<<<<<<< HEAD',
      'ours',
      '=======',
      'theirs',
      '>>>>>>> feature',
      'line2',
    ].join('\n')

    const parsed = parseConflictMarkers(text)
    expect(parsed.problems).toEqual([])
    expect(parsed.hunks).toHaveLength(1)
    const h = parsed.hunks[0]
    expect(h.startLine).toBe(1)
    expect(h.endLine).toBe(5)
    expect(h.complete).toBe(true)
    expect(h.oursLabel).toBe('HEAD')
    expect(h.theirsLabel).toBe('feature')
    expect(h.ours).toEqual(['ours'])
    expect(h.theirs).toEqual(['theirs'])
    expect(h.base).toBeNull()
    expect(parsed.lines).toHaveLength(7)
  })

  it('解析 diff3 的 ||||||| 基准段', () => {
    const text = [
      'a',
      '<<<<<<< HEAD',
      'ours',
      '||||||| base',
      'base line',
      '=======',
      'theirs',
      '>>>>>>> other',
      'b',
    ].join('\n')

    const parsed = parseConflictMarkers(text)
    expect(parsed.problems).toEqual([])
    const h = parsed.hunks[0]
    expect(h.baseLabel).toBe('base')
    expect(h.base).toEqual(['base line'])
    expect(h.ours).toEqual(['ours'])
    expect(h.theirs).toEqual(['theirs'])
  })

  it('多冲突块与块外文本保持行号', () => {
    const text = [
      'x',
      '<<<<<<< H1',
      'a1',
      '=======',
      'b1',
      '>>>>>>> T1',
      'mid',
      '<<<<<<< H2',
      'a2',
      '=======',
      'b2',
      '>>>>>>> T2',
      'y',
    ].join('\n')

    const parsed = parseConflictMarkers(text)
    expect(parsed.hunks.map((h) => h.startLine)).toEqual([1, 7])
    expect(parsed.hunks.map((h) => h.endLine)).toEqual([5, 11])
    expect(parsed.hunks.map((h) => h.index)).toEqual([0, 1])
  })

  it('CRLF 输入：识别成功且解析结果不含 \\r', () => {
    const text =
      'line1\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> feature\r\nline2\r\n'
    const parsed = parseConflictMarkers(text)
    expect(parsed.hunks).toHaveLength(1)
    expect(parsed.problems).toEqual([])
    expect(parsed.lines.every((l) => !l.includes('\r'))).toBe(true)
    expect(parsed.hunks[0].ours).toEqual(['ours'])
  })

  it('中文内容（模拟 GB18030 解码后的文本）原样保留', () => {
    const text = ['<<<<<<< 当前', '本地中文', '=======', '传入中文', '>>>>>>> 远端'].join(
      '\n',
    )
    const parsed = parseConflictMarkers(text)
    expect(parsed.hunks[0].ours).toEqual(['本地中文'])
    expect(parsed.hunks[0].theirs).toEqual(['传入中文'])
  })

  it('空 hunk（两侧都没内容）可识别且完整', () => {
    const text = ['<<<<<<< HEAD', '=======', '>>>>>>> x'].join('\n')
    const parsed = parseConflictMarkers(text)
    expect(parsed.hunks).toHaveLength(1)
    expect(parsed.hunks[0].complete).toBe(true)
    expect(parsed.hunks[0].ours).toEqual([])
    expect(parsed.hunks[0].theirs).toEqual([])
    expect(parsed.problems).toEqual([])
  })
})

describe('异常冲突标记', () => {
  it('缺少结束行：块标记为不完整并报错', () => {
    const text = ['<<<<<<< HEAD', 'ours', '=======', 'theirs'].join('\n')
    const parsed = parseConflictMarkers(text)
    expect(parsed.hunks).toHaveLength(1)
    expect(parsed.hunks[0].complete).toBe(false)
    expect(parsed.hunks[0].problems.map((p) => p.kind)).toEqual(['missing-end'])
  })

  it('缺少分隔行：块不可自动合并', () => {
    const text = ['<<<<<<< HEAD', 'ours', '>>>>>>> x'].join('\n')
    const parsed = parseConflictMarkers(text)
    expect(parsed.hunks[0].complete).toBe(false)
    expect(parsed.hunks[0].problems.map((p) => p.kind)).toEqual(['missing-separator'])
  })

  it('孤立的分隔行/结束行/基准行会报错但不产生块', () => {
    const text = ['a', '=======', 'b', '>>>>>>> x', 'c', '||||||| base', 'd'].join('\n')
    const parsed = parseConflictMarkers(text)
    expect(parsed.hunks).toHaveLength(0)
    expect(parsed.problems.map((p) => p.kind)).toEqual([
      'stray-separator',
      'stray-end',
      'stray-base',
    ])
  })

  it('嵌套起始标记：不影响当前块，按内容记录并报错', () => {
    const text = [
      '<<<<<<< A',
      '<<<<<<< B',
      'ours',
      '=======',
      'theirs',
      '>>>>>>> C',
    ].join('\n')
    const parsed = parseConflictMarkers(text)
    expect(parsed.hunks).toHaveLength(1)
    expect(parsed.problems.map((p) => p.kind)).toEqual(['nested-start'])
    expect(parsed.hunks[0].ours).toEqual(['<<<<<<< B', 'ours'])
  })

  it('重复分隔行：按内容保留并报错', () => {
    const text = ['<<<<<<< A', 'ours', '=======', '=======', 'theirs', '>>>>>>> C'].join('\n')
    const parsed = parseConflictMarkers(text)
    expect(parsed.hunks[0].complete).toBe(true)
    expect(parsed.problems.map((p) => p.kind)).toEqual(['duplicate-separator'])
    expect(parsed.hunks[0].theirs).toEqual(['=======', 'theirs'])
  })
})

describe('resolveConflictText 合并', () => {
  const text = ['line1', '<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> feature', 'line2'].join(
    '\n',
  )

  it('采用当前', () => {
    expect(resolve(text, { 0: 'ours' })).toEqual({
      text: 'line1\nours\nline2',
      unresolved: [],
    })
  })

  it('采用传入', () => {
    expect(resolve(text, { 0: 'theirs' })).toEqual({
      text: 'line1\ntheirs\nline2',
      unresolved: [],
    })
  })

  it('两者保留：先当前后传入', () => {
    expect(resolve(text, { 0: 'both' })).toEqual({
      text: 'line1\nours\ntheirs\nline2',
      unresolved: [],
    })
  })

  it('未选择时保留原始标记并计入 unresolved', () => {
    expect(resolve(text, {})).toEqual({ text, unresolved: [0] })
  })

  it('多块按各自选择合并', () => {
    const multi = [
      'x',
      '<<<<<<< H1',
      'a1',
      '=======',
      'b1',
      '>>>>>>> T1',
      'mid',
      '<<<<<<< H2',
      'a2',
      '=======',
      'b2',
      '>>>>>>> T2',
      'y',
    ].join('\n')
    expect(resolve(multi, { 0: 'ours', 1: 'theirs' })).toEqual({
      text: 'x\na1\nmid\nb2\ny',
      unresolved: [],
    })
  })

  it('空 hunk 选择后整块消失', () => {
    const empty = ['a', '<<<<<<< HEAD', '=======', '>>>>>>> x', 'b'].join('\n')
    expect(resolve(empty, { 0: 'both' })).toEqual({ text: 'a\nb', unresolved: [] })
  })

  it('保留 CRLF 文件的末尾换行语义（输出统一为 \\n）', () => {
    const crlf = 'a\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> x\r\n'
    const parsed = parseConflictMarkers(crlf)
    const result = resolveConflictText(parsed.lines, parsed.hunks, { 0: 'theirs' })
    expect(result.text).toBe('a\ntheirs\n')
    expect(result.text.endsWith('\n')).toBe(true)
  })

  it('结构异常的块无论是否有选择都原样保留', () => {
    const broken = ['<<<<<<< HEAD', 'ours', '=======', 'theirs'].join('\n')
    const parsed = parseConflictMarkers(broken)
    const result = resolveConflictText(parsed.lines, parsed.hunks, { 0: 'ours' })
    expect(result.text).toBe(broken)
    expect(result.unresolved).toEqual([0])
  })

  it('allChoices 为所有块生成同一选择', () => {
    const parsed = parseConflictMarkers(text)
    expect(allChoices(parsed.hunks, 'both')).toEqual({ 0: 'both' })
  })
})

describe('hasConflictMarkers', () => {
  it('检测残留的起始/结束标记（含 CRLF）', () => {
    expect(hasConflictMarkers('a\n<<<<<<< HEAD\nb')).toBe(true)
    expect(hasConflictMarkers('a\r\n<<<<<<< HEAD\r\nb')).toBe(true)
    expect(hasConflictMarkers('a\n>>>>>>> other\nb')).toBe(true)
  })

  it('普通文本与已解决文本为 false', () => {
    expect(hasConflictMarkers('a\nb\nc')).toBe(false)
    expect(hasConflictMarkers('')).toBe(false)
  })
})
