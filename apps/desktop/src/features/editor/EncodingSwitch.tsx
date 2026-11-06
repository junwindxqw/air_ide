// 编码 / 行尾切换（3.16）：必须区分「重新解释」（按新编码重读，内容可能变）
// 与「转换并保存」（内容不变、字节变）。混淆这两者是乱码事故的常见来源。
import { useTabsStore } from '@/features/editor/tabs'
import { useEditorStore } from '@/features/editor/store'
import { ENCODING_LABELS } from '@/features/editor/encoding'
import { fsWriteFile, type FileMeta } from '@/ipc/fs'

export function EncodingSwitch({
  open,
  onClose,
  kind,
}: {
  open: boolean
  onClose: () => void
  kind: 'encoding' | 'eol'
}) {
  const activePath = useTabsStore((s) => s.activePath)
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.path === s.activePath))
  const flash = useEditorStore((s) => s.flash)

  if (!open || !activeTab?.meta || !activePath) return null

  const meta = activeTab.meta

  const apply = async (value: string) => {
    onClose()
    if (kind === 'encoding') {
      // 当前只支持「转换并保存」（重新解释在 UI 中已明确禁用）
      const { getEditorView } = await import('@/features/editor/store')
      const v = getEditorView()
      await fsWriteFile({
        path: activePath,
        text: v?.state.doc.toString() ?? '',
        encoding: value,
        eol: meta.eol === 'mixed' ? 'lf' : meta.eol,
        hasBom: meta.hasBom,
      })
      flash(`已转换为 ${ENCODING_LABELS[value] ?? value} 并保存`)
    } else {
      // 行尾切换：只改当前文件与新建默认值（3.16），保存即生效
      const { getEditorView } = await import('@/features/editor/store')
      const v = getEditorView()
      await fsWriteFile({
        path: activePath,
        text: v?.state.doc.toString() ?? '',
        encoding: meta.encoding,
        eol: value as FileMeta['eol'],
        hasBom: meta.hasBom,
      })
      flash(`行尾已切换为 ${value.toUpperCase()} 并保存`)
    }
  }

  const options =
    kind === 'encoding'
      ? [
          { value: 'utf-8', label: 'UTF-8' },
          { value: 'gb18030', label: 'GB18030' },
          { value: 'utf-16le', label: 'UTF-16 LE' },
          { value: 'utf-16be', label: 'UTF-16 BE' },
          { value: 'latin1', label: 'Latin-1' },
        ]
      : [
          { value: 'lf', label: 'LF' },
          { value: 'crlf', label: 'CRLF' },
        ]

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" style={{ width: 320 }} onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span>{kind === 'encoding' ? '切换编码' : '切换行尾'}</span>
          <button className="diff-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {kind === 'encoding' && (
          <>
            <div className="enc-mode-row">
              <label
                className="enc-mode"
                style={{ opacity: 0.55 }}
                title="读取文件时只做自动编码探测，无法按指定编码重读"
              >
                <input type="radio" checked={false} disabled />
                重新解释（不可用：后端只自动探测编码）
              </label>
              <label className="enc-mode">
                <input type="radio" checked={true} readOnly />
                转换并保存（内容不变，字节改变）
              </label>
            </div>
            <div
              style={{
                padding: '0 14px 10px',
                fontSize: 11,
                lineHeight: 1.5,
                color: 'var(--fg-secondary)',
              }}
            >
              重新解释需要按指定编码重读文件，当前后端只做自动探测，因此该模式不可用。
              改变编码请用「转换并保存」；若要按指定编码重新读取，请先在外部工具中转码。
            </div>
          </>
        )}
        <div className="palette-list">
          {options.map((o) => (
            <div
              key={o.value}
              className="palette-item"
              onClick={() => void apply(o.value)}
            >
              <span className="palette-title">{o.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
