// "О приложении": version facts from the main process, links that open in the system browser,
// and the optional terminal command.
document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', event => {
        const link = event.target.closest('a[data-external]');
        if (!link) return;
        event.preventDefault();
        if (window.electron && window.electron.openExternal) window.electron.openExternal(link.href);
        else window.open(link.href, '_blank', 'noopener');
    });
    const version = document.getElementById('about-version');
    let number = '';
    function paint() {
        if (!version) return;
        if (number) version.textContent = t('Версия {version}', { version: number });
        else version.textContent = document.documentElement.dataset.native !== undefined ? t('Мобильное приложение') : t('Веб-версия');
    }
    if (window.electron && window.electron.getAppInfo) {
        window.electron.getAppInfo().then(info => { number = info.version; paint(); }).catch(() => {});
    } else paint();
    window.addEventListener('fgs-language', paint);

    const block = document.getElementById('about-tui');
    const api = window.electron && window.electron.tuiCommand;
    if (!block || !api) return;
    const statusEl = document.getElementById('about-tui-status');
    const installBtn = document.getElementById('about-tui-install');
    const removeBtn = document.getElementById('about-tui-remove');
    block.hidden = false;

    function label(button, key) {
        button.setAttribute('data-i18n', key);
        button.textContent = t(key);
    }
    async function refresh() {
        let state;
        try { state = await api.status(); } catch { return; }
        const parts = [];
        if (!state.installed) parts.push(t('Команда fgsnotes не стоит. В новом окне терминала она откроет редактор: fgsnotes заметка.md'));
        else if (!state.current) parts.push(t('Команда стоит, но ведёт в другое место. Поставьте её ещё раз, чтобы она открывала это приложение.'));
        else parts.push(t('Команда fgsnotes стоит. Откройте новый терминал и выполните fgsnotes заметка.md'));
        if (state.installed && !state.onPath) parts.push(t('Каталог {dir} не входит в PATH. Добавьте его, иначе терминал не найдёт команду.', { dir: state.dir }));
        statusEl.textContent = parts.join(' ');
        label(installBtn, state.installed && !state.current ? 'Обновить команду в терминале' : 'Поставить команду в терминал');
        installBtn.hidden = !!(state.installed && state.current);
        removeBtn.hidden = !state.installed;
    }
    async function run(button, action, failKey) {
        button.disabled = true;
        try {
            const result = await action();
            if (!result || !result.ok) statusEl.textContent = t(failKey, { error: t((result && result.error) || '') });
            else await refresh();
        } catch (error) {
            statusEl.textContent = t(failKey, { error: error.message || '' });
        }
        button.disabled = false;
    }
    installBtn.addEventListener('click', () => run(installBtn, () => api.install(), 'Не удалось поставить команду: {error}'));
    removeBtn.addEventListener('click', () => run(removeBtn, () => api.remove(), 'Не удалось убрать команду: {error}'));
    window.addEventListener('fgs-language', refresh);
    refresh();
});
