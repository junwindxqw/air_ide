fn main() {
    tauri_build::try_build(tauri_build::Attributes::new()).expect("tauri-build failed");

    // Windows 测试二进制需要与主程序相同的 comctl32 v6 清单：tauri 的 test runtime 会调用
    // TaskDialogIndirect，而 cargo 生成的测试 exe 默认没有清单，会加载 System32 的
    // comctl32 v5，启动即 0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)。
    #[cfg(windows)]
    embed_manifest_for_tests();
}

#[cfg(windows)]
fn embed_manifest_for_tests() {
    println!("cargo:rerun-if-changed=windows/test-app.manifest");
    println!("cargo:rerun-if-changed=windows/test-app.rc");

    match embed_resource::compile_for_tests("windows/test-app.rc", embed_resource::NONE) {
        embed_resource::CompilationResult::Ok | embed_resource::CompilationResult::NotWindows => {}
        result @ embed_resource::CompilationResult::Failed(_) => {
            panic!("为测试二进制嵌入应用清单失败: {result}");
        }
        result @ embed_resource::CompilationResult::NotAttempted(_) => {
            // 缺 rc.exe 时不阻断普通构建，但 cargo test 的 updater 用例会因缺清单无法启动。
            println!("cargo:warning=未能为测试二进制嵌入应用清单: {result}");
        }
    }
}
