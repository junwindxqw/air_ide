//! 系统通知（P5-6）：用隐藏的托盘图标气泡，避免要求 AUMID 快捷方式注册。
//! 失败时返回 Err，前端降级为应用内提示。

use air_core::{AirError, AirResult};

/// 通知级别（影响图标与色调）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToastLevel {
    Info,
    Warning,
    Error,
}

/// 当前平台是否支持系统通知。
pub fn notifications_supported() -> bool {
    cfg!(windows)
}

#[cfg(windows)]
pub fn show_notification(
    hwnd: isize,
    title: &str,
    body: &str,
    level: ToastLevel,
) -> AirResult<()> {
    use std::sync::Mutex;

    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::{
        Shell_NotifyIconW, NIF_ICON, NIF_INFO, NIF_STATE, NIF_TIP, NIIF_ERROR, NIIF_INFO,
        NIIF_WARNING, NIM_ADD, NIM_MODIFY, NIS_HIDDEN, NOTIFYICONDATAW,
    };
    use windows::Win32::UI::WindowsAndMessaging::{LoadIconW, IDI_APPLICATION};

    if hwnd == 0 {
        return Err(AirError::other("窗口句柄不可用"));
    }

    static ADDED: Mutex<bool> = Mutex::new(false);

    let mut data: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
    data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    data.hWnd = HWND(hwnd as *mut _);
    data.uID = 1;
    set_wide(&mut data.szTip, "Air IDE");
    set_wide(&mut data.szInfoTitle, title);
    set_wide(&mut data.szInfo, body);

    let mut added = ADDED.lock().unwrap_or_else(|e| e.into_inner());
    if !*added {
        data.uFlags = NIF_ICON | NIF_TIP | NIF_STATE;
        data.dwState = NIS_HIDDEN;
        data.dwStateMask = NIS_HIDDEN;
        if let Ok(icon) = unsafe { LoadIconW(None, IDI_APPLICATION) } {
            data.hIcon = icon;
            data.uFlags |= NIF_ICON;
        }
        if !unsafe { Shell_NotifyIconW(NIM_ADD, &data) }.as_bool() {
            return Err(AirError::other("系统通知不可用（托盘注册失败）"));
        }
        *added = true;
    }

    data.uFlags = NIF_INFO;
    data.dwInfoFlags = match level {
        ToastLevel::Info => NIIF_INFO,
        ToastLevel::Warning => NIIF_WARNING,
        ToastLevel::Error => NIIF_ERROR,
    };
    if !unsafe { Shell_NotifyIconW(NIM_MODIFY, &data) }.as_bool() {
        // 资源管理器重启会丢失托盘图标：下次重新注册。
        *added = false;
        return Err(AirError::other("系统通知不可用（气泡显示失败）"));
    }
    Ok(())
}

#[cfg(windows)]
fn set_wide(dst: &mut [u16], text: &str) {
    let units: Vec<u16> = text.encode_utf16().take(dst.len().saturating_sub(1)).collect();
    dst[..units.len()].copy_from_slice(&units);
}

#[cfg(not(windows))]
pub fn show_notification(
    _hwnd: isize,
    _title: &str,
    _body: &str,
    _level: ToastLevel,
) -> AirResult<()> {
    Err(AirError::other("当前系统不支持系统通知"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_platform_degrades_with_error() {
        // Windows 上该函数可用；非 Windows 必须返回 Err 让前端走降级路径。
        #[cfg(not(windows))]
        {
            let r = show_notification(0, "标题", "正文", ToastLevel::Info);
            assert!(r.is_err());
        }
        #[cfg(windows)]
        {
            assert!(notifications_supported());
        }
    }
}
