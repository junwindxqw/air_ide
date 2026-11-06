// 冲突解决界面的状态（读取工作区文件 + 解析结果 + 会话内「已解决」标记）。
import { create } from 'zustand'
import { fsReadFile, type LoadedFile } from '@/ipc/fs'
import { normalizeError } from '@/ipc/invoke'
import { useUiStore } from '@/app/uiStore'
import { parseConflictMarkers, type ParseConflictResult } from './markers'

/** 超过此体积给出明确提示并拒绝在界面里处理（不静默截断）。 */
export const MAX_CONFLICT_FILE_BYTES = 2 * 1024 * 1024
/** 块数上限：防止极端文件把逐块列表渲染拖死。 */
export const MAX_CONFLICT_HUNKS = 500
/** 结果栏可手动编辑的体积上限（超出只提供只读实时预览）。 */
export const MANUAL_EDIT_LIMIT_BYTES = 512 * 1024

interface ConflictState {
  /** 仓库相对路径（与 git status 一致），null 表示界面关闭 */
  path: string | null
  loaded: LoadedFile | null
  parsed: ParseConflictResult | null
  loading: boolean
  error: string | null
  /** 本次会话内已保存解决的文件（ChangesPanel 显示 ✓ 已解决） */
  resolvedPaths: Set<string>
  open: (relPath: string) => Promise<void>
  retry: () => Promise<void>
  close: () => void
  markResolved: (relPath: string) => void
  clearResolved: (relPath: string) => void
}

export function joinWorkspacePath(root: string, relPath: string): string {
  const base = root.replace(/[\\/]+$/, '')
  const rel = relPath.replace(/\\/g, '/').replace(/^\.\//, '')
  return `${base}/${rel}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const useConflictStore = create<ConflictState>((set, get) => ({
  path: null,
  loaded: null,
  parsed: null,
  loading: false,
  error: null,
  resolvedPaths: new Set<string>(),

  open: async (relPath) => {
    const root = useUiStore.getState().workspaceRoot
    if (!root) return
    set({
      path: relPath,
      loaded: null,
      parsed: null,
      loading: true,
      error: null,
    })
    try {
      const absPath = joinWorkspacePath(root, relPath)
      const loaded = await fsReadFile(absPath)
      if (loaded.meta.isBinary) {
        throw new Error('二进制文件无法用冲突标记界面解决')
      }
      if (loaded.meta.size > MAX_CONFLICT_FILE_BYTES) {
        throw new Error(
          `文件 ${formatBytes(loaded.meta.size)}，超过冲突解决界面上限 ${formatBytes(
            MAX_CONFLICT_FILE_BYTES,
          )}；请用外部编辑器处理（界面不会截断内容）`,
        )
      }
      const parsed = parseConflictMarkers(loaded.text)
      if (parsed.hunks.length === 0) {
        throw new Error(
          parsed.problems.length > 0
            ? '文件中只有异常冲突标记，没有完整冲突块；请先修复标记结构'
            : '未检测到冲突标记，文件可能已在外部解决',
        )
      }
      if (parsed.hunks.length > MAX_CONFLICT_HUNKS) {
        throw new Error(
          `检测到 ${parsed.hunks.length} 个冲突块，超过界面上限 ${MAX_CONFLICT_HUNKS} 个；请用外部编辑器处理`,
        )
      }
      set({ loaded, parsed, loading: false })
    } catch (e) {
      set({ loaded: null, parsed: null, loading: false, error: normalizeError(e).message })
    }
  },

  retry: async () => {
    const path = get().path
    if (path) await get().open(path)
  },

  close: () =>
    set({ path: null, loaded: null, parsed: null, loading: false, error: null }),

  markResolved: (relPath) =>
    set((s) => {
      const resolvedPaths = new Set(s.resolvedPaths)
      resolvedPaths.add(relPath)
      return { resolvedPaths }
    }),

  clearResolved: (relPath) =>
    set((s) => {
      if (!s.resolvedPaths.has(relPath)) return s
      const resolvedPaths = new Set(s.resolvedPaths)
      resolvedPaths.delete(relPath)
      return { resolvedPaths }
    }),
}))
