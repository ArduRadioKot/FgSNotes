// Plugins: .js and .css files that extend the editor. On desktop they live in Documents/FgSNotes/plugins (like themes) and the
// "Установить плагин" button copies a file there; on a phone (no such folder) the file is kept in the app's storage.
// A .css plugin is simply added to the page. A .js plugin is a function body that receives one argument, `fgs` (the API below).
// Plugins start switched off when they were put into the folder by hand, and on when they were installed with the button.
//
//   // ==FgsPlugin==
//   // @name        Insert date
//   // @version     1.0
//   // @description Adds a button that inserts today's date
//   // ==/FgsPlugin==
//   fgs.addButton({ title: 'Вставить дату', icon: 'calendar', run: () => fgs.editor.insert(new Date().toLocaleDateString()) });
(function () {
    const tr = (key, vars) => (typeof t === 'function' ? t(key, vars) : key);
    const ENABLED = 'fgsnotes.plugins.enabled';
    const STORED = 'fgsnotes.plugins.files';
    const desktop = !!(window.electron && window.electron.getPlugins);
    const running = new Map();        // file -> { cleanups: [], preview: [], change: [], error }
    const listeners = new Set();

    const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
    const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or unavailable */ } };
    const enabledMap = () => read(ENABLED, {});
    const setEnabled = (file, on) => { const all = enabledMap(); if (on) all[file] = true; else delete all[file]; write(ENABLED, all); };
    const safeName = name => String(name).replace(/[\\/:*?"<>|\0]/g, '_').slice(0, 120);
    const changed = () => listeners.forEach(listener => listener());

    function meta(source, file) {
        const header = /==FgsPlugin==([\s\S]*?)==\/FgsPlugin==/.exec(String(source).slice(0, 4000));
        const field = name => { const match = header && new RegExp('@' + name + '\\s+(.+)').exec(header[1]); return match ? match[1].trim() : ''; };
        return { name: field('name') || file.replace(/\.(js|css)$/i, ''), version: field('version'), description: field('description'), author: field('author') };
    }

    // --- files ---------------------------------------------------------------------------------------------------------------
    async function files() {
        if (desktop) { try { return (await window.electron.getPlugins()).map(item => item.file); } catch { return []; } }
        return Object.keys(read(STORED, {}));
    }
    async function source(file) {
        if (desktop) return window.electron.readPlugin(file);
        const text = read(STORED, {})[file];
        if (text === undefined) throw new Error(tr('Файл плагина не найден'));
        return text;
    }

    // --- plugin buttons: the left rail, with an overflow menu --------------------------------------------------------------------
    const buttons = [];                 // { file, title, icon, run } in the order plugins registered them
    const phone = matchMedia('(max-width: 720px)');
    let rail = null, menu = null, layoutFrame = 0, resizeWatcher = null;
    // Every plugin icon ends up the same size: a custom SVG loses its own width/height, gets the app's icon class and a 16x16 grid if it has none.
    const iconMarkup = icon => {
        if (!/^\s*</.test(icon)) return window.icon ? window.icon(icon) : '';
        return String(icon).trim().replace(/<svg\b([^>]*)>/i, (match, attrs) => {
            attrs = attrs.replace(/\s(?:width|height|class|style)=("[^"]*"|'[^']*')/gi, '');
            if (!/\sviewBox=/i.test(attrs)) attrs += ' viewBox="0 0 16 16"';
            return `<svg class="icon"${attrs} aria-hidden="true" focusable="false">`;
        });
    };

    function railButton(entry, className) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className + ' plugin-tool';
        button.title = entry.title;
        button.setAttribute('aria-label', entry.title);
        button.innerHTML = iconMarkup(entry.icon);
        button.addEventListener('mousedown', event => event.preventDefault());
        button.addEventListener('click', () => { if (!entry.keepMenu) closeMenu(); entry.run(); });
        return button;
    }
    function closeMenu() {
        if (!menu || menu.hidden) return;
        menu.hidden = true;
        const opener = document.querySelector('.plugin-more');
        if (opener) opener.setAttribute('aria-expanded', 'false');
    }
    function openMenu(opener, entries) {
        if (!menu) {
            menu = document.createElement('div');
            menu.className = 'theme-menu plugin-menu';
            menu.setAttribute('role', 'menu');
            menu.setAttribute('aria-label', tr('Плагины'));
            document.body.append(menu);
            document.addEventListener('mousedown', event => { if (!menu.hidden && !menu.contains(event.target) && !event.target.closest('.plugin-more')) closeMenu(); }, true);
            document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { closeMenu(); const more = document.querySelector('.plugin-more'); if (more) more.focus(); } });
            window.addEventListener('resize', closeMenu);
        }
        menu.setAttribute('aria-label', tr('Плагины'));
        menu.replaceChildren(Object.assign(document.createElement('div'), { className: 'theme-menu-title', textContent: tr('Плагины') }));
        for (const entry of entries) {
            const item = document.createElement('button');
            item.type = 'button';
            item.setAttribute('role', 'menuitem');
            item.innerHTML = `<span class="check">${iconMarkup(entry.icon)}</span><span class="label"></span>`;
            item.querySelector('.label').textContent = entry.title;
            item.addEventListener('click', () => { closeMenu(); entry.run(); });
            menu.append(item);
        }
        const box = opener.getBoundingClientRect();
        menu.style.left = `${Math.round(box.right + 8)}px`;
        menu.style.bottom = `${Math.max(8, Math.round(innerHeight - box.bottom))}px`;
        menu.style.top = 'auto';
        menu.hidden = false;
        opener.setAttribute('aria-expanded', 'true');
        menu.querySelector('button').focus({ preventScroll: true });
    }

    function doLayout() {
        layoutFrame = 0;
        document.querySelectorAll('.plugin-tool').forEach(node => node.remove());
        closeMenu();
        const bar = document.querySelector('.editor-tools');
        if (!buttons.length) { if (rail) rail.hidden = true; return; }
        if (phone.matches) {          // the rail is a bottom pill on a phone: plugin buttons go to the formatting bar
            if (rail) rail.hidden = true;
            if (bar) buttons.forEach(entry => bar.appendChild(railButton(entry, 'tool-button')));
            return;
        }
        if (!rail) {
            const toolbar = document.querySelector('.sidebar-toolbar');
            if (!toolbar) return;
            rail = document.createElement('div');
            rail.className = 'sidebar-plugin-buttons';
            rail.setAttribute('aria-label', tr('Плагины'));
            toolbar.insertBefore(rail, toolbar.querySelector('.sidebar-bottom-buttons'));
            resizeWatcher = new ResizeObserver(() => layout());
            resizeWatcher.observe(rail);
        }
        rail.hidden = false;
        // 36px buttons with a 4px gap; the separator on top takes 12px.
        const capacity = Math.max(1, Math.floor((rail.clientHeight - 12 + 4) / 40));
        const direct = buttons.length <= capacity ? buttons : buttons.slice(0, capacity - 1);
        for (const entry of direct) rail.appendChild(railButton(entry, 'sidebar-button icon-button'));
        if (direct.length < buttons.length) {
            const rest = buttons.slice(direct.length);
            const more = railButton({ title: `Ещё плагины (${rest.length})`, icon: 'more', keepMenu: true, run() {} }, 'sidebar-button icon-button');
            more.classList.add('plugin-more');
            more.setAttribute('aria-haspopup', 'menu');
            more.setAttribute('aria-expanded', 'false');
            more.addEventListener('click', event => { event.stopPropagation(); if (menu && !menu.hidden) closeMenu(); else openMenu(more, rest); });
            rail.appendChild(more);
        }
    }
    function layout() { if (!layoutFrame) layoutFrame = setTimeout(doLayout, 16); }
    phone.addEventListener('change', layout);

    // --- API handed to a plugin ----------------------------------------------------------------------------------------------
    function makeApi(file, state) {
        const editor = () => document.getElementById('markdown-editor');
        const track = fn => { state.cleanups.push(fn); };
        const storageKey = key => `fgsnotes.plugin.${file}.${key}`;
        const api = {
            version: 1,
            file,
            // Adds CSS to the page for as long as the plugin is on.
            addStyle(css) {
                const style = document.createElement('style');
                style.dataset.plugin = file;
                style.textContent = String(css);
                document.head.appendChild(style);
                track(() => style.remove());
            },
            // fn(previewElement) runs after every redraw of the preview.
            onPreview(fn) { state.preview.push(fn); },
            // fn(text) runs when the note changes.
            onChange(fn) { state.change.push(fn); },
            // A button on the left edge of the window (in the formatting bar on a phone). When there are more than fit, the rest move
            // into a "…" menu. icon: a built-in icon name or SVG markup. run(fgs.editor) is called on click.
            addButton({ title, icon = 'sparkles', run }) {
                const entry = { file, title: String(title), icon, run: () => { try { run(api.editor); } catch (error) { console.error(`[${file}]`, error); } } };
                buttons.push(entry);
                layout();
                track(() => { buttons.splice(buttons.indexOf(entry), 1); layout(); });
            },
            editor: {
                get: () => editor().value,
                set(text) { const area = editor(); area.value = String(text); area.dispatchEvent(new Event('input', { bubbles: true })); },
                insert(text) { const area = editor(); area.focus(); const from = area.selectionStart, to = area.selectionEnd; area.setRangeText(String(text), from, to, 'end'); area.dispatchEvent(new Event('input', { bubbles: true })); },
                selection: () => { const area = editor(); return area.value.slice(area.selectionStart, area.selectionEnd); },
                cursor: () => { const area = editor(); return { from: area.selectionStart, to: area.selectionEnd }; },
                replace(from, to, text) { const area = editor(); area.focus(); area.setRangeText(String(text), from, to, 'end'); area.dispatchEvent(new Event('input', { bubbles: true })); }
            },
            // A tab next to the notes whose content the plugin draws itself. render(element, tab) runs once; opening the same key
            // again brings the tab forward. tab: { close(), backToNote(), setTitle(text), created }.
            openTab({ key = file, title, icon = 'file', render, onClose } = {}) {
                if (!window.FgsActions || !window.FgsActions.openViewTab) return null;
                const element = document.createElement('div');
                element.className = 'plugin-view-body';
                const tab = window.FgsActions.openViewTab({ key: `${file}:${key}`, title: title || api.file, icon, element, onClose });
                if (tab.created) {
                    if (render) { try { render(tab.element, tab); } catch (error) { console.error(`[${file}]`, error); } }
                    track(() => tab.close());
                }
                return tab;
            },
            // The open notes: [{ id, title, content, active }]; openDocument(id) switches to one, createDocument(title, text) adds one.
            documents: () => (window.FgsActions ? window.FgsActions.documents() : []),
            openDocument: id => window.FgsActions && window.FgsActions.openDocument(id),
            createDocument: (title, content) => window.FgsActions && window.FgsActions.createDocument(title, content),
            // Markdown to HTML with the app's own renderer.
            markdown: text => (window.parseMarkdown ? window.parseMarkdown(String(text)) : ''),
            // Offers `data` (text or Blob) as a file download.
            download(name, data, type = 'text/plain;charset=utf-8') {
                const blob = data instanceof Blob ? data : new Blob([data], { type });
                const url = URL.createObjectURL(blob);
                const link = Object.assign(document.createElement('a'), { href: url, download: name });
                document.body.append(link); link.click(); link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            },
            // File picker: resolves { name, type, size, data } or null. as: 'text' (default), 'dataUrl' or 'arrayBuffer'.
            pickFile({ accept = '', as = 'text' } = {}) {
                return new Promise(resolve => {
                    const input = Object.assign(document.createElement('input'), { type: 'file', accept, hidden: true });
                    document.body.append(input);
                    input.addEventListener('cancel', () => { input.remove(); resolve(null); }, { once: true });
                    input.onchange = async () => {
                        const file = input.files[0];
                        input.remove();
                        if (!file) return resolve(null);
                        const read = as === 'arrayBuffer' ? file.arrayBuffer() : as === 'dataUrl' ? new Promise(done => { const reader = new FileReader(); reader.onload = () => done(reader.result); reader.readAsDataURL(file); }) : file.text();
                        resolve({ name: file.name, type: file.type, size: file.size, data: await read });
                    };
                    input.click();
                });
            },
            // A dialog: returns { body, close }. width in px. Closes on Esc and on a click outside; onClose is called then.
            modal({ title = '', width = 720, onClose } = {}) {
                const back = document.createElement('div');
                back.className = 'plugin-modal-back';
                back.innerHTML = `<div class="plugin-modal" role="dialog" aria-modal="true"><div class="plugin-modal-head"><strong></strong><button type="button" class="icon-button" aria-label="${tr('Закрыть')}"></button></div><div class="plugin-modal-body"></div></div>`;
                const box = back.firstChild;
                box.style.width = `min(${width}px, 100%)`;
                back.querySelector('strong').textContent = title;
                back.querySelector('button').innerHTML = window.icon ? window.icon('close') : '×';
                const close = () => { document.removeEventListener('keydown', onKey, true); back.remove(); if (onClose) onClose(); };
                const onKey = event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
                document.addEventListener('keydown', onKey, true);
                back.addEventListener('mousedown', event => { if (event.target === back) close(); });
                back.querySelector('button').addEventListener('click', close);
                document.body.append(back);
                track(close);
                return { body: back.querySelector('.plugin-modal-body'), close, element: box };
            },
            // Small private storage for the plugin.
            storage: {
                get(key, fallback) { try { const value = localStorage.getItem(storageKey(key)); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } },
                set(key, value) { try { localStorage.setItem(storageKey(key), JSON.stringify(value)); } catch { /* storage full */ } }
            },
            // A short message in the status bar.
            notify(text) {
                const status = document.getElementById('save-status');
                if (!status) return;
                const before = status.textContent;
                status.textContent = String(text);
                setTimeout(() => { if (status.textContent === String(text)) status.textContent = before; }, 3000);
            },
            // Called when the plugin is switched off.
            onUnload: track
        };
        return api;
    }

    async function start(file) {
        if (running.has(file)) return;
        const state = { cleanups: [], preview: [], change: [], error: '' };
        running.set(file, state);
        try {
            const text = await source(file);
            const api = makeApi(file, state);
            if (/\.css$/i.test(file)) api.addStyle(text);
            else new Function('fgs', text)(api);
        } catch (error) {
            state.error = (error && error.message) || String(error);
            console.error(`[plugin ${file}]`, error);
        }
        changed();
    }
    function stop(file) {
        const state = running.get(file);
        if (!state) return;
        state.cleanups.forEach(fn => { try { fn(); } catch { /* the plugin is leaving anyway */ } });
        running.delete(file);
        changed();
    }

    function emit(event, value) {
        running.forEach((state, file) => {
            for (const fn of state[event] || []) { try { fn(value); } catch (error) { console.error(`[plugin ${file}]`, error); } }
        });
    }

    // --- install / remove ------------------------------------------------------------------------------------------------------
    async function install() {
        if (desktop) {
            const result = await window.electron.installPlugins();
            for (const file of result.installed || []) { setEnabled(file, true); stop(file); await start(file); }
            changed();
            return result;
        }
        return new Promise(resolve => {
            const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.js,.css,text/javascript,text/css', multiple: true, hidden: true });
            document.body.append(input);
            input.addEventListener('cancel', () => { input.remove(); resolve({ canceled: true, installed: [] }); }, { once: true });
            input.onchange = async () => {
                const picked = [...input.files];
                input.remove();
                const stored = read(STORED, {});
                const installed = [];
                for (const file of picked) {
                    if (!/\.(js|css)$/i.test(file.name) || file.size > 2 * 1024 * 1024) continue;
                    const name = safeName(file.name);
                    stored[name] = await file.text();
                    installed.push(name);
                }
                write(STORED, stored);
                for (const name of installed) { setEnabled(name, true); stop(name); await start(name); }
                changed();
                resolve({ canceled: false, installed });
            };
            input.click();
        });
    }
    async function remove(file) {
        setEnabled(file, false);
        if (desktop) await window.electron.removePlugin(file);
        else { const stored = read(STORED, {}); delete stored[file]; write(STORED, stored); }
        stop(file);          // redraws the list, now without the file
        changed();
    }
    async function toggle(file, on) {
        setEnabled(file, on);
        if (on) await start(file); else stop(file);
    }

    // --- the list in Settings → Плагины -----------------------------------------------------------------------------------------
    const escapeHtml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let armed = null;
    async function draw(host) {
        const names = await files();
        const on = enabledMap();
        const rows = await Promise.all(names.map(async file => {
            let info = { name: file, version: '', description: '' };
            try { info = meta(await source(file), file); } catch { /* unreadable file: listed by its name */ }
            const state = running.get(file);
            const error = state && state.error ? `<small class="plugin-error">${escapeHtml(state.error)}</small>` : '';
            return `<div class="setting-item plugin-row" data-file="${escapeHtml(file)}">
                <div class="setting-info">
                    <span class="setting-name">${escapeHtml(info.name)}${info.version ? ` <span class="plugin-version">${escapeHtml(info.version)}</span>` : ''}</span>
                    <div class="setting-desc">${escapeHtml(info.description || file)}</div>${error}
                </div>
                <div class="setting-control plugin-actions">
                    <button type="button" class="button-secondary" data-act="remove">${armed === file ? tr('Точно удалить?') : tr('Удалить')}</button>
                    <label class="setting-toggle"><input type="checkbox" data-act="toggle" ${on[file] ? 'checked' : ''} aria-label="${tr('Включить плагин {name}', { name: escapeHtml(info.name) })}"><span class="setting-toggle-track" aria-hidden="true"></span></label>
                </div>
            </div>`;
        }));
        host.querySelector('[data-plugin-list]').innerHTML = rows.join('') || `<div class="setting-item plugin-empty"><div class="setting-info"><div class="setting-desc">${tr('Плагинов пока нет. Нажмите «Установить плагин» и выберите файл .js или .css.')}</div></div></div>`;
        if (window.FgsI18n) window.FgsI18n.apply(host);
    }
    function mount(host) {
        if (host.dataset.bound) return;
        host.dataset.bound = '1';
        host.innerHTML = `<div class="setting-item">
                <div class="setting-info">
                    <span class="setting-name">${tr('Установленные плагины')}</span>
                    <div class="setting-desc">${desktop ? tr('Файлы .js и .css из папки Documents/FgSNotes/plugins. Плагин выполняется с доступом ко всем вашим заметкам: ставьте только те, которым доверяете.') : tr('Файлы .js и .css, сохранённые в приложении. Плагин выполняется с доступом ко всем вашим заметкам: ставьте только те, которым доверяете.')}</div>
                </div>
                <div class="setting-control plugin-actions">
                    ${desktop ? `<button type="button" class="button-secondary" data-act="folder">${tr('Открыть папку')}</button>` : ''}
                    <button type="button" class="button-secondary" data-act="install">${tr('Установить плагин')}</button>
                </div>
            </div>
            <div data-plugin-list></div>`;
        const redraw = () => draw(host);
        listeners.add(redraw);
        host.addEventListener('click', async event => {
            const button = event.target.closest('button[data-act]');
            if (!button) return;
            const row = button.closest('.plugin-row');
            if (button.dataset.act === 'install') await install();
            else if (button.dataset.act === 'folder') window.electron.openPluginsFolder();
            else if (button.dataset.act === 'remove') {
                const file = row.dataset.file;
                if (armed !== file) { armed = file; setTimeout(() => { if (armed === file) { armed = null; redraw(); } }, 3000); return redraw(); }
                armed = null;
                await remove(file);
            }
        });
        host.addEventListener('change', event => {
            const box = event.target.closest('input[data-act="toggle"]');
            if (box) toggle(box.closest('.plugin-row').dataset.file, box.checked);
        });
        redraw();
    }

    async function init() {
        const on = enabledMap();
        for (const file of await files()) if (on[file]) await start(file);
        const host = document.getElementById('plugin-manager');
        if (host) mount(host);
    }
    window.FgsPlugins = { emit, install, remove, toggle, files, running: () => [...running.keys()], onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); }, parseMeta: meta };
    window.addEventListener('fgs-language', () => {
        const host = document.getElementById('plugin-manager');
        if (!host || !host.dataset.bound) return;
        const name = host.querySelector(':scope > .setting-item .setting-name');
        if (name) name.textContent = tr('Установленные плагины');
        const desc = host.querySelector(':scope > .setting-item .setting-desc');
        if (desc) desc.textContent = desktop ? tr('Файлы .js и .css из папки Documents/FgSNotes/plugins. Плагин выполняется с доступом ко всем вашим заметкам: ставьте только те, которым доверяете.') : tr('Файлы .js и .css, сохранённые в приложении. Плагин выполняется с доступом ко всем вашим заметкам: ставьте только те, которым доверяете.');
        const folder = host.querySelector('[data-act="folder"]');
        if (folder) folder.textContent = tr('Открыть папку');
        const installBtn = host.querySelector('[data-act="install"]');
        if (installBtn) installBtn.textContent = tr('Установить плагин');
        draw(host);
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
    else setTimeout(init, 0);
})();
