// 设置的运行时状态：启动 hydration（此前只有设置页打开时才读盘）+ 外观落地。
// 纯函数（resolveTheme / editorCssVars）与 store 分开，便于单测。
import { create } from 'zustand'
import { settings as settingsIpc, type Settings } from '@/ipc/session'

/** 与 Rust air-workspace 的 Default 实现保持一致（settings.json 缺失/损坏时兜底）。 */
export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  editor: {
    fontSize: 13,
    lineHeight: 1.2,
    lineNumbers: true,
    currentLineHighlight: true,
    autoRevealInTree: true,
    saveOnFocusLoss: true,
    largeFileThresholdMb: 2,
    readonlyThresholdMb: 10,
  },
  appearance: { theme: 'system' },
  git: {
    exePath: null,
    signoff: true,
    ignoreWhitespace: false,
    statusThrottleMs: 500,
    diffDefaultSplit: true,
  },
  system: { singleInstance: true, autoUpdate: true, defenderHint: true },
}

export type ResolvedTheme = 'darcula-dark' | 'intellij-light'

/** 'system' 按系统深浅色解析；其余原样返回（未知值回退到系统解析）。 */
export function resolveTheme(theme: string, prefersDark: boolean): ResolvedTheme {
  if (theme === 'darcula-dark' || theme === 'intellij-light') return theme
  return prefersDark ? 'darcula-dark' : 'intellij-light'
}

/**
 * 编辑器字号/行高走 CSS 变量（darcula 主题里引用，见 features/editor/darcula.ts）。
 * 行高按「字号 × 行高」四舍五入为整数 px（3.12.2：高 DPI 下避免光标与文字错位半个像素）。
 */
export function editorCssVars(editor: Settings['editor']): {
  fontSize: string
  lineHeight: string
} {
  const lineHeightPx = Math.round(editor.fontSize * editor.lineHeight)
  return { fontSize: `${editor.fontSize}px`, lineHeight: `${lineHeightPx}px` }
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 把设置落到 document（主题 data-theme + 编辑器 CSS 变量），返回实际主题。 */
export function applySettingsToDocument(s: Settings, prefersDark = systemPrefersDark()): ResolvedTheme {
  const theme = resolveTheme(s.appearance.theme, prefersDark)
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    root.dataset.theme = theme
    const vars = editorCssVars(s.editor)
    root.style.setProperty('--editor-font-size', vars.fontSize)
    root.style.setProperty('--editor-line-height', vars.lineHeight)
  }
  return theme
}

interface SettingsRuntimeState {
  settings: Settings
  loaded: boolean
  hydrate: () => Promise<void>
  save: (s: Settings) => Promise<void>
}

export const useSettingsStore = create<SettingsRuntimeState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  hydrate: async () => {
    try {
      const loaded = await settingsIpc.load()
      set({ settings: loaded, loaded: true })
      applySettingsToDocument(loaded)
    } catch (e) {
      // 设置读盘失败不阻塞启动：用默认值并记录
      console.error('设置加载失败，使用默认值', e)
      set({ loaded: true })
      applySettingsToDocument(get().settings)
    }
  },

  save: async (s) => {
    await settingsIpc.save(s)
    set({ settings: s })
    applySettingsToDocument(s)
  },
}))
