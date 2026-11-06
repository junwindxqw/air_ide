//! Windows Defender 真实状态（P5-6）：实时保护是否开启、目录是否已在排除项中。
//! 只读注册表；读不到（第三方杀软 / 权限不足）返回 None，由前端保守处理。

/// Defender 状态快照。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DefenderStatus {
    /// Some(true)=实时保护开启；Some(false)=关闭；None=无法确认。
    pub realtime_enabled: Option<bool>,
    /// Some(true)=该目录（或父目录）已排除；None=无法确认。
    pub excluded: Option<bool>,
}

/// 由 `DisableRealtimeMonitoring` 值（0/1）换算实时保护状态。
pub fn realtime_state_from(disable_value: Option<u32>) -> Option<bool> {
    match disable_value {
        Some(0) => Some(true),
        Some(1) => Some(false),
        _ => None,
    }
}

/// 路径比较用归一化：统一分隔符、小写、去末尾分隔符。
pub fn normalize_for_compare(path: &str) -> String {
    let mut s = path.trim().replace('/', "\\").to_lowercase();
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s
}

/// 判断目标目录是否被某个排除项覆盖（排除项可以是父目录）。
pub fn exclusion_matches(exclusions: &[String], target: &str) -> bool {
    let t = normalize_for_compare(target);
    exclusions.iter().any(|e| {
        let e = normalize_for_compare(e);
        if e.is_empty() {
            return false;
        }
        t == e || t.starts_with(&format!("{e}\\"))
    })
}

/// 读取真实状态（Windows）。
#[cfg(windows)]
pub fn status(path: &str) -> DefenderStatus {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    let realtime_enabled = hklm
        .open_subkey_with_flags(
            r"SOFTWARE\Microsoft\Windows Defender\Real-Time Protection",
            KEY_READ,
        )
        .ok()
        .and_then(|k| k.get_value::<u32, _>("DisableRealtimeMonitoring").ok())
        .and_then(|v| realtime_state_from(Some(v)));

    let excluded = hklm
        .open_subkey_with_flags(r"SOFTWARE\Microsoft\Windows Defender\Exclusions\Paths", KEY_READ)
        .ok()
        .map(|k| {
            let mut list: Vec<String> = Vec::new();
            for name in k.enum_keys().flatten() {
                list.push(name);
            }
            exclusion_matches(&list, path)
        });

    DefenderStatus {
        realtime_enabled,
        excluded,
    }
}

#[cfg(not(windows))]
pub fn status(_path: &str) -> DefenderStatus {
    DefenderStatus::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn realtime_state_mapping() {
        assert_eq!(realtime_state_from(Some(0)), Some(true));
        assert_eq!(realtime_state_from(Some(1)), Some(false));
        assert_eq!(realtime_state_from(None), None);
        assert_eq!(realtime_state_from(Some(2)), None);
    }

    #[test]
    fn normalize_unifies_separators_and_case() {
        assert_eq!(normalize_for_compare(r"C:\Work\Demo\"), r"c:\work\demo");
        assert_eq!(normalize_for_compare("C:/Work/Demo"), r"c:\work\demo");
        assert_eq!(normalize_for_compare(r"D:\"), r"d:\");
    }

    #[test]
    fn exclusion_matches_exact_and_parent() {
        let exclusions = vec![r"C:\Users\me\Projects".to_string()];
        assert!(exclusion_matches(&exclusions, r"C:\Users\me\Projects"));
        assert!(exclusion_matches(&exclusions, r"C:\Users\me\Projects\demo\"));
        assert!(exclusion_matches(&exclusions, r"c:/users/me/projects/demo"));
        assert!(!exclusion_matches(&exclusions, r"C:\Users\me\Projects2"));
        assert!(!exclusion_matches(&exclusions, r"D:\Other"));
    }

    #[test]
    fn empty_exclusions_never_match() {
        assert!(!exclusion_matches(&[], r"C:\x"));
        assert!(!exclusion_matches(&["".to_string()], r"C:\x"));
    }
}
