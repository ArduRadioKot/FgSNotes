// Liquid Glass playground: live controls over the shared presets/limits.
(function () {
    const { presets, groups, labels, limits, base } = window.LiquidGlassPresets;
    const world = document.getElementById('pg-world');
    const sliders = document.getElementById('pg-sliders');
    const output = {};
    const inputs = {};
    const $ = id => document.getElementById(id);

    // Background content: dense text, colour swatches.
    const paragraphs = ['Стекло преломляет свет на кромке и почти не искажает центр.', 'Мелкий текст под линзой помогает увидеть сдвиг, дисперсию и блики.', 'Линия и контуры букв должны плавно изгибаться у края без двоения.'];
    const swatches = ['#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#12a594', '#3e63dd', '#8e4ec6', '#d6409f', '#111', '#fff'];
    function fillSwatches() {
        $('pg-backdrop').innerHTML = Array.from({ length: 120 }, (_, i) => `<div class="pg-swatch" style="background:${swatches[i % swatches.length]};${i % swatches.length === 9 ? 'color:#111' : ''}">${i + 1}</div>`).join('');
    }
    function fillText() {
        $('pg-backdrop').innerHTML = Array.from({ length: 14 }, (_, i) => `<h3>Раздел ${i + 1}</h3><p>${paragraphs.join(' ')} ${paragraphs.join(' ')}</p>`).join('');
    }

    fillText();

    // Controls
    $('pg-preset').innerHTML = Object.entries(presets).map(([key, value]) => `<option value="${key}">${value.label}</option>`).join('');
    for (const [title, keys] of groups) {
        const heading = document.createElement('div');
        heading.className = 'pg-group'; heading.textContent = title; sliders.appendChild(heading);
        for (const key of keys) {
            const [min, max, step] = limits[key];
            const row = document.createElement('div');
            row.className = 'pg-slider';
            row.innerHTML = `<label for="pg-${key}">${labels[key]}</label><output id="pg-out-${key}"></output><input type="range" id="pg-${key}" min="${min}" max="${max}" step="${step}" />`;
            sliders.appendChild(row);
            inputs[key] = row.querySelector('input'); output[key] = row.querySelector('output');
            inputs[key].addEventListener('input', () => window.LiquidGlass.configure({ overrides: { [key]: Number(inputs[key].value) } }));
        }
    }
    function format(value) { return Number(value).toFixed(Math.abs(value) < 10 && value % 1 ? 2 : 0); }
    function sync() {
        const state = window.LiquidGlass.getState();
        const config = state.config;
        for (const key of Object.keys(inputs)) { inputs[key].value = config[key]; output[key].textContent = format(config[key]); }
        $('pg-preset').value = state.preset; $('pg-quality').value = state.quality;
        $('pg-refraction').checked = state.refraction; $('pg-animations').checked = state.animations;
        $('pg-tint').value = config.tint;
        document.documentElement.style.setProperty('--lg-radius', config.radius + 'px');
        $('pg-info').textContent = `Режим: ${state.mode === 'low' ? 'простое стекло (blur, тонировка, блики)' : state.mode === 'medium' ? 'преломление, упрощённое' : 'полное преломление и дисперсия'}. Преломление через SVG-фильтр в backdrop-filter работает только в Chromium; в Safari и Firefox включается простое стекло.`;
    }
    window.addEventListener('liquidglasschange', sync);

    $('pg-preset').addEventListener('change', event => window.LiquidGlass.configure({ preset: event.target.value, reset: true }));
    $('pg-quality').addEventListener('change', event => window.LiquidGlass.configure({ quality: event.target.value }));
    $('pg-theme').addEventListener('change', event => { document.documentElement.dataset.theme = event.target.value; });
    $('pg-refraction').addEventListener('change', event => window.LiquidGlass.configure({ refraction: event.target.checked }));
    $('pg-animations').addEventListener('change', event => window.LiquidGlass.configure({ animations: event.target.checked }));
    $('pg-tint').addEventListener('input', event => window.LiquidGlass.configure({ overrides: { tint: event.target.value } }));
    $('pg-reset').addEventListener('click', () => { window.LiquidGlass.configure({ preset: 'regular', reset: true, refraction: true, animations: true, quality: 'auto' }); });
    $('pg-copy').addEventListener('click', async () => {
        const { preset, overrides, quality } = window.LiquidGlass.getState();
        try { await navigator.clipboard.writeText(JSON.stringify({ preset, quality, overrides }, null, 2)); $('pg-copy').textContent = 'Скопировано'; }
        catch { $('pg-copy').textContent = 'Не удалось скопировать'; }
        setTimeout(() => { $('pg-copy').textContent = 'Скопировать JSON'; }, 1400);
    });

    // Background and compare switches
    document.querySelectorAll('[data-bg]').forEach(button => button.addEventListener('click', () => {
        document.querySelectorAll('[data-bg]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
        world.dataset.bg = button.dataset.bg;
        if (button.dataset.bg === 'color') fillSwatches(); else if (button.dataset.bg === 'text') fillText(); else $('pg-backdrop').innerHTML = '<div style="height:1600px"></div>';
        refreshAll();
    }));
    document.querySelectorAll('[data-compare]').forEach(button => button.addEventListener('click', () => {
        document.querySelectorAll('[data-compare]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
        world.dataset.compare = button.dataset.compare;
    }));
    world.dataset.compare = 'after';

    // Morph: the card changes size and radius; the lens map follows at most once per frame.
    $('pg-morph').addEventListener('click', event => {
        const card = $('pg-card');
        const large = card.dataset.large !== 'true';
        card.dataset.large = String(large);
        card.style.borderRadius = large ? '44px' : '';
        event.currentTarget.setAttribute('aria-pressed', String(large));
    });
    // Many glass elements at once, to check cost and overlap.
    const extra = [];
    $('pg-multi').addEventListener('click', event => {
        const on = event.currentTarget.getAttribute('aria-pressed') !== 'true';
        event.currentTarget.setAttribute('aria-pressed', String(on));
        if (!on) { extra.splice(0).forEach(element => { window.LiquidGlass.destroy(element); element.remove(); }); return; }
        for (let i = 0; i < 24; i++) {
            const element = document.createElement('div');
            element.className = 'pg-multi';
            element.style.left = (12 + (i % 6) * 15) + '%'; element.style.top = (28 + Math.floor(i / 6) * 14) + '%';
            document.querySelector('.pg-overlay').appendChild(element);
            window.LiquidGlass.attach(element); extra.push(element);
        }
    });

    // Drag the card around over the background.
    const card = $('pg-card');
    let drag = null;
    card.addEventListener('pointerdown', event => {
        if (event.target.closest('button')) return;
        const box = card.getBoundingClientRect(), parent = card.offsetParent.getBoundingClientRect();
        drag = { dx: event.clientX - box.left, dy: event.clientY - box.top, parent };
        card.setPointerCapture(event.pointerId); card.classList.add('dragging');
    });
    card.addEventListener('pointermove', event => {
        if (!drag) return;
        card.style.left = Math.max(0, Math.min(drag.parent.width - card.offsetWidth, event.clientX - drag.parent.left - drag.dx)) + 'px';
        card.style.top = Math.max(0, Math.min(drag.parent.height - card.offsetHeight, event.clientY - drag.parent.top - drag.dy)) + 'px';
    });
    const stopDrag = () => { drag = null; card.classList.remove('dragging'); };
    card.addEventListener('pointerup', stopDrag); card.addEventListener('pointercancel', stopDrag);

    function refreshAll() { document.querySelectorAll('[data-pg-glass]').forEach(element => window.LiquidGlass.attach(element)); }
    refreshAll();
    sync();
})();
