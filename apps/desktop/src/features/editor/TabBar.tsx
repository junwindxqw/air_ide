// Tab 栏（P1-5）：单行显示、超出进右侧下拉、预览 tab 斜体、脏标记圆点、拖拽排序。
import { useState } from 'react'
import { useTabsStore } from '@/features/editor/tabs'

export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs)
  const activePath = useTabsStore((s) => s.activePath)
  const setActive = useTabsStore((s) => s.setActive)
  const closeTab = useTabsStore((s) => s.closeTab)
  const makePermanent = useTabsStore((s) => s.makePermanent)
  const reorder = useTabsStore((s) => s.reorder)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)

  const nameOf = (p: string) => p.replaceAll('\\', '/').split('/').pop() ?? p

  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab, i) => (
        <div
          key={tab.path}
          className={`tab${tab.path === activePath ? ' active' : ''}${tab.preview ? ' preview' : ''}`}
          role="tab"
          aria-selected={tab.path === activePath}
          draggable
          onDragStart={() => setDragFrom(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragFrom !== null && dragFrom !== i) reorder(dragFrom, i)
            setDragFrom(null)
          }}
          onClick={() => {
            setActive(tab.path)
            if (tab.preview) makePermanent(tab.path)
          }}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              closeTab(tab.path)
            }
          }}
          title={tab.path}
        >
          <span className="tab-name">{nameOf(tab.path)}</span>
          {tab.dirty && <span className="tab-dirty" title="未保存" />}
          <button
            className="tab-close"
            aria-label={`关闭 ${nameOf(tab.path)}`}
            onClick={(e) => {
              e.stopPropagation()
              closeTab(tab.path)
            }}
          >
            ×
          </button>
        </div>
      ))}

      {tabs.length > 0 && (
        <div className="tab-overflow">
          <button
            className="tab-overflow-btn"
            onClick={() => setOverflowOpen((v) => !v)}
            aria-label="显示所有 tab"
          >
            ▾
          </button>
          {overflowOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setOverflowOpen(false)} />
              <div className="context-menu tab-overflow-menu">
                {tabs.map((tab) => (
                  <button
                    key={tab.path}
                    className={`menu-item${tab.path === activePath ? ' active' : ''}`}
                    onClick={() => {
                      setActive(tab.path)
                      setOverflowOpen(false)
                    }}
                  >
                    {tab.dirty ? '● ' : ''}
                    {tab.path}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
