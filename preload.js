const { contextBridge, ipcRenderer } = require('electron');

function argvValue(prefix) {
    const raw = process.argv.find(entry => entry.startsWith(prefix));
    return raw ? raw.slice(prefix.length) : '';
}
let bootConfig = null;
try {
    const encoded = argvValue('--fgs-config=');
    if (encoded) bootConfig = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
} catch { bootConfig = null; }

const aiListeners = new Set();
const pullListeners = new Set();
ipcRenderer.on('ai-pull-progress', (event, progress) => pullListeners.forEach(listener => listener(progress)));
ipcRenderer.on('ai-chunk', (event, chunk) => aiListeners.forEach(listener => listener(chunk)));
// Sync: one handler answers requests from other devices (the page decrypts, merges and seals the reply).
let syncHandler = null;
ipcRenderer.on('sync-incoming', async (event, { id, body }) => {
    let reply = null;
    try { reply = syncHandler ? await syncHandler(body) : null; } catch { reply = null; }
    ipcRenderer.send('sync-reply', { id, body: reply });
});

contextBridge.exposeInMainWorld(
  'electron', {
    bootConfig,
    loadConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (config) => ipcRenderer.send('save-config', config),
    getThemesPath: () => ipcRenderer.invoke('get-themes-path'),
    getThemesList: () => ipcRenderer.invoke('get-themes-list'),
    getPlugins: () => ipcRenderer.invoke('plugins-list'),
    readPlugin: (file) => ipcRenderer.invoke('plugin-read', file),
    readBuiltinPlugin: (file) => ipcRenderer.invoke('plugin-read-builtin', file),
    installPlugins: () => ipcRenderer.invoke('plugin-install'),
    removePlugin: (file) => ipcRenderer.invoke('plugin-remove', file),
    openPluginsFolder: () => ipcRenderer.invoke('plugins-open'),
    setNativeTheme: (theme) => ipcRenderer.send('set-native-theme', theme),
    setLanguage: (code) => ipcRenderer.send('set-language', code),
    // Whether the system blurs what is behind the window (macOS, Windows 11 22H2+).
    nativeBlur: process.argv.includes('--fgs-native-blur=1'),
    getAppInfo: () => ipcRenderer.invoke('get-app-info'),
    openExternal: (url) => ipcRenderer.send('open-external', url),
    checkUpdates: () => ipcRenderer.invoke('updates-check'),
    downloadUpdate: () => ipcRenderer.invoke('updates-download'),
    installUpdate: () => ipcRenderer.invoke('updates-install'),
    onUpdateProgress: (listener) => {
      const wrapped = (event, progress) => listener(progress);
      ipcRenderer.on('updates-progress', wrapped);
      return () => ipcRenderer.removeListener('updates-progress', wrapped);
    },
    // Ollama
    aiModels: (request) => ipcRenderer.invoke('ai-models', request),
    aiKeyStatus: () => ipcRenderer.invoke('ai-key-status'),
    aiKeySet: (provider, key) => ipcRenderer.invoke('ai-key-set', { provider, key }),
    aiKeyClear: (provider) => ipcRenderer.invoke('ai-key-clear', provider),
    aiChat: (request) => ipcRenderer.invoke('ai-chat', request),
    aiDetect: () => ipcRenderer.invoke('ai-detect'),
    aiLaunch: () => ipcRenderer.invoke('ai-launch'),
    aiPull: (request) => ipcRenderer.invoke('ai-pull', request),
    onAiPull: (listener) => { pullListeners.add(listener); return () => pullListeners.delete(listener); },
    aiAbort: (id) => ipcRenderer.send('ai-abort', id),
    onAiChunk: (listener) => { aiListeners.add(listener); return () => aiListeners.delete(listener); },
    // Google Calendar
    google: {
      status: () => ipcRenderer.invoke('google-status'),
      connect: (credentials) => ipcRenderer.invoke('google-connect', credentials),
      disconnect: () => ipcRenderer.invoke('google-disconnect'),
      calendars: () => ipcRenderer.invoke('google-calendars'),
      events: (request) => ipcRenderer.invoke('google-events', request),
      save: (request) => ipcRenderer.invoke('google-save', request),
      remove: (request) => ipcRenderer.invoke('google-remove', request)
    },
    fetchCalendarIcs: (address) => ipcRenderer.invoke('calendar-fetch-ics', address),
    // Sync over the local network
    syncStart: (identity) => ipcRenderer.invoke('sync-start', identity),
    syncStop: () => ipcRenderer.invoke('sync-stop'),
    syncInfo: () => ipcRenderer.invoke('sync-info'),
    syncPeers: () => ipcRenderer.invoke('sync-peers'),
    syncSend: (address, body) => ipcRenderer.invoke('sync-send', { address, body }),
    onSyncRequest: (handler) => { syncHandler = handler; }
  }
);
