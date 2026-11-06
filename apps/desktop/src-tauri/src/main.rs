// P0 脚手架：进程引导、插件注册、菜单事件分发。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod crash;
mod log;
mod lsp;
mod menu;
mod watcher;
mod win_integration;

use std::sync::Mutex;

use tauri::{Emitter, Manager};

fn main() {
    // P5-3：自带分级 + 大小轮转日志；目录不可用时回退到旧实现。
    if !log::init() {
        commands::init_logging();
    }
    // P5-3：panic 后先落崩溃记录，再以 101 退出，运行标记保留供下次启动识别。
    crash::install_panic_hook();
    // P5-6：进程级 AUMID，须在创建窗口前设置（任务栏分组、通知中心、跳转列表归属）。
    air_win::init_app_id();

    // 系统门槛校验（2.11）：Win10 2004（build 19041）以下直接拒绝启动并说明，
    // 不"装上了再崩"。
    if let Err(msg) = check_windows_version() {
        commands::show_fatal_and_exit(&msg);
        return;
    }

    // P5-6：跳转列表/文件关联通过 `--open <path>` 启动；兼容裸路径。
    let args: Vec<String> = std::env::args().collect();
    let initial_open = win_integration::cli_startup_path(&args);

    let state = commands::AppState {
        initial_open: Mutex::new(initial_open),
        watcher: watcher::WatcherState::new(),
    };
    let lsp_state = lsp::LspState::new();

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // 3.10 单实例：二次启动聚焦已有窗口并转发路径参数
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let Some(path) = win_integration::cli_startup_path(&argv) {
                let _ = app.emit_to("main", "app://open-path", path);
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .manage(lsp_state)
        .invoke_handler(tauri::generate_handler![
            commands::fs_read_file,
            commands::fs_write_file,
            commands::fs_list_dir,
            commands::fs_create,
            commands::fs_rename,
            commands::fs_delete,
            commands::fs_reveal,
            commands::fs_collect_files,
            commands::app_open_dialog,
            commands::app_take_initial_args,
            commands::app_report_benchmark,
            commands::app_log_frontend,
            log::app_log_frontend_entry,
            log::app_open_log_dir,
            commands::app_register_shell,
            commands::app_add_defender_exclusion,
            win_integration::app_windows_integration_status,
            win_integration::app_set_windows_integration,
            win_integration::app_refresh_jump_list,
            win_integration::app_defender_status,
            win_integration::app_show_notification,
            win_integration::win_taskbar_begin,
            win_integration::win_taskbar_update,
            win_integration::win_taskbar_end,
            win_integration::app_last_crash,
            win_integration::app_clear_running_marker,
            commands::git_status,
            commands::git_diff_file,
            commands::git_diff_with_raw,
            commands::git_diff_raw,
            commands::git_log,
            commands::git_blame,
            commands::git_apply_hunk,
            commands::git_stage_file,
            commands::git_unstage_file,
            commands::git_discard_file,
            commands::git_identity_ready,
            commands::git_set_identity,
            commands::git_commit,
            commands::git_undo_commit,
            commands::git_branches,
            commands::git_checkout,
            commands::git_branch_create,
            commands::git_branch_delete,
            commands::git_remote_op,
            commands::git_cancel,
            commands::git_run,
            commands::git_run_cancel,
            commands::search_query,
            commands::search_cancel,
            commands::fs_watch,
            commands::fs_unwatch,
            commands::app_session_load,
            commands::app_session_save,
            commands::app_settings_load,
            commands::app_settings_save,
            commands::app_recent_projects,
            commands::app_push_recent,
            commands::app_drafts_save,
            commands::app_drafts_load,
            commands::app_draft_delete,
            lsp::lsp_servers_scan,
            lsp::lsp_start,
            lsp::lsp_send,
            lsp::lsp_stop,
            lsp::lsp_stop_all,
            lsp::lsp_reap_idle,
            lsp::lsp_install_server,
            lsp::project_profile
        ])
        .on_menu_event(menu::handle_menu_event)
        .setup(|app| {
            // P5-3/P5-6：旧 marker 若指向仍存活的实例（并发启动/更新重启），先清掉再写新标记，
            // 避免误弹「上次未正常退出」。
            win_integration::prepare_running_marker();
            // P5-3：写入运行标记并识别上次异常退出（单实例插件已过滤重复启动）。
            crash::begin_run();
            // P5-6：窗口句柄、跳转列表、任务栏进度聚合（不自动注册资源管理器集成）
            win_integration::init(app.handle());
            menu::build_menu(app.handle())?;
            commands::apply_dark_titlebar(app);
            // 下载的语言服务器经 servers 目录被 PATH 解析（2.6）
            air_lsp::session::register_servers_on_path();
            crash::debug_panic_selftest();
            Ok(())
        })
        .build(tauri::generate_context!());

    // Windows 上 run() 内部直接结束进程、不会返回，因此正常退出的标记清理必须放在
    // RunEvent::Exit 回调里，而不是 match result 的 Ok 分支（原实现永远不可达）。
    let app = match result {
        Ok(app) => app,
        Err(e) => {
            // 启动失败：记录后以明确退出码退出，运行标记保留供下次识别。
            tracing::error!("Air IDE 运行失败: {e}");
            crash::record_startup_failure(&e.to_string());
            std::process::exit(crash::EXIT_STARTUP_FAILURE);
        }
    };
    app.run(|_, event| {
        if let tauri::RunEvent::Exit = event {
            // 正常关窗/退出：清除「运行中」标记。panic 与强杀不会走到这里。
            crash::mark_clean_exit();
        }
    });
}

/// 校验 Windows 版本 ≥ 10.0.19041（Win10 2004）。返回 Err(人话说明) 表示不满足。
/// 用注册表 CurrentVersion 读取（无 FFI、不受兼容性清单影响）。
fn check_windows_version() -> Result<(), String> {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let Ok(key) = hklm.open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion") else {
            return Err("无法检测 Windows 版本（注册表读取失败）。".into());
        };
        let build: u32 = key
            .get_value::<String, _>("CurrentBuildNumber")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let major: u32 = key
            .get_value::<u32, _>("CurrentMajorVersionNumber")
            .ok()
            .or_else(|| {
                key.get_value::<String, _>("CurrentMajorVersionNumber")
                    .ok()
                    .and_then(|s| s.parse().ok())
            })
            .unwrap_or(10);
        // Win10 2004 = 10.0.19041；Win11 = 10.0.22000+
        if major < 10 || (major == 10 && build < 19041) {
            return Err(format!(
                "Air IDE 需要 Windows 10 2004（build 19041）或更高版本。\n当前系统 build {build}，不支持。"
            ));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("Air IDE 只支持 Windows。".into())
    }
}
