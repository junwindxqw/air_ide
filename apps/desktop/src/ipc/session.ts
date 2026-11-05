// 会话 / 设置 / 草稿 / 最近项目 IPC 封装（3.10）。
import { invoke } from '@tauri-apps/api/core'

export interface OpenFileEntry {
  path: string
  cursorLine: number
  cursorCol: number
  preview: boolean
}

export interface Session {
  workspaceRoot: string | null
  openFiles: OpenFileEntry[]
  activeFile: string | null
  schemaVersion: number
}

export interface Settings {
  schemaVersion: number
  editor: {
    fontSize: number
    lineHeight: number
    lineNumbers: boolean
    currentLineHighlight: boolean
    autoRevealInTree: boolean
    saveOnFocusLoss: boolean
    largeFileThresholdMb: number
    readonlyThresholdMb: number
  }
  appearance: { theme: string }
  git: {
    exePath: string | null
    signoff: boolean
    ignoreWhitespace: boolean
    statusThrottleMs: number
    diffDefaultSplit: boolean
  }
  system: { singleInstance: boolean; autoUpdate: boolean; defenderHint: boolean }
}

export interface DraftWrite {
  path: string
  text: string
}

export const session = {
  load: () => invoke<Session>('app_session_load'),
  save: (s: Session) => invoke('app_session_save', { session: s }),
}

export const settings = {
  load: () => invoke<Settings>('app_settings_load'),
  save: (s: Settings) => invoke('app_settings_save', { settings: s }),
}

export const recentProjects = {
  list: () => invoke<string[]>('app_recent_projects'),
  push: (path: string) => invoke('app_push_recent', { path }),
}

export const drafts = {
  save: (list: DraftWrite[]) => invoke<boolean[]>('app_drafts_save', { drafts: list }),
  load: () => invoke<DraftWrite[]>('app_drafts_load'),
  remove: (path: string) => invoke('app_draft_delete', { path }),
}
