// 大文件阈值判定单测（修复 2）：2MB 降级 / 10MB 只读 / isLarge 强制只读。
import { describe, expect, it } from 'vitest'
import { MB, resolveEditorMode } from '@/features/editor/mode'

const limits = { largeFileThresholdMb: 2, readonlyThresholdMb: 10 }
const meta = (size: number, isLarge = false) => ({ size, isLarge })

describe('resolveEditorMode', () => {
  it('小文件不降级', () => {
    expect(resolveEditorMode(meta(1 * MB), limits)).toEqual({ large: false, readonly: false })
  })

  it('恰好等于降级阈值不触发（严格大于）', () => {
    expect(resolveEditorMode(meta(2 * MB), limits)).toEqual({ large: false, readonly: false })
  })

  it('超过 2MB → 关闭 LSP/折叠，但可编辑', () => {
    expect(resolveEditorMode(meta(2 * MB + 1), limits)).toEqual({ large: true, readonly: false })
  })

  it('恰好等于只读阈值仍可编辑', () => {
    expect(resolveEditorMode(meta(10 * MB), limits)).toEqual({ large: true, readonly: false })
  })

  it('超过 10MB → 只读', () => {
    expect(resolveEditorMode(meta(10 * MB + 1), limits)).toEqual({ large: true, readonly: true })
  })

  it('后端 isLarge（>10MB 判定）优先 → 只读', () => {
    // 即便前端阈值被调大，后端 isLarge 仍强制只读
    expect(resolveEditorMode(meta(12 * MB, true), { ...limits, readonlyThresholdMb: 90 })).toEqual({
      large: true,
      readonly: true,
    })
  })

  it('设置阈值生效：调低降级阈值后更早降级', () => {
    expect(
      resolveEditorMode(meta(1.5 * MB), { largeFileThresholdMb: 1, readonlyThresholdMb: 10 }),
    ).toEqual({ large: true, readonly: false })
  })
})
