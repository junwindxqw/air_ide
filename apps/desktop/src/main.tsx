import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/app/App'
import { useEditorStore, getEditorView } from '@/features/editor/store'
import { useTabsStore } from '@/features/editor/tabs'
import { useOverlayStore } from '@/app/overlayStore'
import { useExplorerStore } from '@/features/explorer/store'
import { useDiffOverlay } from '@/features/git/openDiff'
import '@/styles/tokens.css'
import '@/styles/base.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
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