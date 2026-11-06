//! P5-6 Windows 集成：跳转列表、任务栏进度、系统通知、Defender 真实状态、
//! 资源管理器集成开关。Win32 细节全部在 air-win，这里只做状态聚合与 IPC。

use std::collections::HashMap;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use air_core::{AirError, AirResult};
use serde::Serialize;

use air_win::taskbar::{JobProgress, TaskbarDisplay};

static HWND: AtomicIsize = AtomicIsize::new(0);

fn clock() -> &'static Instant {
    static CLOCK: OnceLock<Instant> = OnceLock::new();
    CLOCK.get_or_init(Instant::now)
}

fn now_ms() -> u64 {
    clock().elapsed().as_millis() as u64
}

struct Job {
    progress: JobProgress,
    value: u64,
    total: u64,
    #[allow(dead_code)]
    label: String,
}

static JOBS: Mutex<Option<HashMap<String, Job>>> = Mutex::new(None);
static LAST_APPLIED: Mutex<Option<TaskbarDisplay>> = Mutex::new(None);

fn with_jobs<R>(f: impl FnOnce(&mut HashMap<String, Job>) -> R) -> R {
    let mut guard = JOBS.lock().unwrap_or_else(|e| e.into_inner());
    f(guard.get_or_insert_with(HashMap::new))
}

/// 启动：记录主窗口句柄、刷新跳转列表、起任务栏聚合线程。
/// 资源管理器集成不自动注册（用户可在设置页手动启用）。
pub fn init(app: &tauri::AppHandle) {
    #[cfg(windows)]
    {
        use tauri::Manager;
        if let Some(w) = app.get_webview_window("main") {
            match w.hwnd() {
                Ok(h) => HWND.store(h.0 as isize, Ordering::SeqCst),
                Err(e) => tracing::warn!("获取窗口句柄失败，任务栏进度/通知将降级: {e}"),
            }
        }
    }
    #[cfg(not(windows))]
    let _ = app;

    refresh_jump_list_sync();
    spawn_taskbar_ticker();
}

fn spawn_taskbar_ticker() {
    std::thread::spawn(|| loop {
        std::thread::sleep(std::time::Duration::from_millis(120));
        apply_taskbar_now();
    });
}

/// 根据所有活动任务计算任务栏状态；只在状态变化时写 Win32。
fn apply_taskbar_now() {
    let hwnd = HWND.load(Ordering::SeqCst);
    if hwnd == 0 {
        return;
    }
    let now = now_ms();
    let display = with_jobs(|jobs| {
        let mut any_shown = false;
        let mut indeterminate = false;
        let mut value = 0u64;
        let mut total = 0u64;
        for job in jobs.values_mut() {
            if job.progress.update(now, job.value, job.total).is_some() {
                // 状态机已到展示阈值；具体展示值由聚合计算统一给出
            }
            if job.progress.is_shown() {
                any_shown = true;
            }
            if job.total == 0 {
                indeterminate = true;
            } else {
                value += job.value.min(job.total);
                total += job.total;
            }
        }
        if jobs.is_empty() {
            Some(TaskbarDisplay::Clear)
        } else if !any_shown {
            // 仅短任务：不显示，并确保不残留旧进度条
            Some(TaskbarDisplay::Clear)
        } else if indeterminate {
            Some(TaskbarDisplay::Indeterminate)
        } else {
            Some(TaskbarDisplay::Normal { value, total })
        }
    });

    let Some(display) = display else { return };
    let mut last = LAST_APPLIED.lock().unwrap_or_else(|e| e.into_inner());
    if last.as_ref() == Some(&display) {
        return;
    }
    if let Err(e) = air_win::taskbar::apply_taskbar(hwnd, display) {
        tracing::debug!("任务栏进度写入失败: {e}");
        return;
    }
    *last = Some(display);
}

/// 供前端在自动更新安装前主动清标记：Tauri updater 在 Windows 上直接
/// `process::exit`，`RunEvent::Exit` 不会触发，否则下次启动会误弹「上次未正常退出」。
#[tauri::command]
pub fn app_clear_running_marker() -> AirResult<()> {
    crate::crash::mark_clean_exit();
    Ok(())
}

// ── 运行标记防护（P5-3 marker 归 crash.rs 所有，这里只读并做存活判断） ──

/// 旧 marker 的 pid 是否仍存活：存活则跳过「上次未正常退出」弹窗。
/// 当前进程自身不算（避免误判）。
pub fn should_skip_crash_prompt(
    previous_pid: Option<u32>,
    current_pid: u32,
    alive: bool,
) -> bool {
    matches!(previous_pid, Some(pid) if pid != 0 && pid != current_pid) && alive
}

/// 启动前调用：若 marker 里的 pid 仍存活（并发启动/更新重启），删除旧 marker，
/// 让随后的 `crash::begin_run()` 直接写入新标记、不弹误报弹窗。
pub fn prepare_running_marker() {
    let Some(root) = crate::log::data_root() else {
        return;
    };
    let marker = root.join("running.json");
    let Ok(text) = std::fs::read_to_string(&marker) else {
        return;
    };
    let previous_pid = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v.get("pid").and_then(|p| p.as_u64()))
        .map(|p| p as u32);
    let current_pid = std::process::id();
    let alive = previous_pid
        .filter(|p| *p != current_pid && *p != 0)
        .map(air_win::process_alive)
        .unwrap_or(false);
    if should_skip_crash_prompt(previous_pid, current_pid, alive) {
        let _ = std::fs::remove_file(&marker);
        tracing::info!(
            pid = previous_pid.unwrap_or(0),
            "检测到旧的 Air IDE 实例仍在运行，跳过崩溃提示"
        );
    }
}

// ── 跳转列表 ──────────────────────────────────────────────

fn refresh_jump_list_sync() {
    #[cfg(windows)]
    {
        let recent = air_workspace::load_recent_projects();
        let entries = air_win::jump_list::entries_from_recent(&recent);
        if entries.is_empty() {
            return;
        }
        if let Err(e) = air_win::jump_list::apply_jump_list(&entries) {
            tracing::warn!("刷新跳转列表失败（不影响启动）: {e}");
        }
    }
}

/// 最近项目变化后刷新跳转列表（前端在 push_recent 后调用）。
#[tauri::command]
pub async fn app_refresh_jump_list() -> AirResult<()> {
    tauri::async_runtime::spawn_blocking(|| {
        let recent = air_workspace::load_recent_projects();
        let entries = air_win::jump_list::entries_from_recent(&recent);
        if entries.is_empty() {
            return Ok(());
        }
        air_win::jump_list::apply_jump_list(&entries)
    })
    .await
    .map_err(|e| AirError::other(e.to_string()))?
}

/// 跳转列表/文件关联启动参数：`--open <path>` 或裸路径。
pub fn cli_startup_path(args: &[String]) -> Option<String> {
    let raw = air_win::jump_list::parse_startup_path(args)?;
    crate::commands::valid_path(&raw)
}

// ── 资源管理器集成开关 ────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationStatus {
    /// 仅 Windows 支持。
    pub supported: bool,
    /// 当前用户是否已注册右键菜单/文件关联候选。
    pub registered: bool,
    pub exe_path: String,
}

fn shell_status() -> ShellIntegrationStatus {
    let exe_path = std::env::current_exe()
        .map(|p| air_win::normalize_path(&p).to_string_lossy().into_owned())
        .unwrap_or_default();
    ShellIntegrationStatus {
        supported: cfg!(windows),
        registered: air_win::shell_entries_registered(),
        exe_path,
    }
}

#[tauri::command]
pub fn app_windows_integration_status() -> ShellIntegrationStatus {
    shell_status()
}

/// 启用/关闭「集成系统」：只写 HKCU；错误消息区分权限拒绝（如取消 UAC）。
#[tauri::command]
pub fn app_set_windows_integration(enable: bool) -> AirResult<ShellIntegrationStatus> {
    let exe = std::env::current_exe()
        .map_err(|e| AirError::other(format!("获取 exe 路径失败：{e}")))?;
    air_win::register_shell_entries(enable, &exe)?;
    Ok(shell_status())
}

// ── Defender 真实状态 ────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefenderStatusDto {
    pub realtime_enabled: Option<bool>,
    pub excluded: Option<bool>,
}

/// 查询 Defender 实时保护与目录排除项（只读注册表）。
#[tauri::command]
pub fn app_defender_status(path: String) -> DefenderStatusDto {
    let status = air_win::defender::status(&path);
    DefenderStatusDto {
        realtime_enabled: status.realtime_enabled,
        excluded: status.excluded,
    }
}

// ── 系统通知 ─────────────────────────────────────────────

/// 发系统通知；失败时返回 Err，前端应降级为应用内提示。
#[tauri::command]
pub fn app_show_notification(
    title: String,
    body: String,
    level: Option<String>,
) -> AirResult<()> {
    let level = match level.as_deref() {
        Some("warning") => air_win::toast::ToastLevel::Warning,
        Some("error") => air_win::toast::ToastLevel::Error,
        _ => air_win::toast::ToastLevel::Info,
    };
    let hwnd = HWND.load(Ordering::SeqCst);
    air_win::toast::show_notification(hwnd, &title, &body, level)
}

// ── 任务栏进度 ───────────────────────────────────────────

#[tauri::command]
pub fn win_taskbar_begin(task_id: String, label: Option<String>) -> AirResult<()> {
    let now = now_ms();
    with_jobs(|jobs| {
        jobs.insert(
            task_id,
            Job {
                progress: JobProgress::new(now),
                value: 0,
                total: 0,
                label: label.unwrap_or_default(),
            },
        );
    });
    Ok(())
}

#[tauri::command]
pub fn win_taskbar_update(task_id: String, value: u64, total: u64) -> AirResult<()> {
    with_jobs(|jobs| {
        if let Some(job) = jobs.get_mut(&task_id) {
            job.value = value;
            job.total = total;
        }
    });
    Ok(())
}

/// 结束任务：failure 与 success 同样清除进度（避免残留）。
#[tauri::command]
pub fn win_taskbar_end(task_id: String, failed: Option<bool>) -> AirResult<()> {
    let _ = failed;
    let removed = with_jobs(|jobs| jobs.remove(&task_id));
    if let Some(mut job) = removed {
        let _ = job.progress.finish();
    }
    apply_taskbar_now();
    Ok(())
}

// ── 崩溃记录提示（只读，不修改 P5-3 的 crash 模块） ────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashInfo {
    pub crash_id: String,
    pub time: String,
    pub message: String,
    pub kind: String,
    pub path: String,
}

fn crash_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(|p| std::path::PathBuf::from(p).join("AirIDE").join("crashes"))
}

/// 最近一条崩溃记录（供前端用系统通知提示「崩溃记录已保存」）。
#[tauri::command]
pub fn app_last_crash() -> Option<CrashInfo> {
    let dir = crash_dir()?;
    let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("json"))
        .collect();
    files.sort();
    let path = files.pop()?;
    let value: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).ok()?).ok()?;
    Some(CrashInfo {
        crash_id: value
            .get("crashId")
            .and_then(|v| v.as_str())
            .unwrap_or("-")
            .to_string(),
        time: value
            .get("time")
            .and_then(|v| v.as_str())
            .unwrap_or("-")
            .to_string(),
        message: value
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("（无详细信息）")
            .to_string(),
        kind: value
            .get("kind")
            .and_then(|v| v.as_str())
            .unwrap_or("-")
            .to_string(),
        path: path.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_accepts_open_flag_and_ignores_missing_path() {
        let args = vec![
            "air-ide.exe".to_string(),
            "--open".to_string(),
            r"C:\not-exists".to_string(),
        ];
        assert_eq!(cli_startup_path(&args), None);
    }

    #[test]
    fn marker_skip_logic_only_when_previous_instance_alive() {
        assert!(!should_skip_crash_prompt(None, 100, false));
        assert!(!should_skip_crash_prompt(Some(0), 100, true));
        assert!(!should_skip_crash_prompt(Some(100), 100, true));
        assert!(should_skip_crash_prompt(Some(200), 100, true));
        assert!(!should_skip_crash_prompt(Some(200), 100, false));
    }

    #[test]
    fn taskbar_short_job_leaves_no_state() {
        let now = now_ms();
        with_jobs(|jobs| {
            jobs.insert(
                "short".into(),
                Job {
                    progress: JobProgress::new(now),
                    value: 1,
                    total: 2,
                    label: "短任务".into(),
                },
            );
        });
        let _ = win_taskbar_end("short".into(), Some(false));
        assert!(!with_jobs(|jobs| jobs.contains_key("short")));
    }
}
