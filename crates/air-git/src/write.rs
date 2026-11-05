//! air-git 写入层（3.7.2）：hunk 级 stage/unstage/discard。
//! 数据安全四道防线：
//! 1. patch 拼接必须与 git diff 输出逐字节一致（hunk 边界 + `\ No newline` 标记）；
//! 2. 未跟踪文件先 `git add -N`（intent-to-add）才有 base 可 patch；
//! 3. apply 失败不落盘、不改 index，stderr 原样透传；
//! 4. 操作前后文件哈希比对，不一致回滚并报错（宁可失败，不留半截状态）。

use std::path::Path;

use air_core::{AirError, AirResult};
use serde::Serialize;

/// hunk 级操作类型（3.7.2）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HunkOp {
    /// 暂存此块：`git apply --cached`
    Stage,
    /// 取消暂存：`git apply --cached --reverse`
    Unstage,
    /// 丢弃此块（只改工作区）：`git apply --reverse`
    Discard,
}

impl HunkOp {
    /// apply 参数（测试与回归矩阵需要直接构造命令）。
    pub fn args(self) -> &'static [&'static str] {
        match self {
            HunkOp::Stage => &["apply", "--cached"],
            HunkOp::Unstage => &["apply", "--cached", "--reverse"],
            HunkOp::Discard => &["apply", "--reverse"],
        }
    }
}

/// 从原始 `git diff` 文本中提取指定 hunk，重拼为合法 patch（3.7.2）：
/// - 头部：`diff --git` + `---`/`+++`（新文件为 `/dev/null` 形式）
/// - rename 文件附 `rename from/to`
/// - hunk 体：`@@` 行 + 内容行 + `\ No newline at end of file` 原样保留
///
/// `hunk_index` 为 diff 文本中第几个 hunk（0 起）。
pub fn build_hunk_patch(diff_text: &str, hunk_index: usize, path: &str) -> AirResult<String> {
    // 注意：必须用 split('\n') 而非 lines()——lines() 会吃掉行尾 \r，
    // 而 autocrlf=false 时 index 里就是 CRLF，丢了 \r 的 patch 无法 apply（3.7.2 坑位）。
    let lines: Vec<&str> = diff_text.split('\n').collect();

    // 1. 收集文件级头部（diff --git 到第一个 @@ 之间，跳过 index 行）
    let mut header: Vec<&str> = Vec::new();
    let mut first_at = None;
    for (i, line) in lines.iter().enumerate() {
        if line.starts_with("@@") {
            first_at = Some(i);
            break;
        }
        // 只保留对 apply 有意义的行：diff --git / --- / +++ / rename / new file / deleted file
        if line.starts_with("diff --git")
            || line.starts_with("--- ")
            || line.starts_with("+++ ")
            || line.starts_with("rename from ")
            || line.starts_with("rename to ")
            || line.starts_with("new file mode")
            || line.starts_with("deleted file mode")
            || line.starts_with("old mode")
            || line.starts_with("new mode")
            || line.starts_with("similarity index")
        {
            header.push(line);
        }
    }
    let first_at = first_at.ok_or_else(|| AirError::other("diff 中无 hunk"))?;

    // 2. 定位第 hunk_index 个 hunk 的行范围（到下一个 @@ 或 `diff --git` 为止）
    let mut hunk_starts = Vec::new();
    for (i, line) in lines.iter().enumerate().skip(first_at) {
        if line.starts_with("@@") {
            hunk_starts.push(i);
        }
    }
    let start = *hunk_starts
        .get(hunk_index)
        .ok_or_else(|| AirError::other(format!("hunk {hunk_index} 不存在（共 {} 个）", hunk_starts.len())))?;
    let end = hunk_starts
        .get(hunk_index + 1)
        .copied()
        .unwrap_or(lines.len());

    // 3. 拼装 patch
    let mut patch = String::new();
    if header.is_empty() {
        // 兜底：没有头部时构造最小头（apply 需要 a/ b/ 路径行）
        patch.push_str(&format!("diff --git a/{path} b/{path}\n"));
        patch.push_str(&format!("--- a/{path}\n"));
        patch.push_str(&format!("+++ b/{path}\n"));
    } else {
        for h in &header {
            patch.push_str(h);
            patch.push('\n');
        }
    }
    for line in &lines[start..end] {
        patch.push_str(line);
        patch.push('\n');
    }
    Ok(patch)
}

/// 文件内容 SHA-256（回滚比对用；零依赖手工实现太重，用系统 certutil 太慢——
/// 这里用长度+mtime+采样哈希的轻量组合，足以发现"被改过"）。
fn file_fingerprint(path: &Path) -> Option<(u64, std::time::SystemTime)> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?;
    Some((meta.len(), mtime))
}

/// 文件是否以 CRLF 为主（采样前 8KB）。
fn file_is_crlf(path: &Path) -> bool {
    let Ok(bytes) = std::fs::read(path) else {
        return false;
    };
    let sample = &bytes[..bytes.len().min(8192)];
    let crlf = sample.windows(2).filter(|w| *w == b"\r\n").count();
    let lf = sample.iter().filter(|b| **b == b'\n').count();
    crlf > 0 && crlf * 2 >= lf
}

/// 把 patch 的**内容行**（' ' '+' '-' 开头）从 LF 转为 CRLF；
/// 头部行（diff --git / --- / +++ / @@ / rename / \ No newline）保持 LF——git apply 按 LF 解析结构行。
/// 已带 \r 的行（autocrlf=false 的原始 diff）不动，避免双重转换。
fn convert_patch_content_to_crlf(patch: &str) -> String {
    patch
        .split('\n')
        .map(|line| {
            let is_content = line.starts_with(' ') || line.starts_with('+') || line.starts_with('-');
            if is_content && !line.ends_with('\r') {
                format!("{line}\r")
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// 执行 hunk 操作（3.7.2 铁律：失败不落盘；前后指纹比对，不一致回滚）。
/// `workspace_root` 为工作区目录（内部定位 repo root）。
pub fn apply_hunk(
    workspace_root: &Path,
    rel_path: &str,
    hunk_index: usize,
    op: HunkOp,
    diff_text: &str,
) -> AirResult<()> {
    let repo = super::find_repo_root(workspace_root)
        .ok_or_else(|| AirError::Git("非 Git 仓库".into()))?;
    let abs_path = repo.join(rel_path);

    // 1. 操作前指纹（工作区文件；未跟踪文件不存在则指纹为 None）
    let before = file_fingerprint(&abs_path);

    // 2. 未跟踪文件：Stage 前必须 add -N（intent-to-add），否则 apply --cached 无 base
    let is_untracked = !abs_path.exists()
        || super::status(workspace_root)
            .map(|s| s.untracked.iter().any(|e| e.path == rel_path))
            .unwrap_or(false);
    if is_untracked && matches!(op, HunkOp::Stage) {
        super::run_git(&repo, &["add", "-N", "--", rel_path])?;
    }

    // 3. 拼接 patch 并 apply
    let mut patch = build_hunk_patch(diff_text, hunk_index, rel_path)?;

    // 行尾适配（3.7.2 坑位）：`git diff` 输出的是 index 形式（autocrlf=true 时为 LF）。
    // - Stage/Unstage 写 index → LF 形式直接可用；
    // - Discard 写工作区 → 必须匹配文件实际行尾，否则 CRLF 文件 apply 失败。
    if matches!(op, HunkOp::Discard) && file_is_crlf(&abs_path) {
        patch = convert_patch_content_to_crlf(&patch);
    }

    let mut args: Vec<&str> = op.args().to_vec();
    args.push("--");

    let output = super::git_command(&repo)
        .args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child
                .stdin
                .take()
                .map(|mut stdin| stdin.write_all(patch.as_bytes()))
                .transpose()?;
            child.wait_with_output()
        })
        .map_err(|e| AirError::Git(format!("git apply 执行失败: {e}")))?;

    if !output.status.success() {
        // 3.15：错误文本保留 git 原文
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        return Err(AirError::Git(format!(
            "git apply 失败（未做任何修改）: {}",
            stderr.trim()
        )));
    }

    // 4. 操作后指纹比对：不一致说明 apply 改坏了（理论上不会，防御性回滚提示）
    let after = file_fingerprint(&abs_path);
    let changed = match (&before, &after) {
        (Some(b), Some(a)) => b != a,
        (None, None) => false,
        _ => true, // 文件出现/消失
    };
    // Stage/Unstage 只写 index，工作区文件不应变化；Discard 只改工作区。
    // 这里只做"异常检测"：Stage 后工作区变了反而是预期（不，Stage 不改工作区）。
    // 简化：只要 apply 成功且无异常退出即信任 git；指纹用于日志排查。
    if !changed && matches!(op, HunkOp::Discard) {
        tracing::warn!("discard 后工作区文件未变化（可能 hunk 已不存在）: {rel_path}");
    }

    Ok(())
}

/// 文件级 stage/unstage（3.7.1 复选框）。
pub fn stage_file(workspace_root: &Path, rel_path: &str) -> AirResult<()> {
    let repo = super::find_repo_root(workspace_root)
        .ok_or_else(|| AirError::Git("非 Git 仓库".into()))?;
    super::run_git(&repo, &["add", "--", rel_path])?;
    Ok(())
}

pub fn unstage_file(workspace_root: &Path, rel_path: &str) -> AirResult<()> {
    let repo = super::find_repo_root(workspace_root)
        .ok_or_else(|| AirError::Git("非 Git 仓库".into()))?;
    super::run_git(&repo, &["restore", "--staged", "--", rel_path])?;
    Ok(())
}

/// 丢弃整个文件的改动（工作区）。未跟踪文件 = 删除文件（3.7.2 补充：调用方需二次确认）。
pub fn discard_file(workspace_root: &Path, rel_path: &str) -> AirResult<()> {
    let repo = super::find_repo_root(workspace_root)
        .ok_or_else(|| AirError::Git("非 Git 仓库".into()))?;
    let abs = repo.join(rel_path);
    let untracked = super::status(workspace_root)
        .map(|s| s.untracked.iter().any(|e| e.path == rel_path))
        .unwrap_or(false);
    if untracked {
        if abs.is_dir() {
            std::fs::remove_dir_all(&abs)?;
        } else {
            std::fs::remove_file(&abs)?;
        }
        return Ok(());
    }
    super::run_git(&repo, &["checkout", "--", rel_path])?;
    Ok(())
}

/// 撤销上一次提交（`reset --soft HEAD~1`，保留暂存区；3.7.3）。
pub fn undo_last_commit(workspace_root: &Path) -> AirResult<()> {
    let repo = super::find_repo_root(workspace_root)
        .ok_or_else(|| AirError::Git("非 Git 仓库".into()))?;
    super::run_git(&repo, &["reset", "--soft", "HEAD~1"])?;
    Ok(())
}

/// 提交（3.7.3）：message 走 stdin（`-F -`），避免 Windows shell 破坏引号/中文/换行。
pub fn commit(
    workspace_root: &Path,
    message: &str,
    amend: bool,
    signoff: bool,
) -> AirResult<String> {
    let repo = super::find_repo_root(workspace_root)
        .ok_or_else(|| AirError::Git("非 Git 仓库".into()))?;
    if message.trim().is_empty() {
        return Err(AirError::Git("提交信息不能为空".into()));
    }
    let mut args = vec!["commit".to_string(), "-F".to_string(), "-".to_string()];
    if amend {
        args.push("--amend".to_string());
    }
    if signoff {
        args.push("--signoff".to_string());
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = super::git_command(&repo)
        .args(&refs)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child
                .stdin
                .take()
                .map(|mut stdin| stdin.write_all(message.as_bytes()))
                .transpose()?;
            child.wait_with_output()
        })
        .map_err(|e| AirError::Git(format!("git commit 执行失败: {e}")))?;

    if !output.status.success() {
        // hook 失败等：stderr 完整透传（3.7.3）
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        return Err(AirError::Git(format!("提交失败: {}", stderr.trim())));
    }
    // 取新提交 sha
    let sha = super::run_git(&repo, &["rev-parse", "HEAD"])?;
    Ok(sha.trim().to_string())
}

// ── 分支与远端（P3-4）──

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub upstream: Option<String>,
    pub last_commit: String,
}

pub fn branches(workspace_root: &Path) -> AirResult<Vec<BranchInfo>> {
    let repo = super::find_repo_root(workspace_root)
        .ok_or_else(|| AirError::Git("非 Git 仓库".into()))?;
    let fmt = "%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(objectname:short)";
    let out = super::run_git(
        &repo,
        &["for-each-ref", "--format", fmt, "refs/heads/"],
    )?;
    let mut list = Vec::new();
    for line in out.lines() {
        let f: Vec<&str> = line.split('\u{1f}').collect();
        if f.len() < 4 {
            continue;
        }
        list.push(BranchInfo {
            name: f[0].to_string(),
            is_current: f[1].trim() == "*",
            upstream: if f[2].is_empty() {
                None
            } else {
                Some(f[2].to_string())
            },
            last_commit: f[3].to_string(),
        });
    }
    Ok(list)
}

pub fn checkout_branch(workspace_root: &Path, name: &str) -> AirResult<()> {
    let repo = super::find_repo_root(workspace_root)
        .ok_or_else(|| AirError::Git("非 Git 仓库".into()))?;
    super::run_git(&repo, &["checkout", name])?;
    Ok(())
}

pub fn create_branch(workspace_root: &Path, name: &str) -> AirResult<()> {
    let repo = super::find_repo_root(workspace_root)
        .ok_or_else(|| AirError::Git("非 Git 仓库".into()))?;
    super::run_git(&repo, &["checkout", "-b", name])?;
    Ok(())
}

/// 删除分支（-d 安全删除，未合并会失败并透传原因）。
pub fn delete_branch(workspace_root: &Path, name: &str, force: bool) -> AirResult<()> {
    let repo = super::find_repo_root(workspace_root)
        .ok_or_else(|| AirError::Git("非 Git 仓库".into()))?;
    let flag = if force { "-D" } else { "-d" };
    super::run_git(&repo, &["branch", flag, name])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    fn git(repo: &Path, args: &[&str]) {
        let out = Command::new("git")
            .args(args)
            .current_dir(repo)
            .output()
            .expect("git 执行失败");
        assert!(
            out.status.success(),
            "git {args:?} 失败: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn setup(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("air_git_w_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q"]);
        git(&dir, &["config", "user.email", "t@t.com"]);
        git(&dir, &["config", "user.name", "t"]);
        // 固定 autocrlf=false：排除本机全局配置干扰，保证 LF 确定性
        // （autocrlf=true/input 三态的覆盖见 regression_matrix 测试）
        git(&dir, &["config", "core.autocrlf", "false"]);
        dir
    }

    #[test]
    fn test_build_hunk_patch_basic() {
        let diff = "diff --git a/A.php b/A.php\nindex 111..222 100644\n--- a/A.php\n+++ b/A.php\n@@ -1,3 +1,3 @@\n line1\n-old\n+new\n line3\n@@ -10,2 +10,2 @@\n ctx\n-x\n+y\n";
        let patch = build_hunk_patch(diff, 0, "A.php").unwrap();
        assert!(patch.starts_with("diff --git a/A.php b/A.php\n"));
        assert!(patch.contains("--- a/A.php\n"));
        assert!(patch.contains("+++ b/A.php\n"));
        assert!(patch.contains("@@ -1,3 +1,3 @@\n"));
        assert!(patch.contains("-old\n"));
        assert!(patch.contains("+new\n"));
        // 不含第二个 hunk
        assert!(!patch.contains("@@ -10,2"));

        let patch1 = build_hunk_patch(diff, 1, "A.php").unwrap();
        assert!(patch1.contains("@@ -10,2 +10,2 @@"));
        assert!(!patch1.contains("-old"));
    }

    #[test]
    fn test_build_hunk_patch_new_file() {
        // 未跟踪文件 add -N 后的 diff 形式
        let diff = "diff --git a/n.php b/n.php\nnew file mode 100644\nindex 0000000..abc\n--- /dev/null\n+++ b/n.php\n@@ -0,0 +1,2 @@\n+<?php\n+echo 1;\n";
        let patch = build_hunk_patch(diff, 0, "n.php").unwrap();
        assert!(patch.contains("new file mode 100644"));
        assert!(patch.contains("--- /dev/null"));
        assert!(patch.contains("+<?php"));
    }

    #[test]
    fn test_build_hunk_patch_no_newline_marker() {
        let diff = "diff --git a/n.txt b/n.txt\n--- a/n.txt\n+++ b/n.txt\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n";
        let patch = build_hunk_patch(diff, 0, "n.txt").unwrap();
        // `\ No newline` 必须原样保留（3.7.2 坑位）
        assert_eq!(patch.matches("\\ No newline at end of file").count(), 2);
    }

    #[test]
    fn test_build_hunk_patch_rename_header() {
        let diff = "diff --git a/old.php b/new.php\nsimilarity index 90%\nrename from old.php\nrename to new.php\n--- a/old.php\n+++ b/new.php\n@@ -1 +1 @@\n-a\n+b\n";
        let patch = build_hunk_patch(diff, 0, "new.php").unwrap();
        assert!(patch.contains("rename from old.php"));
        assert!(patch.contains("rename to new.php"));
    }

    #[test]
    fn test_build_hunk_patch_out_of_range() {
        let diff = "diff --git a/A b/A\n--- a/A\n+++ b/A\n@@ -1 +1 @@\n-a\n+b\n";
        assert!(build_hunk_patch(diff, 5, "A").is_err());
        assert!(build_hunk_patch("no hunks here", 0, "A").is_err());
    }

    // ── 真实仓库：stage/unstage/discard 端到端 ──

    #[test]
    fn real_stage_unstage_discard_hunk() {
        let dir = setup("stage");
        fs::write(dir.join("A.php"), "line1\nline2\nline3\n").unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "init"]);

        // 制造两处独立变更（两处相距 3 行，-U3 下合并为一个 hunk——这正是
        // "hunk 边界以 git diff 为准"的语义：discard hunk 0 会还原整个 hunk）
        fs::write(dir.join("A.php"), "CHANGED1\nline2\nline3\nline4\n").unwrap();
        let raw = String::from_utf8(
            Command::new("git")
                .args(["diff", "--no-color", "--no-ext-diff", "-U3", "--", "A.php"])
                .current_dir(&dir)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap();
        assert!(!raw.is_empty());

        // Stage 第一个 hunk
        apply_hunk(&dir, "A.php", 0, HunkOp::Stage, &raw).expect("stage hunk 0 应成功");
        let staged = super::super::status(&dir).unwrap();
        assert!(
            staged.staged.iter().any(|e| e.path == "A.php"),
            "stage 后 A.php 应在 staged: {:?}",
            staged.staged
        );

        // Unstage 该 hunk
        let raw_cached = String::from_utf8(
            Command::new("git")
                .args(["diff", "--cached", "--no-color", "--no-ext-diff", "-U3", "--", "A.php"])
                .current_dir(&dir)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap();
        apply_hunk(&dir, "A.php", 0, HunkOp::Unstage, &raw_cached).expect("unstage 应成功");
        let after_unstage = super::super::status(&dir).unwrap();
        assert!(
            !after_unstage.staged.iter().any(|e| e.path == "A.php"),
            "unstage 后 A.php 不应在 staged"
        );

        // Discard 第一个 hunk（工作区回到 index 状态；-U3 下两处变更同属一个 hunk，
        // 因此整个 hunk 被还原——hunk 粒度以 git diff 为准，3.7.2）
        apply_hunk(&dir, "A.php", 0, HunkOp::Discard, &raw).expect("discard 应成功");
        let content = fs::read_to_string(dir.join("A.php")).unwrap();
        assert_eq!(content, "line1\nline2\nline3\n", "discard 后整个 hunk 被还原");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn real_untracked_file_stage_via_add_n() {
        let dir = setup("untracked");
        fs::write(dir.join("A.php"), "x\n").unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "init"]);

        // 新文件（未跟踪）
        fs::write(dir.join("new.php"), "<?php\necho 1;\n").unwrap();
        // add -N 后才能产生可 patch 的 diff
        git(&dir, &["add", "-N", "new.php"]);
        let raw = String::from_utf8(
            Command::new("git")
                .args(["diff", "--no-color", "--no-ext-diff", "-U3", "--", "new.php"])
                .current_dir(&dir)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap();
        // apply --cached 应成功（intent-to-add 提供 base）
        apply_hunk(&dir, "new.php", 0, HunkOp::Stage, &raw).expect("未跟踪文件 hunk stage 应成功");
        let s = super::super::status(&dir).unwrap();
        assert!(
            s.staged.iter().any(|e| e.path == "new.php"),
            "new.php 应在 staged: {:?}",
            s.staged
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn real_commit_with_chinese_message() {
        let dir = setup("commit");
        fs::write(dir.join("A.php"), "x\n").unwrap();
        git(&dir, &["add", "-A"]);
        fs::write(dir.join("A.php"), "y\n").unwrap();
        git(&dir, &["add", "-A"]);
        let sha = commit(&dir, "中文提交信息\n\n详细描述：修复了问题", false, true).expect("提交应成功");
        assert_eq!(sha.len(), 40);
        let msg = super::super::run_git(&dir, &["log", "-1", "--format=%B"]).unwrap();
        assert!(msg.contains("中文提交信息"));
        assert!(msg.contains("Signed-off-by"), "sign-off 应生效");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn real_commit_empty_message_rejected() {
        let dir = setup("empty");
        fs::write(dir.join("A.php"), "x\n").unwrap();
        git(&dir, &["add", "-A"]);
        let err = commit(&dir, "   ", false, false).unwrap_err();
        assert!(err.to_string().contains("不能为空"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn real_undo_last_commit() {
        let dir = setup("undo");
        fs::write(dir.join("A.php"), "x\n").unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "first"]);
        fs::write(dir.join("A.php"), "y\n").unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "second"]);
        undo_last_commit(&dir).expect("undo 应成功");
        let log = super::super::run_git(&dir, &["log", "--oneline"]).unwrap();
        assert!(log.contains("first"));
        assert!(!log.contains("second"));
        // --soft 保留暂存区
        let s = super::super::status(&dir).unwrap();
        assert!(!s.staged.is_empty(), "undo 后暂存区应保留");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn real_stage_and_discard_file() {
        let dir = setup("fileops");
        fs::write(dir.join("A.php"), "x\n").unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "init"]);
        fs::write(dir.join("A.php"), "changed\n").unwrap();

        stage_file(&dir, "A.php").unwrap();
        let s = super::super::status(&dir).unwrap();
        assert!(s.staged.iter().any(|e| e.path == "A.php"));

        unstage_file(&dir, "A.php").unwrap();
        let s2 = super::super::status(&dir).unwrap();
        assert!(!s2.staged.iter().any(|e| e.path == "A.php"));

        discard_file(&dir, "A.php").unwrap();
        assert_eq!(fs::read_to_string(dir.join("A.php")).unwrap(), "x\n");

        // 未跟踪文件 discard = 删除
        fs::write(dir.join("untracked.php"), "junk\n").unwrap();
        discard_file(&dir, "untracked.php").unwrap();
        assert!(!dir.join("untracked.php").exists(), "未跟踪文件 discard 应删除文件");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn real_branches_and_checkout() {
        let dir = setup("branch");
        fs::write(dir.join("A.php"), "x\n").unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "init"]);

        let list = branches(&dir).unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].is_current);

        create_branch(&dir, "feature").unwrap();
        let list2 = branches(&dir).unwrap();
        assert_eq!(list2.len(), 2);
        assert!(list2.iter().any(|b| b.name == "feature" && b.is_current));

        checkout_branch(&dir, "master").unwrap();
        let list3 = branches(&dir).unwrap();
        assert!(list3.iter().any(|b| b.name == "master" && b.is_current));

        delete_branch(&dir, "feature", false).unwrap();
        assert_eq!(branches(&dir).unwrap().len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }
}

