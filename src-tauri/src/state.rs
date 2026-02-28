use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::db::Database;
use crate::models::{AppSettings, ScanStatus};
use crate::watcher::WatcherHandle;

pub struct AppState {
    pub db: Arc<Database>,
    pub cache_dir: PathBuf,
    pub settings: Mutex<AppSettings>,
    pub scan_status: Arc<Mutex<ScanStatus>>,
    pub watchers: Mutex<HashMap<String, WatcherHandle>>,
}

impl AppState {
    pub fn new(db: Database, cache_dir: PathBuf) -> Self {
        Self {
            db: Arc::new(db),
            cache_dir,
            settings: Mutex::new(AppSettings::default()),
            scan_status: Arc::new(Mutex::new(ScanStatus {
                is_scanning: false,
                scanned: 0,
                total: 0,
                current_folder: String::new(),
            })),
            watchers: Mutex::new(HashMap::new()),
        }
    }
}
