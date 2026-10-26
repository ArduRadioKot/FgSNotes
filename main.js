const { app, BrowserWindow, ipcMain, nativeTheme, shell, safeStorage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const ollama = require('./ollama');
const providers = require('./providers');
const agents = require('./agents');
const { createKeystore } = require('./keystore');
const updater = require('./updater');

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
  let parsed;
  try { parsed = new URL(String(url)); } catch { return; }
  if (parsed.protocol !== 'https:') return;
  const path = parsed.pathname;
  const host = parsed.hostname;
  const github = host === 'github.com' && /^\/(?:ArduRadioKot|anthropics\/claude-code|openai\/codex)(?:\/|$)/.test(path);
  const site = host === 'ollama.com' || host === 'lmstudio.ai' || host === 'code.claude.com' || host === 'developers.openai.com';
  const keyPage = (host === 'platform.openai.com' && path.startsWith('/api-keys'))
    || (host === 'console.anthropic.com' && path.startsWith('/settings/keys'))
    || (host === 'aistudio.google.com' && path.startsWith('/apikey'))
    || (host === 'openrouter.ai' && path.startsWith('/keys'))
    || (host === 'console.groq.com' && path.startsWith('/keys'));
  if (github || site || keyPage) shell.openExternal(parsed.href);
});

// Ollama: the renderer asks for models and streams a chat; every request has an id so it can be stopped.
const aiRequests = new Map();
// API keys are kept in the main process (encrypted by the system keychain when possible) and never sent to the page.
let keystore = null;
const keys = () => keystore || (keystore = createKeystore(path.join(app.getPath('userData'), 'ai-keys.json'), safeStorage));
const knownProvider = id => { if (!providers.PRESETS[id]) throw new Error('Неизвестный провайдер'); return id; };
const keyStatus = () => ({ keys: keys().status(Object.keys(providers.PRESETS)), secure: keys().secure() });
ipcMain.handle('ai-key-status', () => keyStatus());
ipcMain.handle('ai-key-set', (event, { provider, key }) => { keys().set(knownProvider(provider), key); return keyStatus(); });
ipcMain.handle('ai-key-clear', (event, provider) => { keys().clear(knownProvider(provider)); return keyStatus(); });
const cliProvider = provider => provider === 'claude-code' || provider === 'codex';
ipcMain.handle('ai-models', (event, { provider, url }) => cliProvider(provider) ? agents.listModels(provider) : providers.listModels({ provider, url, key: keys().get(provider) }));
ipcMain.handle('ai-chat', async (event, { id, provider, url, model, messages, temperature, think }) => {
  const controller = new AbortController();
  aiRequests.set(id, controller);
  const send = payload => { if (!event.sender.isDestroyed()) event.sender.send('ai-chunk', { id, ...payload }); };
  const result = cliProvider(provider)
    ? await agents.chat({ provider, model, messages }, delta => send({ delta }), controller.signal, text => send({ thinking: text }))
    : await providers.chat({ provider, url, key: keys().get(provider), model, messages, temperature, think: !!think },
      delta => send({ delta }), controller.signal, text => send({ thinking: text }));
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

// --- plugins: .js and .css files in Documents/FgSNotes/plugins, found and installed like themes ------------------------------
const pluginName = /^[^\\/:*?"<>|\0]{1,120}\.(?:js|css)$/i;
function pluginsDir() {
  const dir = path.join(app.getPath('documents'), 'FgSNotes', 'plugins');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function registerPluginHandlers() {
  for (const channel of ['plugins-list', 'plugin-read', 'plugin-install', 'plugin-remove', 'plugins-open', 'plugins-path']) ipcMain.removeHandler(channel);
  ipcMain.handle('plugins-path', () => pluginsDir());
  ipcMain.handle('plugins-list', () => {
    try {
      return fs.readdirSync(pluginsDir()).filter(name => pluginName.test(name) && !name.startsWith('.'))
        .map(name => ({ file: name, size: fs.statSync(path.join(pluginsDir(), name)).size }));
    } catch (error) { console.error('Ошибка чтения папки плагинов:', error); return []; }
  });
  ipcMain.handle('plugin-read', (event, file) => {
    if (!pluginName.test(String(file))) throw new Error('Неверное имя плагина');
    const target = path.join(pluginsDir(), file);
    if (fs.statSync(target).size > 2 * 1024 * 1024) throw new Error('Плагин больше 2 МБ');
    return fs.readFileSync(target, 'utf-8');
  });
  // The install button: pick files, confirm (a plugin runs with access to every note), copy them into the plugins folder.
  ipcMain.handle('plugin-install', async event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const picked = await dialog.showOpenDialog(win, {
      title: 'Установить плагин', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Плагины FgSNotes (.js, .css)', extensions: ['js', 'css'] }]
    });
    if (picked.canceled || !picked.filePaths.length) return { canceled: true, installed: [] };
    const files = picked.filePaths.filter(file => pluginName.test(path.basename(file)));
    if (!files.length) return { canceled: false, installed: [], error: 'Нужны файлы .js или .css' };
    const confirm = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Установить', 'Отмена'], defaultId: 1, cancelId: 1,
      message: files.length === 1 ? `Установить плагин «${path.basename(files[0])}»?` : `Установить плагины (${files.length})?`,
      detail: 'Плагин — это программа: он выполняется внутри FgSNotes и видит все ваши заметки. Устанавливайте только те плагины, которым доверяете.\n\nФайлы будут скопированы в папку Documents/FgSNotes/plugins.'
    });
    if (confirm.response !== 0) return { canceled: true, installed: [] };
    const installed = [];
    for (const file of files) {
      const name = path.basename(file);
      if (fs.statSync(file).size > 2 * 1024 * 1024) continue;
      fs.copyFileSync(file, path.join(pluginsDir(), name));
      installed.push(name);
    }
    return { canceled: false, installed };
  });
  ipcMain.handle('plugin-remove', (event, file) => {
    if (!pluginName.test(String(file))) throw new Error('Неверное имя плагина');
    fs.rmSync(path.join(pluginsDir(), file), { force: true });
    return true;
  });
  ipcMain.handle('plugins-open', () => shell.openPath(pluginsDir()));
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
  registerPluginHandlers();

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

// An Intel build on an Apple Silicon Mac runs under Rosetta: the same app starts 3-5 times slower and feels sluggish.
// Tell the person once per version, with the way out.
function warnAboutTranslation() {
  if (!app.runningUnderARM64Translation) return;
  const marker = path.join(app.getPath('userData'), `rosetta-warned-${app.getVersion()}`);
  if (fs.existsSync(marker)) return;
  try { fs.writeFileSync(marker, ''); } catch { /* the warning may repeat, which is harmless */ }
  dialog.showMessageBox({
    type: 'info',
    message: 'FgSNotes работает через Rosetta',
    detail: 'Установлена версия для процессоров Intel, поэтому приложение запускается и работает заметно медленнее. Скачайте версию для Apple Silicon (файл с «arm64» в названии) и замените ею это приложение.',
    buttons: ['Открыть страницу загрузки', 'Позже'],
    defaultId: 0, cancelId: 1
  }).then(({ response }) => { if (response === 0) shell.openExternal(repositoryUrl + '/releases/latest'); });
}

app.whenReady().then(() => {
  if (!primaryInstance) return;
  updater.register(ipcMain, { app, BrowserWindow, shell });
  createWindow();
  warnAboutTranslation();

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