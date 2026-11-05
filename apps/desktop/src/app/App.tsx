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
import { useUiStore } from '@/app/uiStore'

// [[NEXT]]

export default function App() {
  useEffect(() => {
    // 全局键位（3.9.1 的 P0 子集：Alt+1/9、Esc、Shift+Esc、Ctrl+S）
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

    // 原生菜单 → 命令
    const unlisteners: Array<Promise<() => void>> = [
      listen<string>('menu://action', (e) => {
        void executeCommand(e.payload)
      }),
      listen<string>('app://open-path', (e) => {
        void useEditorStore.getState().openFile(e.payload)
      }),
    ]

    // [[NEXT]]

    return () => {
      window.removeEventListener('keydown', onKey)
      void Promise.all(unlisteners).then((offs) => offs.forEach((off) => off()))
    }
  }, [])

  // 启动时接收命令行初始路径（P0-2）+ 冷启动埋点（0.4 基准）
  useEffect(() => {
    void invoke('app_report_benchmark', {
      metric: 'cold_start_interactive_ms',
      ms: performance.now(),
      detail: 'React 首次 effect',
    })
    void invoke<string | null>('app_take_initial_args').then((path) => {
      if (path) void useEditorStore.getState().openFile(path)
    })
  }, [])

  return <Layout />
}

