import { api } from './api.js';

/**
 * Sidebar folder tree component.
 */
export class FolderTree {
    constructor(container, onFolderSelect) {
        this.container = container;
        this.onFolderSelect = onFolderSelect;
        this.activePath = null;
        this.expandedPaths = new Set();
    }

    /**
     * Load root folders and render the tree
     */
    async loadRoots() {
        const paths = await api.getRootPaths();
        this.container.innerHTML = '';

        if (paths.length === 0) {
            this.container.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px;">No folders added</div>';
            return;
        }

        for (const path of paths) {
            const node = this.createNode({
                name: this.getBasename(path),
                path: path,
                has_children: true,
            }, true);
            this.container.appendChild(node);
        }
    }

    /**
     * Create a tree node DOM element
     */
    createNode(folder, isRoot = false) {
        const np = folder.path.replace(/\\/g, '/');
        const node = document.createElement('div');
        node.className = 'tree-node';
        node.dataset.path = np;

        const label = document.createElement('div');
        label.className = 'tree-label';
        if (this.activePath === np) {
            label.classList.add('active');
        }

        // Toggle arrow
        const toggle = document.createElement('span');
        toggle.className = 'tree-toggle';
        if (folder.has_children) {
            toggle.textContent = '\u25B6'; // right-pointing triangle
            if (this.expandedPaths.has(np)) {
                toggle.classList.add('expanded');
            }
        } else {
            toggle.classList.add('empty');
        }

        // Folder icon
        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.textContent = isRoot ? '\uD83D\uDCC1' : '\uD83D\uDCC2'; // folder icons

        // Name
        const name = document.createElement('span');
        name.className = 'tree-name';
        name.textContent = folder.name;
        name.title = folder.path;

        label.appendChild(toggle);
        label.appendChild(icon);
        label.appendChild(name);
        node.appendChild(label);

        // Children container
        const children = document.createElement('div');
        children.className = 'tree-children';
        if (!this.expandedPaths.has(np)) {
            children.classList.add('collapsed');
        }
        node.appendChild(children);

        // Click handler
        label.addEventListener('click', async (e) => {
            e.stopPropagation();

            // Toggle expansion
            if (folder.has_children) {
                const isExpanded = this.expandedPaths.has(np);
                if (isExpanded) {
                    this.expandedPaths.delete(np);
                    toggle.classList.remove('expanded');
                    children.classList.add('collapsed');
                } else {
                    this.expandedPaths.add(np);
                    toggle.classList.add('expanded');
                    children.classList.remove('collapsed');
                    // Load children if empty
                    if (children.children.length === 0) {
                        await this.loadChildren(np, children);
                    }
                }
            }

            // Select this folder
            await this.setActive(np);
            this.onFolderSelect(np);
        });

        // Auto-load if already expanded
        if (this.expandedPaths.has(np) && children.children.length === 0) {
            this.loadChildren(np, children);
        }

        return node;
    }

    /**
     * Load children of a folder
     */
    async loadChildren(path, container) {
        try {
            const result = await api.getFolderChildren(path);
            container.innerHTML = '';

            for (const subfolder of result.subfolders) {
                const node = this.createNode(subfolder);
                container.appendChild(node);
            }

            // If no subfolders, show empty state
            if (result.subfolders.length === 0) {
                // Nothing to show in tree, galleries are in the grid
            }
        } catch (err) {
            console.error('Failed to load children:', err);
        }
    }

    /**
     * Set the active (selected) folder, expanding ancestors if needed.
     */
    async setActive(path) {
        this.activePath = path.replace(/\\/g, '/');
        // Update visual state
        this.container.querySelectorAll('.tree-label.active').forEach(el => {
            el.classList.remove('active');
        });
        let node = this.container.querySelector(`[data-path="${CSS.escape(this.activePath)}"] > .tree-label`);
        if (!node) {
            // Node not in DOM yet — expand ancestor chain to reveal it
            await this._revealPath(this.activePath);
            node = this.container.querySelector(`[data-path="${CSS.escape(this.activePath)}"] > .tree-label`);
        }
        if (node) {
            node.classList.add('active');
            node.scrollIntoView({ block: 'nearest' });
        }
    }

    /**
     * Expand the tree along the ancestor chain so that `targetPath` becomes visible.
     */
    async _revealPath(targetPath) {
        // Find which root this path belongs to
        const roots = Array.from(this.container.querySelectorAll(':scope > .tree-node'));
        let matchRoot = null;
        for (const root of roots) {
            const rp = root.dataset.path;
            if (targetPath === rp || targetPath.startsWith(rp + '/')) {
                matchRoot = root;
                break;
            }
        }
        if (!matchRoot) return;

        const rootPath = matchRoot.dataset.path;
        if (targetPath === rootPath) return; // already at root

        // Build list of ancestor paths from root down to target
        const suffix = targetPath.slice(rootPath.length + 1); // after the '/'
        const parts = suffix.split('/');
        let current = rootPath;
        const chain = [rootPath];
        for (const part of parts) {
            current += '/' + part;
            chain.push(current);
        }

        // Expand each ancestor (skip the target itself)
        for (let i = 0; i < chain.length - 1; i++) {
            const p = chain[i];
            const nodeEl = this.container.querySelector(`[data-path="${CSS.escape(p)}"]`);
            if (!nodeEl) break;

            const childrenEl = nodeEl.querySelector(':scope > .tree-children');
            const toggleEl = nodeEl.querySelector(':scope > .tree-label .tree-toggle');

            if (!this.expandedPaths.has(p)) {
                this.expandedPaths.add(p);
                if (toggleEl) toggleEl.classList.add('expanded');
                if (childrenEl) childrenEl.classList.remove('collapsed');
            }
            // Load children if not yet loaded
            if (childrenEl && childrenEl.children.length === 0) {
                await this.loadChildren(p, childrenEl);
            }
        }
    }

    getBasename(path) {
        const normalized = path.replace(/\\/g, '/');
        const parts = normalized.split('/').filter(Boolean);
        return parts[parts.length - 1] || path;
    }
}
