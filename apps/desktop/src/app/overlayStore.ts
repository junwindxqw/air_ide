// 浮层状态：命令面板 / 快速打开 / 全局搜索的开关（互斥）。
import { create } from 'zustand'

interface OverlayState {
  paletteOpen: boolean
  quickOpenOpen: boolean
  searchOpen: boolean
  settingsOpen: boolean
  commandBarOpen: boolean
  openPalette: () => void
  openQuickOpen: () => void
  openSearch: () => void
  openSettings: () => void
  openCommandBar: () => void
  closeAll: () => void
}

export const useOverlayStore = create<OverlayState>((set) => ({
  paletteOpen: false,
  quickOpenOpen: false,
  searchOpen: false,
  settingsOpen: false,
  commandBarOpen: false,
  openPalette: () =>
    set({ paletteOpen: true, quickOpenOpen: false, searchOpen: false, settingsOpen: false, commandBarOpen: false }),
  openQuickOpen: () =>
    set({ paletteOpen: false, quickOpenOpen: true, searchOpen: false, settingsOpen: false, commandBarOpen: false }),
  openSearch: () =>
    set({ paletteOpen: false, quickOpenOpen: false, searchOpen: true, settingsOpen: false, commandBarOpen: false }),
  openSettings: () =>
    set({ paletteOpen: false, quickOpenOpen: false, searchOpen: false, settingsOpen: true, commandBarOpen: false }),
  openCommandBar: () =>
    set({ paletteOpen: false, quickOpenOpen: false, searchOpen: false, settingsOpen: false, commandBarOpen: true }),
  closeAll: () =>
    set({ paletteOpen: false, quickOpenOpen: false, searchOpen: false, settingsOpen: false, commandBarOpen: false }),
}))
