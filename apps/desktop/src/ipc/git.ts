// Git IPC 封装（3.5 契约）。
import { invoke } from '@tauri-apps/api/core'

export type StatusKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'conflict'

export interface StatusEntry {
  path: string
  origPath?: string
  kind: StatusKind
}

export interface RepoStatus {
  branch: string
  upstream?: string
  ahead: number
  behind: number
  staged: StatusEntry[]
  unstaged: StatusEntry[]
  untracked: StatusEntry[]
  conflicted: StatusEntry[]
  workspaceRoot: string
}

export type DiffLineKind = 'context' | 'add' | 'delete'

export interface DiffLine {
  kind: DiffLineKind
  text: string
}

export interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  oldPath?: string
  isBinary: boolean
  isRenamed: boolean
  hunks: Hunk[]
}

export async function gitStatus(repo: string): Promise<RepoStatus> {
  return invoke<RepoStatus>('git_status', { repo })
}

export async function gitDiffFile(
  repo: string,
  path: string,
  staged: boolean,
  ignoreWhitespace = false,
): Promise<FileDiff> {
  return invoke<FileDiff>('git_diff_file', {
    repo,
    path,
    staged,
    ignoreWhitespace,
  })
}

export interface LogEntry {
  sha: string
  shortSha: string
  author: string
  date: string
  subject: string
  refs: string[]
  graphCol: number
}

export async function gitLog(repo: string, skip = 0, limit = 100): Promise<LogEntry[]> {
  return invoke<LogEntry[]>('git_log', { repo, skip, limit })
}

export interface BlameLine {
  lineNo: number
  sha: string
  shortSha: string
  author: string
  date: string
  summary: string
}

export async function gitBlame(repo: string, path: string): Promise<BlameLine[]> {
  return invoke<BlameLine[]>('git_blame', { repo, path })
}
