// Updates from GitHub Releases.
// electron-updater needs latest*.yml and, on macOS, a Developer ID signature. This app is ad-hoc signed and the
// releases that already exist are plain dmg / exe / AppImage files, so the check talks to the Releases API directly
// and installs the asset that matches this computer.
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const REPO = 'ArduRadioKot/FgSNotes';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
function allowedHost(hostname) {
    return hostname === 'api.github.com' || hostname === 'github.com' || hostname.endsWith('.githubusercontent.com');
}

function compareVersions(left, right) {
    const parts = value => String(value || '').replace(/^v/i, '').split(/[.+-]/).filter(Boolean).map(part => (/^\d+$/.test(part) ? Number(part) : part));
    const a = parts(left), b = parts(right);
    const length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i++) {
        const x = a[i] ?? 0, y = b[i] ?? 0;
        if (x === y) continue;
        if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
        return String(x) < String(y) ? -1 : 1;
    }
    return 0;
}

function pickAsset(assets, env) {
    const list = Array.isArray(assets) ? assets : [];
    const arch = env.arch === 'arm64' ? 'arm64' : env.arch === 'ia32' ? 'ia32' : 'x64';
    const named = pattern => list.find(asset => asset && pattern.test(String(asset.name || '')));
    if (env.platform === 'darwin') return named(new RegExp(`-${arch}\\.dmg$`, 'i')) || named(/\.dmg$/i) || null;
    if (env.platform === 'win32') {
        if (env.portable) return named(/portable.*\.exe$/i) || null;
        return named(/setup.*\.exe$/i) || named(/\.exe$/i) || null;
    }
    if (env.platform === 'linux') {
        if (env.appImage) return named(/\.AppImage$/i) || null;
        return named(/\.AppImage$/i) || named(/\.tar\.gz$/i) || null;
    }
    return null;
}

function installPlan(env, asset) {
    if (!asset) return 'browser';
    const name = String(asset.name || '');
    if (env.platform === 'darwin' && name.endsWith('.dmg')) return 'mac';
    if (env.platform === 'win32' && /setup/i.test(name)) return 'win-setup';
    if (env.platform === 'win32' && env.portable && /portable/i.test(name)) return 'win-portable';
    if (env.platform === 'linux' && env.appImage && name.endsWith('.AppImage')) return 'appimage';
    return 'manual';
}

function describeRelease(release, current, env) {
    const latest = String((release && (release.tag_name || release.name)) || '').replace(/^v/i, '');
    const asset = pickAsset(release && release.assets, env);
    return {
        current: String(current),
        latest,
        available: !!latest && compareVersions(latest, current) > 0,
        notes: String((release && release.body) || '').replace(/\s+$/g, '').slice(0, 600),
        url: release && release.html_url ? String(release.html_url) : `https://github.com/${REPO}/releases/latest`,
        asset
    };
}

function request(url, headers, redirects = 0) {
    return new Promise((resolve, reject) => {
        let target;
        try { target = new URL(url); } catch { reject(new Error('Недопустимый адрес')); return; }
        if (target.protocol !== 'https:' || !allowedHost(target.hostname)) { reject(new Error('Недопустимый адрес')); return; }
        const req = https.get(url, { headers }, res => {
            const code = res.statusCode || 0;
            if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
                res.resume();
                if (redirects >= 5) { reject(new Error('Слишком много перенаправлений')); return; }
                resolve(request(new URL(res.headers.location, url).href, headers, redirects + 1));
                return;
            }
            resolve(res);
        });
        req.on('error', reject);
    });
}

function readBody(res, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        res.on('data', chunk => {
            size += chunk.length;
            if (size > maxBytes) { res.destroy(); reject(new Error('Слишком большой ответ')); return; }
            chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
    });
}

function safeName(name) {
    const base = path.basename(String(name || ''));
    return /^[A-Za-z0-9._-]{1,180}$/.test(base) ? base : '';
}

function register(ipcMain, { app, BrowserWindow, shell }) {
    const userAgent = `FgSNotes/${app.getVersion()}`;
    let pending = null;
    let downloading = null;

    const runtime = () => ({
        platform: process.platform,
        arch: process.platform === 'darwin' && app.runningUnderARM64Translation ? 'arm64' : process.arch,
        portable: !!process.env.PORTABLE_EXECUTABLE_FILE,
        appImage: !!process.env.APPIMAGE,
        packaged: app.isPackaged
    });

    function send(channel, payload) {
        for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.webContents.send(channel, payload);
        }
    }

    async function fetchLatest() {
        const res = await request(API, { 'User-Agent': userAgent, Accept: 'application/vnd.github+json', 'Accept-Encoding': 'identity' });
        if ((res.statusCode || 0) !== 200) { res.resume(); throw new Error(res.statusCode === 403 ? 'GitHub временно ограничил запросы' : 'Не удалось получить список релизов'); }
        const release = JSON.parse((await readBody(res, 2 * 1024 * 1024)).toString('utf8'));
        const info = describeRelease(release, app.getVersion(), runtime());
        const asset = info.asset;
        pending = {
            info,
            asset: asset ? { name: asset.name, size: asset.size || 0, url: asset.browser_download_url, digest: String(asset.digest || '') } : null,
            file: null
        };
        return publicInfo();
    }

    function publicInfo() {
        if (!pending) return { ok: false, error: 'Обновление ещё не проверено' };
        const { info, asset } = pending;
        return {
            ok: true,
            current: info.current,
            latest: info.latest,
            available: info.available,
            notes: info.notes,
            url: info.url,
            packaged: app.isPackaged,
            asset: asset ? { name: asset.name, size: asset.size } : null
        };
    }

    function download() {
        if (downloading) return downloading;
        downloading = (async () => {
            if (!pending) await fetchLatest();
            const asset = pending && pending.asset;
            if (!pending.info.available) return { ok: false, error: 'Установлена последняя версия' };
            if (!asset || !asset.url) return { ok: false, error: 'Для этой системы нет файла в релизе' };
            const name = safeName(asset.name);
            if (!name) return { ok: false, error: 'Неверное имя файла обновления' };
            const dir = path.join(app.getPath('temp'), 'fgsnotes-update');
            fs.mkdirSync(dir, { recursive: true });
            const dest = path.join(dir, name);
            const headers = { 'User-Agent': userAgent, Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' };
            const res = await request(asset.url, headers);
            if ((res.statusCode || 0) !== 200) { res.resume(); throw new Error('Не удалось скачать обновление'); }
            const total = Number(res.headers['content-length']) || asset.size || 0;
            const hash = crypto.createHash('sha256');
            let received = 0;
            await new Promise((resolve, reject) => {
                const file = fs.createWriteStream(dest);
                res.on('data', chunk => {
                    received += chunk.length;
                    hash.update(chunk);
                    send('updates-progress', { received, total });
                });
                res.pipe(file);
                file.on('finish', () => file.close(resolve));
                res.on('error', reject);
                file.on('error', reject);
            });
            const digest = hash.digest('hex');
            const expected = asset.digest.startsWith('sha256:') ? asset.digest.slice(7) : '';
            if (expected && expected !== digest) { fs.rmSync(dest, { force: true }); throw new Error('Файл обновления повреждён'); }
            if (total && received !== total) { fs.rmSync(dest, { force: true }); throw new Error('Файл обновления скачан не полностью'); }
            pending.file = dest;
            return { ok: true, name, size: received };
        })();
        return downloading.finally(() => { downloading = null; });
    }

    function launch(command, args, env) {
        const child = spawn(command, args, { detached: true, stdio: 'ignore', env: { ...process.env, ...env } });
        child.unref();
    }

    function installMac(dmg) {
        const bundle = path.resolve(process.execPath, '../../..');
        if (!bundle.endsWith('.app')) throw new Error('Не удалось найти приложение');
        return new Promise((resolve, reject) => {
            execFile('hdiutil', ['attach', '-nobrowse', '-readonly', '-plist', dmg], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
                if (error) { reject(new Error('Не удалось открыть образ диска')); return; }
                const points = [...String(stdout).matchAll(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g)].map(match => match[1]);
                const volume = points.find(point => point.startsWith('/Volumes/')) || '';
                let source = '';
                try {
                    source = volume && fs.readdirSync(volume).map(name => path.join(volume, name)).find(file => file.endsWith('.app')) || '';
                } catch { source = ''; }
                if (!source) {
                    if (volume) execFile('hdiutil', ['detach', volume], () => {});
                    reject(new Error('В образе нет приложения'));
                    return;
                }
                const script = [
                    'while kill -0 "$FGS_PID" 2>/dev/null; do sleep 0.3; done',
                    'rm -rf "$FGS_STAGE"',
                    'if ! cp -R "$FGS_SOURCE" "$FGS_STAGE"; then open "$FGS_VOLUME"; exit 1; fi',
                    'rm -rf "$FGS_BACKUP"',
                    'if ! mv "$FGS_TARGET" "$FGS_BACKUP"; then open "$FGS_VOLUME"; exit 1; fi',
                    'if ! mv "$FGS_STAGE" "$FGS_TARGET"; then mv "$FGS_BACKUP" "$FGS_TARGET"; open "$FGS_VOLUME"; exit 1; fi',
                    'rm -rf "$FGS_BACKUP"',
                    'xattr -dr com.apple.quarantine "$FGS_TARGET" 2>/dev/null || true',
                    'codesign --force --deep --sign - --timestamp=none "$FGS_TARGET" >/dev/null 2>&1 || true',
                    'hdiutil detach "$FGS_VOLUME" >/dev/null 2>&1 || true',
                    'open "$FGS_TARGET"'
                ].join('\n');
                const scriptPath = path.join(app.getPath('temp'), 'fgsnotes-update', 'install.sh');
                fs.writeFileSync(scriptPath, script, { mode: 0o755 });
                launch('sh', [scriptPath], {
                    FGS_PID: String(process.pid), FGS_SOURCE: source, FGS_VOLUME: volume,
                    FGS_TARGET: bundle, FGS_STAGE: bundle + '.new', FGS_BACKUP: bundle + '.previous'
                });
                resolve();
            });
        });
    }

    function installWindows(file) {
        const script = [
            '$target = [int]$env:FGS_PID',
            'while (Get-Process -Id $target -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 400 }',
            'Start-Process -FilePath $env:FGS_FILE -ArgumentList "/S"'
        ].join('; ');
        launch('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], { FGS_PID: String(process.pid), FGS_FILE: file });
    }

    function installAppImage(file) {
        const current = process.env.APPIMAGE;
        if (!current) throw new Error('Приложение запущено не как AppImage');
        const script = [
            'while kill -0 "$FGS_PID" 2>/dev/null; do sleep 0.3; done',
            'mv "$FGS_NEW" "$FGS_APP"',
            'chmod +x "$FGS_APP"',
            '"$FGS_APP" >/dev/null 2>&1 &'
        ].join('\n');
        const scriptPath = path.join(app.getPath('temp'), 'fgsnotes-update', 'install.sh');
        fs.writeFileSync(scriptPath, script, { mode: 0o755 });
        launch('sh', [scriptPath], { FGS_PID: String(process.pid), FGS_NEW: file, FGS_APP: current });
    }

    function installPortable(file) {
        const current = process.env.PORTABLE_EXECUTABLE_FILE;
        if (!current) throw new Error('Не найден файл portable-версии');
        const script = [
            '$target = [int]$env:FGS_PID',
            'while (Get-Process -Id $target -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 400 }',
            'Move-Item -Force -LiteralPath $env:FGS_NEW -Destination $env:FGS_APP',
            'Start-Process -FilePath $env:FGS_APP'
        ].join('; ');
        launch('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], { FGS_PID: String(process.pid), FGS_NEW: file, FGS_APP: current });
    }

    ipcMain.handle('updates-check', async () => {
        try { return await fetchLatest(); }
        catch (error) { return { ok: false, error: error.message || 'Не удалось проверить обновления' }; }
    });
    ipcMain.handle('updates-download', async () => {
        try { return await download(); }
        catch (error) { return { ok: false, error: error.message || 'Не удалось скачать обновление' }; }
    });
    ipcMain.handle('updates-install', async () => {
        try {
            if (!app.isPackaged) return { ok: false, error: 'Установка доступна в собранном приложении' };
            if (!pending || !pending.file || !fs.existsSync(pending.file)) return { ok: false, error: 'Сначала скачайте обновление' };
            const plan = installPlan(runtime(), pending.asset);
            if (plan === 'browser' || plan === 'manual') {
                shell.showItemInFolder(pending.file);
                return { ok: true, mode: 'manual', message: 'Файл скачан. Замените им текущую копию приложения.' };
            }
            if (plan === 'mac') await installMac(pending.file);
            else if (plan === 'win-setup') installWindows(pending.file);
            else if (plan === 'win-portable') installPortable(pending.file);
            else if (plan === 'appimage') installAppImage(pending.file);
            setImmediate(() => app.quit());
            return { ok: true, mode: 'restart' };
        } catch (error) {
            return { ok: false, error: error.message || 'Не удалось установить обновление' };
        }
    });
}

module.exports = { compareVersions, pickAsset, installPlan, describeRelease, register };
