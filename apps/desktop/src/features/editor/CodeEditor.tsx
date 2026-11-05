// CM6 编辑器封装：单实例复用，按 activePath 换文档（P1-4/P1-5）。
// 文档切换走 store.pending；编辑事件上报 dirty 与文本缓存。
import { useEffect, useRef } from 'react'
import {
  EditorState,
  Compartment,
  StateEffect,
  type Extension,
} from '@codemirror/state'
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  bracketMatching,
  indentOnInput,
  foldGutter,
  codeFolding,
} from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import { useEditorStore, setEditorView } from '@/features/editor/store'
import { useTabsStore } from '@/features/editor/tabs'
import { languageForPath } from '@/features/editor/langMap'
import { languageIdForPath } from '@/features/editor/langMap'
import { darcula } from '@/features/editor/darcula'
import { indentGuides } from '@/features/editor/indentGuides'
import { clientFor, noteDocOpened } from '@/features/lsp/pool'

const langCompartment = new Compartment()

function baseExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    foldGutter(),
    codeFolding(),
    indentGuides,
    history(),
    drawSelection(),
    dropCursor(),
    bracketMatching(),
    indentOnInput(),
    closeBrackets(),
    autocompletion(),
    highlightSelectionMatches(),
    rectangularSelection(),
    crosshairCursor(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    ...darcula,
    EditorView.updateListener.of((update) => {
      const activePath = useTabsStore.getState().activePath
      if (update.docChanged && activePath) {
        useTabsStore.getState().setDirty(activePath, true)
        useTabsStore.getState().cacheText(activePath, update.state.doc.toString())
      }
      if ((update.selectionSet || update.docChanged) && activePath) {
        const pos = update.state.selection.main.head
        const line = update.state.doc.lineAt(pos)
        useTabsStore.getState().setCursor(activePath, line.number, pos - line.from + 1)
      }
    }),
  ]
}

export function CodeEditor() {
  const parent = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  /** 当前 CM6 文档对应的文件路径（用于判断是否需要换文档） */
  const docPathRef = useRef<string | null>(null)

  useEffect(() => {
    const state = EditorState.create({
      doc: '',
      extensions: [langCompartment.of([]), ...baseExtensions()],
    })
    const view = new EditorView({ state, parent: parent.current! })
    viewRef.current = view
    setEditorView(view)
    return () => {
      setEditorView(null)
      viewRef.current = null
      view.destroy()
    }
  }, [])

  const pending = useEditorStore((s) => s.pending)
  const activePath = useTabsStore((s) => s.activePath)

  // 消费待加载文档（新打开文件）
  useEffect(() => {
    const view = viewRef.current
    if (!view || !pending) return
    const lang = languageForPath(pending.path)
    // LSP：按语言取 client 并挂插件（2.5 池化；未安装则纯语法模式）
    const lspId = languageIdForPath(pending.path)
    if (lspId) {
      void clientFor(lspId).then((client) => {
        if (!client) return
        noteDocOpened(lspId)
        try {
          const plugin = client.plugin(`file://${pending.path.replaceAll('\\', '/')}`)
          const v = viewRef.current
          if (v && docPathRef.current === pending.path) {
            v.dispatch({ effects: StateEffect.appendConfig.of(plugin) })
          }
        } catch (e) {
          console.warn('LSP 插件挂载失败（降级语法模式）:', e)
        }
      })
    }
    view.setState(
      EditorState.create({
        doc: pending.text,
        extensions: [
          langCompartment.of(lang ?? []),
          ...baseExtensions(),
        ],
      }),
    )
    if (pending.cursor) {
      const lineNo = Math.min(pending.cursor.line, view.state.doc.lines)
      const line = view.state.doc.line(lineNo)
      view.dispatch({ selection: { anchor: line.from + Math.max(0, pending.cursor.col - 1) } })
    }
    docPathRef.current = pending.path
    useEditorStore.setState({ pending: null })
  }, [pending])

  // 切 tab：缓存旧文档文本 → 加载新 tab（缓存优先，否则读盘）
  useEffect(() => {
    const view = viewRef.current
    if (!view || !activePath) return
    if (docPathRef.current === activePath) return
    const prev = docPathRef.current
    if (prev) {
      useTabsStore.getState().cacheText(prev, view.state.doc.toString())
    }
    const cached = useTabsStore.getState().getCachedText(activePath)
    if (cached !== undefined) {
      const lang = languageForPath(activePath)
      view.setState(
        EditorState.create({
          doc: cached,
          extensions: [langCompartment.of(lang ?? []), ...baseExtensions()],
        }),
      )
      docPathRef.current = activePath
    } else {
      void useEditorStore.getState().openFile(activePath)
    }
  }, [activePath])

  return <div className="editor-container" ref={parent} />
}
