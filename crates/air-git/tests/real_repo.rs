// 真实 git 仓库的端到端验证（对 fixture 之外的 CLI 行为兜底）。
// 前置：D:/bench/p1-git-test 是已 init 的仓库，含已修改文件与未跟踪文件。
use air_git::{diff_file, find_repo_root, status};
use std::path::Path;

const REPO: &str = r"D:\bench\p1-git-test";

#[test]
fn real_repo_status_and_diff() {
    let root = Path::new(REPO);
    let repo_root = find_repo_root(root).expect("应找到仓库根");
    assert!(repo_root.join(".git").exists());

    let s = status(root).expect("status 应成功");
    assert_eq!(s.branch, "master");
    assert_eq!(s.branch, "master");
    // A.php 已修改 → unstaged
    assert!(
        s.unstaged.iter().any(|e| e.path == "A.php"),
        "A.php 应在 unstaged: {:?}",
        s.unstaged
    );
    // untracked.php 未跟踪
    assert!(
        s.untracked.iter().any(|e| e.path == "untracked.php"),
        "untracked.php 应在 untracked: {:?}",
        s.untracked
    );

    let d = diff_file(root, "A.php", false).expect("diff 应成功");
    assert_eq!(d.path, "A.php");
    assert_eq!(d.hunks.len(), 1, "应有 1 个 hunk: {:?}", d.hunks);
    let h = &d.hunks[0];
    // 本次变更为纯追加：新增 line5，上下文含 CHANGED
    assert!(h.lines.iter().any(|l| l.text == "line5" && l.kind == air_git::DiffLineKind::Add));
    assert!(h.lines.iter().any(|l| l.text == "CHANGED" && l.kind == air_git::DiffLineKind::Context));
}
