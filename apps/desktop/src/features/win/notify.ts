// P5-6 系统通知：LSP 安装、更新可用、崩溃记录等；系统通知不可用时降级为应用内提示。
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { winIpc, type CrashInfo } from '@/ipc/win'
import { LSP_INSTALL_EVENT, type LspInstallEventDetail } from '@/ipc/lsp'
import { useNotificationStore, type NotifyMessage } from './notifyStore'

export type { NotifyMessage, NotifyLevel } from './notifyStore'

export interface NotifySink {
  /** 返回 false 或抛错都表示系统通知不可用。 */
  system: (m: NotifyMessage) => Promise<boolean>
  /** 应用内提示（降级路径）。 */
  fallback: (m: NotifyMessage) => void
}

/** 通知投递：先尝试系统通知，失败/不可用则一定走应用内提示。 */
export async function deliverNotification(
  message: NotifyMessage,
  sink: NotifySink,
): Promise<'system' | 'fallback'> {
  try {
    if (await sink.system(message)) return 'system'
  } catch {
    // 系统通知不可用（非 Windows / 托盘注册失败 / 用户关闭通知）
  }
  sink.fallback(message)
  return 'fallback'
}

const defaultSink: NotifySink = {
  system: async (m) => {
    await winIpc.notify(m.title, m.body, m.level)
    return true
  },
  fallback: (m) => useNotificationStore.getState().push(m),
}

/** 对外唯一入口：发送一条通知（系统优先，失败降级）。 */
export function notifyUser(message: NotifyMessage): Promise<'system' | 'fallback'> {
  return deliverNotification(message, defaultSink)
}

/** 常用场景（文案集中在这里，调用方只传上下文）。 */
export const scenes = {
  lspInstalled: (language: string): NotifyMessage => ({
    title: '语言服务器已安装',
    body: `${language} 语言服务器下载并安装完成，可直接使用。`,
    level: 'info',
    scene: 'lsp-installed',
  }),
  lspInstallFailed: (language: string, error: unknown): NotifyMessage => ({
    title: '语言服务器安装失败',
    body: `${language}：${trimBody(error)}`,
    level: 'error',
    scene: 'lsp-install-failed',
  }),
  crashRecorded: (info: CrashInfo): NotifyMessage => ({
    title: '崩溃记录已保存',
    body: `上次异常退出（${info.kind}）的记录已保存，可在日志目录查看：${trimBody(info.message)}`,
    level: 'warning',
    scene: 'crash-recorded',
  }),
  updateAvailable: (version: string): NotifyMessage => ({
    title: '发现新版本',
    body: `Air IDE ${version} 可用，可在设置中查看更新。`,
    level: 'info',
    scene: 'update-available',
  }),
}

function trimBody(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value)
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

const CRASH_SEEN_KEY = 'air.crashNotifiedId'

async function notifyRecentCrash(): Promise<void> {
  try {
    const crash = await winIpc.lastCrash()
    if (!crash || !crash.crashId) return
    if (localStorage.getItem(CRASH_SEEN_KEY) === crash.crashId) return
    localStorage.setItem(CRASH_SEEN_KEY, crash.crashId)
    await notifyUser(scenes.crashRecorded(crash))
  } catch {
    // 崩溃记录不可读时静默（P5-3 的启动提示仍然生效）
  }
}

/** 订阅 ipc 层的 LSP 安装结果事件（ipc 不能反向依赖 features，故用事件桥）。 */
export function initLspInstallNotifications(): () => void {
  if (typeof window === 'undefined') return () => {}
  const onInstall = (e: Event) => {
    const detail = (e as CustomEvent<LspInstallEventDetail>).detail
    if (!detail?.language) return
    void notifyUser(
      detail.ok
        ? scenes.lspInstalled(detail.language)
        : scenes.lspInstallFailed(detail.language, detail.error ?? '未知错误'),
    )
  }
  window.addEventListener(LSP_INSTALL_EVENT, onInstall)
  return () => window.removeEventListener(LSP_INSTALL_EVENT, onInstall)
}

/**
 * 初始化通知桥：监听 `app://notify` 事件 + LSP 安装结果事件 + 崩溃记录提示。
 * `app://notify` 是给 updater 等模块预留的事件挂点，payload 为 NotifyMessage。
 */
export async function initWindowsNotifications(): Promise<UnlistenFn> {
  const offLspInstall = initLspInstallNotifications()
  try {
    const unlisten = await listen<NotifyMessage>('app://notify', (e) => {
      if (e.payload?.title) void notifyUser(e.payload)
    })
    void notifyRecentCrash()
    return () => {
      offLspInstall()
      unlisten()
    }
  } catch (e) {
    offLspInstall()
    throw e
  }
}
