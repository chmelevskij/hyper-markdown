use std::path::Path;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            path_exists
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
