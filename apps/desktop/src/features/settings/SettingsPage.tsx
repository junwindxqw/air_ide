// 设置页（3.14 清单）：编辑器/外观/Git/系统 四组，含导入导出与 schemaVersion。
import { useEffect, useState } from 'react'
import { settings as settingsIpc, type Settings } from '@/ipc/session'

export function SettingsPage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) {
      void settingsIpc.load().then(setDraft)
      setSaved(false)
    }
  }, [open])

  if (!open || !draft) return null

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
    setSaved(false)
  }

  const updateEditor = <K extends keyof Settings['editor']>(
    key: K,
    value: Settings['editor'][K],
  ) => {
    setDraft((d) => (d ? { ...d, editor: { ...d.editor, [key]: value } } : d))
    setSaved(false)
  }

  const save = async () => {
    if (!draft) return
    await settingsIpc.save(draft)
    setSaved(true)
    // 立即生效：编辑器字号/行高走 CSS 变量
    document.documentElement.style.setProperty('--editor-font-size', `${draft.editor.fontSize}px`)
  }

  const exportSettings = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'air-ide-settings.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importSettings = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const parsed = JSON.parse(text) as Settings
        // schemaVersion 校验：只导入认识的字段（3.10）
        if (typeof parsed.schemaVersion === 'number' && parsed.schemaVersion > draft.schemaVersion) {
          alert('该设置文件来自更高版本，部分设置可能不被支持')
        }
        setDraft({ ...draft, ...parsed, schemaVersion: draft.schemaVersion })
      } catch {
        alert('设置文件解析失败')
      }
    }
    input.click()
  }

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="settings-page" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span>设置</span>
          <button className="diff-close" onClick={onClose} aria-label="关闭设置">
            ×
          </button>
        </div>
        <div className="settings-body">
          <Section title="编辑器">
            <NumberRow
              label="字号"
              value={draft.editor.fontSize}
              min={9}
              max={32}
              onChange={(v) => updateEditor('fontSize', v)}
            />
            <NumberRow
              label="行高"
              value={draft.editor.lineHeight}
              min={1}
              max={2}
              step={0.1}
              onChange={(v) => updateEditor('lineHeight', v)}
            />
            <ToggleRow
              label="行号"
              value={draft.editor.lineNumbers}
              onChange={(v) => updateEditor('lineNumbers', v)}
            />
            <ToggleRow
              label="当前行高亮"
              value={draft.editor.currentLineHighlight}
              onChange={(v) => updateEditor('currentLineHighlight', v)}
            />
            <ToggleRow
              label="文件树自动定位当前 tab"
              value={draft.editor.autoRevealInTree}
              onChange={(v) => updateEditor('autoRevealInTree', v)}
            />
            <ToggleRow
              label="失焦自动保存"
              value={draft.editor.saveOnFocusLoss}
              onChange={(v) => updateEditor('saveOnFocusLoss', v)}
            />
            <NumberRow
              label="大文件降级阈值 (MB)"
              value={draft.editor.largeFileThresholdMb}
              min={1}
              max={20}
              onChange={(v) => updateEditor('largeFileThresholdMb', v)}
            />
            <NumberRow
              label="只读阈值 (MB)"
              value={draft.editor.readonlyThresholdMb}
              min={5}
              max={100}
              onChange={(v) => updateEditor('readonlyThresholdMb', v)}
            />
          </Section>

          <Section title="外观">
            <SelectRow
              label="主题"
              value={draft.appearance.theme}
              options={[
                { value: 'system', label: '跟随系统' },
                { value: 'darcula-dark', label: 'Darcula Dark' },
                { value: 'intellij-light', label: 'IntelliJ Light' },
              ]}
              onChange={(v) => update('appearance', { theme: v })}
            />
          </Section>

          <Section title="Git">
            <ToggleRow
              label="提交时 sign-off"
              value={draft.git.signoff}
              onChange={(v) => update('git', { ...draft.git, signoff: v })}
            />
            <ToggleRow
              label="Diff 默认忽略空白差异"
              value={draft.git.ignoreWhitespace}
              onChange={(v) => update('git', { ...draft.git, ignoreWhitespace: v })}
            />
            <ToggleRow
              label="Diff 默认双栏"
              value={draft.git.diffDefaultSplit}
              onChange={(v) => update('git', { ...draft.git, diffDefaultSplit: v })}
            />
            <NumberRow
              label="status 刷新节流 (ms)"
              value={draft.git.statusThrottleMs}
              min={100}
              max={2000}
              step={100}
              onChange={(v) => update('git', { ...draft.git, statusThrottleMs: v })}
            />
          </Section>

          <Section title="系统">
            <ToggleRow
              label="单实例"
              value={draft.system.singleInstance}
              onChange={(v) => update('system', { ...draft.system, singleInstance: v })}
            />
            <ToggleRow
              label="自动更新"
              value={draft.system.autoUpdate}
              onChange={(v) => update('system', { ...draft.system, autoUpdate: v })}
            />
            <ToggleRow
              label="Defender 排除提示"
              value={draft.system.defenderHint}
              onChange={(v) => update('system', { ...draft.system, defenderHint: v })}
            />
          </Section>
        </div>
        <div className="settings-footer">
          <button className="external-btn" onClick={exportSettings}>
            导出
          </button>
          <button className="external-btn" onClick={importSettings}>
            导入
          </button>
          <span className="settings-spacer" />
          <span className="settings-saved">{saved ? '已保存' : ''}</span>
          <button className="external-btn primary" onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 行组件 ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <div className="settings-section-title">{title}</div>
      {children}
    </div>
  )
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="settings-row">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

function NumberRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <label className="settings-row">
      <span>{label}</span>
      <input
        type="number"
        className="settings-number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
        }}
      />
    </label>
  )
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <label className="settings-row">
      <span>{label}</span>
      <select
        className="settings-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

