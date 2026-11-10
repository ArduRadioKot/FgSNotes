// "О приложении", a bar, and a startup dialog when GitHub Releases has a newer build.
(function () {
    const GAP = 12 * 60 * 60 * 1000;
    const checkedKey = 'fgsnotes.update.checked';
    const dismissedKey = 'fgsnotes.update.dismissed';
    const foundKey = 'fgsnotes.update.found';
    const tr = (key, vars) => (typeof t === 'function' ? t(key, vars) : key);

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
        banner.innerHTML = '<span class="update-bar-text" data-i18n-skip></span><button type="button" class="button-primary update-bar-go"></button><button type="button" class="button-secondary update-bar-notes"></button><button type="button" class="icon-button update-bar-close"></button>';
        document.querySelector('.document-bar').after(banner);
        banner.querySelector('.update-bar-close').innerHTML = window.icon ? window.icon('close') : '×';
        const bannerText = banner.querySelector('.update-bar-text');

        const modal = document.createElement('div');
        modal.id = 'update-modal';
        modal.className = 'update-modal';
        modal.hidden = true;
        modal.innerHTML = `<div class="update-dialog" role="dialog" aria-modal="true">
            <header class="update-head"><img src="logo.png" alt="" width="44" height="44"><div><h2 data-i18n-skip></h2><p class="update-dialog-version" data-i18n-skip></p></div></header>
            <div class="release-notes update-dialog-notes" data-i18n-skip></div>
            <div class="update-progress" hidden><div class="update-track"><span></span></div></div>
            <p class="update-dialog-status" role="status" data-i18n-skip></p>
            <div class="update-dialog-actions"><button type="button" class="update-skip"></button><button type="button" class="button-secondary update-later"></button><button type="button" class="button-primary update-go"></button></div>
        </div>`;
        document.body.append(modal);
        const dialog = modal.querySelector('.update-dialog');
        const dialogVersion = modal.querySelector('.update-dialog-version');
        const dialogNotes = modal.querySelector('.update-dialog-notes');
        const dialogStatus = modal.querySelector('.update-dialog-status');
        const progressBox = modal.querySelector('.update-progress'), progressFill = progressBox.querySelector('span');
        let current = '';
        if (window.electron.getAppInfo) window.electron.getAppInfo().then(info => { current = info.version; paint(); }).catch(() => {});

        // Release notes come from GitHub as Markdown. Only headings, lists and paragraphs are shown, built as text
        // nodes: nothing from the release page is ever inserted as HTML.
        function renderNotes(host, text) {
            const plain = line => line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|`)/g, '').trim();
            const nodes = [];
            let list = null;
            for (const raw of String(text || '').split('\n')) {
                const line = raw.trim();
                if (!line) { list = null; continue; }
                const item = /^[-*+]\s+(.*)$/.exec(line), heading = /^#{1,6}\s+(.*)$/.exec(line);
                if (item) {
                    if (!list) { list = document.createElement('ul'); nodes.push(list); }
                    list.append(Object.assign(document.createElement('li'), { textContent: plain(item[1]) }));
                    continue;
                }
                list = null;
                nodes.push(Object.assign(document.createElement(heading || /:$/.test(line) ? 'h3' : 'p'), { textContent: plain(heading ? heading[1] : line) }));
            }
            host.replaceChildren(...nodes);
            host.hidden = !nodes.length;
        }

        let release = null;
        let busy = false;
        let popup = false;

        function setStatus(text) { if (status) status.textContent = text; }
        function setNotes(text) { if (notes) renderNotes(notes, text); }
        function dismissed() { return !!(release && localStorage.getItem(dismissedKey) === release.latest); }
        function remember() {
            if (!release || !release.available) { localStorage.removeItem(foundKey); return; }
            localStorage.setItem(foundKey, JSON.stringify({
                latest: release.latest, notes: release.notes || '', url: release.url || '',
                packaged: !!release.packaged, asset: release.asset || null
            }));
        }
        function openModal() {
            if (!release || !release.available || dismissed()) return;
            popup = true;
            modal.hidden = false;
            paint();
            modal.querySelector('.update-go').focus();
        }
        function closeModal() { popup = false; modal.hidden = true; showBanner(); }
        function showBanner() {
            // One invitation at a time: the bar waits while the window is open.
            if (!release || !release.available || dismissed() || popup) { banner.hidden = true; return; }
            bannerText.textContent = tr('Доступна версия {version}', { version: release.latest });
            banner.hidden = false;
        }
        function paint() {
            banner.querySelector('.update-bar-notes').textContent = tr('Подробнее');
            banner.querySelector('.update-bar-close').setAttribute('aria-label', tr('Пропустить версию'));
            modal.querySelector('.update-later').textContent = tr('Позже');
            modal.querySelector('.update-skip').textContent = tr('Пропустить версию');
            if (!release || !release.ok) return;
            if (!release.available) {
                setStatus(tr('Установлена последняя версия'));
                setNotes('');
                if (button) { button.textContent = tr('Проверить обновления'); button.className = 'button-secondary'; }
                banner.hidden = true;
                closeModal();
                return;
            }
            const size = release.asset && release.asset.size ? ', ' + formatSize(release.asset.size) : '';
            setStatus(tr('Доступна версия {version}', { version: release.latest }) + size);
            setNotes(release.notes);
            const canInstall = !!(release.packaged && release.asset);
            if (button) { button.textContent = canInstall ? tr('Скачать и установить') : tr('Открыть страницу загрузки'); button.className = 'button-primary'; }
            banner.querySelector('.update-bar-go').textContent = canInstall ? tr('Обновить') : tr('Скачать');
            modal.querySelector('.update-go').textContent = canInstall ? tr('Скачать и установить') : tr('Открыть страницу загрузки');
            dialog.setAttribute('aria-label', tr('Доступно обновление'));
            modal.querySelector('h2').textContent = tr('Вышла версия {version}', { version: release.latest });
            const have = release.current || current;
            dialogVersion.textContent = [have ? tr('У вас версия {version}', { version: have }) : '', release.asset && release.asset.size ? tr('Размер загрузки: {size}', { size: formatSize(release.asset.size) }) : ''].filter(Boolean).join('. ');
            renderNotes(dialogNotes, release.notes);
            showBanner();
            if (dismissed()) closeModal();
        }
        function formatSize(bytes) {
            const mb = bytes / (1024 * 1024);
            return (mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10) + ' ' + tr('МБ');
        }
        function progressLabel(progress) {
            return progress.total
                ? tr('Загрузка… {percent}%', { percent: Math.min(100, Math.round(progress.received / progress.total * 100)) })
                : tr('Загрузка…');
        }

        async function check(automatic) {
            if (busy) return;
            setStatus(tr('Проверка обновлений…'));
            if (button) button.disabled = true;
            try {
                release = await window.electron.checkUpdates();
                localStorage.setItem(checkedKey, String(Date.now()));
                if (!release.ok) {
                    setStatus(release.error || tr('Не удалось проверить обновления'));
                    setNotes('');
                    return;
                }
                remember();
                paint();
                if (automatic && release.available && !dismissed()) openModal();
            } catch {
                setStatus(tr('Не удалось проверить обновления'));
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
            modal.querySelector('.update-go').disabled = true;
            modal.querySelector('.update-skip').hidden = true;
            progressBox.hidden = false;
            progressFill.style.width = '0%';
            const off = window.electron.onUpdateProgress(progress => {
                const label = progressLabel(progress);
                progressFill.style.width = (progress.total ? Math.min(100, progress.received / progress.total * 100) : 100) + '%';
                setStatus(label);
                dialogStatus.textContent = label;
                bannerText.textContent = tr('{label}  ·  версия {version}', { label, version: release.latest });
                banner.hidden = false;
            });
            try {
                setStatus(tr('Загрузка обновления…'));
                dialogStatus.textContent = tr('Загрузка обновления…');
                const downloaded = await window.electron.downloadUpdate();
                if (!downloaded.ok) {
                    const fail = downloaded.error || tr('Не удалось скачать обновление');
                    setStatus(fail);
                    dialogStatus.textContent = fail;
                    return;
                }
                setStatus(tr('Установка… приложение перезапустится'));
                dialogStatus.textContent = tr('Установка… приложение перезапустится');
                bannerText.textContent = tr('Установка… приложение перезапустится');
                const installed = await window.electron.installUpdate();
                if (!installed.ok) {
                    const fail = installed.error || tr('Не удалось установить обновление');
                    setStatus(fail);
                    dialogStatus.textContent = fail;
                } else if (installed.mode === 'manual') {
                    setStatus(installed.message);
                    dialogStatus.textContent = installed.message || '';
                }
            } catch {
                setStatus(tr('Не удалось установить обновление'));
                dialogStatus.textContent = tr('Не удалось установить обновление');
            } finally {
                off();
                busy = false;
                progressBox.hidden = true;
                modal.querySelector('.update-skip').hidden = false;
                if (button) button.disabled = false;
                banner.querySelector('.update-bar-go').disabled = false;
                modal.querySelector('.update-go').disabled = false;
            }
        }

        button?.addEventListener('click', () => { if (release && release.available) startUpdate(); else check(false); });
        banner.querySelector('.update-bar-go').addEventListener('click', startUpdate);
        modal.querySelector('.update-go').addEventListener('click', startUpdate);
        banner.querySelector('.update-bar-notes').addEventListener('click', () => { if (window.FgsSettings) window.FgsSettings.open('about'); });
        // Skipping a version silences both the bar and the window until the next release.
        const skip = () => {
            if (release && release.latest) localStorage.setItem(dismissedKey, release.latest);
            closeModal();
        };
        banner.querySelector('.update-bar-close').addEventListener('click', skip);
        modal.querySelector('.update-skip').addEventListener('click', skip);
        modal.querySelector('.update-later').addEventListener('click', closeModal);
        modal.addEventListener('click', event => { if (event.target === modal && !busy) closeModal(); });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !modal.hidden && !busy) { event.preventDefault(); closeModal(); }
        });
        window.addEventListener('fgs-language', () => paint());

        try {
            const cached = JSON.parse(localStorage.getItem(foundKey) || 'null');
            if (cached && cached.latest && localStorage.getItem(dismissedKey) !== cached.latest) {
                release = { ok: true, available: true, latest: cached.latest, notes: cached.notes, url: cached.url, packaged: cached.packaged, asset: cached.asset };
                paint();
                openModal();
            }
        } catch { /* ignore a broken cache */ }

        const last = Number(localStorage.getItem(checkedKey) || 0);
        if (!last || Date.now() - last > GAP) setTimeout(() => check(true), 1500);
    });
})();
