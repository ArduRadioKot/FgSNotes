// Where the notes are kept on this device: IndexedDB, which has no practical size limit (localStorage stops at about
// 5 MB and then refuses every save). The workspace is one JSON text, written whole. Notes saved by older versions in
// localStorage are moved over on the first start. If IndexedDB cannot be opened, localStorage is used as before.
// A write to IndexedDB finishes a moment later and is lost if the app closes in that moment, so on the way out the
// newest text is also put into localStorage (which writes at once); the next start takes whichever copy is newer.
(function () {
    const LEGACY_KEY = 'fgsnotes.workspace.v1';
    const DB = 'fgsnotes', STORE = 'kv', KEY = 'workspace';
    let database = null;              // a promise of the open database, or of null when IndexedDB is unusable
    let pending = null, writing = null;
    let latest = null, stored = null;     // the newest text handed to save(), and the newest one known to be on disk
    let markRestored;
    const restored = new Promise(resolve => { markRestored = resolve; });

    function open() {
        if (database) return database;
        database = new Promise(resolve => {
            let request;
            try { request = indexedDB.open(DB, 1); } catch { resolve(null); return; }
            request.onupgradeneeded = () => request.result.createObjectStore(STORE);
            request.onsuccess = () => resolve(request.result);
            request.onerror = request.onblocked = () => resolve(null);
        });
        return database;
    }
    function run(db, mode, action) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE, mode);
            const request = action(transaction.objectStore(STORE));
            transaction.oncomplete = () => resolve(request.result);
            transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Storage failed'));
        });
    }
    const legacy = () => { try { return localStorage.getItem(LEGACY_KEY); } catch { return null; } };

    // Every saved text starts with {"savedAt":<time>; texts from older versions have no time and count as oldest.
    const savedAt = text => Number((/^\{"savedAt":(\d+)/.exec(text || '') || [])[1]) || 0;

    // The saved workspace as JSON text, or null on a first start.
    async function load() {
        const db = await open(), spare = legacy();
        if (!db) return spare;
        let main = null;
        try { main = await run(db, 'readonly', store => store.get(KEY)); } catch { /* the spare copy, if there is one */ }
        return main && savedAt(main) >= savedAt(spare) ? main : spare || main || null;
    }

    async function write(text) {
        const db = await open();
        if (!db) { localStorage.setItem(LEGACY_KEY, text); return; }
        await run(db, 'readwrite', store => store.put(text, KEY));
        stored = text;
        try { if (savedAt(legacy()) <= savedAt(text)) localStorage.removeItem(LEGACY_KEY); } catch { /* the old copy only takes space */ }
    }
    // Saves follow each other; while one is being written only the newest waiting text is kept.
    function save(text) {
        pending = latest = text;
        if (!writing) {
            writing = (async () => {
                try { while (pending !== null) { const next = pending; pending = null; await write(next); } }
                finally { writing = null; }
            })();
        }
        return writing;
    }

    // Called while the app is closing: whatever has not reached IndexedDB yet goes to localStorage, if it fits.
    function flush() {
        if (latest === null || latest === stored) return;
        try { localStorage.setItem(LEGACY_KEY, latest); } catch { /* too large for localStorage: the write in progress is the only hope */ }
    }

    window.FgsStore = { load, save, flush, restored, markRestored };
})();
