// 多 tab 编辑模型（P1-5）：打开/关闭/切换/拖拽排序/脏标记/预览 tab/溢出下拉。
// 高频数据（文档文本）不进 store，由 CM6 实例持有（2.10）。
import { create } from 'zustand'
import type { FileMeta } from '@/ipc/fs'

export interface EditorTab {
  path: string
  /** 预览 tab：单击变固定（IntelliJ 语义） */
  preview: boolean
  dirty: boolean
  meta: FileMeta | null
  /** 每 tab 的文档快照键：切回时按 path 重新加载（P1 简化：文本由 store 暂存） */
  cursor: { line: number; col: number }
}

interface TabsState {
  tabs: EditorTab[]
  activePath: string | null
  /** 最近访问顺序（关闭后焦点回到上一个访问的 tab，3.9.2） */
  accessOrder: string[]
  /** 每 tab 的文本缓存（未保存内容；保存后清空） */
  textCache: Map<string, string>

  openFile: (path: string, meta: FileMeta, preview?: boolean) => void
  closeTab: (path: string) => void
  closeOthers: (path: string) => void
  setActive: (path: string) => void
  makePermanent: (path: string) => void
  setDirty: (path: string, dirty: boolean) => void
  setCursor: (path: string, line: number, col: number) => void
  cacheText: (path: string, text: string) => void
  getCachedText: (path: string) => string | undefined
  clearCache: (path: string) => void
  reorder: (from: number, to: number) => void
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activePath: null,
  accessOrder: [],
  textCache: new Map(),

  openFile: (path, meta, preview = true) => {
    const state = get()
    const existing = state.tabs.find((t) => t.path === path)
    if (existing) {
      // 已打开：激活；预览 tab 再次单击变固定
      set({ activePath: path })
      const accessOrder = [path, ...state.accessOrder.filter((p) => p !== path)]
      set({ accessOrder })
      return
    }
    // 新预览 tab 打开时，替换掉上一个未固定的预览 tab（IntelliJ 单预览 tab 语义：
    // 连续单击文件复用一个预览 tab，含当前正活跃的那个；脏 tab 不替换）
    let tabs = state.tabs
    if (preview) {
      const oldPreviewIdx = tabs.findIndex((t) => t.preview && !t.dirty)
      if (oldPreviewIdx >= 0) {
        tabs = tabs.filter((_, i) => i !== oldPreviewIdx)
      }
    }
    const tab: EditorTab = {
      path,
      preview,
      dirty: false,
      meta,
      cursor: { line: 1, col: 1 },
    }
    set({
      tabs: [...tabs, tab],
      activePath: path,
      accessOrder: [path, ...state.accessOrder.filter((p) => p !== path)],
    })
  },

  closeTab: (path) => {
    const state = get()
    const idx = state.tabs.findIndex((t) => t.path === path)
    if (idx < 0) return
    const tabs = state.tabs.filter((t) => t.path !== path)
    const accessOrder = state.accessOrder.filter((p) => p !== path)
    let activePath = state.activePath
    if (state.activePath === path) {
      // 3.9.2：焦点回到上一个访问的 tab（不是固定回第一个）
      const next = accessOrder.find((p) => tabs.some((t) => t.path === p)) ?? tabs[tabs.length - 1]?.path ?? null
      activePath = next
    }
    const textCache = new Map(state.textCache)
    textCache.delete(path)
    set({ tabs, activePath, accessOrder, textCache })
  },

  closeOthers: (path) => {
    const state = get()
    const keep = state.tabs.find((t) => t.path === path)
    if (!keep) return
    const textCache = new Map<string, string>()
    const cached = state.textCache.get(path)
    if (cached !== undefined) textCache.set(path, cached)
    set({
      tabs: [keep],
      activePath: path,
      accessOrder: [path],
      textCache,
    })
  },

  setActive: (path) => {
    const state = get()
    if (!state.tabs.some((t) => t.path === path)) return
    set({
      activePath: path,
      accessOrder: [path, ...state.accessOrder.filter((p) => p !== path)],
    })
  },

  makePermanent: (path) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, preview: false } : t)),
    })),

  setDirty: (path, dirty) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, dirty } : t)),
    })),

  setCursor: (path, line, col) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, cursor: { line, col } } : t)),
    })),

  cacheText: (path, text) =>
    set((s) => {
      const textCache = new Map(s.textCache)
      textCache.set(path, text)
      return { textCache }
    }),

  getCachedText: (path) => get().textCache.get(path),

  clearCache: (path) =>
    set((s) => {
      const textCache = new Map(s.textCache)
      textCache.delete(path)
      return { textCache }
    }),

  reorder: (from, to) =>
    set((s) => {
      const tabs = [...s.tabs]
      if (from < 0 || from >= tabs.length || to < 0 || to >= tabs.length) return s
      const [moved] = tabs.splice(from, 1)
      tabs.splice(to, 0, moved)
      return { tabs }
    }),
}))

