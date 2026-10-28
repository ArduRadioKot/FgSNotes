// Ollama setup dialog: walks through the three things the assistant needs: Ollama installed, server running, a model downloaded.
// It checks the real state every few seconds, so the dialog moves on by itself when the user finishes a step.
(function () {
    const tr = (key, vars) => (typeof t === 'function' ? t(key, vars) : key);
    const api = window.electron;
    if (!api || !api.aiDetect) return;

    // Compact models that handle Russian text well, picked from the Ollama library (Qwen 3.5 is the newest small family).
    const MODELS = [
        { name: 'qwen3.5:0.8b', title: 'Qwen 3.5 · 0,8B', size: 1.2e9, note: 'Самая маленькая: для слабых компьютеров и быстрых правок' },
        { name: 'qwen3.5:2b', title: 'Qwen 3.5 · 2B', size: 2.7e9, note: 'Лёгкая и заметно умнее младшей' },
        { name: 'qwen3.5:4b', title: 'Qwen 3.5 · 4B', size: 3.4e9, note: 'Рекомендуем: лучший баланс скорости и качества' },
        { name: 'qwen3.5:9b', title: 'Qwen 3.5 · 9B', size: 6.6e9, note: 'Самая сильная из компактных, нужно от 12 ГБ памяти' },
        { name: 'qwen3.8:27b', title: 'Qwen 3.8 · 27B', size: 18e9, note: 'Самая умная, но тяжёлая: нужно от 24 ГБ памяти и мощный Mac или видеокарта' },
        { name: 'MichelRosselli/bonsai-27b', title: 'Bonsai 27B · 1 бит', size: 4.4e9, note: 'Модель на 27 млрд параметров, сжатая до 1 бита. Нужна Ollama 0.32.5 и новее' }
    ];
    const STEPS = ['Установка', 'Запуск', 'Модель'];
    const PULL_STATUS = { 'pulling manifest': 'Получаю список файлов…', 'verifying sha256 digest': 'Проверяю файлы…', 'writing manifest': 'Завершаю…', 'removing any unused layers': 'Завершаю…', success: 'Готово' };

    const escapeHtml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const size = bytes => bytes >= 1e9 ? (bytes / 1e9).toFixed(1).replace('.', ',') + ' ' + tr('ГБ') : Math.round(bytes / 1e6) + ' ' + tr('МБ');
    const url = () => ((window.FgsSettings && window.FgsSettings.get()['ai-url']) || 'http://localhost:11434').trim();

    let root = null, timer = null, onDone = null, opener = null, lastHtml = '';
    let state = { install: { installed: false }, server: { ok: false, models: [] }, view: null, picked: 'qwen3.5:4b', custom: '', launching: false, pull: null, error: '' };

    function phase() {
        if (!state.server.ok) return state.install.installed ? 'start' : 'install';
        if (!state.server.models.length || state.view === 'catalog') return 'catalog';
        return 'ready';
    }
    const reached = () => ({ install: 0, start: 1, catalog: 2, ready: 3 }[phase()]);

    async function probe() {
        const [install, server] = await Promise.all([api.aiDetect(), api.aiModels({ provider: 'ollama', url: url() })]);
        if (!root) return;
        state.install = install;
        state.server = server.ok ? server : { ok: false, models: [], error: server.error };
        if (state.server.ok && state.launching) state.launching = false;
        render();
    }

    function render() {
        if (!root) return;
        const current = phase(), done = reached();
        const stepsHtml = STEPS.map((label, index) => {
            const status = index < done ? 'done' : index === done ? 'current' : 'todo';
            const busy = status === 'current' && (state.launching || state.pull);
            return `<li class="ais-step is-${status}${busy ? ' is-busy' : ''}"><span class="ais-bar"></span><span class="ais-step-label">${index < done ? icon('check') : ''}${tr(label)}</span></li>`;
        }).join('');
        const body = { install, start, catalog, ready }[current]();
        const orb = current === 'ready' ? 'ok' : state.launching || state.pull ? 'busy' : current === 'install' ? 'idle' : 'wait';
        const html = `
            <button type="button" class="ais-close icon-button" data-act="close" aria-label="${tr('Закрыть')}">${icon('close')}</button>
            <ol class="ais-steps" aria-label="${tr('Шаги настройки')}">${stepsHtml}</ol>
            <div class="ais-hero"><span class="ais-orb is-${orb}" aria-hidden="true">${icon(current === 'ready' ? 'check' : 'sparkles')}</span>${body.head}</div>
            ${body.main || ''}
            <div class="ais-actions">${body.actions}</div>
            ${state.error ? `<p class="ais-error" role="alert">${escapeHtml(state.error)}</p>` : ''}`;
        // The state is polled every few seconds; touching the DOM only on a real change keeps focus and hover steady.
        if (html === lastHtml) return;
        lastHtml = html;
        const wasTyping = document.activeElement && document.activeElement.classList.contains('ais-custom-input');
        root.querySelector('.ais-dialog').innerHTML = html;
        const field = root.querySelector('.ais-custom-input');
        if (field) {
            field.value = state.custom;
            if (wasTyping) { field.focus(); field.setSelectionRange(field.value.length, field.value.length); }
        }
        const focus = root.querySelector('[data-primary]');
        if (wasTyping) return;
        if (focus && !root.contains(document.activeElement)) focus.focus({ preventScroll: true });
        else if (!root.contains(document.activeElement)) root.querySelector('.ais-dialog').focus({ preventScroll: true });
    }

    const head = (title, text) => `<div><h2 id="ais-title">${tr(title)}</h2><p>${tr(text)}</p></div>`;
    function install() {
        return {
            head: head('Установите Ollama', 'Бесплатная программа, которая запускает языковые модели прямо на вашем компьютере. Заметки не покидают его.'),
            actions: `<button type="button" class="button-primary" data-act="download" data-primary>${tr('Скачать Ollama')}</button><button type="button" class="button-secondary" data-act="recheck">${tr('Проверить снова')}</button><span class="ais-hint">${tr('Окно само заметит установку.')}</span>`
        };
    }
    function start() {
        return {
            head: head('Запустите Ollama', state.launching ? 'Ждём, пока сервер ответит. Обычно это пара секунд.' : 'Ollama установлена, но сейчас не работает. FgSNotes запустит её за вас.'),
            actions: `<button type="button" class="button-primary" data-act="launch" data-primary ${state.launching ? 'disabled' : ''}>${state.launching ? tr('Запускаю…') : tr('Запустить Ollama')}</button>`
        };
    }
    function catalog() {
        const have = new Set(state.server.models);
        const pull = state.pull;
        const cards = MODELS.map(model => `
            <button type="button" class="ais-model${model.name === state.picked ? ' is-picked' : ''}" data-act="pick" data-name="${model.name}" role="radio" aria-checked="${model.name === state.picked}" ${pull ? 'disabled' : ''}>
                <span class="ais-radio" aria-hidden="true"></span>
                <span class="ais-model-text"><strong>${model.title}</strong><small>${tr(model.note)}</small></span>
                <span class="ais-size">${have.has(model.name) ? tr('Скачана') : size(model.size)}</span>
            </button>`).join('');
        const picked = MODELS.find(model => model.name === state.picked);
        let actions;
        if (pull) {
            const percent = pull.total ? Math.min(100, Math.round(pull.completed / pull.total * 100)) : 0;
            actions = `<div class="ais-progress"><div class="ais-progress-top"><span>${pull.total ? tr('{done} из {total}', { done: size(pull.completed), total: size(pull.total) }) : escapeHtml(tr(PULL_STATUS[pull.status] || 'Подготовка…'))}</span><span>${pull.total ? percent + '%' : ''}</span></div><div class="ais-track"><span style="width:${pull.total ? percent : 8}%"${pull.total ? '' : ' class="is-indeterminate"'}></span></div></div><button type="button" class="button-secondary" data-act="cancel">${tr('Отменить')}</button>`;
        } else if (have.has(state.picked)) {
            actions = `<button type="button" class="button-primary" data-act="use" data-primary>${tr('Использовать {name}', { name: picked.title })}</button>`;
        } else {
            actions = `<button type="button" class="button-primary" data-act="pull" data-primary>${tr('Скачать · {size}', { size: size(picked.size) })}</button>${state.server.models.length ? `<button type="button" class="button-secondary" data-act="back">${tr('Назад')}</button>` : ''}`;
        }
        return {
            head: head('Выберите модель', 'Модель скачивается один раз и потом работает без интернета.'),
            main: `<div class="ais-models" role="radiogroup" aria-label="${tr('Модель')}">${cards}</div>
                <p class="ais-custom-label">${tr('Нужна другая? Впишите имя из')} <a href="https://ollama.com/search" data-act="library">${tr('каталога Ollama')}</a>.</p>
                <form class="ais-custom" data-act="custom-form"><input type="text" class="ais-custom-input" placeholder="${tr('например, mistral-small3.2 или hf.co/автор/модель')}" aria-label="${tr('Имя своей модели')}" spellcheck="false" autocomplete="off" ${pull ? 'disabled' : ''} /><button type="submit" class="button-secondary" ${pull ? 'disabled' : ''}>${tr('Скачать')}</button></form>`,
            actions
        };
    }
    function ready() {
        const chosen = (window.FgsSettings && window.FgsSettings.get()['ai-model']) || '';
        const names = state.server.models.slice(0, 6);
        const cards = names.map(name => `
            <button type="button" class="ais-model${name === chosen ? ' is-picked' : ''}" data-act="choose" data-name="${escapeHtml(name)}" role="radio" aria-checked="${name === chosen}">
                <span class="ais-radio" aria-hidden="true"></span><span class="ais-model-text"><strong>${escapeHtml(name)}</strong></span>
            </button>`).join('');
        return {
            head: head('Чат готов', 'Выберите модель по умолчанию. Её можно сменить в настройках.'),
            main: `<div class="ais-models" role="radiogroup" aria-label="${tr('Скачанные модели')}">${cards}</div>`,
            actions: `<button type="button" class="button-primary" data-act="finish" data-primary>${tr('Готово')}</button><button type="button" class="button-secondary" data-act="more">${tr('Скачать другую модель')}</button>`
        };
    }

    async function pullModel(name) {
        const id = 'pull-' + Date.now().toString(36);
        state.error = '';
        state.pull = { id, completed: 0, total: 0, status: '' };
        render();
        const unsubscribe = api.onAiPull(progress => {
            if (!state.pull || progress.id !== id) return;
            state.pull.status = progress.status;
            // Layers download one after another; only the big one is worth a progress bar.
            if (progress.total > 5e7) { state.pull.completed = progress.completed; state.pull.total = progress.total; }
            render();
        });
        const result = await api.aiPull({ id, url: url(), model: name });
        unsubscribe();
        state.pull = null;
        if (!result.ok && !result.aborted) state.error = result.error;
        if (result.ok) { state.view = null; window.FgsSettings && window.FgsSettings.update({ 'ai-provider': 'ollama', 'ai-model': name }); state.custom = ''; }
        await probe();
    }

    async function launch() {
        state.error = '';
        state.launching = true;
        render();
        const result = await api.aiLaunch();
        if (!result.ok) { state.launching = false; state.error = result.error; render(); return; }
        // Give the server up to 30 seconds; the regular polling picks it up as soon as it answers.
        setTimeout(() => { if (state.launching) { state.launching = false; state.error = tr('Ollama не ответила за 30 секунд. Запустите её вручную и нажмите «Проверить снова».'); render(); } }, 30000);
    }

    function onClick(event) {
        const button = event.target.closest('[data-act]');
        if (event.target.classList.contains('ais-overlay')) return close();
        if (!button) return;
        const { act, name } = button.dataset;
        if (act === 'close') close();
        else if (act === 'library') { event.preventDefault(); api.openExternal('https://ollama.com/search'); }
        else if (act === 'download') api.openExternal('https://ollama.com/download');
        else if (act === 'recheck') { state.error = ''; probe(); }
        else if (act === 'launch') launch();
        else if (act === 'pick') { state.picked = name; render(); }
        else if (act === 'pull') pullModel(state.picked);
        else if (act === 'cancel') { const id = state.pull && state.pull.id; if (id) api.aiAbort(id); }
        else if (act === 'use') { window.FgsSettings.update({ 'ai-provider': 'ollama', 'ai-model': state.picked }); state.view = null; finish(); }
        else if (act === 'back') { state.view = null; render(); }
        else if (act === 'more') { state.view = 'catalog'; render(); }
        else if (act === 'choose') { window.FgsSettings.update({ 'ai-provider': 'ollama', 'ai-model': name }); render(); }
        else if (act === 'finish') finish();
    }

    function finish() {
        const callback = onDone;
        close();
        if (callback) callback();
    }
    function close() {
        if (!root) return;
        clearInterval(timer);
        if (state.pull) api.aiAbort(state.pull.id);
        state.pull = null; state.launching = false; state.view = null; state.error = '';
        root.remove();
        root = null;
        lastHtml = '';
        if (!document.getElementById('settings-modal').classList.contains('show')) document.querySelector('.workspace').inert = false;
        const returnTo = opener;
        opener = null;
        if (returnTo && returnTo.isConnected) returnTo.focus({ preventScroll: true });
    }

    window.addEventListener('fgs-language', () => { lastHtml = ''; render(); });
    window.FgsAiSetup = {
        open(options = {}) {
            if (root) return;
            onDone = options.onDone || null;
            opener = document.activeElement;
            root = document.createElement('div');
            root.className = 'ais-overlay';
            root.innerHTML = '<div class="ais-dialog" role="dialog" aria-modal="true" aria-labelledby="ais-title" tabindex="-1"></div>';
            root.addEventListener('click', onClick);
            root.addEventListener('input', event => { if (event.target.classList.contains('ais-custom-input')) { state.custom = event.target.value; state.error = ''; } });
            root.addEventListener('submit', event => {
                event.preventDefault();
                const name = state.custom.trim();
                if (state.pull || !name) return;
                if (!/^[\w.\-:/]+$/.test(name)) { state.error = tr('В имени модели допустимы буквы, цифры и знаки . - _ : /'); render(); return; }
                pullModel(name);
            });
            root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
            document.body.append(root);
            document.querySelector('.workspace').inert = true;
            render();
            probe();
            timer = setInterval(() => { if (!state.pull) probe(); }, 2500);
        }
    };
})();
