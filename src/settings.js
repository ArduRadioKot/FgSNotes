const defaultSettings = {
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
    'code-highlight': 'on'
};

function loadSettings() {
    try {
        const savedSettings = localStorage.getItem('editorSettings');
        if (savedSettings) {
            const parsed = JSON.parse(savedSettings);
            const normalizedSettings = {};
            Object.keys(defaultSettings).forEach(key => {
                normalizedSettings[key] = parsed[key] || defaultSettings[key];
            });
            return normalizedSettings;
        }
    } catch (e) {
        console.error('Error loading settings:', e);
    }
    return defaultSettings;
}

function saveSettings(settings) {
    try {
        const normalizedSettings = {};
        Object.keys(defaultSettings).forEach(key => {
            normalizedSettings[key] = settings[key] || defaultSettings[key];
        });
        localStorage.setItem('editorSettings', JSON.stringify(normalizedSettings));
    } catch (e) {
        console.error('Error saving settings:', e);
    }
}

function applySettings(settings) {
    console.log('Applying settings:', settings);
    
    const editor = document.getElementById('markdown-editor');
    const preview = document.getElementById('preview');
    
    if (!editor || !preview) {
        console.error('Editor or preview elements not found');
        return;
    }
    
    const fontSizeMap = {
        small: '0.9rem',
        medium: '1rem',
        large: '1.1rem'
    };
    
    const fontFamilyMap = {
        system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        mono: '"Consolas", "Monaco", monospace',
        serif: 'Georgia, "Times New Roman", serif',
        sans: 'Arial, Helvetica, sans-serif'
    };
    
    const fontSize = fontSizeMap[settings['font-size']] || fontSizeMap.medium;
    const fontFamily = fontFamilyMap[settings['font-family']] || fontFamilyMap.mono;
    const lineHeight = settings['line-height'] || '1.6';
    
    console.log('Applying font settings:', { fontSize, fontFamily, lineHeight });
    
    editor.style.cssText = `
        font-size: ${fontSize};
        font-family: ${fontFamily};
        line-height: ${lineHeight};
        tab-size: ${settings['tab-size']};
        white-space: ${settings['word-wrap'] === 'on' ? 'pre-wrap' : 'pre'};
    `;
    
    preview.style.cssText = `
        font-size: ${fontSize};
        font-family: ${fontFamily};
        line-height: ${lineHeight};
    `;
    
    const previewElements = preview.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, code, pre');
    previewElements.forEach(element => {
        element.style.cssText = `
            font-size: ${fontSize};
            font-family: ${fontFamily};
        `;
    });
    
    const previewThemes = {
        default: '',
        github: 'preview-theme-github',
        dark: 'preview-theme-dark'
    };
    
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const previewTheme = settings['preview-theme'] === 'default' ? 
        (currentTheme === 'dark' ? 'preview-theme-dark' : '') : 
        previewThemes[settings['preview-theme']];
    
    preview.className = 'preview-content ' + previewTheme;
    
    if (settings['math-support'] === 'on') {
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
    
    if (settings['code-highlight'] === 'on') {
        if (!document.getElementById('highlight-script')) {
            const script = document.createElement('script');
            script.id = 'highlight-script';
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/highlight.min.js';
            script.async = true;
            document.head.appendChild(script);
            
            const style = document.createElement('link');
            style.id = 'highlight-style';
            style.rel = 'stylesheet';
            style.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/github-dark.min.css';
            document.head.appendChild(style);
        }
    } else {
        const highlightScript = document.getElementById('highlight-script');
        const highlightStyle = document.getElementById('highlight-style');
        if (highlightScript) highlightScript.remove();
        if (highlightStyle) highlightStyle.remove();
    }
    
    const event = new Event('input');
    editor.dispatchEvent(event);
}

document.addEventListener('DOMContentLoaded', () => {
    const settingsModal = document.getElementById('settings-modal');
    const settingsButton = document.getElementById('settings-button');
    const closeModal = document.querySelector('.close-modal');
    const saveSettingsButton = document.getElementById('save-settings');
    const resetSettingsButton = document.getElementById('reset-settings');
    
    let currentSettings = loadSettings();
    console.log('Loaded settings:', currentSettings);
    
    applySettings(currentSettings);
    
    Object.keys(currentSettings).forEach(key => {
        const element = document.getElementById(key);
        if (element) {
            element.value = currentSettings[key];
        }
    });
    
    const settingInputs = document.querySelectorAll('.setting-item select');
    settingInputs.forEach(input => {
        input.addEventListener('change', (e) => {
            const newSettings = { ...currentSettings };
            newSettings[e.target.id] = e.target.value;
            currentSettings = newSettings;
            applySettings(currentSettings);
            saveSettings(currentSettings);
        });
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
        Object.keys(defaultSettings).forEach(key => {
            const element = document.getElementById(key);
            if (element) {
                newSettings[key] = element.value;
            }
        });
        
        console.log('Saving new settings:', newSettings);
        currentSettings = newSettings;
        saveSettings(currentSettings);
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
        currentSettings = { ...defaultSettings };
        applySettings(currentSettings);
        saveSettings(currentSettings);
    });
    
    let autoSaveInterval;
    function setupAutoSave() {
        if (autoSaveInterval) {
            clearInterval(autoSaveInterval);
        }
        
        const interval = parseInt(currentSettings['auto-save']);
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
});