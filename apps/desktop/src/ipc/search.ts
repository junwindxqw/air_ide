// 搜索 IPC 封装（3.5）：流式 batch + done + cancel。
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface SearchMatch {
  path: string
  line: number
  col: number
  text: string
}

export interface SearchOptions {
  pattern: string
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
}

let queryCounter = 0
export function nextQueryId(): string {
  queryCounter += 1
  return `q${Date.now().toString(36)}-${queryCounter}`
}

/** 启动搜索；onBatch 流式回调，返回 queryId（用于取消）。 */
export async function searchQuery(
  queryId: string,
  root: string,
  opts: SearchOptions,
  onBatch: (matches: SearchMatch[]) => void,
): Promise<number> {
  const unlisten = await listen<{ queryId: string; matches: SearchMatch[] }>(
    'search://batch',
    (e) => {
      if (e.payload.queryId === queryId) onBatch(e.payload.matches)
    },
  )
  activeUnlistens.get(queryId)?.push(unlisten)
  try {
    const total = await invoke<number>('search_query', {
      queryId,
      root,
      pattern: opts.pattern,
      regex: opts.regex ?? false,
      caseSensitive: opts.caseSensitive ?? false,
      wholeWord: opts.wholeWord ?? false,
    })
    return total
  } finally {
    void unlisten()
    const arr = activeUnlistens.get(queryId)
    if (arr) {
      arr.forEach((f) => void f())
      activeUnlistens.delete(queryId)
    }
  }
}

const activeUnlistens = new Map<string, UnlistenFn[]>()

export async function searchCancel(queryId: string): Promise<void> {
  await invoke('search_cancel', { queryId })
}

export async function fsCollectFiles(root: string): Promise<string[]> {
  return invoke<string[]>('fs_collect_files', { root })
}
