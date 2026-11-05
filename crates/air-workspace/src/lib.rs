//! air-workspace：会话、草稿、设置、最近项目的持久化（3.10）。
//! 全部走 %APPDATA%\AirIDE；设置带 schemaVersion 迁移；草稿有体积上限。

use std::path::{Path, PathBuf};

use air_core::{AirError, AirResult};
use serde::{de::DeserializeOwned, Serialize};

// [[NEXT]]

/// %APPDATA%\AirIDE（设置与会话）与 %LOCALAPPDATA%\AirIDE（日志/基准）分开。
pub fn app_data_dir() -> AirResult<PathBuf> {
    std::env::var_os("APPDATA")
        .map(|p| PathBuf::from(p).join("AirIDE"))
        .ok_or_else(|| AirError::other("APPDATA 未设置"))
}

/// 原子写 JSON（tmp + rename，3.10）。
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> AirResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(value)?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// 读 JSON；文件缺失返回 None，损坏返回 Err（调用方按 3.10 回退默认并备份）。
pub fn read_json<T: DeserializeOwned>(path: &Path) -> AirResult<Option<T>> {
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(path)?;
    match serde_json::from_str(&text) {
        Ok(v) => Ok(Some(v)),
        Err(e) => Err(AirError::other(format!(
            "{} 解析失败: {e}",
            path.display()
        ))),
    }
}

/// 损坏文件备份为 .bak（3.10：不静默覆盖）。
pub fn backup_corrupt(path: &Path) {
    if path.exists() {
        let bak = path.with_extension("bak.json");
        let bak_display = bak.display().to_string();
        if std::fs::rename(path, &bak).is_ok() {
            tracing::warn!("配置文件损坏，已备份为 {bak_display}");
        }
    }
}

/// 会话（3.10）：打开的文件、光标、面板尺寸、工具窗状态。
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    #[serde(default)]
    pub workspace_root: Option<String>,
    #[serde(default)]
    pub open_files: Vec<OpenFileEntry>,
    #[serde(default)]
    pub active_file: Option<String>,
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
}

fn default_schema_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileEntry {
    pub path: String,
    #[serde(default)]
    pub cursor_line: u32,
    #[serde(default)]
    pub cursor_col: u32,
    #[serde(default)]
    pub preview: bool,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            workspace_root: None,
            open_files: Vec::new(),
            active_file: None,
            schema_version: default_schema_version(),
        }
    }
}

/// 草稿（3.10）：未保存内容落盘，单文件 ≤512KB、总量 ≤8MB，超限不落盘。
pub const DRAFT_SINGLE_LIMIT: usize = 512 * 1024;
pub const DRAFT_TOTAL_LIMIT: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct DraftWrite {
    pub path: String,
    pub text: String,
}

/// 写草稿。返回 false 表示超限未落盘（调用方需在 UI 标注"未落盘"）。
pub fn write_drafts(drafts: &[DraftWrite]) -> AirResult<Vec<bool>> {
    let dir = app_data_dir()?.join("drafts");
    std::fs::create_dir_all(&dir)?;

    // 总量检查：现有 + 新增
    let mut existing_total = 0u64;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            if let Ok(m) = e.metadata() {
                existing_total += m.len();
            }
        }
    }

    let mut results = Vec::with_capacity(drafts.len());
    for d in drafts {
        let size = d.text.len();
        if size > DRAFT_SINGLE_LIMIT || existing_total as usize + size > DRAFT_TOTAL_LIMIT {
            results.push(false);
            continue;
        }
        existing_total += size as u64;
        let name = draft_file_name(&d.path);
        let full = dir.join(name);
        if write_json(&full, &serde_json::json!({ "path": d.path, "text": d.text })).is_ok() {
            results.push(true);
        } else {
            results.push(false);
        }
    }
    Ok(results)
}

/// 路径 → 草稿文件名（稳定哈希，避免路径中的非法字符）。
fn draft_file_name(path: &str) -> String {
    // FNV-1a 64 位：零依赖、稳定
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in path.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}.json")
}

/// 读全部草稿（恢复会话用）。
pub fn read_all_drafts() -> AirResult<Vec<DraftWrite>> {
    let dir = app_data_dir()?.join("drafts");
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for e in std::fs::read_dir(&dir)?.flatten() {
        let Ok(text) = std::fs::read_to_string(e.path()) else {
            continue;
        };
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            if let (Some(p), Some(t)) = (v.get("path").and_then(|x| x.as_str()), v.get("text").and_then(|x| x.as_str())) {
                out.push(DraftWrite {
                    path: p.to_string(),
                    text: t.to_string(),
                });
            }
        }
    }
    Ok(out)
}

/// 删除单条草稿（保存成功后调用）。
pub fn delete_draft(path: &str) -> AirResult<()> {
    let full = app_data_dir()?.join("drafts").join(draft_file_name(path));
    if full.exists() {
        std::fs::remove_file(full)?;
    }
    Ok(())
}

/// 设置（3.14）：分组 + 默认值 + schemaVersion 迁移。
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "current_schema_version")]
    pub schema_version: u32,

    #[serde(default)]
    pub editor: EditorSettings,
    #[serde(default)]
    pub appearance: AppearanceSettings,
    #[serde(default)]
    pub git: GitSettings,
    #[serde(default)]
    pub system: SystemSettings,
}

fn current_schema_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSettings {
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_line_height")]
    pub line_height: f32,
    #[serde(default = "default_true")]
    pub line_numbers: bool,
    #[serde(default = "default_true")]
    pub current_line_highlight: bool,
    #[serde(default = "default_true")]
    pub auto_reveal_in_tree: bool,
    #[serde(default = "default_true")]
    pub save_on_focus_loss: bool,
    #[serde(default = "default_large_file_threshold")]
    pub large_file_threshold_mb: u32,
    #[serde(default = "default_readonly_threshold")]
    pub readonly_threshold_mb: u32,
}

fn default_font_size() -> u32 {
    13
}
fn default_line_height() -> f32 {
    1.2
}
fn default_true() -> bool {
    true
}
fn default_large_file_threshold() -> u32 {
    2
}
fn default_readonly_threshold() -> u32 {
    10
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    #[serde(default = "default_theme")]
    pub theme: String,
}

fn default_theme() -> String {
    "system".into()
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSettings {
    #[serde(default)]
    pub exe_path: Option<String>,
    #[serde(default = "default_true")]
    pub signoff: bool,
    #[serde(default)]
    pub ignore_whitespace: bool,
    #[serde(default = "default_status_throttle")]
    pub status_throttle_ms: u32,
    #[serde(default = "default_split_view")]
    pub diff_default_split: bool,
}

fn default_status_throttle() -> u32 {
    300
}
fn default_split_view() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSettings {
    #[serde(default = "default_true")]
    pub single_instance: bool,
    #[serde(default = "default_true")]
    pub auto_update: bool,
    #[serde(default = "default_true")]
    pub defender_hint: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: current_schema_version(),
            editor: EditorSettings::default(),
            appearance: AppearanceSettings::default(),
            git: GitSettings::default(),
            system: SystemSettings::default(),
        }
    }
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            font_size: default_font_size(),
            line_height: default_line_height(),
            line_numbers: true,
            current_line_highlight: true,
            auto_reveal_in_tree: true,
            save_on_focus_loss: true,
            large_file_threshold_mb: default_large_file_threshold(),
            readonly_threshold_mb: default_readonly_threshold(),
        }
    }
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
        }
    }
}

impl Default for GitSettings {
    fn default() -> Self {
        Self {
            exe_path: None,
            signoff: true,
            ignore_whitespace: false,
            status_throttle_ms: default_status_throttle(),
            diff_default_split: true,
        }
    }
}

impl Default for SystemSettings {
    fn default() -> Self {
        Self {
            single_instance: true,
            auto_update: true,
            defender_hint: true,
        }
    }
}

/// 加载设置：损坏时回退默认并备份（3.10 规则）。
pub fn load_settings() -> Settings {
    let path = match app_data_dir() {
        Ok(d) => d.join("settings.json"),
        Err(_) => return Settings::default(),
    };
    match read_json::<Settings>(&path) {
        Ok(Some(s)) => migrate_settings(s),
        Ok(None) => Settings::default(),
        Err(e) => {
            tracing::warn!("设置加载失败({e})，回退默认值");
            backup_corrupt(&path);
            Settings::default()
        }
    }
}

/// schemaVersion 迁移（3.10）：按版本顺序执行；更高版本只读认识的字段。
fn migrate_settings(mut s: Settings) -> Settings {
    let current = current_schema_version();
    if s.schema_version > current {
        tracing::warn!(
            "设置版本 {} 高于当前 {}，按默认值补齐缺失字段",
            s.schema_version,
            current
        );
        s.schema_version = current;
        return s;
    }
    // 当前只有 v1；将来新增迁移分支：if s.schema_version < 2 { ... }
    s.schema_version = current;
    s
}

pub fn settings_path() -> AirResult<PathBuf> {
    Ok(app_data_dir()?.join("settings.json"))
}

pub fn save_settings(s: &Settings) -> AirResult<()> {
    write_json(&settings_path()?, s)
}

/// 最近项目（3.10：最多 20 条，置顶复用）。
pub fn load_recent_projects() -> Vec<String> {
    let path = match app_data_dir() {
        Ok(d) => d.join("recent.json"),
        Err(_) => return Vec::new(),
    };
    read_json::<Vec<String>>(&path)
        .ok()
        .flatten()
        .unwrap_or_default()
}

pub fn push_recent_project(path: &str) -> AirResult<()> {
    let mut list = load_recent_projects();
    list.retain(|p| p != path);
    list.insert(0, path.to_string());
    list.truncate(20);
    write_json(&app_data_dir()?.join("recent.json"), &list)
}

pub fn session_path() -> AirResult<PathBuf> {
    Ok(app_data_dir()?.join("session.json"))
}

pub fn load_session() -> Session {
    match read_json::<Session>(&session_path().unwrap_or_default()) {
        Ok(Some(s)) => s,
        _ => Session::default(),
    }
}

pub fn save_session(s: &Session) -> AirResult<()> {
    write_json(&session_path()?, s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_draft_file_name_stable() {
        // 同路径同哈希、不同路径不同哈希、无非法字符
        let a = draft_file_name("D:\\proj\\a.php");
        let b = draft_file_name("D:\\proj\\a.php");
        let c = draft_file_name("D:\\proj\\b.php");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(a.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '-'));
    }

    #[test]
    fn test_settings_defaults() {
        let s = Settings::default();
        assert_eq!(s.editor.font_size, 13);
        assert_eq!(s.editor.large_file_threshold_mb, 2);
        assert_eq!(s.editor.readonly_threshold_mb, 10);
        assert!(s.git.signoff);
        assert!(!s.git.ignore_whitespace);
        assert_eq!(s.git.status_throttle_ms, 300);
        assert_eq!(s.schema_version, 1);
    }

    #[test]
    fn test_settings_serde_roundtrip_with_defaults() {
        // 部分字段 JSON（模拟旧版本设置）→ 反序列化应补齐默认值
        let json = r#"{"editor":{"fontSize":16}}"#;
        let s: Settings = serde_json::from_str(json).unwrap();
        assert_eq!(s.editor.font_size, 16);
        assert_eq!(s.editor.large_file_threshold_mb, 2, "缺字段应补默认");
        assert_eq!(s.git.status_throttle_ms, 300);
    }

    #[test]
    fn test_migrate_settings_higher_version_keeps_known() {
        let json = r#"{"schemaVersion":99,"editor":{"fontSize":18}}"#;
        let s: Settings = serde_json::from_str(json).unwrap();
        let m = migrate_settings(s);
        assert_eq!(m.schema_version, 1, "高版本应降为当前版本号");
        assert_eq!(m.editor.font_size, 18, "认识的字段保留");
    }
}

// [[NEXT]]
