// 编码切换的决策逻辑（3.16）：「重新解释」需要后端按指定编码重读，
// 但 fs_read_file 只做自动探测（air-fs::detect_and_decode），无法指定编码。
// 因此该模式在当前后端明确不可用，不能假装成功。

export type EncodingMode = 'reinterpret' | 'convert'

export const ENCODING_LABELS: Record<string, string> = {
  'utf-8': 'UTF-8',
  gb18030: 'GB18030',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  latin1: 'Latin-1',
}

export type EncodingDecision = 'convert' | 'noop' | 'unsupported'

/** 判断所选模式/编码能否执行；UI 与 apply 共用，避免按钮行为与提示不一致。 */
export function resolveEncodingDecision(
  mode: EncodingMode,
  detected: string,
  target: string,
): EncodingDecision {
  if (mode === 'convert') return 'convert'
  if (target === detected) return 'noop'
  return 'unsupported'
}
