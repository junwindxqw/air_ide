import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/app/App'
import { useEditorStore, getEditorView } from '@/features/editor/store'
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
    meta: () => useEditorStore.getState().meta,
    setDoc: (t: string) => {
      const v = getEditorView()
      if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } })
    },
    listDir: async (d: string) => {
      const { fsListDir } = await import('@/ipc/fs')
      return fsListDir(d)
    },
  }
}