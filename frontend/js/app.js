import { api, onEvent } from './api.js';
import { FolderTree } from './folder-tree.js';
import { VirtualGrid } from './virtual-grid.js';
import { GalleryView } from './gallery-view.js';
import { SearchController } from './search.js';
import { basename } from './utils.js';

/**
 * Main application controller
 */
class App {
    constructor() {
        // DOM references
        this.welcomeScreen = document.getElementById('welcome-screen');
        this.galleryGridEl = document.getElementById('gallery-grid');
        this.galleryViewEl = document.getElementById('gallery-view');
        this.gridContainer = document.getElementById('grid-container');
        this.gridSentinel = document.getElementById('grid-sentinel');
        this.gridCount = document.getElementById('grid-count');
        this.sortSelect = document.getElementById('sort-select');
        this.scanOverlay = document.getElementById('scan-overlay');
        this.scanProgressFill = document.getElementById('scan-progress-fill');
        this.scanProgressText = document.getElementById('scan-progress-text');
        this.scanCurrentFolder = document.getElementById('scan-current-folder');
        this.settingsModal = document.getElementById('settings-modal');
        this.rootPathsList = document.getElementById('root-paths-list');
        this.breadcrumb = document.getElementById('breadcrumb');
        this.btnBack = document.getElementById('btn-back');

        // State
        this.currentPath = null;
        this.navigationHistory = [];
        this.isSearchMode = false;

        // Initialize components
        this.folderTree = new FolderTree(
            document.getElementById('folder-tree'),
            (path) => this.navigateToFolder(path)
        );

        this.virtualGrid = new VirtualGrid(
            this.gridContainer,
            this.gridSentinel,
            {
                onGalleryClick: (gallery) => this.openGallery(gallery),
                onFolderClick: (folder) => this.navigateToFolder(folder.path),
            }
        );

        this.galleryView = new GalleryView(this.galleryViewEl, {
            onTagClick: (ns, tag) => {
                this.search.addTag(ns, tag);
                this.galleryView.hide();
                this.galleryGridEl.classList.remove('hidden');
            },
            onBack: () => this.goBack(),
        });

        this.search = new SearchController(
            document.getElementById('search-input'),
            {
                onResults: (result) => this.showSearchResults(result),
                onClear: () => this.exitSearchMode(),
            }
        );

        // Event listeners
        this.setupEventListeners();
        this.setupTauriEvents();

        // Load initial state
        this.init();
    }

    async init() {
        const paths = await api.getRootPaths();
        if (paths.length > 0) {
            this.welcomeScreen.classList.add('hidden');
            this.galleryGridEl.classList.remove('hidden');
            await this.folderTree.loadRoots();
            // Navigate to first root
            this.navigateToFolder(paths[0]);
        }
    }

    setupEventListeners() {
        // Add root folder buttons
        const addRootHandler = async () => {
            const folder = await api.pickFolder();
            if (folder) {
                await api.setRootPath(folder);
                await this.folderTree.loadRoots();
                await this.refreshSettings();
                this.welcomeScreen.classList.add('hidden');
                this.galleryGridEl.classList.remove('hidden');
                this.navigateToFolder(folder);

                // Auto-scan the new folder
                this.startScan(folder);
            }
        };

        document.getElementById('btn-add-root').addEventListener('click', addRootHandler);
        document.getElementById('btn-add-root-welcome').addEventListener('click', addRootHandler);
        document.getElementById('btn-add-root-settings')?.addEventListener('click', addRootHandler);

        // Scan button
        document.getElementById('btn-scan').addEventListener('click', async () => {
            const paths = await api.getRootPaths();
            for (const path of paths) {
                await this.startScan(path);
            }
        });

        // Settings button
        document.getElementById('btn-settings').addEventListener('click', () => {
            this.showSettings();
        });

        // Settings modal close
        this.settingsModal.querySelector('.modal-close').addEventListener('click', () => {
            this.settingsModal.classList.add('hidden');
        });
        this.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.settingsModal) {
                this.settingsModal.classList.add('hidden');
            }
        });

        // Back button
        this.btnBack.addEventListener('click', () => this.goBack());

        // Sort select
        this.sortSelect.addEventListener('change', () => {
            if (this.isSearchMode) {
                const [sortBy, sortOrder] = this.sortSelect.value.split(':');
                this.search.updateSort(sortBy, sortOrder);
            } else {
                // Re-fetch current folder with sort
                if (this.currentPath) {
                    this.navigateToFolder(this.currentPath);
                }
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (!this.galleryViewEl.classList.contains('hidden')) {
                    this.goBack();
                } else if (!this.settingsModal.classList.contains('hidden')) {
                    this.settingsModal.classList.add('hidden');
                }
            }
            // Ctrl+F to focus search
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                document.getElementById('search-input').focus();
            }
        });
    }

    setupTauriEvents() {
        onEvent('scan-progress', (data) => {
            this.scanOverlay.classList.remove('hidden');
            const pct = data.total > 0 ? (data.scanned / data.total) * 100 : 0;
            this.scanProgressFill.style.width = `${pct}%`;
            this.scanProgressText.textContent = `${data.scanned} / ${data.total}`;
            this.scanCurrentFolder.textContent = data.current_folder;
        });

        onEvent('scan-complete', (data) => {
            this.scanOverlay.classList.add('hidden');
            // Refresh current view
            if (this.currentPath) {
                this.navigateToFolder(this.currentPath);
            }
            this.folderTree.loadRoots();
        });

        onEvent('watcher-update', (data) => {
            // Refresh if the update is in our current view
            if (this.currentPath) {
                this.navigateToFolder(this.currentPath);
            }
        });
    }

    /**
     * Navigate to a folder and display its contents
     */
    async navigateToFolder(path) {
        this.isSearchMode = false;
        this.search.input.value = '';

        // Push to history
        if (this.currentPath && this.currentPath !== path) {
            this.navigationHistory.push(this.currentPath);
        }
        this.currentPath = path;
        this.btnBack.disabled = this.navigationHistory.length === 0;

        // Update folder tree selection
        this.folderTree.setActive(path);

        // Hide gallery view, show grid
        this.galleryView.hide();
        this.galleryGridEl.classList.remove('hidden');
        this.welcomeScreen.classList.add('hidden');

        // Update breadcrumb
        this.updateBreadcrumb(path);

        // Load folder contents
        try {
            const result = await api.getFolderChildren(path);
            this.gridCount.textContent = `${result.galleries.length} galleries, ${result.subfolders.length} folders`;
            this.virtualGrid.setItems(result.galleries, result.subfolders);
        } catch (err) {
            console.error('Failed to navigate:', err);
            this.gridCount.textContent = 'Error loading folder';
        }
    }

    /**
     * Open a gallery detail view
     */
    async openGallery(gallery) {
        if (!gallery.id || gallery.id === 0) {
            // Not yet scanned, show a message or trigger scan
            return;
        }

        // Push current path to history
        this.navigationHistory.push(this.currentPath || '');

        this.galleryGridEl.classList.add('hidden');
        await this.galleryView.load(gallery.id);

        this.btnBack.disabled = false;
        this.updateBreadcrumb(gallery.path, gallery.title_en || gallery.folder_name);
    }

    /**
     * Go back in navigation history
     */
    goBack() {
        if (!this.galleryViewEl.classList.contains('hidden')) {
            this.galleryView.hide();
            this.galleryGridEl.classList.remove('hidden');
            const prevPath = this.navigationHistory.pop();
            if (prevPath) {
                this.currentPath = prevPath;
                this.updateBreadcrumb(prevPath);
                this.folderTree.setActive(prevPath);
            }
            this.btnBack.disabled = this.navigationHistory.length === 0;
            return;
        }

        if (this.navigationHistory.length > 0) {
            const prevPath = this.navigationHistory.pop();
            this.currentPath = prevPath;
            this.navigateToFolder(prevPath);
        }
    }

    /**
     * Show search results
     */
    showSearchResults(result) {
        this.isSearchMode = true;
        this.galleryView.hide();
        this.galleryGridEl.classList.remove('hidden');
        this.welcomeScreen.classList.add('hidden');

        this.gridCount.textContent = `${result.total_count} results`;
        this.virtualGrid.setItems(result.galleries, []);

        this.breadcrumb.innerHTML = '<span class="crumb">Search Results</span>';
    }

    /**
     * Exit search mode and return to folder browsing
     */
    exitSearchMode() {
        this.isSearchMode = false;
        if (this.currentPath) {
            this.navigateToFolder(this.currentPath);
        }
    }

    /**
     * Update breadcrumb trail
     */
    updateBreadcrumb(path, galleryTitle = null) {
        this.breadcrumb.innerHTML = '';

        // Get root paths to find which root this belongs to
        const normalized = path.replace(/\\/g, '/');

        // Split path into segments from root
        const segments = normalized.split('/').filter(Boolean);
        let accumulated = '';

        for (let i = 0; i < segments.length; i++) {
            if (i > 0) {
                const sep = document.createElement('span');
                sep.className = 'separator';
                sep.textContent = ' / ';
                this.breadcrumb.appendChild(sep);
            }

            accumulated += (i === 0 ? '' : '/') + segments[i];
            // On Windows, first segment needs the drive letter colon
            const fullPath = segments[0].includes(':') ? accumulated : '/' + accumulated;

            const crumb = document.createElement('span');
            crumb.className = 'crumb';
            crumb.textContent = segments[i];

            if (i < segments.length - 1) {
                const clickPath = fullPath;
                crumb.addEventListener('click', () => {
                    this.navigateToFolder(clickPath);
                });
            }

            this.breadcrumb.appendChild(crumb);
        }

        if (galleryTitle) {
            const sep = document.createElement('span');
            sep.className = 'separator';
            sep.textContent = ' / ';
            this.breadcrumb.appendChild(sep);

            const crumb = document.createElement('span');
            crumb.className = 'crumb';
            crumb.textContent = galleryTitle;
            crumb.style.color = 'var(--text-primary)';
            this.breadcrumb.appendChild(crumb);
        }
    }

    /**
     * Start scanning a root path
     */
    async startScan(rootPath) {
        try {
            await api.startScan(rootPath);
        } catch (err) {
            console.error('Scan error:', err);
            this.scanOverlay.classList.add('hidden');
        }
    }

    /**
     * Show settings modal
     */
    async showSettings() {
        this.settingsModal.classList.remove('hidden');
        await this.refreshSettings();
    }

    async refreshSettings() {
        const paths = await api.getRootPaths();
        this.rootPathsList.innerHTML = '';

        for (const path of paths) {
            const li = document.createElement('li');

            const pathText = document.createElement('span');
            pathText.textContent = path;

            const removeBtn = document.createElement('button');
            removeBtn.textContent = '\u00D7';
            removeBtn.title = 'Remove';
            removeBtn.addEventListener('click', async () => {
                await api.removeRootPath(path);
                await this.refreshSettings();
                await this.folderTree.loadRoots();
            });

            li.appendChild(pathText);
            li.appendChild(removeBtn);
            this.rootPathsList.appendChild(li);
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
