// 前端模糊匹配（与 Rust nucleo 同思路的子序列计分，供命令面板/快速打开用）。
// 可单测（5.1：键位解析与匹配逻辑必须覆盖）。
export function nucleoScore(haystack: string, needle: string): number {
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase().trim()
  if (n.length === 0) return 1
  if (n.length > h.length) return 0

  let score = 0
  let hi = 0
  let consecutive = 0
  for (const ch of n) {
    const idx = h.indexOf(ch, hi)
    if (idx < 0) return 0
    consecutive = idx === hi ? consecutive + 1 : 0
    // 连续匹配加权；越靠前加权略高
    score += 10 + consecutive * 5 - Math.min(idx, 20) * 0.1
    hi = idx + 1
  }
  // 完整词边界奖励（如 "commit" 命中 "git commit" 的词首）
  if (h.startsWith(n)) score += 30
  return Math.round(score)
}
