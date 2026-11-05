// Sync of notes between devices on one local network (Wi-Fi).
// Every device with the same sync code merges its notes with the others. Computers find each other by a UDP beacon
// (main process, sync-server.js); a phone talks to a computer by its address. Everything on the wire is AES-GCM
// sealed with a key derived from the code, so a device without the code can neither read nor change notes.
//
// Merging: each note has a stable uid and a short history of content hashes it has had. If one side's version is in
// the other's history, the other is newer and wins. If neither is (both edited since they last met), the newer one
// keeps the note and the other becomes a separate copy, so no text is lost. Closed notes travel as tombstones.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.FgsSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const HISTORY = 40;
    const TOMBSTONE_DAYS = 30;

    // cyrb53: a fast 53-bit string hash, enough to tell versions of one note apart.
    function hashText(text) {
        let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        for (let i = 0; i < text.length; i++) {
            const ch = text.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
    }
    const hashNote = note => (note.deleted ? '-' : hashText(String(note.title) + '\u0000' + String(note.content)));
    const history = (...lists) => [...new Set(lists.flat().filter(Boolean))].slice(-HISTORY);

    // Remember the current version of every note as known, so a later answer carrying it is not taken as a conflict.
    function stamp(notes) {
        return notes.map(note => ({ ...note, hist: history(note.hist || [], hashNote(note)) }));
    }

    // Merge our notes with theirs. Pure and symmetric: both sides reach the same list. conflictLabel names the copy.
    function merge(ours, theirs, conflictLabel = 'conflict') {
        const now = Date.now();
        const byUid = list => new Map(list.filter(note => note && typeof note.uid === 'string').map(note => [note.uid, note]));
        const local = byUid(ours), remote = byUid(theirs);
        const result = new Map();
        const copies = [];
        const keep = (note, ...hists) => {
            const merged = { ...note, hist: history(...hists, hashNote(note)) };
            if (merged.deleted) { delete merged.title; delete merged.content; }
            return merged;
        };
        for (const uid of new Set([...local.keys(), ...remote.keys()])) {
            const L = local.get(uid), R = remote.get(uid);
            if (!L || !R) { result.set(uid, keep(L || R, (L || R).hist || [])); continue; }
            const hL = hashNote(L), hR = hashNote(R);
            const lHist = L.hist || [], rHist = R.hist || [];
            let winner;
            if (hL === hR) winner = (R.updatedAt || 0) > (L.updatedAt || 0) ? R : L;
            else if (lHist.includes(hR)) winner = L;            // theirs is an older version of ours
            else if (rHist.includes(hL)) winner = R;            // ours is an older version of theirs
            else if (L.deleted || R.deleted) winner = L.deleted ? R : L;   // edited on one side, closed on the other: keep the text
            else {
                // Both changed since they last met: the newer keeps the note, the other is saved next to it.
                const lNewer = (L.updatedAt || 0) !== (R.updatedAt || 0) ? (L.updatedAt || 0) > (R.updatedAt || 0) : hL > hR;
                winner = lNewer ? L : R;
                const loser = lNewer ? R : L, hLoser = lNewer ? hR : hL;
                copies.push({ uid: `${uid}~${hLoser.slice(0, 10)}`, title: `${loser.title} (${conflictLabel})`, content: loser.content, updatedAt: loser.updatedAt || now, hist: [] });
            }
            result.set(uid, keep(winner, lHist, rHist, [hL, hR]));
        }
        for (const copy of copies) if (!result.has(copy.uid)) result.set(copy.uid, keep(copy, []));
        // Tombstones are needed only until every device has seen them.
        const cutoff = now - TOMBSTONE_DAYS * 86400000;
        return [...result.values()].filter(note => !note.deleted || (note.updatedAt || 0) > cutoff);
    }

    const api = { merge, stamp, hashNote, hashText };
    if (typeof window === 'undefined' || typeof document === 'undefined') return api;

    // ---------- in the app ----------
    const t = (key, vars) => (window.FgsI18n ? window.FgsI18n.t(key, vars) : key);
    const settingsKey = 'fgsnotes.sync';
    const platform = () => window.fgsPlatform || { native: false, name: 'web' };
    const desktop = !!window.electron;
    const http = () => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) || null;
    const available = () => desktop || (platform().native && !!http());
    const DEFAULT_PORT = 47390;

    let settings = { enabled: false, code: '', peer: '', device: '' };
    try { settings = { ...settings, ...JSON.parse(localStorage.getItem(settingsKey)) }; } catch { /* first run */ }
    if (!settings.device) settings.device = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
    const saveSettings = () => { try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch { /* storage unavailable */ } };
    saveSettings();

    const normalizeCode = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const codeAlphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    function newCode() {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        const chars = [...bytes].map(byte => codeAlphabet[byte % codeAlphabet.length]).join('');
        return chars.match(/.{4}/g).join('-');
    }

    // ---------- sealing ----------
    const encoder = new TextEncoder(), decoder = new TextDecoder();
    const toBase64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); };
    const fromBase64 = text => Uint8Array.from(atob(text), ch => ch.charCodeAt(0));
    let keyCache = { code: '', key: null, group: '' };
    async function keys() {
        const code = normalizeCode(settings.code);
        if (keyCache.code === code && keyCache.key) return keyCache;
        const base = await crypto.subtle.importKey('raw', encoder.encode(code), 'PBKDF2', false, ['deriveKey']);
        const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: encoder.encode('fgsnotes-lan-sync-v1'), iterations: 150000, hash: 'SHA-256' },
            base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode('fgsnotes-group:' + code)));
        const group = [...digest.slice(0, 8)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        keyCache = { code, key, group };
        return keyCache;
    }
    async function seal(message) {
        const { key } = await keys();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify({ ...message, at: Date.now() }))));
        return JSON.stringify({ v: 1, iv: toBase64(iv), data: toBase64(data) });
    }
    async function open(text) {
        const { key } = await keys();
        const box = JSON.parse(text);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(box.iv) }, key, fromBase64(box.data));
        const message = JSON.parse(decoder.decode(plain));
        // An old recording replayed later is refused.
        if (!message || Math.abs(Date.now() - Number(message.at)) > 60 * 60000 || !Array.isArray(message.notes)) throw new Error('stale or malformed');
        return message;
    }

    // ---------- talking to the editor ----------
    const actions = () => window.FgsActions;
    const deviceName = () => (desktop ? (info && info.name) || 'Computer' : platform().name === 'ios' ? 'iPhone' : platform().name === 'android' ? 'Android' : 'Browser');
    function localNotes() {
        // Mark what we are about to send as known, and keep that mark in the workspace.
        const stamped = stamp(actions().syncNotes());
        actions().applySyncNotes(stamped);
        return stamped;
    }
    function absorb(theirs) {
        const merged = merge(actions().syncNotes(), theirs, t('конфликт'));
        actions().applySyncNotes(merged);
        return merged;
    }

    // ---------- state shown in the settings ----------
    let info = null;              // desktop: { addresses, port, name }
    let peers = [];               // desktop: computers found on the network
    let lastSync = 0, lastError = '', busy = false, timer = 0, pushTimer = 0;
    const seen = new Map();       // device -> name of devices we exchanged notes with recently

    async function exchange(address, name) {
        const { group } = await keys();
        const body = await seal({ type: 'sync', device: settings.device, name: deviceName(), notes: localNotes() });
        let answer;
        if (desktop) answer = await window.electron.syncSend(address, body);
        else {
            const url = `http://${/:\d+$/.test(address) ? address : `${address}:${DEFAULT_PORT}`}/fgs-sync`;
            const response = await http().request({ url, method: 'POST', data: body, responseType: 'text', connectTimeout: 5000, readTimeout: 20000,
                headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Fgs-Group': group } });
            if (response.status === 403) throw new Error('forbidden');
            if (response.status !== 200) throw new Error('HTTP ' + response.status);
            answer = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        }
        const message = await open(answer);
        absorb(message.notes);
        seen.set(message.device || address, message.name || name || address);
    }

    // Requests from other devices (desktop only): merge theirs into ours and answer with the result.
    async function answer(body) {
        if (!settings.enabled || !normalizeCode(settings.code)) return null;
        let message;
        try { message = await open(body); } catch { return null; }
        const merged = absorb(message.notes);
        seen.set(message.device, message.name || t('устройство'));
        lastSync = Date.now(); lastError = '';
        render();
        return seal({ type: 'sync', device: settings.device, name: deviceName(), notes: merged });
    }

    function describeError(error) {
        const text = String(error && error.message || error);
        if (/forbidden|OperationError|decrypt/i.test(text)) return t('Другое устройство отвечает, но код синхронизации не совпадает');
        if (/timeout|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|Failed to connect|Could not connect|timed out/i.test(text)) return t('Компьютер не отвечает. Он включён, FgSNotes открыт и в той же сети?');
        return t('Не удалось синхронизировать: {error}', { error: text });
    }

    async function syncNow() {
        if (busy || !settings.enabled || !available() || !normalizeCode(settings.code)) return;
        busy = true;
        render();
        const targets = [];
        if (desktop) {
            try { peers = await window.electron.syncPeers(); } catch { peers = []; }
            peers.forEach(peer => targets.push({ address: `${peer.address}:${peer.port}`, name: peer.name }));
        }
        const manual = String(settings.peer || '').trim();
        if (manual && !targets.some(target => target.address.split(':')[0] === manual.split(':')[0])) targets.push({ address: manual, name: manual });
        let ok = 0, failure = '';
        for (const target of targets) {
            try { await exchange(target.address, target.name); ok++; }
            catch (error) { failure = describeError(error); }
        }
        if (ok) { lastSync = Date.now(); lastError = ''; }
        else if (failure) lastError = failure;
        busy = false;
        render();
    }

    function schedule() {
        clearInterval(timer);
        if (!settings.enabled || !available() || !normalizeCode(settings.code)) return;
        timer = setInterval(() => { if (!document.hidden) syncNow(); }, desktop ? 20000 : 15000);
        syncNow();
    }
    // A local change goes out a moment after typing stops.
    window.addEventListener('fgs-notes-changed', () => {
        if (!settings.enabled) return;
        clearTimeout(pushTimer);
        pushTimer = setTimeout(syncNow, 2500);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && settings.enabled) syncNow(); });

    async function applyState() {
        const code = normalizeCode(settings.code);
        if (desktop) {
            try {
                if (settings.enabled && code) {
                    const { group } = await keys();
                    info = await window.electron.syncStart({ group, device: settings.device, name: '' });
                } else info = await window.electron.syncStop();
            } catch (error) { lastError = describeError(error); }
        }
        schedule();
        render();
    }

    // ---------- settings panel ----------
    const $ = id => document.getElementById(id);
    function render() {
        const panel = $('sync-status');
        if (!panel) return;
        $('sync-enabled').checked = !!settings.enabled;
        if (document.activeElement !== $('sync-code')) $('sync-code').value = settings.code;
        if (document.activeElement !== $('sync-peer')) $('sync-peer').value = settings.peer;
        $('sync-row-address').hidden = !desktop;
        if (desktop) $('sync-address').textContent = info && info.addresses && info.addresses.length
            ? info.addresses.map(address => (info.port && info.port !== DEFAULT_PORT ? `${address}:${info.port}` : address)).join(', ')
            : (settings.enabled ? t('Нет подключения к сети') : t('Появится, когда синхронизация включена'));
        $('sync-peer-desc').textContent = desktop
            ? t('Необязательно. Компьютеры в одной сети находят друг друга сами')
            : t('Адрес виден в настройках FgSNotes на компьютере, в разделе «Синхронизация»');
        let status;
        if (!available()) status = t('Синхронизация работает в приложении для компьютера и телефона');
        else if (!settings.enabled) status = t('Выключена');
        else if (!normalizeCode(settings.code)) status = t('Впишите код синхронизации');
        else if (busy) status = t('Синхронизация…');
        else if (lastError) status = lastError;
        else if (lastSync) {
            const names = [...new Set(seen.values())];
            status = t('Синхронизировано в {time}', { time: new Date(lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
                + (names.length ? '. ' + t('Устройства: {list}', { list: names.join(', ') }) : '');
        } else status = desktop ? t('Ищем другие устройства в сети…') : (settings.peer ? t('Подключаемся…') : t('Впишите адрес компьютера'));
        panel.textContent = status;
        $('sync-now').disabled = !settings.enabled || busy || !available();
        $('sync-copy').disabled = !normalizeCode(settings.code);
    }

    function bindPanel() {
        if (!$('sync-status')) return;
        $('sync-enabled').addEventListener('change', event => {
            settings.enabled = event.target.checked;
            if (settings.enabled && !normalizeCode(settings.code)) settings.code = newCode();
            saveSettings();
            applyState();
        });
        $('sync-code').addEventListener('change', event => {
            const code = normalizeCode(event.target.value);
            if (code && code.length < 8) { lastError = t('Код слишком короткий: нужно хотя бы 8 букв и цифр'); render(); return; }
            settings.code = event.target.value.trim().toUpperCase();
            lastError = ''; seen.clear();
            saveSettings();
            applyState();
        });
        $('sync-new-code').addEventListener('click', () => {
            settings.code = newCode();
            lastError = ''; seen.clear();
            saveSettings();
            applyState();
        });
        $('sync-copy').addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(settings.code); $('sync-status').textContent = t('Код скопирован'); }
            catch { $('sync-code').select(); }
        });
        $('sync-peer').addEventListener('change', event => {
            settings.peer = event.target.value.trim();
            lastError = '';
            saveSettings();
            syncNow();
            render();
        });
        $('sync-now').addEventListener('click', syncNow);
        window.addEventListener('fgs-language', render);
    }

    function start() {
        if (desktop) window.electron.onSyncRequest(answer);
        bindPanel();
        applyState();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    return Object.assign(api, { syncNow });
});
