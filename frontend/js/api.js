const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { convertFileSrc } = window.__TAURI__.core;

/**
 * All Tauri backend API calls
 */
export const api = {
    pickFolder() {
        return invoke('pick_folder');
    },

    setRootPath(path) {
        return invoke('set_root_path', { path });
    },

    getRootPaths() {
        return invoke('get_root_paths');
    },

    removeRootPath(path) {
        return invoke('remove_root_path', { path });
    },

    getFolderChildren(path) {
        return invoke('get_folder_children', { path });
    },

    getGallery(id) {
        return invoke('get_gallery', { id });
    },

    getGalleryPages(id) {
        return invoke('get_gallery_pages', { id });
    },

    openFile(path) {
        return invoke('open_file', { path });
    },

    searchGalleries(query) {
        return invoke('search_galleries', { query });
    },

    startScan(rootPath) {
        return invoke('start_scan', { rootPath });
    },

    getScanStatus() {
        return invoke('get_scan_status');
    },

    getAssetUrl(path) {
        return invoke('get_asset_url', { path });
    },

    getDuplicateGalleries() {
        return invoke('get_duplicate_galleries');
    },

    deleteGallery(id) {
        return invoke('delete_gallery', { id });
    },

    moveFolders(sources, destination) {
        return invoke('move_folders', { sources, destination });
    },

    deleteGalleryFolder(path) {
        return invoke('delete_gallery_folder', { path });
    },

    clearCache() {
        return invoke('clear_cache');
    },

    readThumb(path) {
        return invoke('read_thumb', { path });
    },

    refreshGallery(id) {
        return invoke('refresh_gallery', { id });
    },

    setCookieFile() {
        return invoke('set_cookie_file');
    },

    getCookieStatus() {
        return invoke('get_cookie_status');
    },

    batchRefreshGalleries(ids) {
        return invoke('batch_refresh_galleries', { ids });
    },

    setTitlePref(pref) {
        return invoke('set_title_pref', { pref });
    },

    getTitlePref() {
        return invoke('get_title_pref');
    },

    setGridCardWidth(width) {
        return invoke('set_grid_card_width', { width });
    },

    getGridCardWidth() {
        return invoke('get_grid_card_width');
    },
};

/**
 * Convert a local file path to an asset URL for displaying in <img>
 */
export function assetUrl(filePath) {
    if (!filePath) return '';
    return convertFileSrc(filePath);
}

/**
 * Load a thumbnail via IPC (returns a data URL).
 * Uses an in-memory cache to avoid redundant IPC calls.
 */
const _thumbCache = new Map();
export async function loadThumb(filePath) {
    if (!filePath) return '';
    if (_thumbCache.has(filePath)) return _thumbCache.get(filePath);
    try {
        const dataUrl = await api.readThumb(filePath);
        _thumbCache.set(filePath, dataUrl);
        return dataUrl;
    } catch (e) {
        console.warn('[loadThumb] failed:', filePath, e);
        return '';
    }
}

/**
 * Listen for Tauri events
 */
export function onEvent(eventName, callback) {
    return listen(eventName, (event) => callback(event.payload));
}
