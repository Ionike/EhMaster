import { loadThumb } from './api.js';
import { getCategoryClass, formatRating } from './utils.js';

/**
 * Virtual scrolling grid component.
 * Only renders items visible in the viewport + a buffer for smooth scrolling.
 * Galleries with horizontal thumbnails (width > height) span 2 columns.
 * Wideness is detected on the frontend when images load, triggering re-layout.
 */
export class VirtualGrid {
    constructor(container, sentinel, options = {}) {
        this.container = container;   // scrollable parent
        this.sentinel = sentinel;     // height spacer element
        this.cardWidth = options.cardWidth || 216;   // card + gap
        this.cardHeight = options.cardHeight || 350; // card + gap
        this.gap = options.gap || 16;
        this.buffer = options.buffer || 3;           // extra rows

        this.items = [];        // all gallery items
        this.folders = [];      // folder items (shown before galleries)
        this.pool = new Map();  // index -> DOM node
        this.columns = 1;

        // Layout data (computed by _computeLayout)
        this._layoutPositions = []; // [{col, row, colSpan}, ...]
        this._rowItems = [];        // row -> [itemIndex, ...]
        this._galleryRowCount = 0;

        // Track which gallery indices are known to be wide (detected on image load)
        this._wideSet = new Set();
        this._relayoutTimer = null;

        this.onGalleryClick = options.onGalleryClick || (() => {});
        this.onFolderClick = options.onFolderClick || (() => {});

        this._scrollHandler = this._onScroll.bind(this);
        this._resizeHandler = this._onResize.bind(this);
        this._ticking = false;
        this._resizeTicking = false;

        this.container.addEventListener('scroll', this._scrollHandler);
        window.addEventListener('resize', this._resizeHandler);
    }

    /**
     * Set the items to display
     */
    setItems(galleries, folders = []) {
        this.items = galleries;
        this.folders = folders;
        this._wideSet.clear();
        this.pool.forEach(node => node.remove());
        this.pool.clear();
        this.container.scrollTop = 0;
        this._layout();
    }

    /**
     * Get total number of displayable items (folders + galleries)
     */
    get totalItems() {
        return this.folders.length + this.items.length;
    }

    /**
     * Called when a thumbnail finishes loading and is detected as wide.
     * Batches re-layouts so multiple detections in quick succession
     * only trigger one reflow.
     */
    _markWide(index) {
        if (this._wideSet.has(index)) return;
        this._wideSet.add(index);
        if (this._relayoutTimer) return; // already scheduled
        this._relayoutTimer = requestAnimationFrame(() => {
            this._relayoutTimer = null;
            const scrollTop = this.container.scrollTop;
            this.pool.forEach(node => node.remove());
            this.pool.clear();
            this._layout();
            this.container.scrollTop = scrollTop;
        });
    }

    /**
     * Greedy bin-packing layout: assigns each gallery a (col, row, colSpan).
     * Wide galleries span 2 columns. Gaps are filled by subsequent normal items.
     */
    _computeLayout() {
        const items = this.items;
        const cols = this.columns;
        const wideSet = this._wideSet;
        const grid = []; // sparse array of rows, each row is bool[cols]
        const positions = new Array(items.length);
        const rowItems = [];
        let maxRow = 0;
        let firstOpenRow = 0;

        function getRow(r) {
            if (!grid[r]) grid[r] = new Array(cols).fill(false);
            return grid[r];
        }

        function findPosition(span) {
            for (let r = firstOpenRow; ; r++) {
                const row = getRow(r);
                for (let c = 0; c <= cols - span; c++) {
                    let fits = true;
                    for (let s = 0; s < span; s++) {
                        if (row[c + s]) { fits = false; break; }
                    }
                    if (fits) return { row: r, col: c };
                }
            }
        }

        for (let i = 0; i < items.length; i++) {
            const isWide = wideSet.has(i);
            const span = (isWide && cols > 1) ? 2 : 1;

            const pos = findPosition(span);
            positions[i] = { col: pos.col, row: pos.row, colSpan: span };

            // Mark cells as occupied
            const rowArr = getRow(pos.row);
            for (let s = 0; s < span; s++) {
                rowArr[pos.col + s] = true;
            }

            // Build row-to-items index
            if (!rowItems[pos.row]) rowItems[pos.row] = [];
            rowItems[pos.row].push(i);

            if (pos.row > maxRow) maxRow = pos.row;

            // Advance firstOpenRow past fully-filled rows
            while (firstOpenRow <= maxRow) {
                const fr = getRow(firstOpenRow);
                if (fr.every(Boolean)) {
                    firstOpenRow++;
                } else {
                    break;
                }
            }
        }

        this._layoutPositions = positions;
        this._rowItems = rowItems;
        this._galleryRowCount = items.length > 0 ? maxRow + 1 : 0;
    }

    /**
     * Calculate layout and render visible items
     */
    _layout() {
        const containerWidth = this.container.clientWidth - this.gap * 2;
        const newColumns = Math.max(1, Math.floor((containerWidth + this.gap) / this.cardWidth));

        // If column count changed, clear pool so nodes get recreated at correct positions
        if (newColumns !== this.columns) {
            this.pool.forEach(node => node.remove());
            this.pool.clear();
        }
        this.columns = newColumns;

        // Compute bin-packing layout
        this._computeLayout();

        // Folder rows (shorter height)
        const folderRows = Math.ceil(this.folders.length / this.columns);
        const folderHeight = this.folders.length > 0 ? folderRows * 136 : 0;

        // Gallery rows from layout
        const totalHeight = folderHeight + this._galleryRowCount * this.cardHeight + this.gap;

        this.sentinel.style.height = `${totalHeight}px`;
        this._folderHeight = folderHeight;
        this._folderRows = folderRows;

        this._render();
    }

    _onScroll() {
        if (!this._ticking) {
            requestAnimationFrame(() => {
                this._render();
                this._ticking = false;
            });
            this._ticking = true;
        }
    }

    _onResize() {
        if (!this._resizeTicking) {
            requestAnimationFrame(() => {
                this._layout();
                this._resizeTicking = false;
            });
            this._resizeTicking = true;
        }
    }

    _render() {
        const scrollTop = this.container.scrollTop;
        const viewportHeight = this.container.clientHeight;

        // Calculate visible gallery row range
        let galleryStartRow, galleryEndRow;
        if (scrollTop < this._folderHeight) {
            galleryStartRow = 0;
        } else {
            galleryStartRow = Math.floor((scrollTop - this._folderHeight) / this.cardHeight);
        }
        galleryEndRow = Math.max(0, Math.ceil((scrollTop + viewportHeight - this._folderHeight) / this.cardHeight));

        galleryStartRow = Math.max(0, galleryStartRow - this.buffer);
        galleryEndRow = Math.min(this._galleryRowCount, galleryEndRow + this.buffer);

        // Collect visible gallery indices from row-to-items index
        const visibleIndices = new Set();
        for (let r = galleryStartRow; r < galleryEndRow; r++) {
            if (this._rowItems[r]) {
                for (const idx of this._rowItems[r]) {
                    visibleIndices.add(idx);
                }
            }
        }

        // Render folders (always render all since they're few)
        for (let i = 0; i < this.folders.length; i++) {
            const key = `f_${i}`;
            if (!this.pool.has(key)) {
                const node = this._createFolderNode(this.folders[i], i);
                this.sentinel.appendChild(node);
                this.pool.set(key, node);
            }
        }

        // Remove out-of-range gallery nodes
        for (const [key, node] of this.pool) {
            if (key.startsWith('f_')) continue;
            const idx = parseInt(key);
            if (!visibleIndices.has(idx)) {
                node.remove();
                this.pool.delete(key);
            }
        }

        // Add visible gallery nodes
        for (const i of visibleIndices) {
            const key = `${i}`;
            if (!this.pool.has(key)) {
                const node = this._createGalleryNode(this.items[i], i);
                this.sentinel.appendChild(node);
                this.pool.set(key, node);
            }
        }
    }

    _createGalleryNode(gallery, index) {
        const pos = this._layoutPositions[index];
        const x = this.gap + pos.col * this.cardWidth;
        const y = this._folderHeight + pos.row * this.cardHeight;
        const cardW = pos.colSpan * this.cardWidth - this.gap;

        const card = document.createElement('div');
        card.className = pos.colSpan > 1 ? 'gallery-card gallery-card-wide' : 'gallery-card';
        card.style.left = `${x}px`;
        card.style.top = `${y}px`;
        card.style.width = `${cardW}px`;

        const thumb = document.createElement('div');
        thumb.className = 'card-thumb';

        if (gallery.thumb_path) {
            // Load thumbnail via IPC (returns base64 data URL)
            const img = document.createElement('img');
            img.alt = gallery.title_en || gallery.folder_name;
            thumb.appendChild(img);
            loadThumb(gallery.thumb_path).then(dataUrl => {
                if (dataUrl) {
                    img.src = dataUrl;
                    img.onload = () => {
                        if (img.naturalWidth > img.naturalHeight) {
                            this._markWide(index);
                        }
                    };
                } else {
                    this._showPlaceholder(thumb, img);
                }
            });
            img.onerror = () => {
                this._showPlaceholder(thumb, img);
            };
        } else {
            this._appendPlaceholder(thumb);
        }

        const info = document.createElement('div');
        info.className = 'card-info';

        const title = document.createElement('div');
        title.className = 'card-title';
        title.textContent = gallery.title_en || gallery.folder_name;
        title.title = gallery.title_en || gallery.folder_name;

        const meta = document.createElement('div');
        meta.className = 'card-meta';

        if (gallery.category) {
            const badge = document.createElement('span');
            badge.className = `cat-badge ${getCategoryClass(gallery.category)}`;
            badge.textContent = gallery.category;
            meta.appendChild(badge);
        }

        if (gallery.rating > 0) {
            const rating = document.createElement('span');
            rating.className = 'card-rating';
            rating.textContent = formatRating(gallery.rating);
            meta.appendChild(rating);
        }

        if (gallery.page_count > 0) {
            const pages = document.createElement('span');
            pages.className = 'card-pages';
            pages.textContent = `${gallery.page_count}p`;
            meta.appendChild(pages);
        }

        info.appendChild(title);
        info.appendChild(meta);
        card.appendChild(thumb);
        card.appendChild(info);

        card.addEventListener('click', () => {
            this.onGalleryClick(gallery);
        });

        return card;
    }

    _createFolderNode(folder, index) {
        const col = index % this.columns;
        const row = Math.floor(index / this.columns);
        const x = this.gap + col * this.cardWidth;
        const y = row * 136;

        const card = document.createElement('div');
        card.className = 'folder-card';
        card.style.left = `${x}px`;
        card.style.top = `${y}px`;
        card.style.width = `${this.cardWidth - this.gap}px`;

        const icon = document.createElement('div');
        icon.className = 'folder-icon';
        icon.textContent = '\uD83D\uDCC1';

        const name = document.createElement('div');
        name.className = 'folder-name';
        name.textContent = folder.name;
        name.title = folder.path;

        card.appendChild(icon);
        card.appendChild(name);

        card.addEventListener('click', () => {
            this.onFolderClick(folder);
        });

        return card;
    }

    _showPlaceholder(thumb, img) {
        img.remove();
        this._appendPlaceholder(thumb);
    }

    _appendPlaceholder(thumb) {
        const ph = document.createElement('div');
        ph.className = 'placeholder';
        ph.textContent = '\uD83D\uDDBC\uFE0F';
        ph.style.fontSize = '48px';
        ph.style.opacity = '0.3';
        thumb.appendChild(ph);
    }

    destroy() {
        this.container.removeEventListener('scroll', this._scrollHandler);
        window.removeEventListener('resize', this._resizeHandler);
        this.pool.forEach(node => node.remove());
        this.pool.clear();
    }
}
