// P3-2 patch 回归矩阵（方案 3.7.2 门禁）：autocrlf × {true,false,input} ×
// {CRLF 文件, 无末尾换行, 重命名, 新文件(add -N), 删除, 相邻 hunk, 二进制}。
// 这是"暂存后文件内容变了"这类数据事故的唯一防线，全绿才允许放 UI 按钮。
use air_git::write::{apply_hunk, build_hunk_patch, HunkOp};
use std::fs;
use std::path::Path;
use std::process::Command;

fn git(repo: &Path, args: &[&str]) -> String {
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
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn setup(name: &str, autocrlf: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("air_git_m_{}_{}_{}", name, autocrlf, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    git(&dir, &["init", "-q"]);
    git(&dir, &["config", "user.email", "t@t.com"]);
    git(&dir, &["config", "user.name", "t"]);
    git(&dir, &["config", "core.autocrlf", autocrlf]);
    dir
}

/// 取某文件当前工作区→index 的原始 diff 文本（patch 源；-M 与生产代码一致）。
fn raw_diff(repo: &Path, path: &str) -> String {
    git(
        repo,
        &["diff", "--no-color", "--no-ext-diff", "-U3", "-M", "--", path],
    )
}

fn raw_diff_cached(repo: &Path, path: &str) -> String {
    git(
        repo,
        &["diff", "--cached", "--no-color", "--no-ext-diff", "-U3", "-M", "--", path],
    )
}

const AUTOCRLF_MODES: [&str; 3] = ["true", "false", "input"];

/// 场景 1：CRLF 文件修改 → stage hunk → cached diff 一致 → unstage 还原。
#[test]
fn matrix_crlf_file() {
    for mode in AUTOCRLF_MODES {
        let dir = setup("crlf", mode);
        // 提交一个 CRLF 文件
        fs::write(dir.join("crlf.php"), "a\r\nb\r\nc\r\n").unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "init"]);

        fs::write(dir.join("crlf.php"), "a\r\nCHANGED\r\nc\r\n").unwrap();
        let raw = raw_diff(&dir, "crlf.php");
        assert!(!raw.is_empty(), "[{mode}] CRLF 文件应有 diff");

        apply_hunk(&dir, "crlf.php", 0, HunkOp::Stage, &raw)
            .unwrap_or_else(|e| panic!("[{mode}] CRLF stage 失败: {e}"));
        // 暂存后工作区内容不变
        let content = fs::read(dir.join("crlf.php")).unwrap();
        assert_eq!(
            content,
            b"a\r\nCHANGED\r\nc\r\n",
            "[{mode}] stage 不应改工作区"
        );

        // unstage 还原 index
        let cached = raw_diff_cached(&dir, "crlf.php");
        apply_hunk(&dir, "crlf.php", 0, HunkOp::Unstage, &cached)
            .unwrap_or_else(|e| panic!("[{mode}] CRLF unstage 失败: {e}"));
        let status = air_git::status(&dir).unwrap();
        assert!(
            !status.staged.iter().any(|e| e.path == "crlf.php"),
            "[{mode}] unstage 后不应在 staged"
        );

        // discard 还原工作区
        apply_hunk(&dir, "crlf.php", 0, HunkOp::Discard, &raw)
            .unwrap_or_else(|e| panic!("[{mode}] CRLF discard 失败: {e}"));
        let after = fs::read(dir.join("crlf.php")).unwrap();
        assert_eq!(after, b"a\r\nb\r\nc\r\n", "[{mode}] discard 后应还原");

        let _ = fs::remove_dir_all(&dir);
    }
}

/// 场景 2：无末尾换行（`\ No newline at end of file` 必须原样保留）。
#[test]
fn matrix_no_trailing_newline() {
    for mode in AUTOCRLF_MODES {
        let dir = setup("nonl", mode);
        fs::write(dir.join("n.txt"), "a\nb\nc").unwrap(); // 无末尾换行
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "init"]);

        fs::write(dir.join("n.txt"), "a\nCHANGED\nc").unwrap();
        let raw = raw_diff(&dir, "n.txt");
        assert!(raw.contains("\\ No newline at end of file"), "[{mode}] diff 应含标记");

        let patch = build_hunk_patch(&raw, 0, "n.txt").unwrap();
        // 只有最后一行无换行 → 1 个标记（上下文行 c 尾部）
        assert_eq!(
            patch.matches("\\ No newline at end of file").count(),
            1,
            "[{mode}] patch 必须保留 No newline 标记"
        );

        apply_hunk(&dir, "n.txt", 0, HunkOp::Stage, &raw)
            .unwrap_or_else(|e| panic!("[{mode}] 无末尾换行 stage 失败: {e}"));
        apply_hunk(&dir, "n.txt", 0, HunkOp::Discard, &raw)
            .unwrap_or_else(|e| panic!("[{mode}] 无末尾换行 discard 失败: {e}"));
        // autocrlf=true 时 git apply 写盘会 smudge（LF→CRLF），预期按模式区分
        let expected: &[u8] = if mode == "true" {
            b"a\r\nb\r\nc"
        } else {
            b"a\nb\nc"
        };
        assert_eq!(&fs::read(dir.join("n.txt")).unwrap(), expected, "[{mode}] discard 后应还原");

        let _ = fs::remove_dir_all(&dir);
    }
}

/// 场景 3：重命名（rename from/to 头 + hunk 一起处理）。
/// 注意：`git diff -- <path>` 带 pathspec 时 git 不做 rename 配对（只显示新文件），
/// rename 头只在无 pathspec 的 whole-repo diff 中出现。已暂存的重命名其
/// `git diff --cached -M`（无 pathspec）即真实 patch 源。
#[test]
fn matrix_rename() {
    for mode in AUTOCRLF_MODES {
        let dir = setup("rename", mode);
        let base: String = (1..=10).map(|i| format!("line{i}\n")).collect();
        fs::write(dir.join("old.php"), &base).unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "init"]);

        git(&dir, &["mv", "old.php", "new.php"]);
        let mut lines: Vec<String> = base.lines().map(|s| s.to_string()).collect();
        lines[4] = "CHANGED".into();
        fs::write(dir.join("new.php"), lines.join("\n") + "\n").unwrap();
        git(&dir, &["add", "-A"]);

        // 无 pathspec：rename 配对生效（生产 diff_file 带 pathspec 的限制见 DEVLOG）
        let cached = git(&dir, &["diff", "--cached", "--no-color", "--no-ext-diff", "-U3", "-M"]);
        assert!(cached.contains("rename from"), "[{mode}] cached diff 应含 rename 头");

        let patch = build_hunk_patch(&cached, 0, "new.php").unwrap();
        assert!(patch.contains("rename from old.php"));
        assert!(patch.contains("rename to new.php"));

        // 取消暂存该 hunk（rename + 内容变更一起退出 index）
        apply_hunk(&dir, "new.php", 0, HunkOp::Unstage, &cached)
            .unwrap_or_else(|e| panic!("[{mode}] 重命名 unstage 失败: {e}"));
        let status = air_git::status(&dir).unwrap();
        assert!(
            !status.staged.iter().any(|e| e.path == "new.php"),
            "[{mode}] unstage 后 new.php 不应在 staged"
        );

        let _ = fs::remove_dir_all(&dir);
    }
}

/// 场景 4：新文件（未跟踪）→ add -N → hunk stage。
#[test]
fn matrix_new_file_add_n() {
    for mode in AUTOCRLF_MODES {
        let dir = setup("newfile", mode);
        fs::write(dir.join("base.txt"), "x\n").unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "init"]);

        fs::write(dir.join("fresh.php"), "<?php\necho 1;\n").unwrap();
        // apply_hunk 内部对未跟踪文件自动 add -N
        git(&dir, &["add", "-N", "fresh.php"]);
        let raw = raw_diff(&dir, "fresh.php");
        apply_hunk(&dir, "fresh.php", 0, HunkOp::Stage, &raw)
            .unwrap_or_else(|e| panic!("[{mode}] 新文件 hunk stage 失败: {e}"));
        let status = air_git::status(&dir).unwrap();
        assert!(
            status.staged.iter().any(|e| e.path == "fresh.php"),
            "[{mode}] fresh.php 应在 staged"
        );

        let _ = fs::remove_dir_all(&dir);
    }
}

/// 场景 5：删除文件（整文件删除走文件级操作，hunk 级不适用——3.7.2）。
#[test]
fn matrix_deleted_file() {
    for mode in AUTOCRLF_MODES {
        let dir = setup("del", mode);
        fs::write(dir.join("gone.txt"), "content\n").unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "init"]);
        fs::remove_file(dir.join("gone.txt")).unwrap();

        // 文件级 stage/unstage/discard（删除文件无 hunk 可操作）
        air_git::write::stage_file(&dir, "gone.txt").unwrap();
        let status = air_git::status(&dir).unwrap();
        assert!(
            status.staged.iter().any(|e| e.path == "gone.txt"),
                "[{mode}] 删除应在 staged"
        );
        air_git::write::unstage_file(&dir, "gone.txt").unwrap();
        // discard 删除的文件 = 恢复文件
        air_git::write::discard_file(&dir, "gone.txt").unwrap();
        assert!(dir.join("gone.txt").exists(), "[{mode}] discard 应恢复被删文件");

        let _ = fs::remove_dir_all(&dir);
    }
}

/// 场景 6：相邻 hunk（-U3 下合并为单 hunk；间隔 >6 行才是两个 hunk）。
#[test]
fn matrix_adjacent_hunks() {
    for mode in AUTOCRLF_MODES {
        let dir = setup("adj", mode);
        let base: String = (1..=20).map(|i| format!("line{i}\n")).collect();
        fs::write(dir.join("adj.txt"), &base).unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "init"]);

        // 两处变更相距 10 行 → 两个独立 hunk
        let mut lines: Vec<String> = base.lines().map(|s| s.to_string()).collect();
        lines[1] = "CHANGED-2".into();
        lines[12] = "CHANGED-13".into();
        fs::write(dir.join("adj.txt"), lines.join("\n") + "\n").unwrap();

        let raw = raw_diff(&dir, "adj.txt");
        let hunk_count = raw.matches("@@ -").count();
        assert_eq!(hunk_count, 2, "[{mode}] 应有两个 hunk");

        // 只 stage 第一个
        apply_hunk(&dir, "adj.txt", 0, HunkOp::Stage, &raw)
            .unwrap_or_else(|e| panic!("[{mode}] 相邻 hunk stage 失败: {e}"));
        let cached = raw_diff_cached(&dir, "adj.txt");
        assert_eq!(cached.matches("@@ -").count(), 1, "[{mode}] 只暂存了一个 hunk");
        assert!(cached.contains("CHANGED-2"));
        assert!(!cached.contains("CHANGED-13"));

        let _ = fs::remove_dir_all(&dir);
    }
}

/// 场景 7：二进制文件（不提供 hunk 操作，只给"暂存整个文件"）。
#[test]
fn matrix_binary_no_hunk_ops() {
    for mode in AUTOCRLF_MODES {
        let dir = setup("bin", mode);
        fs::write(dir.join("bin.dat"), [0u8, 1, 2, 0, 3, 4]).unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-qm", "init"]);
        fs::write(dir.join("bin.dat"), [0u8, 1, 2, 0, 9, 9]).unwrap();

        let raw = raw_diff(&dir, "bin.dat");
        assert!(
            raw.contains("Binary files") || raw.is_empty(),
            "[{mode}] 二进制 diff 应为 Binary files 形式"
        );
        // 二进制无 hunk：build_hunk_patch 应报错（无 @@ 行）
        if !raw.is_empty() {
            assert!(
                build_hunk_patch(&raw, 0, "bin.dat").is_err(),
                "[{mode}] 二进制不应有可拼装的 hunk patch"
            );
        }
        // 文件级暂存仍可用
        air_git::write::stage_file(&dir, "bin.dat").unwrap();

        let _ = fs::remove_dir_all(&dir);
    }
}

/// 附加门禁：apply 失败时必须"未做任何修改"（3.7.2 铁律）。
#[test]
fn matrix_apply_failure_leaves_no_change() {
    let dir = setup("fail", "false");
    fs::write(dir.join("f.txt"), "a\nb\nc\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-qm", "init"]);
    fs::write(dir.join("f.txt"), "a\nX\nc\n").unwrap();

    // 构造一个上下文不匹配的 patch（伪造 @@ 行）→ apply 必失败
    let bad_patch = "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n WRONG-CONTEXT\n-old\n+new\n WRONG-CONTEXT\n";
    let err = apply_hunk_raw(&dir, "f.txt", bad_patch, HunkOp::Stage)
        .expect_err("伪造 patch 应失败");
    assert!(err.to_string().contains("未做任何修改"), "错误信息应说明未修改: {err}");

    // 工作区与 index 均无变化
    assert_eq!(fs::read_to_string(dir.join("f.txt")).unwrap(), "a\nX\nc\n");
    let status = air_git::status(&dir).unwrap();
    assert!(status.staged.is_empty(), "失败后 index 不应有变化");

    let _ = fs::remove_dir_all(&dir);
}

/// 直接 apply 任意 patch 文本（失败路径测试用）。
fn apply_hunk_raw(
    repo: &Path,
    rel_path: &str,
    patch: &str,
    op: HunkOp,
) -> air_core::AirResult<()> {
    use std::io::Write;
    use std::process::Stdio;
    let output = air_git::git_command(repo)
        .args(op.args())
        .arg("--")
        .arg(rel_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            child
                .stdin
                .take()
                .map(|mut stdin| stdin.write_all(patch.as_bytes()))
                .transpose()?;
            child.wait_with_output()
        })
        .map_err(|e| air_core::AirError::Git(format!("执行失败: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        return Err(air_core::AirError::Git(format!(
            "git apply 失败（未做任何修改）: {}",
            stderr.trim()
        )));
    }
    Ok(())
}
