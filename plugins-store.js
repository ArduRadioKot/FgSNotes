// Plugin store: the catalog is embedded in plugins.html (written by scripts/build-plugins-site.js); files are downloaded from plugins/<file>.
(function () {
    const data = JSON.parse(document.getElementById('plugins-data').textContent);
    const grid = document.getElementById('pluginGrid');
    const search = document.getElementById('pluginSearch');
    const filters = document.getElementById('pluginFilters');
    const counter = document.getElementById('pluginCount');
    let filter = 'all', query = '';

    const text = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const plural = (n, forms) => { const a = n % 100, b = n % 10; return forms[a > 10 && a < 20 ? 2 : b === 1 ? 0 : b >= 2 && b <= 4 ? 1 : 2]; };
    const kb = bytes => (bytes / 1024).toFixed(1).replace('.', ',') + ' КБ';

    filters.innerHTML = [['all', 'Все'], ...Object.entries(data.categories)].map(([id, label], i) => `<button aria-pressed="${i === 0}" data-filter="${id}">${text(label)}</button>`).join('');

    function render() {
        const shown = data.plugins.filter(p => (filter === 'all' || p.category === filter)
            && (!query || (p.name + ' ' + p.description + ' ' + (p.obsidian || '')).toLowerCase().includes(query)));
        counter.textContent = `${shown.length} ${plural(shown.length, ['плагин', 'плагина', 'плагинов'])}`;
        if (!shown.length) { grid.innerHTML = '<p class="empty">Ничего не найдено. Попробуйте другое слово или сбросьте фильтр.</p>'; return; }
        grid.innerHTML = shown.map(p => `
            <article class="pcard">
                <div class="phead">
                    <span class="ptile" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${p.icon}</svg></span>
                    <div><h3>${text(p.name)}</h3><span class="pmeta">${text(data.categories[p.category])} · v${text(p.version)} · ${kb(p.size)}</span></div>
                </div>
                <p>${text(p.description)}</p>
                <div class="ptags">${p.obsidian ? `<span class="chip">Как в Obsidian: ${text(p.obsidian)}</span>` : ''}${p.online ? '<span class="chip">Нужен интернет</span>' : ''}</div>
                <div class="actions">
                    <a class="btn primary small" href="plugins/${p.file}" download="${p.file}"><svg class="icon"><use href="#i-download"/></svg>Скачать .js</a>
                </div>
            </article>`).join('');
    }

    search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(); });
    filters.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        filter = button.dataset.filter;
        filters.querySelectorAll('button').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
        if (window.pluginFilterLens) window.pluginFilterLens(true);
        render();
    });
    if (window.createLens) window.pluginFilterLens = window.createLens(filters, 'button[aria-pressed="true"]');
    render();
})();
