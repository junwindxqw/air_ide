// P5-6 Windows 集成 IPC：资源管理器集成、跳转列表、任务栏进度、系统通知、Defender 状态。
import { invoke } from '@tauri-apps/api/core'

export interface ShellIntegrationStatus {
  supported: boolean
  registered: boolean
  exePath: string
}

export interface DefenderStatus {
  realtimeEnabled: boolean | null
  excluded: boolean | null
}

export interface CrashInfo {
  crashId: string
  time: string
  message: string
  kind: string
  path: string
}

export type NotifyLevel = 'info' | 'warning' | 'error'

export const winIpc = {
  status: () => invoke<ShellIntegrationStatus>('app_windows_integration_status'),
  setIntegration: (enable: boolean) =>
    invoke<ShellIntegrationStatus>('app_set_windows_integration', { enable }),
  refreshJumpList: () => invoke<void>('app_refresh_jump_list'),
  defenderStatus: (path: string) => invoke<DefenderStatus>('app_defender_status', { path }),
  notify: (title: string, body: string, level: NotifyLevel = 'info') =>
    invoke<void>('app_show_notification', { title, body, level }),
  lastCrash: () => invoke<CrashInfo | null>('app_last_crash'),
  taskbarBegin: (taskId: string, label?: string) =>
    invoke<void>('win_taskbar_begin', { taskId, label }),
  taskbarUpdate: (taskId: string, value: number, total: number) =>
    invoke<void>('win_taskbar_update', { taskId, value, total }),
  taskbarEnd: (taskId: string, failed = false) =>
    invoke<void>('win_taskbar_end', { taskId, failed }),
}

/** 权限类错误（用户取消 UAC / 安全软件拦截），供设置页给出可读反馈。 */
export function isPermissionError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /权限|拒绝|UAC|Access is denied|0x80070005|EPERM/i.test(msg)
}

/** 把 IPC 错误转为用户可读文本。 */
export function describeIntegrationError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (isPermissionError(e)) {
    return `系统拒绝修改（可能取消了 UAC 或被安全软件拦截）：${msg}`
  }
  return msg
}
