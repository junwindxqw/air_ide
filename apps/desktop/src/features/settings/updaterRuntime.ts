// P5-7：应用内更新状态机（检查 → 下载 → 安装 → 重启），失败按网络/签名/平台归类。
// 插件调用通过 UpdaterClient 注入，便于单测四种响应；真实客户端懒加载 @tauri-apps/plugin-updater。
import { create } from 'zustand'

export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'restarting'
  | 'error'

export type UpdaterErrorKind = 'network' | 'signature' | 'platform' | 'unsupported' | 'unknown'

export interface UpdaterErrorInfo {
  kind: UpdaterErrorKind
  title: string
  hint: string
  /** 后端原始错误文本，便于用户反馈问题时粘贴 */
  raw: string
}

export interface UpdaterProgress {
  received: number
  total?: number
}

export interface UpdaterInfo {
  version: string
  notes?: string
  date?: string
}

export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

/** 真实插件 Update 的最小接口（字段与 @tauri-apps/plugin-updater 对齐）。 */
export interface UpdateHandle {
  version: string
  body?: string
  date?: string
  download: (onEvent?: (event: DownloadEvent) => void) => Promise<void>
  install: (options?: { restartAfterInstall?: boolean }) => Promise<void>
  close?: () => Promise<void>
}

export interface UpdaterClient {
  check: (options?: { timeout?: number }) => Promise<UpdateHandle | null>
}

/** 安装前的准备动作（如清理崩溃运行标记）；抛错不会阻塞安装。 */
export type BeforeInstall = () => Promise<void>

export interface UpdaterState {
  phase: UpdaterPhase
  update?: UpdaterInfo
  progress?: UpdaterProgress
  error?: UpdaterErrorInfo & { silent?: boolean }
  lastCheckedAt?: number
}

export interface UpdaterRuntime extends UpdaterState {
  check: (options?: { silent?: boolean }) => Promise<void>
  downloadAndInstall: () => Promise<void>
  dismiss: () => Promise<void>
}

/** 当前环境不是 Tauri（浏览器里跑前端）时抛出的明确错误。 */
export class UpdaterUnsupportedError extends Error {
  constructor(message = '当前环境不是桌面应用，无法使用应用内更新') {
    super(message)
    this.name = 'UpdaterUnsupportedError'
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

const MESSAGES: Record<UpdaterErrorKind, { title: string; hint: string }> = {
  network: {
    title: '无法访问更新源',
    hint: '检查网络或代理后重试；也可以到 GitHub Releases 手动下载安装包。',
  },
  signature: {
    title: '更新包签名校验失败',
    hint: '未通过签名校验的包不会安装。请重试；若仍失败，到 Releases 手动下载并核对 SHA-256。',
  },
  platform: {
    title: '更新清单缺少当前平台的产物',
    hint: '发布端需要提供 windows-x86_64-nsis 的安装包与签名，请等待重新发布。',
  },
  unsupported: {
    title: '当前环境不支持应用内更新',
    hint: '请在 NSIS 安装版中使用应用内更新；便携版请手动下载新版本压缩包。',
  },
  unknown: {
    title: '更新失败',
    hint: '请重试；若持续失败，到 Releases 手动下载安装包。',
  },
}

function rawMessage(input: unknown): string {
  if (typeof input === 'string') return input
  if (input instanceof Error) return input.message
  if (input == null) return ''
  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

/** 把后端错误文本归类：签名 / 平台 / 网络（含 404） / 其他。 */
export function classifyUpdaterError(input: unknown): UpdaterErrorInfo {
  const raw = rawMessage(input)
  const text = raw.toLowerCase()

  let kind: UpdaterErrorKind = 'unknown'
  if (input instanceof UpdaterUnsupportedError || text.includes('不是桌面应用')) {
    kind = 'unsupported'
  } else if (
    text.includes('minisign') ||
    text.includes('signature') ||
    text.includes('trusted comment') ||
    text.includes('签名')
  ) {
    kind = 'signature'
  } else if (
    text.includes('was not found in the response') ||
    text.includes('fallback platforms') ||
    text.includes('platform') ||
    text.includes('unsupported architecture') ||
    text.includes('unsupported os') ||
    text.includes('invalid updater binary format')
  ) {
    kind = 'platform'
  } else if (
    text.includes('could not fetch a valid release json') ||
    text.includes('404') ||
    text.includes('not found') ||
    text.includes('error sending request') ||
    text.includes('request failed') ||
    text.includes('timed out') ||
    text.includes('timeout') ||
    text.includes('connection') ||
    text.includes('failed to fetch') ||
    text.includes('download request failed') ||
    text.includes('http')
  ) {
    kind = 'network'
  }

  const message = MESSAGES[kind]
  return { kind, title: message.title, hint: message.hint, raw: raw || '未知错误' }
}

/** 下载进度换算成 0-100；未知总大小时返回 undefined。 */
export function progressPercent(progress?: UpdaterProgress): number | undefined {
  if (!progress || !progress.total || progress.total <= 0) return undefined
  return Math.min(100, Math.round((progress.received / progress.total) * 100))
}

/** 创建状态机（可注入 client / 安装前动作，单测用假实现；生产用 tauriUpdaterClient）。 */
export function createUpdaterStore(
  client: UpdaterClient,
  beforeInstall: BeforeInstall = async () => {},
) {
  let handle: UpdateHandle | null = null

  const releaseHandle = async () => {
    const current = handle
    handle = null
    if (current?.close) {
      try {
        await current.close()
      } catch {
        // 释放资源失败不影响 UI 状态
      }
    }
  }

  return create<UpdaterRuntime>((set, get) => {
    const busy = () => {
      const phase = get().phase
      return (
        phase === 'checking' ||
        phase === 'downloading' ||
        phase === 'installing' ||
        phase === 'restarting'
      )
    }

    return {
      phase: 'idle',

      check: async (options) => {
        if (busy()) return
        const silent = options?.silent === true
        // 重新检查前释放上一次的 Update 资源
        await releaseHandle()
        set({ phase: 'checking', error: undefined, progress: undefined, update: undefined })
        try {
          const update = await client.check({ timeout: 20_000 })
          if (update) {
            handle = update
            set({
              phase: 'available',
              update: { version: update.version, notes: update.body, date: update.date },
              lastCheckedAt: Date.now(),
            })
          } else {
            set({ phase: 'up-to-date', lastCheckedAt: Date.now() })
          }
        } catch (e) {
          if (silent) console.warn('启动静默检查更新失败', e)
          set({
            phase: 'error',
            error: { ...classifyUpdaterError(e), silent },
            lastCheckedAt: Date.now(),
          })
        }
      },

      downloadAndInstall: async () => {
        if (busy()) return
        const current = handle
        if (!current) {
          // 没有可用的 Update（例如上次检查失败），退回重新检查
          await get().check()
          return
        }
        set({ phase: 'downloading', progress: { received: 0 }, error: undefined })
        try {
          await current.download((event) => {
            if (event.event === 'Started') {
              set({ progress: { received: 0, total: event.data.contentLength } })
            } else if (event.event === 'Progress') {
              const prev = get().progress?.received ?? 0
              set({ progress: { received: prev + event.data.chunkLength, total: get().progress?.total } })
            }
          })
          set({ phase: 'installing' })
          // updater 在 Windows 上会直接 process::exit，RunEvent::Exit 不触发；
          // 安装前清掉 running.json，避免更新重启后误弹「上次未正常退出」。
          try {
            await beforeInstall()
          } catch (e) {
            console.warn('更新安装前清理运行标记失败（忽略并继续安装）', e)
          }
          await current.install({ restartAfterInstall: true })
          handle = null
          set({ phase: 'restarting', progress: undefined })
        } catch (e) {
          set({ phase: 'error', error: { ...classifyUpdaterError(e) } })
        }
      },

      dismiss: async () => {
        await releaseHandle()
        set({ phase: 'idle', update: undefined, progress: undefined, error: undefined })
      },
    }
  })
}

/** 调用后端清理运行标记；命令不存在或调用失败时只记录，不阻塞更新。 */
async function clearRunningMarker(): Promise<void> {
  if (!isTauriRuntime()) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('app_clear_running_marker')
  } catch (e) {
    console.warn('app_clear_running_marker 调用失败（可能后端尚未提供该命令），继续安装', e)
  }
}

/** 生产客户端：懒加载插件，避免在浏览器/单测环境解析 Tauri IPC。 */
export const tauriUpdaterClient: UpdaterClient = {
  check: async (options) => {
    if (!isTauriRuntime()) throw new UpdaterUnsupportedError()
    const { check } = await import('@tauri-apps/plugin-updater')
    return (await check({ timeout: options?.timeout })) as UpdateHandle | null
  },
}

export const useUpdaterStore = createUpdaterStore(tauriUpdaterClient, clearRunningMarker)

let startupScheduled = false

/**
 * 启动静默检查（不自动安装）：等首屏空闲后再发请求，失败只记录不弹窗。
 * 返回取消函数；StrictMode 二次执行由 startupScheduled 去重。
 */
export function scheduleStartupUpdaterCheck(
  enabled: boolean,
  options?: { delayMs?: number; store?: ReturnType<typeof createUpdaterStore> },
): () => void {
  if (!enabled || startupScheduled || typeof window === 'undefined') return () => {}
  startupScheduled = true
  const store = options?.store ?? useUpdaterStore
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const run = () => {
    if (!cancelled) void store.getState().check({ silent: true })
  }

  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback
  if (typeof idle === 'function') {
    idle(run, { timeout: Math.max(3000, options?.delayMs ?? 0) })
  } else {
    timer = setTimeout(run, options?.delayMs ?? 3000)
  }

  return () => {
    cancelled = true
    if (timer) clearTimeout(timer)
  }
}

/** 仅测试使用：重置启动检查去重标记。 */
export function __resetStartupUpdaterCheckForTest(): void {
  startupScheduled = false
}
