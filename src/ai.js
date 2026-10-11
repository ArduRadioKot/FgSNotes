// Assistant: a chat that drops down over the editor. It talks to a local Ollama model (through the main process, see ollama.js),
// can attach the selection or the whole note to a message, keeps its history, and writes answers back into the note.
(function () {
    const api = window.electron;
    if (!api || !api.aiChat) return;

    const DEFAULT_URL = 'http://localhost:11434';
    const MAX_CONTEXT = 12000;
    const HISTORY_LIMIT = 24;            // messages sent to the model with each request
    const STORE = 'fgsnotes.chats.v1';
    const SYSTEM = 'Ты встроенный помощник Markdown-редактора FgSNotes. Отвечай по-русски, если пользователь не пишет на другом языке. Когда просят изменить, исправить, перевести или продолжить текст, верни только готовый результат в Markdown, без вступлений и пояснений. Когда задают вопрос, отвечай кратко и по делу. Текст заметки передаётся между тегами <текст>.';
    const ACTIONS = [
        { id: 'continue', label: 'Продолжить', before: true, prompt: 'Продолжи этот текст в том же стиле и формате. Верни только продолжение, без повтора исходного текста.' },
        { id: 'improve', label: 'Улучшить', prompt: 'Улучши стиль и ясность текста, сохрани смысл, язык и Markdown-разметку.' },
        { id: 'fix', label: 'Исправить ошибки', prompt: 'Исправь орфографию, пунктуацию и грамматику. Не меняй смысл и не добавляй ничего нового.' },
        { id: 'shorten', label: 'Сократить', prompt: 'Сократи текст вдвое, сохранив главное и Markdown-разметку.' },
        { id: 'translate', label: 'Перевести', prompt: 'Переведи текст: если он на русском — на английский, иначе на русский. Сохрани Markdown-разметку.' },
        { id: 'summary', label: 'Резюме', prompt: 'Сделай краткое резюме текста: 3–5 пунктов списка Markdown.' },
        { id: 'tasks', label: 'В задачи', prompt: 'Преврати текст в список задач Markdown (строки вида «- [ ] задача»).' },
        { id: 'title', label: 'Придумать заголовок', prompt: 'Придумай 5 коротких заголовков для этого текста, списком.' }
    ];

    const $ = (selector, root = document) => root.querySelector(selector);
    const settings = () => (window.FgsSettings && window.FgsSettings.get()) || {};
    // Providers. Local ones talk to a server on this computer; hosted ones send the text to the company and need an API key.
    const PROVIDERS = {
        ollama: { name: 'Ollama', local: true, url: true, urlKey: 'ai-url', urlDefault: DEFAULT_URL, modelKey: 'ai-model', wizard: true },
        lmstudio: { name: 'LM Studio', local: true, url: true, urlKey: 'ai-url-lmstudio', urlDefault: 'http://localhost:1234/v1', modelKey: 'ai-model-lmstudio', keyOptional: true, key: true, keyLink: 'https://lmstudio.ai' },
        openai: { name: 'OpenAI', key: true, modelKey: 'ai-model-openai', keyLink: 'https://platform.openai.com/api-keys' },
        anthropic: { name: 'Anthropic Claude', key: true, modelKey: 'ai-model-anthropic', keyLink: 'https://console.anthropic.com/settings/keys' },
        gemini: { name: 'Google Gemini', key: true, modelKey: 'ai-model-gemini', keyLink: 'https://aistudio.google.com/apikey' },
        openrouter: { name: 'OpenRouter', key: true, modelKey: 'ai-model-openrouter', keyLink: 'https://openrouter.ai/keys' },
        groq: { name: 'Groq', key: true, modelKey: 'ai-model-groq', keyLink: 'https://console.groq.com/keys' },
        custom: { name: 'Свой сервер', url: true, urlKey: 'ai-url-custom', urlDefault: '', modelKey: 'ai-model-custom', keyOptional: true, key: true }
    };
    const providerId = () => (PROVIDERS[settings()['ai-provider']] ? settings()['ai-provider'] : 'ollama');
    const cfg = () => PROVIDERS[providerId()];
    const serverUrl = () => cfg().url ? ((settings()[cfg().urlKey] || cfg().urlDefault || '').trim()) : '';
    const modelOf = () => (settings()[cfg().modelKey] || '').trim();
    const setModel = model => window.FgsSettings.update({ [cfg().modelKey]: model });
    let keyStatus = { keys: {}, secure: true };
    const refreshKeys = () => api.aiKeyStatus().then(status => { keyStatus = status; return status; }).catch(() => keyStatus);
    const hasKey = () => !!keyStatus.keys[providerId()];
    const privacy = () => cfg().local ? `Текст остаётся на этом компьютере: работает ${cfg().name}.` : `Текст заметки отправляется в ${cfg().name}. Не прикрепляйте то, что не хотите отдавать провайдеру.`;
    const format = number => number.toLocaleString('ru-RU');
    const stripThinking = text => text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').replace(/<think>[\s\S]*$/, '').replace(/^\s+/, '');
    // Answers are rendered from model output: images are dropped so a prompt-injected reply cannot make the app load remote URLs.
const md = text => parseMarkdown(text).replace(/<img [^>]*?alt="([^"]*)"[^>]*>/g, '$1');
    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const snippetOf = (text, length = 120) => { const flat = text.replace(/\s+/g, ' ').trim(); return flat.length > length ? flat.slice(0, length) + '…' : flat; };

    let panel, editor, chats, chat, running = null, unsubscribe = null;
    let ctxMode = 'auto';               // auto: the selection if there is one; note: the whole note; none: nothing

    // --- history ----------------------------------------------------------------------------------
    function loadChats() { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; } }
    function saveChats() {
        chats = chats.filter(item => item.messages.length).sort((a, b) => b.updated - a.updated).slice(0, 30);
        let json = JSON.stringify(chats);
        while (json.length > 2e6 && chats.length > 1) { chats.pop(); json = JSON.stringify(chats); }
        try { localStorage.setItem(STORE, json); } catch { /* storage full or unavailable: the chat still works until the app is closed */ }
    }
    function newChat() {
        chat = { id: uid(), title: 'Новый чат', updated: Date.now(), messages: [], lastCtx: '' };
        chats.unshift(chat);
        ctxMode = 'auto';
    }

    // --- editor access --------------------------------------------------------------------------
    function selectionContext() {
        const start = editor.selectionStart, end = editor.selectionEnd;
        if (end <= start) return null;
        const text = editor.value.slice(start, end);
        return { scope: 'selection', start, end, text: text.slice(0, MAX_CONTEXT), label: `Выделено · ${format(text.length)} симв.` };
    }
    function noteContext() {
        const text = editor.value;
        if (!text.trim()) return null;
        return { scope: 'note', start: 0, end: text.length, text: text.slice(0, MAX_CONTEXT), label: `Вся заметка · ${format(text.length)} симв.` };
    }
    function beforeContext() {
        const end = editor.selectionEnd, text = editor.value.slice(0, end);
        if (!text.trim()) return null;
        return { scope: 'before', start: end, end, text: text.slice(-MAX_CONTEXT), label: `Текст до курсора · ${format(text.length)} симв.` };
    }
    // What the next message would carry along. In "auto" mode a selection that is already in this chat is not attached twice.
    function pendingContext() {
        if (ctxMode === 'none') return null;
        if (ctxMode === 'note') return noteContext();
        const selection = selectionContext();
        return selection && selection.text !== chat.lastCtx ? selection : null;
    }
    function insertText(start, end, text) {
        editor.focus();
        editor.setSelectionRange(start, end);
        let done = false;
        // execCommand keeps the browser undo stack; the live editor has no real textarea behind it, so it takes the fallback.
        if (document.documentElement.dataset.live === undefined) { try { done = document.execCommand('insertText', false, text); } catch { done = false; } }
        if (!done) {
            editor.setRangeText(text, start, end, 'end');
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    // --- panel width ------------------------------------------------------------------------------
    const DEFAULT_WIDTH = 400, MIN_WIDTH = 300, WIDE = 640;
    let chatWidth = DEFAULT_WIDTH, restoreWidth = 0;
    try { chatWidth = Number(localStorage.getItem('fgsnotes.chat.width')) || DEFAULT_WIDTH; } catch { /* default */ }
    function setWidth(value, persist) {
        const stage = $('.editor-stage');
        const max = stage ? Math.max(MIN_WIDTH, stage.clientWidth * 0.65) : 720;
        chatWidth = Math.round(Math.min(max, Math.max(MIN_WIDTH, value)));
        $('.editor-container').style.setProperty('--ai-w', chatWidth + 'px');
        const wide = $('[data-head="wide"]', panel);
        if (wide) {
            const isWide = chatWidth >= WIDE - 8;
            wide.innerHTML = icon(isWide ? 'collapse' : 'expand');
            wide.setAttribute('aria-label', isWide ? 'Свернуть' : 'Развернуть');
        }
        if (persist) { try { localStorage.setItem('fgsnotes.chat.width', String(chatWidth)); } catch { /* ignore */ } }
    }
    function setupResize(divider, stage) {
        divider.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            divider.setPointerCapture(event.pointerId);
            divider.classList.add('dragging');
            document.body.classList.add('resizing');
            event.preventDefault();
        });
        divider.addEventListener('pointermove', event => {
            if (!divider.hasPointerCapture(event.pointerId)) return;
            // The chat is on the right: its width is the distance from the pointer to the stage's right edge.
            setWidth(stage.getBoundingClientRect().right - event.clientX - 4, false);
        });
        const stopDragging = () => {
            if (!divider.classList.contains('dragging')) return;
            divider.classList.remove('dragging');
            document.body.classList.remove('resizing');
            try { localStorage.setItem('fgsnotes.chat.width', String(chatWidth)); } catch { /* ignore */ }
        };
        divider.addEventListener('pointerup', event => { if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId); stopDragging(); });
        divider.addEventListener('lostpointercapture', stopDragging);
        divider.addEventListener('pointercancel', stopDragging);
        divider.addEventListener('dblclick', () => setWidth(DEFAULT_WIDTH, true));
        divider.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
            event.preventDefault();
            setWidth(event.key === 'Home' ? DEFAULT_WIDTH : chatWidth + (event.key === 'ArrowLeft' ? 20 : -20), true);
        });
        window.addEventListener('resize', () => { if (!panel.hidden) setWidth(chatWidth, false); });
    }

    // --- panel ------------------------------------------------------------------------------------
    function build() {
        panel = document.createElement('section');
        panel.className = 'ai-panel';
        panel.id = 'ai-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Чат с помощником');
        panel.hidden = true;
        panel.innerHTML = `
            <header class="ai-head">
                <span class="ai-avatar" aria-hidden="true">${icon('sparkles')}</span>
                <div class="ai-heading">
                    <strong class="ai-title">Помощник</strong>
                    <button type="button" class="ai-model" title="Сменить модель"><span class="ai-model-name"></span></button>
                </div>
                <button type="button" class="icon-button" data-head="history" aria-label="История чатов" title="История чатов">${icon('history')}</button>
                <button type="button" class="icon-button" data-head="new" aria-label="Новый чат" title="Новый чат">${icon('plus')}</button>
                <button type="button" class="icon-button" data-head="wide" aria-label="Развернуть" title="Развернуть">${icon('expand')}</button>
                <button type="button" class="icon-button" data-head="close" aria-label="Закрыть" title="Закрыть (Esc)">${icon('close')}</button>
            </header>
            <div class="ai-offline" hidden>
                <strong class="ai-offline-title"></strong>
                <p class="ai-offline-text"></p>
                <button type="button" class="button-primary" data-setup>Настроить Ollama</button>
            </div>
            <div class="ai-history" hidden></div>
            <div class="ai-scroll"></div>
            <div class="ai-composer">
                <div class="ai-attach"></div>
                <form class="ai-form">
                    <textarea rows="1" placeholder="Спросите о тексте или попросите его изменить" aria-label="Сообщение помощнику" spellcheck="true"></textarea>
                    <button type="submit" class="ai-send icon-button" aria-label="Отправить">${icon('send')}</button>
                </form>
            </div>`;
        // The chat is the third pane next to the editor and the preview: a stage holds the existing wrapper and the chat side by side.
        const wrapper = $('.editor-wrapper');
        const stage = document.createElement('div');
        stage.className = 'editor-stage';
        wrapper.parentNode.insertBefore(stage, wrapper);
        const divider = document.createElement('div');
        divider.className = 'chat-divider';
        divider.setAttribute('role', 'separator');
        divider.setAttribute('aria-orientation', 'vertical');
        divider.setAttribute('aria-label', 'Ширина чата');
        divider.tabIndex = 0;
        divider.title = 'Потяните для изменения ширины. Двойной щелчок — по умолчанию.';
        divider.hidden = true;
        stage.append(wrapper, divider, panel);
        setupResize(divider, stage);

        $('.ai-model', panel).addEventListener('click', () => setup());
        $('[data-setup]', panel).addEventListener('click', () => setup());
        $('.ai-head', panel).addEventListener('click', event => {
            const button = event.target.closest('[data-head]');
            if (!button) return;
            const action = button.dataset.head;
            if (action === 'close') close();
            else if (action === 'new') { if (!running) { if (chat.messages.length) newChat(); showHistory(false); render(); input().focus(); } }
            else if (action === 'history') showHistory($('.ai-history', panel).hidden);
            else if (action === 'wide') {
                // Expand: a wide chat; press again to go back to the width it had before.
                if (chatWidth < WIDE) { restoreWidth = chatWidth; setWidth(WIDE, true); } else setWidth(restoreWidth || DEFAULT_WIDTH, true);
            }
        });
        panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });

        $('.ai-scroll', panel).addEventListener('click', event => {
            const quick = event.target.closest('[data-action]');
            if (quick) return quickAction(ACTIONS.find(action => action.id === quick.dataset.action));
            const button = event.target.closest('[data-msg]');
            if (button) messageAction(Number(button.dataset.index), button.dataset.msg);
            const link = event.target.closest('[data-setup-link]');
            if (link) setup();
        });
        $('.ai-history', panel).addEventListener('click', event => {
            const remove = event.target.closest('[data-delete]');
            if (remove) { chats = chats.filter(item => item.id !== remove.dataset.delete); if (chat.id === remove.dataset.delete) newChat(); saveChats(); renderHistory(); render(); return; }
            const open = event.target.closest('[data-open]');
            if (open && !running) { chat = chats.find(item => item.id === open.dataset.open) || chat; ctxMode = 'none'; showHistory(false); render(); }
        });
        $('.ai-attach', panel).addEventListener('click', event => {
            const button = event.target.closest('[data-attach]');
            if (!button) return;
            ctxMode = button.dataset.attach;
            renderAttach();
            input().focus();
        });

        const form = $('.ai-form', panel);
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (running) return stop();
            const text = input().value.trim();
            if (!text) return;
            input().value = '';
            autosize();
            send(text, pendingContext());
        });
        input().addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } });
        input().addEventListener('input', autosize);
        function autosize() { input().style.height = 'auto'; input().style.height = Math.min(input().scrollHeight, 140) + 'px'; }

        for (const eventName of ['select', 'keyup', 'mouseup']) editor.addEventListener(eventName, () => { if (!panel.hidden && !running) renderAttach(); });
    }
    const input = () => $('textarea', panel);

    // --- rendering ----------------------------------------------------------------------------------
    function renderAttach() {
        const holder = $('.ai-attach', panel);
        const context = pendingContext();
        if (context) holder.innerHTML = `<span class="ai-chip-ctx"><span class="ai-chip-text"><b>${context.label}</b> ${escapeHtml(snippetOf(context.text, 70))}</span><button type="button" data-attach="none" aria-label="Не прикреплять" title="Не прикреплять">${icon('close')}</button></span>`;
        else holder.innerHTML = `<button type="button" class="ai-add" data-attach="note">${icon('plus')}<span>Вся заметка</span></button>`;
    }
    const escapeHtml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function messageHtml(message, index) {
        if (message.role === 'user') {
            const ctx = message.ctx ? `<div class="ai-ctx-card"><b>${message.ctx.label}</b><span>${escapeHtml(snippetOf(message.ctx.text, 160))}</span></div>` : '';
            return `<div class="ai-msg is-user">${ctx}<div class="ai-bubble">${escapeHtml(message.label || message.content)}</div></div>`;
        }
        const last = index === chat.messages.length - 1;
        const done = !(running && last);
        const body = message.content ? md(message.content) : '';
        const error = message.error ? `<div class="ai-error">${escapeHtml(message.error)} <button type="button" class="ai-link" data-setup-link>Настроить</button></div>` : '';
        const prev = chat.messages[index - 1];
        const canReplace = prev && prev.ctx && prev.ctx.scope === 'selection';
        const actions = done && message.content ? `<div class="ai-msg-actions">
            ${canReplace ? `<button type="button" data-msg="replace" data-index="${index}">Заменить</button>` : ''}
            <button type="button" data-msg="insert" data-index="${index}">Вставить</button>
            <button type="button" data-msg="copy" data-index="${index}">Копировать</button>
            ${last ? `<button type="button" data-msg="retry" data-index="${index}">Ещё раз</button>` : ''}</div>` : '';
        const waiting = !done && !message.content ? ' is-waiting' : '';
        return `<div class="ai-msg is-ai"><div class="ai-bubble md${waiting}">${body}</div>${error}${actions}</div>`;
    }
    function render() {
        const scroll = $('.ai-scroll', panel);
        $('.ai-title', panel).textContent = chat.messages.length ? chat.title : 'Помощник';
        if (!chat.messages.length) {
            scroll.innerHTML = `<div class="ai-empty"><h3>Чем помочь?</h3><p>Выделите текст и нажмите ${isMac() ? '⌘' : 'Ctrl'} J — он прикрепится к сообщению. Или выберите действие.</p><div class="ai-chips">${ACTIONS.map(action => `<button type="button" class="ai-chip" data-action="${action.id}">${action.label}</button>`).join('')}</div><p class="ai-privacy${cfg().local ? '' : ' is-cloud'}">${escapeHtml(privacy())}</p></div>`;
        } else {
            scroll.innerHTML = chat.messages.map(messageHtml).join('');
            if (window.renderMath) window.renderMath(scroll);
            scroll.scrollTop = scroll.scrollHeight;
        }
        renderAttach();
        $('.ai-model-name', panel).textContent = (cfg().local && providerId() === 'ollama' ? '' : cfg().name + ' · ') + (modelOf() || 'модель не выбрана');
    }
    const isMac = () => /Mac/i.test(navigator.platform);

    function showHistory(show) {
        $('.ai-history', panel).hidden = !show;
        $('.ai-scroll', panel).hidden = show;
        $('.ai-composer', panel).hidden = show;
        if (show) renderHistory();
    }
    function renderHistory() {
        const list = chats.filter(item => item.messages.length);
        const ago = time => { const minutes = Math.round((Date.now() - time) / 60000); return minutes < 1 ? 'только что' : minutes < 60 ? `${minutes} мин назад` : minutes < 1440 ? `${Math.round(minutes / 60)} ч назад` : new Date(time).toLocaleDateString('ru-RU'); };
        $('.ai-history', panel).innerHTML = list.length ? list.map(item => `
            <div class="ai-history-row${item.id === chat.id ? ' is-current' : ''}">
                <button type="button" class="ai-history-open" data-open="${item.id}"><strong>${escapeHtml(item.title)}</strong><small>${ago(item.updated)} · сообщений: ${item.messages.length}</small></button>
                <button type="button" class="icon-button" data-delete="${item.id}" aria-label="Удалить чат" title="Удалить">${icon('trash')}</button>
            </div>`).join('') : '<p class="ai-history-empty">Пока нет сохранённых чатов.</p>';
    }

    function setRunning(value) {
        running = value;
        const send = $('.ai-send', panel);
        send.innerHTML = icon(value ? 'stop' : 'send');
        send.setAttribute('aria-label', value ? 'Остановить' : 'Отправить');
        send.classList.toggle('is-stop', !!value);
        panel.classList.toggle('is-running', !!value);
    }

    // --- connection ---------------------------------------------------------------------------------
    async function checkConnection() {
        await refreshKeys();
        let ready, title, text, button = 'Настроить';
        if (providerId() === 'ollama') {
            const [found, install] = await Promise.all([api.aiModels({ provider: 'ollama', url: serverUrl() }), api.aiDetect()]);
            ready = found.ok && found.models.length > 0;
            [title, text] = !install.installed && !found.ok ? ['Ollama не установлена', 'Нужна бесплатная программа Ollama: она запускает модели на вашем компьютере. Установка займёт пару минут.']
                : !found.ok ? ['Ollama не запущена', 'Ollama установлена, но не работает. Запустите её, и помощник заработает.']
                : ['Нет ни одной модели', 'Ollama работает, но модель ещё не скачана. Выберите её в настройке.'];
            button = 'Настроить Ollama';
        } else {
            const needKey = cfg().key && !cfg().keyOptional;
            ready = (!needKey || hasKey()) && (!cfg().url || !!serverUrl());
            [title, text] = needKey && !hasKey() ? [`Нужен ключ ${cfg().name}`, 'Добавьте ключ API в настройках. Он хранится только на этом компьютере и никогда не показывается в окне.']
                : ['Не указан адрес сервера', 'Впишите адрес сервера в настройках.'];
            button = 'Открыть настройки';
        }
        $('.ai-offline', panel).hidden = ready;
        $('.ai-scroll', panel).hidden = !ready || !$('.ai-history', panel).hidden;
        $('.ai-composer', panel).hidden = !ready || !$('.ai-history', panel).hidden;
        if (!ready) {
            $('.ai-offline-title', panel).textContent = title;
            $('.ai-offline-text', panel).textContent = text;
            $('[data-setup]', panel).textContent = button;
        }
        return ready;
    }
    // Ollama has a guided installer; the other providers are configured in the settings.
    function setup() {
        if (providerId() !== 'ollama') { if (window.FgsSettings) window.FgsSettings.open('ai'); return; }
        if (!window.FgsAiSetup) return;
        window.FgsAiSetup.open({ onDone: () => { checkConnection().then(() => { render(); if (!panel.hidden) input().focus(); }); } });
    }
    // Ollama: the saved model may have been removed, so fall back to an installed one. Others: the saved model, or the first of a local server.
    async function ensureModel() {
        if (providerId() === 'ollama') {
            const found = await api.aiModels({ provider: 'ollama', url: serverUrl() });
            if (!found.ok) throw new Error(found.error);
            if (!found.models.length) throw new Error('В Ollama нет моделей.');
            let model = modelOf();
            if (!model || !found.models.includes(model)) { model = found.models[0]; setModel(model); }
            return model;
        }
        let model = modelOf();
        if (!model && (cfg().local || cfg().keyOptional)) {
            const found = await api.aiModels({ provider: providerId(), url: serverUrl() });
            if (found.ok && found.models.length) { model = found.models[0]; setModel(model); }
        }
        if (!model) throw new Error('Выберите модель в настройках → ИИ.');
        return model;
    }

    // --- messages -----------------------------------------------------------------------------------
    function modelMessages() {
        const history = chat.messages.filter(message => message.role === 'user' || message.content).slice(-HISTORY_LIMIT);
        return [{ role: 'system', content: SYSTEM }, ...history.map(message => message.role === 'user'
            ? { role: 'user', content: message.content + (message.ctx ? '\n\n<текст>\n' + message.ctx.text + '\n</текст>' : '') }
            : { role: 'assistant', content: message.content })];
    }
    function send(text, ctx, label) {
        if (running) return;
        showHistory(false);
        chat.messages.push({ role: 'user', content: text, label: label || '', ctx: ctx || null });
        if (ctx) chat.lastCtx = ctx.text;
        if (chat.title === 'Новый чат') chat.title = snippetOf(label || text, 40);
        ctxMode = 'auto';
        run();
    }
    function quickAction(action) {
        if (running || !action) return;
        const ctx = action.before ? beforeContext() : (pendingContext() || selectionContext() || noteContext());
        send(action.prompt, ctx, action.label);
    }
    async function run() {
        const id = uid();
        chat.messages.push({ role: 'assistant', content: '' });
        const message = chat.messages.at(-1);
        const request = modelMessages();
        chat.updated = Date.now();
        setRunning(id);
        render();
        let raw = '';
        let frame = 0;
        const bubble = () => $('.ai-msg:last-child .ai-bubble', panel);
        const draw = () => {
            frame = 0;
            const node = bubble();
            if (!node) return;
            node.classList.remove('is-waiting');
            node.innerHTML = md(message.content);
            if (window.renderMath) window.renderMath(node);
            const scroll = $('.ai-scroll', panel);
            scroll.scrollTop = scroll.scrollHeight;
        };
        unsubscribe && unsubscribe();
        unsubscribe = api.onAiChunk(chunk => {
            if (chunk.id !== id || !chunk.delta) return;
            raw += chunk.delta;
            message.content = stripThinking(raw);
            if (message.content && !frame) frame = requestAnimationFrame(draw);
        });
        try {
            const model = await ensureModel();
            const result = await api.aiChat({ id, provider: providerId(), url: serverUrl(), model, messages: request });
            if (!result.ok && !result.aborted) throw new Error(result.error);
        } catch (error) {
            message.error = error.message;
        } finally {
            unsubscribe && unsubscribe();
            unsubscribe = null;
            if (frame) cancelAnimationFrame(frame);
            if (!message.content && !message.error) chat.messages.pop();      // stopped before the first word
            setRunning(null);
            chat.updated = Date.now();
            saveChats();
            if (!panel.hidden) render();
        }
    }
    function stop() { if (running) api.aiAbort(running); }

    function messageAction(index, kind) {
        const message = chat.messages[index];
        if (!message || !message.content) return;
        if (kind === 'retry') {
            if (running) return;
            chat.messages.splice(index, 1);
            return run();
        }
        if (kind === 'copy') { navigator.clipboard.writeText(message.content).catch(() => {}); flash(index, 'Скопировано'); return; }
        const ctx = chat.messages[index - 1] && chat.messages[index - 1].ctx;
        const doc = editor.value;
        const selected = ctx && ctx.scope === 'selection';
        // The note may have changed while the model was writing: use the saved range only if its text is still there.
        const stale = selected && doc.slice(ctx.start, ctx.end) !== ctx.text;
        const replacing = kind === 'replace' && selected && !stale;
        const from = replacing ? ctx.start : ctx && !stale && ctx.scope !== 'note' ? ctx.end : editor.selectionEnd;
        const to = replacing ? ctx.end : from;
        let text = message.content.trim();
        if (!replacing) {
            const before = doc.slice(0, from);
            if (before && ctx && ctx.scope === 'before') { if (!/\s$/.test(before)) text = ' ' + text; }
            else if (before) text = (before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n') + text;
        }
        insertText(from, to, text);
        flash(index, replacing ? 'Заменено' : 'Вставлено');
    }
    function flash(index, label) {
        const button = $(`[data-msg][data-index="${index}"]`, panel);
        if (!button) return;
        const was = button.textContent;
        button.textContent = label;
        setTimeout(() => { if (button.isConnected) button.textContent = was; }, 1200);
    }

    // --- open / close -------------------------------------------------------------------------------
    function open() {
        if (!panel) { chats = loadChats(); newChatIfNeeded(); build(); }
        panel.hidden = false;
        $('.chat-divider').hidden = false;
        $('.editor-container').classList.add('has-chat');
        setWidth(chatWidth, false);
        $('#ai-button').setAttribute('aria-expanded', 'true');
        showHistory(false);
        render();
        input().focus();
        checkConnection().then(ready => { if (!ready) $('[data-setup]', panel).focus(); });
    }
    // A chat that has been idle for a while is not worth continuing: a hotkey press starts a fresh one.
    function newChatIfNeeded() {
        const latest = chats.filter(item => item.messages.length).sort((a, b) => b.updated - a.updated)[0];
        if (latest && Date.now() - latest.updated < 30 * 60 * 1000) { chat = latest; ctxMode = 'auto'; } else newChat();
    }
    function close() {
        if (!panel || panel.hidden) return;
        stop();
        panel.hidden = true;
        $('.chat-divider').hidden = true;
        $('.editor-container').classList.remove('has-chat');
        $('#ai-button').setAttribute('aria-expanded', 'false');
        editor.focus();
    }
    // The hotkey: closed → open the chat with the selection attached; open but focus is in the note → jump to the field; focus in the chat → close.
    function hotkey() {
        if (document.documentElement.dataset.ai !== 'on') return;
        if (!panel || panel.hidden) return open();
        if (panel.contains(document.activeElement)) return close();
        ctxMode = ctxMode === 'none' ? 'none' : 'auto';
        renderAttach();
        input().focus();
    }

    // --- settings panel -----------------------------------------------------------------------------
    let shownProvider = null, loadId = 0;
    function syncProviderUI() {
        const info = cfg(), id = providerId();
        $('#ai-privacy').textContent = privacy();
        $('#ai-privacy').classList.toggle('is-cloud', !info.local);
        $('#ai-row-url').hidden = !info.url;
        $('#ai-url-hint').textContent = id === 'ollama' ? 'По умолчанию сервер слушает http://localhost:11434' : id === 'lmstudio' ? 'Включите локальный сервер в LM Studio (по умолчанию http://localhost:1234/v1)' : 'Адрес вида https://хост/v1: подойдёт любой сервер с API как у OpenAI';
        $('#ai-url-field').placeholder = info.urlDefault || 'https://example.com/v1';
        $('#ai-url-field').value = settings()[info.urlKey] || (id === 'custom' ? '' : info.urlDefault);
        $('#ai-row-key').hidden = !info.key;
        $('#ai-row-wizard').hidden = !info.wizard;
        $('#ai-model-field').value = modelOf();
        const has = hasKey();
        $('#ai-key-status').textContent = has ? (keyStatus.secure ? 'Ключ сохранён и зашифрован системой. Показать его нельзя.' : 'Ключ сохранён на этом компьютере в обычном файле: системного шифрования здесь нет.') : (info.keyOptional ? 'Необязательно: нужен, только если сервер просит ключ.' : 'Ключ хранится только на этом компьютере.');
        $('#ai-key-clear').hidden = !has;
        $('#ai-key-field').placeholder = has ? 'Ключ сохранён — вставьте новый, чтобы заменить' : 'Вставьте ключ';
        $('#ai-note').innerHTML = info.keyLink ? `Ключ можно получить на <a href="${info.keyLink}" data-external>${new URL(info.keyLink).hostname}</a>. Оплату запросов ведёт сам провайдер.` : id === 'ollama' ? 'Нет Ollama? Мастер установит её и скачает модель. Список моделей берётся с вашего сервера.' : '';
    }
    async function refreshModels() {
        const status = $('#ai-status'), list = $('#ai-model-list');
        if (!status) return;
        const mine = ++loadId, id = providerId();
        await refreshKeys();
        syncProviderUI();
        status.className = 'setting-desc';
        list.replaceChildren();
        if (cfg().key && !cfg().keyOptional && !hasKey()) { status.textContent = 'Сначала сохраните ключ API.'; return; }
        status.textContent = 'Проверяю подключение…';
        const result = await api.aiModels({ provider: id, url: serverUrl() });
        if (mine !== loadId) return;                       // the provider was switched while the request was running
        const names = result.ok ? result.models : [];
        list.replaceChildren(...names.map(name => Object.assign(document.createElement('option'), { value: name })));
        if (!result.ok) { status.classList.add('is-error'); status.textContent = result.error + (id === 'ollama' ? '' : ' Имя модели можно вписать вручную.'); }
        else if (!names.length) { status.classList.add('is-error'); status.textContent = id === 'ollama' ? 'Подключено, но моделей нет. Откройте мастер и скачайте модель.' : 'Подключено, но сервер не вернул моделей. Впишите имя вручную.'; }
        else {
            status.classList.add('is-ok');
            status.textContent = `Подключено · моделей: ${names.length}`;
            if (!modelOf() && (cfg().local || id === 'ollama')) { setModel(names[0]); $('#ai-model-field').value = names[0]; }
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        editor = $('#markdown-editor');
        $('#ai-button').addEventListener('click', () => { if (!panel || panel.hidden) open(); else close(); });
        document.addEventListener('keydown', event => {
            if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'j') { event.preventDefault(); hotkey(); }
        });
        $('#ai-url-field').addEventListener('change', () => {
            const value = $('#ai-url-field').value.trim();
            window.FgsSettings.update({ [cfg().urlKey]: value || cfg().urlDefault || '' });
            if (providerId() === 'ollama') setModel('');
            refreshModels();
        });
        $('#ai-model-field').addEventListener('change', () => { setModel($('#ai-model-field').value.trim()); if (panel && !panel.hidden) render(); });
        $('#ai-refresh').addEventListener('click', refreshModels);
        $('#ai-setup-open').addEventListener('click', () => window.FgsAiSetup && window.FgsAiSetup.open({ onDone: refreshModels }));
        const saveKey = async () => {
            const field = $('#ai-key-field');
            if (!field.value.trim()) return field.focus();
            keyStatus = await api.aiKeySet(providerId(), field.value);
            field.value = '';
            await refreshModels();
        };
        $('#ai-key-save').addEventListener('click', saveKey);
        $('#ai-key-field').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); saveKey(); } });
        $('#ai-key-clear').addEventListener('click', async () => { keyStatus = await api.aiKeyClear(providerId()); await refreshModels(); });
        $('#settings-button').addEventListener('click', () => setTimeout(() => {
            if ($('.settings-nav-item[data-settings-section="ai"]').classList.contains('is-active')) refreshModels();
        }, 0));
        $('.settings-nav-item[data-settings-section="ai"]').addEventListener('click', refreshModels);
        window.addEventListener('fgs-settings', () => {
            if (document.documentElement.dataset.ai !== 'on') close();
            // A different provider was picked: show its fields and look at its models.
            if (shownProvider !== null && shownProvider !== providerId()) {
                shownProvider = providerId();
                refreshModels();
                if (panel && !panel.hidden) checkConnection().then(() => render());
            }
            shownProvider = providerId();
        });
        syncProviderUI();
    });
})();
