// 文件树右键菜单与文件操作（P1-4）。
// 操作经 Rust 侧命令（fs_create/fs_rename/fs_delete 在 P1 的 IPC 集合中），
// "在资源管理器显示" 用 tauri opener 或 shell 命令。
import { useState } from 'react'
import { useExplorerStore } from '@/features/explorer/store'
import { airInvoke } from '@/ipc/invoke'

function dirnameOf(p: string): string {
  const norm = p.replaceAll('\\', '/')
  const idx = norm.lastIndexOf('/')
  return idx <= 0 ? norm : norm.slice(0, idx)
}

function basenameOf(p: string): string {
  const norm = p.replaceAll('\\', '/')
  return norm.slice(norm.lastIndexOf('/') + 1)
}

function joinPath(dir: string, name: string): string {
  return dir.replaceAll('\\', '/').replace(/\/$/, '') + '/' + name
}

export function FileTreeMenu() {
  const target = useExplorerStore((s) => s.contextTarget)
  const close = useExplorerStore((s) => s.openContextMenu)
  const refreshDir = useExplorerStore((s) => s.refreshDir)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ dir: string; isDir: boolean } | null>(null)
  const [nameInput, setNameInput] = useState('')

  if (!target) return null
  const menuPos = { x: target.x, y: target.y }
  const dir = target.isDir ? target.path : dirnameOf(target.path)
  const closeAll = () => {
    close(null)
    setRenaming(null)
    setCreating(null)
    setNameInput('')
  }

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn()
      await refreshDir(dir)
      closeAll()
    } catch (e) {
      console.error('文件操作失败', e)
    }
  }

  return (
    <>
      <div className="menu-backdrop" onClick={closeAll} onContextMenu={(e) => { e.preventDefault(); closeAll() }} />
      <div className="context-menu" style={{ left: menuPos.x, top: menuPos.y }}>
        {target.isDir && (
          <button className="menu-item" onClick={() => { setCreating({ dir: target.path, isDir: false }); setNameInput('') }}>
            新建文件
          </button>
        )}
        {target.isDir && (
          <button className="menu-item" onClick={() => { setCreating({ dir: target.path, isDir: true }); setNameInput('') }}>
            新建目录
          </button>
        )}
        <button className="menu-item" onClick={() => { setRenaming(target.path); setNameInput(basenameOf(target.path)) }}>
          重命名
        </button>
        <button className="menu-item" onClick={() => run(async () => {
          await airInvoke('fs_delete', { path: target.path })
        })}>
          删除
        </button>
        <div className="menu-sep" />
        <button className="menu-item" onClick={() => { void navigator.clipboard.writeText(target.path) }}>
          复制路径
        </button>
        <button className="menu-item" onClick={() => run(async () => {
          await airInvoke('fs_reveal', { path: target.path })
        })}>
          在资源管理器中显示
        </button>
      </div>

      {creating && (
        <div className="menu-backdrop" onClick={closeAll}>
          <div className="context-menu" style={{ left: menuPos.x, top: menuPos.y }} onClick={(e) => e.stopPropagation()}>
            <div className="menu-title">{creating.isDir ? '新建目录' : '新建文件'}</div>
            <input
              className="menu-input"
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Escape') closeAll()
                if (e.key === 'Enter' && nameInput.trim()) {
                  await run(async () => {
                    const full = joinPath(creating.dir, nameInput.trim())
                    await airInvoke('fs_create', { path: full, type: creating.isDir ? 'dir' : 'file' })
                  })
                }
              }}
              placeholder="名称"
            />
          </div>
        </div>
      )}

      {renaming && (
        <div className="menu-backdrop" onClick={closeAll}>
          <div className="context-menu" style={{ left: menuPos.x, top: menuPos.y }} onClick={(e) => e.stopPropagation()}>
            <div className="menu-title">重命名</div>
            <input
              className="menu-input"
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Escape') closeAll()
                if (e.key === 'Enter' && nameInput.trim()) {
                  const newPath = joinPath(dirnameOf(renaming), nameInput.trim())
                  await run(async () => {
                    await airInvoke('fs_rename', { path: renaming, newPath })
                  })
                }
              }}
            />
          </div>
        </div>
      )}
    </>
  )
}

// [[NEXT]]
