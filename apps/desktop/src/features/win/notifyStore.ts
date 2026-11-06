// 系统通知降级用的应用内提示队列（纯状态，不含 IPC）。
import { create } from 'zustand'

export type NotifyLevel = 'info' | 'warning' | 'error'

export interface NotifyMessage {
  title: string
  body: string
  level: NotifyLevel
  /** 场景标识，便于去重（如 lsp-installed / crash-recorded）。 */
  scene?: string
}

interface NotifyState {
  messages: NotifyMessage[]
  push: (m: NotifyMessage) => void
  dismiss: (index: number) => void
  clear: () => void
}

const MAX_MESSAGES = 4

export const useNotificationStore = create<NotifyState>((set) => ({
  messages: [],
  push: (m) =>
    set((s) => {
      const next = [...s.messages, m]
      return { messages: next.slice(Math.max(0, next.length - MAX_MESSAGES)) }
    }),
  dismiss: (index) => set((s) => ({ messages: s.messages.filter((_, i) => i !== index) })),
  clear: () => set({ messages: [] }),
}))
