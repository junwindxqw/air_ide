// 状态栏（2.9 布局）：分支占位 | 编码 | 行尾 | 语言 | 行列 | 临时消息。
// 属 app 层（聚合多个 feature 的状态）；ui/ 只放纯基元（3.3 边界）。
import { useState } from 'react'
import { useTabsStore } from '@/features/editor/tabs'
import { useEditorStore } from '@/features/editor/store'
import { languageNameForPath } from '@/features/editor/langMap'
import { EncodingSwitch } from '@/features/editor/EncodingSwitch'

export function StatusBar() {
  const activePath = useTabsStore((s) => s.activePath)
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.path === s.activePath))
  const cursor = activeTab?.cursor ?? { line: 1, col: 1 }
  const statusFlash = useEditorStore((s) => s.statusFlash)
  const [switchKind, setSwitchKind] = useState<'encoding' | 'eol' | null>(null)

  const fileName = activePath ? activePath.replaceAll('\\', '/').split('/').pop() : null
  const meta = activeTab?.meta

  return (
    <div className="status-bar">
      <span className="sb-item sb-flash">{statusFlash ?? ''}</span>
      <span className="sb-spacer" />
      {activePath && (
        <span className="sb-item">
          {activeTab?.dirty ? '● ' : ''}
          {fileName}
        </span>
      )}
      {meta && (
        <button
          className="sb-item sb-clickable"
          onClick={() => setSwitchKind('encoding')}
          title="切换编码（重新解释 / 转换并保存）"
        >
          {meta.encoding.toUpperCase()}
        </button>
      )}
      {meta && (
        <button
          className="sb-item sb-clickable"
          onClick={() => setSwitchKind('eol')}
          title="切换行尾"
        >
          {meta.eol.toUpperCase()}
        </button>
      )}
      {activePath && <span className="sb-item">{languageNameForPath(activePath)}</span>}
      <span className="sb-item">
        Ln {cursor.line}, Col {cursor.col}
      </span>
      <EncodingSwitch
        open={switchKind !== null}
        kind={switchKind ?? 'encoding'}
        onClose={() => setSwitchKind(null)}
      />
    </div>
  )
}
