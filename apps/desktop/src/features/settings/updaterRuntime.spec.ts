// P5-7：更新状态机与错误分类单测（有更新 / 无更新 / 签名错误 / 404 / 平台不匹配）。
import { describe, expect, it, vi } from 'vitest'
import {
  classifyUpdaterError,
  createUpdaterStore,
  progressPercent,
  type UpdateHandle,
  type UpdaterClient,
} from '@/features/settings/updaterRuntime'

function makeUpdate(version = '0.2.0', overrides: Partial<UpdateHandle> = {}): UpdateHandle {
  return {
    version,
    body: '修复若干问题',
    date: '2026-11-05T00:00:00Z',
    download: vi.fn(async (onEvent) => {
      onEvent?.({ event: 'Started', data: { contentLength: 1000 } })
      onEvent?.({ event: 'Progress', data: { chunkLength: 500 } })
      onEvent?.({ event: 'Finished' })
    }),
    install: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    ...overrides,
  }
}

function makeClient(check: UpdaterClient['check']): UpdaterClient {
  return { check }
}

describe('更新状态机', () => {
  it('有更新：check 返回 0.2.0 → available，下载安装后进入 restarting', async () => {
    const store = createUpdaterStore(makeClient(async () => makeUpdate()))
    await store.getState().check()
    expect(store.getState().phase).toBe('available')
    expect(store.getState().update?.version).toBe('0.2.0')

    await store.getState().downloadAndInstall()
    const s = store.getState()
    expect(s.phase).toBe('restarting')
    expect(s.progress).toBeUndefined()
  })

  it('无更新：check 返回 null → up-to-date', async () => {
    const store = createUpdaterStore(makeClient(async () => null))
    await store.getState().check()
    expect(store.getState().phase).toBe('up-to-date')
    expect(store.getState().update).toBeUndefined()
    expect(store.getState().lastCheckedAt).toBeTypeOf('number')
  })

  it('404：清单不可用 → error，归类 network，原始错误不丢', async () => {
    const store = createUpdaterStore(
      makeClient(async () => {
        throw new Error('Could not fetch a valid release JSON from the remote')
      }),
    )
    await store.getState().check()
    const s = store.getState()
    expect(s.phase).toBe('error')
    expect(s.error?.kind).toBe('network')
    expect(s.error?.raw).toContain('Could not fetch a valid release JSON')
  })

  it('签名错误：下载阶段验签失败 → error，归类 signature，且不进入 installing', async () => {
    const handle = makeUpdate('0.2.0', {
      download: vi.fn(async (onEvent) => {
        onEvent?.({ event: 'Started', data: { contentLength: 1000 } })
        throw new Error('Signature verification failed: minisign signature is invalid')
      }),
    })
    const store = createUpdaterStore(makeClient(async () => handle))
    await store.getState().check()
    expect(store.getState().phase).toBe('available')

    await store.getState().downloadAndInstall()
    const s = store.getState()
    expect(s.phase).toBe('error')
    expect(s.error?.kind).toBe('signature')
    expect(handle.install).not.toHaveBeenCalled()
  })

  it('平台不匹配：清单缺少当前平台 → error，归类 platform', async () => {
    const store = createUpdaterStore(
      makeClient(async () => {
        throw new Error(
          'the platform `windows-x86_64-nsis` was not found in the response `platforms` object',
        )
      }),
    )
    await store.getState().check()
    expect(store.getState().error?.kind).toBe('platform')
  })

  it('下载进度：Progress 事件累计并换算百分比', async () => {
    const handle = makeUpdate('0.2.0', {
      download: vi.fn(async (onEvent) => {
        onEvent?.({ event: 'Started', data: { contentLength: 2000 } })
        onEvent?.({ event: 'Progress', data: { chunkLength: 500 } })
        onEvent?.({ event: 'Progress', data: { chunkLength: 500 } })
        // 等待断言前保持在 downloading
        await new Promise((r) => setTimeout(r, 0))
      }),
      install: vi.fn(async () => {}),
    })
    const store = createUpdaterStore(makeClient(async () => handle))
    await store.getState().check()
    const task = store.getState().downloadAndInstall()
    await vi.waitFor(() => {
      expect(store.getState().progress?.received).toBe(1000)
    })
    expect(progressPercent(store.getState().progress)).toBe(50)
    await task
    expect(store.getState().phase).toBe('restarting')
  })

  it('安装前先清理运行标记；清理失败不阻塞安装', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const order: string[] = []
    const beforeInstall = vi.fn(async () => {
      order.push('marker')
      throw new Error('app_clear_running_marker not found')
    })
    const handle = makeUpdate('0.2.0', {
      install: vi.fn(async () => {
        order.push('install')
      }),
    })
    const store = createUpdaterStore(makeClient(async () => handle), beforeInstall)
    await store.getState().check()
    await store.getState().downloadAndInstall()

    expect(beforeInstall).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['marker', 'install'])
    expect(store.getState().phase).toBe('restarting')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('安装失败 → error，保留 update 以便重试', async () => {
    const handle = makeUpdate('0.2.0', {
      install: vi.fn(async () => {
        throw new Error('error sending request: connection reset')
      }),
    })
    const store = createUpdaterStore(makeClient(async () => handle))
    await store.getState().check()
    await store.getState().downloadAndInstall()
    const s = store.getState()
    expect(s.phase).toBe('error')
    expect(s.error?.kind).toBe('network')
    expect(s.update?.version).toBe('0.2.0')
  })

  it('静默检查失败不抛出，但记录 silent 标记，避免静默吞错', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createUpdaterStore(
      makeClient(async () => {
        throw new Error('error sending request for url (https://example.com/latest.json)')
      }),
    )
    await expect(store.getState().check({ silent: true })).resolves.toBeUndefined()
    const s = store.getState()
    expect(s.phase).toBe('error')
    expect(s.error?.silent).toBe(true)
    expect(s.error?.kind).toBe('network')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('重新检查会释放上一次的 Update 资源', async () => {
    const first = makeUpdate('0.2.0')
    const store = createUpdaterStore(makeClient(async () => first))
    await store.getState().check()
    await store.getState().check()
    expect(first.close).toHaveBeenCalledTimes(1)
  })
})

describe('错误分类', () => {
  it('未知错误保留原文，不吞错', () => {
    const info = classifyUpdaterError(new Error('something unexpected'))
    expect(info.kind).toBe('unknown')
    expect(info.raw).toBe('something unexpected')
  })

  it('非 Tauri 环境归为 unsupported', () => {
    const info = classifyUpdaterError('当前环境不是桌面应用，无法使用应用内更新')
    expect(info.kind).toBe('unsupported')
  })

  it('字符串形式的 IPC 错误同样可归类', () => {
    expect(classifyUpdaterError('Signature verification failed').kind).toBe('signature')
  })
})

describe('进度换算', () => {
  it('总大小未知时返回 undefined', () => {
    expect(progressPercent({ received: 10 })).toBeUndefined()
    expect(progressPercent(undefined)).toBeUndefined()
  })
})
