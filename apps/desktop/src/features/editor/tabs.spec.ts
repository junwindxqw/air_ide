// tabs store 单测（5.1：预览 tab 语义、关闭焦点规则、拖拽排序必须覆盖）。
import { describe, expect, it, beforeEach } from 'vitest'
import { useTabsStore } from '@/features/editor/tabs'
import type { FileMeta } from '@/ipc/fs'

const meta = (path: string): FileMeta => ({
  path,
  encoding: 'utf-8',
  eol: 'lf',
  hasBom: false,
  size: 10,
  isBinary: false,
  isLarge: false,
})

beforeEach(() => {
  useTabsStore.setState({
    tabs: [],
    activePath: null,
    accessOrder: [],
    textCache: new Map(),
  })
})

describe('useTabsStore', () => {
  it('打开新文件 → 激活 + 预览 tab', () => {
    useTabsStore.getState().openFile('a.php', meta('a.php'))
    const s = useTabsStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.activePath).toBe('a.php')
    expect(s.tabs[0].preview).toBe(true)
  })

  it('重复打开同一文件不新增 tab', () => {
    useTabsStore.getState().openFile('a.php', meta('a.php'))
    useTabsStore.getState().openFile('a.php', meta('a.php'))
    expect(useTabsStore.getState().tabs).toHaveLength(1)
  })

  it('新预览 tab 替换旧的未固定预览 tab（IntelliJ 语义）', () => {
    useTabsStore.getState().openFile('a.php', meta('a.php'), true)
    useTabsStore.getState().openFile('b.php', meta('b.php'), true)
    const s = useTabsStore.getState()
    expect(s.tabs.map((t) => t.path)).toEqual(['b.php'])
    expect(s.activePath).toBe('b.php')
  })

  it('固定后的 tab 不被预览 tab 替换', () => {
    useTabsStore.getState().openFile('a.php', meta('a.php'), true)
    useTabsStore.getState().makePermanent('a.php')
    useTabsStore.getState().openFile('b.php', meta('b.php'), true)
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(['a.php', 'b.php'])
  })

  it('脏预览 tab 不被替换', () => {
    useTabsStore.getState().openFile('a.php', meta('a.php'), true)
    useTabsStore.getState().setDirty('a.php', true)
    useTabsStore.getState().openFile('b.php', meta('b.php'), true)
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(['a.php', 'b.php'])
  })

  it('关闭 tab 后焦点回到上一个访问的 tab（3.9.2）', () => {
    useTabsStore.getState().openFile('a.php', meta('a.php'), false)
    useTabsStore.getState().openFile('b.php', meta('b.php'), false)
    useTabsStore.getState().openFile('c.php', meta('c.php'), false)
    // 访问序：c, b, a；关闭 c → 应回 b
    useTabsStore.getState().closeTab('c.php')
    expect(useTabsStore.getState().activePath).toBe('b.php')
  })

  it('closeOthers 只保留目标 tab', () => {
    useTabsStore.getState().openFile('a.php', meta('a.php'), false)
    useTabsStore.getState().openFile('b.php', meta('b.php'), false)
    useTabsStore.getState().closeOthers('b.php')
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(['b.php'])
  })

  it('拖拽排序', () => {
    useTabsStore.getState().openFile('a.php', meta('a.php'), false)
    useTabsStore.getState().openFile('b.php', meta('b.php'), false)
    useTabsStore.getState().openFile('c.php', meta('c.php'), false)
    useTabsStore.getState().reorder(0, 2)
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(['b.php', 'c.php', 'a.php'])
  })

  it('文本缓存存取与清理', () => {
    useTabsStore.getState().openFile('a.php', meta('a.php'), false)
    useTabsStore.getState().cacheText('a.php', 'hello')
    expect(useTabsStore.getState().getCachedText('a.php')).toBe('hello')
    useTabsStore.getState().clearCache('a.php')
    expect(useTabsStore.getState().getCachedText('a.php')).toBeUndefined()
  })

  it('关闭 tab 清理该 tab 的文本缓存', () => {
    useTabsStore.getState().openFile('a.php', meta('a.php'), false)
    useTabsStore.getState().cacheText('a.php', 'x')
    useTabsStore.getState().closeTab('a.php')
    expect(useTabsStore.getState().getCachedText('a.php')).toBeUndefined()
  })
})
