// E2E 共用断言/报告器：统一 PASS/FAIL/SKIP 输出，并把结构化结果落盘。
// 落盘路径由 run-all.mjs 通过 AIR_E2E_RESULT_FILE 传入；单独运行脚本时不落盘。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export function createReporter(suite, label = suite) {
  const startedAt = new Date()
  const results = []

  function record(status, name, detail = '') {
    results.push({ status, name, detail })
    console.log(`${status}  ${name}${detail ? ` — ${detail}` : ''}`)
  }

  function check(name, ok, detail = '') {
    record(ok ? 'PASS' : 'FAIL', name, detail)
  }

  // 明确的人工检查/无法自动判定项：不计失败，但显式留痕，避免「永远通过」。
  function skip(name, reason = '') {
    record('SKIP', name, reason)
  }

  function finish(summaryLabel = label) {
    const passed = results.filter((r) => r.status === 'PASS').length
    const failed = results.filter((r) => r.status === 'FAIL')
    const skipped = results.filter((r) => r.status === 'SKIP')

    console.log(
      `\n=== ${summaryLabel}结果: ${passed}/${results.length} 通过, ${failed.length} 失败, ${skipped.length} 跳过 ===`,
    )
    if (failed.length > 0) {
      console.log('失败项:', failed.map((f) => f.name).join(' | '))
    }
    if (skipped.length > 0) {
      console.log('跳过项:', skipped.map((s) => s.name).join(' | '))
    }

    const report = {
      suite,
      label,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      totals: { total: results.length, passed, failed: failed.length, skipped: skipped.length },
      results,
    }

    const outFile = process.env.AIR_E2E_RESULT_FILE
    if (outFile) {
      const target = resolve(outFile)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    }

    if (failed.length > 0) process.exitCode = 1
    return report
  }

  return { results, check, skip, finish }
}
