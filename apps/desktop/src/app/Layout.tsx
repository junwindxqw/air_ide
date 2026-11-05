// 四区布局骨架（P0-3）：左 Project / 中编辑器 / 右 Git / 底状态栏，工具窗语义 Alt+1/9、Esc、Shift+Esc。
import { useEffect, useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { CodeEditor } from '@/features/editor/CodeEditor'
import { StatusBar } from '@/app/StatusBar'
import { useUiStore } from '@/app/uiStore'

export function Layout() {
  const leftRef = useRef<ImperativePanelHandle>(null)
  const rightRef = useRef<ImperativePanelHandle>(null)
  const leftOpen = useUiStore((s) => s.leftOpen)
  const rightOpen = useUiStore((s) => s.rightOpen)
  const registerFocusEditor = useUiStore((s) => s.registerFocusEditor)
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
      <div className="main-area">
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
              <div className="tool-window-body">
                文件树在 P1 交付（方案 4 / Phase 1）。
              </div>
            </div>
          </Panel>
          <PanelResizeHandle className="panel-resize-handle" />
          <Panel minSize={20}>
            <div className="editor-area">
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
              <div className="tool-window-title">Git</div>
              <div className="tool-window-body">
                Changes 面板在 P1 交付（最小 diff）；P3 交付完整 Git 写入。
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>
      <StatusBar />
    </div>
  )
}
