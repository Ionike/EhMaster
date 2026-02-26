import { api, assetUrl } from './api.js';
import { getCategoryClass, formatRating } from './utils.js';

/**
 * Gallery detail view - shows all pages of a gallery
 */
export class GalleryView {
    constructor(container, options = {}) {
        this.container = container;
        this.onTagClick = options.onTagClick || (() => {});
        this.onBack = options.onBack || (() => {});
    }

    /**
     * Load and render a gallery by ID
     */
    async load(galleryId) {
        this.container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);">Loading...</div>';
        this.container.classList.remove('hidden');

        try {
            const [detail, pages] = await Promise.all([
                api.getGallery(galleryId),
                api.getGalleryPages(galleryId),
            ]);

            if (!detail) {
                this.container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);">Gallery not found</div>';
                return;
            }

            this.render(detail, pages);
        } catch (err) {
            console.error('Failed to load gallery:', err);
            this.container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--danger);">Error: ${err}</div>`;
        }
    }

    /**
     * Render gallery detail and page grid
     */
    render(detail, pages) {
        const { gallery, tags } = detail;
        this.container.innerHTML = '';

        // Header section
        const header = document.createElement('div');
        header.className = 'gv-header';

        // Titles
        const titles = document.createElement('div');
        titles.className = 'gv-titles';

        const titleEn = document.createElement('div');
        titleEn.className = 'gv-title-en';
        titleEn.textContent = gallery.title_en || gallery.folder_name;
        titles.appendChild(titleEn);

        if (gallery.title_jp) {
            const titleJp = document.createElement('div');
            titleJp.className = 'gv-title-jp';
            titleJp.textContent = gallery.title_jp;
            titles.appendChild(titleJp);
        }

        header.appendChild(titles);

        // Meta info row
        const meta = document.createElement('div');
        meta.className = 'gv-meta';

        if (gallery.category) {
            const badge = document.createElement('span');
            badge.className = `cat-badge ${getCategoryClass(gallery.category)}`;
            badge.textContent = gallery.category;
            meta.appendChild(badge);
        }

        if (gallery.rating > 0) {
            const rating = document.createElement('span');
            rating.className = 'gv-rating';
            rating.textContent = formatRating(gallery.rating);
            meta.appendChild(rating);
        }

        const pageCount = document.createElement('span');
        pageCount.textContent = `${pages.length} pages`;
        meta.appendChild(pageCount);

        if (gallery.language) {
            const lang = document.createElement('span');
            lang.textContent = gallery.language;
            meta.appendChild(lang);
        }

        if (gallery.file_size) {
            const size = document.createElement('span');
            size.textContent = gallery.file_size;
            meta.appendChild(size);
        }

        if (gallery.uploader) {
            const uploader = document.createElement('span');
            uploader.textContent = `by ${gallery.uploader}`;
            meta.appendChild(uploader);
        }

        header.appendChild(meta);

        // URL link
        if (gallery.url) {
            const urlDiv = document.createElement('div');
            urlDiv.className = 'gv-url';
            const a = document.createElement('a');
            a.href = '#';
            a.textContent = gallery.url;
            a.addEventListener('click', (e) => {
                e.preventDefault();
                api.openFile(gallery.url);
            });
            urlDiv.appendChild(a);
            header.appendChild(urlDiv);
        }

        // Tags
        if (tags.length > 0) {
            const tagsDiv = document.createElement('div');
            tagsDiv.className = 'gv-tags';

            // Group tags by namespace
            const grouped = {};
            for (const t of tags) {
                if (!grouped[t.namespace]) grouped[t.namespace] = [];
                grouped[t.namespace].push(t.tag);
            }

            for (const [ns, tagList] of Object.entries(grouped)) {
                for (const tag of tagList) {
                    const group = document.createElement('div');
                    group.className = 'gv-tag-group';

                    const nsEl = document.createElement('span');
                    nsEl.className = 'gv-tag-namespace';
                    nsEl.textContent = ns;

                    const tagEl = document.createElement('span');
                    tagEl.className = 'gv-tag';
                    tagEl.textContent = tag;
                    tagEl.title = `${ns}:${tag}`;
                    tagEl.addEventListener('click', () => {
                        this.onTagClick(ns, tag);
                    });

                    group.appendChild(nsEl);
                    group.appendChild(tagEl);
                    tagsDiv.appendChild(group);
                }
            }

            header.appendChild(tagsDiv);
        }

        this.container.appendChild(header);

        // Pages grid
        const pagesGrid = document.createElement('div');
        pagesGrid.className = 'gv-pages';

        for (const page of pages) {
            const pageEl = document.createElement('div');
            pageEl.className = 'gv-page';

            const img = document.createElement('img');
            img.loading = 'lazy';
            img.src = assetUrl(page.path);
            img.alt = page.filename;
            img.onerror = () => { img.style.opacity = '0.3'; };

            const num = document.createElement('div');
            num.className = 'gv-page-num';
            num.textContent = page.index + 1;

            pageEl.appendChild(img);
            pageEl.appendChild(num);

            pageEl.addEventListener('click', () => {
                api.openFile(page.path);
            });

            pagesGrid.appendChild(pageEl);
        }

        this.container.appendChild(pagesGrid);
    }

    hide() {
        this.container.classList.add('hidden');
        this.container.innerHTML = '';
    }
}
