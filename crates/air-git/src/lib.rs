//! air-git：git CLI 封装与输出解析（2.7：CLI 优先，全部走 git.exe 绝对路径 + 参数数组）。
//! P1 范围：status（porcelain v2）+ file diff 解析；写操作（stage/commit）属 P3。

pub mod write;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use air_core::{AirError, AirResult};
use serde::Serialize;

// [[NEXT]]

/// 仓库定位：从任意目录向上找最近的 `.git`（3.6 工作区根与仓库根解耦）。
pub fn find_repo_root(start: &Path) -> Option<PathBuf> {
    let mut dir = Some(start);
    while let Some(d) = dir {
        if d.join(".git").exists() {
            return Some(d.to_path_buf());
        }
        dir = d.parent();
    }
    None
}

/// 定位 git.exe（3.12.6）：PATH → Program Files → LocalAppData → 注册表 InstallPath。
/// 结果缓存：PATH 逐项 exists() 探测在每条 git 命令前重复执行没有意义（P5-2）。
pub fn find_git() -> Option<PathBuf> {
    static CACHE: OnceLock<Option<PathBuf>> = OnceLock::new();
    CACHE.get_or_init(air_win::find_git).clone()
}

/// 构造 git 命令：绝对路径 + 参数数组，不经 shell（3.12.6）；
/// 固定 `-c core.quotepath=false` 避免中文文件名被转义（1.5-8）。
pub fn git_command(repo: &Path) -> Command {
    let exe = find_git().unwrap_or_else(|| PathBuf::from("git"));
    let mut cmd = Command::new(exe);
    cmd.arg("-c")
        .arg("core.quotepath=false")
        .current_dir(repo)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd
}

/// 执行 git 命令并返回 stdout 文本（UTF-8 严格解析，3.12.7）。
pub fn run_git(repo: &Path, args: &[&str]) -> AirResult<String> {
    let output = git_command(repo).args(args).output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        return Err(AirError::Git(format!(
            "git {} 失败: {}",
            args.join(" "),
            stderr.trim()
        )));
    }
    String::from_utf8(output.stdout)
        .map_err(|_| AirError::Git("git 输出不是合法 UTF-8".into()))
}

/// 状态条目类型（3.7.1）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StatusKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    TypeChange,
    Untracked,
    Conflict,
}

impl StatusKind {
    pub fn label(self) -> &'static str {
        match self {
            StatusKind::Modified => "M",
            StatusKind::Added => "A",
            StatusKind::Deleted => "D",
            StatusKind::Renamed => "R",
            StatusKind::Copied => "C",
            StatusKind::TypeChange => "T",
            StatusKind::Untracked => "?",
            StatusKind::Conflict => "!",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path: String,
    pub orig_path: Option<String>,
    pub kind: StatusKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub staged: Vec<StatusEntry>,
    pub unstaged: Vec<StatusEntry>,
    pub untracked: Vec<StatusEntry>,
    pub conflicted: Vec<StatusEntry>,
    /// 工作区根（传入的目录，可能与 repo root 不同，3.6）
    pub workspace_root: String,
}

/// 读仓库状态：`git status --porcelain=v2 -z --branch --untracked-files=all`。
/// -z 使记录以 NUL 分隔，中文/特殊字符文件名免转义（1.5-8）。
pub fn status(workspace_root: &Path) -> AirResult<RepoStatus> {
    let repo = find_repo_root(workspace_root)
        .ok_or_else(|| AirError::Git("非 Git 仓库".into()))?;
    let out = run_git(
        &repo,
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "--branch",
            "--untracked-files=all",
        ],
    )?;
    parse_status(&out, &workspace_root.to_string_lossy())
}

/// porcelain v2 记录类型（`-z` 模式下字段以 NUL 分隔）：
/// - `# branch.ab <ref> +<ahead> -<behind>`
/// - `u <xy> <path>`          未跟踪
/// - `1 <xy> <sub> <mH> <mI> <mW> <hH> <hI> <path>`  普通变更
/// - `2 <xy> <sub> <mH> <mI> <mW> <hH> <hI> <x><path>\0<origPath>` 重命名/复制
/// - `? <path>` 冲突标记行（porcelain v2 冲突也用 `u`）
pub fn parse_status(out: &str, workspace_root: &str) -> AirResult<RepoStatus> {
    let mut result = RepoStatus {
        branch: "HEAD".into(),
        upstream: None,
        ahead: 0,
        behind: 0,
        staged: Vec::new(),
        unstaged: Vec::new(),
        untracked: Vec::new(),
        conflicted: Vec::new(),
        workspace_root: workspace_root.to_string(),
    };

    // -z 输出：头部行（# branch.*）与记录都以 NUL 分隔。
    // 为兼容个别 git 版本用 \n 分隔头部，统一先按 NUL 切分、再容忍字段尾部换行。
    let fields: Vec<&str> = out
        .split('\0')
        .map(|s| s.strip_suffix('\n').unwrap_or(s))
        .filter(|s| !s.is_empty())
        .collect();

    let mut i = 0;
    while i < fields.len() {
        let rec = fields[i];
        if let Some(header) = rec.strip_prefix("# branch.") {
            parse_branch_header(header, &mut result);
            i += 1;
            continue;
        }
        if let Some(path) = rec.strip_prefix("? ") {
            result.untracked.push(StatusEntry {
                path: path.to_string(),
                orig_path: None,
                kind: StatusKind::Untracked,
            });
        } else if let Some(body) = rec.strip_prefix("1 ") {
            // 1 <xy> <sub> <mH> <mI> <mW> <hH> <hI> <path>
            let f: Vec<&str> = body.splitn(8, ' ').collect();
            if f.len() == 8 {
                push_ordinary(&mut result, f[0], f[7], None);
            }
        } else if let Some(body) = rec.strip_prefix("2 ") {
            // 2 <xy> <sub> <mH> <mI> <mW> <hH> <hI> <path>，随后跟一个 NUL 分隔的 origPath 字段
            let f: Vec<&str> = body.splitn(8, ' ').collect();
            if f.len() == 8 {
                let orig = fields.get(i + 1).map(|s| s.to_string());
                i += 1;
                push_ordinary(&mut result, f[0], f[7], orig);
            }
        } else if let Some(body) = rec.strip_prefix("u ") {
            // u <xy> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
            let f: Vec<&str> = body.rsplitn(2, ' ').collect();
            if f.len() == 2 {
                result.conflicted.push(StatusEntry {
                    path: f[0].to_string(),
                    orig_path: None,
                    kind: StatusKind::Conflict,
                });
            }
        }
        i += 1;
    }

    Ok(result)
}

/// `ab <ref> +<ahead> -<behind>` / `head <ref>` / `upstream <ref>`（已剥离 `# branch.` 前缀）。
fn parse_branch_header(rest: &str, result: &mut RepoStatus) {
    if let Some(body) = rest.strip_prefix("ab ") {
        let mut parts = body.split_whitespace();
        if let Some(head) = parts.next() {
            result.branch = head.to_string();
        }
        for p in parts {
            if let Some(n) = p.strip_prefix('+') {
                result.ahead = n.parse().unwrap_or(0);
            } else if let Some(n) = p.strip_prefix('-') {
                result.behind = n.parse().unwrap_or(0);
            }
        }
    } else if let Some(body) = rest.strip_prefix("head ") {
        result.branch = body.trim().to_string();
    } else if let Some(body) = rest.strip_prefix("upstream ") {
        result.upstream = Some(body.trim().to_string());
    }
}

/// xy 双状态码 → staged/unstaged 归属。X=index 侧，Y=worktree 侧（3.7.1）。
fn push_ordinary(
    result: &mut RepoStatus,
    xy: &str,
    path: &str,
    orig_path: Option<String>,
) {
    let mut chars = xy.chars();
    let x = chars.next().unwrap_or('.');
    let y = chars.next().unwrap_or('.');

    let kind_for = |c: char| -> Option<StatusKind> {
        match c {
            'M' => Some(StatusKind::Modified),
            'A' => Some(StatusKind::Added),
            'D' => Some(StatusKind::Deleted),
            'R' => Some(StatusKind::Renamed),
            'C' => Some(StatusKind::Copied),
            'T' => Some(StatusKind::TypeChange),
            'U' => Some(StatusKind::Conflict),
            _ => None,
        }
    };

    if x == 'U' || y == 'U' {
        result.conflicted.push(StatusEntry {
            path: path.to_string(),
            orig_path,
            kind: StatusKind::Conflict,
        });
        return;
    }

    if let Some(kind) = kind_for(x) {
        result.staged.push(StatusEntry {
            path: path.to_string(),
            orig_path: orig_path.clone(),
            kind,
        });
    }
    if let Some(kind) = kind_for(y) {
        result.unstaged.push(StatusEntry {
            path: path.to_string(),
            orig_path,
            kind,
        });
    }
}

// ── diff 解析（3.7.2 数据源：hunk 边界必须与 git diff 完全一致）──

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffLineKind {
    Context,
    Add,
    Delete,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub is_binary: bool,
    pub is_renamed: bool,
    pub hunks: Vec<Hunk>,
}

/// 取单文件 diff（unstaged 或 staged）。path 相对 repo 根。
pub fn diff_file(workspace_root: &Path, path: &str, staged: bool) -> AirResult<FileDiff> {
    diff_file_with_opts(workspace_root, path, staged, false)
}

/// `ignore_whitespace` 对应 `-w`（P2 的"忽略空白差异"开关）。
pub fn diff_file_with_opts(
    workspace_root: &Path,
    path: &str,
    staged: bool,
    ignore_whitespace: bool,
) -> AirResult<FileDiff> {
    Ok(diff_file_and_raw(workspace_root, path, staged, ignore_whitespace)?.0)
}

/// 一次 git 进程同时拿到「解析后的 FileDiff」与「原始 patch 文本」（P5-2）。
/// 打开 diff 时原来要各跑一个 `git diff`（解析 + 原文），合并后少一半进程开销。
pub fn diff_file_and_raw(
    workspace_root: &Path,
    path: &str,
    staged: bool,
    ignore_whitespace: bool,
) -> AirResult<(FileDiff, String)> {
    let repo = find_repo_root(workspace_root)
        .ok_or_else(|| AirError::Git("非 Git 仓库".into()))?;
    let mut args = vec![
        "diff".to_string(),
        "--no-color".to_string(),
        "--no-ext-diff".to_string(),
        "-U3".to_string(),
        // 显式开 rename 检测：不依赖用户 diff.renames 配置（3.7.2 重命名处理）
        "-M".to_string(),
    ];
    if ignore_whitespace {
        args.push("-w".to_string());
    }
    if staged {
        args.push("--cached".to_string());
    }
    args.push("--".to_string());
    args.push(path.to_string());
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = run_git(&repo, &refs)?;
    Ok((parse_diff(&out, path), out))
}

// ── log / blame（P2）──

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub sha: String,
    pub short_sha: String,
    pub author: String,
    pub date: String,
    pub subject: String,
    pub refs: Vec<String>,
    /// 简化分支图列号（P2：统一主干列，真实图形后续完善）
    pub graph_col: u32,
}

/// 分页读 log。
pub fn log(workspace_root: &Path, skip: u32, limit: u32) -> AirResult<Vec<LogEntry>> {
    let repo = find_repo_root(workspace_root)
        .ok_or_else(|| AirError::Git("非 Git 仓库".into()))?;
    let fmt = "%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1f%D";
    let out = run_git(
        &repo,
        &[
            "log",
            "--date=short",
            &format!("--skip={skip}"),
            &format!("-n{limit}"),
            &format!("--format={fmt}"),
        ],
    )?;
    let mut entries = Vec::new();
    for line in out.lines() {
        let f: Vec<&str> = line.split('\u{1f}').collect();
        if f.len() < 6 {
            continue;
        }
        let refs: Vec<String> = f[5]
            .split(", ")
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();
        entries.push(LogEntry {
            sha: f[0].to_string(),
            short_sha: f[1].to_string(),
            author: f[2].to_string(),
            date: f[3].to_string(),
            subject: f[4].to_string(),
            refs,
            graph_col: 0,
        });
    }
    Ok(entries)
}

/// blame：每行的 commit 摘要（`git blame --line-porcelain`）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub line_no: u32,
    pub sha: String,
    pub short_sha: String,
    pub author: String,
    pub date: String,
    pub summary: String,
}

pub fn blame(workspace_root: &Path, path: &str) -> AirResult<Vec<BlameLine>> {
    let repo = find_repo_root(workspace_root)
        .ok_or_else(|| AirError::Git("非 Git 仓库".into()))?;
    let out = run_git(&repo, &["blame", "--line-porcelain", "--", path])?;

    let mut lines = Vec::new();
    let mut cur: Option<BlameLine> = None;
    for raw in out.lines() {
        // 头部行：<sha> <origLine> <finalLine> [numLines]
        if !raw.starts_with('\t') && !raw.starts_with(' ') {
            let f: Vec<&str> = raw.split(' ').collect();
            if f.len() >= 3 && f[0].len() == 40 {
                cur = Some(BlameLine {
                    sha: f[0].to_string(),
                    short_sha: f[0][..8.min(f[0].len())].to_string(),
                    author: String::new(),
                    date: String::new(),
                    summary: String::new(),
                    line_no: f[2].parse().unwrap_or(0),
                });
                continue;
            }
        }
        if let Some(c) = cur.as_mut() {
            if let Some(v) = raw.strip_prefix("author ") {
                c.author = v.to_string();
            } else if let Some(v) = raw.strip_prefix("author-time ") {
                // Unix 时间戳 → 日期（简化：只取到日）
                if let Ok(ts) = v.parse::<i64>() {
                    let days = ts / 86400;
                    c.date = format!("day+{days}");
                }
            } else if let Some(v) = raw.strip_prefix("summary ") {
                c.summary = v.to_string();
            } else if raw.starts_with('\t') {
                // 行内容：blame 条目结束
                if let Some(done) = cur.take() {
                    lines.push(done);
                }
            }
        }
    }
    Ok(lines)
}

/// 解析 unified diff。未跟踪文件走 `/dev/null` → b/<path> 形式。
pub fn parse_diff(out: &str, fallback_path: &str) -> FileDiff {
    let mut diff = FileDiff {
        path: fallback_path.to_string(),
        old_path: None,
        is_binary: false,
        is_renamed: false,
        hunks: Vec::new(),
    };

    for line in out.lines() {
        if line.starts_with("diff --git ") {
            // diff --git a/<old> b/<new>；路径可能含空格，取 " b/" 后的部分
            if let Some(idx) = line.find(" b/") {
                diff.path = line[idx + 3..].to_string();
            }
        } else if let Some(p) = line.strip_prefix("rename from ") {
            diff.is_renamed = true;
            diff.old_path = Some(p.to_string());
        } else if line.starts_with("Binary files") || line.starts_with("GIT binary patch") {
            diff.is_binary = true;
        } else if line.starts_with("@@") {
            if let Some(h) = parse_hunk_header(line) {
                diff.hunks.push(h);
            }
        } else if let Some(hunk) = diff.hunks.last_mut() {
            // hunk 内容行：' ' context / '+' add / '-' delete / '\' 无末尾换行标记
            if let Some(text) = line.strip_prefix('+') {
                hunk.lines.push(DiffLine {
                    kind: DiffLineKind::Add,
                    text: text.to_string(),
                });
            } else if let Some(text) = line.strip_prefix('-') {
                hunk.lines.push(DiffLine {
                    kind: DiffLineKind::Delete,
                    text: text.to_string(),
                });
            } else if let Some(text) = line.strip_prefix(' ') {
                hunk.lines.push(DiffLine {
                    kind: DiffLineKind::Context,
                    text: text.to_string(),
                });
            }
            // '\' 开头的 "No newline" 行：P1 原样忽略（P3 hunk 操作时按 3.7.2 处理）
        }
    }

    diff
}

/// `@@ -12,7 +12,7 @@ optional context` → Hunk 骨架
fn parse_hunk_header(line: &str) -> Option<Hunk> {
    let body = line.strip_prefix("@@ ")?;
    let end = body.find(" @@")?;
    let ranges = &body[..end];
    let header = line.to_string();
    let mut parts = ranges.split(' ');
    let old = parts.next()?.strip_prefix('-')?;
    let new = parts.next()?.strip_prefix('+')?;
    let (os, ol) = split_range(old);
    let (ns, nl) = split_range(new);
    Some(Hunk {
        old_start: os,
        old_lines: ol,
        new_start: ns,
        new_lines: nl,
        header,
        lines: Vec::new(),
    })
}

fn split_range(s: &str) -> (u32, u32) {
    match s.split_once(',') {
        Some((start, len)) => (start.parse().unwrap_or(0), len.parse().unwrap_or(1)),
        None => (s.parse().unwrap_or(0), 1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // fixture：中文文件名、重命名、未跟踪、双状态、冲突。
    // 注意：Rust 续行符 `\`+换行会吃掉换行与行首空白，fixture 必须显式写 \n。
    // -z 真实输出：头部行以 \n 结尾，记录之间以 NUL(\0) 分隔、无 \n。
    // 注意 Rust 转义：\0 只表示单个 NUL，不存在 \000 这种八进制写法。
    const STATUS_V2: &str = concat!(
        "# branch.ab main +2 -1\0# branch.upstream origin/main\0",
        "1 .M N... 100644 100644 100644 aaa bbb 中文文件.php\0",
        "1 MM N... 100644 100644 100644 aaa bbb both.php\0",
        "2 R. N... 100644 100644 100644 aaa bbb 新名字.php\0旧名字.php\0",
        "? 未跟踪.php\0",
        "u UU N... 100644 100644 100644 100644 aaa conflict.php\0",
    );

    #[test]
    fn test_parse_status_branch_and_ahead_behind() {
        let s = parse_status(STATUS_V2, "D:/ws").unwrap();
        assert_eq!(s.branch, "main");
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!(s.ahead, 2);
        assert_eq!(s.behind, 1);
    }

    #[test]
    fn test_parse_status_entries() {
        let s = parse_status(STATUS_V2, "D:/ws").unwrap();
        assert_eq!(s.unstaged.len(), 2); // 中文文件.php(.M) + both.php(MM)
        assert_eq!(s.unstaged[0].path, "中文文件.php");
        assert_eq!(s.unstaged[0].kind, StatusKind::Modified);
        // MM：两侧都有
        assert_eq!(s.staged.len(), 2); // both.php(MM) + 新名字.php(rename)
        let renamed = s
            .staged
            .iter()
            .filter(|e| e.kind == StatusKind::Renamed)
            .count();
        assert_eq!(renamed, 1);
        assert_eq!(s.untracked.len(), 1);
        assert_eq!(s.untracked[0].path, "未跟踪.php");
        assert_eq!(s.conflicted.len(), 1);
        assert_eq!(s.conflicted[0].path, "conflict.php");
    }

    #[test]
    fn test_parse_status_rename_orig_path() {
        let s = parse_status(STATUS_V2, "D:/ws").unwrap();
        let renamed = s
            .staged
            .iter()
            .find(|e| e.kind == StatusKind::Renamed)
            .unwrap();
        assert_eq!(renamed.path, "新名字.php");
        assert_eq!(renamed.orig_path.as_deref(), Some("旧名字.php"));
    }

    #[test]
    fn test_parse_status_workspace_root_kept() {
        let s = parse_status(STATUS_V2, "D:/ws/sub").unwrap();
        assert_eq!(s.workspace_root, "D:/ws/sub");
    }

    const DIFF_SIMPLE: &str = "diff --git a/A.php b/A.php\nindex 111..222 100644\n--- a/A.php\n+++ b/A.php\n@@ -1,3 +1,3 @@\n line1\n-old\n+new\n line3\n";

    #[test]
    fn test_parse_diff_hunks() {
        let d = parse_diff(DIFF_SIMPLE, "A.php");
        assert_eq!(d.path, "A.php");
        assert_eq!(d.hunks.len(), 1);
        let h = &d.hunks[0];
        assert_eq!((h.old_start, h.old_lines), (1, 3));
        assert_eq!((h.new_start, h.new_lines), (1, 3));
        assert_eq!(h.lines.len(), 4);
        assert_eq!(h.lines[1].kind, DiffLineKind::Delete);
        assert_eq!(h.lines[1].text, "old");
        assert_eq!(h.lines[2].kind, DiffLineKind::Add);
        assert_eq!(h.lines[2].text, "new");
    }

    #[test]
    fn test_parse_diff_binary_and_rename() {
        let d = parse_diff(
            "diff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ\n",
            "a.png",
        );
        assert!(d.is_binary);
        assert!(d.hunks.is_empty());
    }

    #[test]
    fn test_parse_diff_no_newline_marker_ignored() {
        let d = parse_diff(
            "diff --git a/n.txt b/n.txt\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+a\n",
            "n.txt",
        );
        assert_eq!(d.hunks[0].lines.len(), 2);
    }
}

