use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Gallery {
    pub id: i64,
    pub path: String,
    pub title_en: String,
    pub title_jp: String,
    pub url: String,
    pub category: String,
    pub uploader: String,
    pub posted: String,
    pub language: String,
    pub file_size: String,
    pub page_count: i64,
    pub rating: f64,
    pub favorited: i64,
    pub thumb_path: String,
    pub folder_name: String,
    pub parent_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GallerySummary {
    pub id: i64,
    pub title_en: String,
    pub title_jp: String,
    pub category: String,
    pub page_count: i64,
    pub rating: f64,
    pub thumb_path: String,
    pub folder_name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GalleryDetail {
    pub gallery: Gallery,
    pub tags: Vec<TagEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagEntry {
    pub namespace: String,
    pub tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderNode {
    pub name: String,
    pub path: String,
    pub has_children: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderChildren {
    pub subfolders: Vec<FolderNode>,
    pub galleries: Vec<GallerySummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageInfo {
    pub filename: String,
    pub path: String,
    pub index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub text: Option<String>,
    pub tags: Vec<TagFilter>,
    pub category: Option<String>,
    pub language: Option<String>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub offset: i64,
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagFilter {
    pub namespace: String,
    pub tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub galleries: Vec<GallerySummary>,
    pub total_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanStatus {
    pub is_scanning: bool,
    pub scanned: i64,
    pub total: i64,
    pub current_folder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub root_paths: Vec<String>,
    pub thumbnail_width: u32,
    pub watcher_enabled: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            root_paths: Vec::new(),
            thumbnail_width: 300,
            watcher_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateResult {
    pub by_url: Vec<Vec<GallerySummary>>,
    pub by_name: Vec<Vec<GallerySummary>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheCleanResult {
    pub removed: u64,
    pub freed_bytes: u64,
}

/// Parsed info.txt data before insertion into DB
#[derive(Debug, Clone)]
pub struct ParsedGallery {
    pub title_en: String,
    pub title_jp: String,
    pub url: String,
    pub category: String,
    pub uploader: String,
    pub posted: String,
    pub language: String,
    pub file_size: String,
    pub page_count: i64,
    pub rating: f64,
    pub favorited: i64,
    pub tags: Vec<(String, String)>, // (namespace, tag)
}
