// Settings → ИИ → «Модель на телефоне»: the list of models that run on the device, with download, progress and removal.
// The work itself is done by ai/web-backend.js (device) and the engine behind it (device-engine/index.js).
(function () {
    const web = window.FgsAiWeb;
    if (!web || !web.device) return;                               // the desktop app has no on-device models
    const D = web.device;
    const modelKey = 'ai-model-device';
    const state = { progress: {}, errors: {}, busy: null, armed: null };
    let host = null, hint = null, redraw = 0;

    const size = bytes => bytes >= 1e9 ? (bytes / 1e9).toFixed(1).replace('.', ',') + ' ГБ' : Math.round(bytes / 1e6) + ' МБ';
    const escapeHtml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const selected = () => (window.FgsSettings && window.FgsSettings.get()[modelKey]) || '';

    async function draw() {
        if (!host) return;
        const caps = await D.capabilities();
        const ready = await D.verify(), chosen = selected();
        const storage = await D.storage();
        const cards = await Promise.all(D.catalog.map(async model => {
            const choice = await D.pick(model);
            const bytes = choice ? choice.bytes : 0;
            const progress = state.progress[model.id];
            const downloaded = !!ready[model.id];
            let side;
            if (progress) {
                const percent = progress.total ? Math.min(100, Math.round(progress.loaded / progress.total * 100)) : 0;
                side = `<span class="dev-progress"><span class="dev-progress-top"><span>${size(progress.loaded)} из ${size(progress.total || bytes)}</span><span>${percent}%</span></span><span class="dev-track"><span style="width:${percent}%"></span></span></span>`;
            } else if (downloaded) {
                side = `<span class="dev-badge">Скачана</span><button type="button" class="dev-button is-quiet" data-act="remove" data-id="${model.id}">${state.armed === model.id ? 'Точно удалить?' : 'Удалить'}</button>`;
            } else if (!choice) {
                side = '<span class="dev-badge is-muted">Нужен WebGPU</span>';
            } else {
                side = `<button type="button" class="dev-button" data-act="download" data-id="${model.id}" ${state.busy ? 'disabled' : ''}>Скачать · ${size(bytes)}</button>`;
            }
            const error = state.errors[model.id] ? `<small class="dev-error">${escapeHtml(state.errors[model.id])}</small>` : '';
            const picked = downloaded && chosen === model.id;
            return `<div class="dev-model${picked ? ' is-picked' : ''}${downloaded ? ' is-ready' : ''}" role="radio" aria-checked="${picked}" tabindex="${downloaded ? 0 : -1}" data-id="${model.id}">
                <span class="ais-radio" aria-hidden="true"></span>
                <span class="dev-text"><strong>${model.title}</strong><small>${model.note}</small>${error}</span>
                <span class="dev-side">${side}</span></div>`;
        }));
        host.innerHTML = `<div class="dev-models" role="radiogroup" aria-label="Модели на телефоне">${cards.join('')}</div>`;
        if (hint) {
            const free = storage ? ` Свободно на устройстве: ${size(storage.free)}.` : '';
            hint.textContent = (caps.backend === 'webgpu' ? 'Телефон считает на графическом процессоре (WebGPU): ответы быстрые.' : 'Графического ускорения нет: модель считает на процессоре, ответы будут медленнее.')
                + ' Модель скачивается один раз, потом работает без интернета.' + free;
        }
    }
    function schedule() { if (!redraw) redraw = setTimeout(() => { redraw = 0; draw(); }, 250); }

    async function download(id) {
        if (state.busy) return;
        state.busy = id;
        state.errors[id] = '';
        state.progress[id] = { loaded: 0, total: 0 };
        draw();
        try {
            await D.download(id, info => { state.progress[id] = info; schedule(); });
            window.FgsSettings.update({ [modelKey]: id });
        } catch (error) {
            state.errors[id] = (error && error.message) || String(error);
        } finally {
            state.busy = null;
            delete state.progress[id];
            draw();
        }
    }

    function mount(container, hintNode) {
        host = container;
        hint = hintNode;
        if (!host.dataset.bound) {
            host.dataset.bound = '1';
            host.addEventListener('click', async event => {
                const button = event.target.closest('[data-act]');
                if (button) {
                    const { act, id } = button.dataset;
                    if (act === 'download') return download(id);
                    if (act === 'remove') {
                        if (state.armed !== id) { state.armed = id; draw(); setTimeout(() => { if (state.armed === id) { state.armed = null; draw(); } }, 3000); return; }
                        state.armed = null;
                        await D.remove(id);
                        if (selected() === id) window.FgsSettings.update({ [modelKey]: '' });
                        return draw();
                    }
                }
                const card = event.target.closest('.dev-model.is-ready');
                if (card) { window.FgsSettings.update({ [modelKey]: card.dataset.id }); draw(); }
            });
            host.addEventListener('keydown', event => {
                const card = event.target.closest && event.target.closest('.dev-model.is-ready');
                if (card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); window.FgsSettings.update({ [modelKey]: card.dataset.id }); draw(); }
            });
        }
        draw();
    }
    window.FgsDeviceUI = { mount, refresh: draw };
})();
