// ==FgsPlugin==
// @name        Граф связей
// @version     1.0
// @description Показывает связи между открытыми заметками ([[ссылки]] и ссылки на .md) и структуру заголовков текущей заметки. Клик по узлу открывает заметку.
// @author      FgSNotes
// ==/FgsPlugin==
// Аналог Graph из Obsidian. Заметки связываются ссылками вида [[Название заметки]] или [текст](Название.md).

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, text) => { const node = document.createElementNS(NS, tag); for (const k in attrs) node.setAttribute(k, attrs[k]); if (text !== undefined) node.textContent = text; return node; };
const norm = text => text.trim().toLowerCase().replace(/\.md$/, '');

function links(docs) {
    const byTitle = new Map(docs.map(doc => [norm(doc.title), doc]));
    const edges = [];
    for (const doc of docs) {
        const seen = new Set();
        for (const m of doc.content.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]|\]\(([^)#\s]+?)(?:\.md)?(?:#[^)]*)?\)/g)) {
            const target = byTitle.get(norm(decodeURIComponent(m[1] || m[2] || '')));
            if (target && target !== doc && !seen.has(target.id)) { seen.add(target.id); edges.push([doc.id, target.id]); }
        }
    }
    return edges;
}
// A few rounds of a simple force layout: nodes push each other away, edges pull their ends together.
function layout(nodes, edges, w, h) {
    nodes.forEach((n, i) => { const a = i / nodes.length * Math.PI * 2; n.x = w / 2 + Math.cos(a) * w / 4; n.y = h / 2 + Math.sin(a) * h / 4; });
    const index = new Map(nodes.map(n => [n.id, n]));
    for (let step = 0; step < 220; step++) {
        for (const a of nodes) {
            let fx = (w / 2 - a.x) * 0.002, fy = (h / 2 - a.y) * 0.002;
            for (const b of nodes) if (a !== b) { const dx = a.x - b.x, dy = a.y - b.y, d2 = Math.max(dx * dx + dy * dy, 40); fx += dx / d2 * 900; fy += dy / d2 * 900; }
            a.vx = (a.vx || 0) * 0.6 + fx; a.vy = (a.vy || 0) * 0.6 + fy;
        }
        for (const [from, to] of edges) {
            const a = index.get(from), b = index.get(to), dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, pull = (d - 110) * 0.01;
            a.vx += dx / d * pull; a.vy += dy / d * pull; b.vx -= dx / d * pull; b.vy -= dy / d * pull;
        }
        for (const n of nodes) { n.x = Math.min(w - 60, Math.max(60, n.x + n.vx)); n.y = Math.min(h - 24, Math.max(24, n.y + n.vy)); }
    }
}

function documentsGraph(svg, w, h, close) {
    const docs = fgs.documents(), edges = links(docs);
    const nodes = docs.map(doc => ({ id: doc.id, title: doc.title, active: doc.active, degree: edges.filter(e => e.includes(doc.id)).length }));
    layout(nodes, edges, w, h);
    const index = new Map(nodes.map(n => [n.id, n]));
    for (const [from, to] of edges) { const a = index.get(from), b = index.get(to); svg.append(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: 'currentColor', 'stroke-opacity': .35, 'stroke-width': 1.5 })); }
    for (const n of nodes) {
        const g = el('g', { style: 'cursor:pointer', tabindex: 0, role: 'button', 'aria-label': n.title });
        g.append(el('circle', { cx: n.x, cy: n.y, r: 7 + Math.min(n.degree, 6) * 2, fill: n.active ? 'var(--accent-color)' : 'var(--text-muted)' }));
        g.append(el('text', { x: n.x, y: n.y + 24 + Math.min(n.degree, 6) * 2, 'text-anchor': 'middle', 'font-size': 12, fill: 'currentColor' }, n.title.slice(0, 28)));
        const go = () => { close(); fgs.openDocument(n.id); };
        g.addEventListener('click', go);
        g.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        svg.append(g);
    }
    return nodes.length ? (edges.length ? `${nodes.length} заметок, ${edges.length} связей` : 'Связей пока нет. Добавьте в заметку ссылку [[Название другой заметки]].') : '';
}

function headingsGraph(svg, w, h) {
    const doc = fgs.documents().find(d => d.active);
    const items = [];
    let inCode = false;
    for (const line of (doc ? doc.content : '').split('\n')) {
        if (/^```/.test(line)) inCode = !inCode;
        const m = !inCode && /^(#{1,6})\s+(.+)/.exec(line);
        if (m) items.push({ level: m[1].length, title: m[2].trim() });
    }
    if (!items.length) return 'В заметке нет заголовков.';
    const root = { title: doc.title, level: 0, children: [] }, stack = [root];
    for (const item of items) { item.children = []; while (stack[stack.length - 1].level >= item.level) stack.pop(); stack[stack.length - 1].children.push(item); stack.push(item); }
    let row = 0;
    const place = (node, depth) => { node.x = 40 + depth * 190; if (!node.children.length) node.y = 24 + row++ * 30; else { node.children.forEach(c => place(c, depth + 1)); node.y = (node.children[0].y + node.children[node.children.length - 1].y) / 2; } };
    place(root, 0);
    svg.setAttribute('viewBox', `0 0 ${Math.max(w, 80 + 190 * 6)} ${Math.max(h, 40 + row * 30)}`);
    const draw = node => {
        for (const c of node.children) { svg.append(el('path', { d: `M${node.x + 8} ${node.y}C${node.x + 80} ${node.y} ${c.x - 70} ${c.y} ${c.x - 8} ${c.y}`, fill: 'none', stroke: 'currentColor', 'stroke-opacity': .35 })); draw(c); }
        svg.append(el('circle', { cx: node.x, cy: node.y, r: 5, fill: node.level ? 'var(--text-muted)' : 'var(--accent-color)' }));
        svg.append(el('text', { x: node.x + 10, y: node.y - 8, 'font-size': 12, fill: 'currentColor' }, node.title.slice(0, 26)));
    };
    draw(root);
    return `${items.length} заголовков`;
}

fgs.addButton({
    title: 'Граф связей',
    icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><circle cx="3.5" cy="8" r="1.8"/><circle cx="12.5" cy="3.5" r="1.8"/><circle cx="12.5" cy="12.5" r="1.8"/><path d="M5.2 7.2 10.8 4.3M5.2 8.8l5.6 2.9"/></svg>',
    run() {
        const { body, close } = fgs.modal({ title: 'Граф связей', width: 860 });
        body.innerHTML = '<div class="pm-row"><button class="pm-btn primary" data-mode="docs">Заметки</button><button class="pm-btn" data-mode="heads">Заголовки</button><span class="pm-muted" id="ng-info"></span></div><svg id="ng" style="width:100%;height:60vh;display:block;border-radius:8px;background:var(--code-bg);color:var(--text-color)" viewBox="0 0 800 480"></svg>';
        const svg = body.querySelector('#ng'), info = body.querySelector('#ng-info');
        const show = mode => {
            svg.replaceChildren(); svg.setAttribute('viewBox', '0 0 800 480');
            info.textContent = mode === 'docs' ? documentsGraph(svg, 800, 480, close) : headingsGraph(svg, 800, 480);
            body.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('primary', b.dataset.mode === mode));
        };
        body.addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) show(b.dataset.mode); });
        show('docs');
    }
});
