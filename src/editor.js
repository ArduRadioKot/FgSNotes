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
    code: ['```\n', '\n```', 'код', true], sup: ['<sup>', '</sup>', 'текст'], sub: ['<sub>', '</sub>', 'текст']
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
    if (!document.execCommand('insertText', false, replacement)) {
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
        return document.documentElement.dataset.codeHighlight !== 'off' && editor.value.length < highlightLimit;
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
    function renderHighlight() {
        const on = highlightEnabled();
        surface.classList.toggle('is-highlighted', on);
        // The trailing newline keeps the last empty line the same height as in the textarea.
        mirror.innerHTML = on ? highlightMarkdown(editor.value) + '\n' : '';
        syncMirror();
    }
    new ResizeObserver(syncMirror).observe(editor);
    new MutationObserver(syncMirror).observe(editor, { attributes: true, attributeFilter: ['style'] });
    new MutationObserver(() => { renderHighlight(); updatePreview(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-code-highlight'] });
    editor.addEventListener('scroll', syncMirror);
    const tabBar = document.querySelector('.tab-bar');
    const newTabButton = document.querySelector('.new-tab-button');
    let documents = [];
    let activeDocumentIndex = 0;
    let nextDocumentId = 1;
    let saveTimer;
    const storageKey = 'fgsnotes.workspace.v1';

    function updateCursor() {
        const lines = editor.value.slice(0, editor.selectionStart).split('\n');
        document.getElementById('cursor-position').textContent = `Стр ${lines.length}, стлб ${lines.at(-1).length + 1}`;
    }
    function plural(value, forms) {
        const mod100 = value % 100, mod10 = value % 10;
        return forms[mod100 > 10 && mod100 < 20 ? 2 : mod10 === 1 ? 0 : mod10 >= 2 && mod10 <= 4 ? 1 : 2];
    }
    function updatePreview() {
        preview.innerHTML = editor.value.trim() ? parseMarkdown(editor.value) : `<div class="empty-preview">${icon('file')}<h2>Здесь оживут ваши идеи</h2><p>Начните писать в редакторе — результат появится здесь.</p></div>`;
        if (document.documentElement.dataset.codeHighlight !== 'off') {
            preview.querySelectorAll('pre code').forEach(block => {
                block.innerHTML = highlightCode(block.textContent, (block.className.match(/language-([\w+-]+)/) || [])[1]);
            });
        }
        renderHighlight();
        const words = editor.value.trim() ? editor.value.trim().split(/\s+/).length : 0;
        const characters = Array.from(editor.value).length;
        document.getElementById('word-count').textContent = `${words} ${plural(words, ['слово', 'слова', 'слов'])}`;
        document.getElementById('character-count').textContent = `${characters} ${plural(characters, ['символ', 'символа', 'символов'])}`;
        updateCursor();
    }
    function persistWorkspace() {
        clearTimeout(saveTimer);
        try {
            localStorage.setItem(storageKey, JSON.stringify({ documents, activeDocumentIndex, nextDocumentId }));
            document.getElementById('save-status').textContent = 'Черновик сохранён';
        } catch (error) {
            document.getElementById('save-status').textContent = 'Не удалось сохранить черновик';
            console.error('Draft storage failed:', error);
        }
    }
    function saveCurrentDocument() {
        const doc = documents[activeDocumentIndex];
        if (doc) doc.content = editor.value;
    }
    function loadDocument(index) {
        editor.value = documents[index].content;
        editor.setSelectionRange(0, 0);
        editor.scrollTop = 0;
        preview.scrollTop = 0;
        updatePreview();
        document.title = `${documents[index].title} — FgSNotes`;
    }
    function addNewTab() {
        saveCurrentDocument();
        const id = nextDocumentId++;
        documents.push({ id, title: `Документ ${id}`, content: '' });
        activeDocumentIndex = documents.length - 1;
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
            select.innerHTML = icon('markdown');
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
            close.setAttribute('aria-label', `Закрыть ${doc.title}`);
            close.title = documents.length === 1 ? 'Оставьте хотя бы один документ открытым' : 'Закрыть документ';
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
        input.accept = '.md,.markdown,.txt';
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
                documents.push({ id: nextDocumentId++, title: file.name, content: reader.result });
                activeDocumentIndex = documents.length - 1;
                renderTabs();
                loadDocument(activeDocumentIndex);
                persistWorkspace();
            };
            reader.onerror = () => { document.getElementById('save-status').textContent = 'Не удалось открыть файл'; };
            reader.readAsText(file);
        };
        input.click();
    }
    function saveFile() {
        saveCurrentDocument();
        persistWorkspace();
        const doc = documents[activeDocumentIndex];
        const blob = new Blob([doc.content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = /\.(md|markdown|txt)$/i.test(doc.title) ? doc.title : `${doc.title}.md`;
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
        if (!['editor', 'split', 'preview'].includes(view)) view = 'split';
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
        button.addEventListener('click', () => window.insertMarkdown(...markdownFormats[button.dataset.format]));
    });
    editor.addEventListener('input', () => {
        updatePreview();
        saveCurrentDocument();
        document.getElementById('save-status').textContent = 'Сохранение…';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(persistWorkspace, 300);
    });
    ['click', 'keyup', 'select'].forEach(event => editor.addEventListener(event, updateCursor));
    document.addEventListener('keydown', event => {
        if (document.querySelector('.modal.show')) return;
        if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
        const actions = { KeyS: saveFile, KeyO: openFile, KeyN: addNewTab };
        if (workspace.dataset.view !== 'preview') {
            actions.KeyB = () => window.insertMarkdown(...markdownFormats.bold);
            actions.KeyI = () => window.insertMarkdown(...markdownFormats.italic);
        }
        if (actions[event.code]) { event.preventDefault(); actions[event.code](); }
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
            documents.push({ id, title: `Документ ${id}`, content: localStorage.getItem(key) });
        });
    }
    nextDocumentId = Math.max(0, ...documents.map(doc => doc.id)) + 1;
    if (!documents.length) {
        documents.push({ id: nextDocumentId++, title: 'Начните здесь.md', content: `# Хорошие идеи начинаются с заметки

Это ваше пространство для мыслей, планов и небольших открытий. Просто начните писать — оформление появится справа.

## Всё важное под рукой

Выделите текст и выберите **жирный**, *курсив* или другой инструмент на панели. А если знаете Markdown — пишите как привыкли.

- Создавайте отдельную вкладку для каждой идеи
- Открывайте и сохраняйте файлы в формате .md
- Переключайте вид, чтобы сосредоточиться на тексте

## Маленький план на сегодня

- [x] Найти место для своих идей
- [ ] Записать первую мысль
- [ ] Превратить её в небольшой план

> Не обязательно сразу писать идеально. Важно начать.

## Пара полезных сочетаний

**Ctrl / ⌘ S** — сохранить файл\x20\x20
**Ctrl / ⌘ B** — выделить жирным\x20\x20
**Ctrl / ⌘ I** — добавить курсив

Черновики открытых вкладок сохраняются на этом устройстве автоматически.` });
    }
    renderTabs();
    loadDocument(activeDocumentIndex);
    persistWorkspace();
    setView(localStorage.getItem('editorView') || 'split');
});
