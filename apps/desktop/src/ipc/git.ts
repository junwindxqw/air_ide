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

/** 取原始 diff 文本（hunk 级操作的 patch 源，3.7.2）。 */
export async function gitDiffRaw(
  repo: string,
  path: string,
  staged: boolean,
  ignoreWhitespace = false,
): Promise<string> {
  return invoke<string>('git_diff_raw', {
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

// ── P3：写入操作 ──

export type HunkOpMode = 'stage' | 'unstage' | 'discard'

export async function gitApplyHunk(
  repo: string,
  path: string,
  hunkIndex: number,
  mode: HunkOpMode,
  diffText: string,
): Promise<void> {
  await invoke('git_apply_hunk', { repo, path, hunkIndex: hunkIndex, mode, diffText })
}

export async function gitStageFile(repo: string, path: string): Promise<void> {
  await invoke('git_stage_file', { repo, path })
}

export async function gitUnstageFile(repo: string, path: string): Promise<void> {
  await invoke('git_unstage_file', { repo, path })
}

export async function gitDiscardFile(repo: string, path: string): Promise<void> {
  await invoke('git_discard_file', { repo, path })
}

export async function gitIdentityReady(repo: string): Promise<boolean> {
  return invoke<boolean>('git_identity_ready', { repo })
}

export async function gitSetIdentity(
  repo: string,
  name: string,
  email: string,
  scope: 'local' | 'global',
): Promise<void> {
  await invoke('git_set_identity', { repo, name, email, scope })
}

export async function gitCommit(
  repo: string,
  message: string,
  amend = false,
  signoff = false,
): Promise<string> {
  return invoke<string>('git_commit', { repo, message, amend, signoff })
}

export async function gitUndoCommit(repo: string): Promise<void> {
  await invoke('git_undo_commit', { repo })
}

export interface BranchInfo {
  name: string
  isCurrent: boolean
  upstream: string | null
  lastCommit: string
}

export async function gitBranches(repo: string): Promise<BranchInfo[]> {
  return invoke<BranchInfo[]>('git_branches', { repo })
}

export async function gitCheckout(repo: string, name: string): Promise<void> {
  await invoke('git_checkout', { repo, name })
}

export async function gitBranchCreate(repo: string, name: string): Promise<void> {
  await invoke('git_branch_create', { repo, name })
}

export async function gitBranchDelete(repo: string, name: string, force = false): Promise<void> {
  await invoke('git_branch_delete', { repo, name, force })
}

export type RemoteOp = 'fetch' | 'pull' | 'push'

/** 远端操作：进度/输出走事件，返回退出码（0 = 成功）。 */
export async function gitRemoteOp(
  opId: string,
  repo: string,
  op: RemoteOp,
  rebase = false,
): Promise<number> {
  return invoke<number>('git_remote_op', { opId, repo, op, rebase })
}

export async function gitCancelOp(opId: string): Promise<void> {
  await invoke('git_cancel', { opId })
}

/** Git 命令条（D2）。 */
export async function gitRun(opId: string, repo: string, args: string[]): Promise<number> {
  return invoke<number>('git_run', { opId, repo, args })
}

export async function gitRunCancel(opId: string): Promise<void> {
  await invoke('git_run_cancel', { opId })
}
