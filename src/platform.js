// Platform layer: tells the app where it runs (Electron, Capacitor iOS/Android, browser) and wraps native calls.
// The rest of the app stays plain web code; this file is the only place that talks to Capacitor.
(function () {
    const root = document.documentElement;
    const cap = window.Capacitor;
    const native = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
    const name = native ? cap.getPlatform() : (window.electron ? 'electron' : 'web');
    const plugin = id => (cap && cap.Plugins && cap.Plugins[id]) || null;

    root.dataset.platform = name;
    if (native) root.dataset.native = '';
    // Desktop: does the system blur what is behind the window? (decided by the main process)
    if (window.electron) root.dataset.nativeBlur = window.electron.nativeBlur ? 'on' : 'off';
    // Phone shell: a narrow window, or a screen that only has a finger (a tablet). A mouse stays on the desktop layout.
    // The installed iPad app reports a fine pointer, so `native` counts as the shell even when the query does not match.
    const touchQuery = matchMedia('(max-width: 720px), ((hover: none) and (pointer: coarse))');
    const touchShell = {
        get matches() { return native || touchQuery.matches; },
        addEventListener: (type, fn, opts) => touchQuery.addEventListener(type, fn, opts),
        removeEventListener: (type, fn, opts) => touchQuery.removeEventListener(type, fn, opts)
    };
    const syncMobile = () => {
        if (native || (touchQuery.matches && matchMedia('(pointer: coarse)').matches)) root.dataset.mobile = '';
        else delete root.dataset.mobile;
    };
    syncMobile();
    touchQuery.addEventListener('change', syncMobile);
    // The shell stylesheet is a media query. On a native tablet that query misses, so the same rules are applied directly.
    if (native && !touchQuery.matches) liftTouchShell();

    // Saving: WebViews cannot download blobs, so write a file and hand it to the system share sheet ("Save to Files" etc.).
    async function saveText(fileName, text) {
        const files = plugin('Filesystem'), share = plugin('Share');
        if (!files || !share) throw new Error('Native file plugins are not available');
        const written = await files.writeFile({ path: fileName, data: text, directory: 'CACHE', encoding: 'utf8' });
        await share.share({ title: fileName, url: written.uri, dialogTitle: 'Сохранить файл' });
    }

    // Status bar text colour follows the app theme.
    function syncStatusBar() {
        const bar = plugin('StatusBar');
        if (!bar) return;
        const light = root.dataset.theme === 'light';
        bar.setStyle({ style: light ? 'LIGHT' : 'DARK' }).catch(() => {});
        if (name === 'android') bar.setBackgroundColor({ color: light ? '#ffffff' : '#1e1e1e' }).catch(() => {});
    }

    if (native) {
        new MutationObserver(syncStatusBar).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
        window.addEventListener('DOMContentLoaded', () => {
            syncStatusBar();
            const splash = plugin('SplashScreen');
            if (splash) splash.hide().catch(() => {});
        });
        // With the keyboard open the bottom bar is hidden, so the editor gets the room.
        const keyboard = plugin('Keyboard');
        if (keyboard) {
            keyboard.addListener('keyboardWillShow', () => root.classList.add('kb-open'));
            keyboard.addListener('keyboardWillHide', () => root.classList.remove('kb-open'));
            // iOS can leave the page scrolled after the keyboard closes; put it back.
            keyboard.addListener('keyboardDidHide', () => window.scrollTo(0, 0));
        }
    }

    // Editing never scrolls the page itself (the editor scrolls inside), so any offset left by the keyboard is a glitch.
    if (native) window.addEventListener('scroll', () => { if (window.scrollY || window.scrollX) window.scrollTo(0, 0); }, { passive: true });

    // A short tap of the vibration motor under a gesture: 'light', 'medium' or 'heavy'. Nothing happens off a phone.
    function haptic(kind = 'light') {
        const motor = plugin('Haptics');
        if (motor) motor.impact({ style: kind.toUpperCase() }).catch(() => {});
    }

    window.fgsPlatform = { native, name, saveText, haptic, touchShell, isMobile: () => 'mobile' in root.dataset };

    // Copies the touch-shell rules out of their media query so a native tablet follows them.
    function liftTouchShell() {
        const blocks = [];
        for (const sheet of document.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch { continue; }
            for (const rule of rules) {
                const text = rule.conditionText || '';
                if (!text.includes('720px') || !text.includes('pointer: coarse') || rule.matches) continue;
                blocks.push([...rule.cssRules].map(item => item.cssText).join('\n'));
            }
        }
        if (!blocks.length) return;
        const tag = document.createElement('style');
        tag.textContent = blocks.join('\n');
        document.head.appendChild(tag);
    }
})();
