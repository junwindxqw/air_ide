// 统一 IPC 调用封装：错误归一为 AirError（3.15 错误分级的前置）。
import { invoke } from '@tauri-apps/api/core'

// [[NEXT]]

export class AirError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export function normalizeError(e: unknown): AirError {
  if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
    const { code, message } = e as { code: string; message: string }
    return new AirError(String(code), String(message))
  }
  return new AirError('unknown', typeof e === 'string' ? e : JSON.stringify(e))
}

export async function airInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args)
  } catch (e) {
    throw normalizeError(e)
  }
}

