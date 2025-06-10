const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'icon.png')
  });

  const documentsPath = app.getPath('documents');
  const appConfigDirPath = path.join(documentsPath, 'FgSNotes');
  const configFilePath = path.join(appConfigDirPath, 'config.json');
  const themesDirPath = path.join(appConfigDirPath, 'themes');
  const pluginsDirPath = path.join(appConfigDirPath, 'plugins');

  if (!fs.existsSync(appConfigDirPath)) {
    fs.mkdirSync(appConfigDirPath, { recursive: true });
    console.log(`Папка FgSNotes создана по пути: ${appConfigDirPath}`);
  }

  // Проверяем и создаем папку themes, если её нет
  if (!fs.existsSync(themesDirPath)) {
    fs.mkdirSync(themesDirPath, { recursive: true });
    console.log(`Папка themes создана по пути: ${themesDirPath}`);
  }

  // Проверяем и создаем папку plugins, если её нет
  if (!fs.existsSync(pluginsDirPath)) {
    fs.mkdirSync(pluginsDirPath, { recursive: true });
    console.log(`Папка plugins создана по пути: ${pluginsDirPath}`);
  }

  let configContent = {};
  if (!fs.existsSync(configFilePath)) {
    const defaultConfig = {
      'theme': 'dark',
      'font-size': 'medium',
      'font-family': 'mono',
      'line-height': '1.6',
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
    fs.writeFileSync(configFilePath, JSON.stringify(defaultConfig, null, 2));
    console.log(`Файл config.json создан с настройками по умолчанию по пути: ${configFilePath}`);
    configContent = defaultConfig;
  } else {
    try {
      const rawConfig = fs.readFileSync(configFilePath, 'utf-8');
      configContent = JSON.parse(rawConfig);
      console.log('Содержимое config.json:', configContent);
    } catch (error) {
      console.error('Ошибка чтения config.json:', error);
      configContent = {
        'theme': 'dark',
        'font-size': 'medium',
        'font-family': 'mono',
        'line-height': '1.6',
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
    }
  }

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

app.whenReady().then(() => {
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