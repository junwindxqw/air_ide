// 浮层状态：命令面板 / 快速打开 / 全局搜索的开关（互斥）。
import { create } from 'zustand'

interface OverlayState {
  paletteOpen: boolean
  quickOpenOpen: boolean
  searchOpen: boolean
  settingsOpen: boolean
  commandBarOpen: boolean
  serverPanelOpen: boolean
  openPalette: () => void
  openQuickOpen: () => void
  openSearch: () => void
  openSettings: () => void
  openCommandBar: () => void
  openServerPanel: () => void
  closeAll: () => void
}

export const useOverlayStore = create<OverlayState>((set) => ({
  paletteOpen: false,
  quickOpenOpen: false,
  searchOpen: false,
  settingsOpen: false,
  commandBarOpen: false,
  serverPanelOpen: false,
  openPalette: () =>
    set({ paletteOpen: true, quickOpenOpen: false, searchOpen: false, settingsOpen: false, commandBarOpen: false, serverPanelOpen: false }),
  openQuickOpen: () =>
    set({ paletteOpen: false, quickOpenOpen: true, searchOpen: false, settingsOpen: false, commandBarOpen: false, serverPanelOpen: false }),
  openSearch: () =>
    set({ paletteOpen: false, quickOpenOpen: false, searchOpen: true, settingsOpen: false, commandBarOpen: false, serverPanelOpen: false }),
  openSettings: () =>
    set({ paletteOpen: false, quickOpenOpen: false, searchOpen: false, settingsOpen: true, commandBarOpen: false, serverPanelOpen: false }),
  openCommandBar: () =>
    set({ paletteOpen: false, quickOpenOpen: false, searchOpen: false, settingsOpen: false, commandBarOpen: true, serverPanelOpen: false }),
  openServerPanel: () =>
    set({ paletteOpen: false, quickOpenOpen: false, searchOpen: false, settingsOpen: false, commandBarOpen: false, serverPanelOpen: true }),
  closeAll: () =>
    set({ paletteOpen: false, quickOpenOpen: false, searchOpen: false, settingsOpen: false, commandBarOpen: false, serverPanelOpen: false }),
}))
