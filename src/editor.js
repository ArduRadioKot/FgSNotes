// A glass lens behind the active item of a group. On a switch it stretches over both items and settles on the new one.
function createLens(container, lens, itemSelector) {
    let rect = null;
    function place(from) {
        const active = container.querySelector(itemSelector);
        if (!active || getComputedStyle(lens).display === 'none') { rect = null; return; }
        const next = { left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight };
        Object.assign(lens.style, { left: next.left + 'px', top: next.top + 'px', width: next.width + 'px', height: next.height + 'px' });
        if (from && lens.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
            const start = Math.min(from.left, next.left), end = Math.max(from.left + from.width, next.left + next.width);
            lens.getAnimations().forEach(animation => animation.cancel());
            lens.animate([
                { left: from.left + 'px', width: from.width + 'px' },
                { left: start + 'px', width: (end - start) + 'px', offset: 0.45 },
                { left: next.left + 'px', width: next.width + 'px' }
            ], { duration: 460, easing: 'cubic-bezier(.3, .9, .3, 1)' });
        }
        rect = next;
    }
    new ResizeObserver(() => place()).observe(container);
    new MutationObserver(() => place()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-liquid-glass'] });
    return { place, current: () => rect && { ...rect } };
}

const markdownFormats = {
    heading: ['## ', '', 'Заголовок', true], bold: ['**', '**', 'текст'],
    italic: ['*', '*', 'текст'], strike: ['~~', '~~', 'текст'],
    underline: ['<u>', '</u>', 'текст'], list: ['- ', '', 'Элемент списка', true],
    task: ['- [ ] ', '', 'Новая задача', true], quote: ['> ', '', 'Цитата', true],
    link: ['[', '](https://example.com)', 'текст ссылки'],
    image: ['![', '](https://example.com/image.png)', 'Описание изображения'],
    code: ['```\n', '\n```', 'код', true], cell: ['```js-cell\n', '\n```', 'console.log("Привет!");', true], sup: ['<sup>', '</sup>', 'текст'], sub: ['<sub>', '</sub>', 'текст']
};
window.insertMarkdown = function(start, end, placeholder = '', block = false) {
    const editor = document.getElementById('markdown-editor');
    const selectionStart = editor.selectionStart;
    const selectionEnd = editor.selectionEnd;
    const selected = editor.value.slice(selectionStart, selectionEnd) || placeholder;
    const prefix = block && selectionStart > 0 && editor.value[selectionStart - 1] !== '\n' ? '\n' : '';
    const suffix = block && selectionEnd < editor.value.length && editor.value[selectionEnd] !== '\n' ? '\n' : '';
    editor.focus();
    const replacement = prefix + start + selected + end + suffix;
    // Chromium's editing command keeps toolbar actions in the native undo history.
    const before = editor.value;
    if (!document.execCommand('insertText', false, replacement) || editor.value === before) {
        editor.setSelectionRange(selectionStart, selectionEnd);
        editor.setRangeText(replacement, selectionStart, selectionEnd, 'end');
    }
    editor.setSelectionRange(selectionStart + prefix.length + start.length, selectionStart + prefix.length + start.length + selected.length);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
};

document.addEventListener('DOMContentLoaded', () => {
    const editor = document.getElementById('markdown-editor');
    const preview = document.getElementById('preview');
    const workspace = document.querySelector('.workspace');

    // Syntax highlighting: a mirror <pre> sits under the transparent textarea and repeats its text with coloured spans.
    const surface = document.createElement('div');
    surface.className = 'editor-surface';
    const mirror = document.createElement('pre');
    mirror.className = 'editor-highlight';
    mirror.setAttribute('aria-hidden', 'true');
    editor.parentNode.insertBefore(surface, editor);
    surface.append(mirror, editor);
    const highlightLimit = 300000;
    const mirrorStyleProps = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'tabSize', 'whiteSpace', 'overflowWrap', 'wordBreak'];
    function highlightEnabled() {
        return document.documentElement.dataset.live === undefined && document.documentElement.dataset.codeHighlight !== 'off' && editor.value.length < highlightLimit;
    }
    function syncMirror() {
        const style = getComputedStyle(editor);
        mirrorStyleProps.forEach(prop => { mirror.style[prop] = style[prop]; });
        // The textarea scrollbar takes width away from the text; the mirror must wrap at the same width.
        mirror.style.width = editor.clientWidth + 'px';
        mirror.style.height = editor.clientHeight + 'px';
        mirror.scrollTop = editor.scrollTop;
        mirror.scrollLeft = editor.scrollLeft;
    }
    // Chromium does not paint ::selection on a transparent textarea when the selection was made from the keyboard
    // (Shift+arrows, Cmd/Ctrl+A). The same ranges are drawn on the mirror, which already shows the coloured text.
    let cachedKey = '', cachedHtml = '';
    function sourceHtml() {
        const highlighted = highlightEnabled();
        const key = (highlighted ? '1:' : '0:') + editor.value;
        if (key !== cachedKey) {
            cachedKey = key;
            cachedHtml = (highlighted ? highlightMarkdown(editor.value) : escapeHTML(editor.value)) + '\n';
        }
        return { highlighted, html: cachedHtml };
    }
    function overlayMarks() {
        const marks = window.FgsFind && window.FgsFind.ranges ? window.FgsFind.ranges().slice() : [];
        const from = editor.selectionStart, to = editor.selectionEnd;
        if (to > from) {
            const current = marks.find(range => range.className === 'hl-find-current');
            if (!current || current.from !== from || current.to !== to) marks.push({ from, to, className: 'hl-selection' });
        }
        return marks;
    }
    function renderHighlight() {
        if (window.FgsFind && window.FgsFind.sync) window.FgsFind.sync();
        if (document.documentElement.dataset.live !== undefined) {
            surface.classList.remove('is-highlighted', 'marks-aligned');
            mirror.innerHTML = '';
            cachedKey = '';
            if (window.FgsLive && window.FgsFind && window.FgsFind.open && window.FgsFind.open()) window.FgsLive.setFind(window.FgsFind.ranges());
            return;
        }
        const marks = overlayMarks();
        const source = sourceHtml();
        const showMirror = source.highlighted || marks.length > 0;
        surface.classList.toggle('is-highlighted', showMirror);
        if (!showMirror) { mirror.innerHTML = ''; surface.classList.remove('marks-aligned'); syncMirror(); return; }
        // The trailing newline keeps the last empty line the same height as in the textarea.
        mirror.innerHTML = source.html;
        if (marks.length && window.markTextRanges) window.markTextRanges(mirror, marks);
        const aligned = !marks.length || mirror.textContent.replace(/\n$/, '') === editor.value;
        surface.classList.toggle('marks-aligned', aligned && marks.length > 0);
        if (!aligned) mirror.innerHTML = source.html;
        syncMirror();
    }
    let paintFrame = 0;
    function schedulePaint() {
        if (paintFrame) return;
        paintFrame = requestAnimationFrame(() => { paintFrame = 0; renderHighlight(); });
    }
    document.addEventListener('selectionchange', () => { if (document.activeElement === editor) schedulePaint(); });
    // The selection grows on keydown, after this listener, so paint on the next turn (and on keyup, for good measure).
    editor.addEventListener('keydown', event => {
        const arrows = event.shiftKey && /^(Arrow|Home|End|Page)/.test(event.key);
        const selectAll = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a';
        if (arrows || selectAll) setTimeout(schedulePaint, 0);
    });
    editor.addEventListener('keyup', () => { if (editor.selectionStart !== editor.selectionEnd) schedulePaint(); });
    editor.addEventListener('mouseup', schedulePaint);
    window.FgsEditorOverlay = { repaint: schedulePaint };
    new ResizeObserver(syncMirror).observe(editor);
    new MutationObserver(syncMirror).observe(editor, { attributes: true, attributeFilter: ['style'] });
    new MutationObserver(() => { renderHighlight(); updatePreview(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-code-highlight'] });
    editor.addEventListener('scroll', syncMirror);

    const tabBar = document.querySelector('.tab-bar');
    const newTabButton = document.querySelector('.new-tab-button');
    let documents = [];
    let activeDocumentIndex = 0;
    let lastNoteId = null;                    // the note the text editor currently holds (a plugin tab may be in front)
    // Plugin tabs ("views") hold an element a plugin drew instead of text. They stay at the end of the list and are never saved.
    const isView = doc => !!(doc && doc.view);
    const viewHost = document.createElement('section');
    viewHost.className = 'plugin-view';
    viewHost.hidden = true;
    document.querySelector('.editor-wrapper').after(viewHost);
    const notesOnly = () => documents.filter(doc => !isView(doc));
    function insertNote(doc) {
        const firstView = documents.findIndex(isView);
        const at = firstView < 0 ? documents.length : firstView;
        documents.splice(at, 0, doc);
        return at;
    }
    let nextDocumentId = 1;
    let saveTimer;
    const storageKey = 'fgsnotes.workspace.v1';

    function updateCursor() {
        const lines = editor.value.slice(0, editor.selectionStart).split('\n');
        document.getElementById('cursor-position').textContent = t('Стр {line}, стлб {col}', { line: lines.length, col: lines.at(-1).length + 1 });
    }
    function plural(value, forms) {
        const mod100 = value % 100, mod10 = value % 10;
        return forms[mod100 > 10 && mod100 < 20 ? 2 : mod10 === 1 ? 0 : mod10 >= 2 && mod10 <= 4 ? 1 : 2];
    }
    function updatePreview() {
        // Typing inside a notebook cell already updated the note; rebuilding would throw away the cell being edited.
        const keepCells = window.FgsNotebook && window.FgsNotebook.takeSkip();
        if (!keepCells) {
            preview.innerHTML = editor.value.trim() ? parseMarkdown(editor.value) : `<div class="empty-preview">${icon('file')}<h2>${t('Здесь оживут ваши идеи')}</h2><p>${t('Начните писать в редакторе, и результат появится здесь.')}</p></div>`;
            if (document.documentElement.dataset.codeHighlight !== 'off') {
                preview.querySelectorAll('pre code').forEach(block => {
                    block.innerHTML = highlightCode(block.textContent, (block.className.match(/language-([\w+-]+)/) || [])[1]);
                });
            }
            if (window.renderMath) window.renderMath(preview);
            if (window.FgsNotebook && documents[activeDocumentIndex]) window.FgsNotebook.render(preview, documents[activeDocumentIndex].id);
        }
        if (window.FgsPlugins) { window.FgsPlugins.emit('preview', preview); window.FgsPlugins.emit('change', editor.value); }
        renderHighlight();
        const words = editor.value.trim() ? editor.value.trim().split(/\s+/).length : 0;
        const characters = Array.from(editor.value).length;
        const countWord = (value, forms) => (window.FgsI18n && window.FgsI18n.language === 'en' ? t(value === 1 ? forms[0] : forms[2]) : plural(value, forms));
        document.getElementById('word-count').textContent = `${words} ${countWord(words, ['слово', 'слова', 'слов'])}`;
        document.getElementById('character-count').textContent = `${characters} ${countWord(characters, ['символ', 'символа', 'символов'])}`;
        updateCursor();
    }
    function persistWorkspace() {
        clearTimeout(saveTimer);
        try {
            const notes = notesOnly();
            const activeNote = isView(documents[activeDocumentIndex]) ? notes.findIndex(doc => doc.id === lastNoteId) : activeDocumentIndex;
            localStorage.setItem(storageKey, JSON.stringify({ documents: notes, activeDocumentIndex: Math.max(0, activeNote), nextDocumentId }));
            document.getElementById('save-status').textContent = t('Черновик сохранён');
        } catch (error) {
            document.getElementById('save-status').textContent = t('Не удалось сохранить черновик');
            console.error('Draft storage failed:', error);
        }
    }
    function saveCurrentDocument() {
        const doc = documents[activeDocumentIndex];
        if (doc && !isView(doc)) doc.content = editor.value;
    }
    function loadDocument(index) {
        const shown = documents[index];
        // A plugin tab replaces both panes with its own element.
        for (const child of viewHost.children) child.hidden = !(isView(shown) && child === shown.element);
        if (isView(shown)) {
            workspace.dataset.pluginView = '';
            viewHost.hidden = false;
            shown.element.dispatchEvent(new CustomEvent('plugin-view-show'));
            document.title = `${shown.title} - FgSNotes`;
            return;
        }
        delete workspace.dataset.pluginView;
        viewHost.hidden = true;
        lastNoteId = shown.id;
        editor.value = documents[index].content;
        editor.setSelectionRange(0, 0);
        editor.scrollTop = 0;
        preview.scrollTop = 0;
        updatePreview();
        document.title = `${documents[index].title} - FgSNotes`;
    }
    function addNewTab() {
        saveCurrentDocument();
        const id = nextDocumentId++;
        activeDocumentIndex = insertNote({ id, title: t('Документ {n}', { n: id }), content: '' });
        renderTabs();
        loadDocument(activeDocumentIndex);
        persistWorkspace();
        setView(workspace.dataset.view === 'preview' ? 'editor' : workspace.dataset.view);
        editor.focus();
    }
    const tabGlass = document.createElement('span');
    tabGlass.className = 'tab-glass';
    tabGlass.setAttribute('aria-hidden', 'true');
    const tabLens = createLens(tabBar, tabGlass, '.tab-item.active');
    function switchTab(index) {
        if (index === activeDocumentIndex) return;
        saveCurrentDocument();
        activeDocumentIndex = index;
        const from = tabLens.current();
        renderTabs();
        tabLens.place(from);
        loadDocument(index);
        persistWorkspace();
    }
    function closeTab(index) {
        if (documents.length === 1) return;
        saveCurrentDocument();
        const closing = documents[index];
        if (isView(closing)) { closing.element.remove(); if (closing.onClose) try { closing.onClose(); } catch (error) { console.error(error); } }
        else if (window.FgsNotebook) window.FgsNotebook.forget(closing.id);
        documents.splice(index, 1);
        if (index < activeDocumentIndex) activeDocumentIndex--;
        activeDocumentIndex = Math.min(activeDocumentIndex, documents.length - 1);
        renderTabs();
        loadDocument(activeDocumentIndex);
        persistWorkspace();
        tabBar.querySelector('.active .tab-select').focus();
    }
    function renderTabs() {
        tabBar.replaceChildren(tabGlass);
        documents.forEach((doc, index) => {
            const tab = document.createElement('div');
            tab.className = `tab-item${index === activeDocumentIndex ? ' active' : ''}`;
            const select = document.createElement('button');
            select.className = 'tab-select';
            select.innerHTML = icon(doc.icon || 'markdown');
            select.setAttribute('aria-pressed', index === activeDocumentIndex);
            select.title = doc.title;
            const title = document.createElement('span');
            title.className = 'tab-title';
            title.textContent = doc.title;
            select.append(title);
            select.addEventListener('click', () => switchTab(index));
            select.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? documents.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + documents.length) % documents.length;
                switchTab(next);
                tabBar.querySelector('.active .tab-select').focus();
            });
            const close = document.createElement('button');
            close.className = 'close-tab';
            close.innerHTML = icon('close');
            close.setAttribute('aria-label', t('Закрыть') + ' ' + doc.title);
            close.title = documents.length === 1 ? t('Оставьте хотя бы один документ открытым') : t('Закрыть документ');
            close.disabled = documents.length === 1;
            close.addEventListener('click', () => closeTab(index));
            tab.append(select, close);
            tabBar.append(tab);
        });
        tabBar.append(newTabButton);
        tabBar.querySelector('.active').scrollIntoView({ block: 'nearest', inline: 'nearest' });
        tabLens.place();
    }
    function openFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
        input.hidden = true;
        document.body.append(input);
        input.addEventListener('cancel', () => input.remove(), { once: true });
        input.onchange = () => {
            const file = input.files[0];
            input.remove();
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                saveCurrentDocument();
                activeDocumentIndex = insertNote({ id: nextDocumentId++, title: file.name, content: reader.result });
                renderTabs();
                loadDocument(activeDocumentIndex);
                persistWorkspace();
            };
            reader.onerror = () => { document.getElementById('save-status').textContent = t('Не удалось открыть файл'); };
            reader.readAsText(file);
        };
        input.click();
    }
    function saveFile() {
        if (isView(documents[activeDocumentIndex])) return;
        saveCurrentDocument();
        persistWorkspace();
        const doc = documents[activeDocumentIndex];
        const fileName = /\.(md|markdown|txt)$/i.test(doc.title) ? doc.title : `${doc.title}.md`;
        if (window.fgsPlatform && window.fgsPlatform.native) {
            window.fgsPlatform.saveText(fileName, doc.content).catch(error => {
                if (!/cancel/i.test(String(error && error.message))) document.getElementById('save-status').textContent = t('Не удалось сохранить файл');
            });
            return;
        }
        const blob = new Blob([doc.content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    const viewSwitch = document.querySelector('.view-switch');
    const viewGlass = document.createElement('span');
    viewGlass.className = 'view-glass';
    viewGlass.setAttribute('aria-hidden', 'true');
    viewSwitch.prepend(viewGlass);
    const viewLens = createLens(viewSwitch, viewGlass, 'button[aria-pressed="true"]');
    function setView(view) {
        if (!['editor', 'live', 'split', 'preview'].includes(view)) view = 'split';
        // A phone has no room for two panes: show one at a time.
        if ((view === 'split' || view === 'live') && document.documentElement.dataset.mobile !== undefined) view = 'editor';
        // "Off" in the settings removes the live mode altogether.
        if (view === 'live' && document.documentElement.dataset.livePreview === 'off') view = 'editor';
        const from = viewLens.current();
        workspace.dataset.view = view;
        document.querySelectorAll('.view-switch button').forEach(button => button.setAttribute('aria-pressed', button.dataset.view === view));
        viewLens.place(from);
        document.querySelectorAll('[data-format]').forEach(button => { button.disabled = view === 'preview'; });
        localStorage.setItem('editorView', view);
    }
    document.querySelectorAll('.view-switch button').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
    document.querySelectorAll('[data-format]').forEach(button => {
        button.addEventListener('mousedown', event => event.preventDefault());
        button.addEventListener('click', () => applyFormat(button.dataset.format));
    });
    editor.addEventListener('input', () => {
        updatePreview();
        saveCurrentDocument();
        document.getElementById('save-status').textContent = t('Сохранение…');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(persistWorkspace, 300);
    });
    ['click', 'keyup', 'select'].forEach(event => editor.addEventListener(event, updateCursor));
    // Everything a shortcut can trigger. shortcuts.js owns the key bindings and calls these.
    if (window.FgsNotebook) window.FgsNotebook.setDocument(() => documents[activeDocumentIndex] && documents[activeDocumentIndex].id);
    window.FgsActions = {
        newDocument: addNewTab,
        open: openFile,
        save: saveFile,
        closeTab: () => closeTab(activeDocumentIndex),
        nextTab: () => switchTab((activeDocumentIndex + 1) % documents.length),
        previousTab: () => switchTab((activeDocumentIndex - 1 + documents.length) % documents.length),
        view: setView,
        // For plugins: the open notes.
        documents: () => { saveCurrentDocument(); return notesOnly().map(doc => ({ id: doc.id, title: doc.title, content: doc.content, active: doc.id === lastNoteId })); },
        openDocument: id => { const index = documents.findIndex(doc => doc.id === id && !isView(doc)); if (index >= 0) switchTab(index); },
        // A tab whose content is an element drawn by a plugin. Opening the same key again just brings the tab forward.
        openViewTab: ({ key, title, icon: iconName = 'file', element, onClose }) => {
            const existing = documents.findIndex(doc => isView(doc) && doc.viewKey === key);
            const handle = id => ({
                id,
                close: () => { const i = documents.findIndex(doc => doc.id === id); if (i >= 0) closeTab(i); },
                backToNote: () => { const i = documents.findIndex(doc => doc.id === lastNoteId); if (i >= 0) switchTab(i); },
                setTitle: text => { const doc = documents.find(item => item.id === id); if (doc) { doc.title = String(text); renderTabs(); } }
            });
            if (existing >= 0) { switchTab(existing); return { ...handle(documents[existing].id), created: false, element: documents[existing].element }; }
            saveCurrentDocument();
            const id = nextDocumentId++;
            documents.push({ id, title: String(title), content: '', view: true, viewKey: key, icon: iconName, element, onClose });
            viewHost.append(element);
            activeDocumentIndex = documents.length - 1;
            renderTabs();
            loadDocument(activeDocumentIndex);
            return { ...handle(id), created: true, element };
        },
        createDocument: (title, content) => {
            addNewTab();
            documents[activeDocumentIndex].title = String(title || documents[activeDocumentIndex].title);
            renderTabs();
            editor.value = String(content || '');
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        },
        canFormat: () => workspace.dataset.view !== 'preview',
        format: name => { if (window.FgsActions.canFormat() && markdownFormats[name]) applyFormat(name); }
    };

    // Tab writes an indent instead of moving the focus; Shift+Tab takes one away. On a list line, or with several lines selected,
    // whole lines move. Esc then Tab still leaves the field, so the keyboard is never trapped. (The live editor has its own Tab.)
    let tabLeaves = false;
    function shiftLines(outdent) {
        const text = editor.value;
        const size = Math.max(1, Math.min(8, parseInt(getComputedStyle(editor).tabSize, 10) || 4));
        const start = editor.selectionStart, end = editor.selectionEnd;
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        const stop = end > start && text[end - 1] === '\n' ? end - 1 : end;
        let blockEnd = text.indexOf('\n', stop);
        if (blockEnd < 0) blockEnd = text.length;
        const onList = /^\s*(?:[-+*]|\d+[.)])\s/.test(text.slice(lineStart, blockEnd));
        const several = text.slice(start, end).includes('\n');
        const replace = (from, to, value) => {
            editor.focus();
            editor.setSelectionRange(from, to);
            const before = editor.value;
            // The editing command keeps the browser's undo history; if it reports success but changes nothing (no focus), write directly.
            if (!document.execCommand('insertText', false, value) || editor.value === before) { editor.setSelectionRange(from, to); editor.setRangeText(value, from, to, 'end'); }
        };
        if (!outdent && start === end && !onList) {
            // Up to the next tab stop, as a code editor does.
            const column = start - lineStart;
            replace(start, end, ' '.repeat(size - (column % size)));
        } else if (!(onList || several) && start === end) {
            // Shift+Tab on a plain line: remove the spaces before the caret, if any.
            const before = text.slice(lineStart, start);
            const spaces = Math.min(size, (before.match(/ +$/) || [''])[0].length || (before.endsWith('\t') ? 1 : 0));
            if (spaces) replace(start - spaces, start, '');
        } else {
            const lines = text.slice(lineStart, blockEnd).split('\n');
            let first = 0, total = 0;
            const changed = lines.map((line, index) => {
                let delta;
                if (!outdent) { delta = line.trim() ? size : 0; line = ' '.repeat(delta) + line; }
                else { const removed = line.startsWith('\t') ? 1 : Math.min(size, (line.match(/^ */) || [''])[0].length); line = line.slice(removed); delta = -removed; }
                if (index === 0) first = delta;
                total += delta;
                return line;
            });
            replace(lineStart, blockEnd, changed.join('\n'));
            editor.setSelectionRange(Math.max(lineStart, start + first), Math.max(lineStart, end + total));
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    editor.addEventListener('keydown', event => {
        if (event.key === 'Escape') { tabLeaves = true; return; }
        if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey) { if (!['Shift', 'Tab'].includes(event.key)) tabLeaves = false; return; }
        if (tabLeaves) { tabLeaves = false; return; }
        event.preventDefault();
        shiftLines(event.shiftKey);
    });
    window.addEventListener('beforeunload', () => { saveCurrentDocument(); persistWorkspace(); });
    newTabButton.addEventListener('click', addNewTab);
    document.getElementById('new-file-button').addEventListener('click', addNewTab);
    document.getElementById('open-file-button').addEventListener('click', openFile);
    document.getElementById('save-file-button').addEventListener('click', saveFile);

    try {
        const saved = JSON.parse(localStorage.getItem(storageKey));
        if (saved && Array.isArray(saved.documents)) {
            documents = saved.documents.filter(doc => Number.isFinite(doc.id) && typeof doc.title === 'string' && typeof doc.content === 'string');
            activeDocumentIndex = Math.max(0, Math.min(Number(saved.activeDocumentIndex) || 0, documents.length - 1));
        }
    } catch (error) { console.error('Could not restore workspace:', error); }
    if (!documents.length) {
        // Recover all legacy drafts, including gaps left by closed tabs.
        Object.keys(localStorage).filter(key => /^editorContent_doc\d+$/.test(key)).sort((a, b) => Number(a.replace('editorContent_doc', '')) - Number(b.replace('editorContent_doc', ''))).forEach(key => {
            const id = Number(key.replace('editorContent_doc', ''));
            documents.push({ id, title: t('Документ {n}', { n: id }), content: localStorage.getItem(key) });
        });
    }
    nextDocumentId = Math.max(0, ...documents.map(doc => doc.id)) + 1;
    if (!documents.length) {
        const intro = [
            '# Хорошие идеи начинаются с заметки',
            '',
            'Пишите слева, а оформление появляется справа. Ниже то, что умеет FgSNotes, на живых примерах. Меняйте их прямо здесь.',
            '',
            '## Разметка',
            '',
            'Выделите слово и нажмите **Ctrl / ⌘ B**, получится **жирный**, а **Ctrl / ⌘ I** даст *курсив*. Ещё есть ~~зачёркнутый~~ текст, `код в строке` и [ссылки](https://github.com/ArduRadioKot/FgSNotes).',
            '',
            '- Одна вкладка, одна идея',
            '- Вложенные списки работают:',
            '  - так',
            '  - и так',
            '',
            '1. Первый шаг',
            '2. Второй шаг',
            '',
            '> Не обязательно сразу писать идеально. Важно начать.',
            '',
            '## Задачи',
            '',
            '- [x] Открыть FgSNotes',
            '- [ ] Записать первую мысль',
            '- [ ] Превратить её в план',
            '',
            '## Таблицы и код',
            '',
            '| Режим | Что делает |',
            '| --- | --- |',
            '| Редактор | Только текст |',
            '| Живой | Оформление прямо в тексте |',
            '| Рядом | Текст и предпросмотр |',
            '',
            '```js',
            'const greeting = "Привет, FgSNotes!";',
            'console.log(greeting);',
            '```',
            '',
            '## Формулы',
            '',
            'В строке: $E = mc^2$. Отдельным блоком:',
            '',
            '$$',
            '\\int_0^1 x^2\\,dx = \\frac{1}{3}',
            '$$',
            '',
            '## Чат с ИИ',
            '',
            'Выделите абзац и нажмите **Ctrl / ⌘ J**: чат исправит ошибки, сократит, переведёт или продолжит текст. Он работает на вашем компьютере через Ollama, заметки никуда не уходят. Попробуйте на этой строке: *этот тект написан с ашибками*.',
            '',
            '## Сочетания клавиш',
            '',
            '**Ctrl / ⌘ F**: поиск по заметке  ',
            '**Ctrl / ⌘ N**: новая вкладка  ',
            '**Ctrl / ⌘ S**: сохранить файл  ',
            '**Ctrl / ⌘ J**: чат с ИИ',
            '',
            'Черновики открытых вкладок сохраняются на этом устройстве автоматически.'
        ].map(line => t(line)).join('\n');
        documents.push({ id: nextDocumentId++, title: t('Начните здесь.md'), content: intro });
    }
    renderTabs();
    lastNoteId = documents[activeDocumentIndex].id;
    editor.value = documents[activeDocumentIndex].content;
    editor.setSelectionRange(0, 0);
    editor.scrollTop = 0;
    document.title = `${documents[activeDocumentIndex].title} - FgSNotes`;
    setView(localStorage.getItem('editorView') || 'split');
    window.addEventListener('fgs-language', () => {
        updatePreview();
        renderTabs();
        updateCursor();
        const status = document.getElementById('save-status');
        if (status) status.textContent = t('Черновик сохранён');
    });
    // Preview, highlighting and math wait a tick so the window can paint before the heavy first render.
    setTimeout(() => {
        preview.scrollTop = 0;
        updatePreview();
    }, 0);
});
function applyFormat(name) {
    const spec = markdownFormats[name];
    if (!spec) return;
    const copy = spec.slice();
    copy[2] = t(copy[2]);
    window.insertMarkdown(...copy);
}
