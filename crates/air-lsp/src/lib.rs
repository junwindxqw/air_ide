//! air-lsp：语言服务器进程宿主（2.5）+ 服务器注册表（2.6）。
//! 职责边界：**只做带帧的管道**——spawn、Content-Length 分帧、双向转发、
//! stderr 落日志、崩溃退避重启、idle 回收。不解析 LSP 语义（那是 TS 侧客户端的活）。
//!
//! 安全设计：spawn 处的程序名是编译期字面量（见 session.rs 的逐分支 match），
//! 由操作系统按 PATH 解析；启动参数同样来自字面量。全程不经 shell。

pub mod session;

use std::io::{BufRead, Write};
use std::path::PathBuf;

use air_core::{AirError, AirResult};

/// 服务器注册表（2.6）：语言 → 可执行文件/参数/安装提示。
/// 所有命令字符串都是静态的，不接受前端传入（防注入）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ServerKind {
    Phpantom,
    Gopls,
    Basedpyright,
    RustAnalyzer,
    TypescriptLanguageServer,
    Clangd,
    VscodeLangserversExtracted,
}

impl ServerKind {
    /// 前端传来的语言 ID → 服务器类型。
    pub fn from_language(lang: &str) -> Option<Self> {
        match lang {
            "php" => Some(Self::Phpantom),
            "go" => Some(Self::Gopls),
            "python" => Some(Self::Basedpyright),
            "rust" => Some(Self::RustAnalyzer),
            "typescript" | "javascript" => Some(Self::TypescriptLanguageServer),
            "c" | "cpp" => Some(Self::Clangd),
            "json" | "yaml" | "html" | "css" | "markdown" => {
                Some(Self::VscodeLangserversExtracted)
            }
            _ => None,
        }
    }

    pub fn language(self) -> &'static str {
        match self {
            Self::Phpantom => "php",
            Self::Gopls => "go",
            Self::Basedpyright => "python",
            Self::RustAnalyzer => "rust",
            Self::TypescriptLanguageServer => "typescript",
            Self::Clangd => "cpp",
            Self::VscodeLangserversExtracted => "json",
        }
    }

    /// 可执行文件名（PATH 查找或已安装的绝对路径由探测层提供）。
    pub fn program(self) -> &'static str {
        match self {
            Self::Phpantom => "phpantom",
            Self::Gopls => "gopls",
            Self::Basedpyright => "basedpyright-langserver",
            Self::RustAnalyzer => "rust-analyzer",
            Self::TypescriptLanguageServer => "typescript-language-server",
            Self::Clangd => "clangd",
            Self::VscodeLangserversExtracted => "vscode-json-language-server",
        }
    }

    /// 显示名。
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Phpantom => "PHPantom (PHP)",
            Self::Gopls => "gopls (Go)",
            Self::Basedpyright => "basedpyright (Python)",
            Self::RustAnalyzer => "rust-analyzer (Rust)",
            Self::TypescriptLanguageServer => "typescript-language-server (TS/JS)",
            Self::Clangd => "clangd (C/C++)",
            Self::VscodeLangserversExtracted => "vscode-langservers-extracted",
        }
    }

    /// 启动参数（静态注册表，root 由 current_dir 设置）。
    pub fn args(self) -> Vec<String> {
        match self {
            Self::Phpantom => vec!["--stdio".into()],
            Self::Gopls => vec!["serve".into()],
            Self::Basedpyright => vec!["--stdio".into()],
            Self::RustAnalyzer => vec![],
            Self::TypescriptLanguageServer => vec!["--stdio".into()],
            Self::Clangd => vec![],
            Self::VscodeLangserversExtracted => vec!["--stdio".into()],
        }
    }

    /// 安装提示（用户手动安装时展示，2.6 三级策略的第二级）。
    /// 注意：只作人话说明，不含可执行命令文本（具体命令见用户文档）。
    pub fn install_hint(self) -> &'static str {
        match self {
            Self::Phpantom => "在管理面板一键下载，或从 PHPantom 官方 release 页面获取后放入 servers 目录",
            Self::Gopls => "通过 Go 工具链全局安装 gopls（详见用户文档）",
            Self::Basedpyright => "通过 pip 安装 basedpyright（详见用户文档）",
            Self::RustAnalyzer => "通过 rustup 添加 rust-analyzer 组件",
            Self::TypescriptLanguageServer => "通过 npm 全局安装 typescript-language-server",
            Self::Clangd => "安装 LLVM 工具链（含 clangd）",
            Self::VscodeLangserversExtracted => "通过 npm 全局安装 vscode-langservers-extracted",
        }
    }
}

/// 探测结果（2.6 三级策略第一级）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProbeResult {
    /// 已安装：可执行文件绝对路径
    Installed(PathBuf),
    /// 未安装
    Missing,
}

/// 探测某个服务器的可执行文件（2.6）：PATH → 常见安装目录 → 内置 servers 目录。
pub fn probe_server(kind: ServerKind) -> ProbeResult {
    let program = kind.program();
    let exe_name = if cfg!(windows) {
        format!("{program}.exe")
    } else {
        program.to_string()
    };

    // 1. PATH
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(&exe_name);
            if candidate.is_file() {
                return ProbeResult::Installed(candidate);
            }
        }
    }

    // 2. 常见安装目录
    let mut common: Vec<PathBuf> = Vec::new();
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        let profile = PathBuf::from(profile);
        common.push(profile.join(r".cargo\bin"));
        common.push(profile.join(r"go\bin"));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        common.push(PathBuf::from(appdata).join("npm"));
    }
    for dir in common {
        let candidate = dir.join(&exe_name);
        if candidate.is_file() {
            return ProbeResult::Installed(candidate);
        }
    }

    // 3. 内置 servers 目录（管理面板下载的目标）
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let servers = PathBuf::from(local).join("AirIDE").join("servers");
        if let Ok(entries) = std::fs::read_dir(&servers) {
            for entry in entries.flatten() {
                let candidate = entry.path().join(&exe_name);
                if candidate.is_file() {
                    return ProbeResult::Installed(candidate);
                }
            }
        }
    }

    ProbeResult::Missing
}

/// Content-Length 分帧读取（LSP 基座协议）。返回 None 表示流结束。
pub fn read_frame(reader: &mut impl BufRead) -> AirResult<Option<String>> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let n = reader
            .read_line(&mut line)
            .map_err(|e| AirError::Lsp(format!("读取帧头失败: {e}")))?;
        if n == 0 {
            return Ok(None); // EOF
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break; // 头部结束
        }
        if let Some(v) = trimmed.strip_prefix("Content-Length:") {
            content_length = v.trim().parse::<usize>().ok();
        }
    }
    let len = content_length.ok_or_else(|| AirError::Lsp("帧缺少 Content-Length".into()))?;
    let mut buf = vec![0u8; len];
    reader
        .read_exact(&mut buf)
        .map_err(|e| AirError::Lsp(format!("读取帧体失败: {e}")))?;
    String::from_utf8(buf)
        .map_err(|_| AirError::Lsp("帧体不是 UTF-8".into()))
        .map(Some)
}

/// 把消息封装为 Content-Length 帧。
pub fn write_frame(writer: &mut impl Write, message: &str) -> AirResult<()> {
    write!(writer, "Content-Length: {}\r\n\r\n", message.len())
        .map_err(|e| AirError::Lsp(format!("写帧头失败: {e}")))?;
    writer
        .write_all(message.as_bytes())
        .map_err(|e| AirError::Lsp(format!("写帧体失败: {e}")))?;
    writer
        .flush()
        .map_err(|e| AirError::Lsp(format!("flush 失败: {e}")))?;
    Ok(())
}

// [[NEXT]]

// [[NEXT]]
