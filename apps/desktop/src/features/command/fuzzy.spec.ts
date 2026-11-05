import { describe, expect, it } from 'vitest'
import { nucleoScore } from '@/features/command/fuzzy'

describe('nucleoScore 模糊匹配', () => {
  it('精确子序列命中', () => {
    expect(nucleoScore('git commit', 'commit')).toBeGreaterThan(0)
  })

  it('缩写命中（osvc → OrderService）', () => {
    expect(nucleoScore('OrderService', 'osvc')).toBeGreaterThan(0)
  })

  it('非子序列不命中', () => {
    expect(nucleoScore('OrderService', 'zzz')).toBe(0)
  })

  it('空 query 返回 1', () => {
    expect(nucleoScore('anything', '  ')).toBe(1)
  })

  it('前缀完整匹配得分高于中间匹配', () => {
    const prefix = nucleoScore('commit', 'commit')
    const middle = nucleoScore('git commit message', 'commit')
    expect(prefix).toBeGreaterThan(middle)
  })

  it('大小写不敏感', () => {
    expect(nucleoScore('OrderService', 'OSVC')).toBe(
      nucleoScore('OrderService', 'osvc'),
    )
  })
})
