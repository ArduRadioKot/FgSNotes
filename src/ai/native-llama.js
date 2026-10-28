// On-device models inside the iPhone app: llama.cpp (GGUF files, Metal) through the FgsLlama Capacitor plugin
// (plugins/fgs-llama). The web view only drives it, so the weights never pass through JavaScript memory.
// Provides the same `device` object as the WebAssembly fallback in web-backend.js; without the plugin nothing is defined.
(function () {
    const cap = window.Capacitor;
    const plugin = cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.FgsLlama;
    if (!plugin) return;

    // size: bytes of the Q4_K_M file. A model is offered when it fits in about a third of the phone's memory.
    const CATALOG = [
        { id: 'smollm2-360m', title: 'SmolLM2 · 360M', repo: 'bartowski/SmolLM2-360M-Instruct-GGUF', file: 'SmolLM2-360M-Instruct-Q4_K_M.gguf', size: 270590880, note: 'Самая лёгкая: подходит любому телефону, для коротких ответов и правки текста' },
        { id: 'qwen3.5-0.8b', title: 'Qwen 3.5 · 0,8B', repo: 'unsloth/Qwen3.5-0.8B-GGUF', file: 'Qwen3.5-0.8B-Q4_K_M.gguf', size: 532517120, note: 'Рекомендуем для начала: самая новая из маленьких, хорошо пишет по-русски' },
        { id: 'qwen3.5-2b', title: 'Qwen 3.5 · 2B', repo: 'unsloth/Qwen3.5-2B-GGUF', file: 'Qwen3.5-2B-Q4_K_M.gguf', size: 1281e6, note: 'Заметно умнее, нужен телефон с 6 ГБ памяти и больше' },
        { id: 'ministral-3b', title: 'Mistral Ministral 3 · 3B', repo: 'unsloth/Ministral-3-3B-Instruct-2512-GGUF', file: 'Ministral-3-3B-Instruct-2512-Q4_K_M.gguf', size: 2146e6, note: 'Модель Mistral для телефона: сильная, нужно от 8 ГБ памяти' },
        { id: 'phi-4-mini', title: 'Microsoft Phi-4 mini · 3,8B', repo: 'unsloth/Phi-4-mini-instruct-GGUF', file: 'Phi-4-mini-instruct-Q4_K_M.gguf', size: 2492e6, note: 'Сильная в логике и правке текста, лучше на английском. Нужно от 8 ГБ памяти' },
        { id: 'qwen3.5-4b', title: 'Qwen 3.5 · 4B', repo: 'unsloth/Qwen3.5-4B-GGUF', file: 'Qwen3.5-4B-Q4_K_M.gguf', size: 2741e6, note: 'Самая умная из доступных, нужно от 8 ГБ памяти' }
    ];
    const KEY = 'fgsnotes.device-models';
    const ready = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
    const markReady = (id, entry) => { const all = ready(); if (entry) all[id] = entry; else delete all[id]; try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage unavailable */ } };

    let infoPromise = null;
    const info = () => infoPromise || (infoPromise = plugin.info());

    const listeners = { progress: new Set(), token: new Set() };
    ['progress', 'token'].forEach(name => plugin.addListener(name, event => listeners[name].forEach(listener => listener(event))));

    const device = {
        catalog: CATALOG,
        native: true,
        async capabilities() { const found = await info(); return { backend: found.gpu ? 'metal' : 'cpu', native: true, memory: found.memory }; },
        ready,
        async verify() {
            const all = ready();
            for (const id of Object.keys(all)) {
                const model = CATALOG.find(item => item.id === id);
                let present = false;
                if (model && all[id].native) { try { present = (await plugin.status({ file: model.file })).exists; } catch { /* plugin unavailable */ } }
                if (!present) markReady(id, null);
            }
            return ready();
        },
        async pick(model) {
            const found = await info();
            return model.size <= found.memory * 0.36 ? { backend: found.gpu ? 'metal' : 'cpu', dtype: 'q4_k_m', bytes: model.size } : null;
        },
        async storage() { const found = await info(); return { free: found.free }; },
        async download(id, onProgress) {
            const model = CATALOG.find(entry => entry.id === id);
            if (!model) throw new Error(typeof t === 'function' ? t('Неизвестная модель') : 'Неизвестная модель');
            if (!(await this.pick(model))) throw new Error(typeof t === 'function' ? t('Для этой модели не хватит памяти телефона. Выберите модель поменьше.') : 'Для этой модели не хватит памяти телефона. Выберите модель поменьше.');
            let size = model.size;
            try {      // the exact size lets the plugin check that the file arrived whole
                const tree = await (await fetch(`https://huggingface.co/api/models/${model.repo}/tree/main`)).json();
                const item = tree.find(entry => entry.path === model.file);
                if (item && item.size) size = item.size;
            } catch { /* offline listing: the size from the catalog is used */ }
            const handle = await plugin.addListener('progress', event => { if (event.id === id && onProgress) onProgress({ loaded: event.loaded, total: event.total || size }); });
            try {
                await plugin.download({ id, file: model.file, size, url: `https://huggingface.co/${model.repo}/resolve/main/${model.file}` });
            } finally { handle.remove(); }
            markReady(id, { native: true, file: model.file, bytes: size, at: Date.now() });
        },
        async remove(id) {
            const model = CATALOG.find(entry => entry.id === id);
            if (model) await plugin.remove({ file: model.file });
            markReady(id, null);
        },
        async unload() { await plugin.unload(); }
    };

    // Streams an answer; resolves { ok } like the other providers.
    async function chat({ id, model, messages, think }, onDelta, signal) {
        const found = CATALOG.find(item => item.id === model);
        if (!found || !ready()[model]) throw new Error(typeof t === 'function' ? t('Модель не скачана. Откройте Настройки → ИИ и скачайте её.') : 'Модель не скачана. Откройте Настройки → ИИ и скачайте её.');
        const handle = await plugin.addListener('token', event => { if (event.id === id) onDelta(event.text); });
        const stop = () => plugin.stop({ id });
        if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
        try {
            await plugin.generate({ id, file: found.file, messages, think: !!think, maxTokens: 4096, context: 4096 });
        } finally { handle.remove(); }
    }

    window.FgsNativeLlama = { device, chat };
})();
