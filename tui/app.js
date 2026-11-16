const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBuffer } = require('./buffer');
const { sourceRows, previewRows, linkScroll, words, searchText } = require('./text');
const { createI18n, countWord } = require('./i18n');
const { applyFormat } = require('./format');
const { face } = require('./mascot');
const { createSession } = require('./chat');
const { createClient } = require('./ai');

const TAB = '    ';
const HELP = [
    ['FgSNotes', ''],
    ['Стрелки, Home, End', 'перемещение'],
    ['Shift+стрелки', 'выделение'],
    ['Ctrl-S', 'сохранить'],
    ['Ctrl-O', 'открыть файл'],
    ['Ctrl-N', 'новая вкладка'],
    ['Ctrl-W', 'закрыть вкладку'],
    ['Alt+влево / вправо', 'другая вкладка'],
    ['Ctrl-F', 'поиск'],
    ['Enter и Ctrl-G', 'дальше по поиску'],
    ['Shift+F3', 'назад по поиску'],
    ['F2', 'редактор, рядом, просмотр'],
    ['Ctrl-P', 'команды'],
    ['F4', 'список слева'],
    ['F6, Alt+J', 'чат'],
    ['Язык', 'Русский или English'],
    ['Alt+1..9', 'вкладка по номеру'],
    ['Alt+Shift+влево / вправо', 'поменять вкладки местами'],
    ['Ctrl-R', 'переименовать'],
    ['Alt+Z', 'вернуть закрытую'],
    ['Ctrl-B', 'жирный'],
    ['Ctrl-K', 'ссылка'],
    ['Alt+вверх / вниз', 'сдвинуть строку'],
    ['Ctrl-L', 'перейти к строке'],
    ['Ctrl-Z / Ctrl-Y', 'отмена и повтор'],
    ['Ctrl-C', 'копировать, или выход'],
    ['Ctrl-X / Ctrl-V', 'вырезать и вставить'],
    ['Esc', 'закрыть поиск и справку']
];

function createApp(options = {}) {
    const io = options.io || fs;
    const t = createI18n(options.lang || 'ru');
    globalThis.t = t;
    const clipboard = options.clipboard || systemClipboard();
    const docs = [];
    let active = 0;
    let nextId = 1;
    let mode = 'edit';
    let view = 'editor';
    let quit = false;
    let flash = '';
    let page = 20;
    let find = { query: '', at: 0 };
    let prompt = null;
    let menu = null;
    let side = { focus: false };
    let chatOpen = false;
    let chatFocus = false;
    let job = Promise.resolve();
    const session = createSession({
        t,
        client: options.chat || createClient({ t }),
        onChange: () => options.onChange && options.onChange(),
        track: promise => { job = promise; }
    });
    const closed = [];
    const yes = new Set(['y', 'Y', 'д', 'Д']);
    const no = new Set(['n', 'N', 'н', 'Н']);

    function add(title, text, file) {
        docs.push({ title, path: file || '', saved: text || '', buffer: createBuffer(text || ''), scroll: { top: 0, left: 0, preview: 0 } });
        active = docs.length - 1;
    }
    function current() { return docs[active]; }
    function dirty(doc) { return doc.buffer.text !== doc.saved; }
    function nameOf(doc) { return doc.path ? path.basename(doc.path) : doc.title; }

    function blank() {
        const title = t('Документ {n}', { n: nextId++ });
        add(title, '', '');
    }
    function setLanguage(code) {
        const next = code === 'en' ? 'en' : 'ru';
        t.setLanguage(next);
        globalThis.t = t;
        const file = options.configFile || path.join(os.homedir(), 'Documents', 'FgSNotes', 'config.json');
        try {
            let data = {};
            try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = {}; }
            if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
            data.language = next;
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, JSON.stringify(data, null, 2));
        } catch { /* the choice still applies until the editor closes */ }
    }
    function openPath(file) {
        const full = path.resolve(file);
        const existing = docs.findIndex(doc => doc.path === full);
        if (existing >= 0) { active = existing; return true; }
        let text;
        try { text = readText(io, full); }
        catch (error) {
            flash = t(error.code === 'ENOENT' ? 'Файл не найден' : error.code === 'BINARY' ? 'Это не текстовый файл' : 'Не удалось открыть: {error}', { error: error.message });
            return false;
        }
        if (docs.length === 1 && !docs[0].path && docs[0].buffer.text === '' && !dirty(docs[0])) docs.pop();
        add(path.basename(full), text, full);
        return true;
    }
    function save(doc, file) {
        const target = file || doc.path;
        if (!target) { askSave(doc); return; }
        try {
            io.writeFileSync(target, doc.buffer.text);
            doc.path = path.resolve(target);
            doc.title = path.basename(doc.path);
            doc.saved = doc.buffer.text;
            flash = t('Сохранено');
        } catch (error) {
            flash = t('Не удалось сохранить: {error}', { error: error.message });
        }
    }
    function askSave(doc, then) {
        mode = 'prompt';
        prompt = { kind: 'path', label: t('Сохранить как: '), value: doc.path || '', then: then || null, doc };
    }
    function askOpen() {
        mode = 'prompt';
        prompt = { kind: 'path', label: t('Открыть: '), value: '', then: 'open' };
    }
    function closeDoc(force) {
        const doc = current();
        if (!force && dirty(doc)) {
            mode = 'prompt';
            prompt = { kind: 'yes', label: t('Закрыть без сохранения? (y/n)'), then: 'close' };
            return;
        }
        closed.push({ title: doc.title, path: doc.path, text: doc.buffer.text, saved: doc.saved, pinned: !!doc.pinned });
        if (closed.length > 30) closed.shift();
        docs.splice(active, 1);
        if (!docs.length) blank();
        else active = Math.min(active, docs.length - 1);
    }
    function moveTab(dir) {
        const to = active + dir;
        if (to < 0 || to >= docs.length) return;
        const [doc] = docs.splice(active, 1);
        docs.splice(to, 0, doc);
        active = to;
    }
    function jumpTab(index) {
        if (index >= 0 && index < docs.length) active = index;
    }
    function togglePin() {
        const doc = current();
        doc.pinned = !doc.pinned;
        const rest = docs.filter(item => item !== doc);
        const pinned = rest.filter(item => item.pinned);
        const free = rest.filter(item => !item.pinned);
        docs.splice(0, docs.length, ...pinned, doc, ...free);
        active = pinned.length;
    }
    function duplicate() {
        const doc = current();
        add(t('{name}, копия', { name: nameOf(doc) }), doc.buffer.text, '');
        docs[active].saved = '';
    }
    function rename(doc, value) {
        const name = value.trim();
        if (!name) return;
        if (!doc.path) { doc.title = name; flash = t('Переименовано'); return; }
        const next = path.join(path.dirname(doc.path), name);
        if (path.resolve(next) === doc.path) { doc.title = path.basename(doc.path); return; }
        try {
            io.renameSync(doc.path, next);
            doc.path = path.resolve(next);
            doc.title = path.basename(doc.path);
            flash = t('Переименовано');
        } catch (error) {
            flash = t('Не удалось сохранить: {error}', { error: error.message });
        }
    }
    function reopen() {
        const item = closed.pop();
        if (!item) { flash = t('Нет закрытых вкладок'); return; }
        add(item.title, item.text, item.path);
        docs[active].saved = item.saved;
        docs[active].pinned = !!item.pinned;
    }
    function cycleView() {
        view = view === 'editor' ? 'split' : view === 'split' ? 'preview' : 'editor';
    }
    function formatNow(name) {
        if (view === 'preview') { flash = t('В режиме просмотра нельзя править'); return; }
        applyFormat(current().buffer, name, t);
    }
    function askRename() {
        mode = 'prompt';
        prompt = { kind: 'rename', label: t('Новое имя: '), value: nameOf(current()), doc: current() };
    }
    function askLine() {
        mode = 'prompt';
        prompt = { kind: 'line', label: t('Строка: '), value: '' };
    }
    function toggleSide() {
        if (!side) side = { focus: true };
        else if (side.focus) side = null;
        else side.focus = true;
    }
    function toggleChat() {
        if (!chatOpen) { chatOpen = true; chatFocus = true; }
        else if (chatFocus) { chatOpen = false; chatFocus = false; session.abort(); }
        else chatFocus = true;
        if (chatFocus && side) side.focus = false;
    }
    function useAnswer(kind) {
        const result = session.place(current().buffer, kind);
        flash = t(result.error || result.label);
    }
    function askAction(action) {
        chatOpen = true;
        chatFocus = true;
        if (side) side.focus = false;
        const buffer = current().buffer;
        const ctx = action.before ? session.contextOf(buffer, 'before') : (session.contextOf(buffer, 'selection') || session.contextOf(buffer, 'note'));
        session.send(t(action.prompt), ctx, t(action.label));
    }
    function pressSide(key) {
        if (key.name === 'f4') { side = null; return; }
        if (key.name === 'escape') { side.focus = false; return; }
        if (key.name === 'up' || key.name === 'down') return stepTab(key.name === 'up' ? -1 : 1);
        if (key.name === 'enter') { side.focus = false; return; }
        if (key.ctrl && key.name === 'w') {
            closeDoc(false);
            if (mode === 'prompt') side.focus = false;
        }
    }
    function openMenu(kind) {
        mode = 'menu';
        menu = { kind, query: '', cursor: 0 };
    }
    function askQuit() {
        if (docs.some(dirty)) {
            mode = 'prompt';
            prompt = { kind: 'yes', label: t('Выйти без сохранения? (y/n)'), then: 'quit' };
            return;
        }
        quit = true;
    }
    function stepTab(dir) {
        active = (active + dir + docs.length) % docs.length;
    }
    function matches() {
        return find.query ? searchText(current().buffer.text, find.query, false) : [];
    }
    function jump(dir) {
        const found = matches();
        if (!found.length) { flash = t('нет совпадений'); return; }
        if (find.at < 0) find.at = dir < 0 ? found.length - 1 : 0;
        else find.at = (find.at + (dir < 0 ? found.length - 1 : 1)) % found.length;
        const range = found[find.at];
        const buffer = current().buffer;
        buffer.setCursor(range.from, false);
        buffer.setCursor(range.to, true);
    }
    function copy(text) {
        if (!text) return;
        try { clipboard.write(text); flash = t('Скопировано'); }
        catch { flash = t('Буфер обмена недоступен'); }
    }
    function paste() {
        try { const text = clipboard.read(); if (text) current().buffer.insert(text); }
        catch { flash = t('Буфер обмена недоступен'); }
    }

    function pressEdit(key) {
        const doc = current();
        const buffer = doc.buffer;
        const extend = !!key.shift;
        if (key.name === 'f1') { mode = 'help'; return; }
        if (key.name === 'f2') return cycleView();
        if (key.name === 'f4') return toggleSide();
        if (key.ctrl && key.name === 'p') return openMenu('commands');
        if (view === 'preview' && !key.ctrl && !key.alt && ['up', 'down', 'pageup', 'pagedown'].includes(key.name)) {
            const step = key.name === 'up' ? -1 : key.name === 'down' ? 1 : key.name === 'pageup' ? -page : page;
            doc.scroll.preview = Math.max(0, (doc.scroll.preview || 0) + step);
            return;
        }
        if (key.ctrl && key.name === 's') return save(doc);
        if (key.ctrl && key.name === 'o') return askOpen();
        if (key.ctrl && key.name === 'n') return blank();
        if (key.ctrl && key.name === 'w') return closeDoc(false);
        if (key.ctrl && key.name === 'q') return askQuit();
        if (key.ctrl && key.name === 'r') return askRename();
        if (key.ctrl && key.name === 'f') { mode = 'find'; find.at = -1; return; }
        if (key.ctrl && key.name === 'g') { mode = 'edit'; return jump(key.shift ? -1 : 1); }
        if (key.ctrl && key.name === 'l') return askLine();
        if (key.alt && key.name === 'z') return reopen();
        if (key.alt && key.name === 'p') return togglePin();
        if (key.alt && key.shift && (key.name === 'left' || key.name === 'right')) return moveTab(key.name === 'left' ? -1 : 1);
        if (key.alt && /^[1-9]$/.test(key.name)) return jumpTab(Number(key.name) - 1);
        if ((key.alt && (key.name === 'left' || key.name === 'right')) || (key.name === 'tab' && (key.ctrl || key.shift)) || (key.ctrl && (key.name === 'pageup' || key.name === 'pagedown'))) {
            const back = key.name === 'left' || key.shift || key.name === 'pageup';
            return stepTab(back ? -1 : 1);
        }
        if (view === 'preview') return;
        if (key.ctrl && key.name === 'a') return buffer.selectAll();
        if (key.ctrl && key.name === 'z') return buffer.undo();
        if (key.ctrl && key.name === 'y') return buffer.redo();
        if (key.ctrl && key.name === 'c') {
            const sel = buffer.selection();
            if (sel) return copy(buffer.text.slice(sel.from, sel.to));
            return askQuit();
        }
        if (key.ctrl && key.name === 'x') {
            const sel = buffer.selection();
            if (!sel) return;
            copy(buffer.text.slice(sel.from, sel.to));
            buffer.remove(false);
            return;
        }
        if (key.ctrl && key.name === 'v' || key.name === 'paste') return key.name === 'paste' ? buffer.insert(key.text || '') : paste();
        if (key.ctrl && key.name === 'b') return formatNow('bold');
        if (key.ctrl && key.name === 'k') return formatNow('link');
        if (key.ctrl && key.name === 'u') return formatNow('underline');
        if (key.alt && key.name === 'i') return formatNow('italic');
        if (key.alt && key.name === 'h') return formatNow('heading');
        if (key.alt && key.name === 'l') return formatNow('list');
        if (key.alt && key.name === 'q') return formatNow('quote');
        if (key.alt && (key.name === 'up' || key.name === 'down')) return buffer.moveLines(key.name === 'up' ? -1 : 1);
        if (key.alt && (key.name === '[' || key.name === ']')) return buffer.indentLines(key.name === '[');
        if (key.name === 'f3') return jump(key.shift ? -1 : 1);
        const motion = { left: 1, right: 1, up: 1, down: 1, home: 1, end: 1, pageup: 1, pagedown: 1 };
        if (motion[key.name]) {
            const kind = key.ctrl && (key.name === 'left' || key.name === 'right') ? 'word' + key.name : key.ctrl && key.name === 'home' ? 'docstart' : key.ctrl && key.name === 'end' ? 'docend' : key.name;
            return buffer.move(kind, extend, page);
        }
        if (key.name === 'backspace' || key.name === 'delete') return buffer.remove(key.name === 'backspace');
        if (key.name === 'enter') return buffer.insert('\n');
        if (key.name === 'tab') return buffer.insert(TAB);
        if (key.text && !key.ctrl && !key.alt) buffer.insert(key.text);
    }

    function menuItems() {
        if (menu.kind === 'tabs') {
            return docs.map((doc, index) => ({
                index,
                label: `${index + 1}. ${nameOf(doc)}${doc.pinned ? ' ^' : ''}${dirty(doc) ? ' *' : ''}`,
                run: () => { active = index; }
            }));
        }
        const item = (label, run) => ({ label: t(label), run });
        return [
            item('Новая вкладка', blank),
            { label: t('Язык') + ': ' + (t.language() === 'en' ? 'English' : 'Русский'), run: () => setLanguage(t.language() === 'en' ? 'ru' : 'en') },
            item('Открыть файл', askOpen),
            item('Сохранить', () => save(current())),
            item('Сохранить как', () => askSave(current())),
            item('Закрыть вкладку', () => closeDoc(false)),
            item('Вернуть закрытую', reopen),
            item('Переименовать', askRename),
            item('Дублировать вкладку', duplicate),
            item('Закрепить вкладку', togglePin),
            item('Вкладка влево', () => moveTab(-1)),
            item('Вкладка вправо', () => moveTab(1)),
            item('Найти', () => { mode = 'find'; find.at = -1; }),
            item('Жирный', () => formatNow('bold')),
            item('Курсив', () => formatNow('italic')),
            item('Зачёркнутый', () => formatNow('strike')),
            item('Подчёркнутый', () => formatNow('underline')),
            item('Заголовок', () => formatNow('heading')),
            item('Список', () => formatNow('list')),
            item('Список задач', () => formatNow('task')),
            item('Цитата', () => formatNow('quote')),
            item('Ссылка', () => formatNow('link')),
            item('Изображение', () => formatNow('image')),
            item('Блок кода', () => formatNow('code')),
            item('Ячейка JavaScript', () => formatNow('cell')),
            item('Надстрочный текст', () => formatNow('sup')),
            item('Подстрочный текст', () => formatNow('sub')),
            item('Редактор', () => { view = 'editor'; }),
            item('Рядом', () => { view = 'split'; }),
            item('Просмотр', () => { view = 'preview'; }),
            item('Перейти к строке', askLine),
            item('Справка', () => { mode = 'help'; }),
            item('Чат', toggleChat),
            item('Новый чат', () => { chatOpen = true; chatFocus = true; session.clear(); }),
            item('Вставить', () => useAnswer('insert')),
            item('Заменить', () => useAnswer('replace')),
            ...session.actions.map(action => item(action.label, () => askAction(action)))
        ];
    }
    function matchingMenu() {
        const query = menu.query.trim().toLowerCase();
        const items = menuItems().filter(item => !query || item.label.toLowerCase().includes(query));
        if (menu.cursor >= items.length) menu.cursor = Math.max(0, items.length - 1);
        return items;
    }
    function pressMenu(key) {
        const items = matchingMenu();
        if (key.name === 'escape' || (key.ctrl && key.name === 'p') || (key.name === 'f4' && menu.kind === 'tabs')) {
            mode = 'edit';
            menu = null;
            return;
        }
        if (key.name === 'up') { menu.cursor = Math.max(0, menu.cursor - 1); return; }
        if (key.name === 'down') { menu.cursor = Math.min(Math.max(items.length - 1, 0), menu.cursor + 1); return; }
        if (key.name === 'enter') {
            const item = items[menu.cursor];
            mode = 'edit';
            menu = null;
            if (item) item.run();
            return;
        }
        if (key.ctrl && key.name === 'w' && menu.kind === 'tabs') {
            const item = items[menu.cursor];
            mode = 'edit';
            menu = null;
            if (!item) return;
            active = item.index;
            closeDoc(false);
            return;
        }
        if (key.name === 'backspace') { menu.query = menu.query.slice(0, -1); menu.cursor = 0; return; }
        if (key.text && !key.ctrl && !key.alt) { menu.query += key.text; menu.cursor = 0; }
    }

    function pressFind(key) {
        if (key.name === 'escape') { mode = 'edit'; return; }
        if (key.name === 'enter' || (key.ctrl && key.name === 'g') || key.name === 'f3') return jump(key.shift ? -1 : 1);
        if (key.name === 'backspace') { find.query = find.query.slice(0, -1); find.at = -1; return; }
        if (key.ctrl && key.name === 's') return save(current());
        if (key.ctrl && key.name === 'c' && !find.query) return askQuit();
        if (key.text && !key.ctrl && !key.alt) { find.query += key.text; find.at = -1; }
    }

    function pressPrompt(key) {
        if (key.name === 'escape') { mode = 'edit'; prompt = null; return; }
        if (prompt.kind === 'yes') {
            const answer = key.text || '';
            if (yes.has(answer)) {
                const then = prompt.then;
                mode = 'edit';
                prompt = null;
                if (then === 'close') closeDoc(true);
                else if (then === 'quit') quit = true;
            } else if (no.has(answer)) { mode = 'edit'; prompt = null; }
            return;
        }
        if (key.name === 'backspace') { prompt.value = prompt.value.slice(0, -1); return; }
        if (key.name === 'enter') {
            const value = prompt.value.trim();
            const then = prompt.then;
            const kind = prompt.kind;
            const doc = prompt.doc || current();
            mode = 'edit';
            prompt = null;
            if (kind === 'line') { if (Number(value) > 0) doc.buffer.gotoLine(Number(value)); return; }
            if (kind === 'rename') { if (value) rename(doc, value); return; }
            if (!value) return;
            if (then === 'open') openPath(value);
            else {
                save(doc, value);
                if (then === 'close' && !dirty(doc)) closeDoc(true);
            }
            return;
        }
        if (key.text && !key.ctrl) prompt.value += key.text;
    }

    function press(key) {
        if (quit || !key) return;
        flash = '';
        if (mode === 'help') {
            if (key.name === 'escape' || key.name === 'f1' || key.name === 'enter') mode = 'edit';
            return;
        }
        if (mode === 'prompt') return pressPrompt(key);
        if (key.name === 'f6' || (key.name === 'j' && (key.alt || key.ctrl))) {
            if (mode === 'menu' || mode === 'find') { mode = 'edit'; menu = null; }
            return toggleChat();
        }
        if (mode === 'menu') return pressMenu(key);
        if (mode === 'find') return pressFind(key);
        if (chatFocus) return pressChat(key);
        if (!chatOpen && side && side.focus) return pressSide(key);
        pressEdit(key);
    }
    function pressChat(key) {
        if (key.name === 'escape') {
            if (session.running()) session.abort();
            else chatFocus = false;
            return;
        }
        if (key.name === 'enter') {
            if (session.running()) session.abort();
            else session.send(session.draft(), session.contextOf(current().buffer, 'auto'));
            return;
        }
        if (key.alt && key.name === 'i') return useAnswer('insert');
        if (key.alt && key.name === 'r') return useAnswer('replace');
        if (key.alt && key.name === 'n') return session.clear();
        if (key.ctrl && key.name === 'c') {
            const text = session.lastAnswer();
            if (text) copy(text);
            return;
        }
        if (key.ctrl && key.name === 's') return save(current());
        if (key.ctrl && key.name === 'p') { chatFocus = false; return openMenu('commands'); }
        if (key.name === 'up' || key.name === 'down' || key.name === 'pageup' || key.name === 'pagedown') return session.scrollBy(key.name);
        if (key.name === 'backspace') return session.backspace();
        if (key.name === 'paste') return session.type(key.text || '');
        if (key.ctrl && key.name === 'v') {
            try { session.type(clipboard.read()); }
            catch { flash = t('Буфер обмена недоступен'); }
            return;
        }
        if (key.text && !key.ctrl && !key.alt) session.type(key.text);
    }

    function layout(width, height) {
        const cols = Math.max(20, width || 80);
        const rows = Math.max(6, height || 24);
        const doc = current();
        const found = mode === 'find' || find.query ? matches() : [];
        const findRow = mode === 'find' ? 1 : 0;
        const promptRow = mode === 'prompt' ? 1 : 0;
        page = Math.max(1, rows - 2 - findRow - promptRow);
        const marks = mode === 'find' ? found : [];
        const showChat = chatOpen && mode !== 'help' && mode !== 'menu';
        const showSide = !!side && mode !== 'help' && mode !== 'menu';
        let listW = showSide ? Math.min(34, Math.max(22, Math.floor(cols * 0.33))) : 0;
        let chatW = showChat ? Math.min(46, Math.max(28, Math.floor(cols * 0.42))) : 0;
        const taken = () => listW + chatW + (listW ? 1 : 0) + (chatW ? 1 : 0);
        if (listW && !chatW && cols - taken() < 24) listW = Math.max(0, cols - 25);
        if (chatW && !listW && cols - taken() < 24) chatW = Math.max(0, cols - 25);
        if (listW && chatW && cols - taken() < 24) {
            const budget = cols - 24 - 2;
            if (budget < 28) {
                chatW = 0;
                if (cols - listW - 1 < 24) listW = Math.max(0, cols - 25);
            } else {
                chatW = Math.max(16, budget - listW);
                if (listW + chatW > budget) listW = budget - chatW;
                if (listW < 12) { listW = 12; chatW = budget - listW; }
            }
        }
        const editorW = Math.max(1, cols - taken());
        const noteEmpty = !doc.buffer.text.trim();
        const splitOn = view === 'split' && mode !== 'help' && mode !== 'menu' && mode !== 'find';
        let sourceW = editorW;
        let previewW = 0;
        if (splitOn && editorW >= 17) {
            sourceW = Math.floor((editorW - 1) / 2);
            previewW = editorW - sourceW - 1;
        }
        const body = mode === 'help'
            ? helpRows(t, cols, page)
            : mode === 'menu'
                ? menuRows(t, matchingMenu(), menu, cols, page)
                : view === 'preview' && mode !== 'find'
                    ? previewRows(doc.buffer.text, editorW, page, doc.scroll, 0)
                    : sourceRows(doc.buffer, previewW ? sourceW : editorW, page, doc.scroll, marks);
        if (previewW) linkScroll(doc.buffer.text, previewW, page, doc.scroll);
        const split = previewW ? { width: previewW, rows: previewRows(doc.buffer.text, previewW, page, doc.scroll, 0) } : null;
        const here = found.length && find.at >= 0 ? `${(find.at % found.length) + 1}/${found.length}` : found.length ? `0/${found.length}` : t('нет совпадений');
        const empty = !doc.buffer.text.trim() && view === 'editor' && mode === 'edit';
        return {
            tabs: docs.map((item, index) => ({ title: nameOf(item), active: index === active, dirty: dirty(item), pinned: !!item.pinned })),
            rows: body,
            find: mode === 'find' ? { label: t('Поиск'), query: find.query, count: find.query ? here : '' } : null,
            prompt: mode === 'prompt' ? { label: prompt.label, value: prompt.value } : null,
            help: mode === 'help',
            preview: view === 'preview',
            view,
            mascot: mode !== 'help' && mode !== 'menu' && (view !== 'preview' || noteEmpty),
            caption: empty ? t('С чего начнём?') : '',
            face: face(view, dirty(doc)),
            side: listW ? sideList(t, docs, active, nameOf, dirty, page, listW, side.focus) : null,
            chat: chatW ? session.lines(chatW, page, doc.buffer, chatFocus) : null,
            split,
            status: statusLine(t, doc, flash, view),
            hint: `${t('Ctrl-P команды')}  ${t('F1 справка')}`,
            quit
        };
    }

    if (options.files && options.files.length) options.files.forEach(openPath);
    if (!docs.length) blank();

    return { press, layout, openPath, settled: () => job, abort: () => session.abort(), get quit() { return quit; } };
}

function statusLine(t, doc, flash, view) {
    if (flash) return flash;
    const { line, col } = doc.buffer.pos();
    const where = doc.path || doc.title;
    const mark = doc.buffer.text === doc.saved ? '' : `  ${t('изменён')}`;
    const mode = view === 'preview' ? `  ${t('Просмотр')}` : view === 'split' ? `  ${t('Рядом')}` : '';
    return `${t('Стр {line}, стлб {col}', { line: line + 1, col: col + 1 })}  ${countWord(t, words(doc.buffer.text))}  ${where}${mark}${mode}`;
}

function sideList(t, docs, activeIndex, nameOf, dirty, height, width, focused) {
    const lines = [{ text: ' ▾ ' + t('Открытые редакторы'), kind: 'head' }];
    const room = Math.max(0, height - 1);
    let start = 0;
    if (docs.length > room) {
        start = Math.max(0, Math.min(activeIndex, docs.length - room));
    }
    for (let i = 0; i < room; i++) {
        const doc = docs[start + i];
        if (!doc) { lines.push({ text: '', mark: '', active: false }); continue; }
        const index = start + i;
        lines.push({
            text: '  ' + (doc.pinned ? '^ ' : '') + nameOf(doc),
            mark: dirty(doc) ? '●' : '',
            active: index === activeIndex,
            cursor: focused && index === activeIndex
        });
    }
    return { width, focused, left: true, lines: lines.slice(0, height) };
}

function menuRows(t, items, menu, width, height) {
    const title = (menu.kind === 'tabs' ? t('Вкладки') : t('Команды')) + (menu.query ? ': ' + menu.query : '');
    const rows = [{ gutter: '', text: title.slice(0, width), cursor: -1, sel: null, marks: [], kind: 'h' }];
    items.slice(0, Math.max(0, height - 1)).forEach((item, index) => {
        const mark = index === menu.cursor ? '> ' : '  ';
        const text = (mark + item.label).slice(0, width);
        rows.push({ gutter: '', text, cursor: -1, sel: index === menu.cursor ? [0, text.length] : null, marks: [], kind: 'menu' });
    });
    while (rows.length < height) rows.push({ gutter: '', text: '', cursor: -1, sel: null, marks: [], kind: 'menu' });
    return rows.slice(0, height);
}

function helpRows(t, width, height) {
    const rows = HELP.map(([left, right]) => ({
        gutter: '',
        text: (t(left) + (right ? '  ' + t(right) : '')).slice(0, width),
        cursor: -1, sel: null, marks: [], kind: right ? '' : 'h'
    }));
    while (rows.length < height) rows.push({ gutter: '', text: '', cursor: -1, sel: null, marks: [], kind: '' });
    return rows.slice(0, height);
}

function readText(io, file) {
    const data = io.readFileSync(file);
    if (data.includes && data.includes(0)) { const error = new Error('binary'); error.code = 'BINARY'; throw error; }
    return String(data).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function systemClipboard() {
    const { spawnSync } = require('child_process');
    const writeCmd = process.platform === 'darwin' ? ['pbcopy'] : process.platform === 'win32' ? ['clip'] : ['wl-copy'];
    const readCmd = process.platform === 'darwin' ? ['pbpaste'] : process.platform === 'win32' ? ['powershell', '-NoProfile', '-Command', 'Get-Clipboard'] : ['wl-paste', '--no-newline'];
    const run = (cmd, input) => {
        const result = spawnSync(cmd[0], cmd.slice(1), { input, encoding: 'utf8' });
        if (result.error || result.status) throw result.error || new Error('clipboard');
        return result.stdout || '';
    };
    return { read: () => run(readCmd), write: text => run(writeCmd, text) };
}

function helpLines(lang) {
    const t = createI18n(lang || 'ru');
    return HELP.map(([left, right]) => t(left) + (right ? '  ' + t(right) : '')).join('\n');
}

module.exports = { createApp, helpLines };
