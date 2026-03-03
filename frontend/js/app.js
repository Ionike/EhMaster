import { api, onEvent, loadThumb } from './api.js';
const { ask } = window.__TAURI__.dialog;
import { FolderTree } from './folder-tree.js';
import { VirtualGrid } from './virtual-grid.js';
import { GalleryView } from './gallery-view.js';
import { SearchController } from './search.js';
import { ContextMenu } from './context-menu.js';
import { getDisplayTitle } from './utils.js';

/**
 * Main application controller
 */
class App {
    constructor() {
        // DOM references
        this.btnSelectMode = document.getElementById('btn-select-mode');
        this.btnMoveSelected = document.getElementById('btn-move-selected');
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
        this.duplicatesModal = document.getElementById('duplicates-modal');
        this.duplicatesBody = document.getElementById('duplicates-body');
        this.rootPathsList = document.getElementById('root-paths-list');
        this.breadcrumb = document.getElementById('breadcrumb');
        this.btnBack = document.getElementById('btn-back');

        // State
        this.currentPath = null;
        this.navigationHistory = [];
        this._maxHistory = 200;
        this.isSearchMode = false;
        this._navId = 0;
        this._scanQueue = [];
        this.titlePref = 'en';
        this._lastGridCount = '';

        // Context menu
        this.contextMenu = new ContextMenu();

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
                onGalleryContext: (e, gallery, selected) => this._showGalleryContextMenu(e, gallery, selected),
                onSelectionChange: (sel) => this._onSelectionChange(sel),
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
        // Load title preference
        try {
            this.titlePref = await api.getTitlePref();
        } catch (_) {}
        this.virtualGrid.titlePref = this.titlePref;
        this.galleryView.titlePref = this.titlePref;
        this._updateTitleToggleBtn();

        // Load grid card size
        try {
            const w = await api.getGridCardWidth();
            if (w >= 150 && w <= 400) {
                this.virtualGrid.setCardSize(w);
                const slider = document.getElementById('grid-size-slider');
                const label = document.getElementById('grid-size-value');
                if (slider) slider.value = w;
                if (label) label.textContent = `${w}px`;
            }
        } catch (_) {}

        const paths = await api.getRootPaths();
        if (paths.length > 0) {
            this.welcomeScreen.classList.add('hidden');
            this.galleryGridEl.classList.remove('hidden');
            await this.folderTree.loadRoots();
            // Navigate to first root
            this.navigateToFolder(paths[0]);
        }
    }

    // --- Selection & Context Menu ---

    _onSelectionChange(sel) {
        if (sel.size > 0) {
            this.gridCount.textContent = `${sel.size} selected`;
            this.btnMoveSelected.classList.remove('hidden');
        } else {
            this.gridCount.textContent = this._lastGridCount;
            this.btnMoveSelected.classList.add('hidden');
        }
    }

    toggleSelectMode() {
        const active = !this.virtualGrid.selectMode;
        this.virtualGrid.setSelectMode(active);
        this.btnSelectMode.classList.toggle('active', active);
        if (!active) this.btnMoveSelected.classList.add('hidden');
    }

    _showGalleryContextMenu(e, gallery, selectedGalleries) {
        const items = [];
        const count = selectedGalleries.length;
        const isMulti = count > 1;

        // Open in Explorer (single only)
        if (!isMulti && gallery.path) {
            items.push({
                label: 'Open in Explorer',
                action: () => api.openFile(gallery.path),
            });
        }

        // Move to...
        items.push({
            label: isMulti ? `Move ${count} to...` : 'Move to...',
            action: () => this._moveGalleries(selectedGalleries),
        });

        items.push({ separator: true });

        // Delete
        items.push({
            label: isMulti ? `Delete ${count} galleries` : 'Delete',
            danger: true,
            action: () => this._deleteGalleriesFromContext(selectedGalleries),
        });

        this.contextMenu.show(e.clientX, e.clientY, items);
    }

    async _moveGalleries(galleries) {
        const folder = await api.pickFolder();
        if (!folder) return;

        const paths = galleries.map(g => g.path).filter(Boolean);
        if (paths.length === 0) return;

        try {
            await api.moveFolders(paths, folder);
            this.virtualGrid.clearSelection();
            this._refreshCurrentView();
        } catch (err) {
            alert(`Move failed: ${err}`);
        }
    }

    async _deleteGalleriesFromContext(galleries) {
        const count = galleries.length;
        const label = count === 1
            ? `"${getDisplayTitle(galleries[0], this.titlePref)}"`
            : `${count} galleries`;

        const ok = await ask(
            `This will permanently delete ${label} and all files from disk.`,
            { title: `Delete ${label}?`, kind: 'warning' }
        );
        if (!ok) return;

        try {
            for (const g of galleries) {
                if (g.id && g.id > 0) {
                    await api.deleteGallery(g.id);
                } else if (g.path) {
                    await api.deleteGalleryFolder(g.path);
                }
            }
            this.virtualGrid.clearSelection();
            this._refreshCurrentView();
        } catch (err) {
            alert(`Delete failed: ${err}`);
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

        // Scan button — queue all root paths and process them one at a time
        document.getElementById('btn-scan').addEventListener('click', async () => {
            this.settingsModal.classList.add('hidden');
            const paths = await api.getRootPaths();
            if (paths.length > 0) {
                this._scanQueue = paths.slice(1);
                await this.startScan(paths[0]);
            }
        });

        // Duplicates button
        document.getElementById('btn-duplicates').addEventListener('click', () => {
            this.settingsModal.classList.add('hidden');
            this.showDuplicates();
        });

        // Duplicates modal close
        this.duplicatesModal.querySelector('.modal-close').addEventListener('click', () => {
            this.duplicatesModal.classList.add('hidden');
        });
        this.duplicatesModal.addEventListener('click', (e) => {
            if (e.target === this.duplicatesModal) {
                this.duplicatesModal.classList.add('hidden');
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

        // Set cookie file button
        document.getElementById('btn-set-cookie')?.addEventListener('click', async () => {
            const statusEl = document.getElementById('cookie-status');
            try {
                const dest = await api.setCookieFile();
                statusEl.textContent = `Saved to: ${dest}`;
                statusEl.style.color = 'var(--text-secondary)';
            } catch (err) {
                if (String(err) !== 'No file selected') {
                    statusEl.textContent = `Error: ${err}`;
                    statusEl.style.color = 'var(--danger, #e55)';
                }
            }
        });

        // Clear cache button
        document.getElementById('btn-clear-cache')?.addEventListener('click', async () => {
            const btn = document.getElementById('btn-clear-cache');
            const result_el = document.getElementById('cache-clean-result');
            btn.disabled = true;
            btn.textContent = 'Cleaning...';
            try {
                const result = await api.clearCache();
                const mb = (result.freed_bytes / 1024 / 1024).toFixed(1);
                result_el.textContent = `Removed ${result.removed} files (${mb} MB freed)`;
            } catch (err) {
                result_el.textContent = `Error: ${err}`;
            }
            btn.disabled = false;
            btn.textContent = 'Clear Cache';
        });

        // Title preference toggle (EN/JP)
        document.getElementById('btn-title-toggle')?.addEventListener('click', () => {
            this.toggleTitlePref();
        });

        // Grid size slider
        const gridSlider = document.getElementById('grid-size-slider');
        const gridSizeLabel = document.getElementById('grid-size-value');
        if (gridSlider) {
            gridSlider.addEventListener('input', () => {
                const w = parseInt(gridSlider.value, 10);
                gridSizeLabel.textContent = `${w}px`;
                this.virtualGrid.setCardSize(w);
            });
            gridSlider.addEventListener('change', () => {
                const w = parseInt(gridSlider.value, 10);
                api.setGridCardWidth(w).catch(() => {});
            });
        }

        // Batch refresh button
        document.getElementById('btn-refresh-all')?.addEventListener('click', () => {
            this.settingsModal.classList.add('hidden');
            this.batchRefreshCurrentGalleries();
        });

        // Select mode toggle
        this.btnSelectMode.addEventListener('click', () => this.toggleSelectMode());

        // Move selected galleries
        this.btnMoveSelected.addEventListener('click', () => {
            const selected = this.virtualGrid.getSelectedGalleries();
            if (selected.length > 0) this._moveGalleries(selected);
        });

        // Back button
        this.btnBack.addEventListener('click', () => this.goBack());

        // Sort select
        this.sortSelect.addEventListener('change', () => {
            if (this.isSearchMode) {
                const [sortBy, sortOrder] = this.sortSelect.value.split(':');
                this.search.updateSort(sortBy, sortOrder);
            } else {
                // Re-fetch current folder with sort applied client-side
                if (this.currentPath) {
                    this.navigateToFolder(this.currentPath);
                }
            }
        });

        // Sidebar splitter drag
        this._setupSplitter();

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // First: hide context menu
                this.contextMenu.hide();

                // Exit select mode and clear selection if any
                if (this.virtualGrid.selectMode || this.virtualGrid.selectedGalleries.size > 0) {
                    this.virtualGrid.setSelectMode(false);
                    this.btnSelectMode.classList.remove('active');
                    return;
                }

                if (!this.galleryViewEl.classList.contains('hidden')) {
                    this.goBack();
                } else if (!this.duplicatesModal.classList.contains('hidden')) {
                    this.duplicatesModal.classList.add('hidden');
                } else if (!this.settingsModal.classList.contains('hidden')) {
                    this.settingsModal.classList.add('hidden');
                }
            }
            // Ctrl+F to focus search
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                document.getElementById('search-input').focus();
            }
            // Ctrl+A to select all galleries
            if (e.ctrlKey && e.key === 'a') {
                // Only if grid is visible and not in gallery view
                if (!this.galleryGridEl.classList.contains('hidden') &&
                    this.galleryViewEl.classList.contains('hidden') &&
                    document.activeElement?.tagName !== 'INPUT') {
                    e.preventDefault();
                    this.virtualGrid.selectAll();
                }
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

        onEvent('scan-complete', async (data) => {
            // If there are more paths queued, scan the next one
            if (this._scanQueue.length > 0) {
                const next = this._scanQueue.shift();
                try {
                    await api.startScan(next);
                } catch (err) {
                    console.error('Queued scan error:', err);
                    // Failed to start next scan — process remaining queue
                    // by re-emitting logic, or just hide overlay if queue is empty
                    if (this._scanQueue.length === 0) {
                        this.scanOverlay.classList.add('hidden');
                        this._refreshCurrentView();
                    }
                }
                return;
            }

            this.scanOverlay.classList.add('hidden');
            this._refreshCurrentView();
        });

        onEvent('batch-refresh-progress', (data) => {
            this.scanOverlay.classList.remove('hidden');
            const pct = data.total > 0 ? (data.done / data.total) * 100 : 0;
            this.scanProgressFill.style.width = `${pct}%`;
            this.scanProgressText.textContent = `${data.done} / ${data.total}`;
            this.scanCurrentFolder.textContent = data.current_title || '';
        });

        onEvent('batch-refresh-complete', () => {
            this.scanOverlay.classList.add('hidden');
            this._refreshCurrentView();
        });

        onEvent('watcher-update', (data) => {
            this._refreshCurrentView();
        });
    }

    _setupSplitter() {
        const splitter = document.getElementById('sidebar-splitter');
        const sidebar = document.getElementById('sidebar');
        let startX, startWidth;

        const onDragMove = (clientX) => {
            const delta = clientX - startX;
            const newWidth = Math.min(500, Math.max(150, startWidth + delta));
            sidebar.style.width = `${newWidth}px`;
        };

        const onDragEnd = () => {
            splitter.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onDragEnd);
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onDragEnd);
            localStorage.setItem('sidebarWidth', sidebar.style.width);
        };

        const onMouseMove = (e) => onDragMove(e.clientX);
        const onTouchMove = (e) => {
            e.preventDefault();
            onDragMove(e.touches[0].clientX);
        };

        const startDrag = (clientX) => {
            startX = clientX;
            startWidth = sidebar.getBoundingClientRect().width;
            splitter.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        };

        splitter.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startDrag(e.clientX);
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onDragEnd);
        });

        splitter.addEventListener('touchstart', (e) => {
            e.preventDefault();
            startDrag(e.touches[0].clientX);
            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend', onDragEnd);
        }, { passive: false });

        // Restore saved width (validate before applying)
        const saved = localStorage.getItem('sidebarWidth');
        if (saved) {
            const px = parseInt(saved, 10);
            if (px >= 150 && px <= 500) {
                sidebar.style.width = `${px}px`;
            }
        }
    }

    /**
     * Refresh the current folder view without disrupting the gallery detail view.
     * If the user is reading a gallery, the refresh is deferred until they go back.
     */
    _refreshCurrentView() {
        if (!this.galleryViewEl.classList.contains('hidden')) {
            // User is viewing a gallery — mark for refresh when they go back
            this._pendingRefresh = true;
            this.folderTree.loadRoots();
            return;
        }
        if (this.currentPath && !this.isSearchMode) {
            this.navigateToFolder(this.currentPath);
        }
        this.folderTree.loadRoots();
    }

    /**
     * Sort galleries array client-side based on the current sort select value.
     */
    _sortGalleries(galleries) {
        const [sortBy, sortOrder] = this.sortSelect.value.split(':');
        const dir = sortOrder === 'asc' ? 1 : -1;

        galleries.sort((a, b) => {
            let va, vb;
            switch (sortBy) {
                case 'rating':
                    va = a.rating; vb = b.rating;
                    break;
                case 'pages':
                    va = a.page_count; vb = b.page_count;
                    break;
                case 'title':
                    va = getDisplayTitle(a, this.titlePref).toLowerCase();
                    vb = getDisplayTitle(b, this.titlePref).toLowerCase();
                    break;
                default:
                    // scanned_at/posted not available in summary, fall back to folder name
                    va = a.folder_name.toLowerCase();
                    vb = b.folder_name.toLowerCase();
                    break;
            }
            if (va < vb) return -dir;
            if (va > vb) return dir;
            return 0;
        });
    }

    /**
     * Navigate to a folder and display its contents
     */
    async navigateToFolder(path) {
        path = path.replace(/\\/g, '/');
        this.isSearchMode = false;
        this.search.input.value = '';

        // Push to history (cap size to prevent unbounded memory growth)
        if (this.currentPath && this.currentPath !== path) {
            if (this.navigationHistory.length >= this._maxHistory) {
                this.navigationHistory.shift();
            }
            this.navigationHistory.push(this.currentPath);
        }
        this.currentPath = path;
        this.btnBack.disabled = this.navigationHistory.length === 0;

        // Update folder tree selection (expands ancestors if needed)
        await this.folderTree.setActive(path);

        // Hide gallery view, show grid
        this.galleryView.hide();
        this.galleryGridEl.classList.remove('hidden');
        this.welcomeScreen.classList.add('hidden');

        // Update breadcrumb
        this.updateBreadcrumb(path);

        // Load folder contents (use navId to discard stale responses from rapid clicks)
        const navId = ++this._navId;
        try {
            const result = await api.getFolderChildren(path);
            if (navId !== this._navId) return;
            this._sortGalleries(result.galleries);
            this._lastGridCount = `${result.galleries.length} galleries, ${result.subfolders.length} folders`;
            this.gridCount.textContent = this._lastGridCount;
            this.virtualGrid.setItems(result.galleries, result.subfolders);
        } catch (err) {
            if (navId !== this._navId) return;
            console.error('Failed to navigate:', err);
            this.gridCount.textContent = 'Error loading folder';
        }
    }

    /**
     * Open a gallery detail view
     */
    async openGallery(gallery) {
        if (!gallery.id || gallery.id === 0) {
            // Not yet scanned — open the folder in file explorer
            if (gallery.path) {
                api.openFile(gallery.path);
            }
            return;
        }

        // Push current path to history (cap size to prevent unbounded growth)
        if (this.navigationHistory.length >= this._maxHistory) {
            this.navigationHistory.shift();
        }
        this.navigationHistory.push(this.currentPath || '');

        this.galleryGridEl.classList.add('hidden');
        await this.galleryView.load(gallery.id);

        this.btnBack.disabled = false;
        this.updateBreadcrumb(gallery.path, getDisplayTitle(gallery, this.titlePref));
    }

    /**
     * Go back in navigation history.
     * Responds immediately even if a large folder is still loading.
     */
    goBack() {
        if (this._goingBack) return; // prevent rapid repeated clicks
        this._goingBack = true;

        const finish = () => { this._goingBack = false; };

        if (!this.galleryViewEl.classList.contains('hidden')) {
            this.galleryView.hide();
            this.galleryGridEl.classList.remove('hidden');
            const prevPath = this.navigationHistory.pop();
            if (prevPath) {
                this.currentPath = prevPath;
                // If data changed while we were in gallery view, re-fetch
                if (this._pendingRefresh) {
                    this._pendingRefresh = false;
                    this.navigateToFolder(prevPath).finally(finish);
                } else {
                    this.updateBreadcrumb(prevPath);
                    this.folderTree.setActive(prevPath).finally(finish);
                }
            } else {
                finish();
            }
            this.btnBack.disabled = this.navigationHistory.length === 0;
            return;
        }

        if (this.navigationHistory.length > 0) {
            const prevPath = this.navigationHistory.pop();
            this.currentPath = prevPath;
            this.navigateToFolder(prevPath).finally(finish);
        } else {
            finish();
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

        this._lastGridCount = `${result.total_count} results`;
        this.gridCount.textContent = this._lastGridCount;
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
            // Don't hide the overlay here — a different scan may still be running.
            // The overlay is always hidden by the scan-complete event instead.
        }
    }

    /**
     * Show duplicates modal
     */
    async showDuplicates() {
        this.duplicatesModal.classList.remove('hidden');
        this.duplicatesBody.innerHTML = '<p class="dup-empty">Checking for duplicates...</p>';

        try {
            const result = await api.getDuplicateGalleries();
            this.duplicatesBody.innerHTML = '';

            const totalGroups = result.by_url.length + result.by_name.length;
            if (totalGroups === 0) {
                this.duplicatesBody.innerHTML = '<p class="dup-empty">No duplicates found.</p>';
                return;
            }

            if (result.by_url.length > 0) {
                const h = document.createElement('h4');
                h.className = 'dup-section-title';
                h.textContent = `By URL (${result.by_url.length} groups)`;
                this.duplicatesBody.appendChild(h);
                for (const group of result.by_url) {
                    this._renderDupGroup(group);
                }
            }

            if (result.by_name.length > 0) {
                const h = document.createElement('h4');
                h.className = 'dup-section-title';
                h.textContent = `By Title (${result.by_name.length} groups)`;
                this.duplicatesBody.appendChild(h);
                for (const group of result.by_name) {
                    this._renderDupGroup(group);
                }
            }
        } catch (err) {
            this.duplicatesBody.innerHTML = `<p class="dup-empty">Error: ${err}</p>`;
        }
    }

    _renderDupGroup(group) {
        const groupEl = document.createElement('div');
        groupEl.className = 'dup-group';

        for (const gallery of group) {
            const entry = document.createElement('div');
            entry.className = 'dup-entry';
            entry.dataset.id = gallery.id;

            const img = document.createElement('img');
            img.className = 'dup-thumb';
            img.alt = '';
            if (gallery.thumb_path) {
                loadThumb(gallery.thumb_path).then(src => { img.src = src; });
            }

            const info = document.createElement('div');
            info.className = 'dup-info';

            const title = document.createElement('div');
            title.className = 'dup-title';
            const dupDisplayTitle = getDisplayTitle(gallery, this.titlePref);
            title.textContent = dupDisplayTitle;
            title.title = dupDisplayTitle;

            const path = document.createElement('div');
            path.className = 'dup-path';
            path.textContent = gallery.path;

            const meta = document.createElement('div');
            meta.className = 'dup-meta';
            meta.textContent = `${gallery.page_count} pages | ${gallery.rating.toFixed(1)} | ${gallery.category}`;

            info.appendChild(title);
            info.appendChild(path);
            info.appendChild(meta);

            const btn = document.createElement('button');
            btn.className = 'dup-delete-btn';
            btn.textContent = 'Delete';
            btn.addEventListener('click', () => this._confirmDeleteDuplicate(gallery, entry, groupEl));

            entry.appendChild(img);
            entry.appendChild(info);
            entry.appendChild(btn);
            groupEl.appendChild(entry);
        }

        this.duplicatesBody.appendChild(groupEl);
    }

    async _confirmDeleteDuplicate(gallery, entryEl, groupEl) {
        const galleryId = gallery.id;

        // Disable ALL delete buttons for this gallery across every group
        // (same gallery can appear in both by_url and by_name sections)
        const allEntries = this.duplicatesBody.querySelectorAll(`.dup-entry[data-id="${galleryId}"]`);
        for (const e of allEntries) {
            const b = e.querySelector('.dup-delete-btn');
            if (b) b.disabled = true;
        }

        const name = getDisplayTitle(gallery, this.titlePref);
        const ok = await ask(
            `Path: ${gallery.path}\n\nThis will permanently delete the folder and all its files from disk, remove the DB entry, and clean up the cached thumbnail.`,
            { title: `Delete "${name}"?`, kind: 'warning' }
        );
        if (!ok) {
            // Re-enable all buttons for this gallery
            for (const e of allEntries) {
                const b = e.querySelector('.dup-delete-btn');
                if (b) b.disabled = false;
            }
            return;
        }

        for (const e of allEntries) {
            const b = e.querySelector('.dup-delete-btn');
            if (b) b.textContent = 'Deleting...';
        }

        try {
            await api.deleteGallery(galleryId);

            // Remove ALL entries for this gallery from every group
            for (const e of allEntries) {
                const group = e.closest('.dup-group');
                e.remove();
                // If the group now has fewer than 2 entries, remove the whole group
                if (group && group.querySelectorAll('.dup-entry').length < 2) {
                    group.remove();
                }
            }

            // Remove section headers that have no groups after them
            this._cleanupDupSectionHeaders();

            // If no groups remain, show empty message
            if (this.duplicatesBody.querySelectorAll('.dup-group').length === 0) {
                this.duplicatesBody.innerHTML = '<p class="dup-empty">No duplicates found.</p>';
            }

            // Refresh the current view since data changed
            this._refreshCurrentView();
        } catch (err) {
            for (const e of allEntries) {
                const b = e.querySelector('.dup-delete-btn');
                if (b) { b.disabled = false; b.textContent = 'Delete'; }
            }
            alert(`Failed to delete: ${err}`);
        }
    }

    _cleanupDupSectionHeaders() {
        const headers = this.duplicatesBody.querySelectorAll('.dup-section-title');
        for (const header of headers) {
            // Check if there are any .dup-group siblings between this header and the next header (or end)
            let hasGroups = false;
            let sibling = header.nextElementSibling;
            while (sibling && !sibling.classList.contains('dup-section-title')) {
                if (sibling.classList.contains('dup-group')) {
                    hasGroups = true;
                    break;
                }
                sibling = sibling.nextElementSibling;
            }
            if (!hasGroups) {
                header.remove();
            }
        }
    }

    /**
     * Toggle title preference between EN and JP
     */
    async toggleTitlePref() {
        this.titlePref = this.titlePref === 'en' ? 'jp' : 'en';
        this.virtualGrid.titlePref = this.titlePref;
        this.galleryView.titlePref = this.titlePref;
        this._updateTitleToggleBtn();
        api.setTitlePref(this.titlePref).catch(() => {});

        // Re-render grid
        if (this.currentPath && !this.isSearchMode) {
            this.navigateToFolder(this.currentPath);
        }
    }

    _updateTitleToggleBtn() {
        const btn = document.getElementById('btn-title-toggle');
        if (btn) {
            btn.textContent = this.titlePref === 'en' ? 'EN' : 'JP';
            btn.title = `Showing ${this.titlePref === 'en' ? 'English' : 'Japanese'} titles — click to toggle`;
        }
    }

    /**
     * Batch refresh all currently displayed galleries that have URLs
     */
    async batchRefreshCurrentGalleries() {
        const galleries = this.virtualGrid.items;
        const ids = galleries.filter(g => g.id > 0).map(g => g.id);
        if (ids.length === 0) return;

        try {
            await api.batchRefreshGalleries(ids);
        } catch (err) {
            console.error('Batch refresh error:', err);
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
        // Update title toggle button
        this._updateTitleToggleBtn();

        // Update grid size slider and sync grid
        try {
            const w = await api.getGridCardWidth();
            const slider = document.getElementById('grid-size-slider');
            const label = document.getElementById('grid-size-value');
            if (slider) slider.value = w;
            if (label) label.textContent = `${w}px`;
            if (w >= 150 && w <= 400) {
                this.virtualGrid.setCardSize(w);
            }
        } catch (_) {}

        // Update cookie status
        try {
            const [cookiePath, cookieExists] = await api.getCookieStatus();
            const statusEl = document.getElementById('cookie-status');
            if (cookieExists) {
                statusEl.textContent = cookiePath;
                statusEl.style.color = 'var(--text-secondary)';
            } else {
                statusEl.textContent = 'Not configured';
                statusEl.style.color = 'var(--text-muted)';
            }
        } catch (_) {}

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
