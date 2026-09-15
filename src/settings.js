const defaultSettings = {
    'theme': 'dark',
    'font-size': 'medium',
    'font-family': 'mono',
    'line-height': '1.6',
    'liquid-glass': 'off',
    'tab-size': '4',
    'word-wrap': 'on',
    'preview-theme': 'default',
    'math-support': 'on',
    'table-of-contents': 'on',
    'todo-list': 'on',
    'code-highlight': 'on',
    'external-theme': ''
};

async function loadSettings() {
    if (window.electron) {
        try {
            const config = await window.electron.loadConfig();
            return { ...defaultSettings, ...config };
        } catch (error) {
            console.error('Error loading config from main process:', error);
            return defaultSettings; // Fallback to default settings on error
        }
    } else {
        try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem('fgsnotes.settings')) }; }
        catch { return { ...defaultSettings }; }
    }
}

function saveSettings(settings) {
    if (window.electron) {
        window.electron.saveConfig(settings);
    } else {
        localStorage.setItem('fgsnotes.settings', JSON.stringify(settings));
    }
}

function applySettings(settings) {
    
    const editor = document.getElementById('markdown-editor');
    const preview = document.getElementById('preview');
    
    if (!editor || !preview) {
        console.error('Editor or preview elements not found');
        return;
    }
    
    const fontSizeMap = {
        small: '13px',
        medium: '14px',
        large: '16px'
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
    
    
    editor.style.cssText = `
        font-size: ${fontSize};
        font-family: ${fontFamily};
        line-height: ${lineHeight};
        tab-size: ${settings['tab-size']};
        white-space: ${settings['word-wrap'] === 'on' ? 'pre-wrap' : 'pre'};
    `;
    
    preview.style.cssText = `
        font-size: ${fontSize};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        line-height: ${lineHeight};
    `;
    
    const previewThemes = {
        default: '',
        github: 'preview-theme-github',
        dark: 'preview-theme-dark'
    };
    
    preview.className = 'preview-content ' + (previewThemes[settings['preview-theme']] || '');

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

    // Handle external theme
    const externalThemeLink = document.getElementById('external-theme-link');
    const externalThemeFileName = settings['external-theme'];
    
    if (externalThemeFileName && externalThemeFileName !== '') {
        if (window.electron && window.electron.getThemesPath) {
            window.electron.getThemesPath().then(themesPath => {
                const themePath = `file://${themesPath}/${externalThemeFileName}`;
                if (externalThemeLink) {
                    externalThemeLink.href = themePath;
                } else {
                    const link = document.createElement('link');
                    link.id = 'external-theme-link';
                    link.rel = 'stylesheet';
                    link.href = themePath;
                    document.head.appendChild(link);
                }
            }).catch(error => {
                console.error('Error getting themes path:', error);
            });
        } else {
            console.error('Electron API or getThemesPath not available for external theme.');
        }
    } else {
        if (externalThemeLink) {
            externalThemeLink.remove();
        }
    }
    
    editor.wrap = settings['word-wrap'] === 'on' ? 'soft' : 'off';

    const theme = settings['theme'] === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);

    const liquidGlass = ['off', 'subtle', 'medium', 'strong'].includes(settings['liquid-glass'])
        ? settings['liquid-glass']
        : 'off';
    document.documentElement.dataset.liquidGlass = liquidGlass;
}

document.addEventListener('DOMContentLoaded', async () => {
    const settingsModal = document.getElementById('settings-modal');
    const settingsButton = document.getElementById('settings-button');
    const closeModal = document.querySelector('.close-modal');
    const resetSettingsButton = document.getElementById('reset-settings');
    const panelTitle = document.getElementById('settings-panel-title');
    const navItems = [...document.querySelectorAll('.settings-nav-item')];
    const panels = [...document.querySelectorAll('.settings-panel')];

    let currentSettings;

    function readControlValue(element) {
        if (!element) return undefined;
        if (element.type === 'checkbox') {
            return element.checked ? 'on' : 'off';
        }
        return element.value;
    }

    function writeControlValue(element, value) {
        if (!element) return;
        if (element.type === 'checkbox') {
            element.checked = value === 'on';
            return;
        }
        element.value = value;
    }

    function syncControlsFromSettings(settings) {
        Object.keys(defaultSettings).forEach(key => {
            writeControlValue(document.getElementById(key), settings[key]);
        });
    }

    function showSettingsSection(sectionId) {
        const activeNav = navItems.find(item => item.dataset.settingsSection === sectionId) || navItems[0];
        const targetId = activeNav.dataset.settingsSection;

        navItems.forEach(item => {
            const isActive = item === activeNav;
            item.classList.toggle('is-active', isActive);
            item.setAttribute('aria-selected', String(isActive));
        });

        panels.forEach(panel => {
            const isActive = panel.dataset.settingsPanel === targetId;
            panel.classList.toggle('is-active', isActive);
            panel.hidden = !isActive;
        });

        if (panelTitle) {
            panelTitle.textContent = activeNav.textContent.trim();
        }
    }

    currentSettings = await loadSettings();
    applySettings(currentSettings);
    syncControlsFromSettings(currentSettings);

    if (window.electron && window.electron.getThemesList) {
        const externalThemeSelect = document.getElementById('external-theme');
        if (externalThemeSelect) {
            const themes = await window.electron.getThemesList();
            themes.forEach(theme => {
                const option = document.createElement('option');
                option.value = theme;
                option.textContent = theme;
                externalThemeSelect.appendChild(option);
            });
            writeControlValue(externalThemeSelect, currentSettings['external-theme']);
        }
    }

    document.querySelectorAll('.setting-control select, .setting-toggle input[type="checkbox"]').forEach(input => {
        input.addEventListener('change', (e) => {
            const key = e.target.id;
            if (!(key in defaultSettings)) return;
            currentSettings = {
                ...currentSettings,
                [key]: readControlValue(e.target)
            };
            applySettings(currentSettings);
            saveSettings(currentSettings);
        });
    });

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            showSettingsSection(item.dataset.settingsSection);
        });
    });

    settingsButton.addEventListener('click', () => {
        syncControlsFromSettings(currentSettings);
        showSettingsSection(
            document.querySelector('.settings-nav-item.is-active')?.dataset.settingsSection || 'appearance'
        );
        settingsModal.classList.add('show');
        document.querySelector('.workspace').inert = true;
        closeModal.focus();
    });

    closeModal.addEventListener('click', () => {
        closeSettings();
    });

    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            closeSettings();
        }
    });

    resetSettingsButton.addEventListener('click', () => {
        currentSettings = { ...defaultSettings };
        syncControlsFromSettings(currentSettings);
        applySettings(currentSettings);
        saveSettings(currentSettings);
    });

    function closeSettings() {
        settingsModal.classList.remove('show');
        document.querySelector('.workspace').inert = false;
        settingsButton.focus();
    }

    settingsModal.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeSettings();
            return;
        }
        if (event.key !== 'Tab') return;
        const controls = [...settingsModal.querySelectorAll('button, select, .setting-toggle input')]
            .filter(element => !element.disabled && element.offsetParent !== null);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
});
