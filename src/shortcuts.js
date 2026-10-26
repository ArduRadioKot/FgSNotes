// Keyboard shortcuts: one list of actions, default bindings, the person's own bindings (Settings → Горячие клавиши) and one listener.
// A binding is written like "Mod+Shift+KeyX": Mod is Cmd on a Mac and Ctrl elsewhere, Ctrl is the literal Control key on a Mac.
// Keys are matched by their position (event.code), so shortcuts work on any keyboard layout, Russian included.
(function () {
    const mac = /Mac/i.test(navigator.platform);
    const A = () => window.FgsActions || {};
    const click = selector => () => { const node = document.querySelector(selector); if (node) node.click(); };
    const format = name => ({ needsEditor: true, run: () => A().format && A().format(name) });

    const ACTIONS = [
        { id: 'newDocument', group: 'Файл', label: 'Новый документ', combo: 'Mod+KeyN', run: () => A().newDocument && A().newDocument() },
        { id: 'open', group: 'Файл', label: 'Открыть файл', combo: 'Mod+KeyO', run: () => A().open && A().open() },
        { id: 'save', group: 'Файл', label: 'Сохранить файл', combo: 'Mod+KeyS', run: () => A().save && A().save() },
        { id: 'find', group: 'Правка', label: 'Найти', combo: 'Mod+KeyF', run: () => A().find && A().find() },
        { id: 'findNext', group: 'Правка', label: 'Найти далее', combo: 'Mod+KeyG', run: () => A().findNext && A().findNext() },
        { id: 'findPrevious', group: 'Правка', label: 'Найти ранее', combo: 'Mod+Shift+KeyG', run: () => A().findPrevious && A().findPrevious() },
        { id: 'closeTab', group: 'Вкладки', label: 'Закрыть вкладку', combo: 'Mod+Alt+KeyW', run: () => A().closeTab && A().closeTab() },
        { id: 'nextTab', group: 'Вкладки', label: 'Следующая вкладка', combo: mac ? 'Ctrl+Tab' : 'Mod+Tab', run: () => A().nextTab && A().nextTab() },
        { id: 'previousTab', group: 'Вкладки', label: 'Предыдущая вкладка', combo: mac ? 'Ctrl+Shift+Tab' : 'Mod+Shift+Tab', run: () => A().previousTab && A().previousTab() },
        { id: 'bold', group: 'Форматирование', label: 'Жирный', combo: 'Mod+KeyB', ...format('bold'), button: '[data-format="bold"]' },
        { id: 'italic', group: 'Форматирование', label: 'Курсив', combo: 'Mod+KeyI', ...format('italic'), button: '[data-format="italic"]' },
        { id: 'underline', group: 'Форматирование', label: 'Подчёркнутый', combo: 'Mod+KeyU', ...format('underline'), button: '[data-format="underline"]' },
        { id: 'strike', group: 'Форматирование', label: 'Зачёркнутый', combo: 'Mod+Shift+KeyX', ...format('strike'), button: '[data-format="strike"]' },
        { id: 'heading', group: 'Форматирование', label: 'Заголовок', combo: 'Mod+Shift+KeyH', ...format('heading'), button: '[data-format="heading"]' },
        { id: 'list', group: 'Форматирование', label: 'Список', combo: 'Mod+Shift+KeyL', ...format('list'), button: '[data-format="list"]' },
        { id: 'task', group: 'Форматирование', label: 'Список задач', combo: 'Mod+Shift+KeyT', ...format('task'), button: '[data-format="task"]' },
        { id: 'quote', group: 'Форматирование', label: 'Цитата', combo: 'Mod+Shift+Period', ...format('quote'), button: '[data-format="quote"]' },
        { id: 'link', group: 'Форматирование', label: 'Ссылка', combo: 'Mod+KeyK', ...format('link'), button: '[data-format="link"]' },
        { id: 'code', group: 'Форматирование', label: 'Блок кода', combo: 'Mod+Shift+KeyE', ...format('code'), button: '[data-format="code"]' },
        { id: 'image', group: 'Форматирование', label: 'Изображение', combo: '', ...format('image'), button: '[data-format="image"]' },
        { id: 'sup', group: 'Форматирование', label: 'Надстрочный текст', combo: '', ...format('sup'), button: '[data-format="sup"]' },
        { id: 'cell', group: 'Форматирование', label: 'Ячейка JavaScript', combo: 'Mod+Shift+KeyR', ...format('cell'), button: '[data-format="cell"]' },
        { id: 'sub', group: 'Форматирование', label: 'Подстрочный текст', combo: '', ...format('sub'), button: '[data-format="sub"]' },
        { id: 'viewEditor', group: 'Вид', label: 'Режим «Редактор»', combo: 'Mod+Digit1', run: () => A().view && A().view('editor') },
        { id: 'viewLive', group: 'Вид', label: 'Режим «Живой»', combo: 'Mod+Digit2', run: () => A().view && A().view('live') },
        { id: 'viewSplit', group: 'Вид', label: 'Режим «Рядом»', combo: 'Mod+Digit3', run: () => A().view && A().view('split') },
        { id: 'viewPreview', group: 'Вид', label: 'Режим «Просмотр»', combo: 'Mod+Digit4', run: () => A().view && A().view('preview') },
        { id: 'theme', group: 'Вид', label: 'Светлая или тёмная тема', combo: 'Mod+Shift+KeyD', run: () => {
            const select = document.getElementById('theme');
            if (!select) return;
            select.value = select.value === 'light' ? 'dark' : 'light';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        } },
        { id: 'settings', group: 'Вид', label: 'Настройки', combo: 'Mod+Comma', run: click('#settings-button'), button: '#settings-button' },
        { id: 'assistant', group: 'Чат', label: 'Открыть или закрыть чат', combo: 'Mod+KeyJ', run: () => window.FgsAssistant && window.FgsAssistant.toggle(), button: '#ai-button' }
    ];
    ACTIONS.find(a => a.id === 'newDocument').button = '#new-file-button';
    ACTIONS.find(a => a.id === 'open').button = '#open-file-button';
    ACTIONS.find(a => a.id === 'save').button = '#save-file-button';

    // --- combos --------------------------------------------------------------------------------------------------------------
    const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;
    const KEY_NAMES = { Period: '.', Comma: ',', Slash: '/', Backslash: '\\', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Backspace: '⌫', Delete: 'Del', Space: 'Space' };
    const keyName = code => KEY_NAMES[code] || code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');

    function comboFromEvent(event) {
        if (MODIFIER_CODES.test(event.code)) return null;
        if (!mac && event.metaKey) return null;
        const parts = [];
        if (mac ? event.metaKey : event.ctrlKey) parts.push('Mod');
        if (mac && event.ctrlKey) parts.push('Ctrl');
        if (event.altKey) parts.push('Alt');
        if (event.shiftKey) parts.push('Shift');
        parts.push(event.code);
        return parts.join('+');
    }
    function describe(combo) {
        if (!combo) return '';
        const parts = combo.split('+');
        const key = keyName(parts.pop());
        if (mac) return parts.map(part => ({ Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }[part])).join('') + key;
        return [...parts.map(part => ({ Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' }[part])), key].join('+');
    }
    // Combos that would break the system or typing: they cannot be taken.
    function problem(combo) {
        const parts = combo.split('+'), code = parts.pop();
        const hasModifier = parts.some(part => part === 'Mod' || part === 'Ctrl' || part === 'Alt');
        if (!/^F\d{1,2}$/.test(code) && !hasModifier) return 'Нужна клавиша-модификатор: Ctrl, ⌘ или Alt.';
        if (parts.length === 1 && parts[0] === 'Mod' && /^Key[ACVXZY]$/.test(code)) return 'Это сочетание нужно системе (копировать, вставить, отменить).';
        if (mac && parts.includes('Mod') && /^Key[QWMH]$/.test(code) && parts.length === 1) return 'Это системное сочетание macOS.';
        if (!mac && parts.length === 1 && parts[0] === 'Mod' && code === 'KeyW') return 'Это сочетание закрывает окно.';
        if (['Tab', 'Escape', 'Enter', 'Space', 'Backspace'].includes(code) && !parts.some(part => part === 'Mod' || part === 'Ctrl' || part === 'Alt')) return 'Эту клавишу нельзя назначить одну.';
        return '';
    }

    // --- bindings: defaults overridden by the person's choices ------------------------------------------------------------
    const settings = () => (window.FgsSettings && window.FgsSettings.get()) || {};
    function overrides() { try { return JSON.parse(settings().shortcuts || '{}') || {}; } catch { return {}; } }
    const comboOf = (action, saved = overrides()) => (action.id in saved ? saved[action.id] : action.combo);
    function table() {
        const saved = overrides(), map = new Map();
        ACTIONS.forEach(action => { const combo = comboOf(action, saved); if (combo) map.set(combo, action); });
        return map;
    }
    function save(next) {
        const compact = Object.fromEntries(Object.entries(next).filter(([id, combo]) => { const action = ACTIONS.find(a => a.id === id); return action && combo !== action.combo; }));
        window.FgsSettings.update({ shortcuts: Object.keys(compact).length ? JSON.stringify(compact) : '' });
    }

    // --- the listener ------------------------------------------------------------------------------------------------------
    let recording = false;
    document.addEventListener('keydown', event => {
        if (recording || event.defaultPrevented || event.isComposing) return;
        if (document.querySelector('.modal.show, .ais-overlay, .plugin-modal-back')) return;
        const combo = comboFromEvent(event);
        const action = combo && table().get(combo);
        if (!action) return;
        // Formatting acts on the note: not while typing in the chat, the settings or any other field.
        if (action.needsEditor) {
            const target = event.target;
            const inNote = target.id === 'markdown-editor' || (target.closest && target.closest('.live-host')) || target === document.body;
            if (!inNote || !(A().canFormat && A().canFormat())) return;
        }
        event.preventDefault();
        action.run();
    });

    // --- tooltips show the current shortcut -----------------------------------------------------------------------------
    function updateTitles() {
        const saved = overrides();
        ACTIONS.forEach(action => {
            if (!action.button) return;
            document.querySelectorAll(action.button).forEach(node => {
                if (!node.dataset.baseTitle) node.dataset.baseTitle = (node.getAttribute('title') || action.label).replace(/\s*\([^)]*\)\s*$/, '');
                const label = describe(comboOf(action, saved));
                node.title = node.dataset.baseTitle + (label ? ` (${label})` : '');
            });
        });
    }

    // --- the settings panel ------------------------------------------------------------------------------------------------
    let note = null;                          // what the last reassignment did, shown under the row it concerned
    function render() {
        const panel = document.querySelector('[data-settings-panel="shortcuts"]');
        if (!panel) return;
        const saved = overrides();
        const groups = [...new Set(ACTIONS.map(action => action.group))];
        panel.replaceChildren();
        const intro = document.createElement('p');
        intro.className = 'settings-note';
        intro.style.margin = '0 0 4px';
        intro.textContent = 'Нажмите на сочетание и введите новое. Esc отменяет, Backspace снимает сочетание. Tab и Shift+Tab в редакторе всегда ставят и убирают отступ.';
        panel.append(intro);
        groups.forEach(group => {
            const title = document.createElement('h3');
            title.className = 'shortcut-group';
            title.textContent = group;
            panel.append(title);
            ACTIONS.filter(action => action.group === group).forEach(action => {
                const combo = comboOf(action, saved);
                const row = document.createElement('div');
                row.className = 'setting-item shortcut-row';
                const info = document.createElement('div');
                info.className = 'setting-info';
                info.innerHTML = '<span class="setting-name"></span><div class="setting-desc"></div>';
                info.firstChild.textContent = action.label;
                const desc = info.lastChild;
                if (note && note.id === action.id) { desc.textContent = note.text; desc.classList.add('is-note'); } else desc.hidden = true;
                const control = document.createElement('div');
                control.className = 'setting-control shortcut-control';
                const key = document.createElement('button');
                key.type = 'button';
                key.className = 'shortcut-key' + (combo ? '' : ' is-empty');
                key.textContent = describe(combo) || 'Не назначено';
                key.dataset.id = action.id;
                key.setAttribute('aria-label', `${action.label}: ${describe(combo) || 'не назначено'}. Нажмите, чтобы изменить`);
                key.addEventListener('click', () => record(key, action));
                const reset = document.createElement('button');
                reset.type = 'button';
                reset.className = 'shortcut-reset icon-button';
                reset.hidden = combo === action.combo;
                reset.title = 'Вернуть ' + (describe(action.combo) || '«не назначено»');
                reset.setAttribute('aria-label', 'Сбросить сочетание: ' + action.label);
                reset.innerHTML = window.icon ? window.icon('refresh') : '↺';
                reset.addEventListener('click', () => { note = null; const next = overrides(); delete next[action.id]; save(next); });
                control.append(key, reset);
                row.append(info, control);
                panel.append(row);
            });
        });
        const all = document.createElement('button');
        all.type = 'button';
        all.className = 'button-secondary shortcut-reset-all';
        all.textContent = 'Сбросить все сочетания';
        all.disabled = !Object.keys(saved).length;
        all.addEventListener('click', () => { note = null; save({}); });
        panel.append(all);
    }

    function record(button, action) {
        if (recording) return;
        recording = true;
        button.classList.add('is-recording');
        button.textContent = 'Нажмите сочетание…';
        const finish = () => { recording = false; document.removeEventListener('keydown', onKey, true); document.removeEventListener('click', onOutside, true); render(); };
        const onOutside = event => { if (event.target !== button) finish(); };
        const onKey = event => {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Escape') return finish();
            const next = overrides();
            if (event.key === 'Backspace' || event.key === 'Delete') { note = null; next[action.id] = ''; save(next); return finish(); }
            const combo = comboFromEvent(event);
            if (!combo) return;                                   // only a modifier so far: wait for the key
            const trouble = problem(combo);
            if (trouble) { note = { id: action.id, text: trouble }; return finish(); }
            const holder = ACTIONS.find(other => other.id !== action.id && comboOf(other, next) === combo);
            if (holder) next[holder.id] = '';
            next[action.id] = combo;
            note = holder ? { id: action.id, text: `Сочетание забрано у действия «${holder.label}»: у него теперь нет сочетания.` } : null;
            save(next);
            finish();
        };
        document.addEventListener('keydown', onKey, true);
        setTimeout(() => document.addEventListener('click', onOutside, true));
    }

    window.FgsShortcuts = { ACTIONS, describe, comboOf };
    window.addEventListener('fgs-settings', () => { updateTitles(); if (!recording) render(); });
    document.addEventListener('DOMContentLoaded', () => { updateTitles(); render(); });
})();
