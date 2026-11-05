// 扩展名 → 语言映射（3.6 profile 的最小实现，P4 扩展为完整注册表）。
import { php } from '@codemirror/lang-php'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { sql } from '@codemirror/lang-sql'
import type { LanguageSupport } from '@codemirror/language'

// [[NEXT]]

const factories: Record<string, () => LanguageSupport> = {
  php: php,
  html: html,
  css: css,
  json: json,
  markdown: markdown,
  sql: sql,
  python: python,
  rust: rust,
  javascript: javascript,
}

const extToLang: Record<string, string> = {
  php: 'php', // lang-php 内置 HTML 混写支持（3.6.1）
  phtml: 'php',
  html: 'html',
  htm: 'html',
  css: 'css',
  json: 'json',
  md: 'markdown',
  sql: 'sql',
  py: 'python',
  rs: 'rust',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'javascript',
  tsx: 'javascript',
}

/** 扩展名 → 语言名（用于状态栏显示）。 */
export function languageNameForPath(path: string): string {
  const lang = extToLang[extOf(path)]
  return lang ?? 'Plain Text'
}

/** 扩展名 → CM6 LanguageSupport（无匹配返回 null = 纯文本）。 */
export function languageForPath(path: string): LanguageSupport | null {
  const lang = extToLang[extOf(path)]
  if (!lang) return null
  return (factories[lang] ?? null)?.() ?? null
}

function extOf(path: string): string {
  const base = path.replaceAll('\\', '/').split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/** 扩展名 → LSP 语言 ID（与 Rust 注册表 KNOWN_LANGUAGES 对应）。
 *  无匹配返回 null（编辑器降级为纯语法模式，2.6）。 */
export function languageIdForPath(path: string): string | null {
  switch (extOf(path)) {
    case 'php':
    case 'phtml':
      return 'php'
    case 'go':
      return 'go'
    case 'py':
      return 'python'
    case 'rs':
      return 'rust'
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return 'javascript'
    case 'c':
    case 'h':
      return 'c'
    case 'cpp':
    case 'hpp':
    case 'cc':
      return 'cpp'
    case 'json':
      return 'json'
    case 'yaml':
    case 'yml':
      return 'yaml'
    case 'html':
    case 'htm':
      return 'html'
    case 'css':
      return 'css'
    case 'md':
    case 'markdown':
      return 'markdown'
    default:
      return null
  }
}

