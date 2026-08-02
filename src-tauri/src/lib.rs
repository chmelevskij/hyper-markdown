use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Active file watchers, keyed by the watched document path.
#[derive(Default)]
struct Watchers(Mutex<HashMap<String, RecommendedWatcher>>);

/// Files handed to us by the OS before the webview was ready to receive them.
#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

/// Read a UTF-8 text file from an arbitrary absolute path.
/// Done in Rust so we are not constrained by the JS `fs` scope: the path
/// always originates from a user action (open dialog or OS file-drop).
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {path}: {e}"))
}

/// Write a UTF-8 text file, creating parent directories as needed.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }
    std::fs::write(&path, contents).map_err(|e| format!("Failed to write {path}: {e}"))
}

/// Whether a file exists at the given path (used to locate sidecar comment files).
#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Watch a document for external edits. We watch its *parent directory*
/// (non-recursively) so editors that save atomically (write-temp + rename)
/// are still detected, and emit `file-changed` with the document's path.
#[tauri::command]
fn watch_file(path: String, app: AppHandle, state: tauri::State<Watchers>) -> Result<(), String> {
    let file = PathBuf::from(&path);
    let dir = file
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| file.clone());
    let target = std::fs::canonicalize(&file).unwrap_or_else(|_| file.clone());
    let target_name = target.file_name().map(|n| n.to_os_string());
    let emit_path = path.clone();
    let app_handle = app.clone();

    let mut watcher =
        notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            if !matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                return;
            }
            let hit = event.paths.iter().any(|p| {
                p == &target
                    || std::fs::canonicalize(p).map(|c| c == target).unwrap_or(false)
                    || (target_name.is_some() && p.file_name().map(|n| n.to_os_string()) == target_name)
            });
            if hit {
                let _ = app_handle.emit("file-changed", emit_path.clone());
            }
        })
        .map_err(|e| e.to_string())?;

    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    state.0.lock().unwrap().insert(path, watcher);
    Ok(())
}

/// Stop watching a document.
#[tauri::command]
fn unwatch_file(path: String, state: tauri::State<Watchers>) {
    state.0.lock().unwrap().remove(&path);
}

/// Drain and return files the OS asked us to open before the UI was ready.
#[tauri::command]
fn take_pending_files(state: tauri::State<PendingFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// macOS app menu. The default Tauri menu binds ⌘W to the native
/// "Close Window" item, which swallows the shortcut before the webview sees
/// it — so ⌘W becomes "Close Tab" (forwarded to the frontend as a `close-tab`
/// event) and "Close Window" moves to ⇧⌘W.
#[cfg(target_os = "macos")]
fn build_menu(handle: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItemBuilder, SubmenuBuilder};

    let pkg = handle.package_info();
    let about = AboutMetadata {
        name: Some(pkg.name.clone()),
        version: Some(pkg.version.to_string()),
        ..Default::default()
    };

    let app_menu = SubmenuBuilder::new(handle, pkg.name.clone())
        .about(Some(about))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let close_tab = MenuItemBuilder::with_id("close-tab", "Close Tab")
        .accelerator("Cmd+W")
        .build(handle)?;
    let close_window = MenuItemBuilder::with_id("close-window", "Close Window")
        .accelerator("Shift+Cmd+W")
        .build(handle)?;
    let file_menu = SubmenuBuilder::new(handle, "File")
        .item(&close_tab)
        .item(&close_window)
        .build()?;

    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(handle, "View").fullscreen().build()?;

    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .maximize()
        .build()?;

    Menu::with_items(
        handle,
        &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu],
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(build_menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "close-tab" => {
                let _ = app.emit("close-tab", ());
            }
            "close-window" => {
                let focused = app
                    .webview_windows()
                    .into_values()
                    .find(|w| w.is_focused().unwrap_or(false));
                if let Some(win) = focused.or_else(|| app.get_webview_window("main")) {
                    let _ = win.close();
                }
            }
            _ => {}
        });

    builder
        .manage(Watchers::default())
        .manage(PendingFiles::default())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            path_exists,
            watch_file,
            unwatch_file,
            take_pending_files
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // macOS delivers files to open (CLI `hmd` / Finder) as an Opened
            // event. `RunEvent::Opened` only exists on macOS/iOS, so this must
            // stay behind a cfg or the Linux and Windows builds fail to compile.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                if !paths.is_empty() {
                    if let Some(state) = _app.try_state::<PendingFiles>() {
                        let mut pend = state.0.lock().unwrap();
                        pend.extend(paths.iter().cloned());
                    }
                    for p in &paths {
                        let _ = _app.emit("open-file", p.clone());
                    }
                }
            }
        });
}
