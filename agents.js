// Desktop-only chat through the Claude Code and Codex command-line tools.
// They use the account the person already signed in with on this computer, so no API key is stored here.
// The tools are started with no file or shell access: Claude gets an empty tool list and plan mode,
// Codex stays in its read-only sandbox. The note is sent on stdin and is never placed on the command line.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const PROMPT_LIMIT = 200000;
const SUGGESTIONS = {
    'claude-code': ['sonnet', 'opus', 'haiku'],
    codex: ['gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2']
};

function allowed(help, flag) {
    if (help == null) return true;
    return String(help).includes(flag);
}

function claudeArgs({ model, help } = {}) {
    const args = ['--print'];
    const ok = flag => allowed(help, flag);
    if (ok('--output-format')) {
        args.push('--output-format', 'stream-json');
        if (ok('--verbose')) args.push('--verbose');
        if (ok('--include-partial-messages')) args.push('--include-partial-messages');
    }
    if (ok('--permission-mode')) args.push('--permission-mode', 'plan');
    if (ok('--tools')) args.push('--tools', '');
    if (ok('--max-turns')) args.push('--max-turns', '1');
    if (ok('--no-session-persistence')) args.push('--no-session-persistence');
    if (model && ok('--model')) args.push('--model', model);
    return args;
}

function codexArgs({ model, help } = {}) {
    const args = ['exec'];
    const ok = flag => allowed(help, flag);
    if (ok('--json')) args.push('--json');
    if (ok('--sandbox')) args.push('--sandbox', 'read-only');
    if (ok('--skip-git-repo-check')) args.push('--skip-git-repo-check');
    if (ok('--ask-for-approval')) args.push('--ask-for-approval', 'never');
    if (ok('--ephemeral')) args.push('--ephemeral');
    if (ok('--color')) args.push('--color', 'never');
    if (model && ok('--model')) args.push('--model', model);
    args.push('-');
    return args;
}

// Used when a newer flag is rejected. `codex exec` stays read-only unless a write sandbox is requested; none of these request one.
function fallbacks(provider, model) {
    if (provider === 'codex') {
        const withModel = model ? ['--model', model] : [];
        return [
            ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', ...withModel, '-'],
            ['exec', ...withModel, '-']
        ];
    }
    return [['--print']];
}

const PROGRAMS = {
    'claude-code': {
        command: 'claude',
        missing: 'Claude Code не найден. Установите программу и войдите в аккаунт в терминале (команда claude), затем нажмите «Обновить».',
        helpArgs: ['--help'],
        args: claudeArgs
    },
    codex: {
        command: 'codex',
        missing: 'Codex не найден. Установите программу и войдите в аккаунт ChatGPT в терминале (команда codex), затем нажмите «Обновить».',
        helpArgs: ['exec', '--help'],
        args: codexArgs
    }
};

function safeModel(model) {
    const text = String(model || '').trim();
    if (!text) return '';
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(text)) throw new Error('Имя модели может содержать только буквы, цифры, точку, дефис и двоеточие.');
    return text;
}

function argumentsFor(provider, options = {}) {
    const program = PROGRAMS[provider];
    if (!program) throw new Error('Неизвестный провайдер');
    return program.args({ model: safeModel(options.model || ''), help: options.help });
}

function buildPrompt(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const system = list.filter(message => message && message.role === 'system').map(message => String(message.content || '')).join('\n\n');
    const body = list.filter(message => message && message.role !== 'system').map(message => {
        const who = message.role === 'assistant' ? 'Ассистент' : 'Пользователь';
        return who + ':\n' + String(message.content || '');
    }).join('\n\n');
    const text = [system, body].filter(Boolean).join('\n\n');
    return text.length > PROMPT_LIMIT ? text.slice(-PROMPT_LIMIT) : text;
}

function cleanError(text) {
    return String(text || '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function unknownFlag(text) {
    return /unknown (?:option|argument|flag)|unrecognized option|unexpected argument|invalid option/i.test(String(text || ''));
}

function createClaudeParser(onDelta, onThinking) {
    let streamed = '';
    let snapshot = '';
    return {
        push(event) {
            if (!event || typeof event !== 'object') return;
            const delta = (event.type === 'stream_event' && event.event && event.event.delta) || (event.type === 'content_block_delta' && event.delta);
            if (delta && delta.type === 'text_delta' && delta.text) {
                streamed += delta.text;
                onDelta(delta.text);
                return;
            }
            if (delta && delta.type === 'thinking_delta' && delta.thinking && onThinking) {
                onThinking(delta.thinking);
                return;
            }
            if (event.type === 'assistant' && event.message && Array.isArray(event.message.content)) {
                const text = event.message.content.filter(block => block && block.type === 'text' && block.text).map(block => block.text).join('');
                if (text) snapshot = text;
                return;
            }
            if (event.type === 'result' && event.is_error) {
                const detail = event.result || (event.error && (event.error.message || event.error)) || 'Claude Code не смог ответить';
                throw new Error(typeof detail === 'string' ? detail : 'Claude Code не смог ответить');
            }
            if (event.type === 'result' && typeof event.result === 'string' && event.result) snapshot = event.result;
        },
        flush() {
            if (!snapshot || (streamed && !snapshot.startsWith(streamed))) return;
            const extra = snapshot.slice(streamed.length);
            if (extra) onDelta(extra);
        }
    };
}

function createCodexParser(onDelta, onThinking) {
    let last = '';
    return {
        push(event) {
            if (!event || typeof event !== 'object') return;
            if (event.type === 'error') {
                const message = event.message || (event.error && (event.error.message || event.error)) || 'Codex не смог ответить';
                throw new Error(typeof message === 'string' ? message : 'Codex не смог ответить');
            }
            if (event.type === 'turn.failed') {
                const message = (event.error && (event.error.message || event.error)) || 'Codex не смог ответить';
                throw new Error(typeof message === 'string' ? message : 'Codex не смог ответить');
            }
            if (event.type !== 'item.completed' || !event.item) return;
            const item = event.item;
            if ((item.type === 'reasoning' || item.type === 'reasoning_summary') && onThinking) {
                const thought = typeof item.text === 'string' ? item.text : (typeof item.content === 'string' ? item.content : '');
                if (thought) onThinking(thought);
                return;
            }
            if (item.type !== 'agent_message' && item.type !== 'message') return;
            const text = typeof item.text === 'string' ? item.text : '';
            if (!text) return;
            const extra = text.startsWith(last) ? text.slice(last.length) : text;
            last = text.startsWith(last) ? text : last + text;
            if (extra) onDelta(extra);
        },
        flush() {}
    };
}

function extraDirs() {
    const home = os.homedir();
    const dirs = [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.codex', 'bin'), path.join(home, 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
    if (process.platform === 'win32') {
        dirs.unshift(path.join(process.env.LOCALAPPDATA || '', 'claude'), path.join(process.env.APPDATA || '', 'npm'));
    }
    return dirs.filter(Boolean);
}

// dirs listed first win. `existsFn` is injected in tests; production checks that the path is an executable file.
function findIn(name, pathText, existsFn) {
    const seen = new Set();
    const dirs = [...extraDirs(), ...String(pathText || '').split(path.delimiter)];
    const names = process.platform === 'win32' ? [name + '.exe', name + '.cmd', name] : [name];
    for (const dir of dirs) {
        if (!dir || seen.has(dir)) continue;
        seen.add(dir);
        for (const fileName of names) {
            const file = path.join(dir, fileName);
            if (existsFn(file)) return file;
        }
    }
    return '';
}

function isRunnable(file) {
    try {
        if (!fs.statSync(file).isFile()) return false;
        fs.accessSync(file, fs.constants.X_OK);
        return true;
    } catch { return false; }
}

function which(name) {
    return new Promise(resolve => {
        let settled = false;
        const finish = value => { if (!settled) { settled = true; resolve(value); } };
        const child = execFile(process.platform === 'win32' ? 'where' : 'which', [name], (error, out) => {
            clearTimeout(timer);
            const found = error ? '' : String(out || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0] || '';
            finish(found);
        });
        const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } finish(''); }, 1500);
    });
}

let pathPromise = null;
function loginPath() {
    if (process.platform === 'win32') return Promise.resolve(process.env.PATH || '');
    if (!pathPromise) {
        pathPromise = new Promise(resolve => {
            const shell = process.env.SHELL && /^\/[^\s"]+$/.test(process.env.SHELL) ? process.env.SHELL : '/bin/zsh';
            let settled = false;
            const finish = value => { if (!settled) { settled = true; resolve(value || process.env.PATH || ''); } };
            const child = execFile(shell, ['-ilc', 'printf %s "$PATH"'], { timeout: 3000 }, (error, out) => {
                const line = String(out || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean).pop() || '';
                finish(error && !line ? '' : line);
            });
            child.on('error', () => finish(''));
            setTimeout(() => { try { child.kill(); } catch { /* already gone */ } finish(''); }, 3500);
        });
    }
    return pathPromise;
}

const binCache = new Map();
async function findBin(provider) {
    const program = PROGRAMS[provider];
    if (!program) return '';
    if (binCache.has(program.command)) return binCache.get(program.command);
    const fromPath = await which(program.command);
    const found = (fromPath && isRunnable(fromPath) && fromPath) || findIn(program.command, await loginPath(), isRunnable) || '';
    if (found) binCache.set(program.command, found);
    return found;
}

const helpCache = new Map();
function helpOf(bin, helpArgs) {
    const key = bin + '\n' + helpArgs.join(' ');
    if (helpCache.has(key)) return helpCache.get(key);
    const pending = new Promise(resolve => {
        let out = '';
        let settled = false;
        const finish = () => { if (!settled) { settled = true; resolve(out); } };
        let child;
        try {
            child = spawn(bin, helpArgs, { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        } catch { return resolve(''); }
        const take = chunk => { if (out.length < 100000) out += chunk.toString('utf8'); };
        child.stdout.on('data', take);
        child.stderr.on('data', take);
        child.on('error', finish);
        child.on('close', finish);
        setTimeout(() => { try { child.kill(); } catch { /* already gone */ } finish(); }, 8000);
    });
    helpCache.set(key, pending);
    return pending;
}

function usesJson(args) {
    return args.includes('--json') || args.includes('stream-json');
}

function runCli({ bin, args, prompt, signal, provider, command }, onDelta, onThinking) {
    return new Promise(resolve => {
        let settled = false;
        let child;
        let killTimer = null;
        const emitted = { value: false };
        const finish = value => {
            if (settled) return;
            settled = true;
            if (signal) signal.removeEventListener('abort', onAbort);
            if (killTimer) clearTimeout(killTimer);
            resolve(value);
        };
        const onAbort = () => {
            try { child.kill('SIGTERM'); } catch { /* not running */ }
            killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, 1500);
        };
        try {
            child = spawn(bin, args, {
                cwd: os.tmpdir(),
                env: process.env,
                windowsHide: true,
                shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin),
                stdio: ['pipe', 'pipe', 'pipe']
            });
        } catch {
            return finish({ ok: false, error: 'Не удалось запустить программу.', emitted: false });
        }
        if (signal) {
            if (signal.aborted) {
                try { child.kill('SIGTERM'); } catch { /* not running */ }
                return finish({ ok: false, aborted: true, error: 'Остановлено', emitted: false });
            }
            signal.addEventListener('abort', onAbort, { once: true });
        }
        const parser = usesJson(args)
            ? (provider === 'codex' ? createCodexParser(text => { emitted.value = true; onDelta(text); }, onThinking) : createClaudeParser(text => { emitted.value = true; onDelta(text); }, onThinking))
            : {
                raw: '',
                push() {},
                pushText(text) { this.raw += text; },
                flush() { const text = this.raw.trim(); if (text) { emitted.value = true; onDelta(text); } }
            };
        let stderr = '';
        let failed = null;
        let buf = '';
        const decoder = new TextDecoder();
        const takeLine = line => {
            const trimmed = line.trim();
            if (!trimmed || !usesJson(args)) return;
            let event;
            try { event = JSON.parse(trimmed); } catch { return; }
            try { parser.push(event); } catch (error) { failed = error; try { child.kill('SIGTERM'); } catch { /* already gone */ } }
        };
        child.stdout.on('data', chunk => {
            const text = decoder.decode(chunk, { stream: true });
            if (!usesJson(args)) { parser.pushText(text); return; }
            buf += text;
            if (buf.length > 8e6) buf = buf.slice(-8e6);
            let newline;
            while ((newline = buf.indexOf('\n')) >= 0) {
                takeLine(buf.slice(0, newline));
                buf = buf.slice(newline + 1);
            }
        });
        child.stderr.on('data', chunk => { if (stderr.length < 8000) stderr += chunk.toString('utf8'); });
        child.on('error', error => {
            if (error.code === 'ENOENT') binCache.delete(command);
            finish({ ok: false, error: error.code === 'ENOENT' ? 'Программа не найдена.' : 'Не удалось запустить программу.', emitted: emitted.value });
        });
        child.stdin.on('error', () => {});
        try {
            const written = child.stdin.write(prompt);
            const end = () => { try { child.stdin.end(); } catch { /* closed */ } };
            if (written) end(); else child.stdin.once('drain', end);
        } catch { /* the process exited before the note was written */ }
        child.on('close', code => {
            if (signal && signal.aborted) return finish({ ok: false, aborted: true, error: 'Остановлено', emitted: emitted.value });
            try { takeLine(buf); parser.flush(); } catch (error) { failed = failed || error; }
            if (failed) return finish({ ok: false, error: cleanError(failed.message), emitted: emitted.value });
            if (code === 0 && emitted.value) return finish({ ok: true, emitted: true });
            const error = cleanError(stderr) || (emitted.value ? '' : 'Программа ничего не ответила.');
            if (emitted.value && !error) return finish({ ok: true, emitted: true });
            if (!emitted.value) return finish({ ok: false, error: error || ('Программа завершилась с кодом ' + code), emitted: false });
            return finish({ ok: false, error: error || ('Программа завершилась с кодом ' + code), emitted: true });
        });
    });
}

async function listModels(provider) {
    const program = PROGRAMS[provider];
    if (!program) return { ok: false, error: 'Неизвестный провайдер' };
    const bin = await findBin(provider);
    if (!bin) return { ok: false, error: program.missing };
    return { ok: true, models: SUGGESTIONS[provider] || [] };
}

async function chat(options, onDelta, signal, onThinking) {
    const provider = options && options.provider;
    const program = PROGRAMS[provider];
    if (!program) return { ok: false, error: 'Неизвестный провайдер' };
    let model = '';
    try { model = safeModel(options.model); }
    catch (error) { return { ok: false, error: error.message }; }
    const bin = options.bin || await findBin(provider);
    if (!bin) return { ok: false, error: program.missing };
    const probed = options.help !== undefined ? options.help : await helpOf(bin, program.helpArgs);
    const help = probed ? probed : null;
    const prompt = buildPrompt(options.messages);
    const run = args => runCli({ bin, args, prompt, signal, provider, command: program.command }, onDelta || (() => {}), onThinking);
    let result = await run(program.args({ model, help }));
    for (const args of fallbacks(provider, model)) {
        if (result.ok || result.aborted || result.emitted || !unknownFlag(result.error)) break;
        result = await run(args);
    }
    return result;
}

module.exports = {
    SUGGESTIONS, PROGRAMS, safeModel, argumentsFor, buildPrompt, cleanError, unknownFlag,
    createClaudeParser, createCodexParser, findIn, listModels, chat, fallbacks
};
