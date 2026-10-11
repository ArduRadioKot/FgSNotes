// Phone interface: a title bar with a menu and a reading toggle, a drawer with the documents, a bottom bar.
// It reuses the desktop controls (tabs, buttons) instead of duplicating their logic.
(function () {
    const query = matchMedia('(max-width: 720px)');
    let built = false;

    function el(tag, className, html) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (html !== undefined) node.innerHTML = html;
        return node;
    }
    const $ = selector => document.querySelector(selector);

    function build() {
        if (built) return;
        built = true;
        const root = document.documentElement;
        const container = $('.editor-container');
        const workspace = $('.workspace');
        const tabBar = $('.tab-bar');

        // --- title bar -------------------------------------------------------------------------
        const header = el('header', 'm-header');
        const menuButton = el('button', 'm-icon', icon('menu'));
        menuButton.setAttribute('aria-label', 'Документы');
        const heading = el('div', 'm-heading', '<strong class="m-title"></strong><span class="m-sub"></span>');
        const viewButton = el('button', 'm-icon');
        header.append(menuButton, heading, viewButton);
        container.prepend(header);

        // --- drawer ----------------------------------------------------------------------------
        const backdrop = el('div', 'm-backdrop');
        const drawer = el('aside', 'm-drawer');
        drawer.setAttribute('aria-label', 'Документы');
        drawer.innerHTML = `
            <div class="m-drawer-head"><img src="logo.png" alt="" width="30" height="30"><strong>FgSNotes</strong><span class="m-count"></span></div>
            <ul class="m-docs"></ul>
            <div class="m-drawer-actions">
                <button data-act="new">${icon('plus')}<span>Новый</span></button>
                <button data-act="open">${icon('folder')}<span>Открыть</span></button>
                <button data-act="save">${icon('save')}<span>Сохранить</span></button>
                <button data-act="theme" class="m-wide">${icon('palette')}<span>Тема оформления</span></button>
                <button data-act="settings">${icon('settings')}<span>Настройки</span></button>
            </div>`;
        document.body.append(backdrop, drawer);

        // --- bottom dock: one pill with four actions and a separate round button for a new note ---------------
        const bar = $('.sidebar-toolbar');
        const docsButton = el('button', 'sidebar-button icon-button m-docs-button', icon('documents'));
        docsButton.setAttribute('aria-label', 'Документы');
        const newButton = $('#new-file-button');
        newButton.innerHTML = icon('plus');
        newButton.setAttribute('aria-label', 'Новый документ');
        newButton.classList.add('m-new');
        const pill = el('div', 'm-pill');
        pill.append(docsButton, $('#open-file-button'), $('#save-file-button'), $('#settings-button'));
        bar.append(pill, newButton);

        // --- behaviour -------------------------------------------------------------------------
        const setDrawer = open => {
            root.classList.toggle('m-drawer-open', open);
            drawer.setAttribute('aria-hidden', String(!open));
            if (open) { renderDocs(); drawer.querySelector('.m-doc.active, .m-doc')?.focus({ preventScroll: true }); }
        };
        menuButton.addEventListener('click', () => setDrawer(true));
        docsButton.addEventListener('click', () => setDrawer(!root.classList.contains('m-drawer-open')));
        backdrop.addEventListener('click', () => setDrawer(false));
        document.addEventListener('keydown', event => { if (event.key === 'Escape') setDrawer(false); });
        drawer.querySelector('.m-drawer-actions').addEventListener('click', event => {
            const act = event.target.closest('button')?.dataset.act;
            if (!act) return;
            setDrawer(false);
            const target = { new: '#new-file-button', open: '#open-file-button', save: '#save-file-button', settings: '#settings-button', theme: '#theme-button' }[act];
            setTimeout(() => $(target).click(), 180);
        });

        // documents list mirrors the (hidden) tab strip
        const list = drawer.querySelector('.m-docs');
        // The first lines of each note, read from the saved workspace, give the list its Apple Notes feel.
        function snippets() {
            try {
                const saved = JSON.parse(localStorage.getItem('fgsnotes.workspace.v1'));
                return (saved.documents || []).map(doc => {
                    const lines = String(doc.content || '').split('\n').map(line => line.replace(/^[#>\-*+\s]+(\[[ xX]\]\s*)?/, '').trim()).filter(Boolean);
                    const first = String(doc.content || '').trimStart().startsWith('#') ? 1 : 0;
                    return (lines[first] || (first ? '' : lines[0]) || 'Пустой документ').slice(0, 90);
                });
            } catch { return []; }
        }
        function renderDocs() {
            const tabs = [...tabBar.querySelectorAll('.tab-item')];
            const notes = snippets();
            list.replaceChildren(...tabs.map((tab, index) => {
                const title = tab.querySelector('.tab-title').textContent;
                const item = el('li', 'm-item');
                const safe = text => String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
                const open = el('button', 'm-doc' + (tab.classList.contains('active') ? ' active' : ''), `<span class="m-doc-title">${safe(title.replace(/\.(md|markdown|txt)$/i, ''))}</span><span class="m-doc-snippet">${safe(notes[index] || '')}</span>`);
                open.addEventListener('click', () => { tab.querySelector('.tab-select').click(); setDrawer(false); });
                const close = el('button', 'm-doc-close', icon('close'));
                close.setAttribute('aria-label', `Закрыть ${title}`);
                close.disabled = tab.querySelector('.close-tab').disabled;
                close.addEventListener('click', () => tab.querySelector('.close-tab').click());
                item.append(open, close);
                return item;
            }));
            drawer.querySelector('.m-count').textContent = tabs.length;
            const active = tabBar.querySelector('.tab-item.active .tab-title');
            header.querySelector('.m-title').textContent = active ? active.textContent.replace(/\.(md|markdown|txt)$/i, '') : 'FgSNotes';
        }
        new MutationObserver(renderDocs).observe(tabBar, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
        renderDocs();

        // subtitle: live word count
        const words = $('#word-count');
        const syncSub = () => { header.querySelector('.m-sub').textContent = words.textContent; };
        new MutationObserver(syncSub).observe(words, { childList: true, characterData: true, subtree: true });
        syncSub();

        // reading toggle: one button, shows the mode it switches to
        const syncView = () => {
            const reading = workspace.dataset.view === 'preview';
            viewButton.innerHTML = icon(reading ? 'edit' : 'eye');
            viewButton.setAttribute('aria-label', reading ? 'Редактировать' : 'Режим чтения');
        };
        viewButton.addEventListener('click', () => {
            const next = workspace.dataset.view === 'preview' ? 'editor' : 'preview';
            $(`.view-switch button[data-view="${next}"]`).click();
        });
        new MutationObserver(syncView).observe(workspace, { attributes: true, attributeFilter: ['data-view'] });
        syncView();

        // formatting tools only while typing; tapping them keeps the keyboard
        const editor = $('#markdown-editor');
        editor.addEventListener('focus', () => root.classList.add('editing'));
        editor.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== editor) root.classList.remove('editing'); }, 120));
        $('.editor-tools').addEventListener('pointerdown', event => event.preventDefault());

        // swipe from the left edge opens the drawer, swipe left closes it
        let start = null;
        document.addEventListener('touchstart', event => {
            const touch = event.touches[0];
            const open = root.classList.contains('m-drawer-open');
            start = (open || touch.clientX < 22) ? { x: touch.clientX, y: touch.clientY, open } : null;
        }, { passive: true });
        document.addEventListener('touchmove', event => {
            if (!start) return;
            const touch = event.touches[0], dx = touch.clientX - start.x, dy = Math.abs(touch.clientY - start.y);
            if (dy > Math.abs(dx)) { start = null; return; }
            if (!start.open && dx > 56) { setDrawer(true); start = null; }
            else if (start.open && dx < -56) { setDrawer(false); start = null; }
        }, { passive: true });
        document.addEventListener('touchend', () => { start = null; }, { passive: true });
    }

    function sync() { if (query.matches) build(); }
    query.addEventListener('change', sync);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(sync, 0));
    else setTimeout(sync, 0);
})();
