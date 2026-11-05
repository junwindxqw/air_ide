//! 原生菜单（P0-2）：File/Edit/View/Git/Help 五个submenu，事件转发到前端命令系统。

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Emitter;

pub fn build_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open_file = MenuItem::with_id(app, "file.open", "打开文件…", true, Some("Ctrl+O"))?;
    let open_folder =
        MenuItem::with_id(app, "file.open_folder", "打开文件夹…", true, Some("Ctrl+Shift+O"))?;
    let save = MenuItem::with_id(app, "file.save", "保存", true, Some("Ctrl+S"))?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let close = PredefinedMenuItem::close_window(app, Some("关闭窗口"))?;
    let file_menu = Submenu::with_items(
        app,
        "文件",
        true,
        &[&open_file, &open_folder, &save, &sep1, &close],
    )?;

    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    let edit_menu = Submenu::with_items(
        app,
        "编辑",
        true,
        &[&undo, &redo, &sep2, &cut, &copy, &paste, &sep3, &select_all],
    )?;

    let toggle_left =
        MenuItem::with_id(app, "view.toggle_left", "Project 工具窗", true, None::<&str>)?;
    let toggle_right =
        MenuItem::with_id(app, "view.toggle_right", "Git 工具窗", true, None::<&str>)?;
    let focus_editor =
        MenuItem::with_id(app, "view.focus_editor", "聚焦编辑器", true, None::<&str>)?;
    let view_menu = Submenu::with_items(
        app,
        "视图",
        true,
        &[&toggle_left, &toggle_right, &focus_editor],
    )?;

    let changes =
        MenuItem::with_id(app, "git.changes", "打开 Changes 工具窗", true, None::<&str>)?;
    let git_menu = Submenu::with_items(app, "Git", true, &[&changes])?;

    let about = MenuItem::with_id(app, "app.about", "关于 Air IDE", true, None::<&str>)?;
    let help_menu = Submenu::with_items(app, "帮助", true, &[&about])?;

    let menu = Menu::with_items(
        app,
        &[&file_menu, &edit_menu, &view_menu, &git_menu, &help_menu],
    )?;
    app.set_menu(menu)?;
    Ok(())
}

pub fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().0.clone();
    match id.as_str() {
        "app.about" => {
            use tauri_plugin_dialog::DialogExt;
            app.dialog()
                .message("Air IDE v0.1.0 — P0 骨架\nTauri 2 + React 19 + CodeMirror 6")
                .title("关于 Air IDE")
                .show(|_| {});
        }
        _ => {
            let _ = app.emit_to("main", "menu://action", id);
        }
    }
}
