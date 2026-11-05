// 真实 git 仓库的端到端验证：测试内自建临时仓库（不依赖共享 fixture）。
use air_git::{blame, diff_file, diff_file_with_opts, find_repo_root, log, status};
use std::path::Path;
use std::process::Command;

fn git(repo: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .expect("git 执行失败");
    assert!(out.status.success(), "git {args:?} 失败: {}", String::from_utf8_lossy(&out.stderr));
}

/// 建一个带一次提交的临时仓库，返回 (repo_dir, guard)。
fn setup_repo(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("air_git_it_{}_{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    git(&dir, &["init", "-q"]);
    git(&dir, &["config", "user.email", "t@t.com"]);
    git(&dir, &["config", "user.name", "t"]);
    std::fs::write(dir.join("A.php"), "line1\nline2\nline3\n").unwrap();
    std::fs::write(dir.join("keep.txt"), "x\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-qm", "init"]);
    dir
}

#[test]
fn real_repo_status_and_diff() {
    let dir = setup_repo("basic");
    let root = find_repo_root(&dir).expect("应找到仓库根");
    assert!(root.join(".git").exists());

    // 制造变更：修改 A.php + 新增未跟踪文件
    std::fs::write(dir.join("A.php"), "line1\nCHANGED\nline3\nline4\nline5\n").unwrap();
    std::fs::write(dir.join("untracked.php"), "新文件\n").unwrap();

    let s = status(&dir).expect("status 应成功");
    assert_eq!(s.branch, "master");
    assert!(
        s.unstaged.iter().any(|e| e.path == "A.php"),
        "A.php 应在 unstaged: {:?}",
        s.unstaged
    );
    assert!(
        s.untracked.iter().any(|e| e.path == "untracked.php"),
        "untracked.php 应在 untracked: {:?}",
        s.untracked
    );

    let d = diff_file(&dir, "A.php", false).expect("diff 应成功");
    assert_eq!(d.path, "A.php");
    assert_eq!(d.hunks.len(), 1, "应有 1 个 hunk: {:?}", d.hunks);
    let h = &d.hunks[0];
    assert!(h.lines.iter().any(|l| l.text == "line5" && l.kind == air_git::DiffLineKind::Add));
    assert!(h.lines.iter().any(|l| l.text == "line2" && l.kind == air_git::DiffLineKind::Delete));
    assert!(h.lines.iter().any(|l| l.text == "CHANGED" && l.kind == air_git::DiffLineKind::Add));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn real_repo_log_and_blame() {
    let dir = setup_repo("logblame");
    let log = log(&dir, 0, 10).expect("log 应成功");
    assert!(!log.is_empty(), "应有提交记录");
    assert_eq!(log[0].subject, "init");

    let blame = blame(&dir, "A.php").expect("blame 应成功");
    assert_eq!(blame.len(), 3, "A.php 有 3 行");
    assert!(!blame[0].author.is_empty(), "blame 应有作者");
    assert!(!blame[0].short_sha.is_empty(), "blame 应有短 sha");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn real_repo_diff_ignore_whitespace() {
    let dir = setup_repo("iw");
    // 制造纯空白变更：行尾加空格
    let p = dir.join("A.php");
    let orig = std::fs::read_to_string(&p).unwrap();
    let spaced = orig.lines().map(|l| format!("{l}   ")).collect::<Vec<_>>().join("\n") + "\n";
    std::fs::write(&p, &spaced).unwrap();

    let normal = diff_file_with_opts(&dir, "A.php", false, false).unwrap();
    let ignored = diff_file_with_opts(&dir, "A.php", false, true).unwrap();
    assert!(!normal.hunks.is_empty(), "纯空白变更普通 diff 应可见");
    assert!(ignored.hunks.is_empty(), "-w 后应无 hunk");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn real_repo_status_no_repo() {
    let dir = std::env::temp_dir().join(format!("air_git_norepo_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let err = status(&dir).unwrap_err();
    assert!(err.to_string().contains("非 Git"), "应报非 Git 仓库: {err}");
    let _ = std::fs::remove_dir_all(&dir);
}
