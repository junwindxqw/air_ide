# DEVLOG — 分阶段开发记录

按方案第 4 章执行。每阶段「检查测试 → 记录问题 → 修复」的结论记在这里；架构级变更另写 ADR。

## Phase 0：骨架与链路打通（2026-11-05 完成）

### 交付物

| 模块 | 内容 |
|---|---|
| `crates/air-core` | 统一错误类型（IPC 序列化为 `{code,message}`）、二进制信封（`[u32 meta_len][meta JSON][payload]`）、BenchRecord |
| `crates/air-fs` | 编码检测（UTF-8 严格 → GB18030 → Latin-1）、BOM、行尾三态、原子写（tmp+rename）、`list_dir`、二进制嗅探、大文件阈值（2/10/50MB） |
| `crates/air-win` | DWM 暗色标题栏（Win11 属性 20 / Win10 属性 19 降级）、路径归一化（dunce）、Git 探测 |
| `apps/desktop/src-tauri` | Tauri 2.12 主进程：单实例 + 参数转发、窗口状态、原生菜单（File/Edit/View/Git/Help）、6 个 IPC 命令、日志（tracing 按天滚动） |
| 前端 | React 19.3 + Vite 8.3 + TS strict；四区布局（Project/编辑器/Git/状态栏）、工具窗语义（Alt+1/9、Esc、Shift+Esc）、CM6（Darcula 主题 + 11 种语言）、命令注册表 + 键位引擎、错误分级封装 |
| 测试 | Rust 单测 7、vitest 3、CDP 冒烟 9、Windows 适配 9、基准脚本 |

### 自动化门禁状态（5.1）

| 项 | 状态 |
|---|---|
| `cargo check --workspace --all-targets` | 通过，0 warning |
| `cargo clippy -- -D warnings` | 通过 |
| `cargo test --workspace` | 7/7 通过 |
| `tsc --noEmit` | 0 error |
| `eslint src --max-warnings 0` | 通过（含 3.3 模块边界规则，真抓到 1 起违规并修复） |
| `vitest` | 3/3 通过 |
| E2E（CDP 冒烟） | 9/9 通过 |

### 基准数据（0.4 量化目标初值）

| 指标 | 目标 | 实测（dev 模式，debug 构建） | 结论 |
|---|---|---|---|
| 冷启动到可交互 | ≤800ms | **2223ms**（进程创建→前端 effect） | **未达标**——dev 模式含 Vite 按需编译 + 未优化构建，非 release 数字。P5 用 release 包复测；若仍超，按 5.3 定位 |
| 空闲内存 | ≤160MB | **142.2MB**（app 34.7 + WebView2 113.6，按父进程过滤） | 达标（余量 18MB，P1 加功能后需复测） |
| 打开 10MB 文件 | ≤600ms 可编辑 | **146ms** | 大幅达标 |
| 2000 文件目录列表 | —（P1 指标） | 21ms | — |

测量前提：Defender 实时防护 **on**、台式机（非电池）、Win11 专业版 build 26300。dev/debug 构建。

### 冒烟与平台适配（9/9 + 9/9）

- GBK 打开/保存字节级保真（`c4e3bac35048502bb8c40a`）
- UTF-8 BOM 检测与保存保留
- CRLF 检测 + 归一 + 保存回写（`610d0a620d0a`）
- 10MB 文件 146ms 打开
- 369 字符长路径文件正常打开
- 单实例锁：二次启动不新开进程（before=1 after=1）
- 自身保存不触发「外部修改」横幅（抑制表路径）

### 发现的问题与修复

| # | 问题 | 根因 | 修复 |
|---|---|---|---|
| 1 | app 启动即挂起（单线程、4.5MB、无窗口、无日志） | `build.rs` 内嵌自定义 manifest **整体替换**了 tauri 默认清单，丢了依赖声明 | 移除自定义 manifest；`longPathAware` 与 `PerMonitorV2` 改在 P5 评估正确嵌入方式（方案 3.12.1/3.12.2 结论仍成立，仅嵌入手段调整） |
| 2 | `src-tauri` 依赖路径少一级（`../../crates` → `../../../crates`） | 目录深度笔误 | 修正 |
| 3 | air-fs / air-win 的 Cargo.toml 静默丢失 | 首批 Write 未落盘 | 补齐 |
| 4 | `decode_without_bom_handling` 返回二元组，按三元组解构 | encoding_rs 0.8 API | 修正 3 处 |
| 5 | DWM 属性枚举当 i32 用、`Option::ok()?` 用于 Result | windows 0.62 API 语义 | 改用 `DWMWINDOWATTRIBUTE(19)` + `map_err` |
| 6 | `tmp_sibling` 中 `pid * 1_000_000` u32 溢出（debug panic） | 算术溢出 | 改字符串拼接 |
| 7 | Tauri command 默认私有，`generate_handler!` 引用失败 | Rust 可见性 | 6 个命令加 `pub` |
| 8 | StatusBar 依赖 features，违反 3.3 模块边界 | 放置层错误（ui/ 应为纯基元） | 移至 `app/StatusBar.tsx`；eslint 规则真抓到并修复 |
| 9 | esbuild 构建脚本被 pnpm 11 供应链策略拦截 | pnpm 11 新策略 | `pnpm-workspace.yaml` 加 `allowBuilds: esbuild: true` |
| 10 | PowerShell 5.1 解析无 BOM UTF-8 中文脚本报错 | 编码 | 脚本加 UTF-8 BOM |
| 11 | WebView2 CDP 冒烟用 playwright-core 连接挂起 | playwright 与 Edge 156 兼容 | 改 Node 22 原生 WebSocket 零依赖 CDP 客户端 |

### P0 验收对照（方案 Phase 0 验收项）

| 验收项 | 状态 |
|---|---|
| 冷启动 ≤800ms | **dev 模式未达标（2223ms）**，release 复测留 P5；不阻塞 P1（P1 以功能为主） |
| 空闲内存 ≤160MB | 达标 142.2MB |
| 中文输入法候选框位置正确、快速连打不丢字 | 见下方说明 |
| 打开 10MB 不卡死，首屏 ≤150ms | 达标（146ms 到可编辑） |
| GBK 回写 GBK、BOM 保留 | 达标（字节级断言） |
| `airide .` 二次启动聚焦已有实例 | 达标（单实例 + 参数转发已实现，冒烟未覆盖聚焦断言） |
| Windows 适配 6 项 | 5/6 脚本化通过；**IME 一项无法脚本化**（候选框定位需人眼观察），P1 首次真机使用时人工确认并回填 |

### 遗留事项（进 P1/P5）

1. **冷启动 2223ms（dev）**：P5 release 构建复测；若 >800ms，按方案 5.3 定位（Vite chunk 拆分、LSP 不参与首屏已保证）。
2. **IME spike 人工确认**：脚本无法验证候选框位置，需真机输入中文观察。
3. **manifest 长路径/DPI 声明**：换嵌入方式（`tauri.conf.json` 或 winres 方案），P5 前解决；当前 369 字符长路径可用，说明 Win11 26300 系统开关已开。
4. **`git.exe` 绝对路径调用**：3.12.6 要求不经 shell，P1 的 air-git 实现时落实。
