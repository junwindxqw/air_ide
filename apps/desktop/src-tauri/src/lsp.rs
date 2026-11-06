//! LSP IPC 命令（2.5/2.6）：启动/发送/停止会话、服务器探测、ProjectProfile 识别。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use air_core::AirError;
use air_lsp::session::{Host, SessionEvent, SessionState};
use air_lsp::{probe_server, ProbeResult, ServerKind};
use serde::Serialize;
use tauri::{Emitter, Manager, State};

/// 全局 Host（按语言管理会话）。
pub struct LspState {
    host: Mutex<Host>,
    /// language → 事件转发线程的发送端（Session Reader 线程用）
    tx: Mutex<HashMap<String, std::sync::mpsc::Sender<SessionEvent>>>,
}

impl LspState {
    pub fn new() -> Self {
        Self {
            host: Mutex::new(Host::new()),
            tx: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for LspState {
    fn default() -> Self {
        Self::new()
    }
}

/// 服务器探测结果（管理面板用）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub language: String,
    pub display_name: String,
    pub installed: bool,
    pub path: Option<String>,
    pub install_hint: String,
    pub running: bool,
}

/// 扫描全部已知服务器的安装状态（2.6 三级策略第一级）。
#[tauri::command]
pub fn lsp_servers_scan(state: State<'_, LspState>) -> Vec<ServerInfo> {
    let host = state.host.lock().unwrap_or_else(|e| e.into_inner());
    let running: Vec<String> = host
        .status()
        .into_iter()
        .filter(|(_, r, _)| *r)
        .map(|(lang, _, _)| lang)
        .collect();

    let kinds = [
        ServerKind::Phpantom,
        ServerKind::Gopls,
        ServerKind::Basedpyright,
        ServerKind::RustAnalyzer,
        ServerKind::TypescriptLanguageServer,
        ServerKind::Clangd,
        ServerKind::VscodeLangserversExtracted,
    ];
    kinds
        .iter()
        .map(|kind| {
            let (installed, path) = match probe_server(*kind) {
                ProbeResult::Installed(p) => (true, Some(p.to_string_lossy().into_owned())),
                ProbeResult::Missing => (false, None),
            };
            ServerInfo {
                language: kind.language().to_string(),
                display_name: kind.display_name().to_string(),
                installed,
                path,
                install_hint: kind.install_hint().to_string(),
                running: running.iter().any(|l| l == kind.language()),
            }
        })
        .collect()
}

/// 启动（或复用）某语言的会话。消息经 `lsp://message` 事件转发（保序，不合并）。
#[tauri::command]
pub fn lsp_start(
    app: tauri::AppHandle,
    state: State<'_, LspState>,
    language: String,
    root: String,
) -> Result<u32, AirError> {
    // 已在运行：直接复用
    {
        let host = state.host.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((_, true, _)) = host.status().into_iter().find(|(l, _, _)| *l == language) {
            if let Some(s) = host.session_id_of(&language) {
                return Ok(s as u32);
            }
        }
    }

    let (sender, receiver) = std::sync::mpsc::channel::<SessionEvent>();
    let stored_sender = sender.clone();
    let session_id = {
        let mut host = state.host.lock().unwrap_or_else(|e| e.into_inner());
        host.ensure(&language, &PathBuf::from(&root), sender)?
    };

    // 转发线程：Session 事件 → 前端事件（保序）
    let app2 = app.clone();
    let lang2 = language.clone();
    std::thread::spawn(move || {
        while let Ok(ev) = receiver.recv() {
            match ev {
                SessionEvent::Message(msg) => {
                    let _ = app2.emit_to(
                        "main",
                        "lsp://message",
                        serde_json::json!({ "language": lang2, "payload": msg }),
                    );
                }
                SessionEvent::State(s) => {
                    let label = match s {
                        SessionState::Starting => "starting",
                        SessionState::Running => "running",
                        SessionState::Stopped => "stopped",
                        SessionState::Failed => "failed",
                    };
                    let _ = app2.emit_to(
                        "main",
                        "lsp://state",
                        serde_json::json!({ "language": lang2, "state": label }),
                    );
                    if s == SessionState::Stopped {
                        if let Some(state) = app2.try_state::<LspState>() {
                            let mut host = state.host.lock().unwrap_or_else(|e| e.into_inner());
                            host.note_crash(&lang2);
                        }
                    }
                }
                SessionEvent::Stderr(line) => {
                    let _ = app2.emit_to(
                        "main",
                        "lsp://stderr",
                        serde_json::json!({ "language": lang2, "line": line }),
                    );
                }
            }
        }
    });

    state
        .tx
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(language, stored_sender);
    Ok(session_id as u32)
}

/// 发送消息（前端 → 服务器）。消息是完整 JSON 文本（含 Content-Length 由 Rust 补）。
#[tauri::command]
pub fn lsp_send(
    state: State<'_, LspState>,
    session_id: u32,
    message: String,
) -> Result<(), AirError> {
    let mut host = state.host.lock().unwrap_or_else(|e| e.into_inner());
    host.send(session_id as u64, &message)
}

/// 停止某语言的会话（管理面板的停止按钮）。
#[tauri::command]
pub fn lsp_stop(state: State<'_, LspState>, language: String) -> Result<(), AirError> {
    let mut host = state.host.lock().unwrap_or_else(|e| e.into_inner());
    host.stop(&language);
    Ok(())
}

/// idle 回收（3.14：默认 10 分钟；启动时与定时调用）。
#[tauri::command]
pub fn lsp_reap_idle(state: State<'_, LspState>, idle_minutes: Option<u32>) -> Result<(), AirError> {
    let mut host = state.host.lock().unwrap_or_else(|e| e.into_inner());
    host.reap_idle(idle_minutes.unwrap_or(10) as u64);
    Ok(())
}

/// 全部停止（退出时）。
#[tauri::command]
pub fn lsp_stop_all(state: State<'_, LspState>) -> Result<(), AirError> {
    let mut host = state.host.lock().unwrap_or_else(|e| e.into_inner());
    host.stop_all();
    Ok(())
}

/// 项目语言画像（3.6）：标记文件命中即定，否则扩展名统计兜底。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProfile {
    pub languages: Vec<String>,
    pub root: String,
    /// 命中方式：marker / extension
    pub source: String,
}

const MARKER_FILES: &[(&str, &str)] = &[
    ("composer.json", "php"),
    ("go.mod", "go"),
    ("Cargo.toml", "rust"),
    ("pyproject.toml", "python"),
    ("setup.py", "python"),
    ("requirements.txt", "python"),
    ("tsconfig.json", "typescript"),
];

const EXT_LANG: &[(&str, &str)] = &[
    ("php", "php"),
    ("go", "go"),
    ("rs", "rust"),
    ("py", "python"),
    ("ts", "typescript"),
    ("tsx", "typescript"),
    ("js", "javascript"),
    ("jsx", "javascript"),
    ("c", "c"),
    ("cpp", "cpp"),
    ("h", "cpp"),
    ("json", "json"),
    ("yaml", "yaml"),
    ("yml", "yaml"),
    ("html", "html"),
    ("css", "css"),
    ("md", "markdown"),
];

/// 识别项目语言画像（3.6）。多语言仓库返回多个（top-2 且占比 >15%）。
#[tauri::command]
pub fn project_profile(root: String) -> ProjectProfile {
    let root_path = PathBuf::from(&root);

    // 1. 标记文件（权重最高，命中即定）
    let mut langs: Vec<String> = Vec::new();
    for (file, lang) in MARKER_FILES {
        if root_path.join(file).exists() && !langs.contains(&lang.to_string()) {
            langs.push(lang.to_string());
        }
    }
    if !langs.is_empty() {
        return ProjectProfile {
            languages: langs,
            root,
            source: "marker".into(),
        };
    }

    // 2. 扩展名统计兜底（限深扫描，尊重 .gitignore）
    let mut counts: HashMap<String, u32> = HashMap::new();
    let mut total = 0u32;
    let walker = ignore::WalkBuilder::new(&root_path)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .parents(true)
        .require_git(false)
        .max_depth(Some(3))
        .build();
    for entry in walker {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let Some(ext) = entry.path().extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if let Some((_, lang)) = EXT_LANG.iter().find(|(e, _)| *e == ext) {
            *counts.entry(lang.to_string()).or_insert(0) += 1;
            total += 1;
        }
    }
    let mut ranked: Vec<(String, u32)> = counts.into_iter().collect();
    ranked.sort_by_key(|a| std::cmp::Reverse(a.1));
    langs = ranked
        .into_iter()
        .take(2)
        .filter(|(_, c)| total == 0 || (*c as f32 / total as f32) > 0.15)
        .map(|(l, _)| l)
        .collect();

    ProjectProfile {
        languages: langs,
        root,
        source: "extension".into(),
    }
}

/// 一键下载语言服务器（2.6 第三级，P5-1）。当前仅 PHPantom。
/// 下载 → sha256 强校验（失败 fail-closed）→ 解压落盘到 servers 目录。
#[tauri::command]
pub async fn lsp_install_server(language: String) -> Result<String, AirError> {
    let source = match language.as_str() {
        "php" => air_lsp::download::DownloadSource::PhpantomWinX64,
        other => {
            return Err(AirError::Lsp(format!(
                "暂不支持一键下载 {other} 的服务器（请按安装提示手动安装）"
            )))
        }
    };
    let exe = tauri::async_runtime::spawn_blocking(move || air_lsp::download::install(source))
        .await
        .map_err(|e| AirError::other(e.to_string()))??;
    Ok(exe.to_string_lossy().into_owned())
}
