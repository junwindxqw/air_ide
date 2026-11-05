//! 文件监听（3.11/3.12.4）：ReadDirectoryChangesW 封装（notify crate），
//! 64KB 缓冲 + 溢出全量重扫信号 + 200ms 合并 + 写入抑制表。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::time::{Duration, Instant};

use air_core::AirResult;

/// notify 推荐监视器类型别名（Windows 上即 ReadDirectoryChangesW）。
pub type NotifyWatcher = notify::RecommendedWatcher;

/// 抑制表条目：自己保存的文件在窗口期内忽略事件（3.11）。
#[derive(Debug, Clone)]
pub struct SuppressEntry {
    pub mtime: std::time::SystemTime,
    pub size: u64,
    pub until: Instant,
}

/// 全局监听状态：抑制表 + 已注册根。
pub struct WatcherState {
    /// path → 抑制截止时间（内部 Mutex：State 只提供 &AppState）
    suppressed: std::sync::Mutex<HashMap<PathBuf, SuppressEntry>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            suppressed: std::sync::Mutex::new(HashMap::new()),
        }
    }

    /// 登记一次"本 IDE 自己写入"（保存成功后调用）。
    pub fn suppress(&self, path: &Path, mtime: std::time::SystemTime, size: u64) {
        if let Ok(mut map) = self.suppressed.lock() {
            map.insert(
                path.to_path_buf(),
                SuppressEntry {
                    mtime,
                    size,
                    until: Instant::now() + Duration::from_millis(500),
                },
            );
        }
    }

    /// 事件是否应被抑制。除时间窗口外，还要求文件 mtime/size 与登记时一致
    /// （若期间被其他工具改过，抑制自动失效——3.11 的额外安全边际）。
    pub fn is_suppressed(&self, path: &Path) -> bool {
        let Ok(map) = self.suppressed.lock() else {
            return false;
        };
        let Some(entry) = map.get(path) else {
            return false;
        };
        if entry.until <= Instant::now() {
            return false;
        }
        match std::fs::metadata(path) {
            Ok(m) => m.modified().map(|t| t == entry.mtime).unwrap_or(false) && m.len() == entry.size,
            Err(_) => false,
        }
    }

    /// 清理过期条目（定期调用）。
    pub fn gc(&self) {
        if let Ok(mut map) = self.suppressed.lock() {
            let now = Instant::now();
            map.retain(|_, e| e.until > now);
        }
    }
}

/// 启动对 root 的递归监听，事件经 tx 发送（已由调用方合并节流）。
/// 溢出（BufferOverflow）时发送特殊 Rescan 信号路径（见调用方处理）。
pub fn watch(root: &Path, tx: Sender<WatchEvent>) -> AirResult<NotifyWatcher> {
    use notify::Watcher;
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            // ReadDirectoryChangesW 缓冲区溢出时 notify 会给出空 paths 的事件
            let overflow = event.paths.is_empty();
            let _ = tx.send(WatchEvent {
                paths: event.paths,
                overflow,
            });
        }
    })
    .map_err(|e| air_core::AirError::other(format!("监听启动失败: {e}")))?;
    watcher
        .watch(root, notify::RecursiveMode::Recursive)
        .map_err(|e| air_core::AirError::other(format!("监听目录失败: {e}")))?;
    Ok(watcher)
}

pub struct WatchEvent {
    pub paths: Vec<PathBuf>,
    /// true = 缓冲区溢出，应放弃增量、全量重扫（3.12.4）
    pub overflow: bool,
}
