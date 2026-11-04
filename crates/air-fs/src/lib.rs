//! air-fs：文件读写、编码/行尾/BOM 检测、目录列表、大文件与二进制判定。
//! 铁律：路径一律 PathBuf，禁止字符串拼接（1.5-7）。

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use air_core::AirResult;
use serde::Serialize;

/// 文件编码。检测顺序：UTF-8 严格 → GB18030 → Latin-1（见 1.5-1）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EncodingKind {
    Utf8,
    Utf16Le,
    Utf16Be,
    Gb18030,
    Latin1,
}

impl EncodingKind {
    pub fn from_name(name: &str) -> Option<Self> {
        match name.to_ascii_lowercase().as_str() {
            "utf-8" => Some(EncodingKind::Utf8),
            "utf-16le" => Some(EncodingKind::Utf16Le),
            "utf-16be" => Some(EncodingKind::Utf16Be),
            "gb18030" => Some(EncodingKind::Gb18030),
            "latin1" => Some(EncodingKind::Latin1),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            EncodingKind::Utf8 => "utf-8",
            EncodingKind::Utf16Le => "utf-16le",
            EncodingKind::Utf16Be => "utf-16be",
            EncodingKind::Gb18030 => "gb18030",
            EncodingKind::Latin1 => "latin1",
        }
    }

    fn rs(self) -> &'static encoding_rs::Encoding {
        match self {
            // encoding_rs 无纯 Latin-1，用 Windows-1252 近似（1252 ⊃ Latin-1 的可打印区）。
            EncodingKind::Latin1 => encoding_rs::WINDOWS_1252,
            EncodingKind::Utf8 => encoding_rs::UTF_8,
            EncodingKind::Utf16Le => encoding_rs::UTF_16LE,
            EncodingKind::Utf16Be => encoding_rs::UTF_16BE,
            EncodingKind::Gb18030 => encoding_rs::GB18030,
        }
    }
}

/// 行尾类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EolKind {
    Lf,
    Crlf,
    Mixed,
}

impl EolKind {
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "lf" => Some(EolKind::Lf),
            "crlf" => Some(EolKind::Crlf),
            "mixed" => Some(EolKind::Mixed),
            _ => None,
        }
    }
}

/// read_text 的返回：解码后文本（已去 BOM、行尾归一为 \n）+ 元数据。
#[derive(Debug)]
pub struct TextFile {
    pub text: String,
    pub encoding: EncodingKind,
    pub eol: EolKind,
    pub has_bom: bool,
    pub size: u64,
}

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

/// 检测编码并解码。返回 (文本, 编码, 是否有 BOM)。
/// 文本行尾保持原样（调用方用 detect_eol / normalize_eol 处理）。
pub fn detect_and_decode(bytes: &[u8]) -> (String, EncodingKind, bool) {
    if bytes.starts_with(UTF8_BOM) {
        let (cow, _, had_errors) = encoding_rs::UTF_8.decode_without_bom_handling(&bytes[3..]);
        if !had_errors {
            return (cow.into_owned(), EncodingKind::Utf8, true);
        }
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let (cow, _, had_errors) = encoding_rs::UTF_16LE.decode_without_bom_handling(&bytes[2..]);
        if !had_errors {
            return (cow.into_owned(), EncodingKind::Utf16Le, true);
        }
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let (cow, _, had_errors) = encoding_rs::UTF_16BE.decode_without_bom_handling(&bytes[2..]);
        if !had_errors {
            return (cow.into_owned(), EncodingKind::Utf16Be, true);
        }
    }
    // UTF-8 严格解码（必须先于 GB18030：多字节 UTF-8 大多也是合法 GBK 序列）
    let (cow, _, had_errors) = encoding_rs::UTF_8.decode(bytes);
    if !had_errors {
        return (cow.into_owned(), EncodingKind::Utf8, false);
    }
    // GB18030（GBK/GB2312 的超集）
    let (cow, _, had_errors) = encoding_rs::GB18030.decode(bytes);
    if !had_errors {
        return (cow.into_owned(), EncodingKind::Gb18030, false);
    }
    // Latin-1（Windows-1252 近似）永不失败
    let (cow, _, _) = encoding_rs::WINDOWS_1252.decode(bytes);
    (cow.into_owned(), EncodingKind::Latin1, false)
}

/// 检测行尾类型。
pub fn detect_eol(text: &str) -> EolKind {
    let mut crlf = 0usize;
    let mut lf = 0usize;
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\r' && i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
            crlf += 1;
            i += 2;
        } else {
            if bytes[i] == b'\n' {
                lf += 1;
            }
            i += 1;
        }
    }
    match (crlf, lf) {
        (0, _) => EolKind::Lf,
        (_, 0) => EolKind::Crlf,
        _ => EolKind::Mixed,
    }
}

/// 归一行尾为 \n。
pub fn normalize_eol(text: &str) -> String {
    if !text.contains('\r') {
        return text.to_string();
    }
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// 读文本文件（同步 IO，调用方负责 spawn_blocking）。
pub fn read_text(path: &Path) -> AirResult<TextFile> {
    let bytes = fs::read(path)?;
    let size = bytes.len() as u64;
    let (raw, encoding, has_bom) = detect_and_decode(&bytes);
    let eol = detect_eol(&raw);
    let text = normalize_eol(&raw);
    Ok(TextFile {
        text,
        encoding,
        eol,
        has_bom,
        size,
    })
}

/// 写文本文件：text 为 \n 归一内容，按 eol 转回目标行尾，按 encoding 编码，原子写（tmp + rename）。
/// Mixed 写回归一为 LF（P0 决策，记入 DEVLOG；P1 在状态栏提供统一入口）。
pub fn write_text(
    path: &Path,
    text: &str,
    encoding: EncodingKind,
    has_bom: bool,
    eol: EolKind,
) -> AirResult<()> {
    let normalized = normalize_eol(text);
    let text = match eol {
        EolKind::Crlf => normalized.replace('\n', "\r\n"),
        EolKind::Lf | EolKind::Mixed => normalized,
    };
    let mut bytes = match encoding {
        EncodingKind::Utf8 => text.into_bytes(),
        EncodingKind::Gb18030 => {
            let (cow, _, had_errors) = encoding_rs::GB18030.encode(&text);
            if had_errors {
                return Err(air_core::AirError::other("内容含 GB18030 无法表示的字符"));
            }
            cow.into_owned()
        }
        EncodingKind::Utf16Le => {
            let (cow, _, had_errors) = encoding_rs::UTF_16LE.encode(&text);
            if had_errors {
                return Err(air_core::AirError::other("UTF-16LE 编码失败"));
            }
            cow.into_owned()
        }
        EncodingKind::Utf16Be => {
            let (cow, _, had_errors) = encoding_rs::UTF_16BE.encode(&text);
            if had_errors {
                return Err(air_core::AirError::other("UTF-16BE 编码失败"));
            }
            cow.into_owned()
        }
        EncodingKind::Latin1 => {
            let (cow, _, had_errors) = encoding_rs::WINDOWS_1252.encode(&text);
            if had_errors {
                return Err(air_core::AirError::other("内容含 Latin-1 无法表示的字符"));
            }
            cow.into_owned()
        }
    };
    // BOM：UTF-8 与 UTF-16 手动补（GB18030 BOM 极罕见，忽略）
    if has_bom {
        let bom: &[u8] = match encoding {
            EncodingKind::Utf8 => UTF8_BOM,
            EncodingKind::Utf16Le => &[0xFF, 0xFE],
            EncodingKind::Utf16Be => &[0xFE, 0xFF],
            _ => &[],
        };
        if !bom.is_empty() {
            let mut with_bom = bom.to_vec();
            with_bom.extend_from_slice(&bytes);
            bytes = with_bom;
        }
    }

    // 原子写：同目录 tmp + rename
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = tmp_sibling(path);
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

fn tmp_sibling(path: &Path) -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    path.with_extension(format!(
        "{}.{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or(""),
        std::process::id() * 1_000_000 + (now % 1_000_000) as u32
    ))
}

#[derive(Debug, Clone, Serialize)]
pub struct TreeEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

/// 单层目录列表（文件树懒加载用，按 目录优先+名称 排序）。
pub fn list_dir(dir: &Path) -> AirResult<Vec<TreeEntry>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir)? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        out.push(TreeEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            is_dir,
            size,
        });
    }
    out.sort_by(|a, b| match (b.is_dir, a.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

/// 二进制嗅探：前 8KB 含 NUL 视为二进制。
pub fn is_binary(path: &Path) -> AirResult<bool> {
    use std::io::Read;
    let mut f = fs::File::open(path)?;
    let mut head = [0u8; 8192];
    let n = f.read(&mut head)?;
    Ok(head[..n].contains(&0))
}

/// 大文件阈值判定（3.8：2MB 降级 / 10MB 只读 / 50MB 不加载）。
pub const EDITOR_DISABLE_THRESHOLD: u64 = 2 * 1024 * 1024;
pub const READONLY_THRESHOLD: u64 = 10 * 1024 * 1024;
pub const NO_LOAD_THRESHOLD: u64 = 50 * 1024 * 1024;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_eol() {
        assert_eq!(detect_eol("a\nb\n"), EolKind::Lf);
        assert_eq!(detect_eol("a\r\nb\r\n"), EolKind::Crlf);
        assert_eq!(detect_eol("a\r\nb\n"), EolKind::Mixed);
        assert_eq!(detect_eol("no newline"), EolKind::Lf);
    }

    #[test]
    fn test_normalize_eol() {
        assert_eq!(normalize_eol("a\r\nb\rc\n"), "a\nb\nc\n");
    }

    #[test]
    fn test_detect_encoding_gbk() {
        // 你好 in GBK = C4 E3 BA C3
        let (text, enc, bom) = detect_and_decode(&[0xC4, 0xE3, 0xBA, 0xC3]);
        assert_eq!(text, "你好");
        assert_eq!(enc, EncodingKind::Gb18030);
        assert!(!bom);
    }

    #[test]
    fn test_detect_utf8_strict_before_gb() {
        // "é" 的 UTF-8 表示（C3 A9）也是合法 GBK 序列，UTF-8 严格必须优先。
        let (text, enc, _) = detect_and_decode(&[0xC3, 0xA9]);
        assert_eq!(text, "é");
        assert_eq!(enc, EncodingKind::Utf8);
    }

    #[test]
    fn test_bom_roundtrip() {
        let dir = std::env::temp_dir().join(format!("air_fs_test1_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("bom.txt");
        let content = "hello\nworld\n";
        write_text(&p, content, EncodingKind::Utf8, true, EolKind::Lf).unwrap();
        let raw = fs::read(&p).unwrap();
        assert!(raw.starts_with(UTF8_BOM));
        let tf = read_text(&p).unwrap();
        assert!(tf.has_bom);
        assert_eq!(tf.text, content);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_gbk_write_roundtrip() {
        let dir = std::env::temp_dir().join(format!("air_fs_test2_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("gbk.txt");
        write_text(&p, "你好\n", EncodingKind::Gb18030, false, EolKind::Lf).unwrap();
        let raw = fs::read(&p).unwrap();
        assert_eq!(raw, vec![0xC4, 0xE3, 0xBA, 0xC3, 0x0A]);
        let tf = read_text(&p).unwrap();
        assert_eq!(tf.encoding, EncodingKind::Gb18030);
        assert_eq!(tf.text, "你好\n");
        fs::remove_dir_all(&dir).ok();
    }
}
