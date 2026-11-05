// App 装配层（2.3 约束：App.tsx 只做装配）。
import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { Layout } from '@/app/Layout'
import '@/features/command/commands'
import {
  chordFromEvent,
  commandForChord,
  executeCommand,
} from '@/features/command/registry'
import { useEditorStore } from '@/features/editor/store'
import { useTabsStore } from '@/features/editor/tabs'
import { useUiStore } from '@/app/uiStore'
import { session as sessionIpc, recentProjects, drafts as draftsIpc } from '@/ipc/session'
import { fsWatch, onExternalChange, onRescan } from '@/ipc/watch'
import { useExplorerStore } from '@/features/explorer/store'

export default function App() {
  useEffect(() => {
    // 全局键位（3.9.1 的 P1 子集）
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'Escape') {
        e.preventDefault()
        useUiStore.getState().hideActiveToolWindow()
        return
      }
      const cmd = commandForChord(chordFromEvent(e))
      if (cmd) {
        e.preventDefault()
        void executeCommand(cmd.id)
      }
    }
    window.addEventListener('keydown', onKey)

    const unlisteners: Array<Promise<() => void>> = [
      listen<string>('menu://action', (e) => {
        void executeCommand(e.payload)
      }),
      listen<string>('app://open-path', (e) => {
        void useEditorStore.getState().openFile(e.payload)
      }),
      // 3.11 外部修改三态：干净 tab 自动重载；脏 tab 弹横幅
      onExternalChange((paths) => {
        const activePath = useTabsStore.getState().activePath
        const dirty = useTabsStore
          .getState()
          .tabs.find((t) => t.path === activePath)?.dirty
        const norm = (p: string) => p.replaceAll('\\', '/')
        const hit = paths.some((p) => norm(p) === norm(activePath ?? ''))
        if (hit && activePath) {
          if (dirty) {
            useEditorStore.getState().setExternalChange({ path: activePath })
          } else {
            void useEditorStore.getState().reloadCurrent()
          }
        }
        // 文件树刷新受影响的父目录
        const explorer = useExplorerStore.getState()
        for (const p of paths) {
          const dir = norm(p).split('/').slice(0, -1).join('/')
          if (dir && explorer.children.has(dir)) void explorer.refreshDir(dir)
        }
      }),
      // 3.12.4 监听溢出 → 全量重扫
      onRescan((root) => {
        const explorer = useExplorerStore.getState()
        if (explorer.root === root) void explorer.refreshDir(root)
      }),
    ]

    return () => {
      window.removeEventListener('keydown', onKey)
      void Promise.all(unlisteners).then((offs) => offs.forEach((off) => off()))
    }
  }, [])

  // 启动：接收命令行初始路径 + 恢复会话 + 冷启动埋点
  useEffect(() => {
    void invoke('app_report_benchmark', {
      metric: 'cold_start_interactive_ms',
      ms: performance.now(),
      detail: 'React 首次 effect',
    })
    void invoke<string | null>('app_take_initial_args').then((path) => {
      if (path) void useEditorStore.getState().openFile(path)
    })
    void restoreSession()
  }, [])

  return <Layout />
}

/** 恢复上次会话（3.10）：workspaceRoot + 打开的 tab + 草稿内容。 */
async function restoreSession() {
  try {
    const s = await sessionIpc.load()
    if (s.workspaceRoot) {
      useUiStore.getState().setWorkspaceRoot(s.workspaceRoot)
      useExplorerStore.getState().setRoot(s.workspaceRoot)
      await fsWatch(s.workspaceRoot)
      void recentProjects.push(s.workspaceRoot)
    }

    // 草稿优先：崩溃前未保存的内容进 textCache 并标脏（P2 补）
    let draftCount = 0
    try {
      const drafts = await draftsIpc.load()
      for (const d of drafts) {
        useTabsStore.getState().cacheText(d.path, d.text)
        draftCount += 1
      }
    } catch (e) {
      console.error('草稿加载失败', e)
    }

    for (const entry of s.openFiles) {
      try {
        const { fsReadFile } = await import('@/ipc/fs')
        const loaded = await fsReadFile(entry.path)
        if (loaded.meta.isBinary) continue
        const cached = useTabsStore.getState().getCachedText(entry.path)
        useTabsStore.getState().openFile(entry.path, loaded.meta, false)
        if (cached !== undefined) {
          useTabsStore.getState().setDirty(entry.path, true)
        }
      } catch {
        // 路径不存在：静默跳过（3.10 恢复语义）
      }
    }
    if (s.activeFile) {
      useTabsStore.getState().setActive(s.activeFile)
      void useEditorStore.getState().openFile(s.activeFile)
    }
    if (draftCount > 0) {
      useEditorStore
        .getState()
        .flash(`已恢复 ${draftCount} 个未保存文件`)
    }
  } catch (e) {
    console.error('会话恢复失败', e)
  }
}
