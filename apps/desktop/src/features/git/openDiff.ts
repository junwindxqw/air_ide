// 全局 diff 浮层（P2）：SplitDiff 从 ChangesPanel 内提出，
// 供双击 Changes 行、测试桥、将来的 blame/hunk 操作共用。
import { create } from 'zustand'
import { gitDiffWithRaw, type FileDiff } from '@/ipc/git'
import { useUiStore } from '@/app/uiStore'
import { perfStart, perfEnd } from '@/app/perf'

interface DiffOverlayState {
  diff: FileDiff | null
  /** 原始 git diff 文本（hunk 操作的 patch 源，3.7.2） */
  diffText: string
  loading: boolean
  ignoreWs: boolean
  open: (relPath: string, staged?: boolean) => Promise<void>
  close: () => void
  setIgnoreWs: (v: boolean) => void
}

export const useDiffOverlay = create<DiffOverlayState>((set, get) => ({
  diff: null,
  diffText: '',
  loading: false,
  ignoreWs: false,

  open: async (relPath, staged = false) => {
    const root = useUiStore.getState().workspaceRoot
    if (!root) return
    // diff 打开计时起点（含 git diff 拉取 + 解析；终点在 SplitDiff 首帧）
    perfStart('air.diff_render')
    perfStart('air.diff_fetch')
    set({ loading: true })
    try {
      // 解析 + 原文合成一次 IPC（P5-2：少一个 git 进程）
      const { diff, raw } = await gitDiffWithRaw(root, relPath, staged, get().ignoreWs)
      perfEnd('air.diff_fetch')
      set({ diff, diffText: raw, loading: false })
    } catch (e) {
      console.error('打开 diff 失败', e)
      set({ loading: false })
    }
  },

  close: () => set({ diff: null, diffText: '' }),

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
