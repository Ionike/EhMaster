/**
 * Debounce a function call
 */
export function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * Get category CSS class from category name
 */
export function getCategoryClass(category) {
    if (!category) return 'cat-misc';
    const lower = category.toLowerCase().replace(/\s+/g, '');
    const map = {
        'doujinshi': 'cat-doujinshi',
        'manga': 'cat-manga',
        'artistcg': 'cat-artistcg',
        'gamecg': 'cat-gamecg',
        'non-h': 'cat-non-h',
        'cosplay': 'cat-cosplay',
        'westerncomics': 'cat-misc',
        'imageset': 'cat-misc',
    };
    return map[lower] || 'cat-misc';
}

/**
 * Format rating as stars
 */
export function formatRating(rating) {
    if (!rating) return '';
    return `\u2605 ${rating.toFixed(1)}`;
}

/**
 * Parse search input into text query and tag filters
 * Syntax: "free text artist:name female:tag"
 */
export function parseSearchInput(input) {
    const parts = input.trim().split(/\s+/);
    const tags = [];
    const textParts = [];

    for (const part of parts) {
        const colonIdx = part.indexOf(':');
        if (colonIdx > 0 && colonIdx < part.length - 1) {
            const namespace = part.substring(0, colonIdx);
            const tag = part.substring(colonIdx + 1).replace(/_/g, ' ');
            tags.push({ namespace, tag });
        } else {
            textParts.push(part);
        }
    }

    return {
        text: textParts.join(' ').trim() || null,
        tags,
    };
}

/**
 * Convert backslashes to forward slashes
 */
export function normalizePath(path) {
    return path.replace(/\\/g, '/');
}

/**
 * Get the last segment of a path
 */
export function basename(path) {
    const normalized = normalizePath(path);
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
}
