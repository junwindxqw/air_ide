// P5-3：崩溃记录、运行标记与 panic hook。
// 纯标准库 + serde_json，不新增依赖；写入 %LOCALAPPDATA%\AirIDE\crashes。
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{json, Value};

use crate::log;

/// panic 时的明确退出码（与 Rust 默认 101 保持一致）。
pub const EXIT_PANIC: i32 = 101;
/// 启动失败（run 返回 Err）的退出码。
pub const EXIT_STARTUP_FAILURE: i32 = 1;
const KEEP_CRASH_FILES: usize = 20;
const BACKTRACE_MAX_LINES: usize = 40;
static IN_HOOK: AtomicBool = AtomicBool::new(false);

fn data_root() -> Option<PathBuf> {
    log::data_root()
}

fn crash_dir() -> Option<PathBuf> {
    data_root().map(|d| d.join("crashes"))
}

fn marker_path() -> Option<PathBuf> {
    data_root().map(|d| d.join("running.json"))
}

fn short_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mix = (nanos as u64) ^ ((std::process::id() as u64) << 32);
    format!("{:08x}", mix ^ 0x9e37_79b9_7f4a_7c15)
}

fn compact_stamp() -> String {
    log::now_utc()
        .replace(['-', ':', 'T', 'Z'], "")
}

fn clip(input: &str, max: usize) -> String {
    input.chars().take(max).collect()
}

/// 裁剪 backtrace：只留顶部若干帧，避免崩溃文件过大。
fn trim_backtrace(backtrace: &str) -> String {
    let lines: Vec<&str> = backtrace.lines().take(BACKTRACE_MAX_LINES).collect();
    clip(&lines.join("\n"), 4096)
}

/// 写一条崩溃记录，返回文件路径。任何失败都静默返回 None（崩溃路径本身不能再崩）。
fn write_report(
    kind: &str,
    message: &str,
    location: Option<&str>,
    thread: Option<&str>,
    backtrace: Option<&str>,
) -> Option<PathBuf> {
    let dir = crash_dir()?;
    std::fs::create_dir_all(&dir).ok()?;
    let crash_id = short_id();
    let time = log::now_utc();
    let record = json!({
        "crashId": crash_id,
        "kind": kind,
        "time": time,
        "version": env!("CARGO_PKG_VERSION"),
        "thread": thread.unwrap_or("main"),
        "location": location,
        "message": clip(message, 4000),
        "backtrace": backtrace.map(trim_backtrace),
        "recentLogs": log::recent_lines(),
        "logDir": log::log_dir().map(|d| d.to_string_lossy().to_string()),
    });
    let path = dir.join(format!("crash-{}-{crash_id}.json", compact_stamp()));
    let body = serde_json::to_string_pretty(&record).ok()?;
    std::fs::write(&path, body).ok()?;
    trim_crash_files(&dir);
    Some(path)
}

/// 崩溃记录只保留最近 N 份。
fn trim_crash_files(dir: &Path) {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("crash-") && n.ends_with(".json"))
                .unwrap_or(false)
        })
        .collect();
    if files.len() <= KEEP_CRASH_FILES {
        return;
    }
    files.sort();
    let excess = files.len() - KEEP_CRASH_FILES;
    for old in files.into_iter().take(excess) {
        let _ = std::fs::remove_file(old);
    }
}

fn recent_crash_marker(dir: &Path, not_before: Option<&str>) -> Option<(PathBuf, Value)> {
    let mut candidates: Vec<(String, PathBuf, Value)> = Vec::new();
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let time = value.get("time").and_then(|v| v.as_str()).unwrap_or("");
        if let Some(floor) = not_before {
            // 定宽 UTC 时间可直接字典序比较
            if !time.is_empty() && time < floor {
                continue;
            }
        }
        candidates.push((time.to_string(), path, value));
    }
    candidates.sort_by(|a, b| a.0.cmp(&b.0));
    candidates.pop().map(|(_, path, value)| (path, value))
}

/// 启动：识别上次异常退出 → 提示 → 写入本次运行标记。
pub fn begin_run() {
    let Some(root) = data_root() else {
        return;
    };
    let _ = std::fs::create_dir_all(root.join("crashes"));

    if let Ok(marker) = std::fs::read_to_string(root.join("running.json")) {
        let previous: Value = serde_json::from_str(&marker).unwrap_or(Value::Null);
        let started = previous.get("startedAt").and_then(|v| v.as_str());
        let crashes = root.join("crashes");
        let latest = recent_crash_marker(&crashes, started);
        let crash_key = latest
            .as_ref()
            .and_then(|(_, v)| v.get("crashId").and_then(|x| x.as_str()))
            .unwrap_or("-")
            .to_string();
        let mut lines = vec!["上次运行没有正常退出。".to_string()];
        match latest {
            Some((path, value)) => {
                let id = value.get("crashId").and_then(|v| v.as_str()).unwrap_or("-");
                let time = value.get("time").and_then(|v| v.as_str()).unwrap_or("-");
                let msg = value
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("（无详细信息）");
                lines.push(format!("时间：{time}"));
                lines.push(format!("崩溃 ID：{id}"));
                lines.push(format!("崩溃记录：{}", path.display()));
                lines.push(format!("摘要：{}", clip(msg, 300)));
            }
            None => {
                lines.push("未找到崩溃记录（可能是强制结束、断电或系统重启）。".to_string());
            }
        }
        if let Some(dir) = log::log_dir() {
            lines.push(format!("日志目录：{}", dir.display()));
        }
        lines.push(String::new());
        lines.push("关闭此提示后正常继续；上述路径可在资源管理器打开。".to_string());
        tracing::warn!(crash_id = %crash_key, "上次运行异常退出");
        show_prompt(&lines.join("\n"));
    }

    // 原子写入本次标记（先写临时文件再改名，避免断电留下半截 JSON）。
    let marker = root.join("running.json");
    let temp = root.join("running.json.tmp");
    let body = json!({
        "version": env!("CARGO_PKG_VERSION"),
        "startedAt": log::now_utc(),
        "pid": std::process::id(),
        "logDir": log::log_dir().map(|d| d.to_string_lossy().to_string()),
    })
    .to_string();
    if std::fs::write(&temp, body).is_ok() {
        let _ = std::fs::rename(&temp, &marker);
    }
}

/// 正常退出：清除运行标记。
pub fn mark_clean_exit() {
    if let Some(path) = marker_path() {
        let _ = std::fs::remove_file(path);
        tracing::info!("Air IDE 正常退出");
    }
}

/// run 返回 Err：按启动失败记一条崩溃记录。
pub fn record_startup_failure(error: &str) {
    write_report("startup-failure", error, None, Some("main"), None);
}

/// 安装 panic hook：写崩溃记录 → 明确退出码 → 进程退出。
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // hook 内再次 panic 时直接放过，避免递归。
        if IN_HOOK.swap(true, Ordering::SeqCst) {
            return;
        }
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "非字符串 panic payload".to_string());
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()));
        let thread = std::thread::current().name().map(|n| n.to_string());
        let message = match &location {
            Some(loc) => format!("{payload}（位置 {loc}）"),
            None => payload,
        };
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        let written = write_report(
            "panic",
            &message,
            location.as_deref(),
            thread.as_deref(),
            Some(&backtrace),
        );

        // 无控制台也保留一份，便于调试构建观察。
        eprintln!("Air IDE 崩溃：{message}");
        previous(info);
        match written {
            Some(path) => eprintln!("崩溃记录：{}", path.display()),
            None => eprintln!("崩溃记录写入失败（日志目录不可用）"),
        }
        std::process::exit(EXIT_PANIC);
    }));
}

/// 调试构建自检：设置 AIR_IDE_PANIC_SELFTEST 后启动即触发一次真实 panic。
pub fn debug_panic_selftest() {
    #[cfg(debug_assertions)]
    if std::env::var_os("AIR_IDE_PANIC_SELFTEST").is_some() {
        panic!("P5-3 panic hook 自检：构造的崩溃，仅用于验证崩溃记录");
    }
}

#[cfg(windows)]
fn show_prompt(text: &str) {
    use windows::core::HSTRING;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONWARNING, MB_OK};
    unsafe {
        let _ = MessageBoxW(
            None,
            &HSTRING::from(text),
            &HSTRING::from("Air IDE 上次未正常退出"),
            MB_OK | MB_ICONWARNING,
        );
    }
}

#[cfg(not(windows))]
fn show_prompt(text: &str) {
    eprintln!("{text}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_crash_record_to_data_dir() {
        let dir = std::env::temp_dir().join(format!("air-ide-crash-test-{}", short_id()));
        std::env::set_var("AIR_IDE_DATA_DIR", &dir);
        let path = write_report(
            "unit-test",
            "测试崩溃记录",
            Some("crash.rs:1:1"),
            Some("test"),
            Some("backtrace-line-1\nbacktrace-line-2"),
        )
        .expect("应写入崩溃记录");
        let text = std::fs::read_to_string(&path).expect("应能读取崩溃记录");
        let value: Value = serde_json::from_str(&text).expect("应是合法 JSON");
        assert_eq!(value["kind"], "unit-test");
        assert!(value["crashId"].as_str().unwrap_or("").len() >= 8);
        assert!(value["backtrace"].as_str().unwrap().contains("backtrace-line-2"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
