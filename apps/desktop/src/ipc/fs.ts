// 文件系统 IPC 封装 + 大 payload 信封解码（3.5）。
import { invoke } from '@tauri-apps/api/core'

// [[NEXT]]

export interface FileMeta {
  path: string
  encoding: string
  eol: 'lf' | 'crlf' | 'mixed'
  hasBom: boolean
  size: number
  isBinary: boolean
  isLarge: boolean
}

export interface LoadedFile {
  meta: FileMeta
  text: string
}

/** 解码 Rust 侧信封：[u32 LE meta_len][meta JSON][utf8 文本] */
export function parseEnvelope(buf: ArrayBuffer): LoadedFile {
  const view = new DataView(buf)
  if (buf.byteLength < 4) throw new Error('信封过短')
  const metaLen = view.getUint32(0, true)
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, metaLen))) as FileMeta
  const text = new TextDecoder().decode(new Uint8Array(buf, 4 + metaLen))
  return { meta, text }
}

export async function fsReadFile(path: string): Promise<LoadedFile> {
  const buf = await invoke<ArrayBuffer>('fs_read_file', { path })
  return parseEnvelope(buf)
}

export interface FsWriteArgs {
  path: string
  text: string
  encoding: string
  eol: 'lf' | 'crlf' | 'mixed'
  hasBom: boolean
}

export async function fsWriteFile(args: FsWriteArgs): Promise<void> {
  await invoke('fs_write_file', { ...args })
}

export interface TreeEntry {
  name: string
  path: string
  isDir: boolean
  size: number
}

export async function fsListDir(dir: string): Promise<TreeEntry[]> {
  return invoke<TreeEntry[]>('fs_list_dir', { dir })
}

export function appOpenDialog(kind: 'file' | 'folder'): Promise<string | null> {
  return invoke<string | null>('app_open_dialog', { kind })
}

