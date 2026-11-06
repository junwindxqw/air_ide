import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/app/App'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useEditorStore, getEditorView } from '@/features/editor/store'
import { useTabsStore } from '@/features/editor/tabs'
import { useOverlayStore } from '@/app/overlayStore'
import { useExplorerStore } from '@/features/explorer/store'
import { useDiffOverlay } from '@/features/git/openDiff'
import { useUiStore } from '@/app/uiStore'
import '@/styles/tokens.css'
import '@/styles/base.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

// 开发态测试桥（DEV-only）：CDP 冒烟测试入口，release 构建不含
if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>
  w.__air = {
    open: (p: string) => useEditorStore.getState().openFile(p),
    save: () => useEditorStore.getState().saveFile(),
    doc: () => getEditorView()?.state.doc.toString() ?? null,
    activeMeta: () => {
      const s = useTabsStore.getState()
      return s.tabs.find((t) => t.path === s.activePath)?.meta ?? null
    },
    setDoc: (t: string) => {
      const v = getEditorView()
      if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } })
    },
    listDir: async (d: string) => {
      const { fsListDir } = await import('@/ipc/fs')
      return fsListDir(d)
    },
    gitStatus: async (repo: string) => {
      const { gitStatus } = await import('@/ipc/git')
      return gitStatus(repo)
    },
    gitDiff: async (repo: string, path: string) => {
      const { gitDiffFile } = await import('@/ipc/git')
      return gitDiffFile(repo, path, false)
    },
    gitDiffRaw: async (repo: string, path: string, staged: boolean) => {
      const { gitDiffRaw } = await import('@/ipc/git')
      return gitDiffRaw(repo, path, staged)
    },
    stageFile: async (path: string) => {
      const { gitStageFile } = await import('@/ipc/git')
      const root = useUiStore.getState().workspaceRoot
      if (root) await gitStageFile(root, path)
    },
    unstageFile: async (path: string) => {
      const { gitUnstageFile } = await import('@/ipc/git')
      const root = useUiStore.getState().workspaceRoot
      if (root) await gitUnstageFile(root, path)
    },
    applyHunk: async (
      repo: string,
      path: string,
      hunkIndex: number,
      mode: 'stage' | 'unstage' | 'discard',
      diffText: string,
    ) => {
      const { gitApplyHunk } = await import('@/ipc/git')
      return gitApplyHunk(repo, path, hunkIndex, mode, diffText)
    },
    gitCommit: async (repo: string, message: string, amend = false, signoff = false) => {
      const { gitCommit } = await import('@/ipc/git')
      return gitCommit(repo, message, amend, signoff)
    },
    gitUndoCommit: async (repo: string) => {
      const { gitUndoCommit } = await import('@/ipc/git')
      return gitUndoCommit(repo)
    },
    gitBranches: async (repo: string) => {
      const { gitBranches } = await import('@/ipc/git')
      return gitBranches(repo)
    },
    gitBranchCreate: async (repo: string, name: string) => {
      const { gitBranchCreate } = await import('@/ipc/git')
      return gitBranchCreate(repo, name)
    },
    gitRun: async (opId: string, repo: string, args: string[]) => {
      const { gitRun } = await import('@/ipc/git')
      return gitRun(opId, repo, args)
    },
    openDiffFor: async (relPath: string) => {
      const { openDiffFor } = await import('@/features/git/openDiff')
      return openDiffFor(relPath)
    },
    closeDiff: async () => {
      const { closeDiff } = await import('@/features/git/openDiff')
      return closeDiff()
    },
    openWorkspace: async (p: string) => {
      const { openWorkspace } = await import('@/features/command/commands')
      return openWorkspace(p)
    },
    makePermanentActive: () => {
      const s = useTabsStore.getState()
      if (s.activePath) s.makePermanent(s.activePath)
    },
    openPalette: () => useOverlayStore.getState().openPalette(),
    openQuickOpen: () => useOverlayStore.getState().openQuickOpen(),
    openSearch: () => useOverlayStore.getState().openSearch(),
    openSettings: () => useOverlayStore.getState().openSettings(),
    closeOverlays: () => useOverlayStore.getState().closeAll(),
    lspScan: async () => {
      const { lspServersScan } = await import('@/ipc/lsp')
      return lspServersScan()
    },
    lspStart: async (lang: string, root: string) => {
      const { lspStart } = await import('@/ipc/lsp')
      const { normalizeError } = await import('@/ipc/invoke')
      try {
        return await lspStart(lang, root)
      } catch (e) {
        throw normalizeError(e)
      }
    },
    lspReap: async () => {
      const { lspReapIdle } = await import('@/ipc/lsp')
      return lspReapIdle(0)
    },
    projectProfile: async (root: string) => {
      const { projectProfile } = await import('@/ipc/lsp')
      return projectProfile(root)
    },
    /** 性能埋点结果（方案 5.3）：脚本经 CDP 读取 */
    perf: () =>
      performance.getEntriesByType('measure').map((e) => ({
        name: e.name,
        ms: Math.round(e.duration * 10) / 10,
      })),
    openServerPanel: () => useOverlayStore.getState().openServerPanel(),
    debugExplorer: () => {
      const s = useExplorerStore.getState()
      return {
        root: s.root,
        expanded: [...s.expanded],
        childDirs: [...s.children.keys()],
        selected: s.selected,
      }
    },
    debugDiff: () => {
      const s = useDiffOverlay.getState()
      return { hasDiff: !!s.diff, path: s.diff?.path ?? null, ignoreWs: s.ignoreWs, hunks: s.diff?.hunks.length ?? 0 }
    },
  }
}