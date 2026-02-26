import { api } from './api.js';

/**
 * Sidebar folder tree component
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
        const node = document.createElement('div');
        node.className = 'tree-node';
        node.dataset.path = folder.path;

        const label = document.createElement('div');
        label.className = 'tree-label';
        if (this.activePath === folder.path) {
            label.classList.add('active');
        }

        // Toggle arrow
        const toggle = document.createElement('span');
        toggle.className = 'tree-toggle';
        if (folder.has_children) {
            toggle.textContent = '\u25B6'; // right-pointing triangle
            if (this.expandedPaths.has(folder.path)) {
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
        if (!this.expandedPaths.has(folder.path)) {
            children.classList.add('collapsed');
        }
        node.appendChild(children);

        // Click handler
        label.addEventListener('click', async (e) => {
            e.stopPropagation();

            // Toggle expansion
            if (folder.has_children) {
                const isExpanded = this.expandedPaths.has(folder.path);
                if (isExpanded) {
                    this.expandedPaths.delete(folder.path);
                    toggle.classList.remove('expanded');
                    children.classList.add('collapsed');
                } else {
                    this.expandedPaths.add(folder.path);
                    toggle.classList.add('expanded');
                    children.classList.remove('collapsed');
                    // Load children if empty
                    if (children.children.length === 0) {
                        await this.loadChildren(folder.path, children);
                    }
                }
            }

            // Select this folder
            this.setActive(folder.path);
            this.onFolderSelect(folder.path);
        });

        // Auto-load if already expanded
        if (this.expandedPaths.has(folder.path) && children.children.length === 0) {
            this.loadChildren(folder.path, children);
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
     * Set the active (selected) folder
     */
    setActive(path) {
        this.activePath = path;
        // Update visual state
        this.container.querySelectorAll('.tree-label.active').forEach(el => {
            el.classList.remove('active');
        });
        const node = this.container.querySelector(`[data-path="${CSS.escape(path)}"] > .tree-label`);
        if (node) {
            node.classList.add('active');
        }
    }

    getBasename(path) {
        const normalized = path.replace(/\\/g, '/');
        const parts = normalized.split('/').filter(Boolean);
        return parts[parts.length - 1] || path;
    }
}
