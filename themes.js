// Themes store: cards come from themes-data.json (colours and descriptions), previews are real screenshots of the app.
(function () {
    const grid = document.getElementById('themeGrid');
    const search = document.getElementById('themeSearch');
    const filters = document.getElementById('themeFilters');
    const counter = document.getElementById('themeCount');
    const viewer = document.getElementById('themeViewer');
    let themes = [], filter = 'all', query = '';

    const text = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    function plural(value, forms) {
        const mod100 = value % 100, mod10 = value % 10;
        return forms[mod100 > 10 && mod100 < 20 ? 2 : mod10 === 1 ? 0 : mod10 >= 2 && mod10 <= 4 ? 1 : 2];
    }
    function render() {
        const shown = themes.filter(theme => (filter === 'all' || theme.mode === filter || theme.category === filter)
            && (!query || (theme.name + ' ' + theme.description + ' ' + theme.tags.join(' ')).toLowerCase().includes(query)));
        counter.textContent = `${shown.length} ${plural(shown.length, ['тема', 'темы', 'тем'])}`;
        if (!shown.length) { grid.innerHTML = '<p class="empty">Ничего не найдено. Попробуйте другое слово или сбросьте фильтр.</p>'; return; }
        grid.innerHTML = shown.map(theme => `
            <article class="tcard">
                <button class="thumb" data-view="${theme.id}" aria-label="Открыть превью темы ${text(theme.name)}"><img src="${theme.image}" alt="Тема ${text(theme.name)} в редакторе" loading="lazy" width="960" height="600"></button>
                <div class="meta">
                    <div class="row"><h3>${text(theme.name)}</h3><span class="dots" aria-hidden="true">${theme.colors.map(color => `<i style="background:${color}"></i>`).join('')}</span></div>
                    <p>${text(theme.description)}</p>
                </div>
                <div class="actions">
                    <a class="btn primary small" href="themes/${theme.id}.css" download="${theme.id}.css"><svg class="icon"><use href="#i-download"/></svg>Скачать .css</a>
                    <button class="btn small" data-view="${theme.id}">Превью</button>
                </div>
            </article>`).join('');
    }
    grid.addEventListener('click', event => {
        const trigger = event.target.closest('[data-view]');
        if (!trigger) return;
        const theme = themes.find(item => item.id === trigger.dataset.view);
        if (!theme) return;
        viewer.querySelector('h3').textContent = theme.name;
        viewer.querySelector('img').src = theme.image;
        viewer.querySelector('img').alt = `Тема ${theme.name} в редакторе`;
        viewer.querySelector('a.btn').href = `themes/${theme.id}.css`;
        viewer.querySelector('a.btn').setAttribute('download', theme.id + '.css');
        viewer.showModal();
    });
    viewer.addEventListener('click', event => { if (event.target === viewer || event.target.closest('[data-close]')) viewer.close(); });
    search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(); });
    filters.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        filter = button.dataset.filter;
        filters.querySelectorAll('button').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
        window.themeFilterLens(true);
        render();
    });
    window.themeFilterLens = window.createLens(filters, 'button[aria-pressed="true"]');

    // The list is embedded in the page, so the store also works when opened straight from a file.
    try { themes = JSON.parse(document.getElementById('themes-data').textContent).themes; render(); }
    catch { fetch('themes-data.json').then(response => response.json()).then(data => { themes = data.themes; render(); })
        .catch(() => { grid.innerHTML = '<p class="empty">Не удалось загрузить список тем. Обновите страницу.</p>'; }); }
})();
