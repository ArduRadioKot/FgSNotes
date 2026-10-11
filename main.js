const { app, BrowserWindow, ipcMain, nativeTheme, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const ollama = require('./ollama');

// `npm start` and the installed app share the name, so they would share one profile, and the installed (single-instance)
// copy keeps it locked: the dev copy then quits silently. Development gets a profile of its own.
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'fgsnotes-dev'));

// Only macOS gives a translucent window (vibrancy). On Windows the acrylic material is unreliable: depending on the
// system the window comes out plain white, and with it the whole glass UI. So Windows and Linux get an opaque window
// painted in the theme colour, and Liquid Glass works inside the app (lenses and frosted panels over the page).
const nativeBlur = process.platform === 'darwin';
const windowColor = () => (nativeTheme.shouldUseDarkColors ? '#17181a' : '#e8ebf1');

const repositoryUrl = 'https://github.com/ArduRadioKot/FgSNotes';
app.setAboutPanelOptions({ applicationName: 'FgSNotes', copyright: '© FrogeeSoft', website: repositoryUrl });

// The native blur follows the system appearance, so keep it in step with the app theme.
ipcMain.on('set-native-theme', (event, theme) => {
  nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark';
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !nativeBlur) win.setBackgroundColor(windowColor());
});

ipcMain.handle('get-app-info', () => ({
  name: 'FgSNotes',
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  platform: `${process.platform} ${process.arch}`,
  nativeBlur
}));
ipcMain.on('open-external', (event, url) => {
  if (/^https:\/\/(?:github\.com\/ArduRadioKot|ollama\.com)/i.test(String(url))) shell.openExternal(url);
});

// Ollama: the renderer asks for models and streams a chat; every request has an id so it can be stopped.
const aiRequests = new Map();
ipcMain.handle('ai-models', (event, url) => ollama.listModels(url));
ipcMain.handle('ai-chat', async (event, { id, url, model, messages, temperature }) => {
  const controller = new AbortController();
  aiRequests.set(id, controller);
  const result = await ollama.chat({ url, model, messages, temperature }, delta => {
    if (!event.sender.isDestroyed()) event.sender.send('ai-chunk', { id, delta });
  }, controller.signal, () => {
    if (!event.sender.isDestroyed()) event.sender.send('ai-chunk', { id, thinking: true });
  });
  aiRequests.delete(id);
  return result;
});
ipcMain.handle('ai-detect', () => ollama.findInstall());
ipcMain.handle('ai-launch', () => ollama.launch());
ipcMain.handle('ai-pull', async (event, { id, url, model }) => {
  const controller = new AbortController();
  aiRequests.set(id, controller);
  const result = await ollama.pull({ url, model }, progress => {
    if (!event.sender.isDestroyed()) event.sender.send('ai-pull-progress', { id, ...progress });
  }, controller.signal);
  aiRequests.delete(id);
  return result;
});
ipcMain.on('ai-abort', (event, id) => { const controller = aiRequests.get(id); if (controller) controller.abort(); });

const fallbackConfig = {
  'theme': 'dark',
  'font-size': 'medium',
  'font-family': 'mono',
  'line-height': '1.6',
  'liquid-glass': 'off',
  'tab-size': '4',
  'word-wrap': 'on',
  'auto-save': '5',
  'preview-theme': 'default',
  'math-support': 'on',
  'table-of-contents': 'on',
  'todo-list': 'on',
  'code-highlight': 'on',
  'external-theme': ''
};

function loadAppConfig() {
  const documentsPath = app.getPath('documents');
  const appConfigDirPath = path.join(documentsPath, 'FgSNotes');
  const configFilePath = path.join(appConfigDirPath, 'config.json');
  const themesDirPath = path.join(appConfigDirPath, 'themes');
  const pluginsDirPath = path.join(appConfigDirPath, 'plugins');

  for (const dir of [appConfigDirPath, themesDirPath, pluginsDirPath]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  let configContent = fallbackConfig;
  if (!fs.existsSync(configFilePath)) {
    fs.writeFileSync(configFilePath, JSON.stringify(fallbackConfig, null, 2));
  } else {
    try {
      configContent = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
    } catch (error) {
      console.error('Ошибка чтения config.json:', error);
      configContent = fallbackConfig;
    }
  }
  return { configContent, configFilePath, themesDirPath };
}

function createWindow() {
  const { configContent: initialConfig, configFilePath, themesDirPath } = loadAppConfig();
  let configContent = initialConfig;

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
      additionalArguments: [
        `--fgs-native-blur=${nativeBlur ? 1 : 0}`,
        `--fgs-config=${Buffer.from(JSON.stringify(configContent)).toString('base64')}`
      ],
    },
    // A translucent native window: the page stays opaque until Liquid Glass makes its background transparent.
    // Without a system blur the window is a plain dark one (a transparent colour would show black or white).
    backgroundColor: nativeBlur ? '#00000000' : windowColor(),
    ...(process.platform === 'darwin' ? { vibrancy: 'under-window', visualEffectState: 'active' } : {}),
    icon: path.join(__dirname, 'src', 'icon.png')
  });

  // createWindow runs again on macOS 'activate', so drop handlers from the previous window first.
  ['get-config', 'get-themes-path', 'get-themes-list'].forEach(channel => ipcMain.removeHandler(channel));
  ipcMain.removeAllListeners('save-config');

  ipcMain.handle('get-config', () => {
    return configContent;
  });

  // Добавляем новый обработчик для получения пути к папке themes
  ipcMain.handle('get-themes-path', () => {
    return themesDirPath;
  });

  // Добавляем новый обработчик для получения списка тем
  ipcMain.handle('get-themes-list', () => {
    try {
      const themeFiles = fs.readdirSync(themesDirPath);
      const cssThemes = themeFiles.filter(file => file.endsWith('.css'));
      return cssThemes;
    } catch (error) {
      console.error('Ошибка чтения папки тем:', error);
      return [];
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'MarkDownEditor.html'));

  ipcMain.on('save-config', (event, config) => {
    try {
      configContent = config;
      fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2));
      console.log('Настройки успешно сохранены в config.json');
    } catch (error) {
      console.error('Ошибка сохранения config.json:', error);
    }
  });

  // win.webContents.openDevTools();
}

// Two copies sharing one profile fight over its storage (the second waits seconds for the first to release it),
// so the app runs once; launching it again brings the open window forward.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  if (!primaryInstance) return;
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});