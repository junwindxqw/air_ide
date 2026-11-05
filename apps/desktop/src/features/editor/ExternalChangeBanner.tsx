// 外部修改三态横幅（3.11）：脏 tab 文件被外部修改时出现，
// 「重新加载 / 保留我的 / 对比差异」三选项；重载不进 undo 栈（reloadCurrent 处理）。
import { useEditorStore } from '@/features/editor/store'

export function ExternalChangeBanner() {
  const externalChange = useEditorStore((s) => s.externalChange)
  const reloadCurrent = useEditorStore((s) => s.reloadCurrent)
  const dismiss = useEditorStore((s) => s.setExternalChange)

  if (!externalChange) return null
  const fileName = externalChange.path.replaceAll('\\', '/').split('/').pop()

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
          onClick={() => {
            // P1 最小 diff 阶段：打开 Changes 面板的双击 diff 入口由 P2 完善；
            // 此处先关闭横幅并提示用 Git 面板查看
            dismiss(null)
          }}
          title="P2 提供文件级对比视图"
        >
          对比差异
        </button>
      </span>
    </div>
  )
}
