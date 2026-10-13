// Ollama HTTP client. Plain fetch, no Node-only modules, so the same file runs in the desktop main process
// (a file:// page cannot call a local server because of CORS) and inside the phone app's web view.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.FgsOllamaApi = api;
})(typeof self !== 'undefined' ? self : this, function () {
const DEFAULT_URL = 'http://localhost:11434';

// A response body as an async sequence of byte chunks. Node and new browsers iterate a stream directly; Safari before 17 does not,
// so there the reader is used. A response made by hand (the phone's native HTTP fallback) may carry a single buffer.
async function* chunksOf(response) {
    const body = response.body;
    if (!body) return;
    if (body[Symbol.asyncIterator]) { yield* body; return; }
    if (body.getReader) {
        const reader = body.getReader();
        try { for (;;) { const { done, value } = await reader.read(); if (done) return; yield value; } } finally { reader.releaseLock && reader.releaseLock(); }
    }
}

function baseUrl(value) {
    const text = String(value || DEFAULT_URL).trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s/]+(?::\d+)?$/i.test(text)) throw new Error('Адрес сервера должен выглядеть как http://localhost:11434');
    // Node 18 (Electron 28) resolves "localhost" to ::1 first, while Ollama listens on 127.0.0.1: the connection is refused.
    return text.replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1');
}

function describe(error) {
    if (error.name === 'AbortError') return 'Остановлено';
    const code = error.cause && error.cause.code;
    if (code === 'ECONNREFUSED') return 'Ollama не запущена. Откройте приложение Ollama или выполните «ollama serve».';
    if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'Ollama оборвала соединение. Возможно, модели не хватило памяти — попробуйте модель поменьше.';
    if (/model .*not found/i.test(error.message)) return 'Эта модель не скачана. Откройте «Настроить Ollama» и скачайте её.';
    return error.message || String(error);
}

async function listModels(url, fetchImpl) {
    try {
        const response = await (fetchImpl || fetch)(baseUrl(url) + '/api/tags', { signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw new Error('Сервер ответил ' + response.status);
        const data = await response.json();
        const models = (data.models || []).map(model => model.name).sort();
        return { ok: true, models };
    } catch (error) {
        return { ok: false, error: describe(error) };
    }
}

// Streams /api/chat (newline-delimited JSON). Calls onDelta(text) for every piece; resolves {ok} or {ok:false,error}.
async function chat({ url, model, messages, temperature, think, fetch: fetchImpl }, onDelta, signal, onThinking) {
    try {
        if (!model) throw new Error('Не выбрана модель. Откройте Настройки → ИИ.');
        // think: show the model's reasoning (the person's choice); off makes reasoning models answer at once.
        // No answer-length limit (num_predict -1) and a roomy context, so reasoning plus the answer are not cut off.
        const body = { model, messages, stream: true, think: !!think, options: { num_predict: -1, num_ctx: 16384 } };
        if (Number.isFinite(temperature)) body.options.temperature = temperature;
        const send = () => (fetchImpl || fetch)(baseUrl(url) + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
        let response = await send();
        if (!response.ok) {
            let detail = '';
            try { detail = (await response.json()).error || ''; } catch { /* body is not JSON */ }
            // Older servers and models without the feature reject the flag: ask again without it.
            if (/think/i.test(detail)) { delete body.think; response = await send(); detail = ''; }
            if (!response.ok) {
                if (!detail) { try { detail = (await response.json()).error || ''; } catch { /* body is not JSON */ } }
                throw new Error(detail || 'Сервер ответил ' + response.status);
            }
        }
        const decoder = new TextDecoder();
        let pending = '';
        for await (const chunk of chunksOf(response)) {
            pending += decoder.decode(chunk, { stream: true });
            let newline;
            while ((newline = pending.indexOf('\n')) >= 0) {
                const line = pending.slice(0, newline).trim();
                pending = pending.slice(newline + 1);
                if (!line) continue;
                const part = JSON.parse(line);
                if (part.error) throw new Error(part.error);
                if (part.message && part.message.thinking && onThinking) onThinking(part.message.thinking);
                if (part.message && part.message.content) onDelta(part.message.content);
            }
        }
        return { ok: true };
    } catch (error) {
        return { ok: false, error: describe(error), aborted: error.name === 'AbortError' };
    }
}

// Downloads a model (/api/pull). onProgress({ status, completed, total }) is called for every update.
async function pull({ url, model, fetch: fetchImpl }, onProgress, signal) {
    try {
        if (!/^[\w.\-:/]+$/.test(String(model || ''))) throw new Error('Неверное имя модели');
        const response = await (fetchImpl || fetch)(baseUrl(url) + '/api/pull', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, stream: true }),
            signal
        });
        if (!response.ok) throw new Error('Сервер ответил ' + response.status);
        const decoder = new TextDecoder();
        let pending = '';
        for await (const chunk of chunksOf(response)) {
            pending += decoder.decode(chunk, { stream: true });
            let newline;
            while ((newline = pending.indexOf('\n')) >= 0) {
                const line = pending.slice(0, newline).trim();
                pending = pending.slice(newline + 1);
                if (!line) continue;
                const part = JSON.parse(line);
                if (part.error) throw new Error(part.error);
                onProgress({ status: part.status || '', completed: part.completed || 0, total: part.total || 0 });
            }
        }
        return { ok: true };
    } catch (error) {
        return { ok: false, error: describe(error), aborted: error.name === 'AbortError' };
    }
}

    return { listModels, chat, pull, baseUrl, chunksOf, describe, DEFAULT_URL };
});
