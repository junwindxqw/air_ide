// Darcula (New UI) 编辑器主题，色值取自方案 2.9 表。
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

// [[NEXT]]

export const darculaEditorTheme = EditorView.theme(
  {
    '&': {
      color: '#DFE1E5',
      backgroundColor: '#1E1F22',
    },
    '.cm-content': {
      caretColor: '#AEAFAD',
      fontFamily: 'var(--editor-font)',
      fontSize: '13px',
    },
    '.cm-scroller': {
      lineHeight: '1.2',
      fontFamily: 'var(--editor-font)',
    },
    '.cm-gutters': {
      backgroundColor: '#1E1F22',
      color: '#7A7E85',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: '#2B2D30' },
    '.cm-activeLineGutter': { backgroundColor: '#2B2D30' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: '#214283',
    },
    '.cm-selectionMatch': { backgroundColor: '#37373B' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#AEAFAD' },
    '.cm-matchingBracket': {
      outline: '1px solid #88846F',
      backgroundColor: 'transparent',
      color: 'inherit',
    },
  },
  { dark: true },
)

export const darculaHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#CF8E6D' },
  { tag: t.moduleKeyword, color: '#CF8E6D' },
  { tag: t.controlKeyword, color: '#CF8E6D' },
  { tag: t.string, color: '#6AAB73' },
  { tag: t.number, color: '#2ACCB8' },
  { tag: t.bool, color: '#2ACCB8' },
  { tag: t.null, color: '#2ACCB8' },
  { tag: t.comment, color: '#7A7E85', fontStyle: 'italic' },
  { tag: t.typeName, color: '#B5B6E3' },
  { tag: t.className, color: '#B5B6E3' },
  { tag: t.function(t.variableName), color: '#56A8F5' },
  { tag: t.definition(t.variableName), color: '#56A8F5' },
  { tag: t.propertyName, color: '#C77DBB' },
  { tag: t.variableName, color: '#DFE1E5' },
  { tag: t.operator, color: '#CF8E6D' },
  { tag: t.punctuation, color: '#DFE1E5' },
  { tag: t.tagName, color: '#CF8E6D' },
  { tag: t.attributeName, color: '#B5B6E3' },
  { tag: t.constant(t.name), color: '#2ACCB8' },
  { tag: t.meta, color: '#C77DBB' },
])

export const darcula = [darculaEditorTheme, syntaxHighlighting(darculaHighlight)]

