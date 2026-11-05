// UI 状态：工具窗可见性、焦点模型（3.9.2）。
import { create } from 'zustand'

// [[NEXT]]

interface UiState {
  leftOpen: boolean
  rightOpen: boolean
  lastToolWindow: 'left' | 'right' | null
  workspaceRoot: string | null
  toggleLeft: () => void
  toggleRight: () => void
  hideActiveToolWindow: () => void
  focusEditor: () => void
  registerFocusEditor: (fn: (() => void) | null) => void
  setWorkspaceRoot: (p: string) => void
}

let focusEditorFn: (() => void) | null = null

export const useUiStore = create<UiState>((set, get) => ({
  leftOpen: true,
  rightOpen: true,
  lastToolWindow: null,
  workspaceRoot: null,
  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
  hideActiveToolWindow: () => {
    const last = get().lastToolWindow
    if (last === 'left') set({ leftOpen: false })
    if (last === 'right') set({ rightOpen: false })
  },
  focusEditor: () => focusEditorFn?.(),
  registerFocusEditor: (fn) => {
    focusEditorFn = fn
  },
  setWorkspaceRoot: (p) => set({ workspaceRoot: p }),
}))
