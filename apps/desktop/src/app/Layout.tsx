// 四区布局（P1）：左 Project（文件树）/ 中编辑器（tab 栏 + CM6）/ 右 Git（Changes）/ 底状态栏。
import { useEffect, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { CodeEditor } from '@/features/editor/CodeEditor'
import { TabBar } from '@/features/editor/TabBar'
import { FileTree } from '@/features/explorer/FileTree'
import { FileTreeMenu } from '@/features/explorer/FileTreeMenu'
import { ChangesPanel } from '@/features/git/ChangesPanel'
import { CommitPanel } from '@/features/git/CommitPanel'
import { BranchMenu } from '@/features/git/BranchMenu'
import { CommandBar } from '@/features/git/CommandBar'
import { LogView } from '@/features/git/LogView'
import { CommandPalette } from '@/features/command/CommandPalette'
import { QuickOpen } from '@/features/search/QuickOpen'
import { SearchPanel } from '@/features/search/SearchPanel'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { GlobalDiff } from '@/features/git/GlobalDiff'
import { ServerPanel } from '@/features/lsp/ServerPanel'
import { WelcomePage, useShowWelcome } from '@/features/settings/WelcomePage'
import { DefenderHint } from '@/features/settings/DefenderHint'
import { ExternalChangeBanner } from '@/features/editor/ExternalChangeBanner'
import { StatusBar } from '@/app/StatusBar'
import { NotificationHost } from '@/features/win/NotificationHost'
import { useUiStore } from '@/app/uiStore'
import { useOverlayStore } from '@/app/overlayStore'

export function Layout() {
  const leftRef = useRef<ImperativePanelHandle>(null)
  const rightRef = useRef<ImperativePanelHandle>(null)
  const leftOpen = useUiStore((s) => s.leftOpen)
  const rightOpen = useUiStore((s) => s.rightOpen)
  const registerFocusEditor = useUiStore((s) => s.registerFocusEditor)
  const workspaceRoot = useUiStore((s) => s.workspaceRoot)
  const [gitTab, setGitTab] = useState<'changes' | 'log'>('changes')
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)
  const showWelcome = useShowWelcome()
  const setLastToolWindow = (side: 'left' | 'right') =>
    useUiStore.setState({ lastToolWindow: side })

  // Alt+1 / Alt+9 → 面板折叠切换
  useEffect(() => {
    const p = leftRef.current
    if (!p) return
    if (leftOpen) p.expand()
    else p.collapse()
  }, [leftOpen])

  useEffect(() => {
    const p = rightRef.current
    if (!p) return
    if (rightOpen) p.expand()
    else p.collapse()
  }, [rightOpen])

  // 聚焦编辑器 = 聚焦 CM6 实例
  useEffect(() => {
    registerFocusEditor(() => {
      const cm = document.querySelector('.cm-content') as HTMLElement | null
      cm?.focus()
    })
    return () => registerFocusEditor(null)
  }, [registerFocusEditor])

  return (
    <div className="app-root">
      {showWelcome && !workspaceRoot && !welcomeDismissed ? (
        <WelcomePage onDismiss={() => setWelcomeDismissed(true)} />
      ) : (
          <div className="main-area">
        <DefenderHint />
        <PanelGroup direction="horizontal">
          <Panel
            ref={leftRef}
            defaultSize={20}
            minSize={8}
            collapsible
            collapsedSize={0}
            onPointerDown={() => setLastToolWindow('left')}
          >
            <div className="tool-window">
              <div className="tool-window-title">Project</div>
              <div className="tool-window-body no-pad">
                <FileTree />
              </div>
            </div>
          </Panel>
          <PanelResizeHandle className="panel-resize-handle" />
          <Panel minSize={20}>
            <div className="editor-area">
              <TabBar />
              <ExternalChangeBanner />
              <CodeEditor />
            </div>
          </Panel>
          <PanelResizeHandle className="panel-resize-handle" />
          <Panel
            ref={rightRef}
            defaultSize={18}
            minSize={8}
            collapsible
            collapsedSize={0}
            onPointerDown={() => setLastToolWindow('right')}
          >
            <div className="tool-window right">
              <div className="tool-window-title">
                <span>Git</span>
                <span className="tool-window-tabs">
                  <button
                    className={`tw-tab${gitTab === 'changes' ? ' on' : ''}`}
                    onClick={() => setGitTab('changes')}
                  >
                    Changes
                  </button>
                  <button
                    className={`tw-tab${gitTab === 'log' ? ' on' : ''}`}
                    onClick={() => setGitTab('log')}
                  >
                    Log
                  </button>
                </span>
              </div>
              <div className="tool-window-body no-pad">
                {gitTab === 'changes' ? (
                  <>
                    <BranchMenu />
                    <ChangesPanel />
                    <CommitPanel />
                  </>
                ) : (
                  <LogView repo={workspaceRoot ?? ''} onClose={() => setGitTab('changes')} />
                )}
              </div>
            </div>
          </Panel>
        </PanelGroup>
          </div>
      )}
      <StatusBar />
      <FileTreeMenu />
      <CommandPalette
        open={useOverlayStore((s) => s.paletteOpen)}
        onClose={() => useOverlayStore.getState().closeAll()}
      />
      <QuickOpen
        open={useOverlayStore((s) => s.quickOpenOpen)}
        onClose={() => useOverlayStore.getState().closeAll()}
      />
      <SearchPanel
        open={useOverlayStore((s) => s.searchOpen)}
        onClose={() => useOverlayStore.getState().closeAll()}
      />
      <SettingsPage
        open={useOverlayStore((s) => s.settingsOpen)}
        onClose={() => useOverlayStore.getState().closeAll()}
      />
      <GlobalDiff />
      <CommandBar
        open={useOverlayStore((s) => s.commandBarOpen)}
        onClose={() => useOverlayStore.getState().closeAll()}
      />
      <ServerPanel
        open={useOverlayStore((s) => s.serverPanelOpen)}
        onClose={() => useOverlayStore.getState().closeAll()}
      />
      <NotificationHost />
    </div>
  )
}
