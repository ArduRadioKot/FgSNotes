// Optional terminal command. The app writes a small launcher onto PATH when the person asks.
// The launcher runs the bundled editor with the Node runtime inside the app, so a separate Node is not required.
const path = require('path');

function shellQuote(value) {
    return "'" + String(value).replace(/'/g, `'\\''`) + "'";
}

function commandName(platform) {
    return platform === 'win32' ? 'fgsnotes.cmd' : 'fgsnotes';
}

function launcher({ platform, execPath, tuiPath }) {
    if (platform === 'win32') {
        const bat = value => String(value).replace(/%/g, '%%');
        return `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${bat(execPath)}" "${bat(tuiPath)}" %*\r\n`;
    }
    return `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec ${shellQuote(execPath)} ${shellQuote(tuiPath)} "$@"\n`;
}

function pathList(envPath, platform) {
    return String(envPath || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
}

function sameDir(left, right, platform) {
    const a = path.resolve(left);
    const b = path.resolve(right);
    return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function onPath(dir, envPath, platform) {
    return pathList(envPath, platform).some(entry => sameDir(entry, dir, platform));
}

function mergePath(envPath, dir, platform) {
    if (onPath(dir, envPath, platform)) return envPath || '';
    const sep = platform === 'win32' ? ';' : ':';
    return envPath ? envPath + sep + dir : dir;
}

function defaultPlaces(platform, home) {
    if (platform === 'win32') return [path.join(home, 'AppData', 'Local', 'FgSNotes', 'bin')];
    if (platform === 'darwin') return ['/usr/local/bin', path.join(home, '.local', 'bin')];
    return [path.join(home, '.local', 'bin'), '/usr/local/bin'];
}

function canWriteDir(fs, dir) {
    try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { /* missing or locked */ }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    try { fs.accessSync(parent, fs.constants.W_OK); } catch { return false; }
    try { return !fs.existsSync(dir); } catch { return false; }
}

function chooseDir({ platform, dirs, envPath, canWrite }) {
    const writableOnPath = dirs.find(dir => canWrite(dir) && onPath(dir, envPath, platform));
    if (writableOnPath) return { dir: writableOnPath, elevated: false };
    if (platform === 'darwin' && dirs.includes('/usr/local/bin') && !canWrite('/usr/local/bin')) {
        return { dir: '/usr/local/bin', elevated: true };
    }
    return { dir: dirs.find(canWrite) || dirs[0], elevated: false };
}

function context(options) {
    const platform = options.platform;
    const dirs = options.places || defaultPlaces(platform, options.home);
    const canWrite = options.canWrite || (dir => canWriteDir(options.fs, dir));
    return { platform, dirs, canWrite, envPath: options.envPath || '' };
}

function locate(options) {
    const { platform, dirs } = context(options);
    const name = commandName(platform);
    return dirs.map(dir => ({ dir, file: path.join(dir, name) })).find(item => {
        try { return options.fs.existsSync(item.file); } catch { return false; }
    }) || null;
}

function status(options) {
    const found = locate(options);
    if (!found) return { installed: false, onPath: false, current: false };
    let text = '';
    try { text = options.fs.readFileSync(found.file, 'utf8'); } catch { text = ''; }
    return {
        installed: true,
        file: found.file,
        dir: found.dir,
        onPath: onPath(found.dir, options.envPath, options.platform),
        current: text.includes(options.tuiPath)
    };
}

function install(options) {
    const { platform, dirs, canWrite, envPath } = context(options);
    if (!options.fs.existsSync(options.tuiPath)) return { ok: false, error: 'Терминальный редактор не входит в эту сборку.' };
    const picked = chooseDir({ platform, dirs, envPath, canWrite });
    const file = path.join(picked.dir, commandName(platform));
    const body = launcher({ platform, execPath: options.execPath, tuiPath: options.tuiPath });
    try {
        if (picked.elevated) {
            if (!options.elevate) return { ok: false, error: 'Нет прав записать команду в /usr/local/bin.' };
            options.fs.writeFileSync(options.tmpFile, body);
            options.elevate(`mkdir -p ${shellQuote(picked.dir)} && cp ${shellQuote(options.tmpFile)} ${shellQuote(file)} && chmod 755 ${shellQuote(file)}`);
        } else {
            options.fs.mkdirSync(picked.dir, { recursive: true });
            options.fs.writeFileSync(file, body);
            try { options.fs.chmodSync(file, 0o755); } catch { /* Windows has no chmod */ }
        }
    } catch (error) {
        return { ok: false, error: error.message || String(error) };
    }
    let listed = onPath(picked.dir, envPath, platform);
    if (!listed && platform === 'win32' && options.setPath) {
        try { options.setPath(mergePath(envPath, picked.dir, platform)); listed = true; }
        catch (error) { return { ok: true, file, onPath: false, current: true, error: error.message || String(error) }; }
    }
    return { ok: true, file, dir: picked.dir, onPath: listed, current: true };
}

function remove(options) {
    const { platform, dirs, canWrite } = context(options);
    const name = commandName(platform);
    const existing = dirs.map(dir => path.join(dir, name)).filter(file => {
        try { return options.fs.existsSync(file); } catch { return false; }
    });
    if (!existing.length) return { ok: true, removed: false };
    try {
        for (const file of existing) {
            if (canWrite(path.dirname(file))) options.fs.unlinkSync(file);
            else if (options.elevate) options.elevate(`rm -f ${shellQuote(file)}`);
            else return { ok: false, error: 'Нет прав убрать команду.' };
        }
    } catch (error) {
        return { ok: false, error: error.message || String(error) };
    }
    return { ok: true, removed: true };
}

module.exports = { launcher, chooseDir, mergePath, onPath, status, install, remove, defaultPlaces, commandName };
