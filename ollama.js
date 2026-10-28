// Ollama for the desktop main process: the shared HTTP client (src/ai/ollama-api.js) plus helpers that need Node,
// namely finding an installed Ollama and starting it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const api = require('./src/ai/ollama-api');
const { describe } = api;
const tr = key => (typeof globalThis.t === 'function' ? globalThis.t(key) : key);

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
    if (!install.installed) return { ok: false, error: tr('Ollama не найдена на этом компьютере.') };
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

module.exports = { ...api, findInstall, launch };
