// 全局 diff 浮层（P2）：SplitDiff 从 ChangesPanel 内提出，
// 供双击 Changes 行、测试桥、将来的 blame/hunk 操作共用。
import { create } from 'zustand'
import { gitDiffFile, type FileDiff } from '@/ipc/git'
import { useUiStore } from '@/app/uiStore'

interface DiffOverlayState {
  diff: FileDiff | null
  loading: boolean
  ignoreWs: boolean
  open: (relPath: string, staged?: boolean) => Promise<void>
  close: () => void
  setIgnoreWs: (v: boolean) => void
}

export const useDiffOverlay = create<DiffOverlayState>((set, get) => ({
  diff: null,
  loading: false,
  ignoreWs: false,

  open: async (relPath, staged = false) => {
    const root = useUiStore.getState().workspaceRoot
    if (!root) return
    set({ loading: true })
    try {
      const diff = await gitDiffFile(root, relPath, staged, get().ignoreWs)
      set({ diff, loading: false })
    } catch (e) {
      console.error('打开 diff 失败', e)
      set({ loading: false })
    }
  },

  close: () => set({ diff: null }),

  setIgnoreWs: (v) => {
    set({ ignoreWs: v })
    // 切换后重开当前 diff
    const current = get().diff
    if (current) void get().open(current.path)
  },
}))

/** 供测试桥与命令使用的函数式入口。 */
export async function openDiffFor(relPath: string): Promise<void> {
  await useDiffOverlay.getState().open(relPath)
}

export function closeDiff(): void {
  useDiffOverlay.getState().close()
}
