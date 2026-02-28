use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::fetcher;
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
            let path_str = normalize_path(&entry_path);
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
        let folder_str = normalize_path(folder);
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

#[tauri::command]
pub async fn get_duplicate_galleries(
    state: State<'_, AppState>,
) -> Result<DuplicateResult, String> {
    let by_url = state.db.find_duplicates_by_url().map_err(|e| e.to_string())?;
    let by_name = state.db.find_duplicates_by_name().map_err(|e| e.to_string())?;
    Ok(DuplicateResult { by_url, by_name })
}

#[tauri::command]
pub async fn delete_gallery(
    id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let gallery = match state.db.get_gallery_by_id(id).map_err(|e| e.to_string())? {
        Some(g) => g,
        None => return Ok(()),
    };

    state.db.delete_gallery_by_path(&gallery.path).map_err(|e| e.to_string())?;

    // Delete cached thumbnail
    if !gallery.thumb_path.is_empty() {
        let thumb = Path::new(&gallery.thumb_path);
        if thumb.exists() {
            let _ = fs::remove_file(thumb);
        }
    }

    // Delete gallery folder
    let folder = Path::new(&gallery.path);
    if folder.is_dir() {
        fs::remove_dir_all(folder).map_err(|e| {
            format!("DB entry removed but failed to delete folder: {}", e)
        })?;
    }

    Ok(())
}

#[tauri::command]
pub async fn clear_cache(_state: State<'_, AppState>) -> Result<CacheCleanResult, String> {
    Ok(CacheCleanResult { removed: 0, freed_bytes: 0 })
}

/// Read a thumbnail file and return it as a base64 data URL.
#[tauri::command]
pub fn read_thumb(path: String) -> Result<String, String> {
    let data = fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;

    let mime = if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".webp") {
        "image/webp"
    } else {
        "image/jpeg"
    };

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(format!("data:{};base64,{}", mime, b64))
}

/// Pick a cookie file and copy it to the app data directory.
#[tauri::command]
pub async fn set_cookie_file(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let file = app
        .dialog()
        .file()
        .add_filter("Cookie files", &["txt"])
        .blocking_pick_file();

    let source = match file {
        Some(p) => PathBuf::from(p.to_string()),
        None => return Err("No file selected".to_string()),
    };

    // Copy to app data dir as cookie.txt
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {}", e))?;
    let _ = fs::create_dir_all(&data_dir);
    let dest = data_dir.join("cookie.txt");

    fs::copy(&source, &dest).map_err(|e| format!("Failed to copy cookie file: {}", e))?;

    // Clear the settings cookie_path so we use the default app data location
    {
        let mut settings = state.settings.lock().unwrap();
        settings.cookie_path = String::new();
    }
    save_settings(&state, &app);

    Ok(dest.to_string_lossy().to_string())
}

/// Get the resolved cookie file path and whether it exists.
#[tauri::command]
pub async fn get_cookie_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(String, bool), String> {
    let settings = state.settings.lock().unwrap();
    let path = if !settings.cookie_path.is_empty() {
        PathBuf::from(&settings.cookie_path)
    } else {
        app.path()
            .app_data_dir()
            .map(|d| d.join("cookie.txt"))
            .unwrap_or_else(|_| PathBuf::from("cookie.txt"))
    };
    let exists = path.exists();
    Ok((path.to_string_lossy().to_string(), exists))
}

/// Refresh a gallery's metadata by fetching from ExHentai and rewriting info.txt.
#[tauri::command]
pub async fn refresh_gallery(
    id: i64,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    log::info!("[refresh] Starting refresh for gallery id={}", id);

    let gallery = state
        .db
        .get_gallery_by_id(id)
        .map_err(|e| format!("[refresh] DB error: {}", e))?
        .ok_or_else(|| "[refresh] Gallery not found".to_string())?;

    log::info!("[refresh] Gallery path={}, url={}", gallery.path, gallery.url);

    if gallery.url.is_empty() {
        return Err("Gallery has no URL to refresh from".to_string());
    }

    // Resolve cookie path: settings cookie_path > app_data_dir/cookie.txt
    let cookie_path = {
        let settings = state.settings.lock().unwrap();
        if !settings.cookie_path.is_empty() {
            PathBuf::from(&settings.cookie_path)
        } else {
            app.path()
                .app_data_dir()
                .map(|d| d.join("cookie.txt"))
                .unwrap_or_else(|_| PathBuf::from("cookie.txt"))
        }
    };

    log::info!("[refresh] Cookie path: {} (exists={})", cookie_path.display(), cookie_path.exists());

    if !cookie_path.exists() {
        return Err(format!(
            "Cookie file not found at: {}. Use Settings to select your cookie file.",
            cookie_path.display()
        ));
    }

    // Fetch from ExHentai
    log::info!("[refresh] Fetching from URL: {}", gallery.url);
    let fetched = fetcher::fetch_gallery_info(&gallery.url, &cookie_path)
        .await
        .map_err(|e| format!("[refresh] Fetch failed: {}", e))?;

    log::info!("[refresh] Fetched title_en={}", fetched.title_en);

    // Write updated info.txt
    let info_path = Path::new(&gallery.path).join("info.txt");
    fetcher::write_info_txt(&info_path, &fetched)
        .map_err(|e| format!("[refresh] Write info.txt failed: {}", e))?;

    log::info!("[refresh] Wrote info.txt at {}", info_path.display());

    // Re-scan: parse info.txt and upsert to DB
    let parsed = scanner::parse_info_txt(&info_path)
        .ok_or_else(|| "[refresh] Failed to re-parse updated info.txt".to_string())?;

    let cache_dir = state.cache_dir.clone();
    let thumb_width = state.settings.lock().unwrap().thumbnail_width;

    // Regenerate thumbnail
    let thumb = scanner::get_first_image(Path::new(&gallery.path))
        .and_then(|img| thumbnail::generate_thumbnail(&img, &cache_dir, thumb_width))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| gallery.thumb_path.clone());

    let info_mtime = scanner::get_file_mtime(&info_path);
    let folder_str = normalize_path(Path::new(&gallery.path));
    state
        .db
        .upsert_gallery(&folder_str, &parsed, &thumb, &info_mtime)
        .map_err(|e| e.to_string())?;

    Ok(())
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

/// Normalize a path to use consistent OS-native separators.
/// On Windows, `fs::read_dir` can produce mixed separators (e.g. `D:/foo\bar`)
/// while WalkDir produces backslash-only paths. This ensures DB lookups match.
fn normalize_path(p: &Path) -> String {
    let cleaned: PathBuf = p.components().collect();
    cleaned.to_string_lossy().to_string()
}

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
    state.watchers.lock().unwrap().insert(path.to_string(), handle);
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
