// LSP IPC 封装（2.5）：Transport（invoke + event）+ 按语言的会话管理。
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { withTaskProgress } from '@/ipc/task'

export interface ServerInfo {
  language: string
  displayName: string
  installed: boolean
  path: string | null
  installHint: string
  running: boolean
}

export type LspState = 'starting' | 'running' | 'stopped' | 'failed'

/** 服务器探测（2.6 三级策略第一级）。 */
export async function lspServersScan(): Promise<ServerInfo[]> {
  return invoke<ServerInfo[]>('lsp_servers_scan')
}

/** 启动（或复用）某语言会话，返回 sessionId。 */
export async function lspStart(language: string, root: string): Promise<number> {
  return invoke<number>('lsp_start', { language, root })
}

/** 发送 LSP 消息（完整 JSON 文本，Content-Length 由 Rust 补）。 */
export async function lspSend(sessionId: number, message: string): Promise<void> {
  await invoke('lsp_send', { sessionId, message })
}

export async function lspStop(language: string): Promise<void> {
  await invoke('lsp_stop', { language })
}

export async function lspReapIdle(idleMinutes?: number): Promise<void> {
  await invoke('lsp_reap_idle', { idleMinutes: idleMinutes ?? 10 })
}

/** 一键下载语言服务器完成事件（features/win 订阅后发系统通知，ipc 层不反向依赖 feature）。 */
export const LSP_INSTALL_EVENT = 'air://lsp-install'

export interface LspInstallEventDetail {
  language: string
  ok: boolean
  error?: string
}

function emitInstallResult(detail: LspInstallEventDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<LspInstallEventDetail>(LSP_INSTALL_EVENT, { detail }))
}

/** 一键下载语言服务器（2.6 第三级，当前仅 PHPantom）。返回安装路径。 */
export async function lspInstallServer(language: string): Promise<string> {
  // P5-6：下载期间显示任务栏进度；完成/失败发事件，通知由 features/win 消费
  return withTaskProgress('lsp-install', `安装 ${language} 语言服务器`, async () => {
    try {
      const path = await invoke<string>('lsp_install_server', { language })
      emitInstallResult({ language, ok: true })
      return path
    } catch (e) {
      emitInstallResult({ language, ok: false, error: e instanceof Error ? e.message : String(e) })
      throw e
    }
  })
}

/** 订阅某语言的服务器消息（保序，不合并——协议要求顺序，3.5）。 */
export function onLspMessage(
  language: string,
  handler: (payload: string) => void,
): Promise<UnlistenFn> {
  return listen<{ language: string; payload: string }>('lsp://message', (e) => {
    if (e.payload.language === language) handler(e.payload.payload)
  })
}

/** 订阅会话状态变化。 */
export function onLspState(
  language: string,
  handler: (state: LspState) => void,
): Promise<UnlistenFn> {
  return listen<{ language: string; state: string }>('lsp://state', (e) => {
    if (e.payload.language === language) handler(e.payload.state as LspState)
  })
}

export interface ProjectProfile {
  languages: string[]
  root: string
  source: 'marker' | 'extension'
}

/** 识别项目语言画像（3.6）。 */
export async function projectProfile(root: string): Promise<ProjectProfile> {
  return invoke<ProjectProfile>('project_profile', { root })
}
