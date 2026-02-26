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
};

/**
 * Convert a local file path to an asset URL for displaying in <img>
 */
export function assetUrl(filePath) {
    if (!filePath) return '';
    return convertFileSrc(filePath);
}

/**
 * Listen for Tauri events
 */
export function onEvent(eventName, callback) {
    return listen(eventName, (event) => callback(event.payload));
}
