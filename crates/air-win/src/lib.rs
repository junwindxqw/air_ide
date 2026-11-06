//! air-win：Windows 专属实现（唯一允许 Win32 调用的 crate，见 3.4）。
//! 当前覆盖 P0 需要的：DWM 暗色标题栏、路径归一化、Git 探测、长路径清单。

use std::path::PathBuf;

use air_core::{AirError, AirResult};

pub mod defender;
pub mod jump_list;
pub mod taskbar;
pub mod toast;

/// 应用 AppUserModelID（AUMID）。
///
/// 必须与安装器写入开始菜单快捷方式的 AUMID 一致：Tauri 的 NSIS 模板用
/// `{{bundle_id}}`（即 tauri.conf.json 的 `identifier`）调用 `SetLnkAppUserModelId`。
/// 通知中心持久化、任务栏分组与跳转列表归属都依赖这个值。
pub const APP_ID: &str = "com.airide.app";

/// 设置进程级 AUMID（启动时调用一次）。从快捷方式启动时 Windows 会自带 AUMID，
/// 但直接双击 exe / 更新重启时需要显式设置，否则跳转列表与通知归属会错位。
#[cfg(windows)]
pub fn init_app_id() {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

    let id = HSTRING::from(APP_ID);
    unsafe {
        let _ = SetCurrentProcessExplicitAppUserModelID(&id);
    }
}

#[cfg(not(windows))]
pub fn init_app_id() {}

/// 判断进程是否仍存活（P5-6：避免并发/更新重启时误报「上次未正常退出」）。
#[cfg(windows)]
pub fn process_alive(pid: u32) -> bool {
    use windows::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    if pid == 0 {
        return false;
    }
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return false;
        };
        let mut code: u32 = 0;
        let result = GetExitCodeProcess(handle, &mut code);
        let _ = CloseHandle(handle);
        result.is_ok() && code as i32 == STILL_ACTIVE.0
    }
}

#[cfg(not(windows))]
pub fn process_alive(_pid: u32) -> bool {
    false
}

/// DWM 暗色标题栏（3.12.3）：Win11 属性 20，Win10 2004-21H2 属性 19。
/// 属性不被支持时静默降级为系统默认标题栏（不做自绘，D13）。
#[cfg(windows)]
pub fn apply_dark_titlebar(hwnd: isize, dark: bool) -> AirResult<()> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE, DWMWINDOWATTRIBUTE,
    };

    let hwnd = HWND(hwnd as *mut _);
    let value: i32 = if dark { 1 } else { 0 };
    unsafe {
        // Win11 / 新 Win10：属性 20
        let r20 = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &value as *const i32 as *const core::ffi::c_void,
            std::mem::size_of::<i32>() as u32,
        );
        if r20.is_err() {
            // Win10 2004-21H2：同一语义属性编号 19
            let r19 = DwmSetWindowAttribute(
                hwnd,
                DWMWINDOWATTRIBUTE(19),
                &value as *const i32 as *const core::ffi::c_void,
                4,
            );
            r19.map_err(|e| AirError::other(format!("DWM 属性 19 不可用: {e}")))?;
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn apply_dark_titlebar(_hwnd: isize, _dark: bool) -> AirResult<()> {
    Ok(())
}

/// 归一化路径：去 `\\?\` 前缀、短路符号、统一分隔符（3.12.1）。
pub fn normalize_path(p: &std::path::Path) -> PathBuf {
    dunce::simplified(p).to_path_buf()
}

/// Git 探测（3.12.6）：PATH → Program Files → LocalAppData → 注册表 InstallPath。
pub fn git_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            out.push(dir.join("git.exe"));
        }
    }
    if let Some(pf) = std::env::var_os("ProgramFiles") {
        out.push(PathBuf::from(pf).join(r"Git\cmd\git.exe"));
    }
    if let Some(la) = std::env::var_os("LOCALAPPDATA") {
        out.push(PathBuf::from(la).join(r"Programs\Git\cmd\git.exe"));
    }
    out
}

/// 找到第一个实际存在的 git.exe。
pub fn find_git() -> Option<PathBuf> {
    git_candidates().into_iter().find(|p| p.exists())
}

/// 长路径应用清单（longPathAware，3.12.1）——由 src-tauri build.rs 嵌入。
pub const APP_MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
    </windowsSettings>
  </application>
</assembly>
"#;

// ── Windows 集成（P5-6，D15）：全部只写 HKCU，卸载时清理 ──

/// 应用标识（注册表键名）。
const APP_KEY: &str = "AirIDE";

/// 文件夹右键菜单注册表路径（HKCU）。
pub fn folder_menu_key() -> String {
    format!(r"Software\Classes\Directory\shell\{APP_KEY}\Open")
}

/// ProgID 根键（HKCU）。
pub fn progid_key() -> String {
    format!(r"Software\Classes\{APP_KEY}")
}

/// 某扩展名的「打开方式」候选列表键（HKCU）。
pub fn open_with_progids_key(ext: &str) -> String {
    format!(r"Software\Classes\.{ext}\OpenWithProgids")
}

/// 卸载信息键（HKCU）。
pub fn uninstall_key() -> String {
    format!(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\{APP_KEY}")
}

/// 右键菜单命令行：`"<exe>" "%V"`（文件夹），文件关联用 `"%1"`。
pub fn shell_command(exe: &str, placeholder: &str) -> String {
    format!("\"{exe}\" \"{placeholder}\"")
}

/// 检查当前用户是否已启用资源管理器集成（HKCU，不触发 UAC）。
#[cfg(windows)]
pub fn shell_entries_registered() -> bool {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(menu) = hkcu.open_subkey_with_flags(folder_menu_key(), KEY_READ) else {
        return false;
    };
    menu.get_value::<String, _>("").is_ok()
        && menu
            .open_subkey_with_flags("command", KEY_READ)
            .and_then(|c| c.get_value::<String, _>(""))
            .is_ok()
}

#[cfg(not(windows))]
pub fn shell_entries_registered() -> bool {
    false
}

/// 资源管理器集成入口（启用/禁用）：文件夹右键 + 文件关联（OpenWithProgids）。
/// 只写 HKCU（免管理员）；不抢默认打开方式（D11）。
pub fn register_shell_entries(enable: bool, exe_path: &std::path::Path) -> AirResult<()> {
    #[cfg(windows)]
    {
        register_shell_entries_win(enable, exe_path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                AirError::other(format!(
                    "系统拒绝写入注册表（权限不足或被安全软件阻止，如用户取消了 UAC）：{e}"
                ))
            } else {
                AirError::other(format!("写入注册表失败：{e}"))
            }
        })
    }
    #[cfg(not(windows))]
    {
        let _ = (enable, exe_path);
        Ok(())
    }
}

#[cfg(windows)]
fn register_shell_entries_win(
    enable: bool,
    exe_path: &std::path::Path,
) -> std::io::Result<()> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let exe = exe_path.to_string_lossy().to_string();

    // 1. 文件夹右键：「用 Air IDE 打开」
    let dir_shell = hkcu.open_subkey(r"Software\Classes\Directory\shell")?;
    let (key, _) = dir_shell.create_subkey(format!(r"{APP_KEY}\Open"))?;
    if enable {
        key.set_value("", &"用 Air IDE 打开")?;
        key.set_value("Icon", &exe)?;
        let cmd = key.create_subkey("command")?.0;
        cmd.set_value("", &shell_command(&exe, "%V"))?;
    } else {
        let _ = dir_shell.delete_subkey_all(format!(r"{APP_KEY}\Open"));
    }

    // 2. 文件关联（.php 等）：只注册 OpenWithProgids 候选，不抢默认（D11）
    for ext in ["php", "phtml", "txt", "md", "json", "go", "rs", "py", "ts", "js"] {
        let Ok((key, _)) = hkcu.create_subkey(open_with_progids_key(ext)) else {
            continue;
        };
        if enable {
            let _ = key.set_value(APP_KEY, &"");
        } else {
            let _ = key.delete_value(APP_KEY);
        }
    }

    // 3. 应用能力注册（ProgID）
    let classes = hkcu.open_subkey(r"Software\Classes")?;
    let (app_key, _) = classes.create_subkey(APP_KEY)?;
    if enable {
        app_key.set_value("", &"Air IDE")?;
        let cmd = app_key.create_subkey(r"shell\open\command")?.0;
        cmd.set_value("", &shell_command(&exe, "%1"))?;
    } else {
        let _ = classes.delete_subkey_all(APP_KEY);
    }

    // 4. 卸载信息（按用户安装）
    let uninstall = hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Uninstall")?;
    let (u, _) = uninstall.create_subkey(APP_KEY)?;
    if enable {
        u.set_value("DisplayName", &"Air IDE")?;
        u.set_value("DisplayVersion", &"0.1.0")?;
        u.set_value("Publisher", &"junwind")?;
        u.set_value("InstallLocation", &exe)?;
        u.set_value("NoModify", &1u32)?;
        u.set_value("NoRepair", &1u32)?;
    } else {
        let _ = uninstall.delete_subkey_all(APP_KEY);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_extended_prefix() {
        let p = std::path::Path::new(r"\\?\C:\x\y");
        let n = normalize_path(p);
        assert_eq!(n.to_str().unwrap(), r"C:\x\y");
    }

    #[test]
    fn registry_paths_are_under_hkcu_classes() {
        assert_eq!(
            folder_menu_key(),
            r"Software\Classes\Directory\shell\AirIDE\Open"
        );
        assert_eq!(progid_key(), r"Software\Classes\AirIDE");
        assert_eq!(
            open_with_progids_key("php"),
            r"Software\Classes\.php\OpenWithProgids"
        );
        assert!(uninstall_key().ends_with(r"Uninstall\AirIDE"));
    }

    #[test]
    fn current_process_is_alive_but_bogus_pid_is_not() {
        #[cfg(windows)]
        {
            assert!(process_alive(std::process::id()));
            // 0 视为无效 pid
            assert!(!process_alive(0));
        }
    }

    #[test]
    fn shell_command_quotes_exe_and_placeholder() {
        assert_eq!(
            shell_command(r"C:\Program Files\Air IDE\air-ide.exe", "%V"),
            r#""C:\Program Files\Air IDE\air-ide.exe" "%V""#
        );
    }
}
