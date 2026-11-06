// 前端异常日志上报（P5-3）：统一经 Rust 落盘，不在前端重复写文件。
import { airInvoke } from './invoke'

export type FrontendLogLevel = 'error' | 'warn' | 'info' | 'debug'

let seq = 0

/** 生成短崩溃 ID：用于把界面提示与日志中的记录关联起来。 */
export function newCrashId(): string {
  const buf = new Uint32Array(2)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf)
  } else {
    buf[0] = Math.floor(Math.random() * 0xffffffff)
    buf[1] = (Date.now() ^ (seq++ * 0x9e3779b9)) >>> 0
  }
  return `${buf[0].toString(16).padStart(8, '0')}${buf[1].toString(16).padStart(4, '0').slice(0, 4)}`
}

/** 上报一条前端日志（失败静默，不能因日志再引发异常）。 */
export async function logFrontend(
  level: FrontendLogLevel,
  message: string,
  detail?: string,
  crashId?: string,
): Promise<void> {
  try {
    await airInvoke('app_log_frontend_entry', {
      level,
      message,
      detail: detail ?? null,
      crashId: crashId ?? null,
    })
  } catch {
    // 日志落盘失败不应影响界面
  }
}

/** 打开日志目录，返回实际路径。 */
export async function openLogDir(): Promise<string> {
  return airInvoke<string>('app_open_log_dir')
}
