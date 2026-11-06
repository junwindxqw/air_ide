// P5-6 任务栏进度：把长任务包一层 begin/end；短任务的闪烁抑制在后端状态机里。
import { winIpc } from '@/ipc/win'
import { TASK_EVENT, type TaskEventDetail } from '@/ipc/task'

export interface TaskbarPort {
  begin: (taskId: string, label?: string) => Promise<void>
  /** 可选：确定进度（0~1 之外的值由后端聚合）。 */
  update?: (taskId: string, value: number, total: number) => Promise<void>
  end: (taskId: string, failed?: boolean) => Promise<void>
}

let seq = 0

/** 生成并发安全的任务 id。 */
export function newTaskId(prefix: string): string {
  seq += 1
  return `${prefix}:${seq}`
}

export const winTaskbar: TaskbarPort = {
  begin: async (taskId, label) => {
    await winIpc.taskbarBegin(taskId, label)
  },
  update: async (taskId, value, total) => {
    await winIpc.taskbarUpdate(taskId, value, total)
  },
  end: async (taskId, failed) => {
    await winIpc.taskbarEnd(taskId, failed)
  },
}

/**
 * 包装一个长任务：无论成功失败都会结束进度；进度上报失败绝不影响主任务。
 */
export async function runWithTaskbar<T>(
  port: TaskbarPort,
  taskId: string,
  label: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  try {
    await port.begin(taskId, label)
  } catch {
    // 任务栏不可用（非 Windows 等）时继续执行主任务
  }
  let failed = false
  try {
    return await run()
  } catch (e) {
    failed = true
    throw e
  } finally {
    try {
      await port.end(taskId, failed)
    } catch {
      // 忽略清理失败
    }
  }
}

/** 便捷入口：自动生成任务 id。 */
export function withTaskbar<T>(prefix: string, label: string | undefined, run: () => Promise<T>) {
  return runWithTaskbar(winTaskbar, newTaskId(prefix), label, run)
}

/**
 * 订阅 ipc 层的任务事件（ipc 不能反向依赖 features，故用事件桥）。
 * 回调串行排队，保证 begin 一定先于 end 到达后端；任务栏失败一律吞掉。
 */
export function initTaskbarBridge(port: TaskbarPort = winTaskbar): () => void {
  if (typeof window === 'undefined') return () => {}
  let chain: Promise<void> = Promise.resolve()
  const onTask = (e: Event) => {
    const detail = (e as CustomEvent<TaskEventDetail>).detail
    if (!detail?.taskId || detail.phase === undefined) return
    chain = chain
      .then(() =>
        detail.phase === 'begin'
          ? port.begin(detail.taskId, detail.label)
          : port.end(detail.taskId, detail.failed),
      )
      .catch(() => {
        // 任务栏不可用（非 Windows 等）时忽略，不影响主任务
      })
  }
  window.addEventListener(TASK_EVENT, onTask)
  return () => window.removeEventListener(TASK_EVENT, onTask)
}
