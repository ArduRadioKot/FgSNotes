// AI providers: one interface (list models, stream a chat) over Ollama, OpenAI-compatible servers, Anthropic Claude and Google Gemini.
// The same file runs in the desktop main process and in the phone app's web view. Requests never go through the page on desktop:
// a file:// page cannot call these APIs (CORS), and API keys must not live in the renderer.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./ollama-api'));
    else root.FgsProviders = factory(root.FgsOllamaApi);
})(typeof self !== 'undefined' ? self : this, function (ollama) {
// "openai" kind is the de-facto standard (/models, /chat/completions with SSE): OpenAI itself, OpenRouter, Groq, LM Studio, vLLM, llama.cpp...
const PRESETS = {
    ollama: { kind: 'ollama', local: true, urlSetting: true },
    lmstudio: { kind: 'openai', local: true, urlSetting: true, base: 'http://127.0.0.1:1234/v1', keyOptional: true },
    openai: { kind: 'openai', base: 'https://api.openai.com/v1' },
    anthropic: { kind: 'anthropic', base: 'https://api.anthropic.com/v1' },
    gemini: { kind: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta' },
    openrouter: { kind: 'openai', base: 'https://openrouter.ai/api/v1' },
    groq: { kind: 'openai', base: 'https://api.groq.com/openai/v1' },
    custom: { kind: 'openai', urlSetting: true, keyOptional: true },
    // Desktop app only: the main process runs the installed CLI (agents.js). No key, and no HTTP call from here.
    'claude-code': { kind: 'cli', local: true },
    codex: { kind: 'cli', local: true },
    // Runs inside the phone app's web view (ai/web-backend.js); the functions below never see it.
    device: { kind: 'device', local: true }
};

function preset(id) {
    const found = PRESETS[id];
    if (!found) throw new Error('Неизвестный провайдер: ' + id);
    return found;
}
const needsKey = id => !preset(id).local && !preset(id).keyOptional;

// Base URL for a request: fixed for hosted providers, taken from the settings for local and custom ones.
function baseOf(id, url) {
    const info = preset(id);
    if (!info.urlSetting) return info.base;
    const text = String(url || info.base || '').trim().replace(/\/+$/, '');
    if (!text) throw new Error('Укажите адрес сервера в настройках.');
    if (!/^https?:\/\/[^\s/]+(?::\d+)?(?:\/[^\s?#]*)?$/i.test(text)) throw new Error('Адрес должен начинаться с http:// или https://');
    return text.replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1');   // Node 18 resolves "localhost" to ::1 first
}

async function readError(response) {
    let detail = '';
    try {
        const data = await response.json();
        detail = (data.error && (data.error.message || data.error)) || data.message || '';
        if (typeof detail !== 'string') detail = JSON.stringify(detail);
    } catch { /* not JSON */ }
    if (response.status === 401 || response.status === 403) return 'Сервер не принял ключ API. Проверьте его в настройках → ИИ.';
    if (response.status === 404) return detail || 'Модель или адрес не найдены (404). Проверьте имя модели и адрес сервера.';
    if (response.status === 429) return 'Превышен лимит запросов или закончились средства на счёте. ' + detail;
    return detail || 'Сервер ответил ' + response.status;
}
function describe(error) {
    if (error.name === 'AbortError') return 'Остановлено';
    if (error.name === 'TimeoutError') return 'Сервер не ответил вовремя.';
    const code = error.cause && error.cause.code;
    if (code === 'ECONNREFUSED') return 'Не удалось подключиться: сервер не запущен или адрес указан неверно.';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Не удалось найти сервер. Проверьте адрес и подключение к интернету.';
    if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'Соединение оборвалось.';
    return error.message || String(error);
}

// Server-sent events: calls onData(parsed JSON) for every "data:" line; "[DONE]" ends the stream.
async function readEvents(response, onData) {
    const decoder = new TextDecoder();
    let pending = '';
    const flush = line => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        onData(JSON.parse(payload));
    };
    for await (const chunk of ollama.chunksOf(response)) {
        pending += decoder.decode(chunk, { stream: true });
        let newline;
        while ((newline = pending.indexOf('\n')) >= 0) {
            flush(pending.slice(0, newline).trim());
            pending = pending.slice(newline + 1);
        }
    }
    flush(pending.trim());
}

const headersFor = (kind, key) => {
    const json = { 'Content-Type': 'application/json' };
    if (kind === 'anthropic') return { ...json, 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
    if (kind === 'gemini') return { ...json, 'x-goog-api-key': key };
    return key ? { ...json, Authorization: 'Bearer ' + key } : json;
};

const NOT_CHAT = /embed|whisper|tts|dall-e|moderation|davinci|babbage|image|audio|realtime|transcribe|rerank/i;

async function listModels({ provider, url, key, fetch: fetchImpl }) {
    try {
        const info = preset(provider);
        if (info.kind === 'cli') throw new Error('Claude Code и Codex подключаются только в приложении для компьютера.');
        if (info.kind === 'ollama') return await ollama.listModels(baseOf(provider, url), fetchImpl);
        if (needsKey(provider) && !key) throw new Error('Укажите ключ API в настройках → ИИ.');
        const base = baseOf(provider, url);
        const endpoint = info.kind === 'gemini' ? base + '/models?pageSize=200' : base + '/models' + (info.kind === 'anthropic' ? '?limit=100' : '');
        const response = await (fetchImpl || fetch)(endpoint, { headers: headersFor(info.kind, key), signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(await readError(response));
        const data = await response.json();
        let models;
        if (info.kind === 'gemini') models = (data.models || []).filter(model => (model.supportedGenerationMethods || []).includes('generateContent')).map(model => String(model.name).replace(/^models\//, ''));
        else models = (data.data || []).map(model => model.id).filter(id => id && !NOT_CHAT.test(id));
        return { ok: true, models: [...new Set(models)].sort() };
    } catch (error) {
        return { ok: false, error: describe(error) };
    }
}

// messages: [{ role: 'system'|'user'|'assistant', content }]
async function chat({ provider, url, key, model, messages, temperature, think, fetch: fetchImpl }, onDelta, signal, onThinking) {
    try {
        const info = preset(provider);
        if (info.kind === 'cli') throw new Error('Claude Code и Codex подключаются только в приложении для компьютера.');
        if (info.kind === 'ollama') return await ollama.chat({ url: baseOf(provider, url), model, messages, temperature, think, fetch: fetchImpl }, onDelta, signal, onThinking);
        if (!model) throw new Error('Не выбрана модель. Откройте Настройки → ИИ.');
        if (needsKey(provider) && !key) throw new Error('Укажите ключ API в настройках → ИИ.');
        const base = baseOf(provider, url);
        const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
        const turns = messages.filter(message => message.role !== 'system');
        let endpoint, body;
        // Reasoning is opt-in per provider and only for models that have it; if a server rejects the request because of it,
        // the same request is repeated without it.
        const THINKS = { anthropic: /claude-(?:3-7|opus-4|sonnet-4|haiku-4|opus-5|sonnet-5|haiku-5|fable)/i, gemini: /gemini-(?:2\.5|3)/i };
        let reasoning = !!think && !!THINKS[info.kind] && THINKS[info.kind].test(model);
        // Anthropic needs max_tokens: ask for the most the model allows and step down if the model's ceiling is lower.
        const ceilings = [64000, 32000, 16000, 8192, 4096];
        let ceiling = 0;
        const build = () => {
            if (info.kind === 'anthropic') {
                endpoint = base + '/messages';
                const maxTokens = ceilings[ceiling];
                body = { model, max_tokens: maxTokens, stream: true, messages: turns };
                if (system) body.system = system;
                if (reasoning && maxTokens > 4000) body.thinking = { type: 'enabled', budget_tokens: Math.min(16000, Math.floor(maxTokens / 2)) };
            } else if (info.kind === 'gemini') {
                endpoint = `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
                body = { contents: turns.map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })) };
                if (system) body.systemInstruction = { parts: [{ text: system }] };
                if (reasoning) body.generationConfig = { thinkingConfig: { includeThoughts: true } };
            } else {
                endpoint = base + '/chat/completions';
                body = { model, messages, stream: true };
                if (Number.isFinite(temperature)) body.temperature = temperature;
            }
        };
        let response;
        for (;;) {
            build();
            response = await (fetchImpl || fetch)(endpoint, { method: 'POST', headers: headersFor(info.kind, key), body: JSON.stringify(body), signal });
            if (response.ok) break;
            const text = await response.clone().text().catch(() => '');
            if (info.kind === 'anthropic' && response.status === 400 && /max_tokens/i.test(text) && ceiling < ceilings.length - 1) { ceiling++; continue; }
            if (reasoning && response.status === 400 && /think/i.test(text)) { reasoning = false; continue; }
            throw new Error(await readError(response));
        }
        await readEvents(response, event => {
            if (event.error) throw new Error(event.error.message || JSON.stringify(event.error));
            if (info.kind === 'anthropic') {
                if (event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') onDelta(event.delta.text);
                else if (event.type === 'content_block_delta' && event.delta && event.delta.type === 'thinking_delta' && event.delta.thinking && onThinking) onThinking(event.delta.thinking);
                else if (event.type === 'error') throw new Error(event.error && event.error.message || 'Ошибка сервера');
            } else if (info.kind === 'gemini') {
                const parts = event.candidates && event.candidates[0] && event.candidates[0].content && event.candidates[0].content.parts || [];
                for (const part of parts) { if (part.text && !part.thought) onDelta(part.text); else if (part.thought && part.text && onThinking) onThinking(part.text); }
            } else {
                const delta = event.choices && event.choices[0] && event.choices[0].delta;
                if (!delta) return;
                if (delta.content) onDelta(delta.content);
                if ((delta.reasoning_content || delta.reasoning) && onThinking) onThinking(delta.reasoning_content || delta.reasoning);
            }
        });
        return { ok: true };
    } catch (error) {
        return { ok: false, error: describe(error), aborted: error.name === 'AbortError' };
    }
}

    return { PRESETS, preset, needsKey, baseOf, listModels, chat };
});
