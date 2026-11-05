// CM6 编辑器封装（P0-4）：单文档、按扩展名装载语言、脏标记与光标上报。
import { useEffect, useRef } from 'react'
import {
  EditorState,
  Compartment,
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
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { useEditorStore, setEditorView, getEditorView } from '@/features/editor/store'
import { languageForPath } from '@/features/editor/langMap'
import { darcula } from '@/features/editor/darcula'

const langCompartment = new Compartment()

function baseExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    foldGutter(),
    codeFolding(),
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
    EditorView.lineWrapping,
    ...darcula,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        useEditorStore.getState().setDirty(true)
      }
      if (update.selectionSet || update.docChanged) {
        const pos = update.state.selection.main.head
        const line = update.state.doc.lineAt(pos)
        useEditorStore
          .getState()
          .setCursor(line.number, pos - line.from + 1)
      }
    }),
  ]
}

export function CodeEditor() {
  const parent = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const state = EditorState.create({
      doc: '',
      extensions: [langCompartment.of([]), ...baseExtensions()],
    })
    const view = new EditorView({ state, parent: parent.current! })
    setEditorView(view)
    return () => {
      setEditorView(null)
      view.destroy()
    }
  }, [])

  const pending = useEditorStore((s) => s.pending)

  useEffect(() => {
    const view = getEditorView()
    if (!view || !pending) return
    const lang = languageForPath(pending.path)
    view.setState(
      EditorState.create({
        doc: pending.text,
        extensions: [langCompartment.of(lang ?? []), ...baseExtensions()],
      }),
    )
    useEditorStore.setState({ pending: null, dirty: false, cursor: { line: 1, col: 1 } })
  }, [pending])

  return <div className="editor-container" ref={parent} />
}

