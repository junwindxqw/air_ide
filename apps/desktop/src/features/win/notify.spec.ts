// P5-6 通知降级单测：系统通知失败/不可用时必须落应用内提示。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))

import { deliverNotification, notifyUser, scenes, type NotifySink } from './notify'
import { useNotificationStore } from './notifyStore'

function makeSink(overrides: Partial<NotifySink> = {}): NotifySink {
  return {
    system: vi.fn(async () => true),
    fallback: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  invokeMock.mockReset()
  useNotificationStore.getState().clear()
})

describe('deliverNotification', () => {
  it('系统通知成功时不走降级', async () => {
    const sink = makeSink()
    await expect(
      deliverNotification({ title: 't', body: 'b', level: 'info' }, sink),
    ).resolves.toBe('system')
    expect(sink.fallback).not.toHaveBeenCalled()
  })

  it('系统通知返回 false 时降级', async () => {
    const sink = makeSink({ system: vi.fn(async () => false) })
    await expect(
      deliverNotification({ title: 't', body: 'b', level: 'warning' }, sink),
    ).resolves.toBe('fallback')
    expect(sink.fallback).toHaveBeenCalledOnce()
  })

  it('系统通知抛错时降级且不向外抛', async () => {
    const sink = makeSink({
      system: vi.fn(async () => {
        throw new Error('托盘不可用')
      }),
    })
    await expect(
      deliverNotification({ title: 't', body: 'b', level: 'error' }, sink),
    ).resolves.toBe('fallback')
    expect(sink.fallback).toHaveBeenCalledWith(
      expect.objectContaining({ title: 't', level: 'error' }),
    )
  })
})

describe('notifyUser', () => {
  it('IPC 失败时写入应用内提示队列', async () => {
    invokeMock.mockRejectedValue(new Error('非 Windows'))
    await expect(
      notifyUser({ title: '安装失败', body: 'PHPantom', level: 'error' }),
    ).resolves.toBe('fallback')
    const messages = useNotificationStore.getState().messages
    expect(messages).toHaveLength(1)
    expect(messages[0].title).toBe('安装失败')
  })

  it('IPC 成功时不写应用内队列', async () => {
    invokeMock.mockResolvedValue(undefined)
    await expect(
      notifyUser({ title: '已安装', body: 'PHPantom', level: 'info' }),
    ).resolves.toBe('system')
    expect(useNotificationStore.getState().messages).toHaveLength(0)
  })
})

describe('通知文案', () => {
  it('LSP 安装失败带语言与错误信息', () => {
    const msg = scenes.lspInstallFailed('php', new Error('下载超时'))
    expect(msg.level).toBe('error')
    expect(msg.body).toContain('php')
    expect(msg.body).toContain('下载超时')
  })

  it('更新可用挂点包含版本号', () => {
    const msg = scenes.updateAvailable('0.2.0')
    expect(msg.scene).toBe('update-available')
    expect(msg.body).toContain('0.2.0')
  })
})
