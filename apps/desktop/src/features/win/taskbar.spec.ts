// P5-6 任务栏进度包装层单测：成功/失败都必须结束进度，进度上报失败不影响主任务。
import { describe, expect, it, vi } from 'vitest'
import { newTaskId, runWithTaskbar, type TaskbarPort } from './taskbar'

function makePort(overrides: Partial<TaskbarPort> = {}): TaskbarPort {
  return {
    begin: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('runWithTaskbar', () => {
  it('成功时 begin 后以 failed=false 结束', async () => {
    const port = makePort()
    const result = await runWithTaskbar(port, 't1', '读取文件', async () => 42)
    expect(result).toBe(42)
    expect(port.begin).toHaveBeenCalledWith('t1', '读取文件')
    expect(port.end).toHaveBeenCalledWith('t1', false)
  })

  it('失败时标记 failed=true 并向上抛出', async () => {
    const port = makePort()
    await expect(
      runWithTaskbar(port, 't2', 'Git push', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(port.end).toHaveBeenCalledWith('t2', true)
  })

  it('begin 失败被吞掉，主任务仍执行', async () => {
    const port = makePort({
      begin: vi.fn(async () => {
        throw new Error('任务栏不可用')
      }),
    })
    await expect(runWithTaskbar(port, 't3', undefined, async () => 'ok')).resolves.toBe('ok')
    expect(port.end).toHaveBeenCalledWith('t3', false)
  })

  it('end 失败被吞掉，不影响返回值', async () => {
    const port = makePort({
      end: vi.fn(async () => {
        throw new Error('清理失败')
      }),
    })
    await expect(runWithTaskbar(port, 't4', undefined, async () => 'ok')).resolves.toBe('ok')
  })
})

describe('newTaskId', () => {
  it('并发生成不重复', () => {
    const ids = new Set([newTaskId('fs'), newTaskId('fs'), newTaskId('fs')])
    expect(ids.size).toBe(3)
  })
})
