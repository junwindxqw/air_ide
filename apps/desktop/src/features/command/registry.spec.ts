import { describe, expect, it } from 'vitest'
import { chordFromEvent, commandForChord, registerCommand } from '@/features/command/registry'

describe('chordFromEvent 键位归一化', () => {
  it('Ctrl+Shift+P 归一化为 Ctrl+Shift+P', () => {
    expect(
      chordFromEvent({ ctrlKey: true, altKey: false, shiftKey: true, key: 'p' }),
    ).toBe('Ctrl+Shift+P')
  })

  it('单字母转大写，空格转 Space', () => {
    expect(chordFromEvent({ ctrlKey: false, altKey: false, shiftKey: false, key: 's' })).toBe('S')
    expect(chordFromEvent({ ctrlKey: true, altKey: false, shiftKey: false, key: ' ' })).toBe(
      'Ctrl+Space',
    )
  })

  it('commandForChord 命中注册表', () => {
    registerCommand({
      id: 'test.dummy',
      title: '测试',
      category: '测试',
      keybinding: 'Ctrl+Alt+T',
      run: () => undefined,
    })
    expect(commandForChord('Ctrl+Alt+T')?.id).toBe('test.dummy')
    expect(commandForChord('Ctrl+Alt+X')).toBeUndefined()
  })
})

