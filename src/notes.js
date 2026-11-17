// The notes list: search, tags, order, pinning, and the notes closed in the last 30 days.
// One component, shown in the phone drawer (mobile.js) and in the "Все заметки" window on a computer.
// Tags are the #words in the text of a note; nothing has to be filled in by hand.
(function () {
    const SORT_KEY = 'fgsnotes.list.sort';
    const actions = () => window.FgsActions;
    const cleanTitle = text => text.replace(/\.(md|markdown|txt)$/i, '');

    function el(tag, className, html) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (html !== undefined) node.innerHTML = html;
        return node;
    }
    // #tag at the start of a word, beginning with a letter; headings ("# Title") and code blocks are not tags.
    function tagsOf(content) {
        const text = content.replace(/```[\s\S]*?(```|$)/g, '').replace(/`[^`\n]*`/g, '');
        const found = new Set();
        for (const match of text.matchAll(/(?:^|[\s(])#(\p{L}[\p{L}\p{N}_-]*)/gu)) found.add(match[1].toLowerCase());
        return [...found];
    }
    // The first line of the text, or the line the search matched. A heading on top repeats the title, so it is skipped.
    function snippet(content, words) {
        const lines = content.split('\n').map(line => line.replace(/^[#>\-*+\s]+(\[[ xX]\]\s*)?/, '').trim()).filter(Boolean);
        const hit = words.length ? lines.find(line => words.some(word => line.toLowerCase().includes(word))) : '';
        const body = content.trimStart().startsWith('#') ? lines[1] : lines[0];
        return (hit || body || '').slice(0, 90);
    }
    // What the list shows: filtered by the search words and the tag, pinned notes first, then by the chosen order.
    function arrange(notes, { query = '', tag = '', sort = 'manual' } = {}) {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const shown = notes.filter(note => {
            if (tag && !tagsOf(note.content).includes(tag)) return false;
            const text = (note.title + '\n' + note.content).toLowerCase();
            return words.every(word => text.includes(word));
        });
        const byDate = (a, b) => b.updatedAt - a.updatedAt;
        const order = list => (sort === 'recent' ? list.slice().sort(byDate) : list);
        return { words, notes: [...order(shown.filter(note => note.pinned)), ...order(shown.filter(note => !note.pinned))] };
    }
    function tagCounts(notes) {
        const counts = new Map();
        for (const note of notes) for (const tag of tagsOf(note.content)) counts.set(tag, (counts.get(tag) || 0) + 1);
        return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14).map(([tag]) => tag);
    }

    function mount(host, { onOpen = () => {} } = {}) {
        let sort = 'manual', tag = '';
        try { if (localStorage.getItem(SORT_KEY) === 'recent') sort = 'recent'; } catch { /* the default order */ }
        host.classList.add('nl');
        host.innerHTML = `
            <label class="nl-search">${icon('search')}<input type="search" placeholder="Поиск по заметкам" aria-label="Поиск по заметкам" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
            <div class="nl-bar"><div class="nl-tags" role="group" aria-label="Теги"></div><button type="button" class="nl-sort"></button></div>
            <div class="nl-scroll">
                <ul class="nl-list"></ul>
                <p class="nl-empty" hidden>Ничего не найдено</p>
                <details class="nl-trash" hidden>
                    <summary><span class="nl-trash-mark" aria-hidden="true">${icon('trash')}</span><span>Недавно закрытые</span><i class="nl-count" data-i18n-skip></i></summary>
                    <div class="nl-bin">
                        <div class="nl-bin-side">
                            <label class="nl-search nl-bin-search">${icon('search')}<input type="search" placeholder="Поиск по удалённым" aria-label="Поиск по удалённым" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
                            <ul class="nl-list"></ul>
                            <p class="nl-bin-empty" hidden></p>
                        </div>
                        <div class="nl-bin-sash" role="separator" aria-orientation="vertical" aria-label="Граница панелей" tabindex="0"></div>
                        <div class="nl-bin-view">
                            <div class="nl-bin-body preview-content"></div>
                            <div class="nl-bin-actions" hidden>
                                <p class="nl-bin-ask" hidden></p>
                                <button type="button" class="nl-restore">Вернуть</button>
                                <button type="button" class="nl-forget">Удалить навсегда</button>
                                <button type="button" class="nl-forget-cancel" hidden>Отмена</button>
                            </div>
                        </div>
                    </div>
                    <div class="nl-bin-foot"><p class="nl-note">Закрытые заметки хранятся 30 дней</p><button type="button" class="nl-clear">Очистить</button></div>
                </details>
            </div>`;
        const search = host.querySelector(':scope > .nl-search input');
        const sortButton = host.querySelector('.nl-sort');
        const list = host.querySelector('.nl-scroll > .nl-list'), trashBox = host.querySelector('.nl-trash'), trashList = trashBox.querySelector('.nl-list');
        const binSearch = trashBox.querySelector('.nl-bin-search input');
        let trashUid = null, pending = null, split = 30;
        const button = (className, name, label) => { const node = el('button', className, icon(name)); node.type = 'button'; node.setAttribute('aria-label', label); node.title = label; return node; };

        function row(note, words) {
            const item = el('li', 'nl-item' + (note.active ? ' is-active' : '') + (note.pinned ? ' is-pinned' : ''));
            const open = el('button', 'nl-open', '<span class="nl-title"></span><span class="nl-snippet"></span>');
            open.type = 'button';
            open.querySelector('.nl-title').textContent = cleanTitle(note.title);
            open.querySelector('.nl-snippet').textContent = snippet(note.content, words) || t('Пустой документ');
            open.addEventListener('click', () => { if (item.dataset.held) { delete item.dataset.held; return; } actions().openDocument(note.id); onOpen(); });
            const pin = button('nl-pin', 'pin', t(note.pinned ? 'Открепить' : 'Закрепить'));
            pin.setAttribute('aria-pressed', String(note.pinned));
            const togglePin = () => { actions().setPinned(note.id, !note.pinned); if (window.fgsPlatform) window.fgsPlatform.haptic('medium'); };
            pin.addEventListener('click', togglePin);
            const close = button('nl-close', 'close', t('Закрыть') + ' ' + note.title);
            close.disabled = !actions().canClose();
            close.addEventListener('click', () => actions().closeDocument(note.id));
            // A long press pins or unpins: on a phone the pin button shows only on pinned notes.
            let timer = 0;
            const cancel = () => clearTimeout(timer);
            open.addEventListener('touchstart', () => { timer = setTimeout(() => { item.dataset.held = '1'; togglePin(); }, 480); }, { passive: true });
            ['touchmove', 'touchend', 'touchcancel'].forEach(type => open.addEventListener(type, cancel, { passive: true }));
            open.addEventListener('contextmenu', event => event.preventDefault());
            item.append(open, pin, close);
            return item;
        }
        function closedLabel(time) {
            return new Date(time).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        }
        function showNote(node, content) {
            const text = String(content || '');
            if (!text.trim()) { node.innerHTML = `<p class="nl-bin-muted">${t('Пустой документ')}</p>`; return; }
            node.innerHTML = typeof parseMarkdown === 'function' ? parseMarkdown(text) : '';
            if (document.documentElement.dataset.codeHighlight !== 'off' && typeof highlightCode === 'function') {
                node.querySelectorAll('pre code').forEach(block => {
                    block.innerHTML = highlightCode(block.textContent, (block.className.match(/language-([\w+-]+)/) || [])[1]);
                });
            }
            if (window.renderMath) window.renderMath(node);
        }
        function trashRow(note, on) {
            const item = el('li', 'nl-item' + (on ? ' is-on' : ''));
            const open = el('button', 'nl-open', '<span class="nl-title"></span><span class="nl-snippet" data-i18n-skip></span><small class="nl-bin-date" data-i18n-skip></small>');
            open.type = 'button';
            open.querySelector('.nl-title').textContent = cleanTitle(note.title);
            open.querySelector('.nl-snippet').textContent = snippet(note.content, []) || t('Пустой документ');
            open.querySelector('.nl-bin-date').textContent = closedLabel(note.closedAt);
            open.addEventListener('click', () => { trashUid = note.uid; pending = null; paintTrash(); });
            item.append(open);
            return item;
        }
        function paintTrash() {
            if (!actions() || !actions().trash) return;
            const words = binSearch.value.toLowerCase().split(/\s+/).filter(Boolean);
            const closed = actions().trash().filter(note => words.every(word => (note.title + '\n' + note.content).toLowerCase().includes(word)));
            if (!closed.some(note => note.uid === trashUid)) trashUid = closed[0] ? closed[0].uid : null;
            const current = closed.find(note => note.uid === trashUid) || null;
            trashList.replaceChildren(...closed.map(note => trashRow(note, note.uid === trashUid)));
            const empty = trashBox.querySelector('.nl-bin-empty');
            empty.hidden = closed.length > 0;
            empty.textContent = words.length ? t('Ничего не найдено') : t('Корзина пуста');
            const body = trashBox.querySelector('.nl-bin-body');
            const actionsRow = trashBox.querySelector('.nl-bin-actions');
            const restore = trashBox.querySelector('.nl-restore');
            const forget = trashBox.querySelector('.nl-forget');
            const cancel = trashBox.querySelector('.nl-forget-cancel');
            const ask = trashBox.querySelector('.nl-bin-ask');
            restore.textContent = t('Вернуть');
            const confirming = !!(current && pending === trashUid);
            if (!current) {
                body.innerHTML = `<p class="nl-bin-muted">${words.length ? t('Ничего не найдено') : t('Закрытые заметки появятся здесь.')}</p>`;
                actionsRow.hidden = true;
            } else {
                showNote(body, current.content);
                actionsRow.hidden = false;
                forget.textContent = t(confirming ? 'Удалить' : 'Удалить навсегда');
                ask.hidden = !confirming;
                ask.textContent = confirming ? t('Удалить без возможности вернуть?') : '';
                cancel.hidden = !confirming;
            }
            const clear = trashBox.querySelector('.nl-clear');
            clear.textContent = pending === 'all' ? t('Удалить') : t('Очистить');
            trashBox.querySelector('.nl-note').textContent = pending === 'all' ? t('Удалить все без возможности вернуть?') : t('Закрытые заметки хранятся 30 дней');
        }
        function refresh() {
            if (!actions() || !actions().notes) return;
            const all = actions().notes();
            const tags = tagCounts(all);
            if (tag && !tags.includes(tag)) tag = '';
            const shown = arrange(all, { query: search.value, tag, sort });
            list.replaceChildren(...shown.notes.map(note => row(note, shown.words)));
            list.hidden = !shown.notes.length;
            host.querySelector('.nl-empty').hidden = shown.notes.length > 0;
            const chip = (value, label) => { const node = el('button', 'nl-tag' + (value === tag ? ' is-on' : '')); node.type = 'button'; node.textContent = label; node.setAttribute('aria-pressed', String(value === tag)); node.addEventListener('click', () => { tag = value; refresh(); }); return node; };
            host.querySelector('.nl-tags').replaceChildren(...(tags.length ? [chip('', t('Все')), ...tags.map(name => chip(name, '#' + name))] : []));
            sortButton.textContent = t(sort === 'recent' ? 'Сначала новые' : 'По порядку');
            const closed = actions().trash();
            trashBox.hidden = !closed.length || !!search.value.trim() || !!tag;
            trashBox.querySelector('.nl-count').textContent = closed.length;
            paintTrash();
        }
        search.addEventListener('input', refresh);
        binSearch.addEventListener('input', paintTrash);
        sortButton.addEventListener('click', () => {
            sort = sort === 'recent' ? 'manual' : 'recent';
            try { localStorage.setItem(SORT_KEY, sort); } catch { /* stays for this session */ }
            refresh();
        });
        trashBox.querySelector('.nl-restore').addEventListener('click', () => {
            if (!trashUid) return;
            actions().restoreNote(trashUid);
            trashUid = null;
            pending = null;
            onOpen();
        });
        trashBox.querySelector('.nl-forget').addEventListener('click', () => {
            if (!trashUid) return;
            if (pending !== trashUid) { pending = trashUid; paintTrash(); return; }
            actions().forgetNote(trashUid);
            trashUid = null;
            pending = null;
            refresh();
        });
        trashBox.querySelector('.nl-forget-cancel').addEventListener('click', () => { pending = null; paintTrash(); });
        trashBox.querySelector('.nl-bin-view').addEventListener('click', event => {
            if (pending !== 'all' || event.target.closest('.nl-forget, .nl-restore, .nl-forget-cancel')) return;
            pending = null;
            paintTrash();
        });
        trashBox.querySelector('.nl-clear').addEventListener('click', () => {
            if (pending !== 'all') { pending = 'all'; paintTrash(); return; }
            actions().forgetNote();
            trashUid = null;
            pending = null;
            refresh();
        });
        const bin = trashBox.querySelector('.nl-bin');
        const sash = trashBox.querySelector('.nl-bin-sash');
        let drag = false;
        const applySplit = value => { split = Math.min(55, Math.max(18, value)); bin.style.setProperty('--nl-split', split + '%'); };
        sash.addEventListener('pointerdown', event => { drag = true; try { sash.setPointerCapture(event.pointerId); } catch { /* synthetic events */ } event.preventDefault(); });
        sash.addEventListener('pointermove', event => {
            if (!drag) return;
            const rect = bin.getBoundingClientRect();
            const stacked = getComputedStyle(bin).flexDirection === 'column';
            const next = stacked ? ((event.clientY - rect.top) / rect.height) * 100 : ((event.clientX - rect.left) / rect.width) * 100;
            applySplit(next);
        });
        const endDrag = () => { drag = false; };
        sash.addEventListener('pointerup', endDrag);
        sash.addEventListener('pointercancel', endDrag);
        sash.addEventListener('keydown', event => {
            const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 2 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -2 : 0;
            if (!step && event.key !== 'Home') return;
            applySplit(event.key === 'Home' ? 30 : split + step);
            event.preventDefault();
        });
        applySplit(30);
        if (window.FgsI18n) window.FgsI18n.apply(host);
        return { refresh, reset() { search.value = ''; tag = ''; search.blur(); } };
    }

    // Computer: the list in a window of its own, opened from the left bar.
    function desktopWindow() {
        const opener = document.getElementById('notes-button');
        if (!opener) return;
        let modal = null, view = null;
        const visible = () => modal && modal.classList.contains('show');
        const close = () => { if (visible()) { modal.classList.remove('show'); opener.focus(); } };
        function open() {
            if (!modal) {
                modal = el('div', 'modal', `<div class="modal-content notes-window" role="dialog" aria-modal="true" aria-label="Все заметки"><header class="notes-head"><h2>Все заметки</h2><button type="button" class="icon-button" aria-label="Закрыть">${icon('close')}</button></header><div></div></div>`);
                document.body.append(modal);
                view = mount(modal.querySelector('.notes-head + div'), { onOpen: close });
                modal.addEventListener('click', event => { if (event.target === modal) close(); });
                modal.querySelector('.notes-head button').addEventListener('click', close);
                modal.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
                const again = () => { if (visible()) view.refresh(); };
                window.addEventListener('fgs-list-changed', again);
                new MutationObserver(again).observe(document.querySelector('.tab-bar'), { childList: true });
                if (window.FgsI18n) window.FgsI18n.apply(modal);
            }
            view.reset();
            view.refresh();
            modal.classList.add('show');
            modal.querySelector('.nl-search input').focus();
        }
        opener.addEventListener('click', () => (visible() ? close() : open()));
    }
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', desktopWindow);
        else desktopWindow();
    }

    const api = { mount, arrange, tagsOf, snippet };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else window.FgsNotes = api;
})();
