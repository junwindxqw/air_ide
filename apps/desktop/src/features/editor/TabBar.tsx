// Tab 栏（P1-5）：单行显示、超出进右侧下拉、预览 tab 斜体、脏标记圆点、拖拽排序。
// 排序用指针事件（dragDropEnabled=true 会禁用页面内 HTML5 DnD，见 dropOpen.ts）。
import { useRef, useState } from 'react'
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
  const [dragOver, setDragOver] = useState<number | null>(null)
  const dragRef = useRef<{ from: number; over: number } | null>(null)

  const nameOf = (p: string) => p.replaceAll('\\', '/').split('/').pop() ?? p

  const startDrag = (e: React.PointerEvent<HTMLDivElement>, i: number) => {
    if (e.button !== 0) return
    // 关闭按钮的点击不触发排序
    if ((e.target as HTMLElement).closest('.tab-close')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { from: i, over: i }
    setDragFrom(i)
    setDragOver(i)
  }

  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    const el = hit?.closest('[data-tab-index]') as HTMLElement | null
    const idx = el ? Number(el.dataset.tabIndex) : NaN
    if (!Number.isInteger(idx)) return
    if (dragRef.current.over !== idx) {
      dragRef.current.over = idx
      setDragOver(idx)
    }
  }

  const finishDrag = () => {
    const d = dragRef.current
    if (d && d.from !== d.over) reorder(d.from, d.over)
    dragRef.current = null
    setDragFrom(null)
    setDragOver(null)
  }

  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab, i) => (
        <div
          key={tab.path}
          className={`tab${tab.path === activePath ? ' active' : ''}${tab.preview ? ' preview' : ''}`}
          role="tab"
          aria-selected={tab.path === activePath}
          data-tab-index={i}
          onPointerDown={(e) => startDrag(e, i)}
          onPointerMove={onDragMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          style={
            dragFrom !== null && dragOver === i
              ? { boxShadow: 'inset 0 -2px 0 var(--accent)', opacity: dragFrom === i ? 0.6 : undefined }
              : dragFrom === i
                ? { opacity: 0.6 }
                : undefined
          }
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
