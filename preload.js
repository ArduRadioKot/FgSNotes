const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'electron', {
    loadConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (config) => ipcRenderer.send('save-config', config),
    getThemesPath: () => ipcRenderer.invoke('get-themes-path'),
    getThemesList: () => ipcRenderer.invoke('get-themes-list')
  }
); 