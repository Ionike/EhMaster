import { api } from './api.js';
import { parseSearchInput, debounce } from './utils.js';

/**
 * Search controller
 */
export class SearchController {
    constructor(inputEl, options = {}) {
        this.input = inputEl;
        this.onResults = options.onResults || (() => {});
        this.onClear = options.onClear || (() => {});

        this.currentQuery = null;
        this.isSearching = false;

        this._debouncedSearch = debounce(() => this._performSearch(), 300);

        this.input.addEventListener('input', () => {
            const value = this.input.value.trim();
            if (value === '') {
                this.currentQuery = null;
                this.onClear();
            } else {
                this._debouncedSearch();
            }
        });

        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.clear();
            }
        });
    }

    /**
     * Set search text programmatically (e.g., clicking a tag)
     */
    setSearch(text) {
        this.input.value = text;
        this._performSearch();
    }

    /**
     * Append a tag filter to the search
     */
    addTag(namespace, tag) {
        const tagStr = `${namespace}:${tag.replace(/\s+/g, '_')}`;
        const current = this.input.value.trim();

        // Avoid duplicates
        if (current.includes(tagStr)) return;

        this.input.value = current ? `${current} ${tagStr}` : tagStr;
        this._performSearch();
    }

    clear() {
        this.input.value = '';
        this.currentQuery = null;
        this.onClear();
    }

    async _performSearch() {
        const value = this.input.value.trim();
        if (!value) {
            this.currentQuery = null;
            this.onClear();
            return;
        }

        const parsed = parseSearchInput(value);
        this.currentQuery = {
            text: parsed.text,
            tags: parsed.tags,
            category: null,
            language: null,
            sort_by: null,
            sort_order: null,
            offset: 0,
            limit: 200,
        };

        this.isSearching = true;

        try {
            const result = await api.searchGalleries(this.currentQuery);
            this.onResults(result);
        } catch (err) {
            console.error('Search error:', err);
        } finally {
            this.isSearching = false;
        }
    }

    /**
     * Load more results (for pagination/infinite scroll)
     */
    async loadMore(offset) {
        if (!this.currentQuery || this.isSearching) return null;

        this.currentQuery.offset = offset;
        this.isSearching = true;

        try {
            const result = await api.searchGalleries(this.currentQuery);
            return result;
        } catch (err) {
            console.error('Search loadMore error:', err);
            return null;
        } finally {
            this.isSearching = false;
        }
    }

    updateSort(sortBy, sortOrder) {
        if (!this.currentQuery) return;
        this.currentQuery.sort_by = sortBy;
        this.currentQuery.sort_order = sortOrder;
        this.currentQuery.offset = 0;
        this._performSearch();
    }
}
