// ==FgsPlugin==
// @name        Exildraw
// @version     3.0
// @description Доска для набросков в духе Excalidraw: бесконечный холст, перо с нажимом Apple Pencil, линии, стрелки, фигуры, текст. Рисунок вставляется в заметку как SVG и открывается для правки по клику.
// @author      FgSNotes
// ==/FgsPlugin==
//
// Кнопка «Рисунок» открывает доску. «Вставить» кладёт в заметку картинку вида ![exildraw](data:image/svg+xml;base64,…).
// Сама сцена хранится внутри SVG, поэтому рисунок можно открыть и поправить.
//
// Стилус: толщина следует за нажимом. Двойной тап переключает Перо и Ластик. После стилуса касания пальцем не рисуют ~1.5 с.
// Два пальца: сдвиг и масштаб. Инструмент «Рука» или пробел: сдвиг одним пальцем или мышью.

const MARK = 'exildraw';
const ACCENT_COLORS = ['#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5'];
const WIDTHS = [2, 4, 7];
const TOOLS = [
    ['pen', 'Перо'], ['line', 'Линия'], ['arrow', 'Стрелка'], ['rect', 'Прямоугольник'],
    ['ellipse', 'Эллипс'], ['text', 'Текст'], ['erase', 'Ластик'], ['hand', 'Рука']
];
const FONT = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
const HISTORY = 200;
const ZOOM_MIN = 0.25, ZOOM_MAX = 4, GRID = 32;
const PALM_MS = 1500;

// Paper and ink follow the editor theme (--card-bg / --text-color), same island as the note pane.
function themeSurface() {
    const style = getComputedStyle(document.documentElement);
    const read = name => (style.getPropertyValue(name) || '').trim();
    const paper = read('--card-bg') || '#27282c';
    const ink = read('--text-color') || '#dfe1e5';
    const muted = read('--text-muted') || '#8c9097';
    const dark = !String(document.documentElement.dataset.theme).endsWith('light');
    return { paper, ink, muted, dark, colors: [ink, ...ACCENT_COLORS] };
}

fgs.addStyle(`
.exd-back { display: flex; flex: 1; min-height: 0; padding: 12px; background: var(--window-bg, transparent); }
.exd-box { display: flex; flex-direction: column; gap: 10px; flex: 1; min-width: 0; min-height: 0; padding: 10px; border-radius: var(--radius-lg, 12px); background: var(--card-bg, #27282c); color: var(--text-color, #eee); box-shadow: var(--edge, none); }
.exd-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.exd-bar .exd-sep { width: 1px; height: 22px; margin: 0 4px; background: var(--border-color, #444); }
.exd-bar button { height: 32px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
.exd-bar button:hover { background: var(--hover-color, rgba(128, 128, 128, .22)); }
.exd-bar button:disabled { opacity: .4; cursor: default; background: transparent; }
.exd-bar button.on { background: var(--accent-color, #21aabe); color: var(--accent-text, #fff); }
.exd-bar button.exd-sw { width: 24px; height: 24px; padding: 0; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--text-color, #eee) 35%, transparent); background: var(--c); }
.exd-bar button.exd-sw.on { border-color: var(--text-color, #eee); box-shadow: 0 0 0 2px var(--card-bg, #27282c) inset; }
.exd-bar .exd-wd { width: 32px; padding: 0; display: grid; place-items: center; }
.exd-bar .exd-wd i { display: block; width: 18px; background: currentColor; border-radius: 4px; }
.exd-bar .exd-grow { flex: 1; }
.exd-stage { flex: 1; min-height: 0; overflow: hidden; border-radius: var(--radius-md, 8px); background: var(--card-bg, #27282c); position: relative; box-shadow: inset 0 0 0 1px var(--border-color, #393b41); }
.exd-paper { position: absolute; inset: 0; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.exd-paper canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.exd-live { cursor: crosshair; }
.exd-live.hand { cursor: grab; }
.exd-live.hand.dragging { cursor: grabbing; }
.exd-text { position: absolute; min-width: 60px; padding: 0; border: 0; outline: 1px dashed var(--text-muted, #888); background: transparent; color: inherit; caret-color: var(--text-color, #eee); line-height: 1.2; resize: none; font-family: ${FONT}; -webkit-user-select: text; user-select: text; }
@media (pointer: coarse) { .exd-bar button { height: 40px; min-width: 40px; } .exd-bar button.exd-sw { width: 30px; height: 30px; min-width: 0; } }
`);

const escapeXml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toBase64 = text => btoa(unescape(encodeURIComponent(text)));
const fromBase64 = data => decodeURIComponent(escape(atob(data)));
const round = value => Math.round(value * 10) / 10;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function textBox(element) {
    const lines = element.text.split('\n');
    return [element.x1, element.y1, element.x1 + Math.max(...lines.map(line => line.length)) * element.size * 0.62, element.y1 + lines.length * element.size * 1.2];
}
function bounds(element) {
    if (element.type === 'pen') {
        const box = [Infinity, Infinity, -Infinity, -Infinity];
        for (const [x, y] of element.points) { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); }
        return box;
    }
    if (element.type === 'text') return textBox(element);
    return [Math.min(element.x1, element.x2), Math.min(element.y1, element.y2), Math.max(element.x1, element.x2), Math.max(element.y1, element.y2)];
}
function sceneBounds(scene) {
    if (!scene.length) return [0, 0, 400, 300];
    return scene.map(bounds).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
}
function arrowHead(element) {
    const angle = Math.atan2(element.y2 - element.y1, element.x2 - element.x1), size = 12 + element.width * 2;
    return [-0.45, 0.45].map(turn => [element.x2 - size * Math.cos(angle + turn), element.y2 - size * Math.sin(angle + turn)]);
}
function penPath(points) {
    if (points.length === 1) return `M${points[0][0]} ${points[0][1]}l0.01 0`;
    let d = `M${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length - 1; i++) {
        const mx = round((points[i][0] + points[i + 1][0]) / 2), my = round((points[i][1] + points[i + 1][1]) / 2);
        d += `Q${points[i][0]} ${points[i][1]} ${mx} ${my}`;
    }
    const last = points[points.length - 1];
    return d + `L${last[0]} ${last[1]}`;
}
function pressurePath(element) {
    const points = element.points, count = points.length;
    const raw = points.map(p => element.width / 2 * (0.35 + 1.3 * Math.pow(p[2] === undefined ? 0.5 : p[2], 0.7)));
    const radius = raw.map((_, i) => {
        let sum = 0, used = 0;
        for (let j = Math.max(0, i - 2); j <= Math.min(count - 1, i + 2); j++) { sum += raw[j]; used++; }
        return sum / used;
    });
    if (count === 1) { const [x, y] = points[0], r = round(radius[0]); return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`; }
    const left = [], right = [];
    points.forEach(([x, y], i) => {
        const a = points[Math.max(0, i - 1)], b = points[Math.min(count - 1, i + 1)];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / length * radius[i], ny = (b[0] - a[0]) / length * radius[i];
        left.push(`${round(x + nx)} ${round(y + ny)}`);
        right.unshift(`${round(x - nx)} ${round(y - ny)}`);
    });
    const end = round(radius[count - 1]), start = round(radius[0]);
    return `M${left.join('L')}A${end} ${end} 0 0 0 ${right.join('L')}A${start} ${start} 0 0 0 ${left[0]}Z`;
}

function paint(ctx, element) {
    ctx.strokeStyle = ctx.fillStyle = element.color;
    ctx.lineWidth = element.width;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    if (element.type === 'pen') {
        if (element.pressure) ctx.fill(new Path2D(pressurePath(element)));
        else ctx.stroke(new Path2D(penPath(element.points)));
    } else if (element.type === 'line' || element.type === 'arrow') {
        ctx.moveTo(element.x1, element.y1); ctx.lineTo(element.x2, element.y2);
        if (element.type === 'arrow') for (const [x, y] of arrowHead(element)) { ctx.moveTo(element.x2, element.y2); ctx.lineTo(x, y); }
        ctx.stroke();
    } else if (element.type === 'rect') ctx.strokeRect(Math.min(element.x1, element.x2), Math.min(element.y1, element.y2), Math.abs(element.x2 - element.x1), Math.abs(element.y2 - element.y1));
    else if (element.type === 'ellipse') {
        ctx.ellipse((element.x1 + element.x2) / 2, (element.y1 + element.y2) / 2, Math.abs(element.x2 - element.x1) / 2 || 1, Math.abs(element.y2 - element.y1) / 2 || 1, 0, 0, Math.PI * 2);
        ctx.stroke();
    } else if (element.type === 'text') {
        ctx.font = `${element.size}px ${FONT}`;
        ctx.textBaseline = 'top';
        element.text.split('\n').forEach((line, i) => ctx.fillText(line, element.x1, element.y1 + i * element.size * 1.2));
    }
}

function toSvg(scene, paper = '#ffffff') {
    const box = sceneBounds(scene);
    const pad = 24;
    const x = Math.floor(box[0] - pad), y = Math.floor(box[1] - pad), w = Math.max(1, Math.ceil(box[2] - box[0] + pad * 2)), h = Math.max(1, Math.ceil(box[3] - box[1] + pad * 2));
    const common = el => `stroke="${el.color}" stroke-width="${el.width}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
    const body = scene.map(el => {
        if (el.type === 'pen') return el.pressure ? `<path d="${pressurePath(el)}" fill="${el.color}"/>` : `<path d="${penPath(el.points)}" ${common(el)}/>`;
        if (el.type === 'line') return `<line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" ${common(el)}/>`;
        if (el.type === 'arrow') { const [a, b] = arrowHead(el); return `<path d="M${el.x1} ${el.y1}L${el.x2} ${el.y2}M${el.x2} ${el.y2}L${a[0]} ${a[1]}M${el.x2} ${el.y2}L${b[0]} ${b[1]}" ${common(el)}/>`; }
        if (el.type === 'rect') return `<rect x="${Math.min(el.x1, el.x2)}" y="${Math.min(el.y1, el.y2)}" width="${Math.abs(el.x2 - el.x1)}" height="${Math.abs(el.y2 - el.y1)}" ${common(el)}/>`;
        if (el.type === 'ellipse') return `<ellipse cx="${(el.x1 + el.x2) / 2}" cy="${(el.y1 + el.y2) / 2}" rx="${Math.abs(el.x2 - el.x1) / 2}" ry="${Math.abs(el.y2 - el.y1) / 2}" ${common(el)}/>`;
        const lines = el.text.split('\n').map((line, i) => `<tspan x="${el.x1}" dy="${i ? el.size * 1.2 : 0}">${escapeXml(line)}</tspan>`).join('');
        return `<text x="${el.x1}" y="${el.y1}" dominant-baseline="hanging" font-family='${FONT.replace(/"/g, '&quot;')}' font-size="${el.size}" fill="${el.color}">${lines}</text>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}"><metadata id="${MARK}">${escapeXml(JSON.stringify(scene))}</metadata><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${escapeXml(paper)}"/>${body}</svg>`;
}
function fromSvg(svg) {
    const match = /<metadata id="exildraw">([\s\S]*?)<\/metadata>/.exec(svg);
    if (!match) return [];
    try { return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')).filter(Boolean); } catch { return []; }
}

function segmentDistance([x, y], [x1, y1], [x2, y2]) {
    const dx = x2 - x1, dy = y2 - y1, span = dx * dx + dy * dy;
    const k = span ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / span)) : 0;
    return Math.hypot(x - x1 - k * dx, y - y1 - k * dy);
}
function polylineDistance(point, line) {
    if (line.length === 1) return Math.hypot(point[0] - line[0][0], point[1] - line[0][1]);
    let best = Infinity;
    for (let i = 1; i < line.length; i++) best = Math.min(best, segmentDistance(point, line[i - 1], line[i]));
    return best;
}
function touches(element, point) {
    const slack = element.width / 2 + 8;
    if (element.type === 'text') {
        const [x1, y1, x2, y2] = textBox(element);
        return point[0] >= x1 - slack && point[0] <= x2 + slack && point[1] >= y1 - slack && point[1] <= y2 + slack;
    }
    if (element.type === 'pen') return polylineDistance(point, element.points) <= slack + (element.pressure ? element.width / 2 : 0);
    const { x1, y1, x2, y2 } = element;
    if (element.type === 'rect') return polylineDistance(point, [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]) <= slack;
    if (element.type === 'ellipse') {
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
        const outline = Array.from({ length: 49 }, (_, i) => [cx + rx * Math.cos(i / 48 * Math.PI * 2), cy + ry * Math.sin(i / 48 * Math.PI * 2)]);
        return polylineDistance(point, outline) <= slack;
    }
    return polylineDistance(point, [[x1, y1], [x2, y2]]) <= slack;
}

const imagePattern = () => /!\[exildraw\]\(data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)\)/g;
function drawings(text) {
    const found = [];
    for (const m of text.matchAll(imagePattern())) found.push({ from: m.index, to: m.index + m[0].length, data: m[1] });
    return found;
}

function openBoard(existing) {
    const origin = { note: fgs.documents().find(doc => doc.active) || null, cursor: fgs.editor.cursor() };
    const key = existing ? `edit:${existing.data.length}:${existing.data.slice(-24)}` : 'new';
    let cleanup = () => {};
    fgs.openTab({ key, title: existing ? 'Рисунок (правка)' : 'Новый рисунок', icon: 'edit', onClose: () => cleanup(), render: (element, tab) => { cleanup = mountBoard(element, tab, existing, origin); } });
}

function mountBoard(host, tab, existing, origin) {
    const draftSaved = existing ? null : fgs.storage.get('draft', null);
    const saved = existing ? fromSvg(fromBase64(existing.data)) : [];
    let scene = draftSaved && draftSaved.length ? draftSaved : saved;
    let past = [], future = [];
    let surface = themeSurface();
    let tool = 'pen', color = surface.ink, width = WIDTHS[1];
    let draft = null, typing = null, frame = 0, hover = null;
    let activePointer = null, stylusSeen = false, stylusTimer = 0, spaceDown = false;
    let armedClose = 0, lastPenTap = null;
    let camera = { x: 0, y: 0, zoom: 1 };
    let pan = null, pinch = null;
    if (scene !== saved) fgs.notify('Восстановлен несохранённый рисунок');

    const back = document.createElement('div');
    back.className = 'exd-back';
    back.innerHTML = `<div class="exd-box" role="group" aria-label="Рисунок"><div class="exd-bar"></div><div class="exd-stage"><div class="exd-paper"><canvas class="exd-base"></canvas><canvas class="exd-live"></canvas></div></div></div>`;
    const bar = back.querySelector('.exd-bar'), stage = back.querySelector('.exd-stage'), paper = back.querySelector('.exd-paper');
    const baseCanvas = back.querySelector('.exd-base'), canvas = back.querySelector('.exd-live');
    const base = baseCanvas.getContext('2d'), live = canvas.getContext('2d');
    let viewW = 1, viewH = 1, dpr = 1;

    const button = (label, onClick, className = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = className; b.addEventListener('click', onClick); return b; };
    const toolButtons = TOOLS.map(([id, label]) => { const b = button(label, () => { commitText(); tool = id; sync(); }); b.dataset.tool = id; return b; });
    const swatchHost = document.createElement('span');
    swatchHost.style.display = 'contents';
    function paintSwatches() {
        const keep = surface.colors.includes(color) ? color : surface.ink;
        color = keep;
        swatchHost.replaceChildren(...surface.colors.map(c => {
            const b = button('', () => { color = c; sync(); }, 'exd-sw');
            b.style.setProperty('--c', c);
            b.title = c;
            b.setAttribute('aria-label', 'Цвет ' + c);
            b.dataset.color = c;
            return b;
        }));
        sync();
    }
    const widths = WIDTHS.map(w => { const b = button('', () => { width = w; sync(); }, 'exd-wd'); b.innerHTML = `<i style="height:${w}px"></i>`; b.title = 'Толщина ' + w; b.setAttribute('aria-label', 'Толщина ' + w); b.dataset.width = w; return b; });
    const sep = () => Object.assign(document.createElement('span'), { className: 'exd-sep' });
    const grow = Object.assign(document.createElement('span'), { className: 'exd-grow' });
    const undoButton = button('Отменить', () => { commitText(); if (past.length) { future.push(scene); scene = past.pop(); changed(); } });
    const redoButton = button('Вернуть', () => { commitText(); if (future.length) { past.push(scene); scene = future.pop(); changed(); } });
    const clearButton = button('Очистить', () => { commitText(); if (scene.length) commit([]); });
    const fitButton = button('По размеру', () => fitToScene());
    const zoomButton = button('100%', () => { camera.zoom = 1; redraw(); });
    const closeButton = button('Закрыть', () => close());
    const insertButton = button(existing ? 'Сохранить' : 'Вставить', () => insert(), 'on');
    bar.append(...toolButtons, sep(), swatchHost, sep(), ...widths, sep(), undoButton, redoButton, clearButton, fitButton, zoomButton, grow, closeButton, insertButton);
    paintSwatches();

    function screenToWorld(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        return [round(camera.x + (clientX - rect.left) / camera.zoom), round(camera.y + (clientY - rect.top) / camera.zoom)];
    }
    function point(event, pressured) {
        const p = screenToWorld(event.clientX, event.clientY);
        if (pressured) p.push(Math.round((event.pressure || 0.5) * 1000) / 1000);
        return p;
    }
    function setCamera(next) {
        camera = { x: next.x, y: next.y, zoom: clamp(next.zoom, ZOOM_MIN, ZOOM_MAX) };
        redraw();
    }
    function zoomAt(clientX, clientY, factor) {
        const before = screenToWorld(clientX, clientY);
        const zoom = clamp(camera.zoom * factor, ZOOM_MIN, ZOOM_MAX);
        const rect = canvas.getBoundingClientRect();
        setCamera({ zoom, x: before[0] - (clientX - rect.left) / zoom, y: before[1] - (clientY - rect.top) / zoom });
    }
    function fitToScene() {
        const box = sceneBounds(scene);
        const pad = 48, w = Math.max(1, box[2] - box[0] + pad * 2), h = Math.max(1, box[3] - box[1] + pad * 2);
        const zoom = clamp(Math.min(viewW / w, viewH / h), ZOOM_MIN, ZOOM_MAX);
        setCamera({ zoom, x: (box[0] + box[2]) / 2 - viewW / (2 * zoom), y: (box[1] + box[3]) / 2 - viewH / (2 * zoom) });
    }
    function resize() {
        const rect = stage.getBoundingClientRect();
        viewW = Math.max(1, Math.floor(rect.width));
        viewH = Math.max(1, Math.floor(rect.height));
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (const node of [baseCanvas, canvas]) {
            node.width = Math.floor(viewW * dpr);
            node.height = Math.floor(viewH * dpr);
        }
        base.setTransform(dpr, 0, 0, dpr, 0, 0);
        live.setTransform(dpr, 0, 0, dpr, 0, 0);
        redraw();
    }

    const dirty = () => scene !== saved && JSON.stringify(scene) !== JSON.stringify(saved);
    function sync() {
        for (const b of toolButtons) b.classList.toggle('on', b.dataset.tool === tool);
        for (const b of swatchHost.querySelectorAll('.exd-sw')) b.classList.toggle('on', b.dataset.color === color);
        for (const b of widths) b.classList.toggle('on', Number(b.dataset.width) === width);
        canvas.classList.toggle('hand', tool === 'hand' || spaceDown);
        canvas.style.cursor = tool === 'hand' || spaceDown ? '' : tool === 'erase' ? 'cell' : tool === 'text' ? 'text' : 'crosshair';
        undoButton.disabled = !past.length;
        redoButton.disabled = !future.length;
        clearButton.disabled = !scene.length;
        zoomButton.textContent = Math.round(camera.zoom * 100) + '%';
    }
    function withCamera(ctx, fn) {
        ctx.save();
        ctx.clearRect(0, 0, viewW, viewH);
        ctx.translate(-camera.x * camera.zoom, -camera.y * camera.zoom);
        ctx.scale(camera.zoom, camera.zoom);
        fn(ctx);
        ctx.restore();
    }
    function drawGrid(ctx) {
        const left = camera.x, top = camera.y, right = camera.x + viewW / camera.zoom, bottom = camera.y + viewH / camera.zoom;
        const step = GRID;
        ctx.fillStyle = surface.paper;
        ctx.fillRect(left, top, right - left, bottom - top);
        ctx.fillStyle = surface.dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)';
        const x0 = Math.floor(left / step) * step, y0 = Math.floor(top / step) * step;
        for (let x = x0; x <= right; x += step) for (let y = y0; y <= bottom; y += step) ctx.fillRect(x, y, 1.25 / camera.zoom, 1.25 / camera.zoom);
    }
    function applyTheme() {
        const next = themeSurface();
        const inkWasDefault = color === surface.ink;
        surface = next;
        if (inkWasDefault) color = surface.ink;
        paintSwatches();
        redraw();
    }
    function drawBase() {
        withCamera(base, ctx => {
            drawGrid(ctx);
            for (const el of scene) paint(ctx, el);
        });
    }
    function drawLive() {
        frame = 0;
        withCamera(live, ctx => {
            if (draft && !draft.erasing) paint(ctx, draft);
            if (hover && tool === 'pen' && !draft) {
                ctx.fillStyle = color;
                const r = width / 2 * (0.35 + 1.3 * Math.pow(hover[2] ?? 0.5, 0.7));
                ctx.beginPath();
                ctx.arc(hover[0], hover[1], Math.max(r, 1), 0, Math.PI * 2);
                ctx.fill();
            }
        });
    }
    const queueLive = () => { if (!frame) frame = requestAnimationFrame(drawLive); };
    function redraw() { drawBase(); queueLive(); sync(); }
    function changed() {
        redraw();
        if (!existing) fgs.storage.set('draft', scene.length ? scene : null);
    }
    function commit(next) {
        past.push(scene);
        if (past.length > HISTORY) past.shift();
        future = [];
        scene = next;
        changed();
    }

    function markStylus() {
        stylusSeen = true;
        clearTimeout(stylusTimer);
        stylusTimer = setTimeout(() => { stylusSeen = false; }, PALM_MS);
    }
    function panning() { return tool === 'hand' || spaceDown; }

    function commitText() {
        if (!typing) return;
        const { field, x, y, size, color: ink } = typing;
        typing = null;
        const value = field.value.replace(/\s+$/, '');
        field.remove();
        if (value) commit([...scene, { type: 'text', x1: x, y1: y, text: value, color: ink, width: 1, size }]);
    }
    function startText([x, y], event) {
        commitText();
        const field = document.createElement('textarea');
        const rect = paper.getBoundingClientRect(), size = 12 + width * 3;
        field.className = 'exd-text';
        field.rows = 1; field.cols = 14;
        field.style.color = color;
        field.style.fontSize = (size * camera.zoom) + 'px';
        field.style.left = (event.clientX - rect.left) + 'px';
        field.style.top = (event.clientY - rect.top) + 'px';
        field.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { field.value = ''; commitText(); } else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); } });
        field.addEventListener('blur', () => setTimeout(() => { if (typing && typing.field === field) commitText(); }, 0));
        paper.append(field);
        typing = { field, x, y, size, color };
        field.focus();
    }

    function eraseAlong(from, to) {
        const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 6));
        const samples = Array.from({ length: steps + 1 }, (_, i) => [from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps]);
        const kept = scene.filter(el => !samples.some(sample => touches(el, sample)));
        if (kept.length === scene.length) return;
        if (!draft.touched) { draft.touched = true; past.push(scene); if (past.length > HISTORY) past.shift(); future = []; }
        scene = kept;
        changed();
    }
    const addSample = (event, pressured) => {
        const p = point(event, pressured), last = draft.points[draft.points.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.6 / camera.zoom) draft.points.push(p);
        else if (pressured) last[2] = Math.max(last[2], p[2]);
    };

    canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0 || activePointer !== null || pinch) return;
        if (event.pointerType === 'pen') {
            markStylus();
            const now = event.timeStamp;
            const again = lastPenTap && now - lastPenTap.time < 320 && Math.hypot(event.clientX - lastPenTap.x, event.clientY - lastPenTap.y) < 28;
            lastPenTap = again ? null : { time: now, x: event.clientX, y: event.clientY };
            if (again) {
                commitText();
                tool = tool === 'erase' ? 'pen' : 'erase';
                sync();
                return;
            }
        } else if (event.pointerType === 'touch' && stylusSeen) return;
        if (tool === 'text' && !panning()) return;
        commitText();
        if (panning()) {
            pan = { id: event.pointerId, x: event.clientX, y: event.clientY, camX: camera.x, camY: camera.y };
            canvas.classList.add('dragging');
            canvas.setPointerCapture(event.pointerId);
            return;
        }
        activePointer = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
        const pressured = event.pointerType === 'pen';
        const p = point(event, pressured);
        if (tool === 'erase') { draft = { erasing: true, last: p }; eraseAlong(p, p); return; }
        draft = tool === 'pen' ? { type: 'pen', points: [p], color, width, ...(pressured ? { pressure: true } : {}) } : { type: tool, x1: p[0], y1: p[1], x2: p[0], y2: p[1], color, width };
        queueLive();
    });
    canvas.addEventListener('pointermove', event => {
        if (event.pointerType === 'pen' && !event.buttons) {
            markStylus();
            hover = point(event, true);
            queueLive();
        }
        if (pan && event.pointerId === pan.id) {
            setCamera({
                zoom: camera.zoom,
                x: pan.camX - (event.clientX - pan.x) / camera.zoom,
                y: pan.camY - (event.clientY - pan.y) / camera.zoom
            });
            return;
        }
        if (!draft || event.pointerId !== activePointer) return;
        if (draft.erasing) { const p = point(event); eraseAlong(draft.last, p); draft.last = p; return; }
        if (draft.type === 'pen') {
            const samples = event.getCoalescedEvents ? event.getCoalescedEvents() : [];
            for (const sample of samples.length ? samples : [event]) addSample(sample, !!draft.pressure);
        } else { const p = point(event); draft.x2 = p[0]; draft.y2 = p[1]; }
        queueLive();
    });
    const finish = event => {
        if (pan && event.pointerId === pan.id) {
            pan = null;
            canvas.classList.remove('dragging');
            return;
        }
        if (event.pointerId !== activePointer) return;
        activePointer = null;
        if (!draft) return;
        const done = draft;
        draft = null;
        if (!done.erasing) {
            const tiny = done.type !== 'pen' && Math.hypot(done.x2 - done.x1, done.y2 - done.y1) < 3 / camera.zoom;
            if (!tiny) commit([...scene, done]);
        }
        queueLive();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('lostpointercapture', finish);
    canvas.addEventListener('pointerleave', () => { hover = null; queueLive(); });
    canvas.addEventListener('click', event => { if (tool === 'text' && !panning()) startText(point(event), event); });
    canvas.addEventListener('wheel', event => {
        event.preventDefault();
        zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.08 : 1 / 1.08);
    }, { passive: false });

    // Two-finger pan and pinch on the board.
    paper.addEventListener('touchstart', event => {
        event.stopPropagation();
        if (tool === 'text' && event.touches.length === 1) return;
        event.preventDefault();
        if (event.touches.length === 2) {
            activePointer = null; draft = null; pan = null;
            const [a, b] = event.touches;
            pinch = {
                spread: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
                midX: (a.clientX + b.clientX) / 2,
                midY: (a.clientY + b.clientY) / 2,
                zoom: camera.zoom,
                x: camera.x,
                y: camera.y
            };
        }
    }, { passive: false });
    paper.addEventListener('touchmove', event => {
        event.stopPropagation();
        if (tool === 'text' && event.touches.length === 1 && !pinch) return;
        event.preventDefault();
        if (!pinch || event.touches.length !== 2) return;
        const [a, b] = event.touches;
        const spread = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
        const midX = (a.clientX + b.clientX) / 2, midY = (a.clientY + b.clientY) / 2;
        const zoom = clamp(pinch.zoom * spread / pinch.spread, ZOOM_MIN, ZOOM_MAX);
        const rect = canvas.getBoundingClientRect();
        const worldX = pinch.x + (pinch.midX - rect.left) / pinch.zoom;
        const worldY = pinch.y + (pinch.midY - rect.top) / pinch.zoom;
        setCamera({
            zoom,
            x: worldX - (midX - rect.left) / zoom,
            y: worldY - (midY - rect.top) / zoom
        });
    }, { passive: false });
    const endPinch = () => { pinch = null; };
    paper.addEventListener('touchend', endPinch, { passive: true });
    paper.addEventListener('touchcancel', endPinch, { passive: true });
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('gesturestart', event => event.preventDefault());

    function insert() {
        commitText();
        if (!scene.length) { discard(); return; }
        const markdown = `![${MARK}](data:image/svg+xml;base64,${toBase64(toSvg(scene, surface.paper))})`;
        const home = origin.note && fgs.documents().find(doc => doc.id === origin.note.id);
        if (home) fgs.openDocument(home.id); else tab.backToNote();
        const text = fgs.editor.get();
        const now = existing && drawings(text).find(item => item.data === existing.data);
        if (now) fgs.editor.replace(now.from, now.to, markdown);
        else {
            const at = home && home.content === origin.note.content ? Math.min(origin.cursor.to, text.length) : text.length;
            const before = at && text[at - 1] !== '\n' ? '\n\n' : '', after = at < text.length && text[at] !== '\n' ? '\n\n' : '';
            fgs.editor.replace(at, at, before + markdown + after);
        }
        fgs.notify('Рисунок сохранён в заметке');
        discard();
    }
    function discard() {
        if (!existing) fgs.storage.set('draft', null);
        tab.close();
    }
    function close() {
        commitText();
        if (!dirty() || Date.now() < armedClose) { discard(); return; }
        armedClose = Date.now() + 3000;
        closeButton.textContent = 'Точно закрыть?';
        setTimeout(() => { if (Date.now() >= armedClose) closeButton.textContent = 'Закрыть'; }, 3050);
    }
    function onKey(event) {
        if (!back.isConnected || !back.offsetParent || typing) return;
        if (event.code === 'Space') {
            if (event.type === 'keydown' && !spaceDown) { spaceDown = true; sync(); event.preventDefault(); }
            if (event.type === 'keyup') { spaceDown = false; sync(); }
            return;
        }
        if (event.type !== 'keydown') return;
        const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey;
        if (key === 'escape') { event.stopPropagation(); close(); }
        else if (mod && !event.shiftKey && key === 'z') { event.preventDefault(); event.stopPropagation(); undoButton.click(); }
        else if (mod && (key === 'y' || (event.shiftKey && key === 'z'))) { event.preventDefault(); event.stopPropagation(); redoButton.click(); }
        else if (key === 'h') { tool = 'hand'; sync(); }
        else if (key === '1') { tool = 'pen'; sync(); }
        else if (key === '2') { tool = 'erase'; sync(); }
    }
    function dispose() {
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('keyup', onKey, true);
        themeObserver.disconnect();
        clearTimeout(stylusTimer);
        cancelAnimationFrame(frame);
        resizeObserver.disconnect();
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKey, true);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage);
    const themeObserver = new MutationObserver(() => applyTheme());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    host.append(back);
    resize();
    if (scene.length) fitToScene();
    else sync();
    return dispose;
}

function openFromCursor() {
    const { from, to } = fgs.editor.cursor();
    const under = drawings(fgs.editor.get()).find(item => from >= item.from && to <= item.to);
    openBoard(under || null);
}
fgs.addButton({ title: 'Рисунок (Exildraw)', icon: 'edit', run: openFromCursor });

fgs.onPreview(preview => {
    preview.querySelectorAll(`img[alt="${MARK}"]`).forEach((img, index) => {
        img.style.cursor = 'pointer';
        img.title = 'Нажмите, чтобы изменить рисунок';
        img.onclick = () => { const item = drawings(fgs.editor.get())[index]; if (item) openBoard(item); };
    });
});
