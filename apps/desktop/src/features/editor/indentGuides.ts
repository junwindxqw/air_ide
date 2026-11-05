// 编辑器细节（P1-8）：缩进参考线（自写 ViewPlugin + decoration，2.4 清单约 80 行）。
import {
  ViewPlugin,
  type ViewUpdate,
  Decoration,
  type DecorationSet,
  EditorView,
} from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'

/** 每行行首空白后的缩进宽度画一条浅色竖线（JetBrains 样式）。 */
export const indentGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildGuides(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildGuides(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

function buildGuides(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const tabSize = 4
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      const text = line.text
      // 统计行首缩进（空格按 1、tab 按 tabSize 折算列）
      let col = 0
      let i = 0
      const marks: Array<{ offset: number; col: number }> = []
      while (i < text.length) {
        const ch = text[i]
        if (ch === ' ') {
          col += 1
        } else if (ch === '\t') {
          col = (Math.floor(col / tabSize) + 1) * tabSize
        } else {
          break
        }
        // 每满一个缩进单位画一条线
        if (col > 0 && col % tabSize === 0) {
          marks.push({ offset: i + 1, col })
        }
        i += 1
      }
      for (const m of marks) {
        builder.add(
          line.from + m.offset,
          line.from + m.offset,
          Decoration.mark({
            attributes: { class: 'cm-indent-guide' },
          }),
        )
      }
      pos = line.to + 1
    }
  }
  return builder.finish()
}
