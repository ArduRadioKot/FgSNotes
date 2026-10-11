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
    if (window.electron && window.electron.getAppInfo) {
        window.electron.getAppInfo().then(info => { version.textContent = 'Версия ' + info.version; }).catch(() => {});
    } else {
        version.textContent = document.documentElement.dataset.native !== undefined ? 'Мобильное приложение' : 'Веб-версия';
    }
});
