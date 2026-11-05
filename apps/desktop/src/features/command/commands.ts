// P0/P1 命令注册：文件与视图类。注册发生在 import 时（App 显式 import 本模块）。
import { appOpenDialog } from '@/ipc/fs'
import { registerCommand } from '@/features/command/registry'
import { useEditorStore } from '@/features/editor/store'
import { useUiStore } from '@/app/uiStore'
import { useOverlayStore } from '@/app/overlayStore'
import { useExplorerStore } from '@/features/explorer/store'
import { fsWatch } from '@/ipc/watch'
import { recentProjects } from '@/ipc/session'

registerCommand({
  id: 'file.open',
  title: '打开文件…',
  category: '文件',
  run: async () => {
    const path = await appOpenDialog('file')
    if (path) await useEditorStore.getState().openFile(path)
  },
})

registerCommand({
  id: 'file.open_folder',
  title: '打开文件夹…',
  category: '文件',
  run: async () => {
    const path = await appOpenDialog('folder')
    if (path) await openWorkspace(path)
  },
})

registerCommand({
  id: 'file.save',
  title: '保存',
  category: '文件',
  keybinding: 'Ctrl+S',
  run: () => useEditorStore.getState().saveFile(),
})

registerCommand({
  id: 'view.toggle_left',
  title: '切换 Project 工具窗',
  category: '视图',
  keybinding: 'Alt+1',
  run: () => useUiStore.getState().toggleLeft(),
})

registerCommand({
  id: 'view.toggle_right',
  title: '切换 Git 工具窗',
  category: '视图',
  keybinding: 'Alt+9',
  run: () => useUiStore.getState().toggleRight(),
})

registerCommand({
  id: 'view.focus_editor',
  title: '聚焦编辑器',
  category: '视图',
  keybinding: 'Escape',
  run: () => useUiStore.getState().focusEditor(),
})

registerCommand({
  id: 'view.command_palette',
  title: '查找命令',
  category: '视图',
  keybinding: 'Ctrl+Shift+A',
  run: () => useOverlayStore.getState().openPalette(),
})

registerCommand({
  id: 'view.quick_open',
  title: '快速打开文件',
  category: '视图',
  keybinding: 'Ctrl+Shift+N',
  run: () => useOverlayStore.getState().openQuickOpen(),
})

registerCommand({
  id: 'view.search_everywhere',
  title: '全局搜索',
  category: '视图',
  keybinding: 'Ctrl+Shift+F',
  run: () => useOverlayStore.getState().openSearch(),
})

registerCommand({
  id: 'view.recent_files',
  title: '最近文件',
  category: '视图',
  keybinding: 'Ctrl+E',
  run: () => useOverlayStore.getState().openQuickOpen(),
})

registerCommand({
  id: 'app.settings',
  title: '设置',
  category: '系统',
  keybinding: 'Ctrl+Alt+S',
  run: () => useOverlayStore.getState().openSettings(),
})

registerCommand({
  id: 'git.command_bar',
  title: 'Git 命令条',
  category: 'Git',
  keybinding: 'Ctrl+Alt+G',
  run: () => useOverlayStore.getState().openCommandBar(),
})

registerCommand({
  id: 'git.commit',
  title: '提交更改',
  category: 'Git',
  keybinding: 'Ctrl+K',
  run: () => {
    // 聚焦提交信息框（Git 工具窗的 CommitPanel）
    const el = document.querySelector('.commit-message') as HTMLTextAreaElement | null
    if (el) {
      el.focus()
      el.scrollIntoView({ block: 'nearest' })
    } else {
      useOverlayStore.getState().openCommandBar()
    }
  },
})

/** 打开工作区：设 root、起监听、记最近项目。 */
export async function openWorkspace(path: string) {
  useUiStore.getState().setWorkspaceRoot(path)
  useExplorerStore.getState().setRoot(path)
  await fsWatch(path)
  await recentProjects.push(path)
}
