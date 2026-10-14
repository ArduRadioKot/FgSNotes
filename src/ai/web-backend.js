// The AI backend for the phone app (and the plain web page): the hosted providers, called straight from the web view.
// Desktop does this in the main process (see main.js); the page code (ai.js) talks to either through the same methods.
// A phone does not reach into a computer: Ollama and LM Studio are for the desktop app, so they are refused here.
// Instead the phone can run small models itself ("device" provider, see device below and device-engine/index.js).
// API keys are kept in the app's own storage. There is no system keychain behind it, and the settings say so.
(function () {
    if (window.electron && window.electron.aiChat) return;           // desktop has its own backend
    const providers = window.FgsProviders;
    if (!providers) return;

    const KEYS = 'fgsnotes.ai-keys';
    const readKeys = () => { try { return JSON.parse(localStorage.getItem(KEYS)) || {}; } catch { return {}; } };
    const writeKeys = keys => { try { localStorage.setItem(KEYS, JSON.stringify(keys)); } catch { /* storage unavailable */ } };
    const status = () => { const keys = readKeys(); return { keys: Object.fromEntries(Object.keys(providers.PRESETS).map(id => [id, !!keys[id]])), secure: false }; };
    const refused = provider => providers.PRESETS[provider] && providers.PRESETS[provider].local && provider !== 'device'
        ? { ok: false, error: 'Локальные модели работают только в приложении для компьютера. Выберите облачного провайдера.' } : null;

    // --- models that run on the phone ---------------------------------------------------------------------------------------
    // Sizes are the download for each weight format: q4f16 (WebGPU with 16-bit shaders), q4 (WebGPU), q8 (CPU through WebAssembly).
    // size: download in bytes per weight format (q4f16: WebGPU with 16-bit shaders; q4: WebGPU; q8: CPU through WebAssembly).
    // A format that is missing means the model is not offered for it. file: the main weights file name; family: which loader reads it.
    const CATALOG = [
        { id: 'qwen3.5-0.8b', title: 'Qwen 3.5 · 0,8B', repo: 'onnx-community/Qwen3.5-0.8B-Text-ONNX', file: 'model', family: 'causal', size: { q4f16: 469e6, q4: 551e6, q8: 938e6 }, note: 'Рекомендуем для начала: самая новая из маленьких, хорошо пишет по-русски' },
        { id: 'qwen3.5-2b', title: 'Qwen 3.5 · 2B', repo: 'onnx-community/Qwen3.5-2B-ONNX', file: 'decoder_model_merged', family: 'qwen3_5', size: { q4f16: 1581e6, q4: 1753e6 }, note: 'Заметно умнее, нужен телефон с 6 ГБ памяти и больше' },
        { id: 'ministral-3b', title: 'Mistral Ministral 3 · 3B', repo: 'mistralai/Ministral-3-3B-Instruct-2512-ONNX', file: 'decoder_model_merged', family: 'ministral', size: { q4f16: 2680e6, q4: 2807e6 }, note: 'Модель Mistral для телефона: сильная, но тяжёлая, нужно от 8 ГБ памяти' },
        { id: 'phi-3.5-mini', title: 'Microsoft Phi-3.5 mini · 3,8B', repo: 'onnx-community/Phi-3.5-mini-instruct-onnx-web', file: 'model', family: 'causal', size: { q4f16: 2317e6 }, note: 'Сильная в логике и правке текста, лучше на английском. Нужен WebGPU и от 8 ГБ памяти' }
    ];
    const DEVICE_KEY = 'fgsnotes.device-models';
    const ready = () => { try { return JSON.parse(localStorage.getItem(DEVICE_KEY)) || {}; } catch { return {}; } };
    const markReady = (id, entry) => { const all = ready(); if (entry) all[id] = entry; else delete all[id]; try { localStorage.setItem(DEVICE_KEY, JSON.stringify(all)); } catch { /* storage unavailable */ } };
    // Where transformers.js keeps a model's main file (the browser cache). A model counts as downloaded only while that file is there:
    // a cache that refuses large files would otherwise make the app download the model again on every start.
    const FILE_SUFFIX = { fp32: '', q8: '_quantized', q4: '_q4', q4f16: '_q4f16', fp16: '_fp16' };
    async function cachedModel(entry) {
        if (typeof caches === 'undefined') return false;
        try {
            const cache = await caches.open('transformers-cache');
            return !!(await cache.match(`https://huggingface.co/${entry.repo}/resolve/main/onnx/${entry.file || 'model'}${FILE_SUFFIX[entry.dtype] ?? ''}.onnx`));
        } catch { return false; }
    }
    // Forget models whose files are gone (cleared by the system, or never stored).
    async function verify() {
        const all = ready();
        // Models that left the catalog, or whose files are gone, are no longer "downloaded".
        for (const id of Object.keys(all)) if (!CATALOG.some(model => model.id === id) || !(await cachedModel(all[id]))) markReady(id, null);
        return ready();
    }
    let caps = null, engineLoading = null;
    // What this device can run: the backend and, in order of preference, the weight formats that suit it.
    async function capabilities() {
        if (caps) return caps;
        caps = { backend: 'wasm', order: ['q8', 'q4'] };
        if (navigator.gpu) {
            try { const adapter = await navigator.gpu.requestAdapter(); if (adapter) caps = { backend: 'webgpu', order: adapter.features.has('shader-f16') ? ['q4f16', 'q4', 'q8'] : ['q4', 'q8'] }; } catch { /* no usable GPU */ }
        }
        return caps;
    }
    // The format this device should use for a model, or null when the model does not exist in one the device can run.
    async function pick(model) {
        const found = await capabilities();
        const dtype = found.order.find(format => model.size[format]);
        return dtype ? { backend: found.backend, dtype, bytes: model.size[dtype] } : null;
    }
    // The engine is half a megabyte of script and only needed once a model is downloaded or used.
    function engine() {
        if (window.FgsDeviceEngine) return Promise.resolve(window.FgsDeviceEngine);
        if (!engineLoading) engineLoading = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'ai/device-engine.js';
            script.onload = () => resolve(window.FgsDeviceEngine);
            script.onerror = () => { engineLoading = null; reject(new Error('Не удалось загрузить движок моделей.')); };
            document.head.appendChild(script);
        });
        return engineLoading;
    }
    const device = {
        catalog: CATALOG,
        capabilities,
        ready,
        verify,
        pick,
        async storage() { try { const estimate = await navigator.storage.estimate(); return { free: estimate.quota - estimate.usage }; } catch { return null; } },
        // Downloads the weights and loads the model; onProgress({ loaded, total }) is called while it runs.
        async download(id, onProgress) {
            const model = CATALOG.find(entry => entry.id === id);
            if (!model) throw new Error('Неизвестная модель');
            const choice = await pick(model);
            if (!choice) throw new Error('Эта модель работает только на телефонах с WebGPU. Выберите другую.');
            const engineApi = await engine();
            const run = async chosen => {
                const options = { repo: model.repo, dtype: chosen.dtype, backend: chosen.backend, family: model.family };
                let shown = 0;                       // the streamed download and the loader count separately: never let the bar go back
                await engineApi.load(options, info => { shown = Math.max(shown, Math.min(info.loaded, chosen.bytes)); if (onProgress) onProgress({ loaded: shown, total: Math.max(info.total, chosen.bytes) }); });
                const entry = { ...options, file: model.file, bytes: chosen.bytes, at: Date.now() };
                if (!(await cachedModel(entry))) throw new Error('Не удалось сохранить модель на устройстве: хранилище приложения отказалось принять такой большой файл. Выберите модель поменьше.');
                markReady(id, entry);
            };
            try { await run(choice); }
            catch (error) {
                // Some phones advertise WebGPU but cannot run a model on it: try the CPU build once, if the model has one.
                const cpu = choice.backend === 'webgpu' && ['q8', 'q4'].find(format => model.size[format]);
                if (!cpu) throw error;
                caps = { backend: 'wasm', order: ['q8', 'q4'] };
                await run({ backend: 'wasm', dtype: cpu, bytes: model.size[cpu] });
            }
        },
        async remove(id) {
            const model = CATALOG.find(entry => entry.id === id);
            if (model) { const engineApi = await engine(); await engineApi.purge(model.repo); }
            markReady(id, null);
        },
        async unload() { if (window.FgsDeviceEngine) await window.FgsDeviceEngine.unload(); }
    };

    const listeners = new Set();
    const controllers = new Map();
    const emit = payload => listeners.forEach(listener => listener(payload));

    window.FgsAiWeb = {
        mobile: true,
        device,
        aiModels: async ({ provider, url }) => provider === 'device' ? { ok: true, models: Object.keys(ready()) } : refused(provider) || providers.listModels({ provider, url, key: readKeys()[provider] }),
        async aiChat({ id, provider, url, model, messages, temperature, think }) {
            const controller = new AbortController();
            const denied = refused(provider);
            if (denied) return denied;
            controllers.set(id, controller);
            if (provider === 'device') {
                try {
                    const entry = ready()[model], found = CATALOG.find(item => item.id === model);
                    if (!entry || !found) throw new Error('Модель не скачана. Откройте Настройки → ИИ и скачайте её.');
                    const engineApi = await engine();
                    await engineApi.generate({ repo: found.repo, dtype: entry.dtype, backend: entry.backend, family: found.family, messages, think: !!think }, delta => emit({ id, delta }), controller.signal);
                    return { ok: true };
                } catch (error) {
                    return { ok: false, error: controller.signal.aborted ? 'Остановлено' : (error.message || String(error)), aborted: controller.signal.aborted };
                } finally { controllers.delete(id); }
            }
            const result = await providers.chat({ provider, url, key: readKeys()[provider], model, messages, temperature, think: !!think },
                delta => emit({ id, delta }), controller.signal, text => emit({ id, thinking: text }));
            controllers.delete(id);
            return result;
        },
        aiAbort(id) { const controller = controllers.get(id); if (controller) controller.abort(); },
        onAiChunk(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        aiKeyStatus: async () => status(),
        async aiKeySet(provider, key) { if (!providers.PRESETS[provider]) throw new Error('Неизвестный провайдер'); const keys = readKeys(); const value = String(key || '').trim(); if (value) keys[provider] = value; else delete keys[provider]; writeKeys(keys); return status(); },
        async aiKeyClear(provider) { const keys = readKeys(); delete keys[provider]; writeKeys(keys); return status(); },
        // Installing or starting Ollama is a computer's job.
        aiDetect: async () => ({ installed: false, kind: null, path: '' }),
        openExternal(url) { window.open(url, '_blank', 'noopener'); }
    };
})();
