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

## Phase 1：阅读编辑 + 最小 diff（2026-11-05 完成）

### 交付物

| 模块 | 内容 |
|---|---|
| 前端 IPC 层 | `ipc/git.ts`（status/diff）、`ipc/search.ts`（流式+cancel）、`ipc/session.ts`（会话/设置/草稿/最近项目）、`ipc/watch.ts`（fs://changed + fs://rescan） |
| `features/explorer` | 文件树（懒加载、忽略规则、右键菜单：新建/重命名/删除/复制路径/资源管理器显示、自动定位） |
| `features/editor` | 多 tab（预览 tab 单例复用、脏标记、拖拽排序、溢出下拉、关闭焦点回上一下访问）、缩进参考线 ViewPlugin、编码/行尾切换（重新解释 vs 转换并保存）、外部修改三态横幅 |
| `features/command` | 命令面板（Ctrl+Shift+A）+ fuzzy 匹配 + Ctrl+Shift+N/E/F、Ctrl+Alt+S 注册 |
| `features/search` | 快速打开（nucleo 思路前端匹配）+ 全局搜索面板（流式分组、正则/大小写/整词、300ms 防抖、取消在途） |
| `features/settings` | 设置页（3.14 四组清单 + 导入导出 + schemaVersion） |
| `features/git` | Changes 面板（status 分组、分支 ahead/behind）+ 只读 unified diff 视图 |
| Rust 新增 | fs_create/fs_rename/fs_delete/fs_reveal、git_status/git_diff_file、search_query/search_cancel、fs_collect_files、fs_watch/fs_unwatch、session/settings/drafts/recent 全套命令 |
| 测试 | 新增 vitest 19（fuzzy 6 + tabs 10 + registry 3）、P1 冒烟 11、Rust 累计 27 |

### 冒烟结果（11/11）

文件树渲染（node_modules 过滤）✓、懒加载展开 ✓、多 tab 预览语义 ✓、固定 tab ✓、命令面板 ✓、快速打开 ✓、全局搜索流式分组 ✓、git status 解析 ✓、git diff 解析 ✓、干净 tab 外部修改自动重载 ✓。

### 发现的问题与修复

| # | 问题 | 根因 | 修复 |
|---|---|---|---|
| 1 | 目录点击永不展开 | air-fs `TreeEntry` 漏 `#[serde(rename_all = "camelCase")]`，`is_dir` 到前端变 `is_dir`，TS 读 `isDir` 得 undefined → 目录被判为文件 | 补 rename；**教训：跨 IPC 的 DTO 必须显式 camelCase，已列为代码审查点** |
| 2 | 树路径键不匹配（`D:/x\src` 混分隔符） | Rust `read_dir` 子路径用 OS 分隔符拼接待定路径 | `list_dir` 与 `fs_read_file` 统一输出正斜杠 |
| 3 | 打开文件不产生 tab | store.openFile 只设 pending，漏了 tabs store 注册 | openFile 中枢联动 openFile(path, meta, preview) |
| 4 | 预览 tab 该替换时不替换 | 排除条件写错（排除了活跃 tab） | IntelliJ 单预览 tab 语义：未脏预览 tab 一律替换（单测锁定） |
| 5 | 全局 tsc 7.0.2 不接受 `--noEmit` | npx 解析到全局新版 | 统一走 `./node_modules/.bin/tsc` |

### P1 验收对照（方案 Phase 1 验收项）

| 验收项 | 状态 |
|---|---|
| 打开 10k 文件项目树首次展开 ≤200ms | 未测（10k 夹具），2000 文件列表 21ms（P0 数据），P5 补 10k 基准 |
| 全局搜索首批 ≤300ms | 流式实现就绪；冒烟验证功能通过，耗时未精确测量（P5 基准） |
| 强杀后未保存内容恢复 | 草稿 IPC 已就绪；**会话恢复仅恢复了 tab 未接草稿内容合并**（见遗留） |
| 20 个常用操作可经命令面板触达 | 11 个命令注册（P1 子集达标） |
| Changes 面板可替代 `git diff` 命令 | 达标（status + 单文件 diff） |
| 外部工具改文件三态处理 | 干净自动重载 ✓；脏 tab 横幅 ✓（UI 已交付） |

### 遗留事项（进 P2/P5）

1. **草稿与会话恢复合并**：恢复时 textCache 优先于磁盘，但崩溃后草稿内容未在 restoreSession 中并入（P2 补：drafts.load → 按 path 进 textCache + 标脏）。
2. **查找替换面板**：CM6 `@codemirror/search` 已装，JetBrains 样式自绘面板未做（P2 补，属编辑器细节）。
3. **面包屑**：P1 未交付（P2 与大纲一并做）。
4. **10k 文件基准**：P5 性能专项统一测。

## Phase 2：Diff 完整化（2026-11-05 完成）

### 交付物

| 模块 | 内容 |
|---|---|
| `features/git/SplitDiff` | 双栏 diff：两个只读 CM6 + 双向同步滚动 + filler 行对齐；行级着色（line decoration）+ 词级高亮（mark decoration）；F7/Shift+F7 导航 + 当前 hunk 计数；已读进度（x/y）；上下文折叠（连续纯上下文行合并占位）；-w 开关；Esc 关闭 |
| `features/git/wordDiff` | 词级 diff 纯函数：公共前缀/后缀裁剪 + LCS 字符对齐 + **词边界扩展**（100→200 标整个数字） |
| `features/git/LogView` | Git Log：分页（100/页）、作者/时间/refs、简化分支图列 |
| `features/git/openDiff` | 全局 diff 浮层 store（SplitDiff 从面板内提出，供双击/测试桥/hunk 操作共用） |
| air-git 扩展 | `diff_file_with_opts`（-w）、`log`（分页）、`blame`（line-porcelain 解析） |
| 草稿闭环 | 编辑防抖 1s 落盘 → 崩溃恢复进 textCache 标脏 → 保存成功删草稿 |
| 测试 | wordDiff 8、Rust 累计 32（log/blame/-w 自包含集成测试）、P2 冒烟 9 |

### 冒烟结果（9/9）

双栏 diff 打开（2 栏 2 实例）✓、行级着色 ✓、词级高亮（10 add / 8 del marks）✓、F7 导航 + 已读 ✓、折叠上下文 ✓、-w 后 hunk 归零 ✓、Log 视图 ✓、Esc 关闭 ✓。

### 发现的问题与修复

| # | 问题 | 根因 | 修复 |
|---|---|---|---|
| 1 | 正则 `/[\p{L}\p{N}_$]/` 不匹配数字/字母 | **缺 `u` 标志**，`\p{...}` 退化为字面字符类 | 补 `u` 标志；测试先挂后修，正是单测的价值 |
| 2 | 词级高亮只标 `1`→`2` 不标 `100`→`200` | 字符级 LCS 不过词边界 | 加词边界扩展（标识符/数字/中文算词） |
| 3 | 集成测试依赖共享 fixture，互相污染 | 外部可变状态 | 改为测试内自建临时仓库（4 个用例各自 setup） |
| 4 | -w 冒烟用例失败 | 夹具设计错：写入的"纯空白"版仍含真实代码变更 | 先 commit 修改版，再只加行尾空格（unstaged diff 才是纯空白） |
| 5 | HMR 使 CDP 测试状态丢失 | 编辑 main.tsx 触发 vite 热更新 | 测试前重启 app（冒烟脚本开头加注意） |

### P2 验收对照（方案 Phase 2 验收项）

| 验收项 | 状态 |
|---|---|
| 10k 文件仓库 status 刷新 ≤250ms | 未测（P5 基准专项） |
| 2000 行 diff ≤120ms / 滚动 60fps / 双栏同步 ≤1 行 | 功能验证通过；精确耗时未测（P5） |
| 中文名/重命名/二进制/CRLF/无末尾换行正确显示 | 解析器单测覆盖（P1 fixture）；重命名/无末尾换行的**渲染**未专门验证（P3 hunk 操作时一并覆盖） |
| 忽略空白开关让"仅格式化"diff 归零 | 达标（冒烟 + 集成测试双重验证） |
| F7 连续跳转焦点/滚动正确 | 冒烟验证通过 |

### 遗留事项（进 P3/P5）

1. **blame 已实现但未接 UI**：Rust 命令就绪，前端 blame gutter/悬浮卡片 P3 补（先做 Git 写入，blame 属只读增强）。
2. **文件历史**（`git log -- <path>`）P3 与 blame 一并做 UI。
3. **双栏同步误差 ≤1 行的精确测量**：P5 基准。
4. **查找替换面板**（CM6 search 自绘 JetBrains 样式）仍未做，继续推迟到 P3（编辑器细节不影响 Git 主线）。
