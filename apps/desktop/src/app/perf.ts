// 性能埋点（方案 5.3）：用浏览器 performance 时间线记录关键路径，
// release 构建同样生效；脚本通过 CDP 读 performance.getEntriesByType('measure')。
// 不写日志、不上报，避免影响被测对象本身。

const START_SUFFIX = ':start'

export function perfStart(name: string): void {
  const start = `${name}${START_SUFFIX}`
  // 清掉同名旧标记：避免上一次未结束的计时串味
  performance.clearMarks(start)
  performance.mark(start)
}

/** 结束计时；没有对应的 start 标记时静默跳过（可安全地多处调用）。 */
export function perfEnd(name: string): void {
  const start = `${name}${START_SUFFIX}`
  if (performance.getEntriesByName(start, 'mark').length === 0) return
  performance.measure(name, start)
  performance.clearMarks(start)
}

/** 一次性的首帧回调后结束计时（包含一次绘制，贴近"首次可见"）。 */
export function perfEndOnPaint(name: string): void {
  requestAnimationFrame(() => perfEnd(name))
}
