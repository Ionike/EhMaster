# EhMaster
![icon](https://github.com/user-attachments/assets/1a431575-30dc-4e44-8331-aea2ac3217e5)

EhMaster is a dedicated desktop web application for browsing and managing local manga and doujinshi collections from E/Exhentai. It has a Webview2 frontend and a high-performance Tauri 2.0 backend, which enables its support of managing and previewing thousands of manga simultaneously.

The application indexes your gallery folders from E/Exhentai using metadata format of info.txt from [E-Hentai Downloader](https://github.com/ccloli/E-Hentai-Downloader) . It provide a searchbar, thumbnails view and tag-based navigation. If you have an ExHentai account, it can also refresh metadata directly from the site.

BETA: It now accepts galleries from other sources. You will still need a info.txt but an ehentai link is not necessary. The refresh tags function will be disabled.

## What It Looks Like
![02](https://github.com/user-attachments/assets/097c89a7-4ecc-4e10-a5fe-61ae6c31ca4a)

<img width="1281" height="748" alt="image1" src="https://github.com/user-attachments/assets/9f8e0feb-749b-4be8-86a8-d3a770bd2460" />

The main window is split into a sidebar for folder navigation and a grid view for browsing galleries. Clicking on a gallery opens a detail view with its full metadata, tags, and pages. To keep it lightweight it will use your windows default image viewer to open.

Fully resizeable
Features:
![unnamed](https://github.com/user-attachments/assets/21b9ea8b-ff31-44e6-8864-789119d80658)


## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS or later)
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- The Tauri 2 CLI (`npm install -g @tauri-apps/cli`)

### Building from Source

Clone the repository and install dependencies:

```
git clone <repository-url>
cd Manga-Viewer
npm install
```

To run in development mode:

```
npm run dev
```

To build a release binary:

```
npm run build
```

The compiled application will be output to `src-tauri/target/release/`.

### Standalone exe

Download the .exe file from github releases. Is not maintained currently but should be working 

### First Launch

When you first open EhMaster, you will see an empty interface. Here is how to get started:

1. **Add a root folder.** Click the "Add Folder" button in the sidebar and select a directory that contains your gallery folders. You can add multiple root folders.

2. **Scan your collection.** Click "Scan All" to have EhMaster walk through your directories, find every folder with an `info.txt` file, parse the metadata, and generate thumbnails. A progress indicator will show you how far along the scan is.

3. **Browse.** Once the scan completes, your galleries appear in the grid. Click on any gallery to see its details, or use the sidebar tree to navigate by folder.

## How to Use It

### Browsing

The main grid shows gallery thumbnails with their titles. Galleries with wide cover images automatically span two columns. You can sort galleries by rating, page count, post date, or title using the sort controls.

You can toggle between English and Japanese titles from the settings -- whichever you prefer as the display title.

### Searching

The search bar at the top supports both free-text search and structured tag queries. A few examples:

- `touhou` -- searches titles and folder names for "touhou"
- `artist:asanagi` -- filters to galleries tagged with artist "asanagi"
- `parody:"fate grand order"` -- use quotes for tags with spaces
- `language:chinese` -- filter by language
- `group:type-moon artist:takeuchi` -- combine multiple filters

You can also click on any tag in a gallery's detail view to instantly search for it.

### Refreshing Metadata from ExHentai

If a gallery's `info.txt` is missing fields or you want to pull the latest metadata from the site, EhMaster can scrape it directly from ExHentai.

Before using this feature, you need to provide a cookie file:

1. Open Settings.
2. Click "Set Cookie File" and select a Netscape-format cookie file containing your ExHentai session cookies. You can export these from your browser using extensions like "Get cookies.txt" or "cookies.txt".

Once cookies are configured, you can:

- Click the refresh button on any individual gallery to re-fetch its metadata.
- Use batch refresh to update multiple galleries at once.

The fetched data is written back to `info.txt` so your local files stay in sync.
If the user is using standard ComicInfo.xml from Apps like Mihon or EhViewer, they can use HTools in my other repo to convert it.

### Duplicate Detection

EhMaster can find duplicate galleries in your collection -- either by matching URLs or matching titles. This is useful for cleaning up collections that have been downloaded multiple times. The duplicates view lets you compare entries side by side and delete the ones you do not need.

### File Watching

When enabled, EhMaster monitors your root folders for changes in real time. If you download a new gallery or modify an existing one, the application detects it and updates the database automatically without requiring a manual rescan.

## The info.txt Format

EhMaster reads the `info.txt` format produced by [E-Hentai Downloader](https://github.com/ccloli/E-Hentai-Downloader). Each gallery folder is expected to contain an `info.txt` file alongside its image files. The format looks like this:

```
English Title
Japanese Title
https://exhentai.org/g/1234567/abcdef1234/
Category: Doujinshi
Uploader: someone
Posted: 2024-01-15 12:00
Language: Japanese
File Size: 45.3 MB
Length: 28 pages
Rating: 4.50
Favorited: 120 times
Tags:
> artist: artist name
> parody: series name
> character: character one, character two
> female: tag one, tag two
> male: tag three
> group: circle name
> language: japanese, translated
```

The first three lines are positional: English title, Japanese title, and the gallery URL. After that, metadata fields follow a `Key: Value` pattern. Tags come at the end under the `Tags:` header, with each namespace prefixed by `> `.

Not every field is required. EhMaster will work with partial `info.txt` files -- it just uses whatever metadata is available.

When EhMaster refreshes a gallery from ExHentai, it writes back to `info.txt` in this same format, so the file always stays compatible with E-Hentai Downloader.


## License

MIT

