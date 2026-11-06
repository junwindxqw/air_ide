//! 任务栏进度（P5-6）：长任务显示进度，结束/失败清除；短任务不闪烁。
//! 决策逻辑是纯状态机（可单测），Win32 写入仅 Windows 生效。

use air_core::{AirError, AirResult};

/// 进度不足该时长不显示，避免高频短任务导致任务栏进度条闪烁。
pub const MIN_VISIBLE_MS: u64 = 500;

/// 要应用到任务栏的显示状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskbarDisplay {
    /// 清除进度（任务结束 / 失败）。
    Clear,
    /// 不确定进度（总量未知）。
    Indeterminate,
    /// 确定进度。
    Normal { value: u64, total: u64 },
}

/// 单个任务的进度状态机。
///
/// - `begin` 时仅记录起点，不立即显示；
/// - 经过 `MIN_VISIBLE_MS` 后才会 `show`；
/// - 未显示就结束的任务返回 `None`（不产生任何任务栏变化，避免闪烁）；
/// - 已显示的任务结束时返回 `Clear`。
#[derive(Debug, Clone)]
pub struct JobProgress {
    started_ms: u64,
    shown: bool,
}

impl JobProgress {
    pub fn new(now_ms: u64) -> Self {
        Self {
            started_ms: now_ms,
            shown: false,
        }
    }

    /// 每帧/每次更新调用：返回本轮应应用的状态（未到展示阈值时为 None）。
    pub fn update(&mut self, now_ms: u64, value: u64, total: u64) -> Option<TaskbarDisplay> {
        if !self.shown && now_ms.saturating_sub(self.started_ms) < MIN_VISIBLE_MS {
            return None;
        }
        self.shown = true;
        if total == 0 {
            Some(TaskbarDisplay::Indeterminate)
        } else {
            Some(TaskbarDisplay::Normal {
                value: value.min(total),
                total,
            })
        }
    }

    /// 任务结束（成功或失败）：仅当曾经显示过才需要清除。
    pub fn finish(&mut self) -> Option<TaskbarDisplay> {
        if self.shown {
            self.shown = false;
            Some(TaskbarDisplay::Clear)
        } else {
            None
        }
    }

    pub fn is_shown(&self) -> bool {
        self.shown
    }
}

/// 把展示状态写入任务栏（Windows）。非 Windows 直接成功。
#[cfg(windows)]
pub fn apply_taskbar(hwnd: isize, display: TaskbarDisplay) -> AirResult<()> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Shell::{
        ITaskbarList3, TaskbarList, TBPF_INDETERMINATE, TBPF_NOPROGRESS, TBPF_NORMAL,
    };

    if hwnd == 0 {
        return Err(AirError::other("窗口句柄不可用"));
    }
    let ok = || AirError::other("任务栏进度写入失败");
    let taskbar: ITaskbarList3 =
        unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER) }
            .map_err(|e| AirError::other(format!("创建任务栏对象失败: {e}")))?;
    let hwind = HWND(hwnd as *mut _);
    unsafe {
        match display {
            TaskbarDisplay::Clear => {
                taskbar
                    .SetProgressState(hwind, TBPF_NOPROGRESS)
                    .map_err(|_| ok())?;
            }
            TaskbarDisplay::Indeterminate => {
                taskbar
                    .SetProgressState(hwind, TBPF_INDETERMINATE)
                    .map_err(|_| ok())?;
            }
            TaskbarDisplay::Normal { value, total } => {
                taskbar
                    .SetProgressState(hwind, TBPF_NORMAL)
                    .map_err(|_| ok())?;
                taskbar
                    .SetProgressValue(hwind, value, total.max(1))
                    .map_err(|_| ok())?;
            }
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn apply_taskbar(_hwnd: isize, _display: TaskbarDisplay) -> AirResult<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_task_never_shows_nor_clears() {
        let mut job = JobProgress::new(1000);
        assert_eq!(job.update(1100, 10, 100), None);
        assert!(!job.is_shown());
        assert_eq!(job.finish(), None);
    }

    #[test]
    fn long_task_shows_and_clears() {
        let mut job = JobProgress::new(1000);
        let shown = job.update(1600, 40, 100).expect("超过阈值应显示");
        assert_eq!(
            shown,
            TaskbarDisplay::Normal {
                value: 40,
                total: 100
            }
        );
        assert!(job.is_shown());
        assert_eq!(job.finish(), Some(TaskbarDisplay::Clear));
        assert!(!job.is_shown());
    }

    #[test]
    fn unknown_total_uses_indeterminate() {
        let mut job = JobProgress::new(0);
        assert_eq!(job.update(600, 0, 0), Some(TaskbarDisplay::Indeterminate));
    }

    #[test]
    fn value_is_clamped_to_total() {
        let mut job = JobProgress::new(0);
        assert_eq!(
            job.update(600, 120, 100),
            Some(TaskbarDisplay::Normal {
                value: 100,
                total: 100
            })
        );
    }

    #[test]
    fn update_exactly_at_threshold_shows() {
        let mut job = JobProgress::new(500);
        assert_eq!(
            job.update(1000, 0, 10),
            Some(TaskbarDisplay::Normal { value: 0, total: 10 })
        );
    }

    #[test]
    fn failure_after_show_clears() {
        let mut job = JobProgress::new(0);
        let _ = job.update(700, 30, 100);
        // finish 不区分成功/失败：失败同样需要清除（避免残留进度条）。
        assert_eq!(job.finish(), Some(TaskbarDisplay::Clear));
    }
}
