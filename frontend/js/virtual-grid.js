import { assetUrl } from './api.js';
import { getCategoryClass, formatRating } from './utils.js';

/**
 * Virtual scrolling grid component.
 * Only renders items visible in the viewport + a buffer for smooth scrolling.
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
        this.renderedRange = { start: -1, end: -1 };

        this.onGalleryClick = options.onGalleryClick || (() => {});
        this.onFolderClick = options.onFolderClick || (() => {});

        this._scrollHandler = this._onScroll.bind(this);
        this._resizeHandler = this._onResize.bind(this);
        this._ticking = false;

        this.container.addEventListener('scroll', this._scrollHandler);
        window.addEventListener('resize', this._resizeHandler);
    }

    /**
     * Set the items to display
     */
    setItems(galleries, folders = []) {
        this.items = galleries;
        this.folders = folders;
        this.pool.forEach(node => node.remove());
        this.pool.clear();
        this.renderedRange = { start: -1, end: -1 };
        this._layout();
    }

    /**
     * Get total number of displayable items (folders + galleries)
     */
    get totalItems() {
        return this.folders.length + this.items.length;
    }

    /**
     * Calculate layout and render visible items
     */
    _layout() {
        const containerWidth = this.container.clientWidth - this.gap * 2;
        this.columns = Math.max(1, Math.floor((containerWidth + this.gap) / this.cardWidth));

        // Folder rows (shorter height)
        const folderRows = Math.ceil(this.folders.length / this.columns);
        const folderHeight = this.folders.length > 0 ? folderRows * 136 : 0;

        // Gallery rows
        const galleryRows = Math.ceil(this.items.length / this.columns);
        const totalHeight = folderHeight + galleryRows * this.cardHeight + this.gap;

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
        this._layout();
    }

    _render() {
        const scrollTop = this.container.scrollTop;
        const viewportHeight = this.container.clientHeight;

        // Calculate visible folder range
        const folderRowHeight = 136;
        const folderStart = 0;
        const folderEnd = this.folders.length;

        // Calculate visible gallery range
        let galleryStartRow, galleryEndRow;
        if (scrollTop < this._folderHeight) {
            galleryStartRow = 0;
        } else {
            galleryStartRow = Math.floor((scrollTop - this._folderHeight) / this.cardHeight);
        }
        galleryEndRow = Math.ceil((scrollTop + viewportHeight - this._folderHeight) / this.cardHeight);

        galleryStartRow = Math.max(0, galleryStartRow - this.buffer);
        galleryEndRow = Math.min(
            Math.ceil(this.items.length / this.columns),
            galleryEndRow + this.buffer
        );

        const galleryStartIdx = galleryStartRow * this.columns;
        const galleryEndIdx = Math.min(this.items.length, galleryEndRow * this.columns);

        const newRange = { start: galleryStartIdx, end: galleryEndIdx };

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
            if (idx < newRange.start || idx >= newRange.end) {
                node.remove();
                this.pool.delete(key);
            }
        }

        // Add in-range gallery nodes
        for (let i = newRange.start; i < newRange.end; i++) {
            const key = `${i}`;
            if (!this.pool.has(key)) {
                const node = this._createGalleryNode(this.items[i], i);
                this.sentinel.appendChild(node);
                this.pool.set(key, node);
            }
        }

        this.renderedRange = newRange;
    }

    _createGalleryNode(gallery, index) {
        const col = index % this.columns;
        const row = Math.floor(index / this.columns);
        const x = this.gap + col * this.cardWidth;
        const y = this._folderHeight + row * this.cardHeight;

        const card = document.createElement('div');
        card.className = 'gallery-card';
        card.style.transform = `translate(${x}px, ${y}px)`;
        card.style.width = `${this.cardWidth - this.gap}px`;

        const thumb = document.createElement('div');
        thumb.className = 'card-thumb';

        if (gallery.thumb_path) {
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.src = assetUrl(gallery.thumb_path);
            img.alt = gallery.title_en || gallery.folder_name;
            img.onerror = () => { img.style.display = 'none'; };
            thumb.appendChild(img);
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'placeholder';
            placeholder.textContent = '\uD83D\uDDBC\uFE0F';
            placeholder.style.fontSize = '48px';
            placeholder.style.opacity = '0.3';
            thumb.appendChild(placeholder);
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
        card.style.transform = `translate(${x}px, ${y}px)`;
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

    destroy() {
        this.container.removeEventListener('scroll', this._scrollHandler);
        window.removeEventListener('resize', this._resizeHandler);
        this.pool.forEach(node => node.remove());
        this.pool.clear();
    }
}
