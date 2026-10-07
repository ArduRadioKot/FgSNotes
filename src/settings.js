const defaultSettings = {
    'theme': 'dark',
    'font-size': 'medium',
    'font-family': 'mono',
    'line-height': '1.6',
    'liquid-glass': 'off',
    'glass-quality': 'auto',
    'live-preview': 'auto',
    'accent': 'default',
    'glass-window-transparency': '30',
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

// Themes added by hand (a .css file picked on the device) are kept as text, so they work without the desktop themes folder.
const customThemesKey = 'fgsnotes.customThemes';
function loadCustomThemes() {
    try { return JSON.parse(localStorage.getItem(customThemesKey)) || {}; } catch { return {}; }
}
function saveCustomThemes(themes) {
    try { localStorage.setItem(customThemesKey, JSON.stringify(themes)); } catch { /* storage full or unavailable */ }
}

// Themes written for the old interface set --bg-color (the main background) and know nothing about --window-bg.
// When a loaded theme does that, its --bg-color becomes the window colour and the colour scheme follows its brightness.
function adaptLegacyTheme() {
    const root = document.documentElement;
    if (root.dataset.legacyTheme !== undefined) {
        root.style.removeProperty('--window-bg');
        root.style.removeProperty('color-scheme');
        root.style.removeProperty('--syn-mark');
        delete root.dataset.legacyTheme;
    }
    const style = getComputedStyle(root);
    const background = style.getPropertyValue('--bg-color').trim();
    if (!background || background === style.getPropertyValue('--window-bg').trim()) return;
    root.dataset.legacyTheme = '';
    root.style.setProperty('--window-bg', background);
    root.style.setProperty('--syn-mark', 'var(--text-muted)');   // old themes have no syntax tokens; the muted text colour keeps Markdown marks readable
    const card = style.getPropertyValue('--card-bg').trim().replace('#', '');
    const hex = card.length === 3 ? card.replace(/./g, '$&$&') : card;
    if (/^[0-9a-f]{6}$/i.test(hex)) {
        const [r, g, b] = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
        root.style.setProperty('color-scheme', (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? 'light' : 'dark');
    }
}

// Accent colour picked by the person: overrides the theme's accent and the tokens derived from it.
function applyAccent(value, theme) {
    const root = document.documentElement;
    ['--accent-color', '--accent-text', '--link-color', '--selection'].forEach(name => root.style.removeProperty(name));
    // The "from theme" swatch shows whatever accent the current theme defines.
    root.style.setProperty('--accent-base', getComputedStyle(root).getPropertyValue('--accent-color').trim());
    if (!/^#[0-9a-f]{6}$/i.test(String(value))) return;
    const rgb = [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16));
    const mix = (target, amount) => '#' + rgb.map((channel, i) => Math.round(channel * (1 - amount) + target * amount).toString(16).padStart(2, '0')).join('');
    const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    root.style.setProperty('--accent-color', value);
    root.style.setProperty('--accent-text', luminance > 0.6 ? '#111111' : '#ffffff');
    root.style.setProperty('--link-color', theme === 'light' ? mix(0, 0.25) : mix(255, 0.3));
    root.style.setProperty('--selection', value + (theme === 'light' ? '40' : '59'));
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
    
    document.documentElement.dataset.livePreview = ['auto', 'on', 'off'].includes(settings['live-preview']) ? settings['live-preview'] : 'auto';
    // Highlighting is built in (highlight.js module); editor.js reacts to this flag.
    document.documentElement.dataset.codeHighlight = settings['code-highlight'] === 'on' ? 'on' : 'off';

    // External theme: a file from the themes folder (desktop), or CSS added by hand and kept in storage (any platform)
    const externalThemeLink = document.getElementById('external-theme-link');
    const inlineTheme = document.getElementById('external-theme-style');
    const externalThemeFileName = settings['external-theme'];

    if (externalThemeFileName && externalThemeFileName.startsWith('custom:')) {
        if (externalThemeLink) externalThemeLink.remove();
        const css = loadCustomThemes()[externalThemeFileName.slice(7)];
        if (css) {
            const style = inlineTheme || Object.assign(document.createElement('style'), { id: 'external-theme-style' });
            style.textContent = css;
            if (!inlineTheme) document.head.appendChild(style);
        } else if (inlineTheme) inlineTheme.remove();
        adaptLegacyTheme();
    } else if (externalThemeFileName && externalThemeFileName !== '') {
        if (inlineTheme) inlineTheme.remove();
        if (window.electron && window.electron.getThemesPath) {
            window.electron.getThemesPath().then(themesPath => {
                const themePath = `file://${themesPath}/${externalThemeFileName}`;
                const previous = document.getElementById('external-theme-link');
                if (previous && previous.href === encodeURI(themePath)) return;   // already loaded
                // A fresh <link> per theme: changing href on an existing one does not fire "load" reliably,
                // and the old theme stays until the new one has arrived.
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.onload = () => {
                    if (previous) previous.remove();
                    link.id = 'external-theme-link';
                    adaptLegacyTheme();
                };
                link.onerror = () => link.remove();
                link.href = themePath;
                document.head.appendChild(link);
            }).catch(error => {
                console.error('Error getting themes path:', error);
            });
        } else {
            console.error('Electron API or getThemesPath not available for external theme.');
        }
    } else {
        if (externalThemeLink) externalThemeLink.remove();
        if (inlineTheme) inlineTheme.remove();
        adaptLegacyTheme();
    }
    
    editor.wrap = settings['word-wrap'] === 'on' ? 'soft' : 'off';

    const theme = settings['theme'] === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
    applyAccent(settings['accent'], theme);
    if (window.electron && window.electron.setNativeTheme) window.electron.setNativeTheme(theme);

    // Older configs stored medium/strong; they map to the closest new preset.
    const legacyGlass = { medium: 'regular', strong: 'frosted', dark: 'regular' };
    // The glass needs a translucent window, which phones do not have.
    const requested = document.documentElement.dataset.native !== undefined ? 'off' : (legacyGlass[settings['liquid-glass']] || settings['liquid-glass']);
    const liquidGlass = requested === 'off' || (window.LiquidGlass && window.LiquidGlass.presets[requested]) ? requested : 'off';
    document.documentElement.dataset.liquidGlass = liquidGlass;
    const transparency = Math.min(100, Math.max(0, Number(settings['glass-window-transparency'])));
    document.documentElement.style.setProperty('--sg-opacity', String(0.95 - 0.55 * (Number.isFinite(transparency) ? transparency : 30) / 100));
    if (window.LiquidGlass) {
        if (liquidGlass === 'off') window.LiquidGlass.detachAll('[data-glass]');
        else {
            window.LiquidGlass.configure({ preset: liquidGlass, quality: settings['glass-quality'] || 'auto' }, { persist: false });
            // One shared substrate for the whole window (no refraction: there is nothing of the page behind it);
            // only floating controls get a refracting lens.
            window.LiquidGlass.attachAll('[data-glass="substrate"]', { interactive: false, overrides: { refraction: 0 } });
            window.LiquidGlass.attachAll('[data-glass=""]');
            // Settings dialog: a light lens, its transparency set by the slider.
            window.LiquidGlass.attachAll('[data-glass="dialog"]', { interactive: false, overrides: { refraction: 0.4, displacement: 16, edgeWidth: 14, blur: 16, opacity: 0.1, highlight: 0.2, dispersion: 0.04, specular: 0.35 } });
        }
    }
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

    function syncAccentControls(settings) {
        const value = String(settings['accent'] || 'default').toLowerCase();
        const picker = document.querySelector('.accent-picker');
        if (!picker) return;
        const known = [...picker.querySelectorAll('.accent-swatch')].some(swatch => swatch.dataset.accent === value);
        picker.querySelectorAll('.accent-swatch').forEach(swatch => {
            const active = swatch.dataset.accent === value;
            swatch.classList.toggle('is-active', active);
            swatch.setAttribute('aria-checked', String(active));
        });
        const custom = picker.querySelector('.accent-custom');
        custom.classList.toggle('is-active', /^#[0-9a-f]{6}$/.test(value) && !known);
        if (/^#[0-9a-f]{6}$/.test(value)) custom.querySelector('input').value = value;
    }
    function syncControlsFromSettings(settings) {
        syncAccentControls(settings);
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

    // Theme list: files from the themes folder (desktop) plus themes added by hand
    const externalThemeSelect = document.getElementById('external-theme');
    const addThemeButton = document.getElementById('add-theme');
    const removeThemeButton = document.getElementById('remove-theme');
    let folderThemes = [];
    function refreshThemeList() {
        if (!externalThemeSelect) return;
        const custom = Object.keys(loadCustomThemes());
        externalThemeSelect.replaceChildren(...[['', 'Нет'], ...folderThemes.map(name => [name, name]), ...custom.map(name => ['custom:' + name, name + ' (добавлена)'])]
            .map(([value, label]) => Object.assign(document.createElement('option'), { value, textContent: label })));
        writeControlValue(externalThemeSelect, currentSettings['external-theme']);
        if (externalThemeSelect.value !== (currentSettings['external-theme'] || '')) externalThemeSelect.value = '';
        removeThemeButton.hidden = !String(externalThemeSelect.value).startsWith('custom:');
    }
    if (window.electron && window.electron.getThemesList && externalThemeSelect) {
        try { folderThemes = await window.electron.getThemesList(); } catch { folderThemes = []; }
    }
    refreshThemeList();
    externalThemeSelect?.addEventListener('change', () => { removeThemeButton.hidden = !externalThemeSelect.value.startsWith('custom:'); });
    addThemeButton?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.css,text/css';
        input.hidden = true;
        document.body.append(input);
        input.addEventListener('cancel', () => input.remove(), { once: true });
        input.onchange = () => {
            const file = input.files[0];
            input.remove();
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                const name = file.name.replace(/\.css$/i, '').replace(/[^\w .\-а-яё]/gi, '_').slice(0, 60) || 'theme';
                const themes = loadCustomThemes();
                themes[name] = String(reader.result).slice(0, 500000);
                saveCustomThemes(themes);
                currentSettings = { ...currentSettings, 'external-theme': 'custom:' + name, accent: 'default' };
                syncAccentControls(currentSettings);
                refreshThemeList();
                applySettings(currentSettings);
                saveSettings(currentSettings);
            };
            reader.readAsText(file);
        };
        input.click();
    });
    removeThemeButton?.addEventListener('click', () => {
        const value = externalThemeSelect.value;
        if (!value.startsWith('custom:')) return;
        const themes = loadCustomThemes();
        delete themes[value.slice(7)];
        saveCustomThemes(themes);
        currentSettings = { ...currentSettings, 'external-theme': '' };
        refreshThemeList();
        applySettings(currentSettings);
        saveSettings(currentSettings);
    });

    document.querySelectorAll('.setting-control select, .setting-control input[type="range"], .setting-toggle input[type="checkbox"]').forEach(input => {
        input.addEventListener(input.type === 'range' ? 'input' : 'change', (e) => {
            const key = e.target.id;
            if (!(key in defaultSettings)) return;
            currentSettings = {
                ...currentSettings,
                [key]: readControlValue(e.target)
            };
            // A new theme brings its own accent; the picked accent would hide it.
            if (key === 'external-theme' && currentSettings.accent !== 'default') { currentSettings.accent = 'default'; syncAccentControls(currentSettings); }
            applySettings(currentSettings);
            saveSettings(currentSettings);
        });
    });


    // Quick theme switcher: a menu with light/dark and every external theme, so nobody has to dig through the settings.
    const themeButton = document.getElementById('theme-button');
    const themeMenu = document.createElement('div');
    themeMenu.className = 'theme-menu';
    themeMenu.setAttribute('role', 'menu');
    themeMenu.setAttribute('aria-label', 'Тема оформления');
    themeMenu.hidden = true;
    document.body.append(themeMenu);
    const escapeText = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    function renderThemeMenu() {
        const item = (kind, value, label, checked) => `<button type="button" role="menuitemradio" aria-checked="${checked}" data-kind="${kind}" data-value="${escapeText(value)}"><span class="check">${checked ? icon('check') : ''}</span><span class="label">${escapeText(label)}</span></button>`;
        const mode = currentSettings['theme'] === 'light' ? 'light' : 'dark';
        const picked = currentSettings['external-theme'] || '';
        const themes = [...externalThemeSelect.options].map(option => item('theme', option.value, option.value ? option.textContent.replace(/\.css$/i, '') : 'Без сторонней темы', option.value === picked)).join('');
        themeMenu.innerHTML = `<div class="theme-menu-title">Режим</div>${item('mode', 'dark', 'Тёмная', mode === 'dark')}${item('mode', 'light', 'Светлая', mode === 'light')}<div class="theme-menu-title">Сторонние темы</div>${themes}<button type="button" class="theme-menu-more" data-kind="more">Добавить или удалить…</button>`;
    }
    function closeThemeMenu() { themeMenu.hidden = true; themeButton?.setAttribute('aria-expanded', 'false'); }
    function openThemeMenu() {
        refreshThemeList();
        renderThemeMenu();
        themeMenu.hidden = false;
        themeButton?.setAttribute('aria-expanded', 'true');
        (themeMenu.querySelector('[aria-checked="true"][data-kind="theme"]') || themeMenu.querySelector('button')).focus({ preventScroll: true });
    }
    themeButton?.addEventListener('click', event => { event.stopPropagation(); if (themeMenu.hidden) openThemeMenu(); else closeThemeMenu(); });
    themeMenu.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        const { kind, value } = button.dataset;
        if (kind === 'more') {
            closeThemeMenu();
            settingsButton.click();
            showSettingsSection('appearance');
            return;
        }
        const select = document.getElementById(kind === 'mode' ? 'theme' : 'external-theme');
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        if (kind === 'theme') removeThemeButton.hidden = !String(select.value).startsWith('custom:');
        // On a phone the menu is a bottom sheet: close it after a choice. On desktop it stays open to compare themes.
        if (matchMedia('(max-width: 720px)').matches) { closeThemeMenu(); return; }
        renderThemeMenu();
        themeMenu.querySelector(`[data-kind="${kind}"][data-value="${CSS.escape(value)}"]`)?.focus({ preventScroll: true });
    });
    document.addEventListener('click', event => { if (!themeMenu.hidden && !themeMenu.contains(event.target)) closeThemeMenu(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !themeMenu.hidden) { closeThemeMenu(); themeButton?.focus(); } });

    const chooseAccent = value => {
        currentSettings = { ...currentSettings, accent: value };
        syncAccentControls(currentSettings);
        applySettings(currentSettings);
        saveSettings(currentSettings);
    };
    document.querySelectorAll('.accent-swatch').forEach(swatch => swatch.addEventListener('click', () => chooseAccent(swatch.dataset.accent)));
    document.getElementById('accent-custom')?.addEventListener('input', event => chooseAccent(event.target.value.toLowerCase()));

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            showSettingsSection(item.dataset.settingsSection);
        });
    });

    document.getElementById('open-glass-playground')?.addEventListener('click', () => {
        if (window.electron && window.electron.openGlassPlayground) window.electron.openGlassPlayground();
        else window.open('liquid-glass/playground.html', '_blank');
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
