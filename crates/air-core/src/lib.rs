//! air-core：共享类型与错误定义（不依赖 Tauri）。

use serde::{Deserialize, Serialize};

pub type AirResult<T> = Result<T, AirError>;

/// 统一错误类型：序列化为 { code, message } 供 IPC 错误呈现（3.15）。
#[derive(Debug, thiserror::Error)]
pub enum AirError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("Git 错误: {0}")]
    Git(String),
    #[error("语言服务器错误: {0}")]
    Lsp(String),
    #[error("{0}")]
    Other(String),
}

impl AirError {
    pub fn other(msg: impl Into<String>) -> Self {
        AirError::Other(msg.into())
    }
}

impl Serialize for AirError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct Repr {
            code: &'static str,
            message: String,
        }
        let code = match self {
            AirError::Io(_) => "io",
            AirError::Git(_) => "git",
            AirError::Lsp(_) => "lsp",
            AirError::Other(_) => "other",
        };
        Repr {
            code,
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

/// IPC 二进制信封（fs_read_file 等大 payload 用，见 3.5）：
/// `[u32 LE meta_len][meta JSON][payload bytes]`
pub mod envelope {
    use super::{AirError, AirResult};

    pub fn encode(meta: &[u8], payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(4 + meta.len() + payload.len());
        out.extend_from_slice(&(meta.len() as u32).to_le_bytes());
        out.extend_from_slice(meta);
        out.extend_from_slice(payload);
        out
    }

    #[derive(Debug)]
    pub struct Decoded<'a> {
        pub meta: &'a [u8],
        pub payload: &'a [u8],
    }

    pub fn decode(buf: &[u8]) -> AirResult<Decoded<'_>> {
        if buf.len() < 4 {
            return Err(AirError::other("信封过短"));
        }
        let meta_len = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
        let start = 4 + meta_len;
        if buf.len() < start {
            return Err(AirError::other("信封 meta 长度非法"));
        }
        Ok(Decoded {
            meta: &buf[4..start],
            payload: &buf[start..],
        })
    }
}

/// 埋点数据落盘用的记录条目（bench.jsonl）。
#[derive(Debug, Serialize, Deserialize)]
pub struct BenchRecord {
    pub metric: String,
    pub ms: f64,
    pub ts: String,
    pub detail: Option<String>,
}
