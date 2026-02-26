// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;

use manga_viewer_lib::commands;
use manga_viewer_lib::db::Database;
use manga_viewer_lib::state::AppState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Get app data directory for DB and cache
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");
            fs::create_dir_all(&data_dir).expect("Failed to create data directory");

            let db_path = data_dir.join("manga_viewer.db");
            let cache_dir = data_dir.join("thumbs");
            fs::create_dir_all(&cache_dir).expect("Failed to create cache directory");

            // Initialize database
            let db =
                Database::new(&db_path).expect("Failed to initialize database");

            // Load settings
            let settings = commands::load_settings(&app.handle());

            // Create app state
            let state = AppState::new(db, cache_dir.clone());
            {
                let mut s = state.settings.lock().unwrap();
                *s = settings;
            }

            // Start file watchers for configured root paths
            {
                let settings = state.settings.lock().unwrap();
                let paths = settings.root_paths.clone();
                let thumb_width = settings.thumbnail_width;
                drop(settings);

                for path in &paths {
                    let root = PathBuf::from(path);
                    if root.exists() {
                        let db = Arc::clone(&state.db);
                        let handle = manga_viewer_lib::watcher::start_watcher(
                            root,
                            db,
                            cache_dir.clone(),
                            thumb_width,
                            app.handle().clone(),
                        );
                        let mut watcher_lock = state.watcher.lock().unwrap();
                        *watcher_lock = Some(handle);
                    }
                }
            }

            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pick_folder,
            commands::set_root_path,
            commands::get_root_paths,
            commands::remove_root_path,
            commands::get_folder_children,
            commands::get_gallery,
            commands::get_gallery_pages,
            commands::open_file,
            commands::search_galleries,
            commands::start_scan,
            commands::get_scan_status,
            commands::get_asset_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
