# Air IDE 用户文档

> 定位：给「AI 写代码、人来审阅」的工作流 —— 读代码、看 Git Diff、跑 Git 操作。
> 平台：Windows 10 2004（build 19041）/ Windows 11，仅 x64。

## 安装

1. 从发布页下载 NSIS 安装包（文件名形如 `Air IDE_<版本>_x64-setup.exe`）。
2. 双击安装。安装范围为「当前用户」，不需要管理员权限；默认装到用户目录。
3. 未做代码签名：若 SmartScreen 拦截，点「更多信息 → 仍要运行」。
4. 安装包会在需要时联网获取 WebView2 Runtime；若公司网络拦截，可先手动安装
   Microsoft Edge WebView2 Runtime 再启动。
5. 卸载：Windows「设置 → 应用 → 已安装的应用 → Air IDE」。

系统低于 Windows 10 2004 时，启动会直接提示版本不足并退出，不会进入界面。

## 首次启动

首次启动且没有历史工作区时，显示欢迎页和 3 步引导：

1. **打开项目**：点「打开文件夹…」选择一个目录作为工作区；之后也可以从
   「最近项目」重新打开。
2. **快捷键**：展示命令面板与常用键位（完整列表见下方）。
3. **语言服务器**：实时探测本机已安装的服务器。未安装的会列出安装提示；
   PHP 服务器（PHPantom）可直接点「一键下载」。下载失败会显示原因，
   也可以手动下载后放入 `%LOCALAPPDATA%\AirIDE\servers\` 再点「重新检测」。

点「跳过引导」或完成最后一步后，引导不再自动出现（标记保存在本地）。
下次启动会恢复上次的工作区与打开的标签页；没有工作区时仍会显示欢迎页，
但不再显示引导。

> 说明：文件夹拖入窗口目前未实现，请使用「打开文件夹…」。

## 首次配置

- **Git 身份**：首次提交时会弹出内联表单，填写 `user.name` / `user.email`，
  可选「仅此仓库」或「全局」。
- **设置窗口**：`Ctrl+Alt+S`。设置分四组（编辑器 / 外观 / Git / 系统），
  保存后写入 `settings.json`。
  - Git 组：默认 sign-off、Diff 默认忽略空白、默认双栏、status 刷新节流。
  - 系统组：单实例、自动更新、Defender 排除提示。
  - 注意：编辑器字号/行高、行号、主题等选项目前只是配置项，尚未全部接入
    编辑器渲染（界面固定为 Darcula Dark），见「已知限制」。

## 常用快捷键（JetBrains 键位，默认）

| 功能 | 键位 |
|---|---|
| 命令面板（Find Action） | `Ctrl+Shift+A` |
| 快速打开文件 | `Ctrl+Shift+N` |
| 最近文件（与快速打开同一面板） | `Ctrl+E` |
| 全局搜索 | `Ctrl+Shift+F` |
| Project 工具窗 | `Alt+1` |
| Git 工具窗 | `Alt+9` |
| 聚焦提交信息框 | `Ctrl+K` |
| 提交（在提交信息框中） | `Ctrl+Enter` |
| 保存 | `Ctrl+S` |
| 下一个 / 上一个改动（Diff 视图） | `F7` / `Shift+F7` |
| Git 命令条 | `Ctrl+Alt+G` |
| 设置 | `Ctrl+Alt+S` |
| 聚焦编辑器 | `Esc` |
| 隐藏当前工具窗 | `Shift+Esc` |

## 打开与审阅

- **快速打开**：`Ctrl+Shift+N`，空输入时列出前 20 个文件（按文件列表顺序，
  不是真实「最近打开」记录）；输入后做模糊匹配。
- **看改动**：右侧 Git 工具窗（`Alt+9`）按「冲突 / 未暂存 / 未跟踪 / 已暂存」
  分组，双击任一条目打开 Diff。
- **启动参数**：第一个命令行参数若是已存在的文件路径，会直接打开该文件。

## Diff 审阅工作流

- **双栏视图**：左本地（HEAD）、右工作区；同步滚动。
- **hunk 操作**：工具栏 `» 暂存` / `« 取消` / `✕ 丢弃`（作用于当前 hunk）。
  - 丢弃只影响工作区且不可撤销，执行前会确认。
  - apply 失败时不修改任何内容，会提示失败原因（git 原文）。
- **词级高亮**：同一行内的变更词会加深底色。
- **忽略空白差异**：工具栏 `-w`；PHP 项目格式化后的 diff 靠它归零。
- **折叠上下文**：工具栏「折叠」把未变更的上下文行收起。
- **已读进度**：工具栏显示 `已读 x / y`，浏览过的 hunk 自动标记（仅本次会话）。

## Git 写入

- **复选框**：Changes 列表的复选框即 stage/unstage（勾选 = `git add`）。
- **提交**：message 支持多行；`↑`/`↓` 复用最近提交信息；amend 与 sign-off
  是复选框。提交失败时展示 git 原文。
- **撤销上次提交**：`reset --soft HEAD~1`，改动保留在暂存区（会确认）。
- **分支**：点 Git 工具窗顶部分支名 → 切换/新建/删除；fetch/pull/push
  在同一菜单。
- **Git 命令条**（`Ctrl+Alt+G`）：跑任意 git 命令（如 `rebase --abort`、`stash`），
  流式输出不截断。为安全起见禁用 `clean`、`gc`、`prune`、`filter-branch`、
  `update-ref`、`symbolic-ref`。
- **Git 身份未配置**：首次提交会弹内联表单（user.name / user.email），
  可选「仅此仓库」或「全局」。

## 语言智能

- **懒启动**：首次打开某语言文件时才启动对应语言服务器，不拖慢启动。
- **未安装服务器**：编辑器自动降级为语法模式（语法高亮、折叠仍可用）。
  「语言服务器管理」面板会列出安装提示；未安装的语言不会启动进程。
- **PHP 一键下载**：欢迎页引导或命令面板搜「语言服务器管理」→ PHPantom
  「一键下载」。装到 `%LOCALAPPDATA%\AirIDE\servers\phpantom\`；
  下载源不可用或校验/解压失败时会显示具体原因。
- **其他语言**：按面板里的安装提示手动安装，装好后重新打开
  「语言服务器管理」（打开时会重新探测）或点引导里的「重新检测」。
  常见安装方式（仅供参考，以各项目官方文档为准）：

  | 语言 | 服务器 | 常见安装方式 |
  |---|---|---|
  | Go | gopls | `go install golang.org/x/tools/gopls@latest` |
  | Python | basedpyright | `pip install basedpyright` |
  | Rust | rust-analyzer | `rustup component add rust-analyzer` |
  | TS / JS | typescript-language-server | `npm i -g typescript-language-server typescript` |
  | C / C++ | clangd | 安装 LLVM 工具链（含 clangd） |
  | JSON / YAML / HTML / CSS / Markdown | vscode-langservers-extracted | `npm i -g vscode-langservers-extracted` |

  探测顺序：`PATH` → 常见目录（`~\.cargo\bin`、`~\go\bin`、`%APPDATA%\npm`）
  → `%LOCALAPPDATA%\AirIDE\servers\`。

## 文件与编码

- **编码**：状态栏点编码名（UTF-8 / GB18030 / UTF-16 LE / UTF-16 BE / Latin-1）→
  「重新解释」或「转换并保存」。
  - 「转换并保存」会把当前内容按新编码写回磁盘（内容不变、字节改变）。
  - 「重新解释」当前只做重新读取与可解析性校验，不会替换编辑器中的内容
    （见「已知限制」）。
- **行尾**：状态栏点 `CRLF` / `LF` 切换，选择后立即按新行尾写回磁盘；
  `Mixed` 表示文件混用，保存时统一归一为 LF。
- **外部修改**：AI 工具改文件后——干净 tab 自动重载；有未保存改动时弹三选一横幅
  （重新加载 / 保留我的 / 对比差异），**不会静默覆盖**。
  「对比差异」当前只关闭横幅，请用 Git 面板查看改动。
- **崩溃恢复**：重启后自动恢复上次工作区、打开的文件与未保存草稿
  （恢复的草稿会标记为未保存）。

## 故障排查

| 问题 | 处理 |
|---|---|
| 启动提示需要 Windows 10 2004 | 系统版本过低（需 build ≥ 19041），需升级系统 |
| 首次运行被 SmartScreen 拦截 | 未做签名：点「更多信息 → 仍要运行」 |
| 启动白屏 / 提示 WebView2 | 安装 Microsoft Edge WebView2 Runtime 后重试 |
| 文件打不开（深层目录） | 尝试开启系统长路径：注册表 `LongPathsEnabled=1`，重启后再试 |
| 大项目首次 status 慢 | Defender 实时扫描所致；项目列出条目较多时状态栏上方会出现排除项提示 |
| Git 相关功能不可用 | 需安装 Git for Windows ≥ 2.30 并在 `PATH` 中，安装后重启应用 |
| 语言服务器没反应 | `Ctrl+Shift+A` → 「语言服务器管理」查看安装/状态；停止后再打开文件重试 |
| 崩溃 / 界面错误 | 日志在 `%LOCALAPPDATA%\AirIDE\logs\`；界面错误可点「重新加载」 |

## 数据位置

| 数据 | 位置 |
|---|---|
| 设置 | `%APPDATA%\AirIDE\settings.json` |
| 会话 | `%APPDATA%\AirIDE\session.json` |
| 未保存草稿 | `%APPDATA%\AirIDE\drafts\` |
| 最近项目 | `%APPDATA%\AirIDE\recent.json` |
| 语言服务器 | `%LOCALAPPDATA%\AirIDE\servers\` |
| 日志 | `%LOCALAPPDATA%\AirIDE\logs\` |

## 已知限制（v1）

- 无终端 / 调试器 / 测试运行器（用外部工具）
- 无 AI 补全（AI 在外部写，本工具负责审阅）
- 无插件系统
- 未做代码签名：首次运行需「更多信息 → 仍要运行」
- ARM64 不支持（仅 x64）
- 不支持把文件夹拖入窗口；请用「打开文件夹…」
- 设置页中的主题、字号/行高、行号、当前行高亮、失焦保存、Defender 提示等选项
  目前未被启动流程读取（界面固定 Darcula Dark、行号固定开启；单实例常开、
  自动更新尚未接入）；大文件阈值仅返回标记，未强制关闭 LSP / 折叠 / 只读
- 「重新解释」编码未替换编辑器内容（需要转码请用「转换并保存」）
- 外部修改横幅的「对比差异」尚未接入文件级对比视图
