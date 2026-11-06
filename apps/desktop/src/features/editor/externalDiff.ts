// 外部修改「对比差异」的路径换算：Git diff 需要工作区相对路径。
export function workspaceRelPath(root: string | null | undefined, path: string): string | null {
  if (!root) return null
  const norm = (p: string) => p.replaceAll('\\', '/').replace(/\/+$/, '')
  const r = norm(root)
  const p = norm(path)
  if (p.toLowerCase() === r.toLowerCase()) return null
  if (!p.toLowerCase().startsWith(`${r.toLowerCase()}/`)) return null
  return p.slice(r.length + 1)
}
