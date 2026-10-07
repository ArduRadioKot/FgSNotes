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
    matchMedia('(min-width: 721px)').addEventListener('change', event => { if (event.matches) setMenu(false); });

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

    // Docs: highlight the current section in the contents
    const links = [...document.querySelectorAll('.toc a')];
    if (links.length) {
        const sections = links.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                links.forEach(link => link.classList.toggle('active', link.getAttribute('href') === '#' + entry.target.id));
            });
        }, { rootMargin: '-20% 0px -70% 0px' });
        sections.forEach(section => observer.observe(section));
    }
})();
