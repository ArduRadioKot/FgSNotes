// Access for outside assistants (MCP), desktop only. mcp-server.js speaks the protocol; this file runs its tools on the
// open notes and draws the settings section. Changes go through the same path as sync, so the tab being typed in keeps
// its caret, and they reach other devices like any other edit.
(function () {
    const electron = window.electron;
    if (!electron || !electron.mcp) return;
    const STORAGE_KEY = 'fgsnotes.mcp.v1';
    const t = (key, vars) => (window.t ? window.t(key, vars) : key);
    const $ = id => document.getElementById(id);
    const HINTS = {
        'claude-code': 'Выполните команду в терминале',
        'claude-desktop': 'Добавьте это в файл claude_desktop_config.json (Настройки Claude, раздел для разработчиков) и перезапустите Claude',
        codex: 'Выполните команду в терминале',
        cursor: 'Добавьте это в файл mcp.json. Такой же формат подходит большинству других приложений с адресом и заголовком',
        chatgpt: 'ChatGPT работает в облаке и не видит этот компьютер, поэтому нужен туннель. Запустите первую команду, подставьте выданный адрес во вторую строку и добавьте её как коннектор без авторизации в режиме разработчика ChatGPT. Пока туннель запущен, заметки доступны из интернета всем, кто знает эту ссылку'
    };
    let settings = { enabled: false, write: false };
    try { settings = { ...settings, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) }; } catch { /* defaults */ }
    let info = null, lastError = '';

    // ---------- tools ----------
    const actions = () => window.FgsActions;
    const allNotes = () => actions().syncNotes();
    const liveNotes = () => allNotes().filter(note => !note.deleted);
    const version = note => String(note.updatedAt || 0);
    const urlOf = note => `fgsnotes://note/${encodeURIComponent(note.uid)}`;
    const cleanText = text => String(text).replace(/\r\n?/g, '\n');

    function findNote(list, id) {
        const note = list.find(item => item.uid === id && !item.deleted);
        if (!note) throw new Error(`No open note with id ${id}. Use search to get the ids.`);
        return note;
    }
    function commit(list) {
        actions().applySyncNotes(list);
        window.dispatchEvent(new CustomEvent('fgs-notes-changed'));
    }
    function edited(note, content) {
        note.content = content;
        note.updatedAt = Math.max(Date.now(), (note.updatedAt || 0) + 1);
        note.ver = window.FgsSync.bump(note.ver);
        return { id: note.uid, title: note.title, version: version(note), url: urlOf(note) };
    }

    const TOOLS = {
        search({ query }) {
            const words = query.toLowerCase().split(/\s+/).filter(Boolean);
            const found = liveNotes().map(note => {
                const title = note.title.toLowerCase(), text = note.content.toLowerCase();
                return { note, inTitle: words.filter(word => title.includes(word)).length, matches: words.every(word => title.includes(word) || text.includes(word)) };
            }).filter(item => item.matches).sort((a, b) => b.inTitle - a.inTitle);
            return { results: found.slice(0, 50).map(({ note }) => ({ id: note.uid, title: note.title, url: urlOf(note) })) };
        },
        fetch({ id }) {
            const note = findNote(liveNotes(), id);
            return { id: note.uid, title: note.title, text: note.content, url: urlOf(note), metadata: { version: version(note) } };
        },
        create_note({ title, content }) {
            const list = allNotes();
            const note = { uid: `mcp-${crypto.randomUUID()}`, title: title.trim() || t('Заметка'), content: '', ver: {}, updatedAt: 0 };
            const result = edited(note, cleanText(content));
            list.push(note);
            commit(list);
            return result;
        },
        append_note({ id, text }) {
            const list = allNotes();
            const note = findNote(list, id);
            const glue = !note.content || note.content.endsWith('\n') ? '' : '\n';
            const result = edited(note, note.content + glue + cleanText(text));
            commit(list);
            return result;
        },
        update_note({ id, version: expected, content }) {
            const list = allNotes();
            const note = findNote(list, id);
            if (version(note) !== expected) throw new Error('The note changed since it was read. Read it again with fetch before rewriting it.');
            const result = edited(note, cleanText(content));
            commit(list);
            return result;
        }
    };
    electron.mcp.onCall((name, args) => {
        if (!settings.enabled) throw new Error('Access is turned off in FgSNotes settings');
        return TOOLS[name](args);
    });

    // ---------- settings ----------
    function save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* stays for this session */ }
    }
    function render() {
        if (!$('mcp-status')) return;
        $('mcp-enabled').checked = settings.enabled;
        $('mcp-write').checked = settings.write;
        const running = !!(info && info.running);
        const client = $('mcp-client').value;
        $('mcp-row-connect').hidden = !running;
        $('mcp-snippet').hidden = !running;
        $('mcp-hint').textContent = t(HINTS[client]);
        $('mcp-snippet').textContent = running ? info.snippets[client] : '';
        $('mcp-status').textContent = lastError
            || (running ? t('Работает на этом компьютере. Подключение открыто, пока запущено приложение') : t('Выключено'));
        $('mcp-new-key').disabled = !running;
    }
    async function apply() {
        lastError = '';
        try { info = settings.enabled ? await electron.mcp.start({ write: settings.write }) : await electron.mcp.stop(); }
        catch (error) { info = null; lastError = t('Не удалось включить доступ: {error}', { error: error.message }); }
        render();
    }
    function start() {
        if (!$('mcp-status')) return;
        $('mcp-enabled').addEventListener('change', event => { settings.enabled = event.target.checked; save(); apply(); });
        $('mcp-write').addEventListener('change', event => { settings.write = event.target.checked; save(); apply(); });
        $('mcp-client').addEventListener('change', render);
        $('mcp-copy').addEventListener('click', async () => {
            try { await navigator.clipboard.writeText($('mcp-snippet').textContent); $('mcp-status').textContent = t('Скопировано'); } catch { /* the text can be selected by hand */ }
        });
        $('mcp-new-key').addEventListener('click', async () => {
            info = await electron.mcp.newToken();
            render();
            $('mcp-status').textContent = t('Ключ заменён. Подключите ассистентов заново');
        });
        window.addEventListener('fgs-language', render);
        window.FgsStore.restored.then(apply);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
