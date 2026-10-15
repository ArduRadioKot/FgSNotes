// Runnable JavaScript cells, like a Jupyter notebook. A cell is a ```js-cell fence in the note (```js-cell auto runs it while you type).
// Code runs in a per-note Web Worker (a "kernel"), so variables live between cells and the page itself stays untouched.
// The same cells work in the preview (markdown.js renders <div class="nb-cell">) and in the live editor (live-editor/index.js
// draws a run bar and the output block); both share the state kept here.
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

    const fence = /^```js-cell([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm;
    const kernels = new Map();   // docId -> { worker, count, listeners: Map(id -> fn) }
    const cellStates = new Map();   // `${docId}:${index}` -> { code, ranCode, n, lines, value, error, ran, running, subs }
    const timers = new Map();
    let skipNext = false;
    let sequence = 0;
    const AUTO_LIMIT = 5000;     // ms: a cell that runs while you type must not hang the kernel

    // Every js-cell fence of a note: where it is and what it holds.
    function cells(text) {
        const found = [];
        let match;
        fence.lastIndex = 0;
        while ((match = fence.exec(text))) {
            const infoFrom = match.index + '```js-cell'.length;
            const bodyFrom = infoFrom + match[1].length + 1;
            found.push({ index: found.length, from: match.index, to: match.index + match[0].length, infoFrom, infoTo: infoFrom + match[1].length, bodyFrom, bodyTo: bodyFrom + match[2].length, code: match[2].replace(/\n$/, ''), auto: /\bauto\b/.test(match[1]) });
        }
        return found;
    }

    function kernelFor(docId) {
        let kernel = kernels.get(docId);
        if (kernel) return kernel;
        const url = URL.createObjectURL(new Blob([`(${workerMain.toString()})()`], { type: 'text/javascript' }));
        const worker = new Worker(url);
        URL.revokeObjectURL(url);
        kernel = { worker, count: 0, listeners: new Map() };
        worker.onmessage = event => {
            const listener = kernel.listeners.get(event.data.id);
            if (listener) listener(event.data);
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

    function stateFor(docId, index) {
        const key = `${docId}:${index}`;
        let state = cellStates.get(key);
        if (!state) { state = { n: 0, lines: [], value: null, error: null, ran: false, running: false, ranCode: null, subs: new Set() }; cellStates.set(key, state); }
        return state;
    }
    const notify = state => state.subs.forEach(fn => fn(state));
    function watch(docId, index, fn) {
        const state = stateFor(docId, index);
        state.subs.add(fn);
        fn(state);
        return () => state.subs.delete(fn);
    }

    function run(docId, index, source, options = {}) {
        const state = stateFor(docId, index);
        if (state.running) { stopKernel(docId, 'Выполнение остановлено'); return; }
        if (!String(source).trim()) return;
        const kernel = kernelFor(docId);
        const id = ++sequence;
        Object.assign(state, { n: ++kernel.count, lines: [], value: null, error: null, ran: true, running: true, ranCode: source });
        notify(state);
        let watchdog = null;
        if (options.auto) watchdog = setTimeout(() => stopKernel(docId, `Ячейка работала дольше ${AUTO_LIMIT / 1000} с, пока вы печатали, и была прервана. Запустите её вручную, если так и задумано.`), AUTO_LIMIT);
        kernel.listeners.set(id, message => {
            if (message.type === 'out') state.lines.push({ kind: message.kind, text: message.text });
            else if (message.type === 'clear') state.lines = [];
            else if (message.type === 'done') {
                clearTimeout(watchdog);
                kernel.listeners.delete(id);
                if (message.error) state.error = message.error;
                else if (message.hasValue) state.value = message.value;
                state.running = false;
            }
            notify(state);
        });
        kernel.worker.postMessage({ id, code: source });
    }
    // Typing in an "auto" cell runs it again shortly after the last keystroke.
    function autoRun(docId, index, source, delay = 600) {
        const key = `${docId}:${index}`;
        clearTimeout(timers.get(key));
        timers.set(key, setTimeout(() => { timers.delete(key); const state = stateFor(docId, index); if (!state.running) run(docId, index, source, { auto: true }); }, delay));
    }
    function clearOutput(docId, index) {
        const state = stateFor(docId, index);
        Object.assign(state, { lines: [], value: null, error: null, ran: false });
        notify(state);
    }
    function resetKernel(docId) {
        stopKernel(docId, 'Среда перезапущена');
        cellStates.forEach((state, key) => { if (key.startsWith(docId + ':')) { state.n = 0; notify(state); } });
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    // Draws the output block of a cell into `host` and keeps it up to date; returns the function that stops following it.
    function mountOutput(host, docId, index, currentCode) {
        host.classList.add('nb-out');
        return watch(docId, index, state => {
            host.textContent = '';
            host.hidden = !state.ran;
            host.classList.toggle('is-stale', !!state.ran && !state.running && currentCode && currentCode() !== state.ranCode);
            if (!state.ran) return;
            const gutter = el('div', 'nb-gutter nb-gutter-out', state.running ? '[*]' : state.n ? `[${state.n}]` : '');
            const content = el('div', 'nb-result');
            state.lines.forEach(line => content.append(el('pre', `nb-line is-${line.kind}`, line.text)));
            if (state.error) content.append(el('pre', 'nb-line is-error', state.error));
            else if (state.value !== null) content.append(el('pre', 'nb-line is-value', state.value));
            else if (!state.lines.length && !state.running) content.append(el('pre', 'nb-line is-empty', 'Готово, без вывода'));
            host.append(gutter, content);
        });
    }

    // Replaces the code of the index-th fence in the note (or its info line, for the auto flag); false if the fence can't be found.
    function patchNote(index, change) {
        const editor = document.getElementById('markdown-editor');
        const cell = cells(editor.value)[index];
        if (!cell) return false;
        const next = change(editor.value, cell);
        if (next === editor.value) return false;
        editor.value = next;
        skipNext = true;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }
    const writeCode = (index, code) => patchNote(index, (text, cell) => text.slice(0, cell.bodyFrom) + code.replace(/\n?$/, '\n') + text.slice(cell.bodyTo));
    const setAuto = (index, on) => patchNote(index, (text, cell) => text.slice(0, cell.infoFrom) + (on ? ' auto' : '') + text.slice(cell.infoTo));

    function highlight(code) {
        return window.highlightCode ? window.highlightCode(code, 'js') : code.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    }

    function build(host, docId, index) {
        const code = host.dataset.code;
        host.textContent = '';
        const state = stateFor(docId, index);
        let auto = host.dataset.auto === '1';

        const input = el('div', 'nb-in');
        const gutter = el('div', 'nb-gutter');
        const label = el('span', 'nb-label', '[ ]');
        const runButton = el('button', 'nb-run');
        runButton.type = 'button';
        gutter.append(label, runButton);

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
        const autoButton = el('button', 'nb-tool');
        autoButton.type = 'button';
        autoButton.title = 'Выполнять ячейку по ходу набора';
        const restart = el('button', 'nb-tool', 'Сбросить');
        restart.type = 'button';
        restart.title = 'Перезапустить среду выполнения: переменные ячеек будут забыты';
        const clear = el('button', 'nb-tool', 'Очистить вывод');
        clear.type = 'button';
        tools.append(autoButton, restart, clear);
        input.append(gutter, body, tools);

        const output = el('div');
        host.append(input, output);
        host.dataset.ready = '1';

        function refresh() {
            mirrorCode.innerHTML = highlight(area.value) + '\n';
            area.style.height = '0px';
            area.style.height = area.scrollHeight + 'px';
        }
        const paintAuto = () => { autoButton.textContent = auto ? 'Авто: вкл' : 'Авто'; autoButton.classList.toggle('is-on', auto); };
        const unwatch = watch(docId, index, current => {
            host.classList.toggle('is-running', current.running);
            runButton.title = current.running ? 'Остановить (выполнение прервётся)' : 'Запустить ячейку (Shift+Enter)';
            runButton.setAttribute('aria-label', runButton.title);
            runButton.innerHTML = window.icon ? window.icon(current.running ? 'stop' : 'play') : '';
            label.textContent = current.running ? '[*]' : current.n ? `[${current.n}]` : '[ ]';
        });
        const unmount = mountOutput(output, docId, index, () => area.value);
        host.nbDispose = () => { unwatch(); unmount(); };
        paintAuto();
        refresh();

        area.addEventListener('input', () => {
            refresh();
            writeCode(index, area.value);
            output.classList.toggle('is-stale', state.ran && state.ranCode !== area.value);
            if (auto) autoRun(docId, index, area.value);
        });
        area.addEventListener('keydown', event => {
            if (event.key === 'Enter' && (event.shiftKey || event.ctrlKey || event.metaKey)) { event.preventDefault(); run(docId, index, area.value); }
            else if (event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); document.execCommand('insertText', false, '    '); }
        });
        runButton.addEventListener('click', () => run(docId, index, area.value));
        autoButton.addEventListener('click', () => {
            auto = !auto;
            paintAuto();
            setAuto(index, auto);
            if (auto) autoRun(docId, index, area.value, 0);
        });
        restart.addEventListener('click', () => resetKernel(docId));
        clear.addEventListener('click', () => clearOutput(docId, index));
        host.nbRefresh = refresh;
    }

    let currentDoc = () => 'doc';
    window.FgsNotebook = {
        render(container, docId) {
            container.querySelectorAll('.nb-cell').forEach(host => { if (host.nbDispose) host.nbDispose(); });
            container.querySelectorAll('.nb-cell').forEach((host, index) => build(host, docId, index));
            requestAnimationFrame(() => container.querySelectorAll('.nb-cell').forEach(host => host.nbRefresh && host.nbRefresh()));
        },
        // editor.js asks this before rebuilding the preview: edits made inside a cell must not destroy the cell being typed in.
        takeSkip() { const value = skipNext; skipNext = false; return value; },
        forget(docId) {
            stopKernel(docId, 'Документ закрыт');
            cellStates.forEach((state, key) => { if (key.startsWith(docId + ':')) cellStates.delete(key); });
        },
        // For the live editor.
        setDocument(provider) { currentDoc = provider; },
        docId: () => currentDoc(),
        cells, run, autoRun, watch, mountOutput, clearOutput, resetKernel,
        stopKernel: docId => stopKernel(docId, 'Выполнение остановлено')
    };
})();
