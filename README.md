# Air IDE

面向「AI 写代码、人来审阅」工作流的 Windows 桌面编辑器：读代码、看 Git Diff、跑 Git 操作，
界面与快捷键偏 JetBrains 风格。前端 React + CodeMirror 6，桌面壳与文件/Git/语言服务器能力由 Rust（Tauri 2）提供。

## 功能概览

- 文件树、标签页、快速打开（`Ctrl+Shift+N`）、全局搜索（`Ctrl+Shift+F`）
- 双栏 Diff：hunk 级暂存/取消/丢弃、词级高亮、忽略空白、折叠上下文、已读进度
- Git：stage/unstage、提交（amend / sign-off）、撤销上次提交、分支切换/新建/删除、fetch/pull/push、Git 命令条
- 语言服务器：按语言懒启动，未安装时降级为语法模式；PHP 服务器支持一键下载
- 编码/行尾切换（含 GB18030）、外部修改三态提示、崩溃后草稿恢复
- 首次启动 3 步引导（打开项目 / 快捷键 / 语言服务器），可跳过且不再自动出现

## 安装与使用

从发布页下载 NSIS 安装包（`Air IDE_<版本>_x64-setup.exe`）双击安装；未签名，
SmartScreen 拦截时选「更多信息 → 仍要运行」。

系统要求：Windows 10 2004（build 19041）或 Windows 11，仅 x64。
首次打开后点「打开文件夹…」选择项目即可开始。

完整说明（首次配置、快捷键、语言服务器安装、常见问题）见 [用户文档](docs/USER_GUIDE.md)。

## 本地开发

需要：Node.js + pnpm、Rust 稳定版工具链、WebView2 Runtime。

```powershell
pnpm install        # 安装前端依赖
pnpm dev            # tauri dev（前端热更新 + Rust 侧）
pnpm check          # tsc --noEmit + eslint + vitest
pnpm build          # 打包 NSIS 安装包
```

目录结构：

- `apps/desktop`：前端（`src/`）与 Tauri 壳（`src-tauri/`）
- `crates/`：Rust 能力库（fs / git / lsp / search / workspace / win）
- `docs/`：用户文档与开发计划
