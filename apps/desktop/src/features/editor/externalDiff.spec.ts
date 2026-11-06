// 「对比差异」路径换算单测（修复 5）：Windows 反斜杠/大小写也要能定位工作区相对路径。
import { describe, expect, it } from 'vitest'
import { workspaceRelPath } from '@/features/editor/externalDiff'

describe('workspaceRelPath', () => {
  it('无工作区 → null（UI 明确提示）', () => {
    expect(workspaceRelPath(null, 'C:/work/a.ts')).toBeNull()
  })

  it('Windows 反斜杠 + 大小写差异 → 相对路径', () => {
    expect(workspaceRelPath('c:\\work', 'C:/work/src/a.ts')).toBe('src/a.ts')
  })

  it('工作区外文件 → null', () => {
    expect(workspaceRelPath('C:/work', 'C:/other/a.ts')).toBeNull()
  })

  it('工作区根目录本身 → null', () => {
    expect(workspaceRelPath('C:/work/', 'C:/work')).toBeNull()
  })
})
