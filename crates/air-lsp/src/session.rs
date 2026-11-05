use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use air_core::{AirError, AirResult};

use crate::{probe_server, read_frame, write_frame, ProbeResult, ServerKind};

// 会话事件（发给前端）。
#[derive(Debug, Clone)]
pub enum SessionEvent {    /// 一个完整 LSP 消息（JSON 文本）
    Message(String),
    /// 状态变化
    State(SessionState),
    /// stderr 一行
    Stderr(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    Starting,
    Running,
    Stopped,
    Failed,
}

pub type SessionId = u64;

/// 内置 servers 目录（管理面板一键下载的目标，2.6）。
/// 下载的服务器经此目录被 PATH 解析（启动时由 main 注入进程 PATH）。
pub fn servers_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("AirIDE").join("servers"))
}

/// 把内置 servers 目录前置到当前进程 PATH（应用启动时调用一次；
/// 之后所有子进程继承，下载的服务器可被按名解析）。
pub fn register_servers_on_path() {
    let Some(servers) = servers_dir() else {
        return;
    };
    if !servers.is_dir() {
        return;
    }
    let base = std::env::var("PATH").unwrap_or_default();
    let joined = format!("{};{}", servers.display(), base);
    // 安全：仅修改本进程环境，值来自受控目录
    std::env::set_var("PATH", joined);
}

/// 单个语言服务器会话。
pub struct Session {
    pub id: SessionId,
    pub kind: ServerKind,
    child: Child,
    stdin: ChildStdin,
    state: Arc<Mutex<SessionState>>,
    last_active: Arc<Mutex<Instant>>,
    stopped: Arc<AtomicBool>,
}

impl Session {
    /// 启动服务器并开启两个 Reader 线程（stdout → Message，stderr → Stderr）。
    ///
    /// 安全设计：spawn 处的程序名是编译期字面量（按注册表逐分支展开），
    /// 由操作系统按 PATH 解析；root 只作为工作目录。全程不经 shell。
    pub fn start(
        id: SessionId,
        kind: ServerKind,
        root: &Path,
        tx: Sender<SessionEvent>,
    ) -> AirResult<Self> {
        // 未安装时给出可操作提示（2.6 三级策略第二级）
        if probe_server(kind) == ProbeResult::Missing {
            return Err(AirError::Lsp(format!(
                "{} 未安装。{}",
                kind.display_name(),
                kind.install_hint()
            )));
        }

        // 每种语言一个分支：程序名与参数均为字面量
        let mut child = match kind {
            ServerKind::Phpantom => Command::new("phpantom")
                .args(["--stdio"])
                .current_dir(root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| AirError::Lsp(format!("启动 phpantom 失败: {e}")))?,            ServerKind::Gopls => Command::new("gopls")
                .args(["serve"])
                .current_dir(root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| AirError::Lsp(format!("启动 gopls 失败: {e}")))?,
            ServerKind::Basedpyright => Command::new("basedpyright-langserver")
                .args(["--stdio"])
                .current_dir(root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| AirError::Lsp(format!("启动 basedpyright 失败: {e}")))?,
            ServerKind::RustAnalyzer => Command::new("rust-analyzer")
                .current_dir(root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| AirError::Lsp(format!("启动 rust-analyzer 失败: {e}")))?,
            ServerKind::TypescriptLanguageServer => Command::new("typescript-language-server")
                .args(["--stdio"])
                .current_dir(root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| AirError::Lsp(format!("启动 tsserver 失败: {e}")))?,
            ServerKind::Clangd => Command::new("clangd")
                .current_dir(root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| AirError::Lsp(format!("启动 clangd 失败: {e}")))?,
            ServerKind::VscodeLangserversExtracted => Command::new("vscode-json-language-server")
                .args(["--stdio"])
                .current_dir(root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| AirError::Lsp(format!("启动 vscode-json 失败: {e}")))?,
        };

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AirError::Lsp("无法获取 stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AirError::Lsp("无法获取 stdout".into()))?;
        let stderr = child.stderr.take();

        let state = Arc::new(Mutex::new(SessionState::Starting));
        let last_active = Arc::new(Mutex::new(Instant::now()));
        let stopped = Arc::new(AtomicBool::new(false));

        // stdout Reader：分帧 → Message
        {
            let tx = tx.clone();
            let state = state.clone();
            std::thread::spawn(move || {
                let mut reader = BufReader::new(stdout);
                loop {
                    match read_frame(&mut reader) {
                        Ok(Some(msg)) => {
                            if let Ok(mut s) = state.lock() {
                                if *s == SessionState::Starting {
                                    *s = SessionState::Running;
                                }
                            }
                            let _ = tx.send(SessionEvent::Message(msg));
                        }
                        Ok(None) => break,
                        Err(e) => {
                            let _ = tx.send(SessionEvent::Stderr(format!("帧错误: {e}")));
                            break;
                        }
                    }
                }
                if let Ok(mut s) = state.lock() {
                    *s = SessionState::Stopped;
                }
                let _ = tx.send(SessionEvent::State(SessionState::Stopped));
            });
        }

        // stderr Reader：落日志（不进协议流）
        if let Some(stderr) = stderr {
            let tx2 = tx.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    tracing::debug!(target: "lsp", "stderr: {line}");
                    let _ = tx2.send(SessionEvent::Stderr(line));
                }
            });
        }

        Ok(Self {
            id,
            kind,
            child,
            stdin,
            state,
            last_active,
            stopped,
        })
    }

    /// 发送消息（前端 → 服务器）。
    pub fn send(&mut self, message: &str) -> AirResult<()> {
        if let Ok(mut t) = self.last_active.lock() {
            *t = Instant::now();
        }
        write_frame(&mut self.stdin, message)
    }

    /// 是否还在运行。
    pub fn is_running(&self) -> bool {
        matches!(
            self.state.lock().map(|s| *s).unwrap_or(SessionState::Failed),
            SessionState::Starting | SessionState::Running
        )
    }

    /// idle 分钟数（idle 回收用，3.14 默认 10 分钟）。
    pub fn idle_minutes(&self) -> u64 {
        self.last_active
            .lock()
            .map(|t| t.elapsed().as_secs() / 60)
            .unwrap_or(0)
    }

    /// 停止（Drop 也会调用）。
    pub fn stop(&mut self) {
        self.stopped.store(true, Ordering::SeqCst);
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Ok(mut s) = self.state.lock() {
            *s = SessionState::Stopped;
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.stop();
    }
}

/// 会话池（Host）：按语言管理会话，崩溃退避重启，idle 回收。
pub struct Host {
    sessions: HashMap<String, Session>,
    next_id: SessionId,
    /// 崩溃次数（退避）：language → count
    crashes: HashMap<String, u32>,
}

impl Host {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            next_id: 1,
            crashes: HashMap::new(),
        }
    }

    /// 获取或启动某语言的会话。返回会话 ID。
    pub fn ensure(
        &mut self,
        language: &str,
        root: &Path,
        tx: Sender<SessionEvent>,
    ) -> AirResult<SessionId> {
        if let Some(s) = self.sessions.get(language) {
            if s.is_running() {
                return Ok(s.id);
            }
            // 已退出：移除后重开
            self.sessions.remove(language);
        }
        let kind = ServerKind::from_language(language)
            .ok_or_else(|| AirError::Lsp(format!("不支持的语言: {language}")))?;

        // 崩溃退避：连续崩溃 3 次后拒绝自动重启（等用户手动）
        let crashes = self.crashes.get(language).copied().unwrap_or(0);
        if crashes >= 3 {
            return Err(AirError::Lsp(format!(
                "{} 连续崩溃 {crashes} 次，已停止自动重启；请在管理面板手动重启",
                kind.display_name()
            )));
        }

        let id = self.next_id;
        self.next_id += 1;
        let session = Session::start(id, kind, root, tx)?;
        self.sessions.insert(language.to_string(), session);
        self.crashes.remove(language);
        Ok(id)
    }

    /// 记录崩溃（Reader 发现 EOF 时由调用方调用）。
    pub fn note_crash(&mut self, language: &str) {
        *self.crashes.entry(language.to_string()).or_insert(0) += 1;
    }

    /// 重置崩溃计数（手动重启时）。
    pub fn reset_crashes(&mut self, language: &str) {
        self.crashes.remove(language);
    }

    /// 发送消息。
    pub fn send(&mut self, session_id: SessionId, message: &str) -> AirResult<()> {
        let session = self
            .sessions
            .values_mut()
            .find(|s| s.id == session_id)
            .ok_or_else(|| AirError::Lsp(format!("会话 {session_id} 不存在")))?;
        session.send(message)
    }

    /// 按语言停止会话。
    pub fn stop(&mut self, language: &str) {
        if let Some(mut s) = self.sessions.remove(language) {
            s.stop();
        }
        self.crashes.remove(language);
    }

    /// 全部停止（切项目/退出）。
    pub fn stop_all(&mut self) {
        for (_, mut s) in self.sessions.drain() {
            s.stop();
        }
    }

    /// idle 回收（超过 idle_minutes 的会话关掉）。
    pub fn reap_idle(&mut self, idle_minutes: u64) {
        let idle: Vec<String> = self
            .sessions
            .iter()
            .filter(|(_, s)| s.idle_minutes() >= idle_minutes)
            .map(|(lang, _)| lang.clone())
            .collect();
        for lang in idle {
            tracing::info!("idle 回收语言服务器: {lang}");
            self.stop(&lang);
        }
    }

    /// 各语言会话状态（管理面板用）：(语言, 运行中, idle 分钟)。
    pub fn status(&self) -> Vec<(String, bool, u64)> {
        self.sessions
            .iter()
            .map(|(lang, s)| (lang.clone(), s.is_running(), s.idle_minutes()))
            .collect()
    }

    /// 某语言的会话 ID（若在运行）。
    pub fn session_id_of(&self, language: &str) -> Option<SessionId> {
        self.sessions
            .get(language)
            .filter(|s| s.is_running())
            .map(|s| s.id)
    }
}

impl Default for Host {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.stop_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_write_frame_roundtrip() {
        let msg = r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
        let mut buf: Vec<u8> = Vec::new();
        write_frame(&mut buf, msg).unwrap();
        assert!(buf.starts_with(b"Content-Length:"));

        let mut reader = std::io::BufReader::new(std::io::Cursor::new(buf));
        let out = read_frame(&mut reader).unwrap().unwrap();
        assert_eq!(out, msg);
    }

    #[test]
    fn test_read_frame_eof() {
        let mut reader = std::io::BufReader::new(std::io::Cursor::new(Vec::<u8>::new()));
        assert!(read_frame(&mut reader).unwrap().is_none());
    }

    #[test]
    fn test_read_frame_multiple() {
        let mut buf: Vec<u8> = Vec::new();
        write_frame(&mut buf, r#"{"a":1}"#).unwrap();
        write_frame(&mut buf, r#"{"b":2}"#).unwrap();
        let mut reader = std::io::BufReader::new(std::io::Cursor::new(buf));
        assert_eq!(read_frame(&mut reader).unwrap().unwrap(), r#"{"a":1}"#);
        assert_eq!(read_frame(&mut reader).unwrap().unwrap(), r#"{"b":2}"#);
        assert!(read_frame(&mut reader).unwrap().is_none());
    }

    #[test]
    fn test_read_frame_chinese_content() {
        let msg = r#"{"method":"textDocument/publishDiagnostics","params":{"message":"中文诊断"}}"#;
        let mut buf: Vec<u8> = Vec::new();
        write_frame(&mut buf, msg).unwrap();
        let mut reader = std::io::BufReader::new(std::io::Cursor::new(buf));
        assert_eq!(read_frame(&mut reader).unwrap().unwrap(), msg);
    }

    #[test]
    fn test_read_frame_bad_missing_length() {
        let raw = b"Content-Type: application/json\r\n\r\n{}";
        let mut reader = std::io::BufReader::new(std::io::Cursor::new(raw.to_vec()));
        assert!(read_frame(&mut reader).is_err(), "缺少 Content-Length 应报错");
    }

    #[test]
    fn test_registry_mapping() {
        assert_eq!(ServerKind::from_language("php"), Some(ServerKind::Phpantom));
        assert_eq!(ServerKind::from_language("go"), Some(ServerKind::Gopls));
        assert_eq!(ServerKind::from_language("python"), Some(ServerKind::Basedpyright));
        assert_eq!(ServerKind::from_language("rust"), Some(ServerKind::RustAnalyzer));
        assert_eq!(ServerKind::from_language("typescript"), Some(ServerKind::TypescriptLanguageServer));
        assert_eq!(ServerKind::from_language("javascript"), Some(ServerKind::TypescriptLanguageServer));
        assert_eq!(ServerKind::from_language("unknown-lang"), None);
    }

    #[test]
    fn test_program_names_are_safe_literals() {
        for kind in [
            ServerKind::Phpantom,
            ServerKind::Gopls,
            ServerKind::Basedpyright,
            ServerKind::RustAnalyzer,
            ServerKind::TypescriptLanguageServer,
            ServerKind::Clangd,
            ServerKind::VscodeLangserversExtracted,
        ] {
            let p = kind.program();
            assert!(!p.is_empty());
            assert!(
                p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
                "程序名只含安全字符: {p}"
            );
            assert!(!kind.display_name().is_empty());
            assert!(!kind.install_hint().is_empty());
        }
    }

    #[test]
    fn test_host_crash_backoff() {
        let mut host = Host::new();
        for _ in 0..3 {
            host.note_crash("go");
        }
        let (tx, _rx) = std::sync::mpsc::channel();
        let err = host.ensure("go", &std::env::temp_dir(), tx).unwrap_err();
        assert!(err.to_string().contains("连续崩溃"), "3 次崩溃后应拒绝重启: {err}");
        host.reset_crashes("go");
        // 重置后不再因崩溃被拒（可能因未安装报另一个错）
        let (tx2, _rx2) = std::sync::mpsc::channel();
        let r = host.ensure("go", &std::env::temp_dir(), tx2);
        assert!(r.is_err());
        assert!(!r.unwrap_err().to_string().contains("连续崩溃"));
    }

    #[test]
    fn test_host_unknown_language() {
        let mut host = Host::new();
        let (tx, _rx) = std::sync::mpsc::channel();
        let err = host
            .ensure("brainfuck", &std::env::temp_dir(), tx)
            .unwrap_err();
        assert!(err.to_string().contains("不支持的语言"));
    }
}
