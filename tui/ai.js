// The same providers as the desktop chat: settings from Documents/FgSNotes/config.json,
// keys from the desktop key file. Encrypted keys stay in the window; this process cannot unlock them.
const fs = require('fs');
const os = require('os');
const path = require('path');
const providers = require('../providers');
const agents = require('../agents');

const META = {
    ollama: { name: 'Ollama', local: true, urlKey: 'ai-url', urlDefault: 'http://localhost:11434', modelKey: 'ai-model' },
    lmstudio: { name: 'LM Studio', local: true, urlKey: 'ai-url-lmstudio', urlDefault: 'http://localhost:1234/v1', modelKey: 'ai-model-lmstudio', key: true, keyOptional: true },
    'claude-code': { name: 'Claude Code', local: true, cli: true, modelKey: 'ai-model-claude-code' },
    codex: { name: 'Codex', local: true, cli: true, modelKey: 'ai-model-codex' },
    openai: { name: 'OpenAI', modelKey: 'ai-model-openai', key: true },
    anthropic: { name: 'Anthropic Claude', modelKey: 'ai-model-anthropic', key: true },
    gemini: { name: 'Google Gemini', modelKey: 'ai-model-gemini', key: true },
    openrouter: { name: 'OpenRouter', modelKey: 'ai-model-openrouter', key: true },
    groq: { name: 'Groq', modelKey: 'ai-model-groq', key: true },
    custom: { name: 'Свой сервер', urlKey: 'ai-url-custom', urlDefault: '', modelKey: 'ai-model-custom', key: true, keyOptional: true }
};

const DEFAULTS = {
    'ai-thinking': 'on',
    'ai-provider': 'ollama',
    'ai-url': 'http://localhost:11434',
    'ai-model': '',
    'ai-url-lmstudio': 'http://localhost:1234/v1',
    'ai-url-custom': '',
    'ai-model-lmstudio': '',
    'ai-model-openai': '',
    'ai-model-anthropic': '',
    'ai-model-gemini': '',
    'ai-model-openrouter': '',
    'ai-model-groq': '',
    'ai-model-custom': '',
    'ai-model-claude-code': '',
    'ai-model-codex': ''
};

function keyFiles() {
    const home = os.homedir();
    const roots = process.platform === 'darwin'
        ? [path.join(home, 'Library', 'Application Support')]
        : process.platform === 'win32'
            ? [process.env.APPDATA || path.join(home, 'AppData', 'Roaming')]
            : [path.join(home, '.config')];
    const names = ['fgsnotes-dev', 'FgSNotes', 'fgsnotes'];
    return roots.flatMap(root => names.map(name => path.join(root, name, 'ai-keys.json')));
}

function loadSettings(file) {
    try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
    catch { return { ...DEFAULTS }; }
}

function readKey(provider, files) {
    for (const file of files) {
        let data;
        try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
        const entry = data[provider];
        if (!entry) continue;
        if (entry.enc) return { key: '', locked: true };
        return { key: String(entry.value || ''), locked: false };
    }
    return { key: '', locked: false };
}

function createClient(options = {}) {
    const t = options.t || (key => key);
    const configFile = options.configFile || path.join(os.homedir(), 'Documents', 'FgSNotes', 'config.json');
    const files = options.keyFiles || keyFiles();
    const providerId = settings => {
        const id = settings['ai-provider'];
        return META[id] ? id : 'ollama';
    };
    function privacy(meta) {
        if (meta.cli) return t('Текст уходит в {name} через программу на этом компьютере и вашу подписку. Ключ API не нужен. Не прикрепляйте то, что не хотите отправлять.', { name: t(meta.name) });
        if (meta.local) return t('Текст остаётся на этом компьютере: работает {name}.', { name: t(meta.name) });
        return t('Текст заметки отправляется в {name}. Не прикрепляйте то, что не хотите отдавать провайдеру.', { name: t(meta.name) });
    }
    function describe() {
        const settings = loadSettings(configFile);
        const id = providerId(settings);
        const meta = META[id];
        const model = (settings[meta.modelKey] || '').trim();
        const got = meta.key ? readKey(id, files) : { key: '', locked: false };
        return { id, name: meta.name, model, local: !!meta.local, privacy: privacy(meta), locked: got.locked && !meta.keyOptional };
    }
    async function complete({ messages, onDelta, onThinking, signal }) {
        const settings = loadSettings(configFile);
        const id = providerId(settings);
        const meta = META[id];
        const model = (settings[meta.modelKey] || '').trim();
        const think = settings['ai-thinking'] !== 'off';
        const send = onDelta || (() => {});
        if (meta.cli) return agents.chat({ provider: id, model, messages }, send, signal, onThinking);
        const got = meta.key ? readKey(id, files) : { key: '', locked: false };
        if (meta.key && !meta.keyOptional && !got.key) {
            const error = got.locked
                ? t('Ключ зашифрован окном приложения, терминал его не читает. Ollama, LM Studio, Claude Code и Codex работают без ключа.')
                : t('Укажите ключ API в настройках → ИИ.');
            return { ok: false, error };
        }
        const url = meta.urlKey ? (settings[meta.urlKey] || meta.urlDefault || '').trim() : '';
        return providers.chat({ provider: id, url, key: got.key, model, messages, think }, send, signal, onThinking);
    }
    return { describe, complete };
}

module.exports = { createClient, readKey, loadSettings, META };
