// 设置 hydration 单测（修复 1）：启动读盘、失败回退默认、主题/字号变量解析。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '@/ipc/session'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

import {
  DEFAULT_SETTINGS,
  applySettingsToDocument,
  editorCssVars,
  resolveTheme,
  useSettingsStore,
} from '@/features/settings/settingsRuntime'

const custom: Settings = {
  ...DEFAULT_SETTINGS,
  editor: { ...DEFAULT_SETTINGS.editor, fontSize: 16, lineHeight: 1.5, lineNumbers: false },
  appearance: { theme: 'intellij-light' },
  system: { ...DEFAULT_SETTINGS.system, defenderHint: false },
}

beforeEach(() => {
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, loaded: false })
  invokeMock.mockReset()
})

describe('settings hydration', () => {
  it('启动时从 IPC 读取并写入 store', async () => {
    invokeMock.mockResolvedValue(custom)
    await useSettingsStore.getState().hydrate()
    const s = useSettingsStore.getState()
    expect(s.loaded).toBe(true)
    expect(s.settings.editor.fontSize).toBe(16)
    expect(s.settings.editor.lineNumbers).toBe(false)
    expect(s.settings.appearance.theme).toBe('intellij-light')
    expect(s.settings.system.defenderHint).toBe(false)
  })

  it('读盘失败 → 保持默认值且不阻塞启动', async () => {
    invokeMock.mockRejectedValue(new Error('boom'))
    await useSettingsStore.getState().hydrate()
    const s = useSettingsStore.getState()
    expect(s.loaded).toBe(true)
    expect(s.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('save 落盘后立即更新 store 与外观', async () => {
    invokeMock.mockResolvedValue(undefined)
    await useSettingsStore.getState().save(custom)
    expect(invokeMock).toHaveBeenCalledWith('app_settings_save', { settings: custom })
    expect(useSettingsStore.getState().settings.editor.fontSize).toBe(16)
  })
})

describe('外观解析', () => {
  it('system 跟随系统深浅色', () => {
    expect(resolveTheme('system', true)).toBe('darcula-dark')
    expect(resolveTheme('system', false)).toBe('intellij-light')
  })

  it('显式主题优先于系统', () => {
    expect(resolveTheme('darcula-dark', false)).toBe('darcula-dark')
    expect(resolveTheme('intellij-light', true)).toBe('intellij-light')
  })

  it('字号/行高转 CSS 变量值（行高取整为整数 px，3.12.2）', () => {
    expect(editorCssVars(custom.editor)).toEqual({ fontSize: '16px', lineHeight: '24px' })
  })

  it('默认 13px × 1.2 取整为 16px', () => {
    expect(editorCssVars(DEFAULT_SETTINGS.editor)).toEqual({
      fontSize: '13px',
      lineHeight: '16px',
    })
  })

  it('apply 返回实际主题（node 环境不操作 document）', () => {
    expect(applySettingsToDocument(custom, true)).toBe('intellij-light')
    expect(applySettingsToDocument(custom, false)).toBe('intellij-light')
  })
})
