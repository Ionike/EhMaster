use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::models::*;
use crate::scanner;
use crate::state::AppState;
use crate::thumbnail;
use crate::watcher;

#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app
        .dialog()
        .file()
        .blocking_pick_folder();

    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn set_root_path(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    {
        let mut settings = state.settings.lock().unwrap();
        if !settings.root_paths.contains(&path) {
            settings.root_paths.push(path.clone());
        }
    }

    // Save settings
    save_settings(&state, &app);

    // Start file watcher
    start_watcher_for_path(&path, &state, &app);

    Ok(())
}

#[tauri::command]
pub async fn get_root_paths(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let settings = state.settings.lock().unwrap();
    Ok(settings.root_paths.clone())
}

#[tauri::command]
pub async fn remove_root_path(
    path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    {
        let mut settings = state.settings.lock().unwrap();
        settings.root_paths.retain(|p| p != &path);
    }
    save_settings(&state, &app);
    Ok(())
}

#[tauri::command]
pub async fn get_folder_children(
    path: String,
    state: State<'_, AppState>,
) -> Result<FolderChildren, String> {
    let path = PathBuf::from(&path);

    if !path.exists() || !path.is_dir() {
        return Ok(FolderChildren {
            subfolders: Vec::new(),
            galleries: Vec::new(),
        });
    }

    let mut subfolders: Vec<FolderNode> = Vec::new();
    let mut galleries: Vec<GallerySummary> = Vec::new();

    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;

    for entry in entries.filter_map(|e| e.ok()) {
        let entry_path = entry.path();
        if !entry_path.is_dir() {
            continue;
        }

        // Skip hidden directories
        let name = entry_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if name.starts_with('.') {
            continue;
        }

        // Check if this folder is a gallery (contains info.txt)
        let info_path = entry_path.join("info.txt");
        if info_path.exists() {
            // It's a gallery - get from DB or create a summary from folder name
            let path_str = entry_path.to_string_lossy().to_string();
            if let Ok(Some(summary)) = state.db.get_gallery_by_path(&path_str) {
                galleries.push(summary);
            } else {
                // Not yet scanned - return basic info
                galleries.push(GallerySummary {
                    id: 0,
                    title_en: name.clone(),
                    title_jp: String::new(),
                    category: String::new(),
                    page_count: 0,
                    rating: 0.0,
                    thumb_path: String::new(),
                    folder_name: name,
                    path: path_str,
                });
            }
        } else {
            // It's a regular folder
            let has_children = has_subdirectories(&entry_path);
            subfolders.push(FolderNode {
                name,
                path: entry_path.to_string_lossy().to_string(),
                has_children,
            });
        }
    }

    // Sort folders and galleries by name
    subfolders.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    galleries.sort_by(|a, b| {
        a.folder_name
            .to_lowercase()
            .cmp(&b.folder_name.to_lowercase())
    });

    Ok(FolderChildren { subfolders, galleries })
}

#[tauri::command]
pub async fn get_gallery(
    id: i64,
    state: State<'_, AppState>,
) -> Result<Option<GalleryDetail>, String> {
    let gallery = state
        .db
        .get_gallery_by_id(id)
        .map_err(|e| e.to_string())?;

    match gallery {
        Some(g) => {
            let tags = state
                .db
                .get_tags_for_gallery(id)
                .map_err(|e| e.to_string())?;
            Ok(Some(GalleryDetail { gallery: g, tags }))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn get_gallery_pages(
    id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<PageInfo>, String> {
    let gallery = state
        .db
        .get_gallery_by_id(id)
        .map_err(|e| e.to_string())?;

    match gallery {
        Some(g) => {
            let images = scanner::get_all_images(Path::new(&g.path));
            let pages: Vec<PageInfo> = images
                .into_iter()
                .enumerate()
                .map(|(i, p)| PageInfo {
                    filename: p
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    path: p.to_string_lossy().to_string(),
                    index: i,
                })
                .collect();
            Ok(pages)
        }
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
pub async fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn search_galleries(
    query: SearchQuery,
    state: State<'_, AppState>,
) -> Result<SearchResult, String> {
    state
        .db
        .search_galleries(&query)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_scan(
    root_path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    // Check if already scanning
    {
        let status = state.scan_status.lock().unwrap();
        if status.is_scanning {
            return Err("Scan already in progress".to_string());
        }
    }

    let db = Arc::clone(&state.db);
    let cache_dir = state.cache_dir.clone();
    let thumb_width = state.settings.lock().unwrap().thumbnail_width;

    // Find all gallery folders first
    let root = PathBuf::from(&root_path);
    let gallery_folders = scanner::find_gallery_folders(&root);
    let total = gallery_folders.len() as i64;

    // Update scan status
    {
        let mut status = state.scan_status.lock().unwrap();
        status.is_scanning = true;
        status.scanned = 0;
        status.total = total;
        status.current_folder = String::new();
    }

    let _ = app.emit(
        "scan-progress",
        serde_json::json!({ "scanned": 0, "total": total, "current_folder": "" }),
    );

    // Get existing gallery paths for cleanup later
    let existing_paths: std::collections::HashSet<String> = db
        .get_all_gallery_paths()
        .unwrap_or_default()
        .into_iter()
        .collect();

    let mut scanned_paths: std::collections::HashSet<String> =
        std::collections::HashSet::new();

    // Scan each gallery
    for (i, folder) in gallery_folders.iter().enumerate() {
        let folder_str = folder.to_string_lossy().to_string();
        let info_path = folder.join("info.txt");

        // Check if info.txt has changed since last scan
        let info_mtime = scanner::get_file_mtime(&info_path);
        let needs_update = match db.get_info_modified(&folder_str) {
            Ok(Some(ref stored_mtime)) => stored_mtime != &info_mtime,
            _ => true,
        };

        if needs_update {
            if let Some(parsed) = scanner::parse_info_txt(&info_path) {
                // Generate thumbnail
                let thumb = scanner::get_first_image(folder)
                    .and_then(|img| {
                        thumbnail::generate_thumbnail(&img, &cache_dir, thumb_width)
                    })
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();

                let _ = db.upsert_gallery(&folder_str, &parsed, &thumb, &info_mtime);
            }
        }

        scanned_paths.insert(folder_str.clone());

        // Emit progress
        let _ = app.emit(
            "scan-progress",
            serde_json::json!({
                "scanned": i + 1,
                "total": total,
                "current_folder": folder_str,
            }),
        );
    }

    // Remove galleries that no longer exist on disk
    let mut removed = 0i64;
    for path in &existing_paths {
        if !scanned_paths.contains(path) {
            // Check if it's under this root
            if path.starts_with(&root_path) {
                let _ = db.delete_gallery_by_path(path);
                removed += 1;
            }
        }
    }

    // Clear scan status
    {
        let mut status = state.scan_status.lock().unwrap();
        status.is_scanning = false;
    }

    let _ = app.emit(
        "scan-complete",
        serde_json::json!({
            "total_scanned": total,
            "removed": removed,
        }),
    );

    Ok(())
}

#[tauri::command]
pub async fn get_scan_status(state: State<'_, AppState>) -> Result<ScanStatus, String> {
    let status = state.scan_status.lock().unwrap();
    Ok(status.clone())
}

#[tauri::command]
pub fn get_asset_url(path: String) -> String {
    // Convert a local file path to a Tauri asset URL
    let path = path.replace('\\', "/");
    format!("asset://localhost/{}", urlencoding(&path))
}

fn urlencoding(s: &str) -> String {
    let mut encoded = String::new();
    for ch in s.chars() {
        match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '/' | ':' => {
                encoded.push(ch)
            }
            ' ' => encoded.push_str("%20"),
            _ => {
                for byte in ch.to_string().as_bytes() {
                    encoded.push_str(&format!("%{:02X}", byte));
                }
            }
        }
    }
    encoded
}

// --- Helper functions ---

fn has_subdirectories(path: &Path) -> bool {
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.filter_map(|e| e.ok()) {
            if entry.path().is_dir() {
                return true;
            }
        }
    }
    false
}

fn start_watcher_for_path(path: &str, state: &AppState, app: &AppHandle) {
    let root = PathBuf::from(path);
    let db = Arc::clone(&state.db);
    let cache_dir = state.cache_dir.clone();
    let thumb_width = state.settings.lock().unwrap().thumbnail_width;

    let handle = watcher::start_watcher(root, db, cache_dir, thumb_width, app.clone());
    let mut watcher_lock = state.watcher.lock().unwrap();
    *watcher_lock = Some(handle);
}

fn save_settings(state: &AppState, app: &AppHandle) {
    let settings = state.settings.lock().unwrap();
    if let Some(data_dir) = app.path().app_data_dir().ok() {
        let _ = fs::create_dir_all(&data_dir);
        let settings_path = data_dir.join("settings.json");
        let json = serde_json::to_string_pretty(&*settings).unwrap_or_default();
        let _ = fs::write(settings_path, json);
    }
}

pub fn load_settings(app: &AppHandle) -> AppSettings {
    if let Some(data_dir) = app.path().app_data_dir().ok() {
        let settings_path = data_dir.join("settings.json");
        if settings_path.exists() {
            if let Ok(content) = fs::read_to_string(&settings_path) {
                if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
                    return settings;
                }
            }
        }
    }
    AppSettings::default()
}
