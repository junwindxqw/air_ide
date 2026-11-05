// 状态栏（2.9 布局）：分支占位 | 编码 | 行尾 | 语言 | 行列 | 临时消息。
// 属 app 层（聚合多个 feature 的状态）；ui/ 只放纯基元（3.3 边界）。
import { useEditorStore } from '@/features/editor/store'
import { languageNameForPath } from '@/features/editor/langMap'

export function StatusBar() {
  const path = useEditorStore((s) => s.path)
  const meta = useEditorStore((s) => s.meta)
  const dirty = useEditorStore((s) => s.dirty)
  const cursor = useEditorStore((s) => s.cursor)
  const statusFlash = useEditorStore((s) => s.statusFlash)

  const fileName = path ? path.replaceAll('\\', '/').split('/').pop() : null

  return (
    <div className="status-bar">
      <span className="sb-item sb-flash">{statusFlash ?? ''}</span>
      <span className="sb-spacer" />
      {path && (
        <span className="sb-item">
          {dirty ? '● ' : ''}
          {fileName}
        </span>
      )}
      {meta && <span className="sb-item">{meta.encoding.toUpperCase()}</span>}
      {meta && <span className="sb-item">{meta.eol.toUpperCase()}</span>}
      {path && <span className="sb-item">{languageNameForPath(path)}</span>}
      <span className="sb-item">
        Ln {cursor.line}, Col {cursor.col}
      </span>
    </div>
  )
}
