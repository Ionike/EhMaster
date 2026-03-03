/**
 * Lightweight context menu component.
 * Usage: contextMenu.show(x, y, [{ label, action, separator, disabled }])
 */
export class ContextMenu {
    constructor() {
        this.el = document.createElement('div');
        this.el.className = 'context-menu';
        this.el.style.display = 'none';
        document.body.appendChild(this.el);

        this._onClickOutside = (e) => {
            if (!this.el.contains(e.target)) this.hide();
        };
        this._onKeydown = (e) => {
            if (e.key === 'Escape') this.hide();
        };
        this._onScroll = () => this.hide();
    }

    show(x, y, items) {
        this.el.innerHTML = '';

        for (const item of items) {
            if (item.separator) {
                const sep = document.createElement('div');
                sep.className = 'context-menu-separator';
                this.el.appendChild(sep);
                continue;
            }

            const row = document.createElement('div');
            row.className = 'context-menu-item';
            if (item.disabled) row.classList.add('disabled');
            if (item.danger) row.classList.add('danger');
            row.textContent = item.label;

            if (!item.disabled) {
                row.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.hide();
                    item.action();
                });
            }

            this.el.appendChild(row);
        }

        // Position: show first, then adjust if overflowing viewport
        this.el.style.left = `${x}px`;
        this.el.style.top = `${y}px`;
        this.el.style.display = 'block';

        const rect = this.el.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            this.el.style.left = `${x - rect.width}px`;
        }
        if (rect.bottom > window.innerHeight) {
            this.el.style.top = `${y - rect.height}px`;
        }

        // Defer listeners so the triggering right-click doesn't immediately close
        setTimeout(() => {
            document.addEventListener('click', this._onClickOutside, true);
            document.addEventListener('contextmenu', this._onClickOutside, true);
            document.addEventListener('keydown', this._onKeydown);
            document.addEventListener('scroll', this._onScroll, true);
        }, 0);
    }

    hide() {
        this.el.style.display = 'none';
        document.removeEventListener('click', this._onClickOutside, true);
        document.removeEventListener('contextmenu', this._onClickOutside, true);
        document.removeEventListener('keydown', this._onKeydown);
        document.removeEventListener('scroll', this._onScroll, true);
    }
}
