// API keys live in the main process only. They are encrypted with the system keychain (Electron safeStorage) when it is
// available; otherwise they are stored in a file readable by the user alone, and the settings say so.
const fs = require('fs');
const path = require('path');

function createKeystore(file, safeStorage) {
    const encrypted = () => !!(safeStorage && safeStorage.isEncryptionAvailable());
    let cache = null;
    function load() {
        if (cache) return cache;
        try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cache = {}; }
        return cache;
    }
    function save() {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(cache), { mode: 0o600 });
    }
    return {
        secure: encrypted,
        has: provider => !!load()[provider],
        get(provider) {
            const entry = load()[provider];
            if (!entry) return '';
            try { return entry.enc ? safeStorage.decryptString(Buffer.from(entry.value, 'base64')) : entry.value; } catch { return ''; }
        },
        set(provider, key) {
            const value = String(key || '').trim();
            if (!value) return this.clear(provider);
            load()[provider] = encrypted() ? { enc: true, value: safeStorage.encryptString(value).toString('base64') } : { enc: false, value };
            save();
        },
        clear(provider) { delete load()[provider]; save(); },
        status: providers => Object.fromEntries(providers.map(id => [id, !!load()[id]]))
    };
}

module.exports = { createKeystore };
