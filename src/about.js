// "О приложении": version facts from the main process, and links that open in the system browser.
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
});
