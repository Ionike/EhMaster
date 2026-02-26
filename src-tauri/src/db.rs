use rusqlite::{params, Connection, Result as SqlResult};
use std::path::Path;
use std::sync::Mutex;

use crate::models::*;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(db_path: &Path) -> SqlResult<Self> {
        let conn = Connection::open(db_path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS galleries (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                path          TEXT NOT NULL UNIQUE,
                title_en      TEXT NOT NULL DEFAULT '',
                title_jp      TEXT NOT NULL DEFAULT '',
                url           TEXT NOT NULL DEFAULT '',
                category      TEXT NOT NULL DEFAULT '',
                uploader      TEXT NOT NULL DEFAULT '',
                posted        TEXT NOT NULL DEFAULT '',
                language      TEXT NOT NULL DEFAULT '',
                file_size     TEXT NOT NULL DEFAULT '',
                page_count    INTEGER NOT NULL DEFAULT 0,
                rating        REAL NOT NULL DEFAULT 0.0,
                favorited     INTEGER NOT NULL DEFAULT 0,
                thumb_path    TEXT NOT NULL DEFAULT '',
                folder_name   TEXT NOT NULL DEFAULT '',
                parent_path   TEXT NOT NULL DEFAULT '',
                info_modified TEXT NOT NULL DEFAULT '',
                scanned_at    TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS gallery_tags (
                gallery_id  INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
                namespace   TEXT NOT NULL,
                tag         TEXT NOT NULL,
                PRIMARY KEY (gallery_id, namespace, tag)
            );

            CREATE TABLE IF NOT EXISTS folders (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                path        TEXT NOT NULL UNIQUE,
                name        TEXT NOT NULL,
                parent_path TEXT NOT NULL DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS idx_galleries_parent ON galleries(parent_path);
            CREATE INDEX IF NOT EXISTS idx_gallery_tags_ns_tag ON gallery_tags(namespace, tag);
            CREATE INDEX IF NOT EXISTS idx_gallery_tags_tag ON gallery_tags(tag);
            CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_path);
            ",
        )?;

        // FTS5 table - create only if it doesn't exist
        let fts_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='galleries_fts'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !fts_exists {
            conn.execute_batch(
                "
                CREATE VIRTUAL TABLE galleries_fts USING fts5(
                    title_en, title_jp, folder_name,
                    content='galleries', content_rowid='id',
                    tokenize='unicode61'
                );
                ",
            )?;
        }

        Ok(())
    }

    pub fn upsert_gallery(
        &self,
        path: &str,
        parsed: &ParsedGallery,
        thumb_path: &str,
        info_modified: &str,
    ) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap();

        let folder_name = Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let parent_path = Path::new(path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        conn.execute(
            "INSERT INTO galleries (path, title_en, title_jp, url, category, uploader, posted,
             language, file_size, page_count, rating, favorited, thumb_path, folder_name,
             parent_path, info_modified)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
             ON CONFLICT(path) DO UPDATE SET
                title_en=excluded.title_en, title_jp=excluded.title_jp, url=excluded.url,
                category=excluded.category, uploader=excluded.uploader, posted=excluded.posted,
                language=excluded.language, file_size=excluded.file_size,
                page_count=excluded.page_count, rating=excluded.rating,
                favorited=excluded.favorited, thumb_path=excluded.thumb_path,
                folder_name=excluded.folder_name, parent_path=excluded.parent_path,
                info_modified=excluded.info_modified, scanned_at=datetime('now')",
            params![
                path,
                parsed.title_en,
                parsed.title_jp,
                parsed.url,
                parsed.category,
                parsed.uploader,
                parsed.posted,
                parsed.language,
                parsed.file_size,
                parsed.page_count,
                parsed.rating,
                parsed.favorited,
                thumb_path,
                folder_name,
                parent_path,
                info_modified,
            ],
        )?;

        let gallery_id: i64 = conn.query_row(
            "SELECT id FROM galleries WHERE path = ?1",
            params![path],
            |row| row.get(0),
        )?;

        // Update tags - delete old, insert new
        conn.execute(
            "DELETE FROM gallery_tags WHERE gallery_id = ?1",
            params![gallery_id],
        )?;

        let mut stmt = conn.prepare(
            "INSERT OR IGNORE INTO gallery_tags (gallery_id, namespace, tag) VALUES (?1, ?2, ?3)",
        )?;
        for (namespace, tag) in &parsed.tags {
            stmt.execute(params![gallery_id, namespace, tag])?;
        }

        // Update FTS
        conn.execute(
            "INSERT OR REPLACE INTO galleries_fts(rowid, title_en, title_jp, folder_name)
             VALUES (?1, ?2, ?3, ?4)",
            params![gallery_id, parsed.title_en, parsed.title_jp, folder_name],
        )?;

        Ok(gallery_id)
    }

    pub fn delete_gallery_by_path(&self, path: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        // Get id first for FTS cleanup
        let id: Option<i64> = conn
            .query_row(
                "SELECT id FROM galleries WHERE path = ?1",
                params![path],
                |row| row.get(0),
            )
            .ok();

        if let Some(id) = id {
            conn.execute(
                "DELETE FROM galleries_fts WHERE rowid = ?1",
                params![id],
            )?;
            conn.execute("DELETE FROM galleries WHERE id = ?1", params![id])?;
        }
        Ok(())
    }

    pub fn get_gallery_by_id(&self, id: i64) -> SqlResult<Option<Gallery>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, path, title_en, title_jp, url, category, uploader, posted,
                    language, file_size, page_count, rating, favorited, thumb_path,
                    folder_name, parent_path
             FROM galleries WHERE id = ?1",
        )?;

        let gallery = stmt
            .query_row(params![id], |row| {
                Ok(Gallery {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    title_en: row.get(2)?,
                    title_jp: row.get(3)?,
                    url: row.get(4)?,
                    category: row.get(5)?,
                    uploader: row.get(6)?,
                    posted: row.get(7)?,
                    language: row.get(8)?,
                    file_size: row.get(9)?,
                    page_count: row.get(10)?,
                    rating: row.get(11)?,
                    favorited: row.get(12)?,
                    thumb_path: row.get(13)?,
                    folder_name: row.get(14)?,
                    parent_path: row.get(15)?,
                })
            })
            .ok();

        Ok(gallery)
    }

    pub fn get_gallery_by_path(&self, path: &str) -> SqlResult<Option<GallerySummary>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title_en, title_jp, category, page_count, rating, thumb_path, folder_name, path
             FROM galleries WHERE path = ?1",
        )?;

        let gallery = stmt
            .query_row(params![path], |row| {
                Ok(GallerySummary {
                    id: row.get(0)?,
                    title_en: row.get(1)?,
                    title_jp: row.get(2)?,
                    category: row.get(3)?,
                    page_count: row.get(4)?,
                    rating: row.get(5)?,
                    thumb_path: row.get(6)?,
                    folder_name: row.get(7)?,
                    path: row.get(8)?,
                })
            })
            .ok();

        Ok(gallery)
    }

    pub fn get_tags_for_gallery(&self, gallery_id: i64) -> SqlResult<Vec<TagEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT namespace, tag FROM gallery_tags WHERE gallery_id = ?1 ORDER BY namespace, tag",
        )?;

        let tags = stmt
            .query_map(params![gallery_id], |row| {
                Ok(TagEntry {
                    namespace: row.get(0)?,
                    tag: row.get(1)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(tags)
    }

    pub fn get_galleries_in_folder(&self, parent_path: &str) -> SqlResult<Vec<GallerySummary>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title_en, title_jp, category, page_count, rating, thumb_path, folder_name, path
             FROM galleries WHERE parent_path = ?1
             ORDER BY folder_name COLLATE NOCASE",
        )?;

        let galleries = stmt
            .query_map(params![parent_path], |row| {
                Ok(GallerySummary {
                    id: row.get(0)?,
                    title_en: row.get(1)?,
                    title_jp: row.get(2)?,
                    category: row.get(3)?,
                    page_count: row.get(4)?,
                    rating: row.get(5)?,
                    thumb_path: row.get(6)?,
                    folder_name: row.get(7)?,
                    path: row.get(8)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(galleries)
    }

    pub fn get_info_modified(&self, path: &str) -> SqlResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT info_modified FROM galleries WHERE path = ?1",
            params![path],
            |row| row.get(0),
        )
        .ok()
        .map_or(Ok(None), |v| Ok(Some(v)))
    }

    pub fn search_galleries(&self, query: &SearchQuery) -> SqlResult<SearchResult> {
        let conn = self.conn.lock().unwrap();

        let mut sql = String::from(
            "SELECT g.id, g.title_en, g.title_jp, g.category, g.page_count,
                    g.rating, g.thumb_path, g.folder_name, g.path
             FROM galleries g",
        );
        let mut count_sql = String::from("SELECT COUNT(DISTINCT g.id) FROM galleries g");
        let mut conditions: Vec<String> = Vec::new();
        let _param_values: Vec<String> = Vec::new();
        let mut join_idx = 0;

        // Text search via FTS5
        if let Some(ref text) = query.text {
            let text = text.trim();
            if !text.is_empty() {
                sql.push_str(
                    " INNER JOIN galleries_fts fts ON fts.rowid = g.id",
                );
                count_sql.push_str(
                    " INNER JOIN galleries_fts fts ON fts.rowid = g.id",
                );
                // Escape FTS5 special chars and wrap each word in quotes
                let fts_query: String = text
                    .split_whitespace()
                    .map(|w| {
                        let escaped = w.replace('"', "\"\"");
                        format!("\"{}\"", escaped)
                    })
                    .collect::<Vec<_>>()
                    .join(" ");
                conditions.push(format!(
                    "galleries_fts MATCH '{}'",
                    fts_query.replace('\'', "''")
                ));
            }
        }

        // Tag filters
        for tf in &query.tags {
            join_idx += 1;
            let alias = format!("t{}", join_idx);
            let join = format!(
                " INNER JOIN gallery_tags {} ON {}.gallery_id = g.id",
                alias, alias
            );
            sql.push_str(&join);
            count_sql.push_str(&join);
            conditions.push(format!(
                "{}.namespace = '{}' AND {}.tag = '{}'",
                alias,
                tf.namespace.replace('\'', "''"),
                alias,
                tf.tag.replace('\'', "''")
            ));
        }

        // Category filter
        if let Some(ref cat) = query.category {
            if !cat.is_empty() {
                conditions.push(format!("g.category = '{}'", cat.replace('\'', "''")));
            }
        }

        // Language filter
        if let Some(ref lang) = query.language {
            if !lang.is_empty() {
                conditions.push(format!("g.language = '{}'", lang.replace('\'', "''")));
            }
        }

        if !conditions.is_empty() {
            let where_clause = format!(" WHERE {}", conditions.join(" AND "));
            sql.push_str(&where_clause);
            count_sql.push_str(&where_clause);
        }

        // Get total count
        let total_count: i64 = conn
            .query_row(&count_sql, [], |row| row.get(0))
            .unwrap_or(0);

        // Sort
        let sort_col = match query.sort_by.as_deref() {
            Some("rating") => "g.rating",
            Some("pages") => "g.page_count",
            Some("posted") => "g.posted",
            Some("title") => "g.title_en",
            _ => "g.scanned_at",
        };
        let order = match query.sort_order.as_deref() {
            Some("asc") => "ASC",
            _ => "DESC",
        };
        sql.push_str(&format!(" ORDER BY {} {}", sort_col, order));
        sql.push_str(&format!(" LIMIT {} OFFSET {}", query.limit, query.offset));

        let mut stmt = conn.prepare(&sql)?;
        let galleries = stmt
            .query_map([], |row| {
                Ok(GallerySummary {
                    id: row.get(0)?,
                    title_en: row.get(1)?,
                    title_jp: row.get(2)?,
                    category: row.get(3)?,
                    page_count: row.get(4)?,
                    rating: row.get(5)?,
                    thumb_path: row.get(6)?,
                    folder_name: row.get(7)?,
                    path: row.get(8)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(SearchResult {
            galleries,
            total_count,
        })
    }

    pub fn get_all_gallery_paths(&self) -> SqlResult<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT path FROM galleries")?;
        let paths = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(paths)
    }

    pub fn update_thumb_path(&self, gallery_id: i64, thumb_path: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE galleries SET thumb_path = ?1 WHERE id = ?2",
            params![thumb_path, gallery_id],
        )?;
        Ok(())
    }
}
