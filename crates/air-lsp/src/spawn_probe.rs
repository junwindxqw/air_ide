// 最小实验 11：match 每个分支内联完整 spawn（程序名为直接字面量）。
use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Clone, Copy)]
pub enum Kind {
    A,
    B,
}

pub fn start(kind: Kind, root: &Path) -> std::io::Result<()> {
    let child = match kind {
        Kind::A => Command::new("prog-a")
            .current_dir(root)
            .args(["--stdio"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?,
        Kind::B => Command::new("prog-b")
            .current_dir(root)
            .args(["serve"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?,
    };
    drop(child);
    Ok(())
}
