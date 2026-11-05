//! P0 IPC 命令与系统级辅助（日志、路径校验、DWM 标题栏、基准埋点）。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use air_core::{envelope, AirError, AirResult, BenchRecord};
use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crate::watcher;

pub struct AppState {
    pub initial_open: Mutex<Option<String>>,
    /// 写入抑制表（3.11）：自己保存的文件 500ms 内忽略监听事件
    pub watcher: watcher::WatcherState,
}

/// 启动对 root 的监听；事件经 200ms 合并后发 `fs://changed`，溢出发 `fs://rescan`（3.12.4）。
#[tauri::command]
pub fn fs_watch(app: tauri::AppHandle, root: String) -> Result<(), AirError> {
    let root_path = PathBuf::from(&root);
    if !root_path.exists() {
        return Err(AirError::other(format!("目录不存在: {root}")));
    }
    let (tx, rx) = std::sync::mpsc::channel::<watcher::WatchEvent>();
    let watcher = watcher::watch(&root_path, tx)?;
    // watcher 需保活：存入全局
    WATCHERS
        .lock()
        .unwrap()
        .get_or_insert_with(HashMap::new)
        .insert(root.clone(), watcher);

    // 合并线程：200ms 窗口内的变更合并为一次事件；溢出 → rescan 信号
    std::thread::spawn(move || {
        let mut pending: Vec<String> = Vec::new();
        let mut deadline: Option<std::time::Instant> = None;
        loop {
            let timeout = deadline
                .map(|d| d.saturating_duration_since(std::time::Instant::now()))
                .unwrap_or(std::time::Duration::from_millis(500));
            match rx.recv_timeout(timeout) {
                Ok(ev) => {
                    if ev.overflow {
                        // 放弃增量，全量重扫（3.12.4）
                        let _ = app.emit_to("main", "fs://rescan", serde_json::json!({ "root": root }));
                        pending.clear();
                        deadline = None;
                        continue;
                    }
                    for p in ev.paths {
                        let s = p.to_string_lossy().into_owned();
                        if !pending.contains(&s) {
                            pending.push(s);
                        }
                    }
                    deadline = Some(std::time::Instant::now() + std::time::Duration::from_millis(200));
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if !pending.is_empty() {
                        // 过滤抑制表中的路径（自己刚保存的）
                        let state = app.try_state::<AppState>();
                        let filtered: Vec<String> = pending
                            .iter()
                            .filter(|p| {
                                state
                                    .as_ref()
                                    .map(|s| !s.watcher.is_suppressed(std::path::Path::new(p)))
                                    .unwrap_or(true)
                            })
                            .cloned()
                            .collect();
                        if !filtered.is_empty() {
                            let _ = app.emit_to(
                                "main",
                                "fs://changed",
                                serde_json::json!({ "paths": filtered }),
                            );
                        }
                    }
                    pending.clear();
                    deadline = None;
                    // 定期清理过期抑制条目
                    if let Some(state) = app.try_state::<AppState>() {
                        state.watcher.gc();
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    Ok(())
}

/// 停止监听并清理抑制表。
#[tauri::command]
pub fn fs_unwatch(root: String) -> Result<(), AirError> {
    WATCHERS
        .lock()
        .unwrap()
        .as_mut()
        .map(|m| m.remove(&root));
    Ok(())
}

static WATCHERS: std::sync::Mutex<Option<HashMap<String, watcher::NotifyWatcher>>> =
    std::sync::Mutex::new(None);


fn data_dir() -> AirResult<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(|p| PathBuf::from(p).join("AirIDE"))
        .ok_or_else(|| AirError::other("LOCALAPPDATA 未设置"))
}

pub fn init_logging() {
    let dir =
        std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("AirIDE").join("logs"));
    if let Some(dir) = dir {
        let _ = std::fs::create_dir_all(&dir);
        let appender = tracing_appender::rolling::daily(&dir, "air-ide.log");
        tracing_subscriber::fmt()
            .with_ansi(false)
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
            )
            .with_writer(std::sync::Mutex::new(appender))
            .try_init()
            .ok();
    }
}

pub fn valid_path(arg: &str) -> Option<String> {
    let p = std::path::Path::new(arg);
    if p.exists() {
        Some(air_win::normalize_path(p).to_string_lossy().into_owned())
    } else {
        None
    }
}

pub fn apply_dark_titlebar(app: &tauri::App) {
    #[cfg(windows)]
    {
        if let Some(w) = app.get_webview_window("main") {
            match w.hwnd() {
                Ok(hwnd) => {
                    if let Err(e) = air_win::apply_dark_titlebar(hwnd.0 as isize, true) {
                        tracing::warn!("dark titlebar failed: {e}");
                    }
                }
                Err(e) => tracing::warn!("hwnd failed: {e}"),
            }
        }
    }
    #[cfg(not(windows))]
    let _ = app;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileMetaDto {
    path: String,
    encoding: String,
    eol: String,
    has_bom: bool,
    size: u64,
    is_binary: bool,
    is_large: bool,
}

fn eol_name(e: air_fs::EolKind) -> &'static str {
    match e {
        air_fs::EolKind::Lf => "lf",
        air_fs::EolKind::Crlf => "crlf",
        air_fs::EolKind::Mixed => "mixed",
    }
}

#[tauri::command]
pub async fn fs_read_file(path: String) -> Result<tauri::ipc::Response, AirError> {
    let p = PathBuf::from(&path);
    let result =
        tauri::async_runtime::spawn_blocking(move || -> Result<(FileMetaDto, Vec<u8>), AirError> {
            let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            let is_large = size > air_fs::READONLY_THRESHOLD;
            if air_fs::is_binary(&p)? {
                let meta = FileMetaDto {
                    path: p.to_string_lossy().into_owned(),
                    encoding: "binary".into(),
                    eol: "lf".into(),
                    has_bom: false,
                    size,
                    is_binary: true,
                    is_large: false,
                };
                return Ok((meta, Vec::new()));
            }
            let tf = air_fs::read_text(&p)?;
            let meta = FileMetaDto {
                path: p.to_string_lossy().into_owned(),
                encoding: tf.encoding.name().into(),
                eol: eol_name(tf.eol).into(),
                has_bom: tf.has_bom,
                size: tf.size,
                is_binary: false,
                is_large,
            };
            Ok((meta, tf.text.into_bytes()))
        })
        .await
        .map_err(|e| AirError::other(e.to_string()))??;

    let meta_json = serde_json::to_vec(&result.0).map_err(|e| AirError::other(e.to_string()))?;
    let bytes = envelope::encode(&meta_json, &result.1);
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn fs_write_file(
    app: tauri::AppHandle,
    path: String,
    text: String,
    encoding: String,
    eol: String,
    has_bom: bool,
) -> Result<(), AirError> {
    let enc = air_fs::EncodingKind::from_name(&encoding)
        .ok_or_else(|| AirError::other(format!("未知编码: {encoding}")))?;
    let eolk =
        air_fs::EolKind::from_name(&eol).ok_or_else(|| AirError::other(format!("未知行尾: {eol}")))?;
    let p = PathBuf::from(path);
    let p_for_suppress = p.clone();
    tauri::async_runtime::spawn_blocking(move || air_fs::write_text(&p, &text, enc, has_bom, eolk))
        .await
        .map_err(|e| AirError::other(e.to_string()))??;

    // 3.11 抑制表：登记本次写入，避免监听事件被当成"外部修改"
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(meta) = std::fs::metadata(&p_for_suppress) {
            if let Ok(mtime) = meta.modified() {
                state.watcher.suppress(&p_for_suppress, mtime, meta.len());
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn fs_list_dir(dir: String) -> Result<Vec<air_fs::TreeEntry>, AirError> {
    tauri::async_runtime::spawn_blocking(move || air_fs::list_dir(&PathBuf::from(dir)))
        .await
        .map_err(|e| AirError::other(e.to_string()))?
}

#[tauri::command]
pub async fn app_open_dialog(
    app: tauri::AppHandle,
    kind: String,
) -> Result<Option<String>, AirError> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel::<Option<tauri_plugin_dialog::FilePath>>();
    let builder = app.dialog().file();
    if kind == "folder" {
        builder.pick_folder(move |p| {
            let _ = tx.send(p);
        });
    } else {
        builder.pick_file(move |p| {
            let _ = tx.send(p);
        });
    }
    let received = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .map_err(|e| AirError::other(e.to_string()))?;
    match received {
        Some(fp) => {
            let path = fp
                .into_path()
                .map_err(|e| AirError::other(format!("dialog path: {e}")))?;
            Ok(Some(
                air_win::normalize_path(&path).to_string_lossy().into_owned(),
            ))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn app_take_initial_args(state: State<'_, AppState>) -> Option<String> {
    state.initial_open.lock().ok().and_then(|mut g| g.take())
}

#[tauri::command]
pub fn app_report_benchmark(metric: String, ms: f64, detail: Option<String>) -> Result<(), AirError> {
    let rec = BenchRecord {
        metric,
        ms,
        ts: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis().to_string())
            .unwrap_or_default(),
        detail,
    };
    let dir = data_dir()?;
    std::fs::create_dir_all(&dir)?;
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("bench.jsonl"))?;
    writeln!(f, "{}", serde_json::to_string(&rec).map_err(|e| AirError::other(e.to_string()))?)?;
    Ok(())
}

// ── P1：Git / 搜索 / 会话 / 设置 ──────────────────────────────

#[tauri::command]
pub async fn git_status(repo: String) -> Result<air_git::RepoStatus, AirError> {
    let root = PathBuf::from(repo);
    tauri::async_runtime::spawn_blocking(move || air_git::status(&root))
        .await
        .map_err(|e| AirError::other(e.to_string()))?
}

#[tauri::command]
pub async fn git_diff_file(
    repo: String,
    path: String,
    staged: bool,
) -> Result<air_git::FileDiff, AirError> {
    let root = PathBuf::from(repo);
    tauri::async_runtime::spawn_blocking(move || air_git::diff_file(&root, &path, staged))
        .await
        .map_err(|e| AirError::other(e.to_string()))?
}

/// 全局搜索取消令牌表（3.5 search_cancel）。
static SEARCH_CANCELS: std::sync::Mutex<Option<
    std::collections::HashMap<String, air_search::CancelToken>,
>> = std::sync::Mutex::new(None);

/// 全局搜索：流式事件 search://batch（每 100 条）+ 结束 search://done（3.5）。
#[tauri::command]
pub async fn search_query(
    app: tauri::AppHandle,
    query_id: String,
    root: String,
    pattern: String,
    regex: Option<bool>,
    case_sensitive: Option<bool>,
    whole_word: Option<bool>,
) -> Result<u32, AirError> {
    let opts = air_search::SearchOptions {
        pattern,
        regex: regex.unwrap_or(false),
        case_sensitive: case_sensitive.unwrap_or(false),
        whole_word: whole_word.unwrap_or(false),
        max_results: 10_000,
    };
    let root_path = PathBuf::from(root);
    let cancel = air_search::CancelToken::new();
    SEARCH_CANCELS
        .lock()
        .unwrap()
        .get_or_insert_with(std::collections::HashMap::new)
        .insert(query_id.clone(), cancel.clone());

    let qid = query_id.clone();
    let app_inner = app.clone();
    let count = tauri::async_runtime::spawn_blocking(move || {
        air_search::search_content(&root_path, &opts, &cancel, |batch| {
            let _ = app_inner.emit_to(
                "main",
                "search://batch",
                serde_json::json!({ "queryId": qid, "matches": batch }),
            );
        })
    })
    .await
    .map_err(|e| AirError::other(e.to_string()))??;

    let _ = app.emit_to(
        "main",
        "search://done",
        serde_json::json!({ "queryId": query_id, "total": count }),
    );
    // 清理取消令牌
    if let Some(map) = SEARCH_CANCELS.lock().unwrap().as_mut() {
        map.remove(&query_id);
    }
    Ok(count as u32)
}

/// 取消进行中的搜索（3.5：改词/关面板必须取消）。
#[tauri::command]
pub fn search_cancel(query_id: String) -> Result<(), AirError> {
    if let Some(map) = SEARCH_CANCELS.lock().unwrap().as_ref() {
        if let Some(token) = map.get(&query_id) {
            token.cancel();
        }
    }
    Ok(())
}

/// 快速打开用的全量文件列表（nucleo 匹配在前端做，Rust 只供数据）。
#[tauri::command]
pub async fn fs_collect_files(root: String, max: Option<usize>) -> Result<Vec<String>, AirError> {
    let root_path = PathBuf::from(root);
    tauri::async_runtime::spawn_blocking(move || {
        Ok(air_search::collect_files(&root_path, max.unwrap_or(20_000))
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect())
    })
    .await
    .map_err(|e| AirError::other(e.to_string()))?
}

// ── 会话 / 设置 / 草稿（3.10）──

#[tauri::command]
pub fn app_session_load() -> air_workspace::Session {
    air_workspace::load_session()
}

#[tauri::command]
pub fn app_session_save(session: air_workspace::Session) -> Result<(), AirError> {
    air_workspace::save_session(&session)
}

#[tauri::command]
pub fn app_settings_load() -> air_workspace::Settings {
    air_workspace::load_settings()
}

#[tauri::command]
pub fn app_settings_save(settings: air_workspace::Settings) -> Result<(), AirError> {
    air_workspace::save_settings(&settings)
}

#[tauri::command]
pub fn app_recent_projects() -> Vec<String> {
    air_workspace::load_recent_projects()
}

#[tauri::command]
pub fn app_push_recent(path: String) -> Result<(), AirError> {
    air_workspace::push_recent_project(&path)
}

#[tauri::command]
pub fn app_drafts_save(drafts: Vec<air_workspace::DraftWrite>) -> Result<Vec<bool>, AirError> {
    air_workspace::write_drafts(&drafts)
}

#[tauri::command]
pub fn app_drafts_load() -> Result<Vec<air_workspace::DraftWrite>, AirError> {
    air_workspace::read_all_drafts()
}

#[tauri::command]
pub fn app_draft_delete(path: String) -> Result<(), AirError> {
    air_workspace::delete_draft(&path)
}


// [[NEXT]]

