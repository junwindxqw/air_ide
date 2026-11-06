# 测试与回归基线（P5-8 收口）

本页定义两层测试、CI 必绿项与当前未覆盖项，并提供可重复执行的回归命令。适用于最终双系统回归。

## 1. 两层定义

| 层级 | 目的 | 组成 | 何时跑 | 判定 |
| --- | --- | --- | --- | --- |
| 冒烟 smoke | 确认核心链路没被改断 | `scripts/e2e/p0-smoke.mjs` ~ `p4-smoke.mjs`，经 CDP 驱动开发态 app | 提交前 / 合并前 / 改动涉及对应阶段时 | 任一 FAIL 即红；SKIP 显式留痕，不算通过 |
| 回归 regression | 发布前完整验证（含平台适配、性能、人工项） | smoke 全部 + `p0-windows.mjs` + `scripts/bench/*` 性能采集 + 本页第 4 节人工清单 | 每个候选版本、双系统发布前 | smoke 全绿 + 平台项全绿 + 性能不劣于基线 + 人工清单签字 |

说明：
- 所有 E2E 脚本都依赖 DEV-only 的 `window.__air` 测试桥（`apps/desktop/src/main.tsx`），release 包不存在该桥，因此 **E2E 只能在 `pnpm dev` 开发态跑**。
- 性能采集沿用 `scripts/bench/p5-release.mjs` / `p5-quick.mjs`，结果写入 `bench-out/*.jsonl`；这不是功能回归，单独在 release 构建上跑。

## 2. 回归执行方式（可重复）

前置（两个终端）：

```powershell
# 终端 A：开发态 app，开放 CDP
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
pnpm dev

# 终端 B：跑回归
pnpm e2e:smoke
pnpm e2e:regression
```

也可直接调用编排脚本（支持只跑部分套件、指定基线）：

```powershell
# 冒烟
node scripts/e2e/run-all.mjs --level smoke

# 完整回归（含 p0-windows）
node scripts/e2e/run-all.mjs --level regression

# 只跑 P3/P4
node scripts/e2e/run-all.mjs --level smoke --only p3-smoke,p4-smoke

# 指定基线版本：记录 ref/commit；若 bench-out/e2e 下已有同基线历史报告则自动对比
node scripts/e2e/run-all.mjs --level regression --base main
node scripts/e2e/run-all.mjs --level regression --base v0.1.0

# 允许回退但仍返回 0（仅用于观察，不作为发布依据）
node scripts/e2e/run-all.mjs --level regression --base main --allow-regressions
```

结果落盘（目录名带时间戳，已被 `.gitignore` 的 `bench-out/` 覆盖）：

```
bench-out/e2e/<YYYY-MM-DD_HH-MM-SS>-<level>/
  summary.json           # 汇总：逐套件、逐用例状态、totals、对比结果
  <suite>.json           # 单套件结构化结果
  <suite>.log            # 单套件完整输出（失败时先看这里）
bench-out/e2e/e2e-<level>-<stamp>.json   # 顶层副本，便于引用
```

退出码：`0` 全绿；`1` 有用例失败或对比发现回退；`2` 前置缺失（CDP 未开、参数错误），此时不产生结果。

`--base` 对比规则：以 `套件::用例名` 为键，基线 PASS→当前 FAIL 记为回退，FAIL→PASS 记为修复，并列出新增/缺失用例。

## 3. CI 必绿项（`.github/workflows/ci.yml`）

工作流在 `windows-latest` 上按顺序执行，任一步失败即红：

| # | 步骤 | 命令 | 覆盖内容 |
| --- | --- | --- | --- |
| 1 | 安装依赖 | `pnpm install --frozen-lockfile` | lockfile 必须与 package.json 同步 |
| 2 | TS / Lint / 单测 | `pnpm --filter desktop check` | `tsc --noEmit` + `eslint src` + `vitest run`（当前 11 个 spec） |
| 3 | Rust 测试 | `cargo test --workspace` | 工作区全部 crate + `src-tauri/tests` |
| 4 | 前端产物 | `pnpm --filter desktop exec vite build` | 前端可构建（不产出安装包） |

触发：向 `main` 的 push、面向 `main` 的 PR、手动 `workflow_dispatch`。不使用无意义的附加 job；缓存 pnpm 与 Rust（`Swatinem/rust-cache`）。

版本基线：Node 22、pnpm 11.22.0（与当前开发机一致）。仓库尚无 `packageManager` / `engines` 字段，见第 6 节。

### 3.1 必绿清单（发布前逐项勾）

- [ ] `pnpm --filter desktop check` 通过（tsc / eslint / vitest 11 个 spec）
- [ ] `cargo test --workspace` 通过（含 `air-git` 回归矩阵、`air-lsp` download、`air-fs`/`air-search`/`air-workspace`/`air-win`、`src-tauri` updater/签名）
- [ ] `vite build` 通过
- [ ] `pnpm install --frozen-lockfile` 通过（lockfile 已同步）
- [ ] 冒烟 5 个套件全绿（`bench-out/e2e` 最新 `summary.json`）

### 3.2 当前未覆盖 / 无法在 CI 判定的项

| 项 | 现状 | 处理 |
| --- | --- | --- |
| E2E 冒烟/回归 | 不在 CI：需要交互式 Windows 桌面 + WebView2 + CDP + 开发态 app | 发布前本机执行第 2 节命令 |
| `crates/air-core` 单元测试 | 无任何 `#[test]` | 未覆盖，列入补测待办 |
| 前端覆盖深度 | 仅 11 个纯逻辑 spec；React 组件/交互无单测 | 依赖 E2E 冒烟兜底 |
| 性能指标（冷启动/内存/10k 树/status/搜索/diff/大文件） | 不在 CI，需 release 构建与真实磁盘；diff 受 Defender 扫描影响 | 用 `scripts/bench/p5-release.mjs` 手工采集，对比 `bench-out/p5-release.jsonl` |
| 安装包 / NSIS / 签名 / 自动更新 | CI 不构建安装包；签名需私钥，更新需真实资产 | 走 release 流程与 `docs/UPDATER.md` |
| macOS 回归 | 无 macOS 专用脚本，仅有 Windows runner | 最终双系统回归时人工执行同一冒烟 + 平台人工项 |
| `window.__air` 测试桥 | DEV-only，release 不可用 | 发布验收必须额外做 release 包人工冒烟 |

## 4. 人工检查项（E2E 已显式标 SKIP）

- [ ] 3.12.2 DPI：125% / 150% 缩放下文字、图标、光标不模糊，编辑器行高不错位（自动项仅校验 dpr 有效 + 行高为整数 px）
- [ ] 3.12.3 暗色标题栏：窗口标题栏实际为暗色（DWM 属性无法从 WebView2 JS 读取）
- [ ] 3.10 单实例：双击 exe 第二次不新开窗口、原窗口前置
- [ ] 3.12.1 长路径：>260 字符路径可打开、可保存
- [ ] 文件外部修改三态横幅、编码切换（GBK/BOM/CRLF）在真实目录上手动复核一遍

## 5. 已修掉的「恒真」断言

| 位置 | 改前 | 改后 |
| --- | --- | --- |
| `p3-smoke.mjs` 命令条 | `check('Git 命令条 IPC 可用', true)` | 从命令面板打开命令条 → 写入 `status --short` → 点击执行 → 断言输出含 `src/Service.php` 且含 `退出码 0` |
| `p4-smoke.mjs` idle 回收 | `lspReap()` 后 `check(..., true)` | 读 `lspScan()` 的 `running` 真值：启动后必须 `running=true`，`reap(0)` 后必须 `false`；服务器未安装时显式 SKIP 并给出原因 |
| `p0-windows.mjs` DPI | `dpr > 0` 恒真 | 断言 dpr 有效、存在 `.cm-line`、行高为有限整数 px；视觉清晰度转为人工 SKIP |
| `p0-windows.mjs` 标题栏 | `document.title === 'Air IDE'` 当作暗色标题栏通过 | 改为「应用运行正常（标题正确且无错误边界）」+ 暗色标题栏人工 SKIP |

## 6. 遗留风险

1. **首次 CI 结果未实测**：本段按要求未执行 `cargo build` / `pnpm build`，工作流是静态编写。首次运行可能暴露 lockfile 未同步、`src-tauri` 测试依赖缺失或 Windows runner 差异。
2. **版本未锁死**：仓库无 `packageManager` / `engines`，CI 只能硬编码 Node 22 / pnpm 11.22.0。建议后续在根 `package.json` 增加 `packageManager` 与 `engines`（本段不允许改这两个字段）。
3. **E2E 未纳入 CI**：需要 GUI 桌面会话，标准 runner 无法直接复现；后续可考虑 self-hosted Windows runner。
4. **套件强依赖共享 app 实例**：`run-all.mjs` 串行执行，若某套件把 app 弄崩，后续套件会连锁失败；看 `<suite>.log` 区分根因。
5. **性能断言易受环境影响**：`p0-smoke` 的 10MB ≤600ms、`p0-windows` 的 2000 文件 ≤500ms 依赖机器状态，回归时应固定电源模式并排除 Defender 实时扫描干扰。
