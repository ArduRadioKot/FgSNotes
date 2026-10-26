// "О приложении" and a small bar when GitHub Releases has a newer build.
(function () {
    const GAP = 12 * 60 * 60 * 1000;
    const checkedKey = 'fgsnotes.update.checked';
    const dismissedKey = 'fgsnotes.update.dismissed';

    document.addEventListener('DOMContentLoaded', () => {
        const status = document.getElementById('about-update');
        const notes = document.getElementById('about-update-notes');
        const button = document.getElementById('about-update-button');
        if (!window.electron || !window.electron.checkUpdates) {
            if (button) button.hidden = true;
            return;
        }

        const banner = document.createElement('div');
        banner.className = 'update-bar';
        banner.hidden = true;
        banner.innerHTML = '<span class="update-bar-text"></span><button type="button" class="button-primary update-bar-go">Обновить</button><button type="button" class="button-secondary update-bar-notes">Подробнее</button><button type="button" class="icon-button update-bar-close" aria-label="Скрыть"></button>';
        document.querySelector('.document-bar').after(banner);
        banner.querySelector('.update-bar-close').innerHTML = window.icon ? window.icon('close') : '×';
        const bannerText = banner.querySelector('.update-bar-text');

        let release = null;
        let busy = false;

        function setStatus(text) { if (status) status.textContent = text; }
        function setNotes(text) {
            if (!notes) return;
            notes.textContent = text || '';
            notes.hidden = !text;
        }
        function showBanner() {
            if (!release || !release.available) return;
            if (localStorage.getItem(dismissedKey) === release.latest) return;
            bannerText.textContent = `Доступна версия ${release.latest}`;
            banner.hidden = false;
        }
        function paint() {
            if (!release || !release.ok) return;
            if (!release.available) {
                setStatus('Установлена последняя версия');
                setNotes('');
                if (button) button.textContent = 'Проверить обновления';
                banner.hidden = true;
                return;
            }
            const size = release.asset && release.asset.size ? `, ${formatSize(release.asset.size)}` : '';
            setStatus(`Доступна версия ${release.latest}${size}`);
            setNotes(release.notes);
            const canInstall = !!(release.packaged && release.asset);
            if (button) button.textContent = canInstall ? 'Скачать и установить' : 'Открыть страницу загрузки';
            banner.querySelector('.update-bar-go').textContent = canInstall ? 'Обновить' : 'Скачать';
            showBanner();
        }
        function formatSize(bytes) {
            const mb = bytes / (1024 * 1024);
            return (mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10) + ' МБ';
        }

        async function check() {
            if (busy) return;
            setStatus('Проверка обновлений…');
            if (button) button.disabled = true;
            try {
                release = await window.electron.checkUpdates();
                localStorage.setItem(checkedKey, String(Date.now()));
                if (!release.ok) { setStatus(release.error || 'Не удалось проверить обновления'); setNotes(''); return; }
                paint();
            } catch {
                setStatus('Не удалось проверить обновления');
            } finally {
                if (button) button.disabled = false;
            }
        }

        async function startUpdate() {
            if (!release || !release.available || busy) return;
            if (!release.packaged || !release.asset) {
                if (release.url) window.electron.openExternal(release.url);
                return;
            }
            busy = true;
            if (button) button.disabled = true;
            banner.querySelector('.update-bar-go').disabled = true;
            const off = window.electron.onUpdateProgress(progress => {
                const label = progress.total ? `Загрузка… ${Math.min(100, Math.round(progress.received / progress.total * 100))}%` : 'Загрузка…';
                setStatus(label);
                bannerText.textContent = `${label}  ·  версия ${release.latest}`;
                banner.hidden = false;
            });
            try {
                setStatus('Загрузка обновления…');
                const downloaded = await window.electron.downloadUpdate();
                if (!downloaded.ok) { setStatus(downloaded.error || 'Не удалось скачать обновление'); return; }
                setStatus('Установка… приложение перезапустится');
                bannerText.textContent = 'Установка… приложение перезапустится';
                const installed = await window.electron.installUpdate();
                if (!installed.ok) setStatus(installed.error || 'Не удалось установить обновление');
                else if (installed.mode === 'manual') setStatus(installed.message);
            } catch {
                setStatus('Не удалось установить обновление');
            } finally {
                off();
                busy = false;
                if (button) button.disabled = false;
                banner.querySelector('.update-bar-go').disabled = false;
            }
        }

        button?.addEventListener('click', () => { if (release && release.available) startUpdate(); else check(); });
        banner.querySelector('.update-bar-go').addEventListener('click', startUpdate);
        banner.querySelector('.update-bar-notes').addEventListener('click', () => { if (window.FgsSettings) window.FgsSettings.open('about'); });
        banner.querySelector('.update-bar-close').addEventListener('click', () => {
            banner.hidden = true;
            if (release && release.latest) localStorage.setItem(dismissedKey, release.latest);
        });

        const last = Number(localStorage.getItem(checkedKey) || 0);
        if (!last || Date.now() - last > GAP) setTimeout(check, 4000);
    });
})();
