// 全局 diff 浮层宿主：渲染 useDiffOverlay 的 SplitDiff。
import { SplitDiff } from '@/features/git/SplitDiff'
import { useDiffOverlay } from '@/features/git/openDiff'

export function GlobalDiff() {
  const diff = useDiffOverlay((s) => s.diff)
  const ignoreWs = useDiffOverlay((s) => s.ignoreWs)
  const close = useDiffOverlay((s) => s.close)
  const setIgnoreWs = useDiffOverlay((s) => s.setIgnoreWs)

  if (!diff) return null
  return (
    <SplitDiff
      diff={diff}
      onClose={close}
      ignoreWs={ignoreWs}
      onToggleIgnoreWs={() => setIgnoreWs(!ignoreWs)}
    />
  )
}
