// Ollama client for the main process. The renderer cannot call a local server from a file:// page (CORS),
// so requests are made here and streamed back over IPC.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const DEFAULT_URL = 'http://localhost:11434';

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

async function listModels(url) {
    try {
        const response = await fetch(baseUrl(url) + '/api/tags', { signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw new Error('Сервер ответил ' + response.status);
        const data = await response.json();
        const models = (data.models || []).map(model => model.name).sort();
        return { ok: true, models };
    } catch (error) {
        return { ok: false, error: describe(error) };
    }
}

// Streams /api/chat (newline-delimited JSON). Calls onDelta(text) for every piece; resolves {ok} or {ok:false,error}.
async function chat({ url, model, messages, temperature }, onDelta, signal, onThinking) {
    try {
        if (!model) throw new Error('Не выбрана модель. Откройте Настройки → ИИ.');
        // Reasoning models spend minutes "thinking" before they answer; an editing helper does not need it.
        const body = { model, messages, stream: true, think: false };
        if (Number.isFinite(temperature)) body.options = { temperature };
        const send = () => fetch(baseUrl(url) + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
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
        for await (const chunk of response.body) {
            pending += decoder.decode(chunk, { stream: true });
            let newline;
            while ((newline = pending.indexOf('\n')) >= 0) {
                const line = pending.slice(0, newline).trim();
                pending = pending.slice(newline + 1);
                if (!line) continue;
                const part = JSON.parse(line);
                if (part.error) throw new Error(part.error);
                if (part.message && part.message.thinking && onThinking) onThinking();
                if (part.message && part.message.content) onDelta(part.message.content);
            }
        }
        return { ok: true };
    } catch (error) {
        return { ok: false, error: describe(error), aborted: error.name === 'AbortError' };
    }
}

// Downloads a model (/api/pull). onProgress({ status, completed, total }) is called for every update.
async function pull({ url, model }, onProgress, signal) {
    try {
        if (!/^[\w.\-:/]+$/.test(String(model || ''))) throw new Error('Неверное имя модели');
        const response = await fetch(baseUrl(url) + '/api/pull', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, stream: true }),
            signal
        });
        if (!response.ok) throw new Error('Сервер ответил ' + response.status);
        const decoder = new TextDecoder();
        let pending = '';
        for await (const chunk of response.body) {
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

const exists = file => { try { return fs.existsSync(file); } catch { return false; } };
function onPath() {
    return new Promise(resolve => {
        let settled = false;
        const finish = value => { if (!settled) { settled = true; resolve(value); } };
        const child = execFile(process.platform === 'win32' ? 'where' : 'which', ['ollama'], (error, out) => {
            clearTimeout(timer);
            finish(error ? '' : out.split(/\r?\n/)[0].trim());
        });
        const timer = setTimeout(() => { child.kill(); finish(''); }, 400);
    });
}
// Where Ollama is installed: the desktop app (macOS, Windows) or only the command line tool.
async function findInstall() {
    const home = os.homedir();
    if (process.platform === 'darwin') {
        const app = ['/Applications/Ollama.app', path.join(home, 'Applications', 'Ollama.app')].find(exists);
        if (app) return { installed: true, kind: 'app', path: app };
    } else if (process.platform === 'win32') {
        const app = [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama app.exe')].find(exists);
        if (app) return { installed: true, kind: 'app', path: app };
    }
    const cli = (await onPath()) || ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/usr/bin/ollama'].find(exists) || '';
    return cli ? { installed: true, kind: 'cli', path: cli } : { installed: false, kind: null, path: '' };
}
// Starts the server: the app if there is one, otherwise `ollama serve`, detached so it outlives FgSNotes.
async function launch() {
    const install = await findInstall();
    if (!install.installed) return { ok: false, error: 'Ollama не найдена на этом компьютере.' };
    try {
        let child;
        if (install.kind === 'app' && process.platform === 'darwin') child = spawn('open', ['-a', install.path], { stdio: 'ignore' });
        else if (install.kind === 'app') child = spawn(install.path, [], { detached: true, stdio: 'ignore' });
        else child = spawn(install.path, ['serve'], { detached: true, stdio: 'ignore' });
        child.on('error', () => {});
        child.unref();
        return { ok: true };
    } catch (error) {
        return { ok: false, error: describe(error) };
    }
}

module.exports = { findInstall, launch, listModels, chat, pull, baseUrl, DEFAULT_URL };
