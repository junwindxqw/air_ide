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
import { resolveEditorMode } from '@/features/editor/mode'
import { useSettingsStore } from '@/features/settings/settingsRuntime'
import type { FileMeta } from '@/ipc/fs'
import type { Settings } from '@/ipc/session'
import { clientFor, noteDocOpened } from '@/features/lsp/pool'
import { perfEndOnPaint } from '@/app/perf'

const langCompartment = new Compartment()
const featuresCompartment = new Compartment()

interface FeatureOptions {
  lineNumbers: boolean
  currentLineHighlight: boolean
  folding: boolean
  editable: boolean
  saveOnFocusLoss: boolean
}

/** 行号/当前行高亮/折叠/只读/失焦保存：可在设置变化时 reconfigure。 */
function featureExtensions(opts: FeatureOptions): Extension[] {
  return [
    ...(opts.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
    ...(opts.currentLineHighlight ? [highlightActiveLine()] : []),
    ...(opts.folding ? [foldGutter(), codeFolding()] : []),
    ...(opts.editable ? [] : [EditorState.readOnly.of(true), EditorView.editable.of(false)]),
    ...(opts.saveOnFocusLoss
      ? [
          EditorView.domEventHandlers({
            blur: () => {
              const path = useTabsStore.getState().activePath
              const tab = useTabsStore.getState().tabs.find((t) => t.path === path)
              if (path && tab?.dirty) void useEditorStore.getState().saveFile()
              return false
            },
          }),
        ]
      : []),
  ]
}

/** 按当前设置 + 文件大小得到特性开关（大文件关闭折叠/LSP，只读禁止编辑）。 */
function featuresFor(
  meta: FileMeta | null,
  editor: Settings['editor'],
): FeatureOptions & { readonly: boolean; large: boolean } {
  const mode = resolveEditorMode(meta ?? { size: 0, isLarge: false }, editor)
  return {
    large: mode.large,
    readonly: mode.readonly,
    lineNumbers: editor.lineNumbers,
    currentLineHighlight: editor.currentLineHighlight,
    folding: !mode.large,
    editable: !mode.readonly,
    saveOnFocusLoss: editor.saveOnFocusLoss,
  }
}

function baseExtensions(opts: FeatureOptions): Extension[] {
  return [
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
    featuresCompartment.of(featureExtensions(opts)),
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
  /** 已提示过大文件模式的路径（避免切 tab 重复闪提示） */
  const lastModePathRef = useRef<string | null>(null)

  useEffect(() => {
    const initial = featuresFor(null, useSettingsStore.getState().settings.editor)
    const state = EditorState.create({
      doc: '',
      extensions: [langCompartment.of([]), ...baseExtensions(initial)],
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
  const activeMeta = useTabsStore(
    (s) => s.tabs.find((t) => t.path === s.activePath)?.meta ?? null,
  )
  const editorSettings = useSettingsStore((s) => s.settings.editor)

  // 设置变更（字号除外的行号/当前行/折叠/只读/失焦保存）实时重建特性
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const features = featuresFor(activeMeta, editorSettings)
    view.dispatch({ effects: featuresCompartment.reconfigure(featureExtensions(features)) })
  }, [activeMeta, editorSettings])

  // 消费待加载文档（新打开文件）
  useEffect(() => {
    const view = viewRef.current
    if (!view || !pending) return
    const lang = languageForPath(pending.path)
    const meta =
      useTabsStore.getState().tabs.find((t) => t.path === pending.path)?.meta ?? null
    const settings = useSettingsStore.getState().settings.editor
    const mode = resolveEditorMode(meta ?? { size: 0, isLarge: false }, settings)
    // LSP：按语言取 client 并挂插件（2.5 池化；大文件/未安装则纯语法模式）
    const lspId = languageIdForPath(pending.path)
    if (lspId && !mode.large) {
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
          ...baseExtensions(featuresFor(meta, settings)),
        ],
      }),
    )
    if (pending.cursor) {
      const lineNo = Math.min(pending.cursor.line, view.state.doc.lines)
      const line = view.state.doc.line(lineNo)
      view.dispatch({ selection: { anchor: line.from + Math.max(0, pending.cursor.col - 1) } })
    }
    docPathRef.current = pending.path
    // 大文件降级必须有可见反馈，避免“静默关闭功能”
    if (lastModePathRef.current !== pending.path) {
      if (mode.readonly) {
        useEditorStore
          .getState()
          .flash(`只读模式：文件超过 ${settings.readonlyThresholdMb} MB，已关闭编辑与 LSP`)
      } else if (mode.large) {
        useEditorStore
          .getState()
          .flash(`大文件模式：已关闭 LSP 与代码折叠（阈值 ${settings.largeFileThresholdMb} MB）`)
      }
      lastModePathRef.current = pending.path
    }
    useEditorStore.setState({ pending: null })
    perfEndOnPaint('air.open_file')
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
      const meta =
        useTabsStore.getState().tabs.find((t) => t.path === activePath)?.meta ?? null
      view.setState(
        EditorState.create({
          doc: cached,
          extensions: [
            langCompartment.of(lang ?? []),
            ...baseExtensions(featuresFor(meta, useSettingsStore.getState().settings.editor)),
          ],
        }),
      )
      docPathRef.current = activePath
    } else {
      void useEditorStore.getState().openFile(activePath)
    }
  }, [activePath])

  return <div className="editor-container" ref={parent} />
}
