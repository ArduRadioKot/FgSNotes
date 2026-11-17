const { app, BrowserWindow, ipcMain, nativeTheme, shell, safeStorage, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const ollama = require('./ollama');
const providers = require('./providers');
const agents = require('./agents');
const { createKeystore } = require('./keystore');
const updater = require('./updater');
const { createSyncTransport } = require('./sync-server');
const { createGoogleCalendar, isGoogleIcsUrl } = require('./google-calendar');
const { createMcpServer, connectionSnippets, newToken: newMcpToken } = require('./mcp-server');
const i18n = require('./src/i18n');
const tuiCommand = require('./tui-command');

function useLanguage(code) {
  const lang = code === 'en' || code === 'ru' ? code : (/^ru/i.test(app.getLocale() || '') ? 'ru' : 'en');
  i18n.setLanguage(lang);
  return lang;
}

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

function tuiEditorPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'tui.js')
    : path.join(app.getAppPath(), 'tui.js');
}
function tuiPathEnv() {
  if (process.platform !== 'win32') return process.env.PATH || '';
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], { encoding: 'utf8' });
    const line = out.split(/\r?\n/).find(item => /Path\s+REG_/i.test(item));
    return line ? line.replace(/^.*REG_\w+\s+/, '').trim() : '';
  } catch { return ''; }
}
function tuiOptions() {
  return {
    fs,
    platform: process.platform,
    home: os.homedir(),
    envPath: tuiPathEnv(),
    execPath: process.execPath,
    tuiPath: tuiEditorPath(),
    tmpFile: path.join(os.tmpdir(), 'fgsnotes-command'),
    elevate: process.platform === 'darwin' ? command => {
      execFileSync('osascript', ['-e', `do shell script ${JSON.stringify(command)} with administrator privileges`]);
    } : null,
    setPath: process.platform === 'win32' ? value => {
      execFileSync('reg', ['add', 'HKCU\\Environment', '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', value, '/f']);
    } : null
  };
}
ipcMain.handle('tui-command-status', () => tuiCommand.status(tuiOptions()));
ipcMain.handle('tui-command-install', () => tuiCommand.install(tuiOptions()));
ipcMain.handle('tui-command-remove', () => tuiCommand.remove(tuiOptions()));

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

// Sync over the local network. Requests from other devices go to the page (it holds the notes and the key) and its
// answer goes back; the page sends its own notes through send. Only sealed text passes through here.
const syncReplies = new Map();
let syncReplyId = 0;
const lanSync = createSyncTransport({
  log: (...args) => console.warn(...args),
  onRequest: body => new Promise(resolve => {
    const win = liveWindow();
    if (!win || win.webContents.isDestroyed()) return resolve(null);
    const id = ++syncReplyId;
    const timer = setTimeout(() => { syncReplies.delete(id); resolve(null); }, 20000);
    syncReplies.set(id, answer => { clearTimeout(timer); syncReplies.delete(id); resolve(answer); });
    win.webContents.send('sync-incoming', { id, body });
  })
});
ipcMain.on('sync-reply', (event, { id, body }) => { const done = syncReplies.get(id); if (done) done(typeof body === 'string' ? body : null); });
ipcMain.handle('sync-start', (event, identity) => lanSync.start(identity));
ipcMain.handle('sync-stop', () => { lanSync.stop(); return lanSync.info(); });
ipcMain.handle('sync-peers', () => lanSync.peers());
ipcMain.handle('sync-send', (event, { address, body }) => lanSync.send(address, String(body)));
app.on('will-quit', () => lanSync.stop());

// Access for outside assistants (MCP). The notes live in the page, so a tool call is relayed there, like a sync request.
const mcpReplies = new Map();
let mcpReplyId = 0;
const mcp = createMcpServer({
  version: app.getVersion(),
  log: (...args) => console.warn(...args),
  runTool: (name, args) => new Promise((resolve, reject) => {
    const win = liveWindow();
    if (!win || win.webContents.isDestroyed()) return reject(new Error('The FgSNotes window is closed'));
    const id = ++mcpReplyId;
    const timer = setTimeout(() => { mcpReplies.delete(id); reject(new Error('FgSNotes did not answer in time')); }, 20000);
    mcpReplies.set(id, answer => {
      clearTimeout(timer);
      mcpReplies.delete(id);
      if (answer && answer.ok) resolve(answer.result); else reject(new Error((answer && answer.error) || 'The tool failed'));
    });
    win.webContents.send('mcp-call', { id, name, args });
  })
});
ipcMain.on('mcp-reply', (event, { id, ...answer }) => { const done = mcpReplies.get(id); if (done) done(answer); });
// The port and key for the stdio relay; the relay reads this file on every request, so a new key or port just works.
const mcpFile = () => path.join(app.getPath('userData'), 'mcp.json');
function readMcpToken() {
  try { const { token } = JSON.parse(fs.readFileSync(mcpFile(), 'utf8')); if (token) return token; } catch { /* first start */ }
  return newMcpToken();
}
function writeMcpFile(token, port) {
  fs.mkdirSync(path.dirname(mcpFile()), { recursive: true });
  fs.writeFileSync(mcpFile(), JSON.stringify({ token, port }), { mode: 0o600 });
}
function mcpState(token) {
  const state = mcp.info();
  if (!state.running) return state;
  return { ...state, snippets: connectionSnippets({ port: state.port, token, execPath: process.execPath, script: path.join(app.getAppPath(), 'mcp-stdio.js'), connectionFile: mcpFile() }) };
}
ipcMain.handle('mcp-start', async (event, { write }) => {
  const token = readMcpToken();
  const { port } = await mcp.start({ token, write });
  writeMcpFile(token, port);
  return mcpState(token);
});
ipcMain.handle('mcp-stop', () => {
  const token = readMcpToken();
  mcp.stop();
  writeMcpFile(token, 0);
  return mcpState(token);
});
ipcMain.handle('mcp-new-token', () => {
  const token = newMcpToken();
  mcp.setToken(token);
  writeMcpFile(token, mcp.info().port);
  return mcpState(token);
});
app.on('will-quit', () => { if (mcp.info().running) writeMcpFile(readMcpToken(), 0); mcp.stop(); });

// Google Calendar (the standard Calendar plugin). Tokens stay here; see google-calendar.js.
let googleCalendar = null;
const google = () => googleCalendar || (googleCalendar = createGoogleCalendar({
  keystore: createKeystore(path.join(app.getPath('userData'), 'google-calendar.json'), safeStorage),
  openBrowser: url => shell.openExternal(url)
}));
ipcMain.handle('google-status', () => google().status());
ipcMain.handle('google-connect', (event, credentials) => google().connect(credentials));
ipcMain.handle('google-disconnect', () => google().disconnect());
ipcMain.handle('google-calendars', () => google().calendars());
ipcMain.handle('google-events', (event, request) => google().events(request));
ipcMain.handle('google-save', (event, request) => google().save(request));
ipcMain.handle('google-remove', (event, request) => google().remove(request));
ipcMain.handle('calendar-fetch-ics', async (event, address) => {
  if (!isGoogleIcsUrl(address)) throw new Error('bad address');
  const response = await fetch(address, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.text();
});

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
const obsidianId = /^[a-zA-Z0-9._-]{1,80}$/;
function pluginsDir() {
  const dir = path.join(app.getPath('documents'), 'FgSNotes', 'plugins');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function registerPluginHandlers() {
  for (const channel of ['plugin-read-builtin', 'plugins-list', 'plugin-read', 'plugin-install', 'plugin-install-obsidian', 'plugin-read-obsidian', 'plugin-remove', 'plugins-open']) ipcMain.removeHandler(channel);
  ipcMain.handle('plugin-read-builtin', (event, file) => {
    if (!pluginName.test(String(file))) throw new Error(i18n.t('Неверное имя плагина'));
    return fs.readFileSync(path.join(__dirname, 'src', 'builtin-plugins', path.basename(file)), 'utf-8');
  });
  ipcMain.handle('plugins-list', () => {
    try {
      const dir = pluginsDir();
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        if (entry.name.startsWith('.')) return [];
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && fs.existsSync(path.join(full, 'manifest.json')) && fs.existsSync(path.join(full, 'main.js'))) {
          return [{ file: `obsidian:${entry.name}`, size: 0 }];
        }
        if (!entry.isDirectory() && pluginName.test(entry.name)) return [{ file: entry.name, size: fs.statSync(full).size }];
        return [];
      });
    } catch (error) { console.error('Ошибка чтения папки плагинов:', error); return []; }
  });
  ipcMain.handle('plugin-read', (event, file) => {
    if (!pluginName.test(String(file))) throw new Error(i18n.t('Неверное имя плагина'));
    const target = path.join(pluginsDir(), file);
    if (fs.statSync(target).size > 2 * 1024 * 1024) throw new Error(i18n.t('Плагин больше 2 МБ'));
    return fs.readFileSync(target, 'utf-8');
  });
  // The install button: pick files, confirm (a plugin runs with access to every note), copy them into the plugins folder.
  ipcMain.handle('plugin-install', async event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const picked = await dialog.showOpenDialog(win, {
      title: i18n.t('Установить плагин'), properties: ['openFile', 'multiSelections'],
      filters: [{ name: i18n.t('Плагины FgSNotes (.js, .css)'), extensions: ['js', 'css'] }]
    });
    if (picked.canceled || !picked.filePaths.length) return { canceled: true, installed: [] };
    const files = picked.filePaths.filter(file => pluginName.test(path.basename(file)));
    if (!files.length) return { canceled: false, installed: [], error: i18n.t('Нужны файлы .js или .css') };
    const confirm = await dialog.showMessageBox(win, {
      type: 'warning', buttons: [i18n.t('Установить'), i18n.t('Отмена')], defaultId: 1, cancelId: 1,
      message: files.length === 1 ? i18n.t('Установить плагин «{name}»?', { name: path.basename(files[0]) }) : i18n.t('Установить плагины ({count})?', { count: files.length }),
      detail: i18n.t('Плагин: это программа. Он выполняется внутри FgSNotes и видит все ваши заметки. Устанавливайте только те плагины, которым доверяете.\n\nФайлы будут скопированы в папку Documents/FgSNotes/plugins.')
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
  function copyObsidianDir(dir) {
    const manifestPath = path.join(dir, 'manifest.json');
    const mainPath = path.join(dir, 'main.js');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(mainPath)) return { ok: false, error: i18n.t('В папке нужны manifest.json и main.js') };
    if (fs.statSync(mainPath).size > 2 * 1024 * 1024) return { ok: false, error: i18n.t('Плагин больше 2 МБ') };
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return { ok: false, error: i18n.t('В папке нужны manifest.json и main.js') }; }
    const id = String((manifest && manifest.id) || path.basename(dir)).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
    if (!obsidianId.test(id)) return { ok: false, error: i18n.t('Неверное имя плагина') };
    const css = path.join(dir, 'styles.css');
    return { ok: true, id, manifestPath, mainPath, css: fs.existsSync(css) && fs.statSync(css).size <= 2 * 1024 * 1024 ? css : '' };
  }
  function writeObsidian(source) {
    const dest = path.join(pluginsDir(), source.id);
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(source.manifestPath, path.join(dest, 'manifest.json'));
    fs.copyFileSync(source.mainPath, path.join(dest, 'main.js'));
    if (source.css) fs.copyFileSync(source.css, path.join(dest, 'styles.css'));
    else fs.rmSync(path.join(dest, 'styles.css'), { force: true });
  }
  ipcMain.handle('plugin-install-obsidian', async event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const picked = await dialog.showOpenDialog(win, {
      title: i18n.t('Плагин Obsidian'), properties: ['openDirectory']
    });
    if (picked.canceled || !picked.filePaths.length) return { canceled: true, installed: [] };
    const copied = copyObsidianDir(picked.filePaths[0]);
    if (!copied.ok) return { canceled: false, installed: [], error: copied.error };
    const confirm = await dialog.showMessageBox(win, {
      type: 'warning', buttons: [i18n.t('Установить'), i18n.t('Отмена')], defaultId: 1, cancelId: 1,
      message: i18n.t('Установить плагин «{name}»?', { name: copied.id }),
      detail: i18n.t('Плагин: это программа. Он выполняется внутри FgSNotes и видит все ваши заметки. Устанавливайте только те плагины, которым доверяете.\n\nФайлы будут скопированы в папку Documents/FgSNotes/plugins.')
    });
    if (confirm.response !== 0) return { canceled: true, installed: [] };
    writeObsidian(copied);
    return { canceled: false, installed: [`obsidian:${copied.id}`] };
  });
  ipcMain.handle('plugin-read-obsidian', (event, id) => {
    if (!obsidianId.test(String(id))) throw new Error(i18n.t('Неверное имя плагина'));
    const dir = path.join(pluginsDir(), id);
    const root = path.resolve(pluginsDir());
    if (!path.resolve(dir).startsWith(root + path.sep)) throw new Error(i18n.t('Неверное имя плагина'));
    const mainPath = path.join(dir, 'main.js');
    if (fs.statSync(mainPath).size > 2 * 1024 * 1024) throw new Error(i18n.t('Плагин больше 2 МБ'));
    const cssPath = path.join(dir, 'styles.css');
    return {
      manifest: JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
      main: fs.readFileSync(mainPath, 'utf8'),
      css: fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : ''
    };
  });
  ipcMain.handle('plugin-remove', (event, file) => {
    const name = String(file || '');
    if (name.startsWith('obsidian:')) {
      const id = name.slice('obsidian:'.length);
      if (!obsidianId.test(id)) throw new Error(i18n.t('Неверное имя плагина'));
      fs.rmSync(path.join(pluginsDir(), id), { recursive: true, force: true });
      return true;
    }
    if (!pluginName.test(name)) throw new Error(i18n.t('Неверное имя плагина'));
    fs.rmSync(path.join(pluginsDir(), name), { force: true });
    return true;
  });
  ipcMain.handle('plugins-open', () => shell.openPath(pluginsDir()));
}

let appConfig = null;
let configFilePath = null;
let themesDirPath = null;
let windowSerial = 0;

function ensureConfig() {
  if (configFilePath) return;
  const loaded = loadAppConfig();
  appConfig = loaded.configContent;
  configFilePath = loaded.configFilePath;
  themesDirPath = loaded.themesDirPath;
}

// The window the person is using. Sync and outside tools talk to that one, whichever of the open windows it is.
function liveWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  return BrowserWindow.getAllWindows().find(win => !win.isDestroyed()) || null;
}

function buildMenu() {
  const file = {
    label: i18n.t('Файл'),
    submenu: [
      { label: i18n.t('Новое окно'), click: () => createWindow() },
      { type: 'separator' },
      { role: 'close' }
    ]
  };
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: 'FgSNotes',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    file,
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Right-click on the Dock icon. The ordinary click still focuses a window (or opens one when none are left).
function buildDock() {
  if (process.platform !== 'darwin' || !app.dock) return;
  app.dock.setMenu(Menu.buildFromTemplate([
    { label: i18n.t('Новое окно'), click: () => createWindow() }
  ]));
}

// Handlers stay for the life of the process. Creating another window must not tear them down.
function registerWindowIpc() {
  ensureConfig();
  registerPluginHandlers();
  ipcMain.handle('get-config', () => appConfig);
  ipcMain.handle('get-themes-path', () => themesDirPath);
  ipcMain.handle('get-themes-list', () => {
    try {
      return fs.readdirSync(themesDirPath).filter(file => file.endsWith('.css'));
    } catch (error) {
      console.error('Ошибка чтения папки тем:', error);
      return [];
    }
  });
  ipcMain.handle('window-new', () => {
    createWindow();
    return BrowserWindow.getAllWindows().length;
  });
  ipcMain.on('set-language', (event, code) => { useLanguage(code); buildMenu(); buildDock(); });
  ipcMain.on('save-config', (event, config) => {
    try {
      appConfig = config;
      fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('Ошибка сохранения config.json:', error);
    }
  });
}

function createWindow() {
  ensureConfig();
  useLanguage(appConfig && appConfig.language);
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
        `--fgs-config=${Buffer.from(JSON.stringify(appConfig)).toString('base64')}`
      ],
    },
    // A translucent native window: the page stays opaque until Liquid Glass makes its background transparent.
    // Without a system blur the window is a plain dark one (a transparent colour would show black or white).
    backgroundColor: nativeBlur ? '#00000000' : windowColor(),
    ...(process.platform === 'darwin' ? { vibrancy: 'under-window', visualEffectState: 'active' } : {}),
    icon: path.join(__dirname, 'src', 'icon.png')
  });
  windowSerial += 1;
  if (windowSerial > 1) {
    const [x, y] = win.getPosition();
    const step = 28 * ((windowSerial - 1) % 12);
    win.setPosition(x + step, y + step);
  }
  win.loadFile(path.join(__dirname, 'src', 'MarkDownEditor.html'));
  return win;
}

// Two processes sharing one profile fight over its storage, so a second launch only brings this copy forward.
// Inside that copy the number of windows is not capped: each "Новое окно" is another window, like another terminal.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => {
  const win = liveWindow();
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
    message: i18n.t('FgSNotes работает через Rosetta'),
    detail: i18n.t('Установлена версия для процессоров Intel, поэтому приложение запускается и работает заметно медленнее. Скачайте версию для Apple Silicon (файл с «arm64» в названии) и замените ею это приложение.'),
    buttons: [i18n.t('Открыть страницу загрузки'), i18n.t('Позже')],
    defaultId: 0, cancelId: 1
  }).then(({ response }) => { if (response === 0) shell.openExternal(repositoryUrl + '/releases/latest'); });
}

app.whenReady().then(() => {
  if (!primaryInstance) return;
  ensureConfig();
  useLanguage(appConfig && appConfig.language);
  registerWindowIpc();
  buildMenu();
  buildDock();
  updater.register(ipcMain, { app, BrowserWindow, shell });
  createWindow();
  warnAboutTranslation();

  // A Dock click focuses a window that is already open. With none left, it opens one. It does not replace the others.
  app.on('activate', () => {
    const win = liveWindow();
    if (!win) { createWindow(); return; }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});