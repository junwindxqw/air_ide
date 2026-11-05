// P0 命令注册：文件与视图类。
import { appOpenDialog } from '@/ipc/fs'
import { registerCommand } from '@/features/command/registry'
import { useEditorStore } from '@/features/editor/store'
import { useUiStore } from '@/app/uiStore'

// [[NEXT]]

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
    if (path) useUiStore.getState().setWorkspaceRoot(path)
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

export function registerAllCommands(): void {
  // 注册发生在 import 时；此函数仅作为显式初始化入口供 App 调用。
}

