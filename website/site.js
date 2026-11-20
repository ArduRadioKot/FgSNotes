// Theme (page light/dark), navigation menu, segmented controls with a sliding lens, gallery, docs contents.
(function () {
    const root = document.documentElement;
    const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

    const themeButton = document.getElementById('themeToggle');
    function syncThemeButton() {
        if (!themeButton) return;
        const light = root.dataset.theme === 'light';
        themeButton.setAttribute('aria-label', light ? 'Включить тёмную тему' : 'Включить светлую тему');
        themeButton.querySelector('use').setAttribute('href', light ? '#i-moon' : '#i-sun');
    }
    syncThemeButton();
    themeButton?.addEventListener('click', () => {
        root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
        try { localStorage.setItem('fgsnotes.site.theme', root.dataset.theme); } catch { /* storage unavailable */ }
        syncThemeButton();
    });

    // Mobile menu: full-screen panel from the right; closes on Esc, on a link, or when the window gets wide again
    const menu = document.getElementById('menuToggle');
    const panel = document.getElementById('mobileMenu');
    function setMenu(open) {
        root.classList.toggle('menu-open', open);
        menu?.setAttribute('aria-expanded', String(open));
        menu?.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
        if (open) panel.querySelector('#menuClose').focus({ preventScroll: true }); else if (document.activeElement && panel.contains(document.activeElement)) menu.focus({ preventScroll: true });
    }
    menu?.addEventListener('click', () => setMenu(!root.classList.contains('menu-open')));
    panel?.addEventListener('click', event => { if (event.target.closest('#menuClose, .menu-links a, .menu-foot a')) setMenu(false); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && root.classList.contains('menu-open')) setMenu(false); });
    matchMedia('(min-width: 1041px)').addEventListener('change', event => { if (event.matches) setMenu(false); });

    // A lens behind the active button. On a switch it stretches over both buttons and settles on the new one.
    window.createLens = function (container, activeSelector) {
        const lens = document.createElement('span');
        lens.className = 'lens';
        lens.setAttribute('aria-hidden', 'true');
        container.prepend(lens);
        let rect = null;
        function place(animate) {
            const active = container.querySelector(activeSelector);
            if (!active) return;
            const next = { left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight };
            Object.assign(lens.style, { left: next.left + 'px', top: next.top + 'px', width: next.width + 'px', height: next.height + 'px' });
            if (animate && rect && lens.animate && !reduceMotion()) {
                const from = rect, start = Math.min(from.left, next.left), end = Math.max(from.left + from.width, next.left + next.width);
                lens.getAnimations().forEach(animation => animation.cancel());
                lens.animate([
                    { left: from.left + 'px', width: from.width + 'px' },
                    { left: start + 'px', width: (end - start) + 'px', offset: 0.45 },
                    { left: next.left + 'px', width: next.width + 'px' }
                ], { duration: 460, easing: 'cubic-bezier(.3, .9, .3, 1)' });
            }
            rect = next;
        }
        new ResizeObserver(() => place(false)).observe(container);
        document.fonts?.ready.then(() => place(false));
        place(false);
        return place;
    };

    // Modes gallery
    document.querySelectorAll('[data-gallery]').forEach(control => {
        const images = [...document.querySelectorAll(control.dataset.gallery + ' img')];
        const place = window.createLens(control, 'button[aria-pressed="true"]');
        control.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button) return;
            control.querySelectorAll('button').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
            images.forEach((image, index) => image.classList.toggle('on', index === Number(button.dataset.index)));
            place(true);
        });
    });
    document.querySelectorAll('.minitabs').forEach(control => {
        const place = window.createLens(control, 'button[aria-pressed="true"]');
        const panes = [...control.parentElement.querySelectorAll('.minidoc .pane')];
        control.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button) return;
            const buttons = [...control.querySelectorAll('button')];
            buttons.forEach(other => other.setAttribute('aria-pressed', String(other === button)));
            panes.forEach((pane, index) => pane.classList.toggle('on', index === buttons.indexOf(button)));
            place(true);
        });
    });

    // Themes carousel: slow drift to the right, endless in both directions, pauses while the person interacts
    const reel = document.querySelector('.marquee');
    if (reel) {
        const track = reel.querySelector('.track');
        const half = () => track.scrollWidth / 2;
        let paused = false, resumeTimer = 0, dragging = null;
        const pause = (ms = 1800) => { paused = true; clearTimeout(resumeTimer); resumeTimer = setTimeout(() => { paused = false; }, ms); };
        const wrap = () => { if (reel.scrollLeft >= half()) reel.scrollLeft -= half(); else if (reel.scrollLeft <= 0) reel.scrollLeft += half(); };
        let last = performance.now();
        (function drift(now) {
            const dt = Math.min(now - last, 50); last = now;
            if (!paused && !reduceMotion() && !document.hidden) { reel.scrollLeft += dt * 0.04; }
            wrap();
            requestAnimationFrame(drift);
        })(last);
        reel.scrollLeft = 1;
        reel.addEventListener('pointerenter', () => { paused = true; clearTimeout(resumeTimer); });
        reel.addEventListener('pointerleave', () => pause(400));
        reel.addEventListener('focusin', () => pause(4000));
        reel.addEventListener('wheel', () => pause(), { passive: true });
        reel.addEventListener('touchstart', () => pause(3000), { passive: true });
        reel.addEventListener('pointerdown', event => {
            if (event.pointerType !== 'mouse') return;
            dragging = { x: event.clientX, left: reel.scrollLeft, moved: false };
            reel.setPointerCapture(event.pointerId);
        });
        reel.addEventListener('pointermove', event => {
            if (!dragging) return;
            const delta = event.clientX - dragging.x;
            if (Math.abs(delta) > 4) { dragging.moved = true; reel.classList.add('dragging'); }
            reel.scrollLeft = dragging.left - delta;
        });
        const endDrag = event => {
            if (!dragging) return;
            if (dragging.moved) reel.addEventListener('click', stop => stop.preventDefault(), { capture: true, once: true });
            dragging = null; reel.classList.remove('dragging');
            if (reel.hasPointerCapture(event.pointerId)) reel.releasePointerCapture(event.pointerId);
        };
        reel.addEventListener('pointerup', endDrag);
        reel.addEventListener('pointercancel', endDrag);
        document.querySelectorAll('[data-reel]').forEach(button => button.addEventListener('click', () => {
            const tile = track.querySelector('.tile');
            pause(4000);
            reel.scrollBy({ left: Number(button.dataset.reel) * (tile.offsetWidth + 8) * 2, behavior: reduceMotion() ? 'auto' : 'smooth' });
        }));
    }

    // Docs: highlight the current section in the contents (and keep its chip in view on phones)
    const links = [...document.querySelectorAll('.toc a')];
    if (links.length) {
        const sections = links.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
        function spy() {
            const line = innerWidth <= 960 ? 150 : 120;
            let current = sections[0];
            sections.forEach(section => { if (section.getBoundingClientRect().top <= line) current = section; });
            if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) current = sections[sections.length - 1];
            links.forEach(link => link.classList.toggle('active', link.getAttribute('href') === '#' + current.id));
            const chip = links.find(link => link.classList.contains('active')), strip = chip && chip.parentElement;
            if (strip && strip.scrollWidth > strip.clientWidth) strip.scrollTo({ left: chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2, behavior: reduceMotion() ? 'auto' : 'smooth' });
        }
        addEventListener('scroll', spy, { passive: true });
        addEventListener('resize', spy);
        spy();
    }
})();

// Header: transparent at the top of the page, blurred once the page has been scrolled.
(function () {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    const update = () => nav.classList.toggle('is-scrolled', scrollY > 12);
    addEventListener('scroll', update, { passive: true });
    update();
})();

// Footer year, the current home section in the header, and a short rise as blocks come into view.
(function () {
    document.querySelectorAll('[data-year]').forEach(node => { node.textContent = new Date().getFullYear(); });

    const links = [...document.querySelectorAll('.nav-links a[href^="index.html#"]')];
    const owner = { features: 'features', modes: 'features', ai: 'ai', mobile: 'mobile' };
    const sections = Object.keys(owner).map(id => document.getElementById(id)).filter(Boolean);
    if (links.length && sections.length) {
        const spy = () => {
            const line = innerHeight * .35;
            const current = sections.find(section => { const box = section.getBoundingClientRect(); return box.top <= line && box.bottom > line; });
            links.forEach(link => {
                const on = !!current && link.hash === '#' + owner[current.id];
                if (on) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
            });
        };
        addEventListener('scroll', spy, { passive: true });
        addEventListener('resize', spy);
        spy();
    }

    if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const blocks = document.querySelectorAll('.page > .flat, .page > .island:not(.store-top), .bento > .cell, .dl-group, .steps li');
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
    }), { rootMargin: '0px 0px -8% 0px' });
    blocks.forEach(block => {
        if (block.getBoundingClientRect().top < innerHeight) return;
        block.classList.add('reveal');
        observer.observe(block);
    });
})();

// Release files: detect the visitor's system, highlight that row, and refresh sizes from GitHub.
(function () {
    if (!document.querySelector('.dl-slot, [data-get-main]')) return;
    const gh = (tag, file) => `https://github.com/ArduRadioKot/FgSNotes/releases/download/${tag}/${file}`;
    const state = {
        version: '3.1.0',
        files: [
            { os: 'mac-arm', label: 'macOS, Apple Silicon', file: 'FgSNotes-3.1.0-arm64.dmg', mb: 96.1, url: gh('v3.1.0', 'FgSNotes-3.1.0-arm64.dmg') },
            { os: 'mac-intel', label: 'macOS, Intel', file: 'FgSNotes-3.1.0-x64.dmg', mb: 103.3, url: gh('v3.1.0', 'FgSNotes-3.1.0-x64.dmg') },
            { os: 'windows', label: 'Windows, установщик', file: 'FgSNotes-Setup-3.1.0.exe', mb: 144.9, url: gh('v3.1.0', 'FgSNotes-Setup-3.1.0.exe') },
            { os: 'windows-portable', label: 'Windows, без установки', file: 'FgSNotes-Portable-3.1.0.exe', mb: 144.7, url: gh('v3.1.0', 'FgSNotes-Portable-3.1.0.exe') },
            { os: 'linux', label: 'Linux, AppImage', file: 'FgSNotes-3.1.0.AppImage', mb: 106.3, url: gh('v3.1.0', 'FgSNotes-3.1.0.AppImage') },
            { os: 'linux-tar', label: 'Linux, архив', file: 'fgsnotes-3.1.0.tar.gz', mb: 100.5, url: gh('v3.1.0', 'fgsnotes-3.1.0.tar.gz') },
        ],
    };
    const osNames = { 'mac-arm': 'macOS', 'mac-intel': 'macOS', windows: 'Windows', linux: 'Linux' };

    function detectOS() {
        const ua = navigator.userAgent || '';
        const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
        if (/iPhone|iPad|Android/i.test(ua)) return 'mobile';
        if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows';
        if (/Mac/i.test(platform) || /Mac OS X/i.test(ua)) {
            try {
                const gl = document.createElement('canvas').getContext('webgl');
                const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
                const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
                if (/Intel/i.test(renderer)) return 'mac-intel';
            } catch { /* WebGL unavailable */ }
            return 'mac-arm';
        }
        if (/Linux|X11/i.test(platform + ua)) return 'linux';
        return 'unknown';
    }

    function pick(os = detectOS()) {
        const exact = state.files.find(file => file.os === os);
        if (exact) return exact;
        if (String(os).startsWith('mac')) return state.files.find(file => file.os.startsWith('mac')) || null;
        if (os === 'linux') return state.files.find(file => file.os.startsWith('linux')) || null;
        return null;
    }

    const size = mb => mb ? `${Number(mb).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ` : '';

    function paint() {
        const mine = pick();
        const groups = {
            mac: state.files.filter(file => file.os.startsWith('mac')),
            other: state.files.filter(file => !file.os.startsWith('mac')),
        };
        document.querySelectorAll('.dl-slot').forEach(slot => {
            const files = groups[slot.dataset.os] || [];
            slot.replaceChildren(...files.map(file => {
                const link = document.createElement('a');
                link.className = 'dl' + (file === mine ? ' is-yours' : '');
                link.href = file.url;
                [['dl-label', file.label], ['dl-file', file.file], ['dl-size', size(file.mb)]].forEach(([cls, text]) => {
                    const span = document.createElement('span');
                    span.className = cls;
                    span.textContent = text;
                    link.append(span);
                });
                return link;
            }));
        });
        document.querySelectorAll('[data-release-version]').forEach(node => { node.textContent = state.version; });
        document.querySelectorAll('[data-get-main]').forEach(button => {
            if (mine) {
                button.href = mine.url;
                button.textContent = 'Скачать для ' + (osNames[detectOS()] || mine.label);
            } else {
                button.href = '#download';
                button.textContent = 'Скачать';
            }
        });
    }

    function parseRelease(release) {
        if (!release || release.draft || release.prerelease || !/^v?\d+\.\d+\.\d+$/.test(release.tag_name) || !Array.isArray(release.assets)) return null;
        const prefix = 'https://github.com/ArduRadioKot/FgSNotes/releases/download/';
        const matchers = [
            ['mac-arm', 'macOS, Apple Silicon', /-arm64\.dmg$/i],
            ['mac-intel', 'macOS, Intel', /-(?:x64|x86_64)\.dmg$/i],
            ['windows', 'Windows, установщик', /setup.*\.exe$/i],
            ['windows-portable', 'Windows, без установки', /portable.*\.exe$/i],
            ['linux', 'Linux, AppImage', /\.AppImage$/i],
            ['linux-tar', 'Linux, архив', /\.tar\.gz$/i],
        ];
        const files = matchers.flatMap(([os, label, pattern]) => {
            const asset = release.assets.find(item => item && pattern.test(item.name) && String(item.browser_download_url || '').startsWith(prefix) && Number.isFinite(item.size) && item.size > 0);
            return asset ? [{ os, label, file: asset.name, mb: asset.size / 1e6, url: asset.browser_download_url }] : [];
        });
        return files.length ? { version: release.tag_name.replace(/^v/, ''), files } : null;
    }

    paint();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    fetch('https://api.github.com/repos/ArduRadioKot/FgSNotes/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal,
    }).then(response => {
        if (!response.ok) throw new Error('unavailable');
        return response.json();
    }).then(release => {
        const parsed = parseRelease(release);
        if (!parsed) return;
        Object.assign(state, parsed);
        paint();
    }).catch(() => { /* Keep the checked-in release when GitHub cannot be reached. */ })
        .finally(() => clearTimeout(timeout));
})();
