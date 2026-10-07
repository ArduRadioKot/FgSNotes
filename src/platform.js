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
    // Phone layout: any native shell, or a small touch screen in a browser.
    const mobileQuery = matchMedia('(max-width: 720px) and (pointer: coarse)');
    const syncMobile = () => { if (native || mobileQuery.matches) root.dataset.mobile = ''; else delete root.dataset.mobile; };
    syncMobile();
    mobileQuery.addEventListener('change', syncMobile);

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

    window.fgsPlatform = { native, name, saveText, isMobile: () => 'mobile' in root.dataset };
})();
