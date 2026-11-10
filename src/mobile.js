// Phone interface: a title bar, a drawer with the notes, an actions sheet and a floating dock.
// It reuses the desktop controls (tabs, buttons) instead of duplicating their logic.
// Gestures: drag the drawer in from the left edge and back; the same edge swipe closes settings and the chat;
// swipe the title sideways to change note, tap it to jump to the top; drag the sheet down, swipe the dock up to open it;
// pinch the text to resize it; double-tap in reading mode to edit; swipe the formatting bar down to hide the keyboard.
(function () {
    const query = matchMedia('(max-width: 720px)');
    const FONT_KEY = 'fgsnotes.mobile.font', FONT_MIN = 16, FONT_MAX = 26;      // under 16px iOS zooms into the field
    const TARGETS = { new: '#new-file-button', open: '#open-file-button', save: '#save-file-button', settings: '#settings-button', theme: '#theme-button', ai: '#ai-button' };
    let built = false;

    function el(tag, className, html) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (html !== undefined) node.innerHTML = html;
        return node;
    }
    const $ = selector => document.querySelector(selector);
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const cleanTitle = text => text.replace(/\.(md|markdown|txt)$/i, '');
    const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const buzz = kind => window.fgsPlatform.haptic(kind);          // a light tap under a finished gesture

    // One finger dragged along one axis. `begin` says whether the touch is ours and returns the state of this drag;
    // `end` gets the distance and the speed (px per ms) at release. A drag along the other axis is left to scrolling.
    function drag(target, axis, { begin, move, end }) {
        let state = null;
        const finish = () => {
            const done = state;
            state = null;
            if (done && done.locked) end(done.data, done.delta, done.speed);
        };
        target.addEventListener('touchstart', event => {
            if (state) finish();
            if (event.touches.length !== 1) return;
            const touch = event.touches[0], data = begin(touch, event);
            if (data) state = { data, x: touch.clientX, y: touch.clientY, delta: 0, speed: 0, time: event.timeStamp, locked: false };
        }, { passive: true });
        target.addEventListener('touchmove', event => {
            if (!state) return;
            const touch = event.touches[0], dx = touch.clientX - state.x, dy = touch.clientY - state.y;
            if (!state.locked) {
                if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                if ((Math.abs(dx) > Math.abs(dy)) !== (axis === 'x')) { state = null; return; }
                state.locked = true;
            }
            const delta = axis === 'x' ? dx : dy, elapsed = event.timeStamp - state.time;
            if (elapsed > 0) state.speed = (delta - state.delta) / elapsed;
            state.delta = delta;
            state.time = event.timeStamp;
            if (move) move(state.data, delta);
        }, { passive: true });
        target.addEventListener('touchend', finish, { passive: true });
        target.addEventListener('touchcancel', finish, { passive: true });
    }

    function build() {
        if (built) return;
        built = true;
        const root = document.documentElement;
        const workspace = $('.workspace');
        const wrapper = $('.editor-wrapper');
        const tabBar = $('.tab-bar');
        const editor = $('#markdown-editor');
        const preview = $('.preview-content');

        // --- title bar -------------------------------------------------------------------------
        const header = el('header', 'm-header');
        const menuButton = el('button', 'm-icon', icon('menu'));
        menuButton.setAttribute('aria-label', 'Документы');
        const heading = el('div', 'm-heading', '<strong class="m-title" data-i18n-skip></strong><span class="m-sub" data-i18n-skip></span>');
        const title = heading.querySelector('.m-title'), sub = heading.querySelector('.m-sub');
        const moreButton = el('button', 'm-icon', icon('more'));
        moreButton.setAttribute('aria-label', 'Действия');
        moreButton.setAttribute('aria-haspopup', 'dialog');
        header.append(menuButton, heading, moreButton);
        $('.editor-container').prepend(header);

        // --- drawer: the notes ------------------------------------------------------------------
        const backdrop = el('div', 'm-backdrop');
        const drawer = el('aside', 'm-drawer');
        drawer.setAttribute('aria-label', 'Документы');
        drawer.innerHTML = `
            <div class="m-drawer-head"><img src="logo.png" alt="" width="30" height="30"><strong>FgSNotes</strong><span class="m-count" data-i18n-skip></span></div>
            <div class="m-notes"></div>
            <div class="m-drawer-foot">
                <button type="button" class="m-drawer-new" data-act="new">${icon('plus')}<span>Новая заметка</span></button>
                <button type="button" class="m-drawer-round" data-act="settings" aria-label="Настройки">${icon('settings')}</button>
            </div>`;

        // --- actions sheet: what the "more" button opens ----------------------------------------
        const sheetBackdrop = el('div', 'm-sheet-backdrop');
        const sheet = el('div', 'm-sheet');
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-label', 'Действия');
        sheet.setAttribute('aria-hidden', 'true');
        const row = (act, name, label) => `<button type="button" class="m-row" data-sheet="${act}">${icon(name)}<span>${label}</span><i class="m-check" aria-hidden="true">${icon('check')}</i></button>`;
        const tile = (act, name, label) => `<button type="button" class="m-tile" data-sheet="${act}">${icon(name)}<span>${label}</span></button>`;
        sheet.innerHTML = `
            <div class="m-sheet-head"><div class="m-grabber" aria-hidden="true"></div><button type="button" class="m-sheet-close" data-sheet="close" aria-label="Закрыть">${icon('close')}</button></div>
            <div class="m-tiles">${tile('new', 'plus', 'Новая заметка')}${tile('open', 'folder', 'Открыть файл')}${tile('save', 'save', 'Сохранить файл')}</div>
            <div class="m-group">${row('view', 'eye', 'Режим чтения')}</div>
            <div class="m-group m-group-plugins" hidden></div>
            <div class="m-group">${row('ai', 'sparkles', 'Чат')}${row('theme', 'palette', 'Тема оформления')}${row('settings', 'settings', 'Настройки')}</div>`;
        document.body.append(sheetBackdrop, sheet, backdrop, drawer);

        // --- bottom dock: a pill with the main actions and a round reading toggle ---------------
        const bar = $('.sidebar-toolbar');
        const docsButton = el('button', 'sidebar-button icon-button', icon('documents'));
        docsButton.setAttribute('aria-label', 'Документы');
        const newButton = $('#new-file-button');
        newButton.innerHTML = icon('plus');
        newButton.setAttribute('aria-label', 'Новая заметка');
        const pill = el('div', 'm-pill');
        pill.append(docsButton, newButton);
        const aiButton = $('#ai-button');                   // the assistant sits in the dock when the app has one
        if (aiButton) pill.append(aiButton);
        pill.append($('#settings-button'));
        const viewButton = el('button', 'm-view');
        bar.append(pill, viewButton);
        // Open and Save stay in the page (their handlers live there) but are reached through the sheet.
        [$('#open-file-button'), $('#save-file-button')].forEach(button => { button.classList.add('m-hidden-action'); document.body.append(button); });
        const later = act => setTimeout(() => $(TARGETS[act]).click(), 200);     // after the closing animation

        // --- drawer behaviour ------------------------------------------------------------------
        const drawerOpen = () => root.classList.contains('m-drawer-open');
        const setDrawer = open => {
            root.classList.toggle('m-drawer-open', open);
            drawer.setAttribute('aria-hidden', String(!open));
            if (open) notesView.refresh();
            else notesView.reset();
        };
        menuButton.addEventListener('click', () => setDrawer(true));
        docsButton.addEventListener('click', () => setDrawer(!drawerOpen()));
        backdrop.addEventListener('click', () => setDrawer(false));
        drawer.querySelector('.m-drawer-foot').addEventListener('click', event => {
            const act = event.target.closest('button')?.dataset.act;
            if (!act) return;
            setDrawer(false);
            later(act);
        });

        // The list itself is notes.js; here only the title bar and the counter follow the (hidden) tab strip.
        const notesView = window.FgsNotes.mount(drawer.querySelector('.m-notes'), { onOpen: () => setDrawer(false) });
        function renderDocs() {
            const tabs = tabBar.querySelectorAll('.tab-item');
            const active = tabBar.querySelector('.tab-item.active .tab-title');
            title.textContent = active ? cleanTitle(active.textContent) : 'FgSNotes';
            drawer.querySelector('.m-count').textContent = tabs.length;
            if (drawerOpen() || root.classList.contains('m-dragging')) notesView.refresh();
        }
        window.addEventListener('fgs-list-changed', renderDocs);
        new MutationObserver(renderDocs).observe(tabBar, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
        renderDocs();

        // --- sheet behaviour -------------------------------------------------------------------
        const sheetOpen = () => root.classList.contains('m-sheet-open');
        const syncSheet = () => {
            const reading = workspace.dataset.view === 'preview';
            const viewRow = sheet.querySelector('[data-sheet="view"]');
            viewRow.classList.toggle('is-on', reading);
            viewRow.setAttribute('aria-pressed', String(reading));
            sheet.querySelector('[data-sheet="ai"]').hidden = root.dataset.aiAvailable !== 'on';
            // Plugins live in the formatting bar, which shows only while typing; here they are always one tap away.
            const entries = window.FgsPlugins ? window.FgsPlugins.buttons() : [];
            const group = sheet.querySelector('.m-group-plugins');
            group.hidden = !entries.length;
            group.replaceChildren(...entries.map(entry => {
                const item = el('button', 'm-row', `${window.FgsPlugins.iconMarkup(entry.icon)}<span></span>`);
                item.type = 'button';
                item.querySelector('span').textContent = entry.title;
                item.addEventListener('click', () => { setSheet(false); setTimeout(entry.run, 200); });
                return item;
            }));
        };
        const setSheet = open => {
            root.classList.toggle('m-sheet-open', open);
            sheet.setAttribute('aria-hidden', String(!open));
            moreButton.setAttribute('aria-expanded', String(open));
            if (open) syncSheet();
        };
        moreButton.addEventListener('click', () => setSheet(!sheetOpen()));
        sheetBackdrop.addEventListener('click', () => setSheet(false));
        sheet.addEventListener('click', event => {
            const act = event.target.closest('[data-sheet]')?.dataset.sheet;
            if (!act) return;
            if (act === 'view') { viewButton.click(); return; }
            setSheet(false);
            if (act !== 'close') later(act);
        });
        document.addEventListener('keydown', event => { if (event.key === 'Escape') { setSheet(false); setDrawer(false); } });

        // subtitle: live word count
        const words = $('#word-count');
        const syncSub = () => { sub.textContent = words.textContent; };
        new MutationObserver(syncSub).observe(words, { childList: true, characterData: true, subtree: true });
        syncSub();

        // reading toggle: one button, shows the mode it switches to
        const reading = () => workspace.dataset.view === 'preview';
        const setReading = on => $(`.view-switch button[data-view="${on ? 'preview' : 'editor'}"]`).click();
        const syncView = () => {
            viewButton.innerHTML = icon(reading() ? 'edit' : 'eye');
            viewButton.setAttribute('data-i18n-aria', reading() ? 'Редактировать' : 'Режим чтения');
            viewButton.setAttribute('aria-label', t(reading() ? 'Редактировать' : 'Режим чтения'));
            syncSheet();
        };
        viewButton.addEventListener('click', () => setReading(!reading()));
        new MutationObserver(syncView).observe(workspace, { attributes: true, attributeFilter: ['data-view'] });
        syncView();

        // formatting tools only while typing; tapping them keeps the keyboard
        // (the caret is in the textarea or, on a phone, in the live editor that stands in for it)
        const surface = $('.editor-surface');
        const typing = () => surface.contains(document.activeElement);
        surface.addEventListener('focusin', () => root.classList.add('editing'));
        surface.addEventListener('focusout', () => setTimeout(() => { if (!typing()) root.classList.remove('editing'); }, 120));
        $('.editor-tools').addEventListener('pointerdown', event => event.preventDefault());

        // ================================== gestures ==================================
        // What an edge swipe closes before it may open the drawer: the layer on top of the note.
        function topLayer() {
            const button = $('.plugin-modal-back .plugin-modal-head button') || $('#settings-modal.show .close-modal') || $('.ai-panel:not([hidden]) [data-head="close"]');
            return button && button.offsetParent !== null ? () => button.click() : null;
        }
        // The drawer follows the finger: in from the left edge, back out from anywhere while it is open.
        const reveal = (data, dx) => clamp(data.from + dx / drawer.offsetWidth, 0, 1);
        drag(document, 'x', {
            begin(touch) {
                if (sheetOpen()) return null;
                if (drawerOpen()) return { from: 1 };
                if (touch.clientX > 24) return null;
                const back = topLayer();
                return back ? { back } : { from: 0 };
            },
            move(data, dx) {
                if (data.back) return;
                if (!root.classList.contains('m-dragging')) { root.classList.add('m-dragging'); if (!data.from) notesView.refresh(); }
                root.style.setProperty('--m-open', reveal(data, dx));
            },
            end(data, dx, speed) {
                if (data.back) { if (dx > 64) data.back(); return; }
                root.classList.remove('m-dragging');
                root.style.removeProperty('--m-open');
                setDrawer(Math.abs(speed) > .35 ? speed > 0 : reveal(data, dx) > .5);
                buzz();
            }
        });

        // The sheet follows the finger down and closes past a third of the way or on a flick; a swipe up on the dock opens it.
        drag(sheet, 'y', {
            begin: () => (sheet.scrollTop <= 0 ? {} : null),
            move(data, dy) { root.classList.add('m-dragging'); sheet.style.transform = `translateY(${Math.max(0, dy)}px)`; },
            end(data, dy, speed) {
                root.classList.remove('m-dragging');
                sheet.style.transform = '';
                if (dy > sheet.offsetHeight / 3 || (dy > 24 && speed > .5)) { setSheet(false); buzz(); }
            }
        });
        drag(bar, 'y', { begin: () => ({}), end(data, dy) { if (dy < -32) { setSheet(true); buzz(); } } });

        // The title: swipe sideways for the next or previous note, tap to go to the top.
        function stepNote(direction) {
            const tabs = [...tabBar.querySelectorAll('.tab-item')];
            const next = tabs[tabs.findIndex(tab => tab.classList.contains('active')) + direction];
            const slide = (from, to, opacity) => { if (!calm()) wrapper.animate([{ transform: `translateX(${from}px)`, opacity }, { transform: `translateX(${to}px)`, opacity: 1 }], { duration: 200, easing: 'cubic-bezier(.2, .8, .3, 1)' }); };
            if (!next) { slide(-18 * direction, 0, 1); return; }          // the first or the last note: a nudge, nothing more
            next.querySelector('.tab-select').click();
            slide(28 * direction, 0, 0);
            buzz();
        }
        drag(header, 'x', { begin: touch => (touch.clientX > 24 && !drawerOpen() ? {} : null), end(data, dx) { if (Math.abs(dx) > 48) stepNote(dx < 0 ? 1 : -1); } });
        heading.addEventListener('click', () => {
            const behavior = calm() ? 'auto' : 'smooth';
            [editor, preview, $('.live-host .cm-scroller')].forEach(pane => { if (pane) pane.scrollTo({ top: 0, behavior }); });
        });

        // Reading mode: a double tap on the text starts editing.
        let lastTap = null;
        preview.addEventListener('touchend', event => {
            if (!reading() || event.touches.length || event.target.closest('a, button, input, textarea, select, summary, .nb-cell')) { lastTap = null; return; }
            const touch = event.changedTouches[0];
            const again = lastTap && event.timeStamp - lastTap.time < 320 && Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < 28;
            lastTap = again ? null : { time: event.timeStamp, x: touch.clientX, y: touch.clientY };
            if (again) { setReading(false); buzz(); }
        }, { passive: true });

        // Pinch the note with two fingers to change the text size; the size is remembered.
        let fontSize = 0, pinch = null, hintTimer = 0;
        const setFont = (size, announce) => {
            size = clamp(Math.round(size), FONT_MIN, FONT_MAX);
            if (size === fontSize) return;
            fontSize = size;
            root.style.setProperty('--m-font', size + 'px');
            if (window.FgsEditorOverlay) window.FgsEditorOverlay.repaint();
            if (!announce) return;
            sub.textContent = t('Размер текста: {size}', { size });
            clearTimeout(hintTimer);
            hintTimer = setTimeout(syncSub, 1400);
        };
        try { const saved = Number(localStorage.getItem(FONT_KEY)); if (saved) setFont(saved); } catch { /* the default size */ }
        const spread = event => Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
        wrapper.addEventListener('touchstart', event => {
            pinch = event.touches.length === 2 ? { spread: spread(event), size: fontSize || parseFloat(getComputedStyle($('.live-host') || editor).fontSize) } : null;
        }, { passive: true });
        wrapper.addEventListener('touchmove', event => {
            if (pinch && event.touches.length === 2) setFont(pinch.size * spread(event) / pinch.spread, true);
        }, { passive: true });
        const endPinch = () => {
            if (!pinch) return;
            pinch = null;
            try { localStorage.setItem(FONT_KEY, String(fontSize)); } catch { /* stays for this session */ }
        };
        wrapper.addEventListener('touchend', endPinch, { passive: true });
        wrapper.addEventListener('touchcancel', endPinch, { passive: true });
        wrapper.addEventListener('gesturestart', event => event.preventDefault());      // iOS: no page zoom under the pinch

        // A swipe down on the formatting bar puts the keyboard away.
        drag($('.editor-tools'), 'y', { begin: () => ({}), end(data, dy) { if (dy > 24 && typing()) document.activeElement.blur(); } });

        if (window.FgsI18n) window.FgsI18n.apply(document);
    }

    function sync() { if (query.matches) build(); }
    query.addEventListener('change', sync);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(sync, 0));
    else setTimeout(sync, 0);
})();
