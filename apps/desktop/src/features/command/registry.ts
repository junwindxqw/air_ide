// 命令系统（2.10）：注册表全局唯一，键位解析为纯函数（可单测）。

// [[NEXT]]

export interface Command {
  id: string
  title: string
  category: string
  keybinding?: string
  run: () => void | Promise<void>
}

const commands = new Map<string, Command>()

export function registerCommand(cmd: Command): void {
  if (commands.has(cmd.id)) {
    console.warn(`命令重复注册: ${cmd.id}`)
  }
  commands.set(cmd.id, cmd)
}

export function getCommand(id: string): Command | undefined {
  return commands.get(id)
}

export function allCommands(): Command[] {
  return [...commands.values()]
}

/** 由键盘事件归一化出 chord 字符串，如 "Ctrl+Shift+P"。顺序固定：Ctrl, Alt, Shift, Key。 */
export function chordFromEvent(
  e: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'key'>,
): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  let key = e.key
  if (key === ' ') key = 'Space'
  if (key.length === 1) key = key.toUpperCase()
  parts.push(key)
  return parts.join('+')
}

/** 按 chord 查找已注册命令。 */
export function commandForChord(chord: string): Command | undefined {
  for (const cmd of commands.values()) {
    if (cmd.keybinding === chord) return cmd
  }
  return undefined
}

/** 执行命令；成功返回 true。 */
export async function executeCommand(id: string): Promise<boolean> {
  const cmd = commands.get(id)
  if (!cmd) {
    console.warn(`未知命令: ${id}`)
    return false
  }
  try {
    await cmd.run()
    return true
  } catch (e) {
    console.error(`命令执行失败 ${id}:`, e)
    return false
  }
}

