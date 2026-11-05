//! P0 IPC 命令与系统级辅助（日志、路径校验、DWM 标题栏、基准埋点）。

use std::path::PathBuf;
use std::sync::Mutex;

use air_core::{envelope, AirError, AirResult, BenchRecord};
use serde::Serialize;
use tauri::{Manager, State};

pub struct AppState {
    pub initial_open: Mutex<Option<String>>,
}

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
    path: String,
    text: String,
    encoding: String,
    eol: String,
    has_bom: bool,
) -> Result<(), AirError> {
    let enc = air_fs::EncodingKind::from_name(&encoding)
        .ok_or_else(|| AirError::other(format!("未知编码: {encoding}")))?;
    let eolk = air_fs::EolKind::from_name(&eol)
        .ok_or_else(|| AirError::other(format!("未知行尾: {eol}")))?;
    let p = PathBuf::from(path);
    tauri::async_runtime::spawn_blocking(move || air_fs::write_text(&p, &text, enc, has_bom, eolk))
        .await
        .map_err(|e| AirError::other(e.to_string()))?
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

