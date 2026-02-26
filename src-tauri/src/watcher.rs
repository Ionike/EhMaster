use notify_debouncer_mini::new_debouncer;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::db::Database;
use crate::scanner;
use crate::thumbnail;

pub struct WatcherHandle {
    _handle: Option<std::thread::JoinHandle<()>>,
}

/// Start watching a directory for file changes
pub fn start_watcher(
    root_path: PathBuf,
    db: Arc<Database>,
    cache_dir: PathBuf,
    thumb_width: u32,
    app_handle: AppHandle,
) -> WatcherHandle {
    let handle = std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();

        let mut debouncer = match new_debouncer(Duration::from_secs(2), tx) {
            Ok(d) => d,
            Err(e) => {
                log::error!("Failed to create file watcher: {:?}", e);
                return;
            }
        };

        if let Err(e) = debouncer
            .watcher()
            .watch(&root_path, notify::RecursiveMode::Recursive)
        {
            log::error!("Failed to watch directory: {:?}", e);
            return;
        }

        log::info!("File watcher started for {:?}", root_path);

        loop {
            match rx.recv() {
                Ok(Ok(events)) => {
                    let affected_folders: HashSet<PathBuf> = events
                        .iter()
                        .filter_map(|e| e.path.parent().map(|p| p.to_path_buf()))
                        .collect();

                    for folder in &affected_folders {
                        let info_path = folder.join("info.txt");
                        if info_path.exists() {
                            // Gallery created or modified - rescan it
                            log::info!("Watcher: rescanning gallery {:?}", folder);
                            if let Some(parsed) = scanner::parse_info_txt(&info_path) {
                                let folder_str = folder.to_string_lossy().to_string();
                                let info_mtime = scanner::get_file_mtime(&info_path);

                                // Generate thumbnail
                                let thumb = scanner::get_first_image(folder)
                                    .and_then(|img| {
                                        thumbnail::generate_thumbnail(&img, &cache_dir, thumb_width)
                                    })
                                    .map(|p| p.to_string_lossy().to_string())
                                    .unwrap_or_default();

                                if let Err(e) = db.upsert_gallery(
                                    &folder_str,
                                    &parsed,
                                    &thumb,
                                    &info_mtime,
                                ) {
                                    log::error!("Watcher: DB upsert error: {:?}", e);
                                }

                                let _ = app_handle.emit("watcher-update", serde_json::json!({
                                    "event_type": "upsert",
                                    "path": folder_str,
                                }));
                            }
                        } else {
                            // Check if this was a gallery that got deleted
                            let folder_str = folder.to_string_lossy().to_string();
                            if let Ok(Some(_)) = db.get_gallery_by_path(&folder_str) {
                                log::info!("Watcher: gallery deleted {:?}", folder);
                                let _ = db.delete_gallery_by_path(&folder_str);
                                let _ = app_handle.emit("watcher-update", serde_json::json!({
                                    "event_type": "delete",
                                    "path": folder_str,
                                }));
                            }
                        }
                    }
                }
                Ok(Err(e)) => {
                    log::error!("Watcher error: {:?}", e);
                }
                Err(e) => {
                    log::error!("Watcher channel error: {:?}", e);
                    break;
                }
            }
        }
    });

    WatcherHandle {
        _handle: Some(handle),
    }
}
