// Find in the open note (Cmd/Ctrl+F). Matches are drawn by the source editor's highlight mirror and, in the live
// editor, by CodeMirror decorations. Both editors share the textarea selection API.
(function () {
    function searchText(text, query, sensitive) {
        const source = String(text), needle = String(query);
        if (!needle) return [];
        const haystack = sensitive ? source : source.toLowerCase();
        const look = sensitive ? needle : needle.toLowerCase();
        const out = [];
        const step = Math.max(look.length, 1);
        for (let from = 0; from <= haystack.length - look.length && out.length < 10000;) {
            const at = haystack.indexOf(look, from);
            if (at < 0) break;
            out.push({ from: at, to: at + look.length });
            from = at + step;
        }
        return out;
    }

    function init() {
        const editor = document.getElementById('markdown-editor');
        const column = document.querySelector('.editor-column');
        if (!editor || !column) return;

        const bar = document.createElement('div');
        bar.className = 'find-bar';
        bar.hidden = true;
        bar.setAttribute('role', 'search');
        bar.innerHTML = '<input class="find-input" type="search" spellcheck="false" autocomplete="off" />'
            + '<span class="find-count" data-i18n-skip aria-live="polite"></span>'
            + '<button type="button" class="icon-button find-prev" aria-label="Предыдущее совпадение"></button>'
            + '<button type="button" class="icon-button find-next" aria-label="Следующее совпадение"></button>'
            + '<button type="button" class="find-case" aria-pressed="false" title="Учитывать регистр">Aa</button>'
            + '<button type="button" class="icon-button find-close" aria-label="Закрыть поиск"></button>';
        document.querySelector('.document-bar').after(bar);
        const input = bar.querySelector('.find-input');
        const count = bar.querySelector('.find-count');
        const prev = bar.querySelector('.find-prev');
        const next = bar.querySelector('.find-next');
        const caseButton = bar.querySelector('.find-case');
        const closeButton = bar.querySelector('.find-close');
        prev.innerHTML = window.icon ? window.icon('chevron-up') : '↑';
        next.innerHTML = window.icon ? window.icon('chevron-down') : '↓';
        closeButton.innerHTML = window.icon ? window.icon('close') : '×';
        function labels() {
            input.placeholder = t('Найти');
            input.setAttribute('aria-label', t('Найти в заметке'));
            prev.setAttribute('aria-label', t('Предыдущее совпадение'));
            next.setAttribute('aria-label', t('Следующее совпадение'));
            caseButton.title = t('Учитывать регистр');
            closeButton.setAttribute('aria-label', t('Закрыть поиск'));
        }
        labels();

        let query = '', caseSensitive = false, matches = [], index = -1, synced = '';

        function token() { return editor.value + '\0' + query + '\0' + (caseSensitive ? '1' : '0'); }
        function ranges() {
            if (bar.hidden || !query || !matches.length) return [];
            const cap = 800;
            let offset = 0, slice = matches;
            if (matches.length > cap) {
                offset = Math.max(0, Math.min(matches.length - cap, index - Math.floor(cap / 2)));
                slice = matches.slice(offset, offset + cap);
            }
            return slice.map((match, i) => ({
                from: match.from, to: match.to, current: offset + i === index,
                className: offset + i === index ? 'hl-find-current' : 'hl-find'
            }));
        }
        function paintCount() {
            if (!query) { count.textContent = ''; return; }
            count.textContent = matches.length ? t('{n} из {total}', { n: index + 1, total: matches.length }) : t('Нет совпадений');
            count.classList.toggle('is-empty', !matches.length);
        }
        // Called while the mirror is repainted. Recomputes matches after the note changes and does not repaint again.
        function sync() {
            if (bar.hidden) return;
            const next = token();
            if (next === synced) return;
            const previous = matches[index];
            matches = searchText(editor.value, query, caseSensitive);
            synced = next;
            if (!matches.length) index = -1;
            else if (!previous) {
                const at = matches.findIndex(match => match.from >= editor.selectionStart);
                index = at < 0 ? 0 : at;
            } else {
                const at = matches.findIndex(match => match.from >= previous.from);
                index = at < 0 ? matches.length - 1 : at;
            }
            paintCount();
        }
        function revealInTextarea(position) {
            const style = getComputedStyle(editor);
            const probe = document.createElement('div');
            probe.style.cssText = `position:absolute;visibility:hidden;box-sizing:border-box;width:${editor.clientWidth}px;font:${style.font};line-height:${style.lineHeight};letter-spacing:${style.letterSpacing};tab-size:${style.tabSize};white-space:${style.whiteSpace};overflow-wrap:${style.overflowWrap};word-break:${style.wordBreak};padding:${style.padding}`;
            probe.textContent = editor.value.slice(0, position);
            document.body.append(probe);
            const top = probe.scrollHeight;
            probe.remove();
            const margin = 60;
            if (top < editor.scrollTop + margin || top > editor.scrollTop + editor.clientHeight - margin) editor.scrollTop = Math.max(0, top - editor.clientHeight / 3);
        }
        function pushDecorations() {
            if (window.FgsLive) window.FgsLive.setFind(bar.hidden ? [] : ranges());
            if (window.FgsEditorOverlay) window.FgsEditorOverlay.repaint();
        }
        function showCurrent(scroll) {
            paintCount();
            const match = matches[index];
            if (match && scroll) {
                editor.setSelectionRange(match.from, match.to);
                if (document.documentElement.dataset.live === undefined) revealInTextarea(match.from);
            }
            pushDecorations();
        }
        function place(fromCursor) {
            matches = searchText(editor.value, query, caseSensitive);
            synced = token();
            if (!matches.length) { index = -1; return; }
            if (!fromCursor && index >= 0 && index < matches.length) return;
            const cursor = editor.selectionStart;
            const at = matches.findIndex(match => match.from >= cursor);
            index = at < 0 ? 0 : at;
        }
        function ensureVisible() {
            const workspace = document.querySelector('.workspace');
            const actions = window.FgsActions;
            if (!workspace || !actions) return;
            if ('pluginView' in workspace.dataset && actions.documents && actions.openDocument) {
                const notes = actions.documents();
                const active = notes.find(doc => doc.active) || notes[0];
                if (active) actions.openDocument(active.id);
            }
            if (workspace.dataset.view === 'preview' && actions.view) actions.view('split');
        }
        function selectedQuery() {
            const from = editor.selectionStart, to = editor.selectionEnd;
            if (to <= from) return '';
            const text = editor.value.slice(from, to);
            return text && text.length <= 200 && !text.includes('\n') ? text : '';
        }
        function focusQuery() { setTimeout(() => { input.focus(); input.select(); }, 0); }
        function openFind() {
            ensureVisible();
            if (!bar.hidden) { focusQuery(); return; }
            const picked = selectedQuery();
            if (picked) input.value = picked;
            query = input.value;
            bar.hidden = false;
            place(true);
            showCurrent(!!query);
            focusQuery();
        }
        function closeFind() {
            bar.hidden = true;
            pushDecorations();
            editor.focus();
        }
        function findNext(step) {
            if (bar.hidden) return openFind();
            if (!matches.length) { place(true); showCurrent(false); return; }
            index = (index + step + matches.length) % matches.length;
            showCurrent(true);
        }

        input.addEventListener('input', () => { query = input.value; place(true); showCurrent(!!query); });
        input.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeFind(); }
            else if (event.key === 'Enter' || event.key === 'F3') { event.preventDefault(); findNext(event.shiftKey ? -1 : 1); }
        });
        prev.addEventListener('click', () => findNext(-1));
        next.addEventListener('click', () => findNext(1));
        caseButton.addEventListener('click', () => {
            caseSensitive = !caseSensitive;
            caseButton.setAttribute('aria-pressed', String(caseSensitive));
            caseButton.classList.toggle('is-on', caseSensitive);
            place(true);
            showCurrent(!!query);
        });
        closeButton.addEventListener('click', closeFind);
        [prev, next, caseButton, closeButton].forEach(button => button.addEventListener('mousedown', event => event.preventDefault()));
        window.addEventListener('fgs-live-change', () => { if (!bar.hidden) pushDecorations(); });
        window.addEventListener('fgs-language', () => { labels(); paintCount(); });

        window.FgsFind = { ranges, sync, open: () => !bar.hidden };
        const actions = window.FgsActions || (window.FgsActions = {});
        actions.find = openFind;
        actions.findNext = () => findNext(1);
        actions.findPrevious = () => findNext(-1);
    }

    const api = { searchText };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);
})();
