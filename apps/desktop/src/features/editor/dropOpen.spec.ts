// 拖拽路由单测（修复 3）：单目录 → openWorkspace；多选/非目录 → 明确结果码（由 UI flash）。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fsListDirMock, openWorkspaceMock } = vi.hoisted(() => ({
  fsListDirMock: vi.fn(),
  openWorkspaceMock: vi.fn(),
}))

vi.mock('@/ipc/fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ipc/fs')>()),
  fsListDir: fsListDirMock,
}))
vi.mock('@/features/command/commands', () => ({ openWorkspace: openWorkspaceMock }))

import { handleDroppedPaths } from '@/features/editor/dropOpen'

beforeEach(() => {
  fsListDirMock.mockReset()
  openWorkspaceMock.mockReset()
})

describe('handleDroppedPaths', () => {
  it('空路径 → 忽略', async () => {
    expect(await handleDroppedPaths([])).toBe('none')
    expect(openWorkspaceMock).not.toHaveBeenCalled()
  })

  it('多个路径 → 不打开，返回 multiple', async () => {
    expect(await handleDroppedPaths(['C:/a', 'C:/b'])).toBe('multiple')
    expect(openWorkspaceMock).not.toHaveBeenCalled()
  })

  it('单个目录（list_dir 成功）→ 打开工作区', async () => {
    fsListDirMock.mockResolvedValue([])
    expect(await handleDroppedPaths(['C:/work'])).toBe('opened')
    expect(openWorkspaceMock).toHaveBeenCalledWith('C:/work')
  })

  it('单个文件（list_dir 失败）→ 不打开，返回 not-folder', async () => {
    fsListDirMock.mockRejectedValue(new Error('not a directory'))
    expect(await handleDroppedPaths(['C:/work/main.ts'])).toBe('not-folder')
    expect(openWorkspaceMock).not.toHaveBeenCalled()
  })

  it('openWorkspace 失败 → failed（不抛出未处理拒绝）', async () => {
    fsListDirMock.mockResolvedValue([])
    openWorkspaceMock.mockRejectedValue(new Error('watch failed'))
    expect(await handleDroppedPaths(['C:/work'])).toBe('failed')
  })
})
