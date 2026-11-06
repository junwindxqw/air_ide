//! Windows 跳转列表（P5-6）：最近项目写入 Jump List，点击以 `--open <path>` 启动。
//! 参数编码 / 解析 / 去重是纯函数，便于跨平台单测；COM 写入仅在 Windows 生效。

use std::path::{Path, PathBuf};

use air_core::{AirError, AirResult};

/// 分类名（资源管理器右键任务栏图标时看到的分组）。
pub const CATEGORY_TITLE: &str = "最近项目";

/// 最多写入的跳转项数量。
pub const MAX_ITEMS: usize = 10;

/// 一个跳转项：项目标题 + 工作区路径。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JumpEntry {
    pub title: String,
    pub path: String,
}

/// 构造启动参数：`--open "<path>"`。Windows 路径不含双引号，直接包裹即可。
pub fn open_args(path: &str) -> String {
    format!("--open \"{}\"", path.trim())
}

/// 从 argv 解析启动路径：支持 `--open <path>`、`--open=<path>`，
/// 以及兼容旧行为的第一个非选项参数（文件关联直接传路径）。
pub fn parse_startup_path<S: AsRef<str>>(args: &[S]) -> Option<String> {
    let mut i = 0;
    while i < args.len() {
        let raw = args[i].as_ref();
        if raw == "--open" {
            return args
                .get(i + 1)
                .map(|a| clean_arg(a.as_ref()))
                .filter(|s| not_empty(s));
        }
        if let Some(v) = raw.strip_prefix("--open=") {
            let v = clean_arg(v);
            if !v.is_empty() {
                return Some(v);
            }
        }
        i += 1;
    }
    // 兼容：第一个不是选项的参数（argv[0] 是 exe 自身，一并跳过）
    args.iter()
        .skip(1)
        .map(|a| a.as_ref())
        .find(|a| !a.starts_with('-'))
        .map(clean_arg)
        .filter(|s| not_empty(s))
}

fn not_empty(s: &str) -> bool {
    !s.is_empty()
}

/// 去掉 Windows 命令行可能残留的外层引号。
fn clean_arg(s: &str) -> String {
    let t = s.trim();
    if t.len() >= 2 && t.starts_with('"') && t.ends_with('"') {
        t[1..t.len() - 1].to_string()
    } else {
        t.to_string()
    }
}

/// 最近项目去重（大小写不敏感、忽略末尾分隔符），保持原有顺序并截断到 max。
pub fn dedupe_projects(paths: &[String], max: usize) -> Vec<String> {
    let mut seen = Vec::<String>::new();
    let mut out = Vec::new();
    for p in paths {
        let p = p.trim();
        if p.is_empty() {
            continue;
        }
        let key = dedupe_key(p);
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        out.push(p.to_string());
        if out.len() >= max {
            break;
        }
    }
    out
}

fn dedupe_key(p: &str) -> String {
    let mut s = p.replace('/', "\\").to_lowercase();
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s
}

/// 标题取最后一级目录名；根目录（如 `D:\`）回退为完整路径。
pub fn title_for_path(path: &str) -> String {
    let norm = path.trim_end_matches(['\\', '/']);
    let name = norm
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or("")
        .trim();
    if name.is_empty() || name.ends_with(':') {
        // 根目录（D:\）没有目录名，回退为完整路径。
        path.to_string()
    } else {
        name.to_string()
    }
}

/// 跳转列表快捷方式目录（`%LOCALAPPDATA%\AirIDE\jump`）。
pub fn jump_dir(data_root: &Path) -> PathBuf {
    data_root.join("jump")
}

/// 最近项目列表 → 跳转项（去重 + 上限），标题取目录名。
pub fn entries_from_recent(paths: &[String]) -> Vec<JumpEntry> {
    dedupe_projects(paths, MAX_ITEMS)
        .into_iter()
        .map(|p| JumpEntry {
            title: title_for_path(&p),
            path: p,
        })
        .collect()
}

/// 写入 Jump List。任何失败都返回 Err，由调用方记录日志（不影响主流程）。
#[cfg(windows)]
pub fn apply_jump_list(entries: &[JumpEntry]) -> AirResult<()> {
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
    };

    let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let initialized = hr.is_ok();
    let result = apply_jump_list_inner(entries);
    if initialized {
        unsafe {
            CoUninitialize();
        }
    }
    result
}

#[cfg(windows)]
fn apply_jump_list_inner(entries: &[JumpEntry]) -> AirResult<()> {
    use std::path::PathBuf;

    use windows::core::{Interface, HSTRING, IUnknown};
    use windows::Win32::System::Com::{
        CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER,
    };
    use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
    use windows::Win32::UI::Shell::{
        DestinationList, EnumerableObjectCollection, IShellItem, IShellLinkW,
        SHCreateItemFromParsingName, ShellLink,
    };

    let exe = std::env::current_exe()
        .map_err(|e| AirError::other(format!("获取 exe 路径失败: {e}")))?;
    let exe = dunce::simplified(&exe);
    let data_root = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|p| p.join("AirIDE"))
        .ok_or_else(|| AirError::other("LOCALAPPDATA 未设置"))?;
    let dir = jump_dir(&data_root);
    std::fs::create_dir_all(&dir)?;

    // 清理上一次生成的快捷方式，避免残留项。
    if let Ok(read) = std::fs::read_dir(&dir) {
        for entry in read.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) == Some("lnk") {
                let _ = std::fs::remove_file(p);
            }
        }
    }

    let destination: windows::Win32::UI::Shell::ICustomDestinationList =
        unsafe { CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER) }
            .map_err(|e| AirError::other(format!("创建跳转列表失败: {e}")))?;
    unsafe {
        destination
            .SetAppID(&HSTRING::from(crate::APP_ID))
            .map_err(|e| AirError::other(format!("设置 AppID 失败: {e}")))?;
    }

    let mut slots: u32 = 0;
    let removed: IObjectArray = unsafe {
        destination
            .BeginList(&mut slots)
            .map_err(|e| AirError::other(format!("开始编辑跳转列表失败: {e}")))?
    };
    drop(removed);

    let collection: IObjectCollection =
        unsafe { CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER) }
            .map_err(|e| AirError::other(format!("创建集合失败: {e}")))?;

    let exe_str = exe.to_string_lossy().to_string();
    for (index, item) in entries.iter().take(MAX_ITEMS).enumerate() {
        let lnk = dir.join(format!("{index}.lnk"));
        let link: IShellLinkW = unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) }
            .map_err(|e| AirError::other(format!("创建快捷方式失败: {e}")))?;
        unsafe {
            link.SetPath(&HSTRING::from(exe_str.as_str()))
                .map_err(|e| AirError::other(format!("设置快捷方式目标失败: {e}")))?;
            link.SetArguments(&HSTRING::from(open_args(&item.path)))
                .map_err(|e| AirError::other(format!("设置快捷方式参数失败: {e}")))?;
            link.SetDescription(&HSTRING::from(item.title.as_str()))
                .map_err(|e| AirError::other(format!("设置快捷方式描述失败: {e}")))?;
            link.SetIconLocation(&HSTRING::from(exe_str.as_str()), 0)
                .map_err(|e| AirError::other(format!("设置快捷方式图标失败: {e}")))?;
            let persist: IPersistFile = link
                .cast()
                .map_err(|e| AirError::other(format!("转换为 IPersistFile 失败: {e}")))?;
            persist
                .Save(&HSTRING::from(lnk.to_string_lossy().as_ref()), true)
                .map_err(|e| AirError::other(format!("保存快捷方式失败: {e}")))?;
        }
        let shell_item: IShellItem = unsafe {
            SHCreateItemFromParsingName(&HSTRING::from(lnk.to_string_lossy().as_ref()), None)
        }
        .map_err(|e| AirError::other(format!("创建 ShellItem 失败: {e}")))?;
        unsafe {
            let unknown: IUnknown = shell_item
                .cast()
                .map_err(|e| AirError::other(format!("转换 IUnknown 失败: {e}")))?;
            collection
                .AddObject(&unknown)
                .map_err(|e| AirError::other(format!("加入跳转项失败: {e}")))?;
        }
    }

    let array: IObjectArray = collection
        .cast()
        .map_err(|e| AirError::other(format!("转换 IObjectArray 失败: {e}")))?;

    let committed = unsafe {
        destination
            .AppendCategory(&HSTRING::from(CATEGORY_TITLE), &array)
            .and_then(|_| destination.CommitList())
    };
    if let Err(e) = committed {
        unsafe {
            let _ = destination.AbortList();
        }
        return Err(AirError::other(format!("提交跳转列表失败: {e}")));
    }
    Ok(())
}

/// 非 Windows：无跳转列表，视为成功（不影响其他平台编译/测试）。
#[cfg(not(windows))]
pub fn apply_jump_list(_entries: &[JumpEntry]) -> AirResult<()> {
    Ok(())
}

/// 便于调用方传路径：从最近项目直接生成条目。
pub fn entries_from_paths<S: AsRef<str>>(paths: &[S]) -> Vec<JumpEntry> {
    let owned: Vec<String> = paths.iter().map(|p| p.as_ref().to_string()).collect();
    entries_from_recent(&owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_args_wraps_path_in_quotes() {
        assert_eq!(open_args(r"C:\work\demo"), r#"--open "C:\work\demo""#);
        assert_eq!(open_args(r"C:\a b\proj"), r#"--open "C:\a b\proj""#);
    }

    #[test]
    fn parse_startup_path_supports_open_and_bare_path() {
        let args = vec!["air-ide.exe", "--open", r"C:\work\demo"];
        assert_eq!(parse_startup_path(&args).as_deref(), Some(r"C:\work\demo"));

        let args = vec!["air-ide.exe", r"--open=C:\work\demo"];
        assert_eq!(parse_startup_path(&args).as_deref(), Some(r"C:\work\demo"));

        let args = vec!["air-ide.exe", r"C:\work\demo"];
        assert_eq!(parse_startup_path(&args).as_deref(), Some(r"C:\work\demo"));

        let args = vec!["air-ide.exe", "--minimized"];
        assert_eq!(parse_startup_path(&args), None);

        let args = vec!["air-ide.exe", "--open", "\"C:\\work\\demo\""];
        assert_eq!(parse_startup_path(&args).as_deref(), Some(r"C:\work\demo"));
    }

    #[test]
    fn dedupe_is_case_insensitive_and_keeps_order() {
        let input = vec![
            r"C:\Work\Demo".to_string(),
            r"C:\work\demo\".to_string(),
            r"D:\Other".to_string(),
            r"c:/work/demo".to_string(),
        ];
        let out = dedupe_projects(&input, 10);
        assert_eq!(out, vec![r"C:\Work\Demo", r"D:\Other"]);
    }

    #[test]
    fn dedupe_respects_max_and_skips_empty() {
        let input = vec![
            "".to_string(),
            r"C:\a".to_string(),
            r"C:\b".to_string(),
            r"C:\c".to_string(),
        ];
        let out = dedupe_projects(&input, 2);
        assert_eq!(out, vec![r"C:\a", r"C:\b"]);
    }

    #[test]
    fn title_uses_last_segment() {
        assert_eq!(title_for_path(r"C:\work\demo"), "demo");
        assert_eq!(title_for_path(r"C:\work\demo\"), "demo");
        assert_eq!(title_for_path(r"D:\"), r"D:\");
    }

    #[test]
    fn entries_from_paths_builds_titles() {
        let entries = entries_from_paths(&[r"C:\work\demo", r"D:\data\repo"]);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].title, "demo");
        assert_eq!(entries[1].path, r"D:\data\repo");
    }

    #[test]
    fn jump_dir_is_under_data_root() {
        let dir = jump_dir(Path::new(r"C:\Users\me\AppData\Local\AirIDE"));
        assert!(dir.ends_with("jump"));
    }
}
