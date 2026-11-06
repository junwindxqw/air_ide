// 文件夹拖入窗口（P5-4 修复）：Tauri native drag-drop 事件。
// 注意：需要 tauri.conf.json 的 dragDropEnabled=true（HTML5 DnD 因此不可用，
// TabBar 排序已改为指针事件，见 TabBar.tsx）。
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { fsListDir } from '@/ipc/fs'
import { normalizeError } from '@/ipc/invoke'
import { openWorkspace } from '@/features/command/commands'
import { useEditorStore } from '@/features/editor/store'

export type DropResult = 'opened' | 'multiple' | 'not-folder' | 'failed' | 'none'

/** 拖入单个目录 → 打开工作区；多选/非目录 → 明确提示。 */
export async function handleDroppedPaths(paths: string[]): Promise<DropResult> {
  if (paths.length === 0) return 'none'
  if (paths.length > 1) {
    useEditorStore.getState().flash('一次只能拖入一个文件夹作为工作区（已忽略本次拖拽）')
    return 'multiple'
  }
  const path = paths[0]
  try {
    // list_dir 成功即目录；文件会抛错（native drop 事件不带类型）
    await fsListDir(path)
  } catch {
    useEditorStore.getState().flash('请拖入文件夹，而不是单个文件')
    return 'not-folder'
  }
  try {
    await openWorkspace(path)
  } catch (e) {
    useEditorStore.getState().flash(`打开工作区失败：${normalizeError(e).message}`)
    return 'failed'
  }
  const name = path.replaceAll('\\', '/').split('/').pop() ?? path
  useEditorStore.getState().flash(`已打开工作区：${name}`)
  return 'opened'
}

/** 注册窗口级拖拽监听；返回 unlisten。非 Tauri 环境（纯 vite）静默降级。 */
export function registerFolderDrop(): Promise<() => void> {
  try {
    return getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'enter') {
        useEditorStore.getState().flash('松开鼠标以打开文件夹作为工作区')
      } else if (event.payload.type === 'drop') {
        void handleDroppedPaths(event.payload.paths)
      }
    })
  } catch {
    return Promise.resolve(() => {})
  }
}
