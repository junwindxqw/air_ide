// P5-3：分级日志 + 按大小轮转 + 最近日志内存缓冲。
// 日志落在用户数据目录（%LOCALAPPDATA%\AirIDE\logs），不进仓库。
use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use tracing_subscriber::fmt::writer::MakeWriter;
use tracing_subscriber::EnvFilter;

/// 单文件上限 5 MiB，超过即轮转。
const MAX_BYTES: u64 = 5 * 1024 * 1024;
/// 保留的历史文件份数（当前文件之外）。
const KEEP_ARCHIVES: usize = 4;
/// 崩溃记录里携带的最近日志条数。
const RECENT_CAP: usize = 30;
const RECENT_LINE_MAX: usize = 512;

static RECENT: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();

fn recent_store() -> &'static Mutex<VecDeque<String>> {
    RECENT.get_or_init(|| Mutex::new(VecDeque::with_capacity(RECENT_CAP)))
}

/// 用户数据目录；AIR_IDE_DATA_DIR 仅用于自检/测试隔离。
pub fn data_root() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("AIR_IDE_DATA_DIR") {
        return Some(PathBuf::from(dir));
    }
    std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("AirIDE"))
}

pub fn log_dir() -> Option<PathBuf> {
    data_root().map(|d| d.join("logs"))
}

/// 初始化全局日志；返回 false 表示无法确定日志目录（调用方可回退旧实现）。
pub fn init() -> bool {
    let Some(dir) = log_dir() else {
        return false;
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return false;
    }
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        // 默认只留本项目的 info，其余依赖压到 warn，避免第三方刷屏。
        EnvFilter::new(
            "warn,frontend=info,air_ide=info,air_lsp=info,air_git=info,air_fs=info,\
             air_search=info,air_workspace=info,air_core=info",
        )
    });
    let ok = tracing_subscriber::fmt()
        .with_ansi(false)
        .with_env_filter(filter)
        .with_writer(RotatingWriter::new(dir))
        .try_init()
        .is_ok();
    if ok {
        tracing::info!(version = env!("CARGO_PKG_VERSION"), "Air IDE 启动");
    }
    ok
}

/// 最近日志（供崩溃记录引用）。try_lock 避免在 panic 现场死锁。
pub fn recent_lines() -> Vec<String> {
    let Ok(guard) = recent_store().try_lock() else {
        return Vec::new();
    };
    guard.iter().cloned().collect()
}

fn record_lines(buf: &[u8]) {
    let Ok(text) = std::str::from_utf8(buf) else {
        return;
    };
    let Ok(mut guard) = recent_store().try_lock() else {
        return;
    };
    for line in text.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            continue;
        }
        let line: String = line.chars().take(RECENT_LINE_MAX).collect();
        if guard.len() == RECENT_CAP {
            guard.pop_front();
        }
        guard.push_back(line);
    }
}

/// 按大小轮转的文件写入器（实现 tracing 的 MakeWriter）。
#[derive(Clone)]
pub struct RotatingWriter {
    inner: Arc<Mutex<Inner>>,
}

struct Inner {
    dir: PathBuf,
    file: Option<File>,
    size: u64,
}

impl RotatingWriter {
    fn new(dir: PathBuf) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                dir,
                file: None,
                size: 0,
            })),
        }
    }
}

impl Inner {
    fn current_path(&self) -> PathBuf {
        self.dir.join("air-ide.log")
    }

    fn open(&mut self) -> io::Result<()> {
        let path = self.current_path();
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if size > MAX_BYTES {
            self.rotate()?;
        }
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        self.size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        self.file = Some(file);
        Ok(())
    }

    fn rotate(&mut self) -> io::Result<()> {
        self.file = None;
        // 先丢最旧的，再逐个后移，最后把当前文件挪成 1。
        let _ = std::fs::remove_file(self.dir.join(format!("air-ide.{KEEP_ARCHIVES}.log")));
        for i in (1..KEEP_ARCHIVES).rev() {
            let from = self.dir.join(format!("air-ide.{i}.log"));
            let to = self.dir.join(format!("air-ide.{}.log", i + 1));
            if from.exists() {
                let _ = std::fs::rename(from, to);
            }
        }
        let current = self.current_path();
        if current.exists() {
            let _ = std::fs::rename(&current, self.dir.join("air-ide.1.log"));
        }
        self.size = 0;
        self.open()
    }
}

impl Write for RotatingWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        record_lines(buf);
        let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if inner.file.is_none() {
            inner.open()?;
        }
        if inner.size + buf.len() as u64 > MAX_BYTES {
            inner.rotate()?;
        }
        if let Some(file) = inner.file.as_mut() {
            file.write_all(buf)?;
        }
        inner.size += buf.len() as u64;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(file) = inner.file.as_mut() {
            file.flush()?;
        }
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for RotatingWriter {
    type Writer = RotatingWriter;

    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

fn clip(input: &str, max: usize) -> String {
    input.chars().take(max).collect()
}

/// 前端异常上报（P5-3）：统一进日志，单条裁剪，避免刷屏。
#[tauri::command]
pub fn app_log_frontend_entry(
    level: String,
    message: String,
    detail: Option<String>,
    crash_id: Option<String>,
) -> Result<(), String> {
    let msg = clip(&message.replace('\n', "\\n"), 2000);
    let extra = clip(
        &detail.unwrap_or_default().replace('\n', "\\n"),
        4000,
    );
    let id = crash_id.unwrap_or_default();
    match level.to_ascii_lowercase().as_str() {
        "error" => tracing::error!(target: "frontend", crash_id = %id, "{msg} {extra}"),
        "warn" => tracing::warn!(target: "frontend", crash_id = %id, "{msg} {extra}"),
        "debug" => tracing::debug!(target: "frontend", crash_id = %id, "{msg} {extra}"),
        _ => tracing::info!(target: "frontend", crash_id = %id, "{msg} {extra}"),
    }
    Ok(())
}

/// 打开日志目录（ErrorBoundary 提供入口），返回实际路径。
#[tauri::command]
pub fn app_open_log_dir() -> Result<String, String> {
    let dir = log_dir().ok_or_else(|| "无法确定日志目录".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.to_string_lossy().replace('/', "\\");
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开资源管理器失败：{e}"))?;
    }
    Ok(path)
}

/// 当前时间（UTC，定宽格式，可直接按字典序比较）。
pub fn now_utc() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format_utc(secs)
}

fn format_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (hour, minute, second) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Howard Hinnant 的 civil_from_days
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utc_format_is_fixed_width() {
        // 2000-01-01T00:00:00Z
        assert_eq!(format_utc(946_684_800), "2000-01-01T00:00:00Z");
        assert_eq!(format_utc(1_767_225_600), "2026-01-01T00:00:00Z");
    }

    #[test]
    fn rotates_by_size_and_keeps_archive_limit() {
        let dir = std::env::temp_dir().join(format!("air-ide-log-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut writer = RotatingWriter::new(dir.clone());
        let chunk = vec![b'x'; 1024 * 1024];
        // 写 10 MiB，必然会跨过 5 MiB 上限并触发轮转。
        for _ in 0..10 {
            writer.write_all(&chunk).unwrap();
        }
        let files: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert!(files.len() <= 1 + KEEP_ARCHIVES, "归档数量超限: {files:?}");
        assert!(dir.join("air-ide.log").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
