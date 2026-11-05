// 编辑器状态（2.10：高频数据不进 store，文本由 CM6 持有；store 只存元数据与脏标记）。
import { create } from 'zustand'
import type { EditorView } from '@codemirror/view'
import { fsReadFile, fsWriteFile } from '@/ipc/fs'
import type { FileMeta } from '@/ipc/fs'
import { normalizeError } from '@/ipc/invoke'

// [[NEXT]]

interface EditorState {
  path: string | null
  meta: FileMeta | null
  dirty: boolean
  isBinary: boolean
  loading: boolean
  statusFlash: string | null
  cursor: { line: number; col: number }
  /** 待 CodeEditor 消费的文档载荷（消费后置 null） */
  pending: { path: string; text: string } | null
  openFile: (path: string) => Promise<void>
  saveFile: () => Promise<void>
  setDirty: (b: boolean) => void
  setCursor: (line: number, col: number) => void
  flash: (msg: string) => void
}

let flashTimer: ReturnType<typeof setTimeout> | null = null

export const useEditorStore = create<EditorState>((set, get) => ({
  path: null,
  meta: null,
  dirty: false,
  isBinary: false,
  loading: false,
  statusFlash: null,
  cursor: { line: 1, col: 1 },
  pending: null,

  openFile: async (path) => {
    set({ loading: true, statusFlash: null })
    try {
      const { meta, text } = await fsReadFile(path)
      set({
        path: meta.path,
        meta,
        isBinary: meta.isBinary,
        dirty: false,
        loading: false,
        cursor: { line: 1, col: 1 },
        pending: meta.isBinary ? null : { path: meta.path, text },
      })
    } catch (e) {
      const err = normalizeError(e)
      set({ loading: false })
      get().flash(`打开失败: ${err.message}`)
    }
  },

  saveFile: async () => {
    const { path, meta } = get()
    if (!path || !meta) {
      get().flash('没有可保存的文件')
      return
    }
    const view = getEditorView()
    if (!view) return
    try {
      await fsWriteFile({
        path,
        text: view.state.doc.toString(),
        encoding: meta.encoding,
        eol: meta.eol === 'mixed' ? 'lf' : meta.eol,
        hasBom: meta.hasBom,
      })
      set({ dirty: false })
      get().flash('已保存')
    } catch (e) {
      const err = normalizeError(e)
      get().flash(`保存失败: ${err.message}`)
    }
  },

  setDirty: (b) => set({ dirty: b }),
  setCursor: (line, col) => set({ cursor: { line, col } }),

  flash: (msg) => {
    if (flashTimer) clearTimeout(flashTimer)
    set({ statusFlash: msg })
    flashTimer = setTimeout(() => set({ statusFlash: null }), 3000)
  },
}))

// 编辑器视图引用（命令层访问 CM6 实例的唯一入口）
let editorView: EditorView | null = null
export function setEditorView(v: EditorView | null): void {
  editorView = v
}
export function getEditorView(): EditorView | null {
  return editorView
}

