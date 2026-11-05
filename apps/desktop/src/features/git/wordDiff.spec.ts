import { describe, expect, it } from 'vitest'
import { wordDiff } from '@/features/git/wordDiff'

describe('wordDiff 词级高亮', () => {
  it('公共前缀后缀裁剪：只标中间差异', () => {
    const { del, add } = wordDiff('$price = 100;', '$price = 200;')
    expect(del).toEqual([{ start: 9, end: 12 }])
    expect(add).toEqual([{ start: 9, end: 12 }])
  })

  it('纯新增（旧行为空）', () => {
    const { del, add } = wordDiff('', 'abc')
    expect(del).toEqual([])
    expect(add).toEqual([{ start: 0, end: 3 }])
  })

  it('纯删除（新行为空）', () => {
    const { del, add } = wordDiff('abc', '')
    expect(del).toEqual([{ start: 0, end: 3 }])
    expect(add).toEqual([])
  })

  it('完全相同 → 无差异', () => {
    const { del, add } = wordDiff('same', 'same')
    expect(del).toEqual([])
    expect(add).toEqual([])
  })

  it('中间插入：pay() → payNow()（整个标识符高亮）', () => {
    const { add } = wordDiff('pay()', 'payNow()')
    expect(add).toEqual([{ start: 0, end: 6 }])
  })

  it('词中部变更：整个词高亮（abcdef → abXef）', () => {
    const { del } = wordDiff('abcdef', 'abXef')
    expect(del).toEqual([{ start: 0, end: 6 }])
  })

  it('中文行：按字符处理', () => {
    const { del, add } = wordDiff('你好世界', '你好新世界')
    expect(add.length).toBeGreaterThan(0)
    expect(del).toEqual([])
  })

  it('区间不重叠且有序', () => {
    const { del, add } = wordDiff('a1b2c3', 'aXbYc3')
    for (const list of [del, add]) {
      for (let i = 1; i < list.length; i++) {
        expect(list[i].start).toBeGreaterThanOrEqual(list[i - 1].end)
      }
    }
  })
})
