// P0 脚手架：进程引导、插件注册、菜单事件分发。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod menu;

use std::sync::Mutex;

use tauri::{Emitter, Manager};

fn main() {
    commands::init_logging();

    let initial_open = std::env::args()
        .nth(1)
        .filter(|arg| !arg.starts_with('-'))
        .and_then(|a| commands::valid_path(&a));

    let state = commands::AppState {
        initial_open: Mutex::new(initial_open),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // 3.10 单实例：二次启动聚焦已有窗口并转发路径参数
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let Some(path) = argv.get(1).and_then(|a| commands::valid_path(a)) {
                let _ = app.emit_to("main", "app://open-path", path);
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::fs_read_file,
            commands::fs_write_file,
            commands::fs_list_dir,
            commands::app_open_dialog,
            commands::app_take_initial_args,
            commands::app_report_benchmark
        ])
        .on_menu_event(menu::handle_menu_event)
        .setup(|app| {
            menu::build_menu(app.handle())?;
            commands::apply_dark_titlebar(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Air IDE 运行失败");
}
