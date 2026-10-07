// Switches the live Markdown editor on and off. "auto" means: on for phones, off on desktop (where the preview pane exists).
(function () {
  // editor.js builds the editor surface on DOMContentLoaded, so wait for it.
  function init() {
    const root = document.documentElement;
    const textarea = document.getElementById('markdown-editor');
    const surface = document.querySelector('.editor-surface');
    if (!textarea || !surface || !window.FgsLiveEditor) return;
    const phone = matchMedia('(max-width: 720px)');
    let live = null, host = null, styleWatcher = null;

    const workspace = document.querySelector('.workspace');
    // Live on: always ("on"), on a phone or in the "Живой" view ("auto"); never when the setting is off.
    const wanted = () => {
        const mode = root.dataset.livePreview || 'auto';
        if (mode === 'off') return false;
        return mode === 'on' || phone.matches || workspace.dataset.view === 'live';
    };
    // Font size and line height from the settings are written to the textarea; the editor inherits them from its host.
    const copyStyle = () => {
        host.style.fontSize = textarea.style.fontSize;
        host.style.lineHeight = textarea.style.lineHeight;
    };
    function enable() {
        host = document.createElement('div');
        host.className = 'live-host';
        surface.prepend(host);
        copyStyle();
        styleWatcher = new MutationObserver(copyStyle);
        styleWatcher.observe(textarea, { attributes: true, attributeFilter: ['style'] });
        live = window.FgsLiveEditor.attach(textarea, host);
        root.dataset.live = '';
    }
    function disable() {
        styleWatcher.disconnect();
        live.destroy();
        host.remove();
        live = host = null;
        delete root.dataset.live;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));   // redraw the highlight overlay
    }
    function sync() {
        if (root.dataset.livePreview === 'off' && workspace.dataset.view === 'live') document.querySelector('.view-switch button[data-view="editor"]').click();
        if (wanted() && !live) enable();
        else if (!wanted() && live) disable();
    }
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-live-preview'] });
    new MutationObserver(sync).observe(workspace, { attributes: true, attributeFilter: ['data-view'] });
    phone.addEventListener('change', sync);
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
  else setTimeout(init, 0);
})();
