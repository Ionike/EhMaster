use regex::Regex;
use reqwest::header;
use scraper::{Html, Selector};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::models::ParsedGallery;

/// Load cookies from a Netscape cookie file.
fn load_cookies(path: &Path) -> Result<HashMap<String, String>, String> {
    let content =
        fs::read_to_string(path).map_err(|e| format!("Failed to read cookie file: {}", e))?;

    let mut cookies = HashMap::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 7 {
            cookies.insert(parts[5].to_string(), parts[6].to_string());
        }
    }

    if cookies.is_empty() {
        return Err("No cookies found in cookie file".to_string());
    }

    Ok(cookies)
}

/// Fetch gallery info from ExHentai by scraping the gallery page.
pub async fn fetch_gallery_info(
    url: &str,
    cookie_path: &Path,
) -> Result<ParsedGallery, String> {
    let cookies = load_cookies(cookie_path)?;

    // Build cookie header string
    let cookie_str: String = cookies
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("; ");

    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .header(
            header::USER_AGENT,
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        .header(header::COOKIE, &cookie_str)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let html = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    parse_gallery_html(&html, url)
}

/// Parse the ExHentai gallery page HTML into a ParsedGallery.
fn parse_gallery_html(html: &str, url: &str) -> Result<ParsedGallery, String> {
    let document = Html::parse_document(html);

    // Check for sad panda (empty/blocked page)
    if html.len() < 1000 && !html.contains("gn") {
        return Err("Received sad panda or empty page — check cookies".to_string());
    }

    // Title English (#gn)
    let sel_gn = Selector::parse("#gn").unwrap();
    let title_en = document
        .select(&sel_gn)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .unwrap_or_default();

    // Title Japanese (#gj)
    let sel_gj = Selector::parse("#gj").unwrap();
    let title_jp = document
        .select(&sel_gj)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .unwrap_or_default();

    if title_en.is_empty() && title_jp.is_empty() {
        return Err("Failed to parse gallery page — no titles found".to_string());
    }

    // Metadata from gdt1/gdt2 table cells
    let sel_gdt1 = Selector::parse("td.gdt1").unwrap();
    let sel_gdt2 = Selector::parse("td.gdt2").unwrap();

    let gdt1_els: Vec<_> = document.select(&sel_gdt1).collect();
    let gdt2_els: Vec<_> = document.select(&sel_gdt2).collect();

    let mut category = String::new();
    let mut uploader = String::new();
    let mut posted = String::new();
    let mut language = String::new();
    let mut file_size = String::new();
    let mut page_count: i64 = 0;
    let mut favorited: i64 = 0;

    let re_pages = Regex::new(r"(\d+)\s*pages?").unwrap();
    let re_fav = Regex::new(r"(\d+)\s*times?").unwrap();

    for (label_el, value_el) in gdt1_els.iter().zip(gdt2_els.iter()) {
        let label = label_el.text().collect::<String>();
        let label = label.trim();
        let value = value_el.text().collect::<String>();
        let value = value.trim().to_string();

        match label {
            "Category:" => category = value,
            "Uploader:" => uploader = value,
            "Posted:" => posted = value,
            "Language:" => {
                // Strip trailing markers like " TR" or flag chars
                language = value
                    .split_whitespace()
                    .next()
                    .unwrap_or(&value)
                    .to_string();
            }
            "File Size:" => file_size = value,
            "Length:" => {
                if let Some(caps) = re_pages.captures(&value) {
                    page_count = caps[1].parse().unwrap_or(0);
                }
            }
            "Favorited:" => {
                if let Some(caps) = re_fav.captures(&value) {
                    favorited = caps[1].parse().unwrap_or(0);
                }
            }
            _ => {}
        }
    }

    // Rating (#rating_label)
    let sel_rating = Selector::parse("#rating_label").unwrap();
    let re_rating = Regex::new(r"[\d.]+").unwrap();
    let rating: f64 = document
        .select(&sel_rating)
        .next()
        .and_then(|el| {
            let text = el.text().collect::<String>();
            re_rating
                .find(&text)
                .and_then(|m| m.as_str().parse().ok())
        })
        .unwrap_or(0.0);

    // Tags — from #taglist table rows
    let mut tags: Vec<(String, String)> = Vec::new();
    let sel_taglist_tr = Selector::parse("#taglist tr").unwrap();
    let sel_td = Selector::parse("td").unwrap();
    let sel_a = Selector::parse("a").unwrap();

    for row in document.select(&sel_taglist_tr) {
        let tds: Vec<_> = row.select(&sel_td).collect();
        if tds.len() >= 2 {
            let namespace = tds[0]
                .text()
                .collect::<String>()
                .trim()
                .trim_end_matches(':')
                .to_string();

            for a in tds[1].select(&sel_a) {
                let tag_text = a.text().collect::<String>().trim().to_string();
                if !tag_text.is_empty() {
                    tags.push((namespace.clone(), tag_text));
                }
            }
        }
    }

    Ok(ParsedGallery {
        title_en,
        title_jp,
        url: url.to_string(),
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

/// Write a ParsedGallery to an info.txt file in the format expected by scanner::parse_info_txt.
pub fn write_info_txt(path: &Path, info: &ParsedGallery) -> Result<(), String> {
    let mut content = String::new();

    // Line 1: English title
    content.push_str(&info.title_en);
    content.push('\n');

    // Line 2: Japanese title
    content.push_str(&info.title_jp);
    content.push('\n');

    // Line 3: URL
    content.push_str(&info.url);
    content.push('\n');

    // Metadata
    if !info.category.is_empty() {
        content.push_str(&format!("Category: {}\n", info.category));
    }
    if !info.uploader.is_empty() {
        content.push_str(&format!("Uploader: {}\n", info.uploader));
    }
    if !info.posted.is_empty() {
        content.push_str(&format!("Posted: {}\n", info.posted));
    }
    if !info.language.is_empty() {
        content.push_str(&format!("Language: {}\n", info.language));
    }
    if !info.file_size.is_empty() {
        content.push_str(&format!("File Size: {}\n", info.file_size));
    }
    if info.page_count > 0 {
        content.push_str(&format!("Length: {} pages\n", info.page_count));
    }
    content.push_str(&format!("Rating: {:.2}\n", info.rating));
    if info.favorited > 0 {
        content.push_str(&format!("Favorited: {} times\n", info.favorited));
    }

    // Tags
    if !info.tags.is_empty() {
        content.push_str("Tags:\n");

        // Group tags by namespace, preserving order
        let mut seen_namespaces: Vec<String> = Vec::new();
        let mut grouped: HashMap<String, Vec<String>> = HashMap::new();

        for (ns, tag) in &info.tags {
            if !grouped.contains_key(ns) {
                seen_namespaces.push(ns.clone());
            }
            grouped.entry(ns.clone()).or_default().push(tag.clone());
        }

        for ns in &seen_namespaces {
            if let Some(tag_list) = grouped.get(ns) {
                content.push_str(&format!("> {}: {}\n", ns, tag_list.join(", ")));
            }
        }
    }

    fs::write(path, content).map_err(|e| format!("Failed to write info.txt: {}", e))
}
