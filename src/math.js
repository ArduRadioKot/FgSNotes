// LaTeX in the preview: markdown.js leaves <span class="math"> / <div class="math-block"> with the formula in data-tex,
// KaTeX (a local copy in vendor/katex, loaded on the first formula) turns them into typeset math.
(function () {
    let loading = null;
    const cache = new Map();

    function load() {
        if (window.katex) return Promise.resolve(window.katex);
        if (loading) return loading;
        loading = new Promise((resolve, reject) => {
            const style = document.createElement('link');
            style.rel = 'stylesheet';
            style.href = 'vendor/katex/katex.min.css';
            document.head.appendChild(style);
            const script = document.createElement('script');
            script.src = 'vendor/katex/katex.min.js';
            script.onload = () => resolve(window.katex);
            script.onerror = () => { loading = null; reject(new Error('KaTeX failed to load')); };
            document.head.appendChild(script);
        });
        return loading;
    }

    function typeset(katex, node) {
        const display = node.classList.contains('math-block');
        const tex = node.dataset.tex;
        const key = (display ? 'd:' : 'i:') + tex;
        let html = cache.get(key);
        if (html === undefined) {
            try { html = katex.renderToString(tex, { displayMode: display, throwOnError: true, output: 'htmlAndMathml', strict: 'ignore' }); }
            catch (error) { html = null; }
            if (cache.size > 500) cache.clear();
            cache.set(key, html);
        }
        if (html === null) node.classList.add('math-error');
        else { node.innerHTML = html; node.classList.add('math-done'); }
    }

    let warmed = false;
    function run(container) {
        const nodes = container.querySelectorAll('.math, .math-block');
        if (!nodes.length) return;
        warmed = true;
        load().then(katex => nodes.forEach(node => { if (node.isConnected && node.dataset.tex) typeset(katex, node); })).catch(() => {});
    }
    window.renderMath = function (container) {
        if (document.documentElement.dataset.math === 'off') return;
        if (warmed) { run(container); return; }
        const later = window.requestIdleCallback || (fn => setTimeout(fn, 0));
        later(() => run(container), { timeout: 800 });
    };
})();
