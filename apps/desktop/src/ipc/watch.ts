// 文件监听 IPC 封装（3.11/3.12.4）：fs://changed / fs://rescan 事件。
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export async function fsWatch(root: string): Promise<void> {
  await invoke('fs_watch', { root })
}

export async function fsUnwatch(root: string): Promise<void> {
  await invoke('fs_unwatch', { root })
}

/** 订阅外部变更（已由 Rust 侧合并 + 抑制表过滤）。 */
export function onExternalChange(
  handler: (paths: string[]) => void,
): Promise<UnlistenFn> {
  return listen<{ paths: string[] }>('fs://changed', (e) => handler(e.payload.paths))
}

/** 订阅监听溢出 → 全量重扫信号（3.12.4）。 */
export function onRescan(handler: (root: string) => void): Promise<UnlistenFn> {
  return listen<{ root: string }>('fs://rescan', (e) => handler(e.payload.root))
}
