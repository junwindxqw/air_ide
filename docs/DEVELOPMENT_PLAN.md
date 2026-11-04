# Air IDE — 产品需求分析与开发计划

> 版本：v1.7（2026-11-05）
> 定位：给「AI 写代码、人来审阅」的工作流做一款 JetBrains 手感、VS Code 一半体量的桌面 IDE
> 平台：**只做 Windows**——Windows 10 2004+（build 19041）与 Windows 11，仅 x64
> 用法：个人自用工具——AI 在外部写代码，本工具负责读、审 diff、提交推送

| 版本 | 日期 | 变更摘要 |
|---|---|---|
| v1.0 | 2026-11-04 | 初稿 |
| v1.1 | 2026-11-04 | 复核修订：① 补齐双栏 diff、冲突解决与多语言接入等漏项；② 新增 3.11 外部修改三态、3.6.1 模板混合语法；③ 修正 hunk patch 的行尾结论（以 index 形式为准，非一律 CRLF），补 `git add -N` 与 discard 路径；④ LSP 内置下载升级为 P4 必做；⑤ 新增 Git 命令条、单实例锁、设置导入导出；⑥ 指标改可测量口径（内存 160MB、安装包 10MB、崩溃按次计）；⑦ 版本基线更新（Vite 8 / React 19.3 / Rust 1.90）；⑧ 补 E2E 门禁与环境前置；⑨ 里程碑按"能替代什么"重排，最小 diff 提前，并加"只读场景强制切换"策略 |
| v1.2 | 2026-11-04 | **平台收窄为仅 Windows 10 2004+ / 11，x64**：① 新增 2.12「Windows-only 的红利与代价」与 3.12「Windows 平台适配」，覆盖长路径 260、Per-Monitor DPI、DWM 暗色标题栏、文件监听缓冲溢出、Defender 扫描、Git 运行时探测；② 2.2 的"跨平台"对比行改写为单运行时优势；③ 平台基线写进 0.1/1.2/附录 D；④ 新增 Windows 集成（文件夹右键、文件关联、跳转列表、Defender 提示）与 Win10/Win11 双系统回归；⑤ 新增 Windows 平台适配与系统集成；⑥ 新增三条 Windows 专属风险 |
| v1.3 | 2026-11-04 | **可移植性彻底退出选型**（未来 mac 版将换栈，本项目零预留）：① 2.2.1 把原生 C#/WinUI/Avalonia/GPUI/纯 Win32/Electron/裸 wry 七个候选重新淘汰一遍，结论仍是 Tauri 但理由改为"轻量与不自研编辑器 UI"，与平台无关；② 2.1 原则 5 与 0.2 明确"可移植性权重 0"；③ 新增 3.13「应当用足的 Windows 原生能力」：Job Object 连带终止子进程、任务栏进度条、Toast、`FILE_SHARE_*` 打开语义；④ 新增孤儿子进程风险；⑤ 纪律收紧：不写平台判断分支、该调 `windows` crate 就直接调 |
| v1.4 | 2026-11-04 | **全部决策落地，第 7 章改为决策记录**：① D1–D16 全部已定（终端仅命令条、无 minimap/sticky、无分屏、双主题、不买签名证书、做 AI 上下文导出、更新托管 GitHub Releases、出便携版 zip、不抢默认关联）；② 纠正签名认知——EV 自 2024 起不再有即时 SmartScreen 信任，Azure Artifact Signing 对中国区不可用；③ P3 增 AI 上下文导出，P5 增便携版与未签名分发策略 |
| v1.5 | 2026-11-04 | **定位收敛为「做什么、按什么顺序做、怎么算做完」**：① 0.5 改为「阶段划分与交付顺序」，只保留依赖关系与每阶段可替代的能力；② 阶段标题与任务表去掉工作量估算，4.1 里程碑改为阶段达标制；③ 附录 C 改为按步骤排列的执行顺序，只保留可验证结果；④ 风险表去掉与进度相关的条目，触发条件改为范围/质量信号；⑤ 选型论证中的时间成本表述统一改写为工程理由 |
| v1.6 | 2026-11-04 | **一致性修复 + 三节补充**：① 修 2.12「分发链含 Authenticode」与 D6「v1 不签名」的矛盾，改述 Minisign；② 2.11 自动更新托管统一为 GitHub Releases；③ `LanguageId` 由写死枚举改为按注册表取 string，并标注 C/C++ 属「同机制接入、不列入 P4 验收」；④ 1.3 把 Diff 渲染与 hunk 操作拆成两行（P2 / P3）；⑤ 0.4 明确 10MB 是「可编辑上限」，与 3.8 的只读阈值对齐；⑥ P3 补「撤销上一次提交」与提交信息复用；⑦ IPC 补 `fs_stat`/`fs_hash`/`git_discard_file`/`git_undo_commit`/`git_cancel`/`app_recent_projects` 与 `git://output` 事件；⑧ 3.6 写死单根工作区模型（含单文件打开时的 root 推导）；⑨ 3.10 补草稿超限行为与 `schemaVersion` 迁移；⑩ 3.7.3 补长操作取消与陌生仓库 hooks 提示；⑪ 新增 3.14 设置项清单、3.15 错误呈现分级、3.16 交互细节补遗；⑫ 新增 R17（AI 批量写入导致界面抖动）；⑬ 1.5 补「Git 身份未配置」「UNC 路径」两条必踩坑；⑭ 2.9 限定字体只内置两个字重、1.4 平台边界补网络盘与可移动盘 |
| v1.7 | 2026-11-05 | **查缺补漏修订**：① 修 3.12「8 项」与 P0/附录 C「6 项」的口径差——3.12.7/3.12.8 定为实现约定，随双系统回归；② IPC 补 `fs_list_dir`（文件树懒加载，与全量 `fs_list_tree` 解耦）、`search_cancel`、`fs://rescan`、`search://done`，`fs_create` 支持目录，`git_stage_hunks` 写死 mode 枚举；③ 3.11 补保存前 mtime/hash 复检（防「我的保存覆盖外部改动」的反向场景）并澄清三选一横幅的反悔语义；④ 3.8 大文件策略补 >50MB 不加载（对齐 160MB 内存预算）；⑤ 3.7.2 补未跟踪文件 discard＝整文件删除、需二次确认；3.7.3 补切分支脏文件行为；3.6 补工作区根与 Git 仓库根解耦、非 Git 仓库空态；⑥ 3.14 补「保存策略」「Diff 默认视图」，7.1 新增 D17；3.16 补外部拖拽打开；⑦ 修订记录按版本升序重排 |

---

## 0. 结论摘要

### 0.1 一句话定义

**Air IDE 是一款只做四件事的桌面 IDE：读代码、改代码、看 Git Diff、跑 Git 操作。** 界面、快捷键、Diff 交互按 IntelliJ 平台（New UI）还原，其余 JetBrains 功能一律不做。

**平台基线（v1 硬边界）**：Windows 10 2004+（build 19041）与 Windows 11，**仅 x64**。不提供 macOS / Linux / ARM64 版本，也不为它们保留兼容分支——Windows 专属的取舍见 2.12，必须防的坑见 3.12。

### 0.2 技术栈结论

| 层 | 选型 | 版本基线 | 一句话理由 |
|---|---|---|---|
| 目标平台 | Windows 10 2004+ / Windows 11 | **仅 x64** | 单一运行时（WebView2）+ 单一构建目标，测试矩阵与兼容分支都砍掉一半 |
| 桌面壳 | Tauri | **2.12.x（锁 2.x，不碰 3.0-alpha）** | 系统 WebView + Rust 后端，安装包 ≤10MB、空闲内存 ~120MB，是"轻量"唯一可行解 |
| 前端框架 | React + TypeScript | React 19.3 / TS 5.x（脚手架 latest） | 复杂 IDE UI 的组件复用、虚拟滚动、状态调试生态最厚；LLM 生成质量最稳 |
| 构建 | Vite + pnpm workspace | Vite 8.x（2026-10 为 8.3） | 冷启动构建快，Tauri 官方一等支持；Vite 8 要求 Node ≥ 22.12 |
| 编辑器内核 | CodeMirror 6 | @codemirror/* 6.x | 核心 ~180KB、外观可像素级定制、官方 LSP 客户端已成熟 |
| 语法解析 | Lezer（CM6 官方语言包） | lang-php / go / python / rust / javascript | 增量解析，用于高亮、折叠、缩进，不依赖语言服务器 |
| 语言智能 | LSP（客户端在 TS，宿主在 Rust） | @codemirror/lsp-client 6.2 | 复用社区语言服务器，不自己写语言引擎 |
| Git | **git CLI 优先**（不引 libgit2） | Git ≥ 2.30 | hooks / GPG / credential helper / CRLF 过滤器这些坑只有 CLI 全对 |
| 搜索 | `ignore` + `grep` crates（ripgrep 同源） | — | 无需外部 rg 依赖，语义与 ripgrep 一致 |
| 状态 | Zustand（按领域分 store） | v5 | 极轻、无 Provider 地狱、适合高频局部更新 |
| UI 基元 | Radix UI primitives + CSS 变量 | — | 无样式、可访问性好，样式全部由设计 token 控制 |
| 虚拟滚动 | @tanstack/react-virtual | v3 | 文件树 / Diff / 搜索结果共用 |
| 面板布局 | react-resizable-panels + 自研工具窗语义 | v3 | 分割拖拽用现成，Alt+1/Alt+9 工具窗切换自己加 |
| 图标 | material-icon-theme（MIT）+ 自绘 UI 图标 | — | JetBrains 图标有版权，用同语义替代 |
| 打包 | Tauri bundler（NSIS，按用户安装） | — | 免管理员、可增量更新 |

> **选型权重说明**：可移植性 = 0。未来若做 macOS 版直接换技术栈，本项目不留任何跨平台预留（理由与候选淘汰过程见 2.2.1）。

### 0.3 与既有 Fly IDE 的关系（重写动因）

`D:/myProject/fly_ide` 已实现 Phase 0-2（Rust 7776 行 + 前端 4872 行，含 Git 全流程、LSP 宿主、命令系统、会话恢复、NSIS 安装包）。本项目**全新重写**，但明确继承它的三条已验证结论，不重复试错：

| 继承（结论已被验证，直接采用） | 修正（上一版的结构性问题） |
|---|---|
| Tauri + Rust 分层，领域逻辑放 crates | 前端改用 React，避免 Svelte 5 下 UI 逻辑退化成 1150 行的单一组件 |
| Git 走 CLI 而非 libgit2 | Diff 不再依赖 `@codemirror/merge` 的数据模型（见 3.7.2） |
| LSP 客户端在 TS、进程宿主在 Rust | LSP 改为按语言建 client 池，解决"一实例只能连一个 server"的硬约束 |
| 性能预算可测量（埋点 + 基准脚本） | 命令系统与 UI 解耦，禁止命令闭包直接持有 App 级 state |
| WebView2 + CM6 的中文 IME 路径可跑通 | — |

**不继承的资产**：Svelte 组件、App.svelte 内的状态与命令组织方式。

**"全新重写"的准确边界**（避免含糊导致反复讨论）：

| 层 | 处理方式 |
|---|---|
| 前端 UI / 状态 / 命令系统 / 编辑器封装 | **完全重写**，不参考其组件结构 |
| Rust 领域层（`air-fs` / `air-git` / `air-search` / `air-lsp`） | **按新接口重写**，但允许移植 fly_ide 中已验证的 porcelain/diff 解析器与 fixture 测试（作为参考实现，不引依赖、不复制模块结构） |
| 打包与基准脚本 | 参考其 NSIS 配置与 bench 脚本思路，重写 |

理由：解析器与分帧这类代码的正确性靠测试保证，与前端框架无关；而 UI 组织方式正是上一版的问题所在。不重写 UI、重写协议层，是既不重复踩坑、又不把精力耗在 UI 组织上的唯一合理切法。

### 0.4 量化目标（Phase 0 实测后校准，作为每阶段验收门禁）

| 指标 | 目标 | 说明 |
|---|---|---|
| 冷启动到可交互 | ≤ 800ms | 开发机 SSD，无 LSP |
| 热启动 | ≤ 400ms | |
| 空闲内存 | ≤ 160MB | **含 WebView2 子进程，不含语言服务器**；上一版实测 138MB |
| 打开 1MB 文件 | ≤ 40ms | 到可编辑 |
| 打开 10MB 文件 | ≤ 150ms 首屏可见 / ≤ 600ms 可编辑 | 10MB 是"可编辑"上限（见 3.8）；编码探测要扫全文件，一步到位不现实 |
| 按键响应 | p95 ≤ 16ms | 不含输入法组合输入 |
| 10k 文件 git status（热刷新） | ≤ 250ms | 冷启动与杀毒软件扫描不计入 |
| diff 渲染 2000 行 | ≤ 120ms，滚动 60fps | |
| 编辑器 tab 切换 | ≤ 30ms | 复用已有 CM6 实例 |
| 安装包 | ≤ 10MB | NSIS 含 WebView2 bootstrapper；上一版实测 2.7MB |
| 稳定性 | 8 小时使用未捕获异常 0 起 | 用固定操作脚本跑，不靠人肉挂机 |
| 平台验收 | Win10 2004 与 Win11 各一台物理机 | 5.2 清单两套系统各跑一遍，差异记入 3.12 |

### 0.5 阶段划分与交付顺序

阶段划分的唯一依据是**依赖关系与可替代性**：每一阶段结束时，产品必须能替代一类具体工作；做不到就不进入下一阶段。阶段不带日期——节奏由实际进展决定，而不是让计划反过来催进度。

| 阶段 | 内容 | 结束时能替代什么 |
|---|---|---|
| P0 | 骨架与走通链路（含 Windows 原生适配 spike） | 单文件可读写；性能与平台坑有实测数据 |
| P1 | 阅读编辑 + 最小 diff | 「翻代码」与「`git diff` 命令」 |
| P2 | Diff 完整化 | 「看改动的全部需求」 |
| P3 | Git 写入与远端 + AI 导出 | 「PhpStorm 的 Git 面板」 |
| P4 | 语言智能 | 「补全与跳转」 |
| P5 | 稳定、性能与发布（含 Windows 集成） | 「可安装可升级」 |

**顺序不可调换的三处**：

1. **P0 必须最先**：性能基准、中文 IME、Windows 六个平台坑的结论，会直接决定 P1 的布局与文件树设计。这些结论晚拿到，返工面就是整个 UI 层。
2. **P1 的最小 diff 必须在 P2 完整化之前**：先用最简单的方式证明「git diff 解析 → 行级渲染 → 与命令行输出一致」，再去做双栏、词级、折叠。反过来做，出了问题分不清是数据链路错还是渲染错。
3. **P5 必须最后**：安装包体积、启动耗时、内存基线只有功能齐全后才可信；提前优化等于对着半成品调参。

**范围冻结原则**：P0 开始后，新增需求只能进待办池，不得插队。这是范围不失控的唯一纪律。

---

## 1. 需求分析

### 1.1 真实工作流还原

不是"IDE 有哪些功能"，而是"junwind 一天在这款软件里做哪些动作"。按频次排序：

| 频次 | 动作 | 对应能力 | 优先级 |
|---|---|---|---|
| 极高 | 打开项目 → 翻文件 → 读代码 | 文件树、tab、快速打开、跳转定义、面包屑 | P1 |
| 极高 | 看某个文件改了什么 | Git 状态树 → 双击开 Diff | P1（最小）/ P2（完整） |
| 极高 | 逐块审阅 AI 生成的改动 | hunk 导航（F7）、已读标记、行内词级高亮 | P2 |
| 极高 | 外部工具改完文件后立刻看到 | 文件监听 + 外部修改三态（3.11） | P1 |
| 高 | 小改几行 → 提交推送 | 编辑、保存、stage 勾选、commit、push | P1 / P3 |
| 高 | 全局搜一个符号/字符串 | 全局搜索（正则/大小写/范围）、结果跳转 | P1 |
| 中 | 补全、参数提示、看类型 | LSP completion / signature / hover | P4 |
| 中 | 跳转定义 / 找引用 | LSP definition / references | P4 |
| 中 | 切换分支、拉取、处理冲突 | 分支菜单、pull（rebase/merge）、冲突三栏 | P3 |
| 中 | 撤销刚才那一块改动 | `discard hunk` / `Ctrl+Alt+Z` | P3 |
| 低 | 重命名符号 / 格式化 | LSP rename / formatting | P4 |
| 低 | 看某行历史 / blame | `git log -L` / blame | P2 |

**关键洞察**：前 6 行占了约 90% 的使用时间，且全部集中在"读 + 看改动"。因此**最小 diff 提前到 P1、Diff 完整化放在 P2、语言智能推到 P4**——把一个"用不上补全也能干活"的版本先交出来，比"补全很全但 diff 难用"有价值得多。

### 1.2 功能边界

#### 做（v1 范围）

- 打开文件夹 / 单文件；最近项目
- 文件树（新建/重命名/删除/在资源管理器打开/复制路径）
- 多 tab 编辑、会话恢复
- 编辑器：语法高亮、折叠、缩进参考线、括号匹配、多光标、查找替换、行号、当前行高亮、选中词高亮、面包屑
- 编码、行尾与 BOM（UTF-8/GBK 识别、CRLF/LF 显示与切换、BOM 保留）—— PHP 项目高频痛点
- 快速打开（Ctrl+Shift+N）、最近文件（Ctrl+E）、全局搜索（Ctrl+Shift+F）
- 文件监听与外部修改三态处理（干净重载 / 脏文件横幅三选一 / diff 自动重算）
- Git：status 分组、Diff（单栏/双栏）、hunk 级 stage/unstage/discard、commit（amend/sign-off）、分支切换与新建、fetch/pull/push、log、blame、文件历史、冲突解决、已读标记
- Git 命令条（跑任意 git 命令并看输出，覆盖 rebase 中断等 UI 未覆盖场景）
- LSP：补全、hover、签名、诊断、定义、引用、符号大纲、重命名、格式化；语言服务器管理面板与内置下载
- 模板文件着色：`.html`（ThinkPHP）与 `.blade.php` 的标签高亮（不做补全）
- AI 上下文导出：当前文件 / 选区 / diff 一键复制为带路径与行号的结构化 markdown（D7）
- 命令面板（Ctrl+Shift+A）、设置页（含导入导出）、键位映射（JetBrains 默认）
- 单实例锁、会话恢复、未保存草稿恢复
- 状态栏：分支、编码、行尾、语言、LSP 状态、光标位置
- Windows 集成：文件夹右键「用 Air IDE 打开」、文件关联（.php 等双击打开）、任务栏跳转列表（最近项目）、首次打开大项目时提示 Defender 排除项

#### 明确不做（写进 README，防止范围蔓延）

| 不做 | 原因 |
|---|---|
| 运行 / 调试器 / 测试运行器 | 用户用命令行或外部工具 |
| 构建系统集成（Maven/Gradle/npm scripts） | 同上，且各生态差异巨大 |
| 数据库工具、HTTP Client、Docker、K8s | JetBrains 的"全家桶税"，明确不要 |
| AI 代码补全 / 对话 | 用户已在用外部 AI 工具写代码；IDE 只负责审阅 |
| 插件系统 / 扩展市场 | v1 最大复杂度来源，v2 再议 |
| 远程开发 / WSL / SSH | 同上 |
| SVN / Mercurial | 只用 Git |
| 重构全家桶（extract/inline/move） | 只保留 rename |
| 覆盖率 / Profiler / UML | 不要 |
| 多窗口 / 编辑器分屏 | v1 单窗口单编辑区；分屏放 v1.1 可选 |
| 集成终端 | v1 不做；改为「Git 命令条」（只跑 git 命令，流式输出），足够自救 |
| 主题商店 / 自定义主题编辑器 | 内置 Darcula Dark + Light 两套，token 可改 |
| macOS / Linux 版本 | 不做，且**零预留**：将来真做 mac 版会换技术栈另起项目，不在本项目里加抽象层（见 2.2.1） |
| ARM64 版本 | 单一 x64 构建目标；ARM64 属 v1.1 再评估（需真机回归） |
| MSIX / 商店分发 | 只用 NSIS 按用户安装，见 2.11 |

### 1.3 优先级矩阵

| 能力 | 价值 | 成本 | 结论 |
|---|---|---|---|
| Diff 渲染（单栏/双栏、词级、折叠） | 极高 | 高 | P2 重点投入，做深 |
| hunk 级 stage / discard | 极高 | 高（数据风险） | P3：先做回归矩阵，再放 UI 按钮 |
| Git 状态树 + 提交 | 极高 | 中 | P2-P3 |
| 文件树 + 编辑器基础 | 极高 | 中 | P1 |
| 全局搜索 | 高 | 低 | P1 |
| 会话恢复 | 高 | 低 | P1 |
| LSP 补全/跳转 | 中 | 高（生态摩擦） | P4，先 PHP 后其他 |
| 冲突解决三栏 | 中 | 高 | P3 后段 |
| blame / 文件历史 | 低 | 低 | P2 尾 |
| minimap / sticky scroll | 低 | 中 | v1.1 可选，可砍 |

### 1.4 非功能需求的可测量定义

"轻量、稳定、性能高"必须翻译成数字，否则无法验收。

- **轻量**：安装包 ≤10MB；空闲内存 ≤160MB（含 WebView2 子进程）；不常驻后台进程；不装系统服务；不开机自启。
- **平台**：只在 Win10 2004+ / Win11 x64 上验收；不承诺在 Server、Windows PE、精简版系统上运行。网络盘（UNC）与可移动盘只保证"可用不崩溃"，不承诺 status 与搜索性能。
- **稳定**：语言服务器崩溃不影响编辑器；Git 操作失败有明确错误与恢复路径；未保存内容断电/崩溃后可恢复；不因单个大文件卡死 UI。
- **性能**：所有 UI 操作在 100ms 内有反馈（超过则显示进度）；编辑输入 p95 ≤16ms；任何同步 IO 不得在主线程。

### 1.5 用户没明说、但一定会踩到的需求

这些是"不做就退货"的隐性需求，必须写进 P0/P1：

1. **编码检测**：老 PHP 项目大量 GBK/GB18030 文件，打开乱码直接废。需 chardet 式检测 + 手动切换 + 保存时保持原编码。
2. **行尾显示**：CRLF 与 LF 混用的仓库，Diff 会整文件变红。状态栏必须能看见并能一键转换。
3. **大文件保护**：日志文件、SQL dump 一旦被点开，没有保护就是卡死。
4. **中文输入法**：WebView2 + CM6 下候选框定位与组合输入必须在 P0 spike 验证。
5. **语言服务器缺失**：用户机器不一定装 gopls/rust-analyzer。没有降级路径 = 打开即报错。
6. **未保存草稿**：AI 改一半的代码，重启丢一次就再也不用了。
7. **路径含中文/空格**：Windows 常见，所有 Rust 侧路径处理必须 `PathBuf`，禁止字符串拼接。
8. **Git 中文文件名**：`core.quotepath` 默认会转义成 `\344\270\255`，必须用 `-z` 解析或设 `-c core.quotepath=false`。
9. **文件被外部改动**：产品定位就是"AI 在外部写代码、人在这里审阅"。外部工具改完文件，IDE 必须立刻反映；若该 tab 还有未保存改动，必须提供取舍而不是静默覆盖。见 3.11。
10. **模板文件内嵌 PHP**：ThinkPHP/FastAdmin 的 `.html` 模板夹着 `{$var}`、`{if}`、`{volist}`，任何 PHP 语言服务器都不解析它。不专门处理，用户最高频的文件就是"记事本"。见 3.6.1。
11. **BOM**：带 UTF-8 BOM 的 PHP 文件会导致 `headers already sent`，保存时必须保留/去掉原状态，不能自作主张。
12. **Windows 长路径与杀软**：`vendor`/`node_modules` 深层目录超 260 字符是常态，`MAX_PATH` 一崩就是"文件明明在却打不开"；Defender 实时扫描会让大仓库首次 status 慢 2-3 倍，用户会直接判定"这 IDE 很卡"。两者都要在 P0 处理，见 3.12.1 与 3.12.5。
13. **Git 身份未配置**：新机器上 `user.name` / `user.email` 缺失时 commit 直接失败（"Please tell me who you are"）。提交前预检并给一次性设置入口，比让用户读英文报错强。
14. **网络盘 / UNC 路径**：`\\server\share` 下的文件监听与 status 都慢且不稳。不承诺性能，但必须"不崩溃、有明确提示"；检测到 UNC 路径时自动放宽节流并关闭实时 status 轮询。

---

## 2. 技术选型

### 2.1 选型原则

按权重排序，冲突时前者胜：

1. **启动与内存**（产品立身之本）
2. **Diff 与编辑体验的可控性**（核心场景）
3. **长期可维护**（禁止引入需要长期跟进的重量级抽象）
4. **生态成熟度**（出问题能搜到答案）
5. **Windows 原生贴合**（可移植性权重为 0：该调 Win32/DWM/WebView2 的地方直接调，不为"将来可能跨平台"写任何抽象层或条件编译）

### 2.2 桌面壳：Tauri 2.12 vs Electron vs 纯原生

| 维度 | Tauri 2.12 | Electron 3x | 纯 Rust（GPUI / iced） |
|---|---|---|---|
| 安装包 | ~8MB（本项目目标 ≤10MB） | 90-200MB | 8-20MB |
| 空闲内存 | 80-150MB（本项目定 ≤160，含 WebView 子进程） | 200-400MB | 40-100MB |
| 冷启动 | 300-800ms | 1.2-3s | <300ms |
| 编辑器内核 | 复用 CM6（Web 技术） | 复用 Monaco | **必须自研文本栈**（字形、IME、选区、滚动、无障碍） |
| 中文 IME | WebView2 原生支持，需实测 | Chromium 成熟 | 需自行对接 IMM32/TSF，高风险 |
| 内核一致性 | **只有 WebView2 一套**（本项目只做 Windows，跨平台差异为零） | 全平台同一 Chromium | 一致 |
| 自研投入 | 低（复用 CM6） | 低（复用 Monaco） | **极高**（编辑器内核等于重做一整套文本栈） |

**结论：Tauri 2.12**。理由：轻量是硬需求，Web 技术栈能让"编辑器"这块直接用成熟方案，把有限精力投在 Git Diff 和 JetBrains 手感上。纯原生唯一优势是内存，但要自研编辑器内核，与"把精力放在 Git Diff 与 JetBrains 手感上"直接冲突。

**只做 Windows 让这条选型更划算**：Tauri 的跨平台短板（Linux 上 WebKitGTK 渲染差异、macOS 上 WKWebView 的 IME 与字体差异）在本项目里全部不存在，只剩一套 WebView2；而它的短板（WebView 由系统提供、无法控制版本）反而是本项目最愿意接受的一项——因为可以用 bootstrapper 兜底，且验证成本只需一套环境。

**锁定 2.x**：Tauri 3.0 处于 alpha（2026-09 起），API 未稳定，不追。

**接受的风险**：
- WebView2 版本差异 → 安装包内置 bootstrapper + 启动时检测版本，缺失则引导安装；最低要求 Win10 2004（build 19041），低于此版本直接拒绝启动并给出说明。
- IPC 序列化开销 → 大payload 走二进制（`tauri::ipc::Response`）或分页，不做整目录一次性返回。
- 不追求"支持所有 Windows" → 只保 Win10 2004+ 与 Win11；21H2 以下的 Win10 不做兼容测试，出问题只记录不修。

#### 2.2.1 其余候选栈的淘汰记录（放弃可移植性后重新评估）

前提变了：**可移植性不计入任何权重**——将来若做 macOS 版会直接换技术栈（Swift/AppKit 或另起项目），本项目不做任何预留。于是"原生 Windows 方案"必须被当成一等候选重新过一遍，而不是用"以后还要跨平台"一句话带过。

| 候选 | 形态 | 优势 | 淘汰理由 |
|---|---|---|---|
| .NET 9 + WPF + AvalonEdit | 全原生 C# | 启动快、系统集成最顺、文本内核成熟 | AvalonEdit 只给"文本框"；文件树、工具窗、分割、Diff、补全弹层、面包屑全部要自绘。WPF 不支持 AOT，冷启动 1-2s |
| .NET 9 + WinUI 3 + AvalonEdit | 全原生 C# | Fluent 控件、DPI 与标题栏系统托管 | 控件体系与 JetBrains 视觉差得更远，且 WinUI 3 的窗口/托盘/单实例仍需自行封装 |
| Avalonia + AvalonEdit | 跨平台 .NET | 可 AOT、XAML 可塑 | 同第一条的 UI 面积问题；控件生态比 Web 薄一个量级 |
| WinUI 3 + WebView2 混合 | 原生壳 + Web 编辑器 | 窗口/DPI 由系统托管 | 等于自己重做 Tauri 的 bundler、updater、IPC、menu、capabilities；收益只有几十行 DWM 代码 |
| Rust + GPUI（Zed 内核） | 全原生 Rust | 性能天花板最高，Zed 已自证 | GPUI 的 Windows 后端仍不成熟，等于替上游做移植；一出问题整条链路停摆 |
| Rust + 纯 Win32 / Direct2D | 全原生 | 极致轻量 | 自研编辑器内核（字形、IME、选区、滚动、无障碍）是 1-2 年工程 |
| Electron + React + CM6 | 打包 Chromium | 渲染行为完全确定、无需 WebView2 兜底 | 安装包 90MB+、内存 200-400MB，直接违背"轻量"这条第一硬需求 |
| 直用 `wry` + `tao`（不用 Tauri） | WebView2 + Rust | 少一层框架、少一个版本债 | 要自己补菜单/托盘/更新/打包/权限，换来"少一个依赖"，代价是重做整套基础设施，不划算 |

**结论不变，但理由更硬了**：Tauri 不是"为了跨平台才选它"，而是它在"轻量"和"不必自研编辑器 UI"这两条上同时成立——这两条与平台无关。只做 Windows 只是顺手去掉了它最后一点不确定性（多 WebView 运行时）。

**因此 v1.3 的纪律（比 v1.2 更严）**：
- 不写任何平台抽象层、不写 `if (cfg!(target_os))` 分支、不引跨平台 UI 工具包。
- Rust 层之所以"不写死 Win32"，理由仅是**省事**（能复用现成 crate），不是留后路；该调 `windows` crate 的地方直接调。
- 若将来真做 macOS 版：fork 出 `air_ide_mac` 另选栈，不回头改本项目架构。

### 2.3 前端：React 19.3 + TS 5.x + Vite 8

**为什么不是 Svelte 5**（上一版的实际教训）：

| 维度 | React 19 | Svelte 5 |
|---|---|---|
| IDE 类复杂 UI 的组件生态 | 极厚（树、虚拟列表、分割面板、可访问性基元） | 薄，多数要自己写 |
| 大型多模块状态管理 | Zustand/Jotai 成熟，devtools 完善 | runes 在超大组件里易失控 |
| AI 生成代码的稳定性 | 训练语料最多，生成质量最稳 | 易生成 Svelte 4 语法或混用 runes |
| 性能 | 虚拟化 + memo 足够；IDE 瓶颈在 DOM 数量不在框架 | 理论上更省，实际差异 <5% |
| 重构友好度 | 高（类型 + 显式 props） | 中 |

结论：IDE 的性能瓶颈是"渲染了多少 DOM 节点"，不是"框架的 diff 开销"。用虚拟滚动解决 DOM 数量后，React 完全够用，而工程可维护性收益远大于 5% 的运行时差异。

**约束**（写进 ESLint 规则）：
- `App.tsx` ≤ 150 行，只做装配。
- 任何单文件 ≤ 500 行，超出必须拆分。
- feature 之间只能通过 `feature/index.ts` 暴露的 API 通信，禁止深引用。

### 2.4 编辑器内核：CodeMirror 6 vs Monaco

这是全项目最关键的选型，逐项对比：

| 维度 | CodeMirror 6 | Monaco |
|---|---|---|
| 核心体积（gzip） | ~180KB | ~2.5-3.5MB |
| 装配成本 | 装扩展即可 | 需配 worker、loader，Vite 下要处理 ESM 与 `?worker` |
| 外观可塑性 | 极高：可自定义行高、行内装饰、gutter、光标、选区、滚动条 | 中：主题能改色，但布局/装饰体系是 VSCode 形状 |
| 贴近 JetBrains 的难度 | 中（要自己实现面包屑等） | 高（要对抗 VSCode 的默认视觉与交互） |
| 内置能力 | 折叠、多光标、查找替换、括号匹配、自动补全框架、lint | 同上 + minimap、breadcrumbs、sticky scroll、code lens、column selection |
| LSP | 官方 `@codemirror/lsp-client` 6.2（作者本人维护） | `monaco-languageclient`，需拖入一批 `vscode-*` 包 |
| Diff | `@codemirror/merge`（适合"编辑时与原文件合并"） | 内置 DiffEditor（最成熟，但数据模型是 Monaco 的 Model） |
| 大文件（10MB+） | 优秀（视口渲染） | 良好 |
| 中文 IME | 良好（CM6 对 composition 有专门处理） | 良好 |
| 升级风险 | 低（模块化，按需升） | 中（与 VSCode 版本节奏绑定） |

**结论：CodeMirror 6。**

三条决定性理由：

1. **"轻量"是用户第一条硬需求**。Monaco 光语言 worker + 编辑器核心就是 CM6 的 15 倍以上，启动时还要装配 worker，与"冷启动 ≤800ms、空闲 ≤160MB"直接冲突。
2. **目标是"像 JetBrains"而不是"像 VS Code"**。Monaco 的视觉与交互 DNA 就是 VSCode：行高、选区、滚动条、命令面板、面包屑样式都是。要做成 IntelliJ 手感，用 Monaco 等于持续对抗它的默认值；CM6 是一张白纸，反而更快。
3. **LSP 有官方客户端**。`@codemirror/lsp-client` 由 CM6 作者维护，已覆盖补全/hover/签名/诊断/定义/引用/重命名/格式化/增量同步，省掉自研协议层（这是最容易做错的部分）。

**必须自研/补装的清单（成本要算进去，不能假装不存在）**：

| 能力 | 方案 | 优先级 |
|---|---|---|
| 面包屑 | 用 LSP `documentSymbol` + Lezer 语法树拼路径 | P1 |
| 缩进参考线 | 自写 CM6 ViewPlugin + decoration（约 80 行） | P1 |
| 当前行/选中词高亮 | 内置 `highlightActiveLine` / `highlightSelectionMatches` | P1 |
| minimap | 自绘 canvas（约 200 行），或直接砍掉 | v1.1 可选 |
| sticky scroll | 顶部浮层 + decoration 计算 | v1.1 可选 |
| 矩形选择 | CM6 无内置，需自写 | v1.1 可选 |
| 代码折叠 | 内置 `foldGutter` + LSP `foldingRange` 混合 | P1 |

**不建议**用 Monaco 来"补" diff：混用两套编辑器内核会让主题、快捷键、选区行为分裂，维护成本远高于收益。

### 2.5 语言智能架构

```
┌──────────────┐   LSP message (JSON string)
│ CM6 Editor   │◄──────────────────────────┐
│ (文档权威)    │                           │
└──────┬───────┘                           │
       │ @codemirror/lsp-client 6.2        │
       ▼                                   │
┌──────────────┐   Transport.send(str)     │
│ LSPClient    │──────────────────────────►│
│ (每个语言一个)│◄──────────────────────────┤
└──────────────┘   subscribe(handler)      │
                                           │
┌──────────────────────────────────────────┴─────┐
│  Tauri IPC（invoke: lsp_send / event: lsp://msg）│
└──────────────────────┬─────────────────────────┘
                       ▼
┌────────────────────────────────────────────────┐
│ Rust: air-lsp                                   │
│  spawn / Content-Length 分帧 / 双向转发          │
│  stderr 落日志 / 崩溃重启（退避）/ idle 回收      │
│  不解析 LSP 语义                                 │
└──────────────────────┬─────────────────────────┘
                       ▼
        gopls / PHPantom·phpactor / basedpyright /
        rust-analyzer / tsserver / clangd
```

**关键约束（实测确认）**：`@codemirror/lsp-client` 一个 `LSPClient` 实例**只能连接一个语言服务器**。因此必须做 **LanguageServerPool**：

```ts
// 伪代码：按语言建 client，一个 client 可服务该语言的多个文件与多个 EditorView
type LanguageId = string   // 'php' | 'go' | ... 以 server 注册表为准：新增语言只加配置，不改类型

class LanguageServerPool {
  private clients = new Map<LanguageId, LSPClient>()
  async clientFor(lang: LanguageId): Promise<LSPClient | null>  // 懒启动 + 缓存
  dispose()                                                     // 切项目/退出时统一关闭
}
```

- 编辑器挂载时按文件语言取对应 client，`client.plugin(fileUri)` 挂到 EditorView。
- 同一 client 管理该语言的所有打开文档（`didOpen/didChange/didClose` 由客户端库处理）。
- 未打开文件（跳转目标）由自定义 `Workspace` 实现按需读取：`readFile(uri)` → invoke `fs_read_file`。
- 诊断统一汇总到 Problems 面板；单语言 server 崩溃只影响该语言，状态栏显示"PHP 智能已停止，点击重启"。
- **启动时机**：server 在该语言首次打开文件后 idle 500ms 才拉起，不参与首屏；0.4 的冷启动指标不含 LSP。

**为什么 LSP 宿主放 Rust 而不是 Node**：不引入 Node 运行时（体积 + 内存），且进程生命周期、stderr 日志、崩溃重启、idle 回收在 Rust 侧更可靠。Rust 不解析协议，只做"带帧的管道"，实现量约 300 行，出错面很小。

### 2.6 语言服务器矩阵

| 语言 | 首选 | 备选 | 获取方式 | 备注 |
|---|---|---|---|---|
| **PHP**（主力） | **PHPantom**（Rust，MIT，~2s 就绪，Laravel 友好） | phpactor（成熟但索引慢）/ Intelephense（免费版受限，$25 解锁） | 下载二进制到 `%LOCALAPPDATA%\AirIDE\servers` | 唯一能在"轻量"目标下可接受就绪时间的选项 |
| Go | gopls | — | `go install golang.org/x/tools/gopls@latest` | 官方 |
| Python | basedpyright | pyright / ruff（仅 lint+format） | `npm i -g basedpyright` 或 pip | basedpyright 更快更严 |
| Rust | rust-analyzer | — | `rustup component add rust-analyzer` | 内存 300-800MB，单独计 |
| TS/JS | typescript-language-server | — | `npm i -g typescript-language-server typescript` | 需工作区 tsc 版本匹配 |
| C/C++ | clangd | — | LLVM 安装包 | 同一机制接入，但需 `compile_commands.json` 才准；**不列入 P4 验收**（验收仍为 PHP/Go/Python/Rust/TS 五类） |
| JSON/YAML/CSS/HTML/MD | vscode-langservers-extracted | — | `npm i -g` | 一次性装齐 |

**服务器缺失是产品化的最大摩擦点**，三级策略：

1. **探测**：`PATH` → 项目内 `node_modules/.bin` → 常见安装目录（`%USERPROFILE%\go\bin`、`~/.cargo/bin`、`%APPDATA%\npm`）。
2. **引导**：状态栏显示"PHP 智能未启用"，点击弹出卡片：说明 + 一键复制安装命令 + "我已安装，重新检测"。
3. **内置下载（P4 必做，非可选）**：从官方 Release 拉二进制到 `%LOCALAPPDATA%\AirIDE\servers\{name}\{version}\`，带版本与 sha256 校验。这是产品化关键路径——让用户自己去装 gopls/phpactor 会直接劝退，不能降级为"以后再说"。下载失败时回落手动安装指引。

**服务器管理面板**（P4 一并交付）：列出每种语言的探测结果、路径、版本、内存占用、启动/停止/重启按钮、手工指定路径输入框。

**降级路径**（必须有，否则用户首次打开就是残废）：无 server 时仍有 Lezer 语法高亮、折叠、缩进、括号匹配、大纲（Lezer 树提取），状态栏明确标注"语法模式"。

### 2.7 Git：CLI 优先

| 方案 | 优势 | 致命问题 |
|---|---|---|
| `git2`（libgit2） | 进程内调用，快；结构化 API | hooks、GPG 签名、credential helper、`.gitattributes` filter、submodule、worktree 行为与 CLI 有差异，会直接变成数据风险 |
| `gix`（纯 Rust） | 快、无 C 依赖 | 同上，且边缘场景覆盖仍在追赶 |
| **git CLI** | 行为 100% 与用户命令行一致；hooks/GPG/凭据全免费继承 | 每次 10-50ms 进程开销；需解析文本输出 |

**结论：全部走 CLI**。读操作用机器可读格式避免解析歧义，写操作原样交给 git。

关键命令约定：

```bash
# 状态（-z 避免中文文件名被 quotepath 转义，v2 提供 staged/unstaged 双状态）
git -c core.quotepath=false status --porcelain=v2 -z --branch --untracked-files=all

# 工作区 diff / 暂存区 diff
git -c core.quotepath=false diff --no-color --no-ext-diff -U3 -- <path>
git -c core.quotepath=false diff --cached --no-color --no-ext-diff -U3 -- <path>

# 提交：message 走 stdin，避免 Windows 下引号/中文/换行被 shell 破坏
git commit -F -            # stdin 写入 message
git commit --amend -F -    # + --no-edit 场景单独处理
git commit -S -F -         # 用户开启签名时

# 远端：进度从 stderr 流式读
git fetch --progress --prune
git pull --progress --ff-only|--rebase|--no-rebase
git push --progress
```

工程约束：
- **串行化**：同一仓库的写操作排队（`tokio::sync::Mutex` per repo），避免 `index.lock` 冲突；检测到 lock 文件时提示"另一个 Git 进程正在运行"而非盲目重试。
- **不存凭据**：认证完全交给系统 Git Credential Manager / SSH agent。push 失败时把原始 stderr 展示给用户。
- **不自动 `git add -A`**：stage 必须逐文件/逐 hunk 显式操作，这是审阅型工作流的底线。
- 大仓库（>20k 文件）：`--untracked-files=normal` 降级 + 状态刷新节流（500ms 合并），必要时才考虑把 status 热点换成 `gix`。

### 2.8 搜索与文件遍历

| 需求 | 方案 |
|---|---|
| 文件树遍历（尊重 .gitignore） | `ignore` crate（ripgrep 同源，天然的并行 walker） |
| 全局内容搜索 | `grep-searcher` + `grep-regex` + `grep-matcher`，多线程，流式返回批次结果 |
| 文件名模糊搜索 | `nucleo`（Helix 用的模糊匹配器，性能优于 fuse.js） |
| 符号搜索 | LSP `workspace/symbol`（无 server 时降级为 Lezer 树遍历当前文件） |

**不引入**：不需要数据库索引（v1 不做全项目符号索引）。LSP server 自己会建索引，重复造轮子只会让内存翻倍。

### 2.9 UI 层：还原 JetBrains 的具体手段

**不用组件库**（Ant Design / MUI / shadcn 全套），因为 IDE 的控件密度、尺寸、间距与通用设计系统完全不同，套用后要写大量覆盖样式。只取 Radix 的**无样式行为基元**（Dialog / DropdownMenu / ContextMenu / Tooltip / Tabs），视觉全部自绘。

**三层样式结构**：

```
styles/
├─ tokens.css      # 设计变量：颜色、字号、行高、间距、圆角、动效
├─ base.css        # reset + 全局排版 + 滚动条
└─ *.module.css    # 组件级样式，只引用 var(--...)
```

颜色 token 分两套（`darcula-dark` / `intellij-light`），切换只换 `data-theme` 属性。

参考基线（实施时用 PhpStorm 截图取色器标定，下列为 New UI Dark 近似值）：

| Token | 参考值 | 用途 |
|---|---|---|
| `--bg-editor` | `#1E1F22` | 编辑器背景 |
| `--bg-toolwindow` | `#2B2D30` | 工具窗背景 |
| `--bg-panel` | `#1E1F22` | 面板/列表底色 |
| `--border` | `#393B40` | 分割线/边框 |
| `--bg-hover` | `#393B40` | 悬停 |
| `--bg-selected` | `#2E436E` | 列表选中 |
| `--accent` | `#3574F0` | 主色/按钮 |
| `--fg-primary` | `#DFE1E5` | 正文 |
| `--fg-secondary` | `#7A7E85` | 行号/次要信息 |
| `--diff-add-bg` | `#294436` | 新增行底 |
| `--diff-del-bg` | `#484A4D` | 删除行底 |
| `--diff-mod-bg` | `#385570` | 修改行底 |

语法配色（Darcula 系）：

| Token | 参考值 |
|---|---|
| 关键字 | `#CF8E6D` |
| 字符串 | `#6AAB73` |
| 数字 | `#2ACCB8` |
| 注释 | `#7A7E85` |
| 类/类型 | `#B5B6E3` |
| 方法/函数 | `#56A8F5` |
| 字段/属性 | `#C77DBB` |
| 变量 | `#DFE1E5` |

**尺寸规范**（New UI）：

| 元素 | 值 |
|---|---|
| 编辑器字号 / 行高 | 13px / 1.2（可配） |
| 工具窗默认宽 | 340px（可拖 240-600） |
| 编辑器 tab 高 | 28px |
| 状态栏高 | 24px |
| 工具窗标题栏高 | 28px |
| 列表行高 | 22px |
| 图标 | 16×16 |
| 字体 | JetBrains Mono（OFL，**只内置 Regular + Bold 两个字重，约 600KB**）+ 系统 UI 字体（不内置中文字体，用微软雅黑） |

**布局结构**（单窗口四区，与 IntelliJ 一致）：

```
┌─────────────────────────────────────────────────┐
│ 原生菜单栏（File / Edit / View / Git / Help）      │
├──────────┬──────────────────────────┬───────────┤
│ Project  │  编辑器 tab 栏             │  Git      │
│ (Alt+1)  │  ┌────────────────────┐   │ (Alt+9)   │
│          │  │ breadcrumbs        │   │  Changes  │
│ 文件树    │  ├────────────────────┤   │  Log      │
│          │  │                    │   │           │
│          │  │  CodeMirror        │   │           │
│          │  │                    │   │           │
│          │  └────────────────────┘   │           │
├──────────┴──────────────────────────┴───────────┤
│ 状态栏：分支 | 编码 | 行尾 | 语言 | LSP | 行列      │
└─────────────────────────────────────────────────┘
```

不放底部面板（无终端、无 Problems 常驻）；Problems 与搜索结果为工具窗，`Alt+6` / `Alt+3` 呼出。这样默认界面只有"树 + 编辑器 + Git"，视觉噪音最低。

### 2.10 状态与命令系统

**状态分片**（禁止单一巨型 store）：

| store | 内容 | 更新频率 |
|---|---|---|
| `useWorkspaceStore` | 根目录、项目语言画像、最近文件 | 低 |
| `useEditorStore` | 打开的文件、active tab、脏标记、光标位置 | 中 |
| `useGitStore` | status、分支、ahead/behind、进行中的操作 | 中 |
| `useUiStore` | 工具窗可见性、面板尺寸、对话框 | 低 |
| `useSettingsStore` | 主题、字号、键位预设、LSP 配置 | 极低 |

高频数据（编辑器文本、git diff 大文本）**不进 store**，由组件本地持有或放在 IPC 缓存层，避免全树重渲染。

**命令系统**（IDE 的中枢，必须自研）：

```ts
interface Command {
  id: string                        // 'git.commit'
  title: string                     // '提交更改'
  category: string                  // 'Git'
  keybinding?: Chord | Chord[]      // 'Ctrl+K'
  when?: string                     // 'editorFocus && git.hasChanges'
  run(ctx: CommandContext): void | Promise<void>
}
```

- 注册表全局唯一，菜单、右键、命令面板、快捷键全部从它派生 → 一份定义，四处生效。
- `run` 只接收 `CommandContext`（含 `getState`、`execute`、`ui` 服务），**不允许闭包直接引用 React state**。上一版把命令写成持有 App 级状态的闭包，导致命令无法在组件外复用、测试困难。
- `when` 用极小的表达式求值器（`&&`、`||`、`!`、括号、标识符），约 60 行，不引第三方。
- 键位预设：`jetbrains`（默认）/ `vscode`，存 JSON，设置页可切换与单条覆盖。

### 2.11 打包、分发与更新

| 项 | 方案 |
|---|---|
| 安装包 | Tauri bundler → NSIS，**按用户安装**（HKCU，免管理员），只产 `x86_64-pc-windows-msvc` 一个目标 |
| 系统门槛 | 安装前校验 `OSVersion >= 10.0.19041`（Win10 2004）；不满足则中止并说明原因，不"装上了再崩" |
| WebView2 | `downloadBootstrapper` 模式，缺失时静默安装（Win11 与近两年的 Win10 已内置，多数用户走不到这一步） |
| 注册表写入 | 只在用户层写 HKCU：文件夹右键菜单（`Software\Classes\Directory\shell`）、文件关联（`Software\Classes\.php` 等 + `OpenWithProgids`）、卸载信息。**不接管默认打开方式**，不写 HKLM |
| 体积控制 | release profile：`lto="thin"`、`codegen-units=1`、`strip=true`、`panic="abort"`；前端路由级 code split，语言包按需 import |
| 签名 | **v1 不做代码签名**（D6，只自用）。产物不签名，首次运行需「更多信息 → 仍要运行」；发布页给出 SHA-256 供自查 |
| 分发产物 | NSIS 安装包 + 便携版 zip 双产物；自动更新走 GitHub Releases 的静态 manifest |
| 自动更新 | `tauri-plugin-updater` + 静态 JSON manifest（GitHub Releases，见 D9）；下载失败降级为手动下载 |
| 日志 | `tracing` 写 `%LOCALAPPDATA%\AirIDE\logs\`，按天滚动，保留 7 天；崩溃时 panic hook 落盘 |

**不做**：MSI（WiX 依赖下载不稳定）、商店分发、自动静默升级（必须用户确认）。

### 2.12 只做 Windows：红利、代价与边界

这不是"少做一个平台"，而是**一次性去掉三类工作**：多运行时回归、平台抽象层、多套分发链。

| 红利 | 具体落地 | 换来的东西 |
|---|---|---|
| 运行时只有一套 | 只有 WebView2，无 WebKitGTK / WKWebView 差异 | IME、字体、滚动、选区只调一次，结论可复用 |
| 回归矩阵从 9 格收到 6 格 | 2 个系统（Win10 2004 / Win11）× 3 档 DPI（100/150/200），且只需维护一套测试环境 | 回归清单更短、结论可复用，不必为"各平台行为不同"做额外分支 |
| 原生能力可直接用 | DWM 暗色标题栏、任务栏跳转列表、文件关联、ReadDirectoryChangesW、Toast | 这些恰好是"JetBrains 手感"的一部分，跨平台反而要做三套 |
| 不需要平台抽象层 | 目录、权限、行尾、字体、快捷键全走 Ctrl 系 | 少一层 `platform/` 抽象与条件编译，代码量与调试面同时下降 |
| 分发链只有一条 | NSIS + tauri updater（Minisign 更新签名，与代码签名无关） | 不碰 dmg / AppImage / deb / notarization |
| 性能基线唯一 | 同内核、同 DPI 规则 | 5.3 的"回归 >15% 报警"才有意义 |

**代价必须承认**：

| 代价 | 处理方式 |
|---|---|
| 用不了 macOS / Linux | 定位是个人工具，接受。Rust 层不刻意写死 Win32 API，但**绝不为未来跨平台加抽象层** |
| 绑定系统 WebView2 | bootstrapper + 最低版本校验；不追求 Win7/8 能跑 |
| 依赖系统已装 Git | 探测 + 引导（3.12.6），不内置（会破 10MB 指标） |
| Win10 与 Win11 视觉差异 | 标题栏用 DWM 属性按版本分支，圆角/阴影交给系统，不自绘 |
| 杀软、长路径、DPI 这些 Windows 老坑 | 集中列在 3.12，P0 就要实测，不留到 P5 |

**一条纪律**：UI 代码里不出现"平台判断"。任何"为了将来 mac 版"而写的抽象、开关、分支，一律删掉——这属于范围冻结的一部分。

---

## 3. 架构设计

### 3.1 进程模型

```
AirIDE.exe (Rust 主进程，自身加入 Job Object)
├── WebView2 渲染进程（UI 线程 + CM6 编辑）
│   └── 语言智能客户端 / 状态管理 / Diff 渲染
├── tokio 运行时（背景线程池）
│   ├── 文件 IO、目录遍历、搜索 worker
│   ├── git CLI 子进程管理（每仓库串行队列）
│   └── 文件监听（ReadDirectoryChangesW 64KB + 溢出降级全量重扫，见 3.12.4）
└── 语言服务器子进程（按需启动，N 个；全部归属同一 Job Object，主进程退出即连带终止）
    ├── gopls
    ├── phpactor / PHPantom
    └── ...
```

**铁律**：
- 任何可能超过 8ms 的操作不得在 WebView 主线程执行；前端只做渲染与状态。
- 所有 Rust command 都是 `async`，内部用 `spawn_blocking` 包裹同步 IO。
- 语言服务器崩溃、Git 命令失败，都不得 panic 主进程。

### 3.2 仓库结构

```
air_ide/
├─ apps/desktop/
│  ├─ src/                        # React 前端
│  │  ├─ app/                     # 装配层：App.tsx, Layout, Providers
│  │  ├─ features/
│  │  │  ├─ editor/               # CM6 封装、tab、面包屑、查找替换
│  │  │  ├─ explorer/             # 文件树、右键菜单、文件操作
│  │  │  ├─ search/               # 全局搜索、快速打开
│  │  │  ├─ git/                  # Changes 面板、Diff 视图、提交、分支、冲突
│  │  │  ├─ lsp/                  # Pool、Transport、diagnostics、server 管理
│  │  │  ├─ problems/             # 问题列表
│  │  │  ├─ command/              # 命令注册表、键位引擎、命令面板
│  │  │  └─ settings/
│  │  ├─ ui/                      # 设计系统：Button/Menu/Icon/SplitPane...
│  │  ├─ ipc/                     # Tauri 调用与事件封装（唯一出口）
│  │  ├─ styles/                  # tokens.css / base.css
│  │  └─ main.tsx
│  └─ src-tauri/                  # 窗口、菜单、capabilities、命令装配
├─ crates/
│  ├─ air-core/                   # 共享类型、错误、trace 埋点
│  ├─ air-fs/                     # 读写、编码检测、目录树、大文件判定
│  ├─ air-git/                    # git CLI 封装、status/diff/log 解析器
│  ├─ air-search/                 # ignore + grep，结果流式推送
│  ├─ air-lsp/                    # 进程宿主、分帧、重启、idle 回收
│  ├─ air-workspace/              # 会话、最近项目、设置读写
│  └─ air-win/                    # Windows 专属：DWM 标题栏、跳转列表、HKCU 注册表、长路径归一化
├─ docs/
├─ package.json
├─ pnpm-workspace.yaml
└─ Cargo.toml                     # workspace
```

**为什么 crates 与 src-tauri 分离**：领域逻辑（Git 解析、搜索、LSP 宿主）不依赖 Tauri，可独立单测、可独立 benchmark，未来换壳（含原生）也能复用。

### 3.3 前端模块边界

每个 feature 目录结构固定：

```
features/git/
├─ index.ts          # 唯一对外出口
├─ components/       # 本 feature 的 UI
├─ hooks/            # 本 feature 的 React hooks
├─ store.ts          # 本 feature 的 Zustand store
└─ lib/              # 纯函数（可单测）
```

规则（ESLint `no-restricted-imports` 强制）：
- 跨 feature 只能 `import { X } from '@/features/git'`，禁止 `@/features/git/components/...`。
- `ui/` 不得 import 任何 `features/`。
- `ipc/` 不得 import 任何 `features/`（保证 IPC 层纯净可测）。

### 3.4 Rust crate 职责与关键接口

```rust
// air-fs
pub struct FileMeta { pub path: PathBuf, pub size: u64, pub encoding: Encoding, pub line_ending: LineEnding }
pub fn read_text(path: &Path) -> Result<TextFile>       // 自动编码探测（UTF-8 严格优先 → GB18030 → Latin-1）
pub fn write_text(path: &Path, text: &str, enc: Encoding, eol: LineEnding) -> Result<()>
pub fn list_tree(root: &Path, opts: TreeOptions) -> Result<Vec<TreeEntry>>  // 尊重 .gitignore

// air-git
pub struct StatusEntry { pub path: String, pub orig: Option<String>, pub index: char, pub worktree: char }
pub struct FileDiff { pub path: String, pub hunks: Vec<Hunk>, pub is_binary: bool, pub is_renamed: bool }
pub struct Hunk { pub old_start: u32, pub old_lines: u32, pub new_start: u32, pub new_lines: u32, pub header: String, pub lines: Vec<DiffLine> }
pub async fn status(repo: &Path) -> Result<RepoStatus>
pub async fn diff_file(repo: &Path, path: &str, staged: bool) -> Result<FileDiff>
pub async fn stage_hunk(repo: &Path, patch: &str) -> Result<()>   // 前置：未跟踪文件先 `git add -N`，再 apply --cached
pub async fn unstage_hunk(repo: &Path, patch: &str) -> Result<()> // git apply --cached --reverse
pub async fn discard_hunk(repo: &Path, patch: &str) -> Result<()> // git apply --reverse（只改工作区，不碰 index）

// air-win（只此一处允许出现 Win32 调用）
pub fn apply_dark_titlebar(hwnd: isize, dark: bool) -> Result<()>   // build 分支：Win11 属性 20 / Win10 属性 19
pub fn set_jump_list(recent: &[ProjectEntry]) -> Result<()>
pub fn register_shell_entries(enable: bool) -> Result<()>          // HKCU：Directory\shell / Progids / OpenWithProgids
pub fn normalize_path(p: &Path) -> PathBuf                          // dunce + \\?\ 前缀
pub fn git_candidates() -> Vec<PathBuf>                             // PATH → 常见目录 → 注册表 InstallPath
pub fn create_kill_on_close_job() -> Result<JobHandle>              // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
pub fn assign_to_job(job: &JobHandle, child: &Child) -> Result<()>  // 所有子进程都必须过这一道
pub fn set_taskbar_progress(hwnd: isize, pct: f32, state: TaskbarState) -> Result<()>

// air-lsp
pub struct ServerSpec { pub language: String, pub command: String, pub args: Vec<String>, pub root: PathBuf, pub env: HashMap<String,String> }
pub async fn start(spec: ServerSpec) -> Result<SessionId>
pub async fn send(session: SessionId, message: String) -> Result<()>   // 已含 Content-Length 帧
pub fn shutdown(session: SessionId) -> Result<()>
```

### 3.5 IPC 契约

**命令**（前端 invoke → Rust），命名 `域_动作`：

| 命令 | 入参 | 返回 |
|---|---|---|
| `fs_read_file` | `{ path }` | `{ text, encoding, eol, hasBom, isLarge }` |
| `fs_write_file` | `{ path, text, encoding, eol, hasBom }` | `{ ok, mtime }` |
| `fs_list_dir` | `{ dir }` | `TreeEntry[]`（单层目录，文件树懒加载用） |
| `fs_list_tree` | `{ root }` | `TreeEntry[]`（全量，仅搜索索引/统计场景；文件树禁止全量开树） |
| `fs_create` / `fs_rename` / `fs_delete` | `{ path, type: 'file' \| 'dir' }` | `{ ok }`（fs_create 兼顾新建目录） |
| `fs_watch` | `{ root }` | `{ ok }` |
| `git_status` | `{ repo }` | `RepoStatus` |
| `git_diff_file` | `{ repo, path, staged, ignoreWhitespace }` | `FileDiff` |
| `git_stage_hunks` | `{ repo, path, patch, mode: 'stage' \| 'unstage' }` | `{ ok }` |
| `git_discard_hunks` | `{ repo, path, patch }` | `{ ok }` |
| `git_commit` | `{ repo, message, amend, signoff }` | `{ ok, sha }` |
| `git_branches` / `git_checkout` / `git_branch_create` | `{ repo, ... }` | `BranchInfo[]` |
| `git_log` / `git_blame` / `git_file_history` | `{ repo, path, page }` | 分页结果 |
| `git_conflict_read` / `git_conflict_resolve` | `{ repo, path }` | `ConflictFile` |
| `git_push` / `git_pull` / `git_fetch` | `{ repo, opts }` | stream（进度走事件） |
| `search_query` | `{ root, pattern, opts }` | stream（附 queryId） |
| `search_cancel` | `{ queryId }` | `{ ok }`（改词/关面板必须取消在途搜索，否则白耗 IO 与事件流） |
| `lsp_servers_scan` / `lsp_install` | `{ language }` | `ServerInfo` |
| `lsp_start` / `lsp_send` / `lsp_stop` | `{ ... }` | `{ sessionId }` |
| `fs_stat` / `fs_hash` | `{ path }` | `{ mtime, size, sha256 }`（外部修改判定用，见 3.11） |
| `git_discard_file` | `{ repo, path, staged }` | `{ ok }` |
| `git_undo_commit` | `{ repo }` | `{ ok }`（`reset --soft HEAD~1`） |
| `git_cancel` | `{ repo, opId }` | `{ ok }`（长操作可取消，见 3.7.3） |
| `app_recent_projects` | `{}` | `ProjectEntry[]` |
| `app_settings_load` / `app_settings_save` | `{ patch }` | `Settings` |
| `app_session_load` / `app_session_save` | `{ session }` | `{ ok }` |

**事件**（Rust → 前端），命名 `域://事件`：

| 事件 | 载荷 | 频率控制 |
|---|---|---|
| `fs://changed` | `{ paths: string[] }` | 200ms 合并 |
| `fs://rescan` | `{ root }` | 监听缓冲溢出 → 全量重扫信号（3.12.4），一次 |
| `git://progress` | `{ phase, message, percent }` | 50ms 节流 |
| `git://status-changed` | `{ repo }` | 300ms 防抖 |
| `lsp://message` | `{ sessionId, payload }` | 不合并（协议要求顺序） |
| `lsp://state` | `{ language, state }` | 仅状态变更 |
| `search://batch` | `{ matches[] }` | 每 100 条一批 |
| `search://done` | `{ queryId, total }` | 每次查询一次（UI 收尾依赖此信号，避免转圈不结束） |
| `git://output` | `{ opId, stream, chunk }`（stream 取 `stdout` / `stderr`） | 不合并（hook 与 push 输出必须保序） |

**大 payload 处理**：单次 IPC 超过 2MB（如 10MB 文件的 diff）改用 `tauri::ipc::Response` 返回二进制 + 前端分片解析，避免 JSON 序列化卡顿。

### 3.6 语言自动识别（ProjectProfile）

用户需求"打开项目自动显示对应语言的界面"，落地方式不是准备 7 套皮肤，而是**识别出项目语言画像，据此装载能力**。

**识别流程**：

```
1. 标记文件匹配（权重最高，命中即定）
   composer.json            → PHP
   go.mod                   → Go
   Cargo.toml               → Rust
   pyproject.toml / setup.py / requirements.txt → Python
   package.json + tsconfig.json → TypeScript/Web
   CMakeLists.txt / *.sln   → C/C++
2. 文件扩展名统计（无标记文件时兜底，取 top-2 且占比 >15%）
3. 多语言仓库：允许并存多个 profile（如 Laravel + Vue）
```

**工作区模型（必须写死，否则后续处处要兼容）**：v1 是**单根工作区**——一个窗口对应一个根目录，不支持 multi-root，也不做 submodule 递归 status（submodule 目录显示为普通目录，改动由其中的仓库自己维护）。打开单个文件时，根取该文件向上最近的含 `.git` 的目录；没有 `.git` 则取其所在目录。这个规则决定文件树范围、搜索范围、LSP root 与 Git 仓库定位，四处必须共用同一个函数。注意**工作区根与 Git 仓库根是两个概念**：工作区根可以是仓库的子目录，Git 根向上查到最近的 `.git` 为止；查不到 `.git` 时 Git 工具窗显示「非 Git 仓库」空态，**绝不自动 git init**。

**profile 驱动的东西**：

| 消费方 | 影响 |
|---|---|
| 高亮字典 | 按扩展名映射 Lezer 语言包 |
| LSP | 启动哪些 server、root 目录（PHP 用 composer.json 所在目录，Go 用 go.mod） |
| 状态栏 | 显示语言名与 LSP 状态 |
| 文件图标 | 主题图标集（PHP 紫象、Go 蓝鼠等） |
| 缩进/格式化 | Go 默认 tab & 不自动格式化，PHP/TS 默认 4/2 空格 |
| 新建文件 | 模板与命名校验（PSR-4 命名空间推导仅 PHP） |
| 面包屑/大纲 | 用对应语言的符号规则（Lezer 节点名映射） |

**明确不做**：不根据语言切换整体 UI 布局。IntelliJ 各产品线界面本来就几乎一致，差异在能力而不在外观——照抄"多套界面"是走偏。

#### 3.6.1 混合语法文件（模板）——必须单独处理

主力项目的模板是 `.html` 里嵌 PHP：ThinkPHP 的 `{$var}`、`{if condition="..."}`、`{volist name="..." id="..."}`、`{:func()}`，Laravel 的 `.blade.php` 同理。**任何 PHP 语言服务器都不解析这类文件**，phpactor 只认 `.php`，PHPantom 也不把 `.html` 当 PHP 文档。不处理的结果：用户最高频的文件退化成记事本。

策略（P4 内完成）：

| 文件类型 | 高亮方案 | 智能能力 |
|---|---|---|
| `.html`（含 TP 模板） | HTML Lezer 解析 + 自写装饰器给 `{...}` 标签着色（按标签名分色：控制流/输出/函数调用） | 无补全、无跳转；括号匹配与折叠正常工作 |
| `.blade.php` | PHP Lezer 为主 + `{{ }}` / `@directive` 装饰器 | 同上 |
| `.php` 内混写 HTML | PHP Lezer 原生支持（`<?php ?>` 之外的片段交给 HTML） | LSP 正常工作 |

装饰器实现约 100 行（正则扫描 + RangeSet 增量更新），成本远低于写一个模板语言解析器。**不承诺模板标签的补全**——那是另一个产品量级的事，写进"不做清单"。

### 3.7 Git 模块设计（核心）

#### 3.7.1 状态模型

```ts
interface RepoStatus {
  branch: string
  upstream?: string
  ahead: number
  behind: number
  staged: StatusEntry[]      // index 侧有变化
  unstaged: StatusEntry[]    // worktree 侧有变化
  untracked: StatusEntry[]
  conflicted: StatusEntry[]  // u 状态，单独分组置顶
}

interface StatusEntry {
  path: string
  origPath?: string          // 重命名/复制时的原路径
  kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'typechange' | 'untracked' | 'conflict'
}
```

UI 呈现对齐 IntelliJ 的 Commit 工具窗：

```
▼ 更改 (3)              [✓ 全选]  [↻]  [⚙]
  ▼ src/
    M  OrderService.php        [✓]
    M  RefundService.php       [✓]
  +  new_file.php              [ ]   ← 未跟踪
▼ 已暂存 (1)
    M  PaymentGateway.php      [✓]
```

- 复选框即 stage/unstage 开关（勾选 = `git add`，取消 = `git restore --staged`）。
- 目录级复选框支持整目录批量。
- 单击选中，双击/Enter 打开 Diff，Space 切换勾选（键盘流）。

#### 3.7.2 为什么不用 `@codemirror/merge` 渲染 Git Diff

`@codemirror/merge` 的设计目标是"把两份文档合并成一份"，它自己算 chunk 边界。而 Git 场景要求：**hunk 边界必须与 `git diff` 完全一致**，否则"暂存这一块"会暂存到别的内容——这是数据正确性问题，不是体验问题。此外 CM6 merge 的 chunk 是"可接受/拒绝"语义，而 Git 需要"暂存/取消暂存/丢弃"三态。

**方案：自建 Diff 渲染层**，数据源是 `air-git` 解析出的 `FileDiff`。

| 视图 | 实现 |
|---|---|
| 单栏（unified） | 一个只读 CM6 实例，行级 decoration 上色（add/del/mod），hunk header 用 block widget 渲染「▸ 暂存此块」按钮 |
| 双栏（split） | 两个只读 CM6 实例 + 同步滚动 + 缺失行用 spacer widget 对齐；中间连接条自绘 |
| 词级高亮 | 对同一 hunk 内的删除/新增行做行内 diff（`similar` crate 或自写 LCS），映射成 CM6 mark decoration |
| 已读标记 | 每 hunk 左侧 gutter 标记 + 状态存 session（不进 git），进度条显示 x/y |

**hunk 级操作实现**：把单个 hunk 重新拼成合法 patch 头，再按操作类型选择应用方式：

| 操作 | 命令 | 影响范围 |
|---|---|---|
| 暂存此块 `»` | `git apply --cached` | 只写 index |
| 取消暂存 `«` | `git apply --cached --reverse` | 只写 index（反向） |
| 丢弃此块（工作区） | `git apply --reverse` | 只写工作区 |

```
diff --git a/src/A.php b/src/A.php
--- a/src/A.php
+++ b/src/A.php
@@ -12,7 +12,7 @@ class A
 ... 该 hunk 的原始行 ...
```

坑位（必须有回归测试）：

- **未跟踪文件无法直接 hunk 暂存**：index 里没有 base，`git apply --cached` 会失败。必须先把文件标记为 intent-to-add（`git add -N <path>`），它才会以"新增"形式出现在 diff 里、才有 base 可 patch。这是"新文件只想暂存一部分"的必经路径，漏了就是功能缺失。
- **未跟踪文件的「丢弃」= 删除整个文件**：index 里没有 base，无法只回退部分行；对未跟踪文件的任何 hunk 丢弃等价于删文件，必须二次确认并明示「该文件未被 Git 跟踪，丢弃后无法从 Git 找回」。
- **行尾以 index 形式为准，不能一律假设 CRLF**：`git diff` 与 `git diff --cached` 输出的是 index 中的内容形式。本机 `core.autocrlf=true` 时工作区是 CRLF、index 是 LF，patch 必须按 LF 拼接；`autocrlf=false` 时按文件原样。v1.0 写的"patch 必须保持原 `\r\n`"是错的，会让 apply 在本机直接失败。回归矩阵必须覆盖 `autocrlf = true / false / input` 三态。
- 无末尾换行：`\ No newline at end of file` 行必须原样保留。
- 重命名：`rename from/to` 头 + hunk 需一起处理。
- 二进制文件：不提供 hunk 操作，只给"暂存整个文件"。
- 新文件全部内容：`/dev/null` 形式，配合 `add -N` 使用。
- 删除文件：整文件删除只能整体暂存，不做 hunk 级。

**失败处理铁律**：`git apply` 返回非零时，不得写任何文件、不得改 index，直接把 git 的 stderr 原样展示。hunk 操作前对目标文件做一次内存快照，apply 成功后比对内容哈希，不一致则回滚并报错（宁可操作失败，也不留半截状态）。

#### 3.7.3 提交与远端

- 提交流程：message 校验（非空）→ 若 staged 为空且用户要求提交全部，则提示"是否先暂存" → `git commit -F -` → 成功后清空勾选并刷新 status。
- 提交前钩子失败：把 stderr 完整展示在可展开区域（不要截断成一行 toast）。
- push/pull：进度走 `git://progress`，UI 在状态栏 + Git 工具窗顶部显示；`--ff-only` 失败时提示"需要先 pull"，提供 merge/rebase 二选一，不自动强推。
- 切换分支：不做自动 stash 包装。git 因脏文件拒绝切换时原样展示错误，并给「stash 后重试」的命令条快捷入口；git 允许带走修改时属 Git 语义，状态栏提示被带走的文件数即可。
- 危险操作（`discard`、`reset --hard`、删除分支）一律二次确认，且确认框里列出受影响文件。
- **长操作可取消**：fetch/clone 走 `git_cancel` 终止子进程（Job Object 保证不留孤儿），并明确告知"已取消，仓库可能处于中间状态"。
- **hooks 属用户环境**：commit/push 触发仓库内 `.git/hooks` 是预期行为，不拦截；但首次打开一个来源不明的仓库并执行写操作前，提示一次"该仓库含可执行 hooks"，避免在陌生代码库上盲跑脚本。

#### 3.7.4 冲突解决

检测到 `conflicted` 状态时，Diff 视图切换为三栏：`本地版本 | 结果 | 远端版本`。

- 逐块按钮：接受本地 / 接受远端 / 双方保留。
- 结果栏可直接编辑（这是唯一允许编辑的 diff 视图）。
- 全部冲突解决后标记 `git add`，未解决时禁止 commit 并提示剩余文件数。
- 不做智能语法级合并（那是 JetBrains 的护城河，v1 不碰）。

### 3.8 编辑器能力矩阵

| 能力 | 实现来源 | 阶段 |
|---|---|---|
| 语法高亮 | Lezer 语言包（php/go/python/rust/js/css/html/json/yaml/markdown/sql） | P1 |
| 自动缩进、括号补全 | `@codemirror/autocomplete` + 语言包 indent | P1 |
| 代码折叠 | `foldGutter` + Lezer fold 节点 + LSP foldingRange | P1 |
| 缩进参考线 | 自写 ViewPlugin（80 行） | P1 |
| 当前行 / 选中词高亮 | 内置扩展 | P1 |
| 多光标 | 内置（JetBrains：Alt+Shift+Click / 双击 Ctrl+↑↓；VS Code 预设：Alt+Click） | P1 |
| 查找替换 | `@codemirror/search` + 自绘 JetBrains 风格面板 | P1 |
| 面包屑 | documentSymbol / Lezer 路径 | P1 |
| 补全 / hover / 签名 | LSP | P4 |
| 诊断波浪线 + gutter | LSP diagnostics → `@codemirror/lint` | P4 |
| 跳转定义 / 引用 / 实现 | LSP | P4 |
| 重命名（含跨文件） | LSP rename + WorkspaceEdit 应用 | P4 |
| 格式化 | LSP formatting | P4 |
| 大纲面板 | documentSymbol | P4 |
| 模板标签着色（TP / Blade） | 自写装饰器（3.6.1） | P4 |
| minimap / sticky scroll | 自绘 | v1.1 可选 |

**大文件策略**（必须实现，否则一次误点就卡死）：

| 文件大小 | 行为 |
|---|---|
| < 2MB | 全功能（语法 + LSP） |
| 2MB - 10MB | 关闭 LSP、关闭折叠与面包屑，仅语法高亮 |
| > 10MB | 纯文本只读、无高亮、提示"大文件已进入只读模式" |
| > 50MB | 不加载内容。只读也扛不住：100MB 文本以 UTF-16 装入 WebView 约 200MB，直接击穿 160MB 内存预算。提示"文件过大，请用外部程序查看"，给复制路径 / 资源管理器入口 |
| 二进制 | 不进编辑器，改为"在资源管理器中显示" |

### 3.9 交互对齐 JetBrains

#### 3.9.1 默认快捷键（JetBrains keymap）

| 功能 | 键位 |
|---|---|
| 快速打开文件 | `Ctrl+Shift+N` |
| 最近文件 | `Ctrl+E` |
| 全局搜索 | `Ctrl+Shift+F` |
| 查找 / 替换（当前文件） | `Ctrl+F` / `Ctrl+R` |
| 命令面板（Find Action） | `Ctrl+Shift+A` |
| Project 工具窗 | `Alt+1` |
| Git 工具窗 | `Alt+9` |
| 搜索结果 / Problems | `Alt+3` / `Alt+6` |
| 提交 | `Ctrl+K` |
| 打开 Diff（Changes 面板内） | `Ctrl+D`（上下文键位；编辑器内 `Ctrl+D` 仍是复制行） |
| 下一个 / 上一个改动 | `F7` / `Shift+F7` |
| 还原当前块 | `Ctrl+Alt+Z` |
| 跳转定义 | `Ctrl+B`（或 `Ctrl+Click`） |
| 查找引用 | `Alt+F7` |
| 返回上一位置 | `Ctrl+Alt+←` |
| 回到最后编辑处 | `Ctrl+Shift+Backspace` |
| 格式化 | `Ctrl+Alt+L` |
| 重命名 | `Shift+F6` |
| 关闭 tab | `Ctrl+W`（IntelliJ 语义：关 tab，不是关窗口） |
| 切换 tab | `Ctrl+Tab` |
| 保存 | `Ctrl+S`（同时触发格式化？不做，避免意外改动） |
| 全部保存 | `Ctrl+Shift+S` |
| 新建 / 删除文件 | `Alt+Insert` / `Delete`（树内焦点） |
| 收起所有工具窗回到编辑器 | `Esc` |

#### 3.9.2 焦点模型（JetBrains 用久了会形成肌肉记忆，必须还原）

- **Esc 回到编辑器**：任何工具窗/面板有焦点时按 Esc，焦点回编辑器，工具窗保持打开。
- **Shift+Esc 隐藏当前工具窗**。
- **Alt+数字** 切换工具窗：已开且聚焦 → 关闭；已开未聚焦 → 聚焦；未开 → 打开并聚焦。
- **方向键在工具窗内移动选择，Enter 打开到编辑器**，不抢编辑器焦点。
- **tab 关闭后焦点回到上一个访问的 tab**（不是固定回第一个）。

#### 3.9.3 Diff 交互（对齐 IntelliJ）

- 双栏默认，右上角按钮切单栏。
- hunk 之间跳转：`F7` / `Shift+F7`，当前 hunk 高亮边框。
- 每个 hunk 左侧按钮组：`»` 暂存此块 / `«` 取消暂存 / 撤销图标 丢弃。
- 顶部工具条：`上一个/下一个改动`、`全部暂存`、`全部取消`、`视图切换`、`忽略空白差异`。
- 已读标记：hunk 左侧 gutter 圆点，点击切换；工具条显示 `3/12 已读`。
- 忽略空白差异（`-w`）开关必须做，PHP 项目格式化后 diff 全靠它。

### 3.10 持久化与会话恢复

| 数据 | 位置 | 格式 |
|---|---|---|
| 应用设置 | `%APPDATA%\AirIDE\settings.json` | JSON，原子写（tmp + rename） |
| 会话（打开的文件、光标、面板尺寸、工具窗状态） | `%APPDATA%\AirIDE\session.json` | JSON，1s 防抖 |
| 未保存草稿 | `%APPDATA%\AirIDE\drafts\<hash>.txt` | 原文 + json 元数据；单文件 ≤512KB，总量 ≤8MB（超限行为见下） |
| 最近项目 | `%APPDATA%\AirIDE\recent.json` | 最多 20 条 |
| 日志 | `%LOCALAPPDATA%\AirIDE\logs\` | 按天滚动，保留 7 天 |

**单实例**：用 `tauri-plugin-single-instance` 保证只有一个进程。第二次启动（双击文件、命令行 `airide .`）不新开窗口，而是把参数转发给已有实例并聚焦。没有这一条，两个实例会并发写 `session.json` 与草稿目录，直接丢会话——实现成本极低，不做的代价是随机数据丢失。

**草稿上限的行为要明确**：单文件超过 512KB 或总量超过 8MB 时**不落草稿**（避免每次按键都写放大），但内容仍留在内存，tab 上显示"未落盘"标记；崩溃时该文件不可恢复，恢复提示里要如实列出"有 N 个文件因体积过大未保存草稿"，不能假装全部恢复了。

**设置带版本号**：`settings.json` 内含 `schemaVersion`，启动时按版本顺序执行迁移函数；遇到更高版本（用户降级试用）时不覆盖、只读取认识的字段，并备份为 `settings.bak.json`。这是防止"改一次版本把配置清空"的最低成本做法。

**可迁移**：设置与键位支持整体导出/导入为单个 JSON（设置页按钮），不依赖手工找 AppData 目录。

**恢复语义**：
- 启动时若存在草稿，恢复为脏 tab 并在状态栏提示"已恢复 N 个未保存文件"。
- 崩溃后首次启动提供"恢复上次会话 / 从空白开始"二选一，不静默恢复。
- 会话里记录的是绝对路径；路径不存在时静默跳过，不弹错误。

### 3.11 外部修改与冲突（本产品的核心场景，必须有）

用户的工作方式是"AI 在别的工具里改文件，回来看 Diff"。所以"文件被外部改动"不是异常分支，而是主路径。必须定义清楚三种变化来源与处理方式。

**变化来源**：

| 来源 | 识别方式 | 处理 |
|---|---|---|
| 本 IDE 自己保存 | 写入前登记 `(path, mtime, size)` 到抑制表，500ms 窗口内忽略对应事件 | 不触发任何提示 |
| 外部工具（AI CLI / 其他编辑器） | 文件监听事件且不在抑制表 | 按下面的三态处理 |
| Git 操作（checkout / merge / reset） | git 命令执行前后主动标记该批文件 | 重载文本，不弹横幅，但清空该文件的"已读标记" |

**三态处理**（针对"该文件已在编辑器打开"）：

| 状态 | 行为 |
|---|---|
| 干净（无未保存改动） | 静默重载，按行号比例恢复光标与滚动位置；状态栏闪一下"已重新加载" |
| 脏（有未保存改动） | **不覆盖**。编辑器顶部出现横幅：「文件已在外部修改 · 重新加载 / 保留我的 / 对比差异」；重载不进 undo 栈，`Ctrl+Z` 救不回替换，所以「重新加载」前先把当前内容存为临时快照；三个选项的效果都可通过横幅保留的入口重新选择来反悔（tab 关闭前入口不消失） |
| 正在看该文件的 Diff | 重算 diff 并保留滚动位置与已读标记；若 hunk 数量变化，已读标记按新 hunk 边界重映射 |

**实现要点**：

- 监听合并：同一文件 1 秒内多次变更只处理最后一次（AI 工具往往连续写多个文件）。
- 批量场景：`git checkout` 切分支可能触发上千个事件，用"批次令牌"合并为一次刷新，只重算 status，不逐个重载编辑器（P1 先实现基础合并，分支操作的批次语义随 P3 完善）。
- 重载是**替换文档**而非"应用增量"，直接 `dispatch({changes: {from: 0, to: doc.length, insert: newText}})`，并把该次变更标记为 `external`（不进 undo 栈）。
- **保存前复检**：写盘前用 `fs_stat`/`fs_hash` 复核磁盘 mtime 与打开时快照；若文件已在外部被改且三选一横幅尚未决策，不静默写盘、转为三选一横幅——防止「我的保存覆盖外部改动」（R11 的反向场景）。
- 大文件（>10MB）外部变更时不自动重载，只提示"文件已变化，点击重新加载"。
- 目录被删除 / 重命名：关闭相关 tab 并在状态栏提示，不弹模态框。

### 3.12 Windows 平台适配（v1 唯一目标平台）

只做 Windows 不等于"没有平台问题"，而是平台问题**集中且已知**。3.12.1–3.12.6 共 6 项必须在 P0 spike 实测；3.12.7、3.12.8 属实现约定，P0 落地、随 5.2 双系统回归——口径与 P0/附录 C 的「6 项」一致。

#### 3.12.1 长路径（260 字符）

老项目里 `vendor/`、`node_modules/` 深层目录超 260 字符很常见，`MAX_PATH` 超限会直接 `ERROR_PATH_NOT_FOUND`。

- 应用清单声明 `longPathAware`；同时提示用户开启系统开关（`LongPathsEnabled=1`，Win10 1607+，默认关闭）。
- Rust 侧统一用 `dunce` 归一化，调用原生 API 时加 `\\?\` 前缀；全程 `PathBuf`，**禁止字符串拼接路径**。
- 失败时识别长路径特征，给出"开启长路径支持"的可复制命令，而不是只弹"文件不存在"。
- Git 有独立开关：仓库路径深时提示 `git config core.longpaths true`（系统开关不覆盖 git）。

**验收**：能打开 300 字符深的目录与文件，文件树、搜索、Diff 全部正常。

#### 3.12.2 高 DPI 与多显示器

- WebView2 是 Per-Monitor V2，窗口跨不同 DPI 的显示器时 `WM_DPICHANGED` 会触发重排，行高/光标需按 `devicePixelRatio` 重算。
- CM6 行高用整数 CSS 像素，避免 125% 缩放下光标与文字错位半个像素。
- 图标一律 SVG，不做跨 DPI 复用的位图缓存。

**验收**：100% → 150% → 200% 拖动切换显示器后，光标位置、选区、Diff 行对齐均不偏移。

#### 3.12.3 暗色标题栏（DWM，决策：原生边框 + 暗色）

- Win11（22000+）：`DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE = 20, &1, 4)`
- Win10（2004–21H2）：同一属性编号为 `19`（该属性自 1809 起可用，本项目最低 2004 所以无需再往前兼容）
- Win11 再设 `DWMWA_BORDER_COLOR`，让边框与 Darcula 一致
- 系统主题切换时属性会被重置，需监听 `WM_SETTINGCHANGE`（`ImmersiveColorSet`）后重设
- 属性不被支持时降级为系统默认标题栏，**不做自绘**（自绘会丢 Snap Layouts、窗口阴影与多显示器拖动体验）

**验收**：系统深/浅色主题来回切 3 次，标题栏不残留错误配色；Win10 与 Win11 上窗口按钮均清晰可见。

#### 3.12.4 文件监听（ReadDirectoryChangesW 的坑）

`notify` 在 Windows 上走 ReadDirectoryChangesW，默认缓冲区小，`git checkout`、`npm i` 这种批量写入会触发 **BufferOverflow，事件直接丢失**——表现为"文件改了但 IDE 没反应"，是最容易被误判为"IDE 有 bug"的问题。

- 缓冲区提到 64KB；收到溢出标志时**放弃增量、全量重扫该根目录**，并合并后续 1 秒事件，绝不静默丢弃。
- 不监听 `node_modules`、`vendor`、`.git/objects`（只监听父目录存在性），否则 10k 文件仓库的事件风暴会打满 UI。
- 编辑器自身的写入走抑制表（3.11），避免"自己改自己"。

**验收**：`git checkout` 切到差异 2000 文件的分支，UI 在 1.5s 内收敛、不重复刷新、不丢状态。

#### 3.12.5 Defender / 杀软实时扫描

实时防护会拦截每次文件打开与 `git status` 的 stat 调用，10k 文件仓库首次 status 可慢 2–3 倍。

- 首次打开 >5000 文件的项目时，状态栏给一条**可关闭**的提示，附加入排除项的命令（`Add-MpPreference -ExclusionPath`）。
- 必须**用户确认后**才执行，不静默修改系统安全设置。
- 5.3 的基准数据必须标注"Defender 开启"状态，否则数字不可比。

#### 3.12.6 Git 运行时探测（决策：依赖系统 Git + 引导）

- 探测顺序：设置项指定 → `PATH` 中的 `git.exe` → `%ProgramFiles%\Git\cmd\git.exe` → `%LOCALAPPDATA%\Programs\Git\cmd\git.exe` → 注册表 `HKLM\SOFTWARE\GitForWindows\InstallPath`
- 版本 ≥ 2.30（`--porcelain=v2` 完整支持）；低于则提示升级，但只读功能仍可用
- 缺失时 Git 面板出引导卡片：`winget install --id Git.Git -e` + 官网链接 + "重新检测"按钮，**不要求重启应用**
- 调用一律用绝对路径 + 参数数组，不经 shell（避免 cmd 与控制台的引号、编码差异），并固定 `-c core.quotepath=false`
- **提交身份预检**：首次提交前检查 `user.name` / `user.email`，缺失时用内联表单补齐（让用户选 `--local` 还是 `--global`），不要求用户去命令行设置

**验收**：把 Git 从 PATH 移除后打开项目，不崩溃、不白屏、引导可走通。

#### 3.12.7 编码与子进程输出

- 绿色版/被修改过代码页的环境里，控制台可能是 936：git 自身输出为 UTF-8，**按 UTF-8 解析，不回退读控制台代码页**；解析失败时按字节记录原始输出便于诊断。
- GBK 文件检测用 `MultiByteToWideChar(936)` 做交叉验证，再叠加统计式检测，避免"短文件误判"。

#### 3.12.8 崩溃与诊断

- panic hook 落盘到 `%LOCALAPPDATA%\AirIDE\logs\crash-*.log`，含栈 + 最近 20 条操作日志（不含文件内容）。
- v1 不做 minidump（WER 配置与符号管理成本高于收益），文档里给出"如何用 procdump 抓 dump"的步骤即可。

### 3.13 既然不做跨平台：应当用足的 Windows 原生能力

放弃可移植性买到的是"可以直接用系统能力，不必自己造跨平台等价物"。下面四项都是几十行代码换一类真实问题，属于该做而不该省的。

| 能力 | 用法 | 成本 | 不做的后果 |
|---|---|---|---|
| **Job Object** | 主进程创建 Job，设 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`，把所有子进程（git、语言服务器、LSP 安装器）加入 | ~50 行 | 主进程崩溃或被强杀后，`gopls`/`phpactor`/PHPantom 变孤儿进程继续吃几百 MB，下次启动再起一份，越用越慢 |
| **任务栏进度条** | `ITaskbarList3::SetProgressValue/SetProgressState` | ~30 行 | 打开 10k 文件项目、clone、fetch 时用户看不到进度，只能猜是不是卡死 |
| **Toast 通知** | `tauri-plugin-notification`（Windows 走 WinRT Toast） | ~30 行 | push 完成/失败发生在窗口失焦时完全无感知 |
| **文件共享语义** | 自行 `CreateFileW` 时保持 `FILE_SHARE_READ` + `FILE_SHARE_WRITE` + `FILE_SHARE_DELETE`（Rust `std::fs` 默认已是三者）；禁用 `LockFile`、禁独占打开；大文件 mmap 只读共享 | 一处封装 | 一旦独占，外部 AI 工具写入会报 `ERROR_SHARING_VIOLATION`——恰好打断本产品的核心工作流 |

已纳入阶段或已实现的：DWM 暗色标题栏（3.12.3）、Jump List 与注册表集成（P5）、单实例 + 参数转发（P0）、长路径与监听调优（3.12.1/3.12.4）。

**归口**：前三项全部落在 `air-win`；文件共享语义在 `air-fs` 里统一封装，**禁止业务代码直接调 `std::fs` 的底层句柄构造**，否则共享标志会在某个角落被改掉。

**明确不用**：Windows 文件锁表达"文件已打开"状态（与外部工具冲突）、托盘常驻（产品要求不常驻后台）、计划任务/服务（同上）、注册表写 HKLM（免管理员原则）。

### 3.14 设置项清单（先定清单，再写设置页）

设置页最容易变成"边写边加、命名混乱"。先固定分组与默认值，实现时只填 UI。

| 分组 | 设置项 | 默认值 |
|---|---|---|
| 编辑器 | 字号 / 行高 / 字体 | 13px / 1.2 / JetBrains Mono |
| 编辑器 | 缩进（按语言覆盖） | PHP 4 空格、Go tab、TS/JS 2 空格 |
| 编辑器 | 行号 / 空白字符 / 当前行高亮 / 自动换行 | 开 / 关 / 开 / 关 |
| 编辑器 | 大文件阈值（降级 / 只读） | 2MB / 10MB |
| 文件 | 新建文件默认编码与行尾 | UTF-8 / 跟随仓库（`core.autocrlf`） |
| 文件 | 保存时去除行尾空格 | 关（默认不改用户内容） |
| 文件 | 保存策略 | 仅手动 `Ctrl+S`；「失焦自动保存」默认关（审阅工作流下，意外落盘比丢编辑更糟） |
| 文件 | 文件树自动定位当前 tab | 开 |
| 外观 | 主题 | 跟随系统（Darcula Dark / IntelliJ Light） |
| 外观 | 工具窗宽度 / 状态栏显示项 | 340px / 全部 |
| 键位 | 预设 / 单条覆盖 | jetbrains / 空 |
| Git | `git.exe` 路径 | 自动探测（3.12.6） |
| Git | 提交时 sign-off / GPG 签名 | 关 / 跟随仓库配置 |
| Git | Diff 默认忽略空白差异 | 关 |
| Git | Diff 默认视图 | 双栏（3.9.3） |
| Git | status 刷新节流 | 300ms |
| LSP | 各语言 server 路径 / 自动下载 | 自动 / 开 |
| LSP | idle 回收时间 | 10 分钟 |
| 系统 | 单实例 / 自动更新 / Defender 提示 | 开 / 开 / 开 |
| 系统 | 文件夹右键菜单、文件关联 | 安装版默认开，可在设置里关（写/删 HKCU） |
| 系统 | 日志级别 | info |

**规则**：改设置立即生效，唯一例外是 LSP server 路径（需重启该 server，界面给"立即重启"按钮）。设置文件损坏时回退默认值并把坏文件改名保留，不静默覆盖。

### 3.15 错误呈现分级（避免什么都弹模态框）

| 级别 | 适用场景 | 呈现方式 |
|---|---|---|
| 静默 | 可自愈：外部修改后重载、LSP 自动重启成功、status 自动刷新 | 状态栏文字闪一下，不打断操作 |
| 内联横幅 | 与当前编辑/操作直接相关：保存失败、hunk apply 失败、文件已被删除 | 编辑器或面板顶部横幅 + 可展开详情 + 重试按钮 |
| 输出面板 | 需要阅读长文本：hook 失败、push 被拒、merge 冲突提示 | Git 输出面板保留完整 stderr，可复制，不截断成 toast |
| 模态确认 | 不可逆且影响多文件：丢弃全部改动、删除分支、`reset` | 二次确认 + 受影响文件清单 + 默认焦点在"取消" |

三条原则：**需要读的信息绝不放 toast**（toast 只用于"已完成"类反馈）；**可重试的错误绝不用模态**；**错误文本保留 git/lsp 原文**，只在其上补一句人话解释，不替换原始信息。

### 3.16 交互细节补遗（都是小功能，缺了就会被说"不如 JetBrains"）

| 细节 | 行为 |
|---|---|
| 文件树自动定位 | 切换 tab 时自动展开并选中对应节点；用户手动滚动后暂停跟随，直到下次点击文件树 |
| tab 溢出 | 单行显示，超出部分进右侧下拉列表（IntelliJ 行为），不换行堆叠 |
| 编码切换的两种语义 | 状态栏点编码 → 必须区分「**重新解释**（Reinterpret，按新编码重读，内容可能变）」与「**转换并保存**（Convert，内容不变、字节变）」；混淆这两者是乱码事故的常见来源 |
| 行尾切换 | 只改当前文件与"新建文件默认值"，不改 git 配置；状态栏显示 `CRLF`/`LF`，混合时显示 `Mixed` 并给出统一入口 |
| 大文件只读模式 | 仍允许 `Ctrl+F` 查找与跳转行号，只关闭高亮/LSP/折叠——只读不等于不能导航 |
| Diff 首次打开 | 定位到第一个改动 hunk，而不是文件第 1 行；无改动时显示"无差异"而不是空白编辑器 |
| 状态栏 LSP 图标 | 左键 = 该语言 server 菜单（重启/停止/日志），右键 = 直接重启；不弹对话框 |
| 命令面板 | 只放命令（`Ctrl+Shift+A`），文件跳转走快速打开（`Ctrl+Shift+N`），两者不合并，避免"输入文件名却执行了命令"的歧义 |
| 外部拖拽打开 | 文件/文件夹从资源管理器拖进窗口：文件 → 新 tab；文件夹 → 确认后切换项目；WebView2 拖放事件与中文路径在 P1 验证 |

---

## 4. 分阶段开发计划

每个阶段都有**可验收的交付物**，不达标不进入下一阶段。阶段之间只有依赖关系，没有时间承诺。

### Phase 0：骨架与链路打通

**目标**：证明"Tauri 2 + React + CM6"这条链路能跑、能满足性能预算、中文输入正常，并且 Windows 平台的 6 个已知坑在进入 P1 之前全部验证完。这是唯一允许做技术验证而非功能的阶段。

| 任务 | 产出 |
|---|---|
| 脚手架：pnpm workspace + Cargo workspace + Tauri 2.12 init + Vite 8 + React 19 + TS 严格模式、单实例插件 | 可 `pnpm dev` 启动 |
| 窗口与菜单：1280×800 默认、窗口状态记忆、原生菜单（File/Edit/View/Git/Help）、命令行参数转发 | 菜单可点，二次启动聚焦已有窗口 |
| 设计 token 与布局骨架：四区拖拽分割、工具窗语义（Alt+1/9/Esc 焦点模型）、状态栏、Darcula 主题 | 视觉雏形，密度接近 IntelliJ |
| CM6 集成：打开/编辑/保存，编码 + 行尾 + BOM 检测与回写，Darcula 语法配色 | 单文件可读写，中文/GBK/BOM 均正确 |
| IPC 层：命令封装 + 事件通道 + 错误统一格式 + 大 payload 通道 | 前后端类型共享 |
| **技术验证 spike**：中文 IME 候选框、10MB 文件、冷启动/内存基准脚本 | spike 报告 + 基准数据 |
| **Windows 原生适配 spike**：DWM 暗色标题栏（Win10 属性 19 / Win11 属性 20）、高 DPI 多显示器切换、300 字符长路径、ReadDirectoryChangesW 溢出、Git 运行时探测（3.12.1–3.12.6） | 结论文档 + 必要依赖（dunce、windows crate）就位 |

**验收**：
- 冷启动 ≤800ms，空闲内存 ≤160MB（脚本实测，非主观）。
- 中文输入法在编辑器中候选框位置正确，快速连打不丢字。
- 打开 10MB 文本文件不卡死，首次可见 ≤150ms。
- 打开 → 改一行 → 保存：GBK 文件回写仍是 GBK，带 BOM 的文件保存后仍是 BOM。
- 从命令行 `airide .` 启动第二次，不新开窗口，聚焦已有实例。
- **Windows 适配 6 项全过**：标题栏随 Darcula 变色（Win10 与 Win11 各一次）、100%↔200% 拖动切换后光标不偏、300 字符长路径可打开、`git checkout` 大批量变更后界面 1.5s 内收敛、Git 缺失时给出引导而非崩溃、系统主题切换后标题栏不错色。

**不做**：文件树、Git、LSP、多 tab。

### Phase 1：阅读编辑 + 最小 diff

**目标**：把"读代码"做到顺手，并**提前交付最小可用的 Diff**——这一阶段结束时就要能替代 `git diff` 命令，让产品尽早产生独立价值、尽早暴露风险。

- 文件树（懒加载、忽略规则、图标、刷新、自动定位当前 tab、右键菜单：新建/重命名/删除/复制路径/在资源管理器显示）
- 多 tab（打开/关闭/切换/拖拽排序/脏标记/预览 tab 单击变固定/溢出下拉）
- 外部拖拽打开（文件 → 新 tab，文件夹 → 确认后切换项目，见 3.16）
- 会话恢复 + 未保存草稿（崩溃恢复）
- 查找替换面板（JetBrains 样式：当前文件、区分大小写、整词、正则）
- 快速打开（nucleo 模糊匹配 + 最近文件 `Ctrl+E`）
- 全局搜索（`ignore` + `grep`，结果按文件分组、可折叠、跳转定位）
- 编辑器细节：折叠、缩进参考线、面包屑、括号匹配、选中词高亮、当前行高亮
- 编码与行尾切换（含「重新解释 / 转换并保存」两种语义，见 3.16）
- 大文件分级策略 + 二进制文件处理
- 命令系统 + 键位引擎 + 命令面板
- 设置页（按 3.14 清单实现，含导入导出与 `schemaVersion` 迁移）
- 统一错误呈现：按 3.15 分级落地（状态栏提示 / 内联横幅 / 输出面板 / 模态确认）
- **最小 diff**：status 解析（porcelain v2，文件级）+ Changes 列表 + 只读 unified diff（行级着色，无词级/折叠）+ 外部修改三态处理（3.11）

**验收**：
- 打开 10k 文件的项目，文件树首次展开 ≤200ms，滚动不掉帧。
- 全局搜索 10k 文件项目返回首批结果 ≤300ms，结果可流式追加。
- 强制杀进程后重启，未保存内容完整恢复且标记为脏。
- 20 个常用操作全部可通过命令面板触达，键位符合 3.9.1 表。
- 打开项目后 Changes 面板列出改动，双击能看单文件 diff——**此时已可替代 `git diff` 命令**。
- 外部工具改文件：干净 tab 自动重载；脏 tab 出现三选项横幅且不覆盖内容。

### Phase 2：Diff 完整化

**目标**：这是产品的"脸面"。做完这一阶段，看 diff 的体验必须明显优于命令行，也优于临时用 VS Code。

- 双栏 diff（两个只读 CM6 + 同步滚动 + filler 行对齐 + 中间连接条）
- 词级高亮（`similar` crate 做行内 diff，映射为 mark decoration）
- 折叠未变更区（hunk 间上下文可折叠）
- hunk 导航（F7/Shift+F7）+ 当前 hunk 高亮边框
- 已读标记 + 进度条（x/y）
- 忽略空白差异开关（`-w`，含"忽略行尾差异"）
- log 视图（分页、作者/时间、简化分支图）
- blame / 文件历史（按行著色、hover 显示 commit、跳转）

**验收**：
- 10k 文件仓库 status 刷新 ≤250ms（热），50k 文件 ≤600ms。
- 打开 2000 行文件的 diff ≤120ms，滚动 60fps；双栏滚动同步误差 ≤1 行。
- 中文文件名、重命名文件、二进制文件、CRLF 文件、无末尾换行文件均正确显示。
- 忽略空白开关能让"仅格式化"的 diff 归零。
- 1000 行的 diff 里 F7 连续跳转 20 次，焦点与滚动位置始终正确。

### Phase 3：Git 写入与远端

**目标**：完整替代命令行做日常提交推送，且不会误伤代码。

- 文件级 stage/unstage（复用已有复选框）
- **hunk 级 stage/unstage/discard**：patch 拼接（含未跟踪文件 `add -N`）+ `git apply` 三种模式 + 哈希校验回滚
- patch 回归矩阵：`autocrlf` × (true/false/input) × 7 类边界（CRLF、无末尾换行、重命名、新文件、删除、相邻 hunk、二进制）
- 提交面板（message、amend、sign-off、提交并推送、hook 输出完整展示、最近提交信息 ↑↓ 复用）
- **撤销上一次提交**（`reset --soft HEAD~1`，保留暂存区，二次确认）；不做 `--hard` 的 UI 入口
- 分支操作（切换、新建、合并、删除、ahead/behind 显示）
- fetch / pull / push + 进度展示 + 失败诊断（含 ff-only 失败后的 merge/rebase 选择）
- **Git 命令条**：可输入任意 git 命令并流式看输出（解决 rebase 中断、stash、cherry-pick 等 UI 未覆盖场景）
- 冲突三栏解决（解析 conflict markers、逐块接受、结果栏可编辑、标记 resolved、嵌套/删除/二进制冲突）
- **AI 上下文导出**：当前文件 / 选区 / diff → 带路径与行号的结构化 markdown 并写入剪贴板（D7）

**验收**：
- hunk 级暂存后 `git diff --cached` 内容与 UI 勾选完全一致（回归矩阵全绿）。
- 未跟踪文件的单个 hunk 能独立暂存（`add -N` 路径验证）。
- apply 失败时工作区与 index 均无变化（哈希校验生效）。
- 提交含中文/多行 message 不乱码（`-F -` stdin 方式）。
- push 到未授权远端时错误信息完整可见且可重试；rebase 中断后可用命令条 `--abort` 恢复。
- 冲突文件能从 UI 解决到可提交，全程不用外部终端。

### Phase 4：语言智能

**目标**：补全与跳转可用，PHP 优先做到"日常够用"；模板文件至少不是记事本。

- `air-lsp` 宿主（spawn、Content-Length 分帧、双向转发、stderr 日志、崩溃退避重启、idle 回收、子进程归属 Job Object）
- TS 侧 Transport（invoke + event）+ 消息保序 + server→client 请求应答（`workspace/configuration`、`client/registerCapability`、`workspace/applyEdit`、`window/workDoneProgress/create`、`window/showDocument`）
- LanguageServerPool（按语言懒启动、切项目销毁、单语言故障隔离）
- ProjectProfile 识别 + root 推导（composer.json / go.mod / Cargo.toml / pyproject.toml / tsconfig.json，含多语言并存与扩展名兜底）
- **混合语法文件**：`.html` 模板标签装饰器、`.blade.php`（3.6.1）
- PHP 接入（PHPantom 全功能验证；phpactor 仅验证补全/跳转/诊断三项兜底能力）
- Go 接入与验证
- Python / Rust / TS 接入与验证
- 诊断渲染（波浪线、gutter 图标、Problems 面板、状态栏计数）
- 补全/hover/签名/定义/引用/重命名/格式化 UI 与键位
- 大纲面板（documentSymbol）+ 面包屑接 LSP
- **语言服务器管理面板**：探测（PATH/项目/bin/常见目录）、安装引导、内置下载与校验、手工指定路径、内存占用显示

**验收**：
- 五类语言各打开一个真实项目，各跑 20 个固定场景（补全/跳转/引用/诊断各 5 个）全部通过。
- 打开 FastAdmin 的 `.html` 模板，模板标签有独立配色，折叠与括号匹配正常。
- 杀掉某个语言服务器进程，编辑器不卡、状态栏 3s 内提示、可一键重启。
- 未安装任何 server 时，仍能高亮、折叠、大纲，状态栏显示"语法模式"，且管理面板能一键下载安装。
- 语言服务器内存单独可见（设置页显示各 server 占用）。

### Phase 5：稳定、性能与发布

- 错误边界与 panic hook、日志采集、崩溃记录（本地文件，不联网）
- 性能专项：对照 0.4 逐项达标（启动、内存、大文件、diff、搜索）
- 首次启动引导（欢迎页、打开项目、语言服务器安装指引、Git 缺失引导）
- 安装包（NSIS 按用户安装、最低系统校验、WebView2 bootstrapper、图标/版本信息）+ 便携版 zip（D10）
- **Windows 集成**：文件夹右键「用 Air IDE 打开」、文件关联（.php 等）、任务栏跳转列表、任务栏进度条与 Toast、Defender 排除提示；注册表只写 HKCU，卸载时清理（3.13）
- 未签名分发策略：首启提示文案、发布页校验哈希、便携版覆盖升级路径（D6）
- 自动更新（GitHub Releases + 静态 manifest + Minisign 更新包签名，与代码签名无关）
- 用户文档（快捷键表、Git 工作流、LSP 配置、模板文件说明）
- Win10 2004 与 Win11 双系统回归 + 安装/升级/卸载在非开发机验证
- E2E 用例补齐 + 全量手工回归

**验收**：
- 干净 **Win10 2004** 与 **Win11** 各一台机器上：双击安装 → 打开项目 → 看 diff → 提交，全程无阻塞错误。
- 安装包 ≤10MB；安装后占用 ≤60MB（不含数据目录）。
- 文件夹右键菜单、双击 `.php` 打开、任务栏跳转列表三项在全新用户账户下可用；卸载后 HKCU 无残留键。
- 固定操作脚本跑 100 次开关文件 + 20 次切分支，内存增长 <20MB。
- 8 小时操作脚本执行完，未捕获异常 0 起。

### 4.1 交付里程碑（阶段达标制）

不排日期，只排依赖。「达标」的定义是：本阶段验收项全过 + 自己已经在该场景里真实使用过。

| 里程碑 | 对应阶段 | 交付内容 | 此时能替代什么 |
|---|---|---|---|
| **M1** | P1 结束 | 文件树 + 编辑器 + 全局搜索 + 最小 diff | 「翻代码」与「`git diff` 命令」 |
| **M2** | P2 结束 | diff 完整（双栏、词级、已读、log、blame） | 「看改动的全部需求」 |
| **M3** | P3 结束 | Git 写入全套 + 冲突 + 命令条 + AI 导出 | 「PhpStorm 的 Git 面板」——此时可停用 PhpStorm |
| **M4** | P4 结束 | 语言智能 + 模板着色 + 服务器管理 | 「补全与跳转」 |
| **M5** | P5 结束 | 安装包 + 便携版 + 自动更新（GitHub Releases） | 「可安装可升级」 |

**比里程碑更重要的事：什么时候真的开始用它**

- M1-M2 期间不要指望全切。可行策略是**只读场景强制切换**：看代码、审 diff、查历史一律用 Air IDE，写代码仍用 PhpStorm。每天有真实使用，痛点暴露最快。
- M3 之后可以尝试整天不用 PhpStorm，但保留它作为兜底。
- 若 M2 之后连续一段时间里日均使用不足半小时，说明定位或体验有偏差——此时应停下来调整，而不是继续往下做 P4。

**取舍原则**：每个阶段开工前，先回答"我最近实际用了什么、缺什么"，用真实缺口决定 P4/P5 的内部优先级，而不是按目录闷头做。计划负责"做什么"，日用负责"先做哪个"。

---

## 5. 质量门禁

### 5.1 自动化

| 项 | 命令 | 门禁 |
|---|---|---|
| Rust 编译 | `cargo check --workspace --all-targets` | 0 warning |
| Rust lint | `cargo clippy -- -D warnings` | 必须通过 |
| Rust 测试 | `cargo test --workspace` | 全绿 |
| 前端类型 | `tsc --noEmit` | 0 error |
| 前端 lint | `eslint . --max-warnings 0` | 必须通过 |
| 前端测试 | `vitest` | 覆盖纯函数（diff 解析、patch 生成、键位解析、when 求值） |
| E2E（P2 起） | `tauri-driver` + WebdriverIO（或 Playwright 走 CDP） | 关键路径冒烟：打开项目 → 改文件 → 看 diff → 提交 |

**必须写单测的模块**（这几块出错就是数据事故）：
1. `air-git` 的 status / diff 解析器（用 fixture 仓库，含中文名、重命名、二进制、CRLF）。
2. hunk patch 生成与三种应用模式（含 `add -N`、`autocrlf` 三态）。
3. 键位 chord 解析与 `when` 表达式。
4. 编码探测（UTF-8 / GBK / BOM / 含非法字节）。
5. 大文件分级判定。
6. 外部修改三态决策与保存前复检（干净/脏/大文件/未决策时保存，纯函数可测）。
7. 模板标签装饰器的区间计算（`{$x}` / `{if}` / 嵌套 / 跨行）。

**E2E 的必要性**：IDE 的回归成本集中在"打开→改→看→提交"这条链上，纯手工跑一遍既慢又容易漏项。P2 起把这条链做成 Playwright 用例（5-8 个场景），每次 Phase 结束跑一次，能挡住绝大多数低级回归。

### 5.2 手工回归清单（每个 Phase 结束跑一遍）

- 打开含中文路径、中文文件名、GBK 文件的项目
- 打开含 CRLF 与 LF 混合的仓库，检查 diff 不误报
- `core.autocrlf` 分别为 true / false / input，各做一次 hunk 暂存
- 外部工具（脚本/编辑器）修改已打开文件：干净 tab 自动重载、脏 tab 弹三选一
- 打开 FastAdmin 的 `.html` 模板，模板标签有配色、折叠正常
- 10MB 文件、二进制文件、无权限文件
- 断网下 push / 无远端仓库
- 杀掉语言服务器进程
- 强杀应用后重启恢复
- 中文输入法连续输入 100 字不丢字、候选框不跑位
- **Win10 2004 与 Win11 各跑一遍**，差异记入 3.12 对应条目
- 300 字符长路径项目（`vendor` / `node_modules` 深层嵌套）
- `%USERPROFILE%` 含中文与空格的账户下完成安装 → 打开 → 提交
- 100% / 125% / 150% / 200% 缩放，窗口在两块不同 DPI 显示器间拖动
- 系统深色 ↔ 浅色主题来回切 3 次，检查标题栏与编辑器配色
- Defender 实时防护**开启**状态下打开 10k 文件项目（不得出现"假死"观感）
- 资源管理器文件夹右键「用 Air IDE 打开」、双击 `.php`、任务栏跳转列表
- 卸载后检查 HKCU 无残留（`Directory\shell`、`OpenWithProgids`、卸载项）

### 5.3 性能基准

脚本 `scripts/bench/`，用 PowerShell 采集：
- 冷启动：进程创建 → 首帧可交互（前端打点回传）
- 内存：递归汇总主进程 + `msedgewebview2` 子进程 WorkingSet
- 大文件打开、diff 渲染：前端 `performance.mark`
- 每 Phase 结束记录一次，回归 >15% 必须定位原因

**测量前提（必须写进记录）**：Defender 实时防护开启、机器不插电/插电状态、Win10 与 Win11 各采一组。三个条件没标注的数据不可比，也失去了"回归报警"的意义。

---

## 6. 风险登记册

| # | 风险 | 概率 | 影响 | 应对 | 触发条件 |
|---|---|---|---|---|---|
| R1 | WebView2 版本碎片导致渲染/IME 差异 | 中 | 高 | 安装包带 bootstrapper；启动检测版本；P0 就在目标机器实测 | 用户报"输入法候选框跑位/字体发虚" |
| R2 | 语言服务器缺失或版本不匹配，用户开箱不可用 | **高** | 高 | 三级探测 + **P4 必做的内置下载** + 安装引导卡片 + 降级到语法模式 + 手工指定路径 | 首次打开项目无补全 |
| R3 | PHP 语言智能达不到 PhpStorm 水平 | **高** | 中 | 预期管理写进文档与 README：只承诺补全/跳转/引用/诊断；PHPantom 优先（2s 就绪）；复杂类型推断与框架魔术方法不承诺 | 发现 Laravel/TP 魔术方法不提示 |
| R4 | hunk 级暂存把代码改坏 | 中 | **极高** | 回归矩阵（autocrlf 三态 × 7 类边界）作为门禁；apply 失败不落盘；操作后哈希校验不一致则回滚；未跟踪文件走 `add -N` 分支 | 出现"暂存后文件内容变了" |
| R5 | 大仓库 git status 慢（50k+ 文件） | 中 | 中 | 降级 `--untracked-files=normal` + 500ms 节流；必要时该热点换 `gix` | status >800ms |
| R6 | CM6 需自研的 UI 面积超预期（面包屑/minimap/sticky） | 中 | 中 | 面包屑必做（P1），minimap/sticky 明确可砍；不因"像 IDE"而拖慢核心 | P1 范围内开始追加计划外的 UI 细节 |
| R7 | Tauri 3.0 诱惑导致中途升级 | 低 | 中 | 锁 2.12，升级作为独立评估任务放 v1.1 | 有人提"升 3.0" |
| R8 | 范围失控（想法不断加进来） | **高** | 高 | 需求冻结 + "不做清单"写进 README；新想法进 backlog 不插队 | 同时开着 3 个以上本阶段之外的新特性 |
| R9 | 未签名导致每次新版本都被 SmartScreen 拦 | 中 | 低 | v1 只自用：便携版覆盖升级 + 文档写明放行路径；发布页给 SHA-256 便于校验；将来真分发再评估 OV/IV | 每次升级都要手动点「仍要运行」 |
| R10 | IPC 大 payload（大 diff）卡顿 | 中 | 中 | >2MB 走二进制通道 + 分片；diff 视图只渲染可见区 | 打开大 diff 时 UI 卡 >300ms |
| R11 | 外部工具改文件，覆盖掉未保存内容 | 中 | **极高** | 3.11 三态处理 + 写入抑制表 + 重载前哈希比对 + 保存前 mtime/hash 复检（双向防覆盖）；P1 验收必须覆盖 | 出现"我的改动被冲掉了" |
| R12 | 模板文件（.html 内嵌 PHP）体验差，被判"不如 PhpStorm" | **高** | 中 | 3.6.1 装饰器着色 + 能力边界写进 README；不承诺模板补全 | 打开模板发现无高亮 |
| R13 | Win10 与 Win11 行为差异（标题栏属性、圆角、DPI、任务栏） | **高** | 中 | 标题栏按 build 号分支 + 不支持则降级系统默认；两系统各一台机器标准化回归；不自绘标题栏把风险留在系统侧 | Win10 上标题栏发白/按钮不可见 |
| R14 | Defender 实时扫描让大仓库"看起来卡死" | 高 | 中 | 首次打开大项目时给出排除项提示（用户确认后执行）；基准数据必须标注防护状态；status 有超时降级（R5） | 10k 仓库首次 status >1.5s |
| R15 | 长路径 260 截断导致文件打不开、git 报错 | 中 | 中 | manifest 声明 longPathAware + `\\?\` 前缀 + 长路径提示 + `core.longpaths` 引导；P0 用 300 字符路径实测 | 用户报"文件树里能看到但打不开" |
| R16 | 主进程崩溃后语言服务器/git 变孤儿进程 | 中 | 中 | Job Object（`KILL_ON_JOB_CLOSE`）统一兜底，不靠按 PID 杀（PID 会复用）；进程管理器里可见的子进程数作为回归项 | 任务管理器里出现多份 `gopls`/`phpactor` |
| R17 | AI 工具批量改写几十个文件，status/diff 反复重算导致界面抖动 | 中 | 中 | 1s 事件合并 + status 300ms 防抖 + 只重算可见 diff + 大仓库降级 `--untracked-files=normal`；抖动期间状态栏显示"正在同步"而不是假装空闲 | 连续写入时滚动卡顿或 diff 闪烁 |

---

## 7. 决策记录

v1.2 起本节改为**记录式**：已定项不再重议，只登记结论与依据；犹豫的项统一推到 v1.1 的待办池（7.2），避免在 P0 前反复摇摆。

### 7.1 已定（不再重议）

| # | 决策 | 结论 | 依据 / 影响 |
|---|---|---|---|
| D1 | PHP 默认语言服务器 | **PHPantom**（MIT、~2s 就绪、Laravel/TP 友好）；phpactor 仅在下载失败时兜底；Intelephense 只作为自带授权用户的选项 | 全量索引 1.5 分钟不可接受 |
| D2 | 终端 | **只做 Git 命令条**，不做完整终端 | 覆盖 rebase 中断、stash、cherry-pick 等自救；跑 build/测试开外部终端 |
| D3 | minimap / sticky scroll | **v1 都不做** | CM6 无现成组件需自绘；对 10k 行以下文件收益低 |
| D4 | 编辑器分屏 | **v1 不做**（单编辑区） | 对比阅读用 Diff 视图即可；分屏要重做 tab 归属、焦点、会话恢复 |
| D5 | 主题 | **Darcula Dark + IntelliJ Light 两套，跟随系统深浅色** | 共用一套 CSS token；只做深色在强光环境下难用 |
| D6 | 代码签名证书 | **不采购**（只自用）。产物不签名，首次运行走"更多信息 → 仍要运行" | 2024 起 EV 已无"首次下载免警告"待遇，OV/IV 也要累积声誉；个人可申请 IV/OV 约 ¥2000-3500/年，但自用场景不值得。将来分发再评估 |
| D7 | AI 上下文导出（当前文件/选区/diff → 结构化 prompt） | **做**（放 P3） | 本产品的工作流是"AI 在外部写、人来审"，导出上下文是高频动作 |
| D8 | ThinkPHP 模板标签补全 | **不做**（v1.1 再评估） | 装饰器着色已解决可读性；补全是另一个量级 |
| D9 | 自动更新托管 | **GitHub Releases** + 静态 JSON manifest；下载失败降级为手动下载 | 零成本免运维；国内弱网问题用降级路径兜住，不在 v1 建 CDN |
| D10 | 便携版 zip | **出**（安装包 + zip 双产物） | 自用场景覆盖升级最省事，也绕开"每次装新版都被 SmartScreen 提示" |
| D11 | 文件关联是否抢默认 | **不抢**。只注册"打开方式"候选 + `OpenWithProgids` | 用户还在用 PhpStorm 写代码，抢默认等于给自己添堵 |
| D12 | 平台与架构 | Windows 10 2004+（19041）/ Windows 11，**仅 x64** | 单一构建目标；不做 mac/Linux/ARM64 兼容分支 |
| D13 | 标题栏方案 | **原生边框 + DWM 暗色**（Win11 属性 20 / Win10 属性 19），不支持则降级系统默认；不自绘 | 保留 Snap Layouts、窗口阴影、多显示器拖动；省下自绘窗口的交互实现与一类测不全的 bug |
| D14 | Git 运行时 | **检测系统 Git + 引导安装**，不内置、不自动下载 | 安装包维持 ≤10MB；用户侧一条 `winget` 命令 |
| D15 | Windows 集成范围 | 文件夹右键、文件关联、任务栏跳转列表、Defender 提示、任务栏进度条与 Toast——**全做** | 注册表只写 HKCU，卸载时清理 |
| D16 | 可移植性 | **权重 0**，零预留；将来做 macOS 版换技术栈另起项目 | 见 2.2.1 候选淘汰记录 |
| D17 | 保存策略 | **默认手动保存**（Ctrl+S）；「失焦自动保存」默认关、可配 | 审阅工作流下脏 tab 是常态，三态横幅（3.11）以「存在未保存改动」为前提；意外落盘比丢编辑更糟 |

### 7.2 延后到 v1.1（已登记，v1 不讨论）

| 项 | 为什么延后 |
|---|---|
| 编辑器分屏 / minimap / sticky scroll | 等 M2 之后日用一段时间，按真实缺失感排序 |
| 完整终端（portable-pty + ConPTY） | 等 P3 的 Git 命令条实际用一段时间再判断 |
| ARM64 构建 | 需真机回归；x64 已覆盖主要场景 |
| ThinkPHP / Blade 模板补全与跳转 | 着色已够读，补全属另一个量级工程 |
| 代码签名与自动分发（OV/IV） | 只自用不必要；真要分发时再评估，且需重新累积 SmartScreen 声誉 |
| macOS / Linux 版本 | 换技术栈另起项目，不在本项目内演进 |

---

## 附录 A：JetBrains 功能对照（做 / 不做）

| JetBrains 功能 | 本项目 |
|---|---|
| Project 视图、Tab、Breadcrumbs | 做 |
| 编辑器基础编辑、多光标、折叠 | 做 |
| Local Changes / Commit 工具窗 | 做（核心） |
| Diff（单栏/双栏、hunk 操作） | 做（核心） |
| Git Log / Blame / File History | 做 |
| 分支管理、Fetch/Pull/Push | 做 |
| 冲突解决 | 做（三栏，不做语法级智能合并） |
| 代码补全、跳转、引用、诊断、重命名、格式化 | 做（靠 LSP） |
| Problems / 大纲 | 做 |
| Find in Path（全局搜索） | 做 |
| Search Everywhere / Find Action | 做（合并为命令面板 + 快速打开） |
| 运行配置 / 调试器 | 不做 |
| 构建工具集成（Maven/Gradle/Composer scripts） | 不做 |
| 数据库 / HTTP Client / Docker | 不做 |
| 终端 | v1 不做；仅提供「Git 命令条」（输入 git 命令 + 流式输出） |
| 模板语言智能（ThinkPHP / Blade 标签补全与跳转） | 不做（只做标签着色与折叠） |
| 插件系统 / 市场 | 不做 |
| 远程开发 / WSL | 不做 |
| 多平台（macOS / Linux / ARM64） | 不做（v1 只做 Windows x64） |
| Windows 集成（文件夹右键 / 文件关联 / 跳转列表） | 做（HKCU，卸载时清理） |
| 重构（Extract/Inline/Move/Safe Delete） | 只做 Rename |
| 代码检查（Inspection 全家桶）/ 快速修复 | 不做（只有 LSP 诊断） |
| 覆盖率 / Profiler / UML / 依赖分析 | 不做 |
| 多窗口 / 分屏 | v1 不做 |
| 版本控制（SVN/Hg） | 不做 |
| AI 上下文导出（把文件/选区/diff 复制成结构化 prompt） | 做（只导出，不做 AI 对话与补全） |
| 主题市场 / 键位市场 | 不做（内置两套键位、两套主题） |

---

## 附录 B：目录与命名约定

| 项 | 约定 |
|---|---|
| 前端组件文件 | `PascalCase.tsx` |
| 前端非组件 | `camelCase.ts` |
| CSS Module | `Component.module.css` |
| Rust crate | `air-<domain>` |
| Tauri command | `域_动作`（`git_status`、`fs_read_file`） |
| 事件名 | `域://事件`（`git://progress`） |
| 命令 ID | `域.动作`（`git.commit`） |
| 设置键 | 点分小写（`editor.fontSize`） |

---

## 附录 C：P0 到 P1 开头的执行顺序

不排日期，只排先后。**每一步都有可验证结果，前一步没验证通过就不要开下一步**——P0 的全部意义就是把链路和平台坑一次性验完，返工成本在这里最低。

| # | 任务 | 可验证结果 |
|---|---|---|
| 1 | 建 workspace（pnpm + Cargo）、Tauri 2.12 init、Vite 8 + React 19 + TS strict、单实例插件；窗口配置、原生菜单、开发脚本 | `pnpm dev` 出窗口，菜单可点，二次启动聚焦已有实例 |
| 2 | tokens.css（Darcula 色板）、base.css、四区布局 + 可拖分割 | 静态骨架，肉眼像 IntelliJ |
| 3 | 工具窗语义（Alt+1/9、Esc 回编辑器）、状态栏 + 工具窗容器 | 焦点模型行为与 3.9.2 一致 |
| 4 | CM6 集成、Darcula 语法配色、打开/保存（编码 + 行尾 + BOM） | 编辑 PHP 并保存，GBK/BOM 保真 |
| 5 | 文件打开入口（菜单/命令行/最近项目）、IPC 封装、错误格式、大 payload 通道 | 前后端联调通，类型共享 |
| 6 | 基准脚本（启动/内存）、中文 IME spike、10MB 文件 spike | 拿到 P0 基准数据与结论 |
| 7 | **Windows 适配**：DWM 暗色标题栏 + 系统主题切换、高 DPI/多显示器、300 字符长路径、监听缓冲、Git 探测 | 3.12 六项各有结论，不留"以后再说" |
| 8 | 修 P0 验收缺口、跑完整验收 | 全部验收项通过（含 Windows 6 项），不达标不开 P1 |
| 9 | 文件树（懒加载 + 忽略规则 + 长路径）、文件图标 + 右键菜单 | 浏览 10k 文件项目不卡 |
| 10 | 多 tab 模型（拖拽/脏标记/预览 tab）、tab 关闭与切换焦点规则 | 多文件切换不丢状态 |
| 11 | 会话恢复 + 草稿落盘、崩溃恢复验证 | 强杀后重启内容还在 |
| 12 | 查找替换面板、快速打开（nucleo）+ 最近文件 | `Ctrl+F` / `Ctrl+Shift+N` / `Ctrl+E` |
| 13 | 全局搜索后端（ignore + grep）、搜索结果 UI（分组/流式追加） | 10k 文件项目首批结果 ≤300ms |

**为什么第 8 步是一道硬闸**：P0 若带着"标题栏在 Win10 发白""200% DPI 下光标偏移""长路径打不开"这类问题进 P1，后面每加一个面板都会把这些缺陷复制一遍。P0 不追求功能多，只追求"结论确定"。

---

## 附录 D：关键技术事实（2026-11 核实）

| 事实 | 影响 |
|---|---|
| Tauri 稳定线 2.12（2026-09），3.0 处于 alpha；2.12 的 MSRV 为 Rust 1.90 | 锁 2.x，不追新；环境用 Rust ≥1.90 |
| React 19.3（2026-09）、Vite 8.3（2026-10，要求 Node ≥22.12） | 脚手架用 latest，不写死小版本 |
| `@codemirror/lsp-client` 6.2.1，一个实例只支持一个语言服务器（作者 2026-07 确认） | 必须做 LanguageServerPool，按语言分实例 |
| PHPantom（Rust 实现的 PHP LSP）活跃，~2s 就绪、~578MB、MIT、Laravel 友好 | 作为 PHP 首选，phpactor 兜底 |
| phpactor 全量索引约 1.5 分钟（数据来自 PHPantom 官方 benchmark） | 不作默认，仅在 PHPantom 缺失时启用 |
| `git status --porcelain=v2 -z` 提供 staged/unstaged 双状态且免 quotepath 转义 | status 解析的唯一正确方式 |
| `git diff` 输出的是 index 中的形式；`autocrlf=true` 时与工作区行尾不一致 | patch 拼接必须按 index 形式，回归覆盖三态 |

### 环境前置（P0 开始前装齐）

| 项 | 要求 |
|---|---|
| 操作系统 | Windows 10 2004+（build 19041）或 Windows 11，x64；**准备两台机器/双系统用于双系统回归** |
| Rust | ≥ 1.90（Tauri 2.12 MSRV），target 固定 `x86_64-pc-windows-msvc` |
| Node | ≥ 22.12（Vite 8 要求） |
| pnpm | ≥ 11 |
| VS Build Tools | VS 2022 Build Tools，勾选「使用 C++ 的桌面开发」+ Windows 10/11 SDK（Rust MSVC 链接与资源编译都需要） |
| WebView2 Runtime | Win11 与近两年 Win10 已内置；开发机需确认已安装，且版本可查（`msedgewebview2.exe --version`） |
| Git for Windows | ≥ 2.30，且 `git.exe` 必须在 PATH（`--porcelain=v2 -z` 完整支持）；同时保留一个"PATH 里没有 git"的测试环境用于验证引导流程 |

---

*本文档为 v1 基线：只定义「做什么、按什么顺序做、怎么算做完」，不含时间与人力计划。每次阶段验收后更新验收状态、风险登记与「不做清单」；架构级变更另写 ADR 存 `docs/adr/`。*
