use image::imageops::FilterType;
use image::GenericImageView;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

/// Generate a thumbnail for an image, saving it to the cache directory.
/// Returns the path to the generated thumbnail.
pub fn generate_thumbnail(
    source_image: &Path,
    cache_dir: &Path,
    max_width: u32,
) -> Option<PathBuf> {
    // Create cache directory if needed
    fs::create_dir_all(cache_dir).ok()?;

    // Generate a deterministic filename from source path
    let thumb_name = thumb_filename(source_image);
    let thumb_path = cache_dir.join(&thumb_name);

    // Skip if thumbnail already exists and is newer than source
    if thumb_path.exists() {
        let source_mtime = fs::metadata(source_image)
            .and_then(|m| m.modified())
            .ok();
        let thumb_mtime = fs::metadata(&thumb_path)
            .and_then(|m| m.modified())
            .ok();

        if let (Some(src), Some(dst)) = (source_mtime, thumb_mtime) {
            if dst >= src {
                return Some(thumb_path);
            }
        }
    }

    // Load and resize the image
    let img = image::open(source_image).ok()?;
    let (w, h) = img.dimensions();

    if w == 0 || h == 0 {
        return None;
    }

    // For horizontal images (w > h), use double the max_width so they stay
    // sharp when displayed spanning 2 grid columns.
    let effective_max = if w > h { max_width * 2 } else { max_width };
    let new_width = effective_max.min(w);
    let new_height = (h as f64 * new_width as f64 / w as f64) as u32;

    let thumbnail = img.resize(new_width, new_height, FilterType::Lanczos3);
    thumbnail.save(&thumb_path).ok()?;

    Some(thumb_path)
}

/// Generate a deterministic thumbnail filename from the source path
fn thumb_filename(source: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source.to_string_lossy().as_bytes());
    let hash = hasher.finalize();
    let hex_str = hex::encode(hash);
    format!("{}.jpg", &hex_str[..16])
}

/// Check if a thumbnail exists for a given source image
pub fn thumbnail_exists(source_image: &Path, cache_dir: &Path) -> Option<PathBuf> {
    let thumb_name = thumb_filename(source_image);
    let thumb_path = cache_dir.join(&thumb_name);
    if thumb_path.exists() {
        Some(thumb_path)
    } else {
        None
    }
}
