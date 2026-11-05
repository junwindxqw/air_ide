// 文件树状态（P1-4）：懒加载目录、展开态、右键菜单目标、自动定位。
import { create } from 'zustand'
import { fsListDir, type TreeEntry } from '@/ipc/fs'

interface ExplorerState {
  root: string | null
  /** dir → 子条目（懒加载缓存） */
  children: Map<string, TreeEntry[]>
  expanded: Set<string>
  loadingDirs: Set<string>
  selected: string | null
  /** 右键菜单目标（null = 菜单关闭） */
  contextTarget: { path: string; isDir: boolean; x: number; y: number } | null
  /** 自动定位：用户手动滚动后暂停跟随，直到下次点击文件树 */
  autoReveal: boolean

  setRoot: (root: string | null) => void
  loadDir: (dir: string, force?: boolean) => Promise<void>
  toggleDir: (dir: string) => Promise<void>
  select: (path: string | null) => void
  openContextMenu: (target: { path: string; isDir: boolean; x: number; y: number } | null) => void
  setAutoReveal: (v: boolean) => void
  /** 外部变更后刷新受影响的目录 */
  refreshDir: (dir: string) => Promise<void>
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  root: null,
  children: new Map(),
  expanded: new Set(),
  loadingDirs: new Set(),
  selected: null,
  contextTarget: null,
  autoReveal: true,

  setRoot: (root) =>
    set({
      root,
      children: new Map(),
      expanded: new Set(),
      selected: null,
      loadingDirs: new Set(),
    }),

  loadDir: async (dir, force = false) => {
    const state = get()
    if (!force && state.children.has(dir)) return
    const loading = new Set(state.loadingDirs)
    loading.add(dir)
    set({ loadingDirs: loading })
    try {
      const entries = await fsListDir(dir)
      const children = new Map(get().children)
      children.set(dir, entries)
      set({ children })
    } finally {
      const loading2 = new Set(get().loadingDirs)
      loading2.delete(dir)
      set({ loadingDirs: loading2 })
    }
  },

  toggleDir: async (dir) => {
    const expanded = new Set(get().expanded)
    if (expanded.has(dir)) {
      expanded.delete(dir)
      set({ expanded })
    } else {
      expanded.add(dir)
      set({ expanded })
      await get().loadDir(dir)
    }
  },

  select: (path) => set({ selected: path, autoReveal: false }),
  openContextMenu: (target) => set({ contextTarget: target }),
  setAutoReveal: (v) => set({ autoReveal: v }),

  refreshDir: async (dir) => {
    const children = new Map(get().children)
    children.delete(dir)
    set({ children })
    await get().loadDir(dir, true)
  },
}))

