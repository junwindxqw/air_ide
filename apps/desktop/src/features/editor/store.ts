// 编辑器状态（2.10）：store 只存元数据与脏标记；文档文本由 CM6 持有，
// 切 tab 时经 textCache 中转（避免整树重渲染）。
import { create } from 'zustand'
import { Annotation } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { fsReadFile, fsWriteFile } from '@/ipc/fs'
import type { FileMeta } from '@/ipc/fs'
import { normalizeError } from '@/ipc/invoke'
import { useTabsStore } from '@/features/editor/tabs'

/** 标记"外部重载"变更：不进 undo 栈（3.11）。 */
export const externalAnnotation = Annotation.define<boolean>()

interface EditorState {
  /** 待 CodeEditor 消费的文档载荷（消费后置 null） */
  pending: { path: string; text: string; cursor?: { line: number; col: number } } | null
  isBinary: boolean
  loading: boolean
  statusFlash: string | null
  /** 外部修改三态横幅（3.11） */
  externalChange: { path: string } | null

  openFile: (path: string) => Promise<void>
  saveFile: () => Promise<void>
  flash: (msg: string) => void
  setExternalChange: (v: { path: string } | null) => void
  reloadCurrent: () => Promise<void>
}

let flashTimer: ReturnType<typeof setTimeout> | null = null
let editorView: EditorView | null = null

export function setEditorView(v: EditorView | null): void {
  editorView = v
}
export function getEditorView(): EditorView | null {
  return editorView
}

export const useEditorStore = create<EditorState>((set, get) => ({
  pending: null,
  isBinary: false,
  loading: false,
  statusFlash: null,
  externalChange: null,

  openFile: async (path) => {
    set({ loading: true, statusFlash: null, externalChange: null })
    try {
      // 未保存内容优先：textCache 里有就用（切 tab 往返不丢编辑）
      const cached = useTabsStore.getState().getCachedText(path)
      let meta: FileMeta
      let text: string
      if (cached !== undefined) {
        const loaded = await fsReadFile(path)
        meta = loaded.meta
        text = cached
        useTabsStore.getState().setDirty(path, true)
      } else {
        const loaded = await fsReadFile(path)
        meta = loaded.meta
        text = loaded.text
      }
      // 注册/激活 tab（多 tab 模型的中枢）
      useTabsStore.getState().openFile(meta.path, meta, !meta.isBinary)
      if (!meta.isBinary) {
        set({
          isBinary: false,
          loading: false,
          pending: { path: meta.path, text },
        })
      } else {
        set({ isBinary: true, loading: false, pending: null })
      }
    } catch (e) {
      const err = normalizeError(e)
      set({ loading: false })
      get().flash(`打开失败: ${err.message}`)
    }
  },

  saveFile: async () => {
    const activePath = useTabsStore.getState().activePath
    const tab = useTabsStore.getState().tabs.find((t) => t.path === activePath)
    if (!activePath || !tab?.meta) {
      get().flash('没有可保存的文件')
      return
    }
    const view = getEditorView()
    if (!view) return
    try {
      const text = view.state.doc.toString()
      await fsWriteFile({
        path: activePath,
        text,
        encoding: tab.meta.encoding,
        eol: tab.meta.eol === 'mixed' ? 'lf' : tab.meta.eol,
        hasBom: tab.meta.hasBom,
      })
      useTabsStore.getState().setDirty(activePath, false)
      useTabsStore.getState().clearCache(activePath)
      get().flash('已保存')
    } catch (e) {
      const err = normalizeError(e)
      get().flash(`保存失败: ${err.message}`)
    }
  },

  flash: (msg) => {
    if (flashTimer) clearTimeout(flashTimer)
    set({ statusFlash: msg })
    flashTimer = setTimeout(() => set({ statusFlash: null }), 3000)
  },

  setExternalChange: (v) => set({ externalChange: v }),

  reloadCurrent: async () => {
    const activePath = useTabsStore.getState().activePath
    if (!activePath) return
    // 重新读盘并替换文档（3.11：external 标记不进 undo 栈由 CodeEditor 处理）
    try {
      const loaded = await fsReadFile(activePath)
      const view = getEditorView()
      if (view) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: loaded.text },
          annotations: [externalAnnotation.of(true)],
        })
      }
      set({ externalChange: null, isBinary: loaded.meta.isBinary })
      useTabsStore.getState().setDirty(activePath, false)
      useTabsStore.getState().clearCache(activePath)
      get().flash('已重新加载')
    } catch (e) {
      get().flash(`重载失败: ${normalizeError(e).message}`)
    }
  },
}))

// [[NEXT]]
