# P5-8 第二段：发布闸口复跑（最终结论）

- 时间：2026-11-05 18:50（Asia/Shanghai）
- 仓库：d:\myProject\air_ide（P5-1~P5-7 + 4 项阻断修复，均未提交）
- 结论：**PASS（可进入发布前人工验收）**。上一轮 4 个阻断项全部清零，自动化闸口 0 失败。

## 1. 闸口结论

| # | 项目 | 结论 | 关键证据 |
|---|---|---|---|
| 1.1 | `pnpm --filter desktop check` / tsc | PASS | `tsc --noEmit` 无报错 |
| 1.2 | eslint（3.3 模块边界） | PASS | `0 errors, 1 warning`（WindowsIntegration.tsx:23 无用 disable，非阻断） |
| 1.3 | vitest | PASS | 13 文件 / **102** 用例全过，4.59s |
| 2 | `cargo test --workspace` | PASS | **96** 通过 / 0 失败 / 0 忽略；doc-tests 7 个 crate 均 0 |
| 3 | `cargo clippy --workspace --all-targets -- -D warnings` | PASS | exit 0，14.06s，零警告 |
| 4 | `pnpm build` + `tauri build` | PASS（退出码 1 属预期） | 产物生成；仅缺 `TAURI_SIGNING_PRIVATE_KEY`（D6） |
| 5.1 | `pnpm e2e:smoke`（冷启动 DEV） | PASS | 55/56，0 失败，1 跳过（gopls 未装） |
| 5.2 | `pnpm e2e:regression`（再次冷启动 DEV） | PASS | 64/67，0 失败，3 跳过 |
| 6.1 | DPI 行高为整数 px（3.12.2） | PASS | `dpr=1 lineHeight="16px"`（上一轮 15.6px） |
| 6.2 | eslint 边界 0 error | PASS | 见 1.2 |
| 6.3 | updater 用例真实执行 | PASS | `updater_manifest_scenarios ... ok`（独立重跑 1 passed，0.05s） |
| 7.1 | 崩溃标记：正常关窗 → 重启不弹 | PASS | 标记被清除 + 日志「Air IDE 正常退出」；重启无崩溃 WARN |
| 7.2 | 崩溃标记：强杀 → 重启弹 | PASS | 标记保留；重启日志 WARN「上次运行异常退出」；窗口级枚举到 3 个可见窗口，标题 `Air IDE 上次未正常退出` |
| 7.3 | 单一实例 | PASS | 第二实例启动后退出，`processCount=1`，第一实例窗口仍在；p0-windows 3.10 同结论 |
| 7.4 | 原生拖拽打开工作区 | SKIP（人工） | CDP 无法模拟原生拖放；`dropOpen.spec.ts` 5/5 已过 |
| 7.5 | `app_clear_running_marker` 安装前调用 | PASS | `updaterRuntime.spec.ts` 状态机用例通过 + 代码路径 |

## 2. 与上一轮的差异

| 项 | 上一轮 | 本轮 | 变化 |
|---|---|---|---|
| eslint | 4 error（ipc → features/win） | 0 error | 已修；`ipc/task.ts` 事件桥 + `air://lsp-install` 生效 |
| cargo test | updater_manifest 0xc0000139，54 通过 | 96 通过（含 updater 1） | 已修；build.rs `compile_for_tests` 嵌入 comctl32 v6 清单 |
| clippy | crash.rs:142 失败（lint 中断） | exit 0 | 已修；完整 lint 已跑完，无新告警 |
| regression | 63/67，1 失败（DPI 15.6px） | 64/67，0 失败（16px） | 已修；`Math.round(fontSize*lineHeight)` 生效 |
| 构建 | 产物生成，bundle 残留 0.2.0 | 产物生成，bundle 仅 0.1.0 | 打包前已清空遗留安装包 |
| smoke | 55/56 | 55/56 | 稳定复现，无回归 |
| 专项 | 崩溃/单实例 PASS | 全部 PASS（窗口级复验） | — |

本轮未发现新增失败项；业务代码未改动，未 commit。

## 3. 关键数字

| 指标 | 本轮实测 | 说明 |
|---|---|---|
| `target/release/air-ide.exe` | 11,346,944 B（**10.82 MB**） | 18:35 构建 |
| `bundle/nsis/Air IDE_0.1.0_x64-setup.exe` | 3,809,634 B（**3.63 MB**） | bundle 下仅此一个文件 |
| 前端主 bundle | `index-Cu9zFRnl.js` 1,221.27 KB（gzip ≈417 KB） | 另有 css 30.72 KB、app 0.22 KB、dist-js 1.09 KB |
| 10MB 文件打开（DEV） | **150 ms**（smoke 163 ms） | 阈值 ≤600ms，docLen=10,485,760 |
| 2000 文件目录列表 | **25 ms** | 阈值 ≤500ms |
| release 冷启动到主窗口 | **398 / 59 / 71 ms** | `MainWindowHandle` 可见口径；首次含新 exe 冷缓存/杀软扫描 |
| DPI 行高实测 | **"16px"**（dpr=1） | 13 × 1.2 → round 16，整数 CSS 像素 |
| 长路径 | 369 字符打开成功 | 3.12.1 |
| smoke / regression 耗时 | 约 44s / 46s | 各套件 p0 4.6s、p1 11.6s、p2 11.7s、p3 12.2s、p4 3.4s、p0-windows 5.9s |

## 4. 仍未覆盖的人工项（GUI 才能验）

- [ ] 首次安装/首次启动：欢迎页、引导文案、打开文件夹、最近项目。
- [ ] 原生拖拽：拖入单个目录打开工作区；多路径/单文件提示；与 DevTools 无关的真实拖放。
- [ ] DPI 125% / 150%：文字、图标、光标不模糊、不错位；跨不同 DPI 显示器拖动后对齐。
- [ ] Win11 暗色标题栏、最大化/还原、圆角阴影；Win10 2004 行为。
- [ ] 崩溃提示弹窗文案可读性（本轮只验证了标题与可见性，未目视正文）。
- [ ] NSIS 安装/卸载：快捷方式、跳转列表、任务栏进度、Defender 提示、资源管理器集成开关。
- [ ] 真实更新链路：配置私钥 → 生成 `.sig`/`latest.json` → 0.1.0 安装 → 发布 0.2.0 → 应用内更新 → 重启不弹崩溃提示。
- [ ] LSP 实机：安装 gopls 后启动/补全/诊断/idle 回收（本轮 SKIP）。
- [ ] 2000 文件目录与 10MB 文件的滚动/编辑手感（自动数字已达标）。

## 5. 遗留风险

1. **磁盘空间**：D 盘仅剩约 4.1 GB；本轮 cargo test 曾因空间不足触发 `LNK1318 PDB error LIMIT (12)`，清理 incremental/PDB 后恢复。正式打包/二次全量构建前需保证 ≥10 GB。
2. **real_repo 测试**曾出现瞬时 `Permission denied`（杀软/磁盘压力），单独重跑与全量重跑均通过；资源紧张时仍有偶发失败概率。
3. **E2E 不可 CI 化**：依赖 `D:/bench`、CDP 9222、每轮冷启动 app；同一实例连跑两轮会因 watcher 占用目录 `rmdir EBUSY` 与状态串场。
4. **签名未验证**：缺 `TAURI_SIGNING_PRIVATE_KEY`，`.sig`/`latest.json` 与真实升级链路未跑；只验证了安装包生成。
5. **DPI 自动项只覆盖 dpr=1**：整数行高已锁死，但 125%/150% 的栅格化清晰度仍需目视。
6. **非阻断警告**：eslint `WindowsIntegration.tsx:23` 无用 disable；tauri identifier `com.airide.app` 的 `.app` 结尾告警（沿用旧标识，未变）。

## 6. 证据路径

- smoke：`bench-out/e2e/2026-11-05_10-37-08-smoke/summary.json`（56 项，55 通过）
- regression：`bench-out/e2e/2026-11-05_10-39-40-regression/summary.json`（67 项，64 通过）
- 专项原始输出：[special-checks.txt](file:///d:/myProject/air_ide/bench-out/e2e/2026-11-05_18-50-release-gate/special-checks.txt)
- 上一轮报告：[REPORT.md](file:///d:/myProject/air_ide/bench-out/e2e/2026-11-05_18-15-release-gate/REPORT.md)
