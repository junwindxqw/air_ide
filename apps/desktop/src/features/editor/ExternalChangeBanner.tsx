// 外部修改三态横幅（3.11）：脏 tab 文件被外部修改时出现，
// 「重新加载 / 保留我的 / 对比差异」三选项；重载不进 undo 栈（reloadCurrent 处理）。
import { useState } from 'react'
import { useEditorStore } from '@/features/editor/store'
import { workspaceRelPath } from '@/features/editor/externalDiff'
import { openDiffFor, useDiffOverlay } from '@/features/git/openDiff'
import { useUiStore } from '@/app/uiStore'
import { normalizeError } from '@/ipc/invoke'

export function ExternalChangeBanner() {
  const externalChange = useEditorStore((s) => s.externalChange)
  const reloadCurrent = useEditorStore((s) => s.reloadCurrent)
  const flash = useEditorStore((s) => s.flash)
  const dismiss = useEditorStore((s) => s.setExternalChange)
  const [comparing, setComparing] = useState(false)

  if (!externalChange) return null
  const fileName = externalChange.path.replaceAll('\\', '/').split('/').pop()

  const openCompare = async () => {
    const rel = workspaceRelPath(useUiStore.getState().workspaceRoot, externalChange.path)
    if (!rel) {
      flash('无法对比差异：需要先打开工作区，且文件位于工作区内')
      return
    }
    setComparing(true)
    try {
      await openDiffFor(rel)
      // openDiff 内部吞掉错误（diff 保持旧值/null）：这里必须明确提示，不能静默关横幅
      const diff = useDiffOverlay.getState().diff
      const norm = (p: string) => p.replaceAll('\\', '/').toLowerCase()
      if (!diff || norm(diff.path) !== norm(rel) || diff.hunks.length === 0) {
        flash('无法获取该文件的 Git diff（可能未跟踪、无改动或不在 Git 仓库）')
        return
      }
      dismiss(null)
    } catch (e) {
      flash(`打开差异失败: ${normalizeError(e).message}`)
    } finally {
      setComparing(false)
    }
  }

  return (
    <div className="external-banner" role="alert">
      <span className="external-text">文件已在外部修改</span>
      <span className="external-file" title={externalChange.path}>
        {fileName}
      </span>
      <span className="external-actions">
        <button className="external-btn primary" onClick={() => void reloadCurrent()}>
          重新加载
        </button>
        <button className="external-btn" onClick={() => dismiss(null)}>
          保留我的
        </button>
        <button
          className="external-btn"
          onClick={() => void openCompare()}
          disabled={comparing}
          title="打开该文件的 Git diff（工作区 vs HEAD）"
        >
          {comparing ? '打开中…' : '对比差异'}
        </button>
      </span>
    </div>
  )
}
