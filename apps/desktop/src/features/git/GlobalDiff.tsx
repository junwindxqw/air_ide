// 全局 diff 浮层宿主：渲染 useDiffOverlay 的 SplitDiff。
import { SplitDiff } from '@/features/git/SplitDiff'
import { useDiffOverlay } from '@/features/git/openDiff'

export function GlobalDiff() {
  const diff = useDiffOverlay((s) => s.diff)
  const diffText = useDiffOverlay((s) => s.diffText)
  const ignoreWs = useDiffOverlay((s) => s.ignoreWs)
  const close = useDiffOverlay((s) => s.close)
  const setIgnoreWs = useDiffOverlay((s) => s.setIgnoreWs)

  if (!diff) return null
  return (
    <SplitDiff
      diff={diff}
      diffText={diffText}
      onClose={close}
      ignoreWs={ignoreWs}
      onToggleIgnoreWs={() => setIgnoreWs(!ignoreWs)}
      onHunkOp={() => {
        // hunk 操作后刷新 Changes 列表（简单可靠：重新 open 当前 diff 由调用方处理）
        window.dispatchEvent(new CustomEvent('air:git-changed'))
      }}
    />
  )
}
