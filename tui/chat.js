// Chat session for the terminal. The wording matches the desktop chat: the same system prompt,
// the same actions, and the note wrapped in <текст> tags.
const MAX_CONTEXT = 200000;
const HISTORY = 24;
const SYSTEM = 'Ты встроенный помощник Markdown-редактора FgSNotes. Отвечай по-русски, если пользователь не пишет на другом языке. Когда просят изменить, исправить, перевести или продолжить текст, верни только готовый результат в Markdown, без вступлений и пояснений. Когда задают вопрос, отвечай кратко и по делу. Текст заметки передаётся между тегами <текст>.';

const ACTIONS = [
    { id: 'continue', label: 'Продолжить', before: true, prompt: 'Продолжи этот текст в том же стиле и формате. Верни только продолжение, без повтора исходного текста.' },
    { id: 'improve', label: 'Улучшить', prompt: 'Улучши стиль и ясность текста, сохрани смысл, язык и Markdown-разметку.' },
    { id: 'fix', label: 'Исправить ошибки', prompt: 'Исправь орфографию, пунктуацию и грамматику. Не меняй смысл и не добавляй ничего нового.' },
    { id: 'shorten', label: 'Сократить', prompt: 'Сократи текст вдвое, сохранив главное и Markdown-разметку.' },
    { id: 'translate', label: 'Перевести', prompt: 'Переведи текст: если он на русском, на английский, иначе на русский. Сохрани Markdown-разметку.' },
    { id: 'summary', label: 'Резюме', prompt: 'Сделай краткое резюме текста: 3-5 пунктов списка Markdown.' },
    { id: 'tasks', label: 'В задачи', prompt: 'Преврати текст в список задач Markdown (строки вида «- [ ] задача»).' },
    { id: 'title', label: 'Придумать заголовок', prompt: 'Придумай 5 коротких заголовков для этого текста, списком.' }
];

function splitInline(raw) {
    let thinking = '';
    const answer = String(raw || '').replace(/<think>([\s\S]*?)(?:<\/think>|$)\s*/g, (all, thought) => { thinking += thought; return ''; }).replace(/^\s+/, '');
    return { thinking, answer };
}

function cleanAnswer(text) {
    return splitInline(text).answer.replace(/^\s*<текст>\s*/, '').replace(/\s*<\/текст>\s*$/, '').trim();
}

function wrap(text, width) {
    const size = Math.max(1, width);
    const lines = [];
    for (const para of String(text || '').split('\n')) {
        const chars = Array.from(para);
        if (!chars.length) { lines.push(''); continue; }
        for (let i = 0; i < chars.length; i += size) lines.push(chars.slice(i, i + size).join(''));
    }
    return lines;
}

function modelMessages(t, messages) {
    const history = messages.filter(message => message.role === 'user' || message.content).slice(-HISTORY);
    return [{ role: 'system', content: t(SYSTEM) }, ...history.map(message => message.role === 'user'
        ? { role: 'user', content: message.content + (message.ctx ? '\n\n<текст>\n' + message.ctx.text + '\n</текст>' : '') }
        : { role: 'assistant', content: message.content })];
}

function contextOf(buffer, kind, lastCtx) {
    if (!buffer || kind === 'none') return null;
    if (kind === 'before') {
        const end = buffer.cursor;
        const text = buffer.text.slice(0, end);
        if (!text.trim()) return null;
        return { scope: 'before', start: end, end, text: text.slice(-MAX_CONTEXT), label: 'Текст до курсора' };
    }
    if (kind === 'note') {
        const text = buffer.text;
        if (!text.trim()) return null;
        return { scope: 'note', start: 0, end: text.length, text: text.slice(0, MAX_CONTEXT), label: 'Вся заметка' };
    }
    const sel = buffer.selection && buffer.selection();
    if (!sel) return null;
    const text = buffer.text.slice(sel.from, sel.to);
    if (!text) return null;
    if (kind === 'auto' && text === lastCtx) return null;
    return { scope: 'selection', start: sel.from, end: sel.to, text: text.slice(0, MAX_CONTEXT), label: 'Выделено · {n}' };
}

// Where an answer lands in the note. Same rules as the desktop chat.
function placeAnswer(buffer, message, prev, kind) {
    if (!message || !message.content) return { error: 'Пока нет ответа' };
    const ctx = prev && prev.ctx;
    const doc = buffer.text;
    const selected = ctx && ctx.scope === 'selection';
    const stale = selected && doc.slice(ctx.start, ctx.end) !== ctx.text;
    if (kind === 'replace' && (!selected || stale)) return { error: stale ? 'Выделение изменилось' : 'Нечего заменять' };
    const replacing = kind === 'replace';
    const from = replacing ? ctx.start : ctx && !stale && ctx.scope !== 'note' ? ctx.end : buffer.cursor;
    const to = replacing ? ctx.end : from;
    let text = message.content.trim();
    if (!replacing) {
        const before = doc.slice(0, from);
        if (before && ctx && ctx.scope === 'before') { if (!/\s$/.test(before)) text = ' ' + text; }
        else if (before) text = (before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n') + text;
    }
    buffer.replaceRange(from, to, text, from + text.length, from + text.length);
    return { ok: true, label: replacing ? 'Заменено' : 'Вставлено' };
}

function createSession(options) {
    const t = options.t;
    const client = options.client;
    const changed = () => options.onChange && options.onChange();
    const messages = [];
    let draft = '';
    let running = false;
    let controller = null;
    let lastCtx = '';
    let hide = 0;
    let job = Promise.resolve();

    function applyRaw(message, raw, extra) {
        const split = splitInline(raw);
        message.content = cleanAnswer(split.answer);
        message.thinking = (extra || '') + split.thinking;
    }
    function send(text, ctx, label) {
        const body = String(text || '').trim();
        if (running || !body) return job;
        messages.push({ role: 'user', content: body, label: label || '', ctx: ctx || null });
        if (ctx) lastCtx = ctx.text;
        draft = '';
        hide = 0;
        const request = modelMessages(t, messages);
        messages.push({ role: 'assistant', content: '', thinking: '', error: '' });
        const message = messages[messages.length - 1];
        running = true;
        controller = new AbortController();
        let raw = '';
        let thought = '';
        changed();
        job = Promise.resolve().then(() => client.complete({
            messages: request,
            signal: controller.signal,
            onDelta: delta => { raw += delta; applyRaw(message, raw, thought); changed(); },
            onThinking: text => { thought += text; message.thinking = thought + splitInline(raw).thinking; changed(); }
        })).then(result => {
            if (result && !result.ok && !result.aborted) message.error = result.error || t('Модель ничего не вернула.');
        }).catch(error => {
            if (error && (error.name === 'AbortError' || error.aborted)) return;
            message.error = error && error.message ? error.message : t('Модель ничего не вернула.');
        }).finally(() => {
            running = false;
            controller = null;
            if (!message.content && !message.thinking && !message.error) messages.pop();
            changed();
        });
        if (options.track) options.track(job);
        return job;
    }
    function abort() { if (controller) controller.abort(); }
    function type(text) { if (running) return; draft += String(text || '').replace(/[\r\n]/g, ''); hide = 0; }
    function backspace() { if (running) return; draft = Array.from(draft).slice(0, -1).join(''); }
    function clear() { if (running) return; messages.length = 0; draft = ''; lastCtx = ''; hide = 0; }
    function scrollBy(name) {
        const step = name === 'pageup' || name === 'pagedown' ? 8 : 1;
        if (name === 'up' || name === 'pageup') hide += step;
        else hide = Math.max(0, hide - step);
    }
    function lastPair() {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant' && messages[i].content) return { message: messages[i], prev: messages[i - 1] };
        }
        return null;
    }
    function lines(width, height, buffer, focused) {
        let info = { name: '', model: '', privacy: '', locked: false };
        try { info = client.describe() || info; } catch (error) { info = { name: '', model: '', privacy: '', error: error.message }; }
        const head = ' ' + t('Чат') + (info.name ? '  ' + t(info.name) : '') + (info.model ? ' · ' + info.model : '');
        const ctx = contextOf(buffer, 'auto', lastCtx) || null;
        const input = { text: ' ' + (running ? t('Думает...') : draft), kind: 'input', caret: focused && !running };
        const foot = [];
        if (ctx) foot.push({ text: ' ' + t(ctx.label, { n: ctx.text.length }), kind: '' });
        if (info.locked) wrap(t('Ключ зашифрован окном приложения, терминал его не читает. Ollama, LM Studio, Claude Code и Codex работают без ключа.'), width).forEach(text => foot.push({ text, kind: 'err' }));
        foot.push(input);
        const usedFoot = foot.slice(0, Math.max(1, height - 2));
        const room = Math.max(0, height - 1 - usedFoot.length);
        const body = [];
        if (!messages.length) {
            body.push(' ' + t('Чем помочь?'));
            body.push(...wrap(' ' + t('Выделите текст, и он прикрепится. Действия есть в Ctrl-P.'), width));
            if (info.privacy) body.push(...wrap(' ' + info.privacy, width));
        }
        messages.forEach(message => {
            if (message.role === 'user') {
                wrap('> ' + (message.label || message.content), width).forEach(text => body.push({ text, kind: 'user' }));
                return;
            }
            if (message.thinking && !message.content) wrap(message.thinking.trim(), width).forEach(text => body.push({ text, kind: '' }));
            if (message.content) wrap(message.content, width).forEach(text => body.push({ text, kind: '' }));
            else if (running && message === messages[messages.length - 1] && !message.thinking) body.push({ text: t('Думает...'), kind: '' });
            if (message.error) wrap(message.error, width).forEach(text => body.push({ text, kind: 'err' }));
        });
        const flat = body.map(line => typeof line === 'string' ? { text: line, kind: '' } : line);
        const start = Math.max(0, flat.length - room - hide);
        const visible = flat.slice(start, start + room);
        while (visible.length < room) visible.push({ text: '', kind: '' });
        const all = [{ text: head, kind: 'head' }, ...visible, ...usedFoot];
        return { width, focused: !!focused, lines: all.slice(0, height) };
    }
    return {
        actions: ACTIONS,
        send, abort, type, backspace, clear, scrollBy, lines, contextOf: (buffer, kind) => contextOf(buffer, kind || 'auto', lastCtx),
        running: () => running,
        draft: () => draft,
        lastAnswer: () => { const pair = lastPair(); return pair ? pair.message.content : ''; },
        place(buffer, kind) {
            const pair = lastPair();
            if (!pair) return { error: 'Пока нет ответа' };
            return placeAnswer(buffer, pair.message, pair.prev, kind);
        }
    };
}

module.exports = { createSession, ACTIONS, SYSTEM, splitInline, contextOf, placeAnswer, modelMessages };
