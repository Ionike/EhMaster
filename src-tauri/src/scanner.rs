use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use crate::models::ParsedGallery;

/// Image extensions we recognize
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"];

/// Parse an info.txt file into structured gallery data
pub fn parse_info_txt(path: &Path) -> Option<ParsedGallery> {
    let content = fs::read_to_string(path).ok()?;
    let lines: Vec<&str> = content.lines().collect();

    if lines.len() < 5 {
        return None;
    }

    let title_en = lines[0].trim().to_string();
    let title_jp = if lines.len() > 1 {
        lines[1].trim().to_string()
    } else {
        String::new()
    };

    // Find URL (line starting with https://exhentai.org or https://e-hentai.org)
    let url = lines
        .iter()
        .take(5)
        .find(|l| l.starts_with("https://exhentai.org") || l.starts_with("https://e-hentai.org"))
        .map(|l| l.trim().to_string())
        .unwrap_or_default();

    let mut category = String::new();
    let mut uploader = String::new();
    let mut posted = String::new();
    let mut language = String::new();
    let mut file_size = String::new();
    let mut page_count: i64 = 0;
    let mut rating: f64 = 0.0;
    let mut favorited: i64 = 0;
    let mut tags: Vec<(String, String)> = Vec::new();

    let mut in_tags = false;

    for line in &lines {
        let line = line.trim();

        // Parse key-value metadata
        if let Some(val) = line.strip_prefix("Category: ") {
            category = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("Uploader: ") {
            uploader = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("Posted: ") {
            posted = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("Language: ") {
            language = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("File Size: ") {
            file_size = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("Length: ") {
            // "28 pages" -> 28
            page_count = val
                .split_whitespace()
                .next()
                .and_then(|n| n.parse().ok())
                .unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("Rating: ") {
            rating = val.trim().parse().unwrap_or(0.0);
        } else if let Some(val) = line.strip_prefix("Favorited: ") {
            // "50 times" -> 50
            favorited = val
                .split_whitespace()
                .next()
                .and_then(|n| n.parse().ok())
                .unwrap_or(0);
        } else if line == "Tags:" {
            in_tags = true;
        } else if in_tags {
            if line.starts_with("> ") {
                // Parse tag line: "> namespace: tag1, tag2, tag3"
                let tag_line = &line[2..]; // strip "> "
                if let Some(colon_pos) = tag_line.find(": ") {
                    let namespace = tag_line[..colon_pos].trim().to_string();
                    let tag_str = &tag_line[colon_pos + 2..];
                    for tag in tag_str.split(", ") {
                        let tag = tag.trim();
                        if !tag.is_empty() {
                            tags.push((namespace.clone(), tag.to_string()));
                        }
                    }
                }
            } else if !line.is_empty() && !line.starts_with("> ") {
                // End of tags section
                in_tags = false;
            }
        }

        // Stop processing at page listings
        if line.starts_with("Page 1:") || line.starts_with("Downloaded at") {
            break;
        }
    }

    Some(ParsedGallery {
        title_en,
        title_jp,
        url,
        category,
        uploader,
        posted,
        language,
        file_size,
        page_count,
        rating,
        favorited,
        tags,
    })
}

/// Find all gallery folders (folders containing info.txt) under a root path
pub fn find_gallery_folders(root: &Path) -> Vec<PathBuf> {
    let mut galleries = Vec::new();

    for entry in WalkDir::new(root)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_dir() {
            let info_path = entry.path().join("info.txt");
            if info_path.exists() {
                galleries.push(entry.path().to_path_buf());
            }
        }
    }

    galleries
}

/// Get the first image file in a directory (sorted naturally)
pub fn get_first_image(dir: &Path) -> Option<PathBuf> {
    let mut images: Vec<PathBuf> = Vec::new();

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext_lower = ext.to_string_lossy().to_lowercase();
                    if IMAGE_EXTENSIONS.contains(&ext_lower.as_str()) {
                        images.push(path);
                    }
                }
            }
        }
    }

    // Sort naturally (handles 001.jpg, 1.jpg, etc.)
    images.sort_by(|a, b| natural_sort_key(a).cmp(&natural_sort_key(b)));
    images.into_iter().next()
}

/// Get all image files in a directory, sorted naturally
pub fn get_all_images(dir: &Path) -> Vec<PathBuf> {
    let mut images: Vec<PathBuf> = Vec::new();

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext_lower = ext.to_string_lossy().to_lowercase();
                    if IMAGE_EXTENSIONS.contains(&ext_lower.as_str()) {
                        images.push(path);
                    }
                }
            }
        }
    }

    images.sort_by(|a, b| natural_sort_key(a).cmp(&natural_sort_key(b)));
    images
}

/// Natural sort key: splits filename into text/number segments for proper ordering
fn natural_sort_key(path: &Path) -> Vec<NaturalSegment> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut segments = Vec::new();
    let mut current_num = String::new();
    let mut current_str = String::new();

    for ch in name.chars() {
        if ch.is_ascii_digit() {
            if !current_str.is_empty() {
                segments.push(NaturalSegment::Text(
                    current_str.to_lowercase(),
                ));
                current_str.clear();
            }
            current_num.push(ch);
        } else {
            if !current_num.is_empty() {
                segments.push(NaturalSegment::Number(
                    current_num.parse().unwrap_or(0),
                ));
                current_num.clear();
            }
            current_str.push(ch);
        }
    }

    if !current_num.is_empty() {
        segments.push(NaturalSegment::Number(
            current_num.parse().unwrap_or(0),
        ));
    }
    if !current_str.is_empty() {
        segments.push(NaturalSegment::Text(current_str.to_lowercase()));
    }

    segments
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum NaturalSegment {
    Text(String),
    Number(u64),
}

impl PartialOrd for NaturalSegment {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for NaturalSegment {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        match (self, other) {
            (NaturalSegment::Number(a), NaturalSegment::Number(b)) => a.cmp(b),
            (NaturalSegment::Text(a), NaturalSegment::Text(b)) => a.cmp(b),
            (NaturalSegment::Number(_), NaturalSegment::Text(_)) => std::cmp::Ordering::Less,
            (NaturalSegment::Text(_), NaturalSegment::Number(_)) => std::cmp::Ordering::Greater,
        }
    }
}

/// Get the modification time of a file as an ISO string
pub fn get_file_mtime(path: &Path) -> String {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .map(|t| {
            let duration = t
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default();
            format!("{}", duration.as_secs())
        })
        .unwrap_or_default()
}
