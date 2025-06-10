// Настройки по умолчанию
const defaultSettings = {
    fontSize: 'medium',
    fontFamily: 'mono',
    lineHeight: '1.6',
    tabSize: '4',
    wordWrap: 'on',
    autoSave: '5',
    previewTheme: 'default',
    mathSupport: 'on'
};

// Загрузка настроек из localStorage
function loadSettings() {
    const savedSettings = localStorage.getItem('editorSettings');
    return savedSettings ? JSON.parse(savedSettings) : defaultSettings;
}

// Сохранение настроек в localStorage
function saveSettings(settings) {
    localStorage.setItem('editorSettings', JSON.stringify(settings));
}

// Применение настроек к редактору
function applySettings(settings) {
    const editor = document.getElementById('markdown-editor');
    const preview = document.getElementById('preview');
    
    // Размер шрифта
    const fontSizeMap = {
        small: '0.9rem',
        medium: '1rem',
        large: '1.1rem'
    };
    editor.style.fontSize = fontSizeMap[settings.fontSize];
    preview.style.fontSize = fontSizeMap[settings.fontSize];
    
    // Шрифт
    const fontFamilyMap = {
        system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        mono: '"Consolas", "Monaco", monospace',
        serif: 'Georgia, "Times New Roman", serif',
        sans: 'Arial, Helvetica, sans-serif'
    };
    editor.style.fontFamily = fontFamilyMap[settings.fontFamily];
    preview.style.fontFamily = fontFamilyMap[settings.fontFamily];
    
    // Межстрочный интервал
    editor.style.lineHeight = settings.lineHeight;
    preview.style.lineHeight = settings.lineHeight;
    
    // Размер табуляции
    editor.style.tabSize = settings.tabSize;
    
    // Перенос слов
    editor.style.whiteSpace = settings.wordWrap === 'on' ? 'pre-wrap' : 'pre';
    
    // Тема предпросмотра
    const previewThemes = {
        default: '',
        github: 'preview-theme-github',
        dark: 'preview-theme-dark'
    };
    preview.className = 'preview-content ' + previewThemes[settings.previewTheme];
    
    // Поддержка формул
    if (settings.mathSupport === 'on') {
        // Добавляем MathJax для поддержки формул
        if (!document.getElementById('mathjax-script')) {
            const script = document.createElement('script');
            script.id = 'mathjax-script';
            script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';
            script.async = true;
            document.head.appendChild(script);
        }
    } else {
        // Удаляем MathJax если он был добавлен
        const mathjaxScript = document.getElementById('mathjax-script');
        if (mathjaxScript) {
            mathjaxScript.remove();
        }
    }
}

// Инициализация настроек
document.addEventListener('DOMContentLoaded', () => {
    const settingsModal = document.getElementById('settings-modal');
    const settingsButton = document.getElementById('settings-button');
    const closeModal = document.querySelector('.close-modal');
    const saveSettingsButton = document.getElementById('save-settings');
    const resetSettingsButton = document.getElementById('reset-settings');
    
    // Загрузка текущих настроек
    let currentSettings = loadSettings();
    
    // Применение начальных настроек
    applySettings(currentSettings);
    
    // Заполнение полей формы текущими настройками
    Object.keys(currentSettings).forEach(key => {
        const element = document.getElementById(key);
        if (element) {
            element.value = currentSettings[key];
        }
    });
    
    // Открытие модального окна
    settingsButton.addEventListener('click', () => {
        settingsModal.classList.add('show');
    });
    
    // Закрытие модального окна
    closeModal.addEventListener('click', () => {
        settingsModal.classList.remove('show');
    });
    
    // Закрытие по клику вне модального окна
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.remove('show');
        }
    });
    
    // Сохранение настроек
    saveSettingsButton.addEventListener('click', () => {
        const newSettings = {};
        Object.keys(currentSettings).forEach(key => {
            const element = document.getElementById(key);
            if (element) {
                newSettings[key] = element.value;
            }
        });
        
        saveSettings(newSettings);
        currentSettings = newSettings;
        applySettings(currentSettings);
        settingsModal.classList.remove('show');
    });
    
    // Сброс настроек
    resetSettingsButton.addEventListener('click', () => {
        Object.keys(defaultSettings).forEach(key => {
            const element = document.getElementById(key);
            if (element) {
                element.value = defaultSettings[key];
            }
        });
    });
    
    // Настройка автосохранения
    let autoSaveInterval;
    function setupAutoSave() {
        if (autoSaveInterval) {
            clearInterval(autoSaveInterval);
        }
        
        const interval = parseInt(currentSettings.autoSave);
        if (interval > 0) {
            autoSaveInterval = setInterval(() => {
                const editor = document.getElementById('markdown-editor');
                if (editor) {
                    localStorage.setItem('editorContent', editor.value);
                }
            }, interval * 60 * 1000);
        }
    }
    
    setupAutoSave();
    
    // Предпросмотр настроек в реальном времени
    const settingInputs = document.querySelectorAll('.setting-item select');
    settingInputs.forEach(input => {
        input.addEventListener('change', () => {
            const tempSettings = { ...currentSettings };
            tempSettings[input.id] = input.value;
            applySettings(tempSettings);
        });
    });
}); 