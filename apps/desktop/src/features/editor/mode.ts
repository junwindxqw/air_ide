// 大文件降级判定（3.8）：Rust 的 isLarge 只在 >10MB（READONLY_THRESHOLD）时置位，
// 2MB 的 EDITOR_DISABLE_THRESHOLD 必须在前端落地，否则 isLarge 标记无人消费。
import type { FileMeta } from '@/ipc/fs'

export const MB = 1024 * 1024

export interface EditorLimits {
  largeFileThresholdMb: number
  readonlyThresholdMb: number
}

export interface EditorMode {
  /** 关闭 LSP、代码折叠等重功能（> 降级阈值或已只读） */
  large: boolean
  /** 编辑器只读（Rust isLarge 或 > 只读阈值） */
  readonly: boolean
}

export function resolveEditorMode(
  meta: Pick<FileMeta, 'size' | 'isLarge'>,
  limits: EditorLimits,
): EditorMode {
  const readonly = meta.isLarge || meta.size > limits.readonlyThresholdMb * MB
  const large = readonly || meta.size > limits.largeFileThresholdMb * MB
  return { large, readonly }
}
