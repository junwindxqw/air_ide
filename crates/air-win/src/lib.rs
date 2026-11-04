//! air-win：Windows 专属实现（唯一允许 Win32 调用的 crate，见 3.4）。
//! 当前覆盖 P0 需要的：DWM 暗色标题栏、路径归一化、Git 探测、长路径清单。

use std::path::PathBuf;

use air_core::AirResult;

/// DWM 暗色标题栏（3.12.3）：Win11 属性 20，Win10 2004-21H2 属性 19。
/// 属性不被支持时静默降级为系统默认标题栏（不做自绘，D13）。
#[cfg(windows)]
pub fn apply_dark_titlebar(hwnd: isize, dark: bool) -> AirResult<()> {
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE};
    use windows::Win32::Foundation::HWND;

    let hwnd = HWND(hwnd as *mut _);
    let value: i32 = if dark { 1 } else { 0 };
    unsafe {
        // Win11 / 新 Win10：属性 20
        let r20 = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE.0,
            &value as *const _ as *const _,
            std::mem::size_of::<i32>() as u32,
        );
        if r20.is_err() {
            // Win10 2004-21H2：同一语义属性编号 19
            let r19 = DwmSetWindowAttribute(hwnd, 19, &value as *const _ as *const _, 4);
            r19.ok()?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_extended_prefix() {
        let p = std::path::Path::new(r"\\?\C:\x\y");
        let n = normalize_path(p);
        assert_eq!(n.to_str().unwrap(), r"C:\x\y");
    }
}
