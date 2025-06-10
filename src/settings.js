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

function loadSettings() {
    const savedSettings = localStorage.getItem('editorSettings');
    return savedSettings ? JSON.parse(savedSettings) : defaultSettings;
}

function saveSettings(settings) {
    localStorage.setItem('editorSettings', JSON.stringify(settings));
}

function applySettings(settings) {
    const editor = document.getElementById('markdown-editor');
    const preview = document.getElementById('preview');
    
    const fontSizeMap = {
        small: '0.9rem',
        medium: '1rem',
        large: '1.1rem'
    };
    editor.style.fontSize = fontSizeMap[settings.fontSize];
    preview.style.fontSize = fontSizeMap[settings.fontSize];
    
    const fontFamilyMap = {
        system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        mono: '"Consolas", "Monaco", monospace',
        serif: 'Georgia, "Times New Roman", serif',
        sans: 'Arial, Helvetica, sans-serif'
    };
    editor.style.fontFamily = fontFamilyMap[settings.fontFamily];
    preview.style.fontFamily = fontFamilyMap[settings.fontFamily];
    
    editor.style.lineHeight = settings.lineHeight;
    preview.style.lineHeight = settings.lineHeight;
    
    editor.style.tabSize = settings.tabSize;
    
    editor.style.whiteSpace = settings.wordWrap === 'on' ? 'pre-wrap' : 'pre';
    
    const previewThemes = {
        default: '',
        github: 'preview-theme-github',
        dark: 'preview-theme-dark'
    };
    preview.className = 'preview-content ' + previewThemes[settings.previewTheme];
    
    if (settings.mathSupport === 'on') {
        if (!document.getElementById('mathjax-script')) {
            const script = document.createElement('script');
            script.id = 'mathjax-script';
            script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';
            script.async = true;
            document.head.appendChild(script);
        }
    } else {
        const mathjaxScript = document.getElementById('mathjax-script');
        if (mathjaxScript) {
            mathjaxScript.remove();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const settingsModal = document.getElementById('settings-modal');
    const settingsButton = document.getElementById('settings-button');
    const closeModal = document.querySelector('.close-modal');
    const saveSettingsButton = document.getElementById('save-settings');
    const resetSettingsButton = document.getElementById('reset-settings');
    
    let currentSettings = loadSettings();
    
    applySettings(currentSettings);
    
    Object.keys(currentSettings).forEach(key => {
        const element = document.getElementById(key);
        if (element) {
            element.value = currentSettings[key];
        }
    });
    
    settingsButton.addEventListener('click', () => {
        settingsModal.classList.add('show');
    });
    
    closeModal.addEventListener('click', () => {
        settingsModal.classList.remove('show');
    });
    
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.remove('show');
        }
    });
    
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
    
    resetSettingsButton.addEventListener('click', () => {
        Object.keys(defaultSettings).forEach(key => {
            const element = document.getElementById(key);
            if (element) {
                element.value = defaultSettings[key];
            }
        });
    });
    
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
    
    const settingInputs = document.querySelectorAll('.setting-item select');
    settingInputs.forEach(input => {
        input.addEventListener('change', () => {
            const tempSettings = { ...currentSettings };
            tempSettings[input.id] = input.value;
            applySettings(tempSettings);
        });
    });
});