// Runnable JavaScript cells in the preview, like a Jupyter notebook.
// A cell is a ```js-cell fence in the note; markdown.js renders it as <div class="nb-cell" data-code="…">.
// Code runs in a per-note Web Worker (a "kernel"), so variables live between cells and the page itself stays untouched.
(function () {
    // Runs inside the worker. Kept as a function so it is stringified into the Blob instead of living in a second file.
    function workerMain() {
        const post = message => self.postMessage(message);
        let current = 0;

        function inspect(value, depth, seen) {
            if (value === null) return 'null';
            const type = typeof value;
            if (type === 'string') return depth ? JSON.stringify(value) : value;
            if (type === 'undefined') return 'undefined';
            if (type === 'bigint') return value + 'n';
            if (type === 'symbol') return value.toString();
            if (type === 'function') return `ƒ ${value.name || '(anonymous)'}()`;
            if (type !== 'object') return String(value);
            if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
            if (seen.includes(value)) return '[Circular]';
            if (depth > 3) return Array.isArray(value) ? '[…]' : '{…}';
            const next = seen.concat([value]);
            if (Array.isArray(value)) {
                const items = value.slice(0, 100).map(item => inspect(item, depth + 1, next));
                if (value.length > 100) items.push(`… ещё ${value.length - 100}`);
                return `[${items.join(', ')}]`;
            }
            if (value instanceof Map) return `Map(${value.size}) {${[...value].slice(0, 50).map(([k, v]) => `${inspect(k, depth + 1, next)} => ${inspect(v, depth + 1, next)}`).join(', ')}}`;
            if (value instanceof Set) return `Set(${value.size}) {${[...value].slice(0, 50).map(v => inspect(v, depth + 1, next)).join(', ')}}`;
            if (value instanceof Date) return value.toISOString();
            if (value instanceof RegExp) return String(value);
            const keys = Object.keys(value);
            const name = value.constructor && value.constructor !== Object ? value.constructor.name + ' ' : '';
            return `${name}{${keys.slice(0, 100).map(key => `${key}: ${inspect(value[key], depth + 1, next)}`).join(', ')}}`;
        }

        const format = args => args.map(arg => inspect(arg, 0, [])).join(' ');
        const send = kind => (...args) => post({ type: 'out', id: current, kind, text: format(args) });
        self.console = {
            log: send('log'), info: send('log'), debug: send('log'), warn: send('warn'), error: send('error'),
            table: send('log'), dir: send('log'), clear: () => post({ type: 'clear', id: current })
        };

        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const indirectEval = eval;

        // let/const at the top level would die with the eval scope; as var they stay on the kernel for the next cells.
        const persist = code => code.replace(/^(\s*)(?:const|let)(\s)/gm, '$1var$2');
        const hoist = code => code.replace(/^(\s*)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm, '$1globalThis.$2 =');

        self.onmessage = async event => {
            const { id, code } = event.data;
            current = id;
            try {
                let result;
                if (/\bawait\b/.test(code)) result = await new AsyncFunction(hoist(code))();
                else result = indirectEval(persist(code));
                if (result instanceof Promise) result = await result;
                post({ type: 'done', id, value: result === undefined ? null : inspect(result, 0, []), hasValue: result !== undefined });
            } catch (error) {
                post({ type: 'done', id, error: error && error.name ? `${error.name}: ${error.message}` : String(error) });
            }
        };
        post({ type: 'ready' });
    }

    const fence = /^```js-cell[^\n]*\n([\s\S]*?)^```[ \t]*$/gm;
    const kernels = new Map();   // docId -> { worker, count, running: Map(id -> finish) }
    const outputs = new Map();   // `${docId}:${index}` -> { code, n, lines, value, error }
    let skipNext = false;
    let sequence = 0;

    function kernelFor(docId) {
        let kernel = kernels.get(docId);
        if (kernel) return kernel;
        const url = URL.createObjectURL(new Blob([`(${workerMain.toString()})()`], { type: 'text/javascript' }));
        const worker = new Worker(url);
        URL.revokeObjectURL(url);
        kernel = { worker, count: 0, running: new Map(), listeners: new Map() };
        worker.onmessage = event => {
            const message = event.data;
            const listener = kernel.listeners.get(message.id);
            if (listener) listener(message);
        };
        kernels.set(docId, kernel);
        return kernel;
    }

    function stopKernel(docId, reason) {
        const kernel = kernels.get(docId);
        if (!kernel) return;
        kernel.worker.terminate();
        kernels.delete(docId);
        kernel.listeners.forEach(listener => listener({ type: 'done', error: reason, stopped: true }));
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    // Replaces the code of the index-th ```js-cell fence in the note; returns false if the fence can't be found.
    function writeBack(index, code) {
        const editor = document.getElementById('markdown-editor');
        let found = -1;
        const next = editor.value.replace(fence, (whole, body) => {
            found++;
            if (found !== index) return whole;
            return whole.slice(0, whole.indexOf('\n') + 1) + code.replace(/\n?$/, '\n') + '```';
        });
        if (found < index || next === editor.value) return false;
        editor.value = next;
        skipNext = true;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    function highlight(code) {
        return window.highlightCode ? window.highlightCode(code, 'js') : code.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    }

    function build(host, docId, index) {
        const key = `${docId}:${index}`;
        const code = host.dataset.code;
        host.textContent = '';

        const saved = outputs.get(key);
        const state = saved && saved.code === code ? saved : { code, n: 0, lines: [], value: null, error: null, ran: false };
        outputs.set(key, state);
        let running = false;

        const input = el('div', 'nb-in');
        const gutter = el('div', 'nb-gutter');
        const label = el('span', 'nb-label', state.n ? `[${state.n}]` : '[ ]');
        const run = el('button', 'nb-run');
        run.type = 'button';
        gutter.append(label, run);

        const body = el('div', 'nb-body');
        const mirror = el('pre', 'nb-mirror');
        const mirrorCode = el('code');
        mirror.append(mirrorCode);
        mirror.setAttribute('aria-hidden', 'true');
        const area = el('textarea', 'nb-editor');
        area.value = code;
        area.spellcheck = false;
        area.setAttribute('aria-label', 'Ячейка JavaScript');
        area.rows = 1;
        body.append(mirror, area);

        const tools = el('div', 'nb-tools');
        const restart = el('button', 'nb-tool', 'Сбросить');
        restart.type = 'button';
        restart.title = 'Перезапустить среду выполнения: переменные ячеек будут забыты';
        const clear = el('button', 'nb-tool', 'Очистить вывод');
        clear.type = 'button';
        tools.append(restart, clear);
        input.append(gutter, body, tools);

        const output = el('div', 'nb-out');
        output.hidden = !state.ran;

        function refresh() {
            mirrorCode.innerHTML = highlight(area.value) + '\n';
            area.style.height = '0px';
            area.style.height = area.scrollHeight + 'px';
        }
        function setRunning(value) {
            running = value;
            host.classList.toggle('is-running', value);
            run.title = value ? 'Остановить (выполнение прервётся)' : 'Запустить ячейку (Shift+Enter)';
            run.setAttribute('aria-label', run.title);
            run.innerHTML = window.icon ? window.icon(value ? 'stop' : 'play') : '';
            label.textContent = value ? '[*]' : state.n ? `[${state.n}]` : '[ ]';
        }
        function paint() {
            output.textContent = '';
            output.hidden = !state.ran;
            if (!state.ran) return;
            const gutterOut = el('div', 'nb-gutter nb-gutter-out', state.n ? `[${state.n}]` : '');
            const content = el('div', 'nb-result');
            state.lines.forEach(line => content.append(el('pre', `nb-line is-${line.kind}`, line.text)));
            if (state.error) content.append(el('pre', 'nb-line is-error', state.error));
            else if (state.value !== null) content.append(el('pre', 'nb-line is-value', state.value));
            else if (!state.lines.length) content.append(el('pre', 'nb-line is-empty', 'Готово, без вывода'));
            output.append(gutterOut, content);
        }

        function execute() {
            if (running) { stopKernel(docId, 'Выполнение остановлено'); return; }
            const source = area.value;
            if (!source.trim()) return;
            const kernel = kernelFor(docId);
            const id = ++sequence;
            state.n = ++kernel.count;
            state.lines = []; state.value = null; state.error = null; state.ran = true;
            setRunning(true);
            paint();
            kernel.listeners.set(id, message => {
                if (message.type === 'out') {
                    state.lines.push({ kind: message.kind, text: message.text });
                } else if (message.type === 'clear') {
                    state.lines = [];
                } else if (message.type === 'done') {
                    kernel.listeners.delete(id);
                    if (message.error) state.error = message.error;
                    else if (message.hasValue) state.value = message.value;
                    setRunning(false);
                }
                paint();
            });
            kernel.worker.postMessage({ id, code: source });
        }

        area.addEventListener('input', () => {
            state.code = area.value;
            refresh();
            writeBack(index, area.value);
        });
        area.addEventListener('keydown', event => {
            if (event.key === 'Enter' && (event.shiftKey || event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                execute();
            } else if (event.key === 'Tab' && !event.shiftKey) {
                event.preventDefault();
                document.execCommand('insertText', false, '    ');
            }
        });
        run.addEventListener('click', execute);
        restart.addEventListener('click', () => {
            stopKernel(docId, 'Среда перезапущена');
            outputs.forEach((value, k) => { if (k.startsWith(docId + ':')) value.n = 0; });
            host.dispatchEvent(new CustomEvent('nb-reset', { bubbles: true }));
        });
        clear.addEventListener('click', () => {
            state.lines = []; state.value = null; state.error = null; state.ran = false;
            paint();
        });
        host.addEventListener('nb-reset', () => { if (!running) { label.textContent = '[ ]'; } });

        host.append(input, output);
        host.dataset.ready = '1';
        setRunning(false);
        refresh();
        paint();
        host.nbRefresh = refresh;
    }

    window.FgsNotebook = {
        render(container, docId) {
            container.querySelectorAll('.nb-cell').forEach((host, index) => build(host, docId, index));
            // Heights depend on layout, so measure again once the preview is in the page.
            requestAnimationFrame(() => container.querySelectorAll('.nb-cell').forEach(host => host.nbRefresh && host.nbRefresh()));
        },
        // editor.js asks this before rebuilding the preview: edits made inside a cell must not destroy the cell being typed in.
        takeSkip() { const value = skipNext; skipNext = false; return value; },
        forget(docId) { stopKernel(docId, 'Документ закрыт'); outputs.forEach((v, k) => { if (k.startsWith(docId + ':')) outputs.delete(k); }); }
    };
})();
