// LanguageServerPool（2.5 关键约束）：`@codemirror/lsp-client` 一个实例只能连一个
// 语言服务器，因此必须按语言建 client 池。同一 client 服务该语言的所有打开文档。
import { LSPClient } from '@codemirror/lsp-client'
import { lspSend, lspStart, onLspMessage, onLspState, type LspState } from '@/ipc/lsp'
import { useUiStore } from '@/app/uiStore'

interface PoolEntry {
  language: string
  sessionId: number
  client: LSPClient
  state: LspState
  /** 该语言的打开文档数（0 时可回收） */
  openDocs: number
}

const pool = new Map<string, PoolEntry>()
const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

/** 订阅池状态变化（状态栏/管理面板用）。 */
export function subscribePool(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 池快照（React useSyncExternalStore 用）。 */
export function getPoolSnapshot(): PoolEntry[] {
  return [...pool.values()].map((e) => ({ ...e }))
}

/**
 * 获取某语言的 client（懒启动 + 缓存，2.5）。
 * 服务器未安装时返回 null（调用方降级到语法模式）。
 */
export async function clientFor(language: string): Promise<LSPClient | null> {
  const existing = pool.get(language)
  if (existing) return existing.client

  const root = useUiStore.getState().workspaceRoot
  if (!root) return null

  let sessionId: number
  try {
    sessionId = await lspStart(language, root)
  } catch (e) {
    // 归一化错误（3.15：用户要看到 git/lsp 原文 + 人话，不是 [object Object]）
    const { normalizeError } = await import('@/ipc/invoke')
    const err = normalizeError(e)
    console.warn(`LSP 启动失败（${language}，降级到语法模式）: ${err.message}`)
    return null
  }

  // Transport：前端 → Rust（invoke）；Rust → 前端（event，保序）
  const handlers = new Set<(message: string) => void>()
  const transport = {
    send: (message: string) => {
      void lspSend(sessionId, message).catch((e) => {
        console.error(`LSP 发送失败（${language}）:`, e)
      })
    },
    subscribe: (handler: (message: string) => void) => {
      handlers.add(handler)
      void onLspMessage(language, (msg) => {
        for (const h of handlers) h(msg)
      })
    },
    unsubscribe: (handler: (message: string) => void) => {
      handlers.delete(handler)
    },
  }

  const client = new LSPClient()
  client.connect(transport)
  pool.set(language, { language, sessionId, client, state: 'starting', openDocs: 0 })
  notify()

  // 状态转发
  void onLspState(language, (state) => {
    const entry = pool.get(language)
    if (entry) {
      entry.state = state
      notify()
    }
  })

  return client
}

/** 切项目/退出时统一关闭。 */
export async function disposePool(): Promise<void> {
  const { lspStop } = await import('@/ipc/lsp')
  for (const entry of pool.values()) {
    await lspStop(entry.language).catch(() => {})
  }
  pool.clear()
  notify()
}

/** 文档打开/关闭计数（0 时可被 idle 回收）。 */
export function noteDocOpened(language: string): void {
  const entry = pool.get(language)
  if (entry) {
    entry.openDocs += 1
    notify()
  }
}

export function noteDocClosed(language: string): void {
  const entry = pool.get(language)
  if (entry) {
    entry.openDocs = Math.max(0, entry.openDocs - 1)
    notify()
  }
}
