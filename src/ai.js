// Assistant: a chat next to the editor (a full-screen sheet on a phone). On desktop it talks to the models through the main process
// (ollama.js, providers.js); in the phone app it calls the same providers from the web view (ai/web-backend.js).
// It can attach the selection or the whole note to a message, keeps its history, and writes answers back into the note.
(function () {
    const desktop = !!(window.electron && window.electron.aiChat);
    const api = desktop ? window.electron : window.FgsAiWeb;
    if (!api) return;

    const DEFAULT_URL = 'http://localhost:11434';
    const MAX_CONTEXT = 200000;          // characters of the note attached to a message: effectively no limit
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
        device: { name: 'На телефоне', local: true, device: true, modelKey: 'ai-model-device' },
        custom: { name: 'Свой сервер', url: true, urlKey: 'ai-url-custom', urlDefault: '', modelKey: 'ai-model-custom', keyOptional: true, key: true }
    };
    // A phone has no local models: they live on a computer, and the app does not reach into it. A saved Ollama/LM Studio choice
    // (the same settings file can come from a computer) falls back to OpenAI there.
    const providerId = () => {
        const id = settings()['ai-provider'];
        if (!PROVIDERS[id]) return desktop ? 'ollama' : 'openai';
        if (desktop && PROVIDERS[id].device) return 'ollama';                       // on-device models exist only in the phone app
        if (!desktop && PROVIDERS[id].local && !PROVIDERS[id].device) return 'openai';
        return id;
    };
    const cfg = () => PROVIDERS[providerId()];
    const serverUrl = () => cfg().url ? ((settings()[cfg().urlKey] || cfg().urlDefault || '').trim()) : '';
    const modelOf = () => (settings()[cfg().modelKey] || '').trim();
    // The on-device models have short ids; the chat shows their names.
    const modelLabel = () => { const id = modelOf(); const found = cfg().device && api.device && api.device.catalog.find(entry => entry.id === id); return found ? found.title : id; };
    const setModel = model => window.FgsSettings.update({ [cfg().modelKey]: model });
    let keyStatus = { keys: {}, secure: true };
    const refreshKeys = () => api.aiKeyStatus().then(status => { keyStatus = status; return status; }).catch(() => keyStatus);
    const hasKey = () => !!keyStatus.keys[providerId()];
    const privacy = () => cfg().device ? 'Текст не покидает телефон: модель работает прямо на устройстве, интернет не нужен.' : cfg().local ? `Текст остаётся на этом компьютере: работает ${cfg().name}.` : `Текст заметки отправляется в ${cfg().name}. Не прикрепляйте то, что не хотите отдавать провайдеру.`;
    const format = number => number.toLocaleString('ru-RU');
    // Some models put their reasoning inline as <think>…</think>: split it from the answer.
    const splitInline = raw => { let thinking = ''; const answer = raw.replace(/<think>([\s\S]*?)(?:<\/think>|$)\s*/g, (all, thought) => { thinking += thought; return ''; }).replace(/^\s+/, ''); return { thinking, answer }; };
    const stripThinking = text => text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').replace(/<think>[\s\S]*$/, '').replace(/^\s+/, '');
    // Answers are rendered from model output: images are dropped so a prompt-injected reply cannot make the app load remote URLs.
const md = text => parseMarkdown(text).replace(/<img [^>]*?alt="([^"]*)"[^>]*>/g, '$1');
    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const snippetOf = (text, length = 120) => { const flat = text.replace(/\s+/g, ' ').trim(); return flat.length > length ? flat.slice(0, length) + '…' : flat; };

    let panel, editor, chats, chat, running = null, unsubscribe = null;
    let editing = -1;                   // index of the message being edited
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
        panel.setAttribute('aria-label', 'Чат');
        panel.hidden = true;
        panel.innerHTML = `
            <header class="ai-head">
                <span class="ai-avatar" aria-hidden="true">${icon('sparkles')}</span>
                <div class="ai-heading">
                    <strong class="ai-title">Чат</strong>
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
                    <textarea rows="1" placeholder="Спросите о тексте или попросите его изменить" aria-label="Сообщение в чат" spellcheck="true"></textarea>
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
        // Remember whether the person opened or folded the model's thoughts (only their own clicks count, not the automatic fold).
        $('.ai-scroll', panel).addEventListener('click', event => {
            const summary = event.target.closest('.ai-think summary');
            const message = summary && chat.messages[Number(summary.parentElement.dataset.index)];
            if (message) message.thinkOpen = !summary.parentElement.open;       // the click is about to flip it
        });
        $('.ai-scroll', panel).addEventListener('keydown', event => {
            if (!event.target.matches('.ai-edit textarea')) return;
            if (event.key === 'Escape') { event.stopPropagation(); messageAction(editing, 'edit-cancel'); }
            else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); messageAction(editing, 'edit-save'); }
        });
        $('.ai-history', panel).addEventListener('click', event => {
            const remove = event.target.closest('[data-delete]');
            if (remove) { chats = chats.filter(item => item.id !== remove.dataset.delete); if (chat.id === remove.dataset.delete) newChat(); saveChats(); renderHistory(); render(); return; }
            const open = event.target.closest('[data-open]');
            if (open && !running) { chat = chats.find(item => item.id === open.dataset.open) || chat; ctxMode = 'none'; showHistory(false); render(); }
        });
        $('.ai-attach', panel).addEventListener('click', event => {
            if (event.target.closest('[data-think]')) {
                window.FgsSettings.update({ 'ai-thinking': settings()['ai-thinking'] === 'off' ? 'on' : 'off' });
                renderAttach();
                return;
            }
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
        const thinking = settings()['ai-thinking'] !== 'off';
        const toggle = `<button type="button" class="ai-think-toggle${thinking ? ' is-on' : ''}" data-think aria-pressed="${thinking}" title="${thinking ? 'Модель рассуждает перед ответом: ход мыслей виден. Нажмите, чтобы отключить' : 'Рассуждения выключены: модель отвечает сразу. Нажмите, чтобы включить'}">${icon('bulb')}<span>Мысли${thinking ? '' : ': выкл'}</span></button>`;
        if (context) holder.innerHTML = `<span class="ai-chip-ctx"><span class="ai-chip-text"><b>${context.label}</b> ${escapeHtml(snippetOf(context.text, 70))}</span><button type="button" data-attach="none" aria-label="Не прикреплять" title="Не прикреплять">${icon('close')}</button></span>${toggle}`;
        else holder.innerHTML = `<button type="button" class="ai-add" data-attach="note">${icon('plus')}<span>Вся заметка</span></button>${toggle}`;
    }
    const escapeHtml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // "Думает…" with three dots that light up one after another, side by side.
    const WAITING = 'Думает<span class="ai-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
    function messageHtml(message, index) {
        if (message.role === 'user') {
            if (editing === index) {
                return `<div class="ai-msg is-user"><div class="ai-edit"><textarea rows="3" aria-label="Изменить сообщение">${escapeHtml(message.content)}</textarea><div class="ai-edit-actions"><button type="button" class="button-secondary" data-msg="edit-cancel" data-index="${index}">Отмена</button><button type="button" class="button-primary" data-msg="edit-save" data-index="${index}">Отправить заново</button></div></div></div>`;
            }
            const ctx = message.ctx ? `<div class="ai-ctx-card"><b>${message.ctx.label}</b><span>${escapeHtml(snippetOf(message.ctx.text, 160))}</span></div>` : '';
            const edit = running ? '' : `<button type="button" class="ai-edit-button" data-msg="edit" data-index="${index}" aria-label="Изменить сообщение" title="Изменить и отправить заново">${icon('edit')}</button>`;
            return `<div class="ai-msg is-user">${ctx}<div class="ai-bubble-row">${edit}<div class="ai-bubble">${escapeHtml(message.label || message.content)}</div></div></div>`;
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
        const waiting = !done && !message.content && !message.thinking ? ' is-waiting' : '';
        // Reasoning: open while the model is still thinking, folded once the answer starts (unless the person toggled it).
        const thinkingNow = !done && !message.content;
        const open = message.thinkOpen !== undefined ? message.thinkOpen : thinkingNow;
        const thoughts = message.thinking ? `<details class="ai-think" data-index="${index}"${open ? ' open' : ''}><summary>${thinkingNow ? WAITING : 'Мысли модели'}</summary><div class="ai-think-body">${escapeHtml(message.thinking.trim())}</div></details>` : '';
        const bubble = body || waiting || !message.thinking ? `<div class="ai-bubble md${waiting}">${waiting ? WAITING : body}</div>` : '';
        return `<div class="ai-msg is-ai">${thoughts}${bubble}${error}${actions}</div>`;
    }
    function render() {
        const scroll = $('.ai-scroll', panel);
        $('.ai-title', panel).textContent = chat.messages.length ? chat.title : 'Чат';
        if (!chat.messages.length) {
            scroll.innerHTML = `<div class="ai-empty"><h3>Чем помочь?</h3><p>${desktop ? `Выделите текст и нажмите ${isMac() ? '⌘' : 'Ctrl'} J` : 'Выделите текст в заметке'} — он прикрепится к сообщению. Или выберите действие.</p><div class="ai-chips">${ACTIONS.map(action => `<button type="button" class="ai-chip" data-action="${action.id}">${action.label}</button>`).join('')}</div><p class="ai-privacy${cfg().local ? '' : ' is-cloud'}">${escapeHtml(privacy())}</p></div>`;
        } else {
            scroll.innerHTML = chat.messages.map(messageHtml).join('');
            if (window.renderMath) window.renderMath(scroll);
            scroll.scrollTop = scroll.scrollHeight;
        }
        renderAttach();
        $('.ai-model-name', panel).textContent = (providerId() === 'ollama' ? '' : cfg().name + ' · ') + (modelLabel() || 'модель не выбрана');
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
                : !found.ok ? ['Ollama не запущена', 'Ollama установлена, но не работает. Запустите её, и чат заработает.']
                : ['Нет ни одной модели', 'Ollama работает, но модель ещё не скачана. Выберите её в настройке.'];
            button = 'Настроить Ollama';
        } else if (cfg().device) {
            const have = api.device ? api.device.ready() : {};
            ready = !!have[modelOf()] || Object.keys(have).length > 0;
            [title, text] = ['Модель не скачана', 'Скачайте небольшую модель: она будет работать прямо на телефоне, без интернета и без отправки текста.'];
            button = 'Открыть настройки';
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
        if (providerId() !== 'ollama') { if (!desktop) close(); if (window.FgsSettings) window.FgsSettings.open('ai'); return; }
        // The guided installer is for the computer; on a phone Ollama is reached over the network, so the settings are the place.
        // On a phone the chat is a full-screen sheet over the app: close it first, or the settings would open underneath.
        if (!window.FgsAiSetup || !desktop) { if (!desktop) close(); if (window.FgsSettings) window.FgsSettings.open('ai'); return; }
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
        if (cfg().device) {
            const have = api.device.ready();
            let model = modelOf();
            if (!have[model]) { model = Object.keys(have)[0]; if (model) setModel(model); }
            if (!model) throw new Error('Модель не скачана. Откройте Настройки → ИИ и скачайте её.');
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
        chat.messages.push({ role: 'assistant', content: '', thinking: '' });
        const message = chat.messages.at(-1);
        const request = modelMessages();
        chat.updated = Date.now();
        setRunning(id);
        render();
        let raw = '', channel = '';
        let frame = 0;
        const draw = () => {
            frame = 0;
            const scroll = $('.ai-scroll', panel);
            const node = scroll.lastElementChild;
            if (!node || !node.classList.contains('is-ai')) return;
            const stick = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
            node.outerHTML = messageHtml(message, chat.messages.length - 1);
            if (window.renderMath) window.renderMath(scroll.lastElementChild);
            if (stick) scroll.scrollTop = scroll.scrollHeight;
        };
        const update = () => {
            const split = splitInline(raw);
            // Small models sometimes echo the <текст> wrapper the request used: it is not part of the answer.
            message.content = split.answer.replace(/^\s*<текст>\s*/, '').replace(/\s*<\/текст>\s*$/, '');
            message.thinking = channel + split.thinking;
            if (!frame) frame = requestAnimationFrame(draw);
        };
        unsubscribe && unsubscribe();
        unsubscribe = api.onAiChunk(chunk => {
            if (chunk.id !== id) return;
            if (typeof chunk.thinking === 'string') channel += chunk.thinking;
            if (chunk.delta) raw += chunk.delta;
            if (chunk.thinking || chunk.delta) update();
        });
        try {
            const model = await ensureModel();
            const result = await api.aiChat({ id, provider: providerId(), url: serverUrl(), model, messages: request, think: settings()['ai-thinking'] !== 'off' });
            if (!result.ok && !result.aborted) throw new Error(result.error);
        } catch (error) {
            message.error = error.message;
        } finally {
            unsubscribe && unsubscribe();
            unsubscribe = null;
            if (frame) cancelAnimationFrame(frame);
            if (!message.content && !message.thinking && !message.error) chat.messages.pop();      // stopped before the first word
            if (!message.thinking) delete message.thinking;
            setRunning(null);
            chat.updated = Date.now();
            saveChats();
            if (!panel.hidden) render();
        }
    }
    function stop() { if (running) api.aiAbort(running); }

    function messageAction(index, kind) {
        if (kind === 'edit') {
            if (running) return;
            editing = index;
            render();
            const field = $('.ai-edit textarea', panel);
            if (field) { field.focus(); field.setSelectionRange(field.value.length, field.value.length); field.style.height = field.scrollHeight + 'px'; }
            return;
        }
        if (kind === 'edit-cancel') { editing = -1; render(); return; }
        if (kind === 'edit-save') {
            const field = $('.ai-edit textarea', panel);
            const text = field && field.value.trim();
            if (!text || running || !chat.messages[index]) return;
            // Everything after the edited message belonged to the old wording: drop it and ask again.
            chat.messages.length = index + 1;
            Object.assign(chat.messages[index], { content: text, label: '' });
            editing = -1;
            chat.updated = Date.now();
            run();
            return;
        }
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
        $('#ai-url-hint').textContent = id === 'ollama' ? 'По умолчанию сервер слушает http://localhost:11434' : id === 'lmstudio' ? 'Включите локальный сервер в LM Studio (по умолчанию http://localhost:1234/v1)' : (desktop ? 'Адрес вида https://хост/v1: подойдёт любой сервер с API как у OpenAI' : 'Адрес вида https://хост/v1: подойдёт любой сервер с API как у OpenAI. Работает только https');
        $('#ai-url-field').placeholder = info.urlDefault || 'https://example.com/v1';
        $('#ai-url-field').value = settings()[info.urlKey] || (id === 'custom' ? '' : info.urlDefault);
        $('#ai-provider').value = id;
        const onDevice = !!info.device;
        $('#ai-row-device').hidden = !onDevice;
        $('#ai-row-model').hidden = onDevice;
        if (onDevice && window.FgsDeviceUI) window.FgsDeviceUI.mount($('#ai-device-list'), $('#ai-device-hint'));
        $('#ai-row-key').hidden = !info.key;
        $('#ai-row-wizard').hidden = !info.wizard;
        $('#ai-model-field').value = modelOf();
        const has = hasKey();
        $('#ai-key-status').textContent = has ? (keyStatus.secure ? 'Ключ сохранён и зашифрован системой. Показать его нельзя.' : desktop ? 'Ключ сохранён на этом компьютере в обычном файле: системного шифрования здесь нет.' : 'Ключ сохранён внутри приложения, другие программы его не видят. Системного шифрования на телефоне здесь нет.') : (info.keyOptional ? 'Необязательно: нужен, только если сервер просит ключ.' : 'Ключ хранится только на этом компьютере.');
        $('#ai-key-clear').hidden = !has;
        $('#ai-key-field').placeholder = has ? 'Ключ сохранён — вставьте новый, чтобы заменить' : 'Вставьте ключ';
        $('#ai-note').innerHTML = onDevice ? 'Модели работают на процессоре или графическом ускорителе телефона. Маленькие модели хороши для коротких правок и ошибаются в сложных задачах. Не закрывайте приложение, пока идёт скачивание.' : info.keyLink ? `Ключ можно получить на <a href="${info.keyLink}" data-external>${new URL(info.keyLink).hostname}</a>. Оплату запросов ведёт сам провайдер.` : id === 'ollama' ? 'Нет Ollama? Мастер установит её и скачает модель. Список моделей берётся с вашего сервера.' : '';
    }
    async function refreshModels(event) {
        const fromButton = !!(event && event.currentTarget && event.currentTarget.id === 'ai-refresh');
        const status = $('#ai-status');
        if (!status) return;
        const mine = ++loadId, id = providerId();
        await refreshKeys();
        syncProviderUI();
        if (cfg().device) { status.textContent = ''; setModelNames([]); return; }
        status.className = 'setting-desc';
        setModelNames([]);
        if (cfg().key && !cfg().keyOptional && !hasKey()) { status.textContent = 'Сначала сохраните ключ API.'; return; }
        status.textContent = 'Проверяю подключение…';
        const result = await api.aiModels({ provider: id, url: serverUrl() });
        if (mine !== loadId) return;                       // the provider was switched while the request was running
        const names = result.ok ? result.models : [];
        setModelNames(names);
        if (!result.ok) { status.classList.add('is-error'); status.textContent = result.error + (id === 'ollama' ? '' : ' Имя модели можно вписать вручную.'); }
        else if (!names.length) { status.classList.add('is-error'); status.textContent = id === 'ollama' ? 'Подключено, но моделей нет. Откройте мастер и скачайте модель.' : 'Подключено, но сервер не вернул моделей. Впишите имя вручную.'; }
        else {
            status.classList.add('is-ok');
            status.textContent = `Подключено · моделей: ${names.length}`;
            if (!modelOf() && (cfg().local || id === 'ollama')) { setModel(names[0]); $('#ai-model-field').value = names[0]; }
            // Pressing «Обновить» shows what the server has right away, even when a model is already chosen.
            if (fromButton) { $('#ai-model-field').focus(); openModelMenu(true); }
        }
    }

    // --- model picker: the whole list from the server, filtered only by what the person types -------------------------------------
    // (A <datalist> filters by the field's current value, so with a model chosen it offered just that one model.)
    let modelNames = [], menuActive = -1, menuFilter = false;
    function setModelNames(names) { modelNames = names; if (!$('#ai-model-menu').hidden) drawModelMenu(); }
    function drawModelMenu() {
        const field = $('#ai-model-field'), menu = $('#ai-model-menu');
        const query = field.value.trim().toLowerCase();
        const shown = menuFilter && query ? modelNames.filter(name => name.toLowerCase().includes(query)) : modelNames;
        menu.replaceChildren(...shown.map((name, index) => {
            const option = document.createElement('div');
            option.className = 'model-option' + (index === menuActive ? ' is-active' : '');
            option.setAttribute('role', 'option');
            option.id = `ai-model-option-${index}`;
            option.setAttribute('aria-selected', String(name === modelOf()));
            option.dataset.name = name;
            option.innerHTML = `<span class="model-check">${name === modelOf() ? icon('check') : ''}</span><span class="model-name"></span>`;
            option.querySelector('.model-name').textContent = name;
            return option;
        }));
        if (!shown.length) menu.append(Object.assign(document.createElement('div'), { className: 'model-empty', textContent: modelNames.length ? 'Нет моделей с таким именем — можно вписать его вручную' : 'Список пуст. Нажмите «Обновить»' }));
        field.setAttribute('aria-activedescendant', menuActive >= 0 ? `ai-model-option-${menuActive}` : '');
        return shown;
    }
    function openModelMenu(all) {
        const field = $('#ai-model-field'), menu = $('#ai-model-menu');
        if (all) menuFilter = false;
        menuActive = Math.max(0, modelNames.indexOf(field.value.trim()));
        menu.hidden = false;
        field.setAttribute('aria-expanded', 'true');
        drawModelMenu();
        const current = menu.querySelector('.is-active');
        if (current) current.scrollIntoView({ block: 'nearest' });
    }
    function closeModelMenu() {
        const field = $('#ai-model-field');
        $('#ai-model-menu').hidden = true;
        field.setAttribute('aria-expanded', 'false');
        field.removeAttribute('aria-activedescendant');
        menuActive = -1;
    }
    function pickModel(name) {
        const field = $('#ai-model-field');
        field.value = name;
        closeModelMenu();
        setModel(name);
        if (panel && !panel.hidden) render();
    }

    document.addEventListener('DOMContentLoaded', () => {
        editor = $('#markdown-editor');
        $('#ai-button').addEventListener('click', () => { if (!panel || panel.hidden) open(); else close(); });
        // The shortcut that opens the chat is set in shortcuts.js; it calls this.
        window.FgsAssistant = { toggle: hotkey };
        // Each platform shows only what it can run: models on the phone, or the programs on the computer.
        const group = document.querySelector(desktop ? '#ai-provider optgroup[data-device]' : '#ai-provider optgroup[label^="На вашем"]');
        if (group) group.remove();
        $('#ai-url-field').addEventListener('change', () => {
            const value = $('#ai-url-field').value.trim();
            window.FgsSettings.update({ [cfg().urlKey]: value || cfg().urlDefault || '' });
            if (providerId() === 'ollama') setModel('');
            refreshModels();
        });
        const modelField = $('#ai-model-field'), modelMenu = $('#ai-model-menu');
        modelField.addEventListener('change', () => { setModel(modelField.value.trim()); if (panel && !panel.hidden) render(); });
        modelField.addEventListener('focus', () => openModelMenu(true));
        modelField.addEventListener('click', () => { if (modelMenu.hidden) openModelMenu(true); });
        modelField.addEventListener('input', () => { menuFilter = true; menuActive = 0; if (modelMenu.hidden) openModelMenu(false); else drawModelMenu(); });
        modelField.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (modelMenu.hidden) return openModelMenu(true);
                const count = modelMenu.querySelectorAll('.model-option').length;
                if (!count) return;
                menuActive = (menuActive + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
                drawModelMenu();
                modelMenu.querySelector('.is-active').scrollIntoView({ block: 'nearest' });
            } else if (event.key === 'Enter' && !modelMenu.hidden) {
                const active = modelMenu.querySelector('.model-option.is-active');
                event.preventDefault();
                if (active) pickModel(active.dataset.name); else { closeModelMenu(); modelField.dispatchEvent(new Event('change')); }
            } else if (event.key === 'Escape' && !modelMenu.hidden) {
                event.preventDefault(); event.stopPropagation(); closeModelMenu();
            } else if (event.key === 'Tab') closeModelMenu();
        });
        // mousedown keeps the focus in the field, so the menu does not close before the click lands
        modelMenu.addEventListener('mousedown', event => {
            event.preventDefault();
            const option = event.target.closest('.model-option');
            if (option) pickModel(option.dataset.name);
        });
        modelField.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== modelField) closeModelMenu(); }, 120));
        document.addEventListener('mousedown', event => { if (!modelMenu.hidden && !event.target.closest('.model-combo')) closeModelMenu(); });
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
            if (panel) renderAttach();
            if (document.documentElement.dataset.ai !== 'on') close();
            // A different provider was picked: show its fields and look at its models (the first event, at start-up, only records it).
            const now = providerId();
            if (shownProvider !== now) {
                const left = shownProvider;
                shownProvider = now;
                if (left === 'device' && api.device) api.device.unload();
                const settingsOpen = document.getElementById('settings-modal').classList.contains('show');
                if (settingsOpen) refreshModels();
                if (panel && !panel.hidden) checkConnection().then(() => render());
            }
        });
        syncProviderUI();
    });
})();
