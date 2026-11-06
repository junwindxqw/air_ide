// 编码切换决策单测（修复 4）：重新解释在当前后端不可用，不能静默“成功”。
import { describe, expect, it } from 'vitest'
import { resolveEncodingDecision } from '@/features/editor/encoding'

describe('resolveEncodingDecision', () => {
  it('转换并保存始终可执行', () => {
    expect(resolveEncodingDecision('convert', 'utf-8', 'gb18030')).toBe('convert')
  })

  it('重新解释到相同编码 → 无变化', () => {
    expect(resolveEncodingDecision('reinterpret', 'gb18030', 'gb18030')).toBe('noop')
  })

  it('重新解释到不同编码 → 后端不支持（明确不可用）', () => {
    expect(resolveEncodingDecision('reinterpret', 'utf-8', 'gb18030')).toBe('unsupported')
    expect(resolveEncodingDecision('reinterpret', 'latin1', 'utf-16le')).toBe('unsupported')
  })
})
