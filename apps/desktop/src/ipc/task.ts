// P5-6 任务进度事件桥：ipc 层禁止依赖 features（3.3），因此这里只发事件，
// 由 features/win 订阅后驱动任务栏进度（win_taskbar_*）。
export type TaskPhase = 'begin' | 'end'

export interface TaskEventDetail {
  phase: TaskPhase
  taskId: string
  label?: string
  failed?: boolean
}

export const TASK_EVENT = 'air://task'

let seq = 0

function emit(detail: TaskEventDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<TaskEventDetail>(TASK_EVENT, { detail }))
}

/**
 * 包装一个长任务：开始/结束各发一个事件；事件投递失败绝不影响主任务。
 * 事件顺序由订阅侧串行排队保证。
 */
export async function withTaskProgress<T>(
  prefix: string,
  label: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  seq += 1
  const taskId = `${prefix}:${seq}`
  try {
    emit({ phase: 'begin', taskId, label })
  } catch {
    // 事件桥不可用时继续执行主任务
  }
  let failed = false
  try {
    return await run()
  } catch (e) {
    failed = true
    throw e
  } finally {
    try {
      emit({ phase: 'end', taskId, failed })
    } catch {
      // 忽略清理失败
    }
  }
}
