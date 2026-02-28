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

    clearCache() {
        return invoke('clear_cache');
    },

    readThumb(path) {
        return invoke('read_thumb', { path });
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
