// 文件树 UI（P1-4）：懒加载、忽略规则（Rust 侧已过滤 node_modules/.git）、
// 右键菜单（新建/重命名/删除/复制路径/在资源管理器显示）、自动定位当前 tab。
import { useEffect } from 'react'
import { useExplorerStore } from '@/features/explorer/store'
import type { TreeEntry } from '@/ipc/fs'
import { useEditorStore } from '@/features/editor/store'

const HIDDEN_NAMES = new Set(['node_modules', '.git', 'dist', 'target', '.DS_Store'])

function visible(entries: TreeEntry[]): TreeEntry[] {
  return entries.filter((e) => !HIDDEN_NAMES.has(e.name))
}

export function FileTree() {
  const root = useExplorerStore((s) => s.root)
  const loadDir = useExplorerStore((s) => s.loadDir)
  const children = useExplorerStore((s) => s.children)

  // 根目录首次加载
  useEffect(() => {
    if (root) void loadDir(root, true)
  }, [root, loadDir])

  if (!root) {
    return <div className="tree-empty">打开文件夹以浏览文件（Ctrl+Shift+O）</div>
  }

  const rootEntries = children.get(root) ?? []
  return (
    <div className="file-tree" role="tree">
      {visible(rootEntries).map((entry) => (
        <TreeRow key={entry.path} entry={entry} depth={0} />
      ))}
      {rootEntries.length === 0 && <div className="tree-empty">（空目录）</div>}
    </div>
  )
}

function TreeRow({ entry, depth }: { entry: TreeEntry; depth: number }) {
  const expanded = useExplorerStore((s) => s.expanded.has(entry.path))
  const loading = useExplorerStore((s) => s.loadingDirs.has(entry.path))
  const children = useExplorerStore((s) => s.children.get(entry.path))
  const selected = useExplorerStore((s) => s.selected === entry.path)
  const toggleDir = useExplorerStore((s) => s.toggleDir)
  const select = useExplorerStore((s) => s.select)
  const openContextMenu = useExplorerStore((s) => s.openContextMenu)
  const openFile = useEditorStore((s) => s.openFile)

  const isOpen = entry.isDir && expanded

  const handleClick = () => {
    select(entry.path)
    if (entry.isDir) void toggleDir(entry.path)
    else void openFile(entry.path)
  }

  return (
    <>
      <div
        className={`tree-row${selected ? ' selected' : ''}${entry.isDir ? ' dir' : ' file'}`}
        style={{ paddingLeft: 4 + depth * 14 }}
        role="treeitem"
        aria-expanded={entry.isDir ? isOpen : undefined}
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault()
          openContextMenu({ path: entry.path, isDir: entry.isDir, x: e.clientX, y: e.clientY })
        }}
      >
        <span className="tree-twisty">{entry.isDir ? (isOpen ? '▾' : '▸') : ''}</span>
        <span className="tree-icon">{entry.isDir ? '📁' : '📄'}</span>
        <span className="tree-name" title={entry.path}>
          {entry.name}
        </span>
        {loading && <span className="tree-loading">…</span>}
      </div>
      {isOpen && children && (
        <>
          {visible(children).map((child) => (
            <TreeRow key={child.path} entry={child} depth={depth + 1} />
          ))}
        </>
      )}
    </>
  )
}

