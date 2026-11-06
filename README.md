# Air IDE

面向「AI 写代码、人来审阅」工作流的 Windows 桌面编辑器：读代码、看 Git Diff、跑 Git 操作，
界面与快捷键偏 JetBrains 风格。前端 React + CodeMirror 6，桌面壳与文件/Git/语言服务器能力由 Rust（Tauri 2）提供。

当前版本：**0.2.1**（即将发布；线上最新为 0.2.0）。

## 功能概览

- 文件树、标签页、快速打开（`Ctrl+Shift+N`）、全局搜索（`Ctrl+Shift+F`）
- 双栏 Diff：hunk 级暂存/取消/丢弃、词级高亮、忽略空白、折叠上下文、已读进度
- Git：stage/unstage、提交（amend / sign-off）、撤销上次提交、分支切换/新建/删除、fetch/pull/push、Git 命令条
- Git 冲突解决界面：逐块选择本地/远端/两者保留，可手动编辑，保存并暂存
- 语言服务器：按语言懒启动；未安装时降级为语法模式；PHP 服务器支持一键下载
- 大文件降级：超过 2MB 关闭 LSP 与折叠，超过 10MB 只读（阈值可在设置中调整）
- 编码/行尾切换（含 GB18030）、外部修改三态提示（可打开 Git Diff 对比）、崩溃后草稿恢复
- Windows 集成：文件夹右键「用 Air IDE 打开」、文件「打开方式」候选、跳转列表、任务栏进度、系统通知、Defender 提示
- 首次启动 3 步引导（打开项目 / 快捷键 / 语言服务器），可跳过且不再自动出现
- 应用内更新：启动静默检查、下载进度、Minisign 验签、被动安装并重启（仅安装版）

## 下载与安装

从 GitHub Releases 下载：

- 最新版：<https://github.com/junwindxqw/air_ide/releases/latest>（当前为 0.2.0）
- 0.2.1：即将发布（发布后 `releases/latest` 会自动指向）
- 0.2.0：<https://github.com/junwindxqw/air_ide/releases/tag/v0.2.0>

发布资产（GitHub 会把文件名中的空格显示为点）：

| 资产 | 用途 |
|---|---|
| `Air.IDE_<版本>_x64-setup.exe` | NSIS 安装包（当前用户安装，无需管理员权限） |
| `Air.IDE_<版本>_x64-portable.zip` | 便携版，解压即运行 |
| `*.sig` | Minisign 签名，供安装包/便携包核对 |
| `latest.json` | 应用内更新清单 |
| `release-manifest.json` | 安装包与便携包的 URL / 大小 / SHA-256 / 签名 |

**安装版**：双击 `setup.exe` 安装。升级安装会保留 `%APPDATA%\AirIDE` 下的设置、会话与草稿。

**便携版**：解压到任意目录，双击 `Air IDE.exe`。不写注册表、不建快捷方式、不注册卸载项；
但配置/会话/日志仍写入 `%APPDATA%\AirIDE` 与 `%LOCALAPPDATA%\AirIDE`（与安装版共用），
要彻底清理需手动删除这两个目录。升级需退出后解压新版本覆盖 exe。

**系统要求**：Windows 10 2004（build 19041）或 Windows 11，仅 x64。
安装包会在需要时联网获取 WebView2 Runtime；便携版不会自动安装 WebView2，缺失时需先手动安装
Microsoft Edge WebView2 Runtime。

安装包与便携包均**未做 Authenticode 代码签名**：首次运行可能被 SmartScreen 拦截，
选择「更多信息 → 仍要运行」。更新包的 Minisign 验签是强制的，签名不符不会安装。

## 应用内更新

设置 →「更新」：

- 启动后静默检查新版本（默认开启，不自动安装，失败不弹窗、不阻塞启动）；
- 「检查更新」手动检查；
- 发现新版本后点「下载并安装」，显示下载进度；
- 下载完成后校验 Minisign 签名，通过后以 **passive 模式** 运行 NSIS 安装器，
  应用退出并由安装器重启；
- 失败会显示分类（网络 / 签名 / 平台 / 环境）与处理建议，不会静默吞错。

更新源为 `https://github.com/junwindxqw/air_ide/releases/latest/download/latest.json`，
需要能访问 GitHub（国内网络可能需要代理）。**便携版不自动更新**，请从 Releases 手动下载新 zip 覆盖。

实现细节与密钥管理见 [docs/UPDATER.md](docs/UPDATER.md)。

## 已知限制

- 未做 Authenticode 代码签名：SmartScreen 提示「未知发布者」，企业环境可能被策略拦截；
  更新包的 Minisign 签名只保护更新链路，不改变安装包的发布者身份。
- 便携版没有应用内更新；若在便携版中触发更新，可能安装成 NSIS 版（见 UPDATER 风险说明）。
- 应用内更新与 WebView2 安装都需要联网；无法访问 GitHub 时只能手动下载。
- 仅提供 x64 构建，不支持 ARM64。
- Git 功能需要安装 Git for Windows（建议 ≥ 2.30 且在 `PATH` 中）。
- 便携版的跳转列表/任务栏通知依赖 Windows 任务栏注册，尚未实机验证（需确认）。
- 编辑器的部分设置项（文件树自动定位、Git 组、单实例开关）当前仅保存、未实际生效，
  详见用户文档「已知限制」。

完整说明（安装、首次配置、快捷键、语言服务器、Windows 集成、常见问题）见
[用户文档](docs/USER_GUIDE.md)。

## 本地开发

需要：Node.js 22 + pnpm、Rust 稳定版工具链、WebView2 Runtime。

```powershell
pnpm install        # 安装依赖
pnpm dev            # tauri dev（前端热更新 + Rust 侧）
pnpm check          # tsc --noEmit + eslint + vitest
pnpm test:release   # 发布脚本（资产名/清单）单测
pnpm build          # tauri build：产出 NSIS 安装包（不生成便携 zip、不签名）
pnpm --filter desktop release:win   # 完整发布：签名 + 便携 zip + latest.json + release-manifest.json
```

构建产物在仓库根 `target/` 下（不是 `apps/desktop/src-tauri/target/`）：

- NSIS：`target/release/bundle/nsis/`（`pnpm build` 即可产出）
- 便携 zip：`target/release/bundle/portable/`（由 `release:win` 在缺失时调用
  `scripts/install/make-portable.ps1` 生成）
- 签名、`latest.json`、`release-manifest.json`：`target/release/updater/v<版本>/`

目录结构：

- `apps/desktop`：前端（`src/`）与 Tauri 壳（`src-tauri/`）
- `crates/`：Rust 能力库（fs / git / lsp / search / workspace / win）
- `docs/`：用户文档、测试基线、更新说明与开发日志
