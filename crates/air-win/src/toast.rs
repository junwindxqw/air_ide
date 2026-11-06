//! 系统通知（P5-6）：优先 Windows 通知中心（WinRT Toast，AUMID = [`crate::APP_ID`]），
//! 通知中心不可用时回退到托盘气泡；再失败返回 Err，由前端降级为应用内提示。

use air_core::{AirError, AirResult};

/// 通知级别（影响气泡图标）。
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

/// 生成 Toast XML（ToastGeneric 模板，Win10 19041+ 可用）。
pub fn toast_xml(title: &str, body: &str) -> String {
    format!(
        concat!(
            "<toast><visual><binding template=\"ToastGeneric\">",
            "<text>{}</text><text>{}</text>",
            "</binding></visual><audio silent=\"true\"/></toast>"
        ),
        escape_xml(title),
        escape_xml(body)
    )
}

/// XML 文本转义（标题/正文是运行期用户内容，必须转义）。
pub fn escape_xml(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

/// 在二进制数据中查找 UTF-16LE 编码的 AUMID（.lnk 的属性存储是 BSTR）。
pub fn contains_aumid_utf16(bytes: &[u8], app_id: &str) -> bool {
    let needle: Vec<u8> = app_id
        .encode_utf16()
        .flat_map(|u| [u as u8, (u >> 8) as u8])
        .collect();
    if needle.is_empty() || bytes.len() < needle.len() {
        return false;
    }
    bytes.windows(needle.len()).any(|w| w == needle.as_slice())
}

/// 是否具备通知中心条件：开始菜单里存在带当前 AUMID 的快捷方式。
/// 没有快捷方式时 WinRT Toast 会被系统静默丢弃，因此先探测再决定走哪条路径。
#[cfg(windows)]
fn notification_center_ready() -> bool {
    use std::sync::OnceLock;

    static READY: OnceLock<bool> = OnceLock::new();
    *READY.get_or_init(|| {
        let Some(appdata) = std::env::var_os("APPDATA") else {
            return false;
        };
        let programs = std::path::PathBuf::from(appdata)
            .join(r"Microsoft\Windows\Start Menu\Programs");
        let Some(bytes) = find_app_shortcut(&programs, 0) else {
            return false;
        };
        contains_aumid_utf16(&bytes, crate::APP_ID)
    })
}

#[cfg(windows)]
fn find_app_shortcut(dir: &std::path::Path, depth: u8) -> Option<Vec<u8>> {
    if depth > 4 {
        return None;
    }
    let read = std::fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        if path.is_dir() {
            subdirs.push(path);
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name == "air ide.lnk" {
            if let Ok(bytes) = std::fs::read(&path) {
                return Some(bytes);
            }
        }
    }
    subdirs
        .into_iter()
        .find_map(|d| find_app_shortcut(&d, depth + 1))
}

#[cfg(windows)]
pub fn show_notification(
    hwnd: isize,
    title: &str,
    body: &str,
    level: ToastLevel,
) -> AirResult<()> {
    if notification_center_ready() {
        match show_toast(title, body) {
            Ok(()) => return Ok(()),
            Err(toast_err) => {
                return show_balloon(hwnd, title, body, level).map_err(|balloon_err| {
                    AirError::other(format!(
                        "通知中心不可用（{toast_err}），气泡通知也失败（{balloon_err}）"
                    ))
                });
            }
        }
    }
    show_balloon(hwnd, title, body, level)
}

#[cfg(windows)]
fn show_toast(title: &str, body: &str) -> AirResult<()> {
    use windows::core::HSTRING;
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    // 每个线程初始化一次 WinRT；不配对 RoUninitialize（线程长期存活，避免计数失衡）。
    thread_local! {
        static RO_READY: std::cell::OnceCell<()> = const { std::cell::OnceCell::new() };
    }
    RO_READY.with(|cell| {
        cell.get_or_init(|| {
            let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
        });
    });

    let xml = XmlDocument::new()
        .map_err(|e| AirError::other(format!("创建 Toast XML 失败: {e}")))?;
    xml.LoadXml(&HSTRING::from(toast_xml(title, body)))
        .map_err(|e| AirError::other(format!("解析 Toast XML 失败: {e}")))?;
    let toast = ToastNotification::CreateToastNotification(&xml)
        .map_err(|e| AirError::other(format!("创建 Toast 失败: {e}")))?;
    let notifier =
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(crate::APP_ID))
            .map_err(|e| AirError::other(format!("获取通知中心入口失败: {e}")))?;
    notifier
        .Show(&toast)
        .map_err(|e| AirError::other(format!("通知中心显示失败: {e}")))?;
    Ok(())
}

/// 托盘气泡：无 AUMID 快捷方式时的降级路径（旧版行为，不进通知中心）。
#[cfg(windows)]
fn show_balloon(
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

    #[test]
    fn escape_xml_covers_markup_characters() {
        assert_eq!(
            escape_xml(r#"<a href="x">T & 'q'</a>"#),
            "&lt;a href=&quot;x&quot;&gt;T &amp; &apos;q&apos;&lt;/a&gt;"
        );
    }

    #[test]
    fn toast_xml_embeds_escaped_title_and_body() {
        let xml = toast_xml("LSP <done>", "路径：C:\\a&b");
        assert!(xml.starts_with("<toast>"));
        assert!(xml.contains("LSP &lt;done&gt;"));
        assert!(xml.contains("C:\\a&amp;b"));
        assert!(xml.ends_with("</toast>"));
    }

    #[test]
    fn detects_aumid_in_utf16_shortcut_bytes() {
        let mut bytes = b"\x4c\x00\x00\x00prefix".to_vec();
        bytes.extend(
            crate::APP_ID
                .encode_utf16()
                .flat_map(|u| [u as u8, (u >> 8) as u8]),
        );
        assert!(contains_aumid_utf16(&bytes, crate::APP_ID));
        assert!(!contains_aumid_utf16(&bytes, "junwind.Other"));
        assert!(!contains_aumid_utf16(b"short", crate::APP_ID));
    }
}
