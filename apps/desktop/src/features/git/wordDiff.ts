// 词级高亮（P2-2）：对同一 hunk 内的删除/新增行做行内 diff。
// 纯函数：输入旧行/新行，输出 [{start,end}] 区间（字符列），可单测（5.1）。
// 算法：先按公共前缀/后缀裁剪，再对中段做 LCS 字符级对齐。

export interface WordRange {
  start: number
  end: number
}

/** 行内 diff：返回旧行中"被删除"的区间与新行中"新增"的区间。 */
export function wordDiff(
  oldLine: string,
  newLine: string,
): { del: WordRange[]; add: WordRange[] } {
  // 1. 公共前缀
  let prefix = 0
  const minLen = Math.min(oldLine.length, newLine.length)
  while (prefix < minLen && oldLine[prefix] === newLine[prefix]) prefix++

  // 2. 公共后缀（不与前缀重叠）
  let suffix = 0
  while (
    suffix < minLen - prefix &&
    oldLine[oldLine.length - 1 - suffix] === newLine[newLine.length - 1 - suffix]
  ) {
    suffix++
  }

  const oldMid = oldLine.slice(prefix, oldLine.length - suffix)
  const newMid = newLine.slice(prefix, newLine.length - suffix)

  // 3. 中段 LCS：旧段中不在 LCS 的字符 = 删除；新段中不在 LCS 的 = 新增
  const { delInMid, addInMid } = lcsDiff(oldMid, newMid)

  const shift = (r: WordRange): WordRange => ({ start: r.start + prefix, end: r.end + prefix })
  return {
    // 词级高亮：把字符级差异扩展到所属词边界（JetBrains 行为：
    // 100→200 标整个数字，pay()→payNow() 标整个标识符）
    del: expandToWords(oldLine, delInMid.map(shift)),
    add: expandToWords(newLine, addInMid.map(shift)),
  }
}

/** 把字符区间扩展到词边界（标识符/数字/中文算词；符号各自成词）。 */
function expandToWords(line: string, ranges: WordRange[]): WordRange[] {
  if (ranges.length === 0) return ranges
  // 注意：\p{...} 属性转义必须带 u 标志，否则退化为字面字符类
  const isWordChar = (ch: string) => /[\p{L}\p{N}_$]/u.test(ch)
  const out: WordRange[] = []
  for (const r of ranges) {
    let start = r.start
    let end = r.end
    while (start > 0 && isWordChar(line[start - 1]) && isWordChar(line[start])) start--
    while (end < line.length && isWordChar(line[end - 1]) && isWordChar(line[end])) end++
    const last = out[out.length - 1]
    if (last && last.end >= start) {
      last.end = Math.max(last.end, end)
    } else {
      out.push({ start, end })
    }
  }
  return out
}

/** LCS 字符级 diff：返回两个中段里"差异字符"的区间。 */
function lcsDiff(a: string, b: string): { delInMid: WordRange[]; addInMid: WordRange[] } {
  if (a.length === 0 && b.length === 0) return { delInMid: [], addInMid: [] }
  if (a.length === 0) return { delInMid: [], addInMid: [{ start: 0, end: b.length }] }
  if (b.length === 0) return { delInMid: [{ start: 0, end: a.length }], addInMid: [] }

  const n = a.length
  const m = b.length
  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const delInMid: WordRange[] = []
  const addInMid: WordRange[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushRange(delInMid, i, i + 1)
      i++
    } else {
      pushRange(addInMid, j, j + 1)
      j++
    }
  }
  while (i < n) {
    pushRange(delInMid, i, i + 1)
    i++
  }
  while (j < m) {
    pushRange(addInMid, j, j + 1)
    j++
  }
  return { delInMid, addInMid }
}

/** 相邻区间合并（字符级 diff 产生大量单字符区间，合并减少 decoration 数量）。 */
function pushRange(ranges: WordRange[], start: number, end: number) {
  const last = ranges[ranges.length - 1]
  if (last && last.end === start) {
    last.end = end
  } else {
    ranges.push({ start, end })
  }
}
