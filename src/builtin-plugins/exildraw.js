// ==FgsPlugin==
// @name        Exildraw
// @version     2.0
// @description Доска для набросков в духе Excalidraw: перо с учётом нажима Apple Pencil, линии, стрелки, фигуры, текст. Рисунок вставляется в заметку как SVG и открывается для правки по клику.
// @author      FgSNotes
// ==/FgsPlugin==
//
// Кнопка «Рисунок» открывает доску. «Вставить» кладёт в заметку картинку вида ![exildraw](data:image/svg+xml;base64,…).
// Сама сцена хранится внутри SVG, поэтому рисунок можно открыть и поправить: поставьте курсор на строку с картинкой и нажмите кнопку
// или щёлкните по рисунку в предпросмотре. Работает без интернета и без сторонних библиотек.
//
// Стилус: толщина линии следует за нажимом. Как только доска увидела стилус, касания пальцем и ладонью перестают рисовать.

const MARK = 'exildraw';
const COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5'];
const WIDTHS = [2, 4, 7];
const TOOLS = [
    ['pen', 'Перо'], ['line', 'Линия'], ['arrow', 'Стрелка'], ['rect', 'Прямоугольник'],
    ['ellipse', 'Эллипс'], ['text', 'Текст'], ['erase', 'Ластик']
];
const W = 1000, H = 640;
const FONT = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
const HISTORY = 200;

fgs.addStyle(`
.exd-back { display: flex; flex: 1; min-height: 0; padding: 12px; }
.exd-box { display: flex; flex-direction: column; gap: 10px; flex: 1; min-width: 0; min-height: 0; color: var(--text-color, #eee); }
.exd-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.exd-bar .exd-sep { width: 1px; height: 22px; margin: 0 4px; background: var(--border-color, #444); }
.exd-bar button { height: 32px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
.exd-bar button:hover { background: rgba(128, 128, 128, .22); }
.exd-bar button:disabled { opacity: .4; cursor: default; background: transparent; }
.exd-bar button.on { background: var(--accent-color, #21aabe); color: var(--accent-text, #fff); }
.exd-bar button.exd-sw { width: 24px; height: 24px; padding: 0; border-radius: 50%; border: 2px solid rgba(128, 128, 128, .45); background: var(--c); }
.exd-bar button.exd-sw.on { border-color: var(--text-color, #eee); box-shadow: 0 0 0 2px var(--card-bg, #27282c) inset; }
.exd-bar .exd-wd { width: 32px; padding: 0; display: grid; place-items: center; }
.exd-bar .exd-wd i { display: block; width: 18px; background: currentColor; border-radius: 4px; }
.exd-bar .exd-grow { flex: 1; }
.exd-stage { flex: 1; min-height: 0; display: grid; place-items: center; overflow: hidden; border-radius: 10px; background: #f5f5f4; container-type: size; }
.exd-paper { position: relative; width: min(100cqw, calc(100cqh * ${W} / ${H})); aspect-ratio: ${W} / ${H}; background: #fff; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.exd-paper canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.exd-live { cursor: crosshair; }
.exd-text { position: absolute; min-width: 60px; padding: 0; border: 0; outline: 1px dashed #888; background: transparent; line-height: 1.2; resize: none; font-family: ${FONT}; -webkit-user-select: text; user-select: text; }
@media (pointer: coarse) { .exd-bar button { height: 40px; min-width: 40px; } .exd-bar button.exd-sw { width: 30px; height: 30px; min-width: 0; } }
`);

// --- scene -------------------------------------------------------------------------------------------------------------------
const escapeXml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toBase64 = text => btoa(unescape(encodeURIComponent(text)));
const fromBase64 = data => decodeURIComponent(escape(atob(data)));
const round = value => Math.round(value * 10) / 10;

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
// A stylus stroke is a filled shape: its width at every point follows the pressure there.
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

// Draws one element on a canvas context.
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

function toSvg(scene) {
    const box = scene.map(bounds).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const pad = 24;
    const x = Math.floor(box[0] - pad), y = Math.floor(box[1] - pad), w = Math.ceil(box[2] - box[0] + pad * 2), h = Math.ceil(box[3] - box[1] + pad * 2);
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
    // The scene itself rides along in <metadata>, which is what makes the picture editable again.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}"><metadata id="${MARK}">${escapeXml(JSON.stringify(scene))}</metadata><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>${body}</svg>`;
}
function fromSvg(svg) {
    const match = /<metadata id="exildraw">([\s\S]*?)<\/metadata>/.exec(svg);
    if (!match) return [];
    try { return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')).filter(Boolean); } catch { return []; }
}

// --- hit testing: the eraser takes what it actually touches, not everything inside a bounding box ---------------------------
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

// --- the images in the note ----------------------------------------------------------------------------------------------------
const imagePattern = () => /!\[exildraw\]\(data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)\)/g;
function drawings(text) {
    const found = [];
    for (const m of text.matchAll(imagePattern())) found.push({ from: m.index, to: m.index + m[0].length, data: m[1] });
    return found;
}

// --- the board -----------------------------------------------------------------------------------------------------------------
function openBoard(existing) {
    // Where the picture will go: remembered now, because the person may visit other tabs while drawing.
    const origin = { note: fgs.documents().find(doc => doc.active) || null, cursor: fgs.editor.cursor() };
    const key = existing ? `edit:${existing.data.length}:${existing.data.slice(-24)}` : 'new';
    let cleanup = () => {};
    fgs.openTab({ key, title: existing ? 'Рисунок (правка)' : 'Новый рисунок', icon: 'edit', onClose: () => cleanup(), render: (element, tab) => { cleanup = mountBoard(element, tab, existing, origin); } });
}

// Draws the board into `host` (a tab); returns what to run when the tab closes.
function mountBoard(host, tab, existing, origin) {
    const draftSaved = existing ? null : fgs.storage.get('draft', null);
    const saved = existing ? fromSvg(fromBase64(existing.data)) : [];
    let scene = draftSaved && draftSaved.length ? draftSaved : saved;
    let past = [], future = [];
    let tool = 'pen', color = COLORS[0], width = WIDTHS[1];
    let draft = null, typing = null, frame = 0;
    let activePointer = null, stylusSeen = false;
    let armedClose = 0;
    if (scene !== saved) fgs.notify('Восстановлен несохранённый рисунок');

    const back = document.createElement('div');
    back.className = 'exd-back';
    back.innerHTML = `<div class="exd-box" role="group" aria-label="Рисунок"><div class="exd-bar"></div><div class="exd-stage"><div class="exd-paper"><canvas class="exd-base" width="${W * 2}" height="${H * 2}"></canvas><canvas class="exd-live" width="${W * 2}" height="${H * 2}"></canvas></div></div></div>`;
    const bar = back.querySelector('.exd-bar'), paper = back.querySelector('.exd-paper');
    const baseCanvas = back.querySelector('.exd-base'), canvas = back.querySelector('.exd-live');
    const base = baseCanvas.getContext('2d'), live = canvas.getContext('2d');
    base.scale(2, 2);
    live.scale(2, 2);

    const button = (label, onClick, className = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = className; b.addEventListener('click', onClick); return b; };
    const toolButtons = TOOLS.map(([id, label]) => { const b = button(label, () => { commitText(); tool = id; sync(); }); b.dataset.tool = id; return b; });
    const swatches = COLORS.map(c => { const b = button('', () => { color = c; sync(); }, 'exd-sw'); b.style.setProperty('--c', c); b.title = c; b.setAttribute('aria-label', 'Цвет ' + c); b.dataset.color = c; return b; });
    const widths = WIDTHS.map(w => { const b = button('', () => { width = w; sync(); }, 'exd-wd'); b.innerHTML = `<i style="height:${w}px"></i>`; b.title = 'Толщина ' + w; b.setAttribute('aria-label', 'Толщина ' + w); b.dataset.width = w; return b; });
    const sep = () => Object.assign(document.createElement('span'), { className: 'exd-sep' });
    const grow = Object.assign(document.createElement('span'), { className: 'exd-grow' });
    const undoButton = button('Отменить', () => { commitText(); if (past.length) { future.push(scene); scene = past.pop(); changed(); } });
    const redoButton = button('Вернуть', () => { commitText(); if (future.length) { past.push(scene); scene = future.pop(); changed(); } });
    const clearButton = button('Очистить', () => { commitText(); if (scene.length) commit([]); });
    const closeButton = button('Закрыть', () => close());
    const insertButton = button(existing ? 'Сохранить' : 'Вставить', () => insert(), 'on');
    bar.append(...toolButtons, sep(), ...swatches, sep(), ...widths, sep(), undoButton, redoButton, clearButton, grow, closeButton, insertButton);

    const dirty = () => scene !== saved && JSON.stringify(scene) !== JSON.stringify(saved);
    function sync() {
        for (const b of toolButtons) b.classList.toggle('on', b.dataset.tool === tool);
        for (const b of swatches) b.classList.toggle('on', b.dataset.color === color);
        for (const b of widths) b.classList.toggle('on', Number(b.dataset.width) === width);
        canvas.style.cursor = tool === 'erase' ? 'cell' : tool === 'text' ? 'text' : 'crosshair';
        undoButton.disabled = !past.length;
        redoButton.disabled = !future.length;
        clearButton.disabled = !scene.length;
    }
    function drawBase() {
        base.clearRect(0, 0, W, H);
        for (const el of scene) paint(base, el);
    }
    // Only the stroke in progress is repainted while drawing, on its own layer: long drawings stay smooth.
    function drawLive() {
        frame = 0;
        live.clearRect(0, 0, W, H);
        if (draft && !draft.erasing) paint(live, draft);
    }
    const queueLive = () => { if (!frame) frame = requestAnimationFrame(drawLive); };
    function changed() {
        drawBase();
        sync();
        // A new drawing survives closing the tab or quitting the app until it is inserted or thrown away.
        if (!existing) fgs.storage.set('draft', scene.length ? scene : null);
    }
    function commit(next) {
        past.push(scene);
        if (past.length > HISTORY) past.shift();
        future = [];
        scene = next;
        changed();
    }
    const point = (event, pressured) => {
        const rect = canvas.getBoundingClientRect();
        const p = [round((event.clientX - rect.left) * W / rect.width), round((event.clientY - rect.top) * H / rect.height)];
        if (pressured) p.push(Math.round((event.pressure || 0.5) * 1000) / 1000);
        return p;
    };

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
        field.style.fontSize = (size * rect.width / W) + 'px';     // the scene is scaled to the paper; so is the field
        field.style.left = (event.clientX - rect.left) + 'px';
        field.style.top = (event.clientY - rect.top) + 'px';
        field.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { field.value = ''; commitText(); } else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); } });
        field.addEventListener('blur', () => setTimeout(() => { if (typing && typing.field === field) commitText(); }, 0));
        paper.append(field);
        typing = { field, x, y, size, color };
        field.focus();          // inside the click, or a phone would not open the keyboard
    }

    // The eraser can jump between two pointer events: everything along the way is checked.
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
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.6) draft.points.push(p);
        else if (pressured) last[2] = Math.max(last[2], p[2]);
    };

    canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0 || activePointer !== null) return;
        if (event.pointerType === 'pen') stylusSeen = true;
        else if (event.pointerType === 'touch' && stylusSeen) return;       // the palm resting on the screen
        if (tool === 'text') return;                                        // placed on click, see below
        commitText();
        activePointer = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
        const pressured = event.pointerType === 'pen';
        const p = point(event, pressured);
        if (tool === 'erase') { draft = { erasing: true, last: p }; eraseAlong(p, p); return; }
        draft = tool === 'pen' ? { type: 'pen', points: [p], color, width, ...(pressured ? { pressure: true } : {}) } : { type: tool, x1: p[0], y1: p[1], x2: p[0], y2: p[1], color, width };
        queueLive();
    });
    canvas.addEventListener('pointermove', event => {
        if (!draft || event.pointerId !== activePointer) return;
        if (draft.erasing) { const p = point(event); eraseAlong(draft.last, p); draft.last = p; return; }
        if (draft.type === 'pen') {
            // A stylus reports far more often than the screen draws; every sample counts for a smooth line.
            const samples = event.getCoalescedEvents ? event.getCoalescedEvents() : [];
            for (const sample of samples.length ? samples : [event]) addSample(sample, !!draft.pressure);
        } else { const p = point(event); draft.x2 = p[0]; draft.y2 = p[1]; }
        queueLive();
    });
    const finish = event => {
        if (event.pointerId !== activePointer) return;
        activePointer = null;
        if (!draft) return;
        const done = draft;
        draft = null;
        if (!done.erasing) {
            const tiny = done.type !== 'pen' && Math.hypot(done.x2 - done.x1, done.y2 - done.y1) < 3;
            if (!tiny) commit([...scene, done]);
        }
        queueLive();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('lostpointercapture', finish);
    canvas.addEventListener('click', event => { if (tool === 'text') startText(point(event), event); });
    // Keep the system out of the way: no page bounce, no text selection loupe, no drawer swiping in from the screen edge.
    // The text tool needs its touch to become a click, so it is let through.
    const hold = event => { event.stopPropagation(); if (tool !== 'text') event.preventDefault(); };
    canvas.addEventListener('touchstart', hold, { passive: false });
    canvas.addEventListener('touchmove', hold, { passive: false });
    canvas.addEventListener('contextmenu', event => event.preventDefault());

    function insert() {
        commitText();
        if (!scene.length) { discard(); return; }
        const markdown = `![${MARK}](data:image/svg+xml;base64,${toBase64(toSvg(scene))})`;
        const home = origin.note && fgs.documents().find(doc => doc.id === origin.note.id);
        if (home) fgs.openDocument(home.id); else tab.backToNote();
        const text = fgs.editor.get();
        const now = existing && drawings(text).find(item => item.data === existing.data);
        if (now) fgs.editor.replace(now.from, now.to, markdown);        // the note may have changed: the picture is looked up again
        else {
            // At the cursor it had when the board opened; if the note has changed since, that offset means nothing, so at the end.
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
    // Closing with unsaved work asks once: the button changes its label for three seconds.
    function close() {
        commitText();
        if (!dirty() || Date.now() < armedClose) { discard(); return; }
        armedClose = Date.now() + 3000;
        closeButton.textContent = 'Точно закрыть?';
        setTimeout(() => { if (Date.now() >= armedClose) closeButton.textContent = 'Закрыть'; }, 3050);
    }
    function dispose() { document.removeEventListener('keydown', onKey, true); cancelAnimationFrame(frame); }
    function onKey(event) {
        if (!back.isConnected || !back.offsetParent || typing) return;      // the tab is behind another one, or text is being typed
        const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey;
        if (key === 'escape') { event.stopPropagation(); close(); }
        else if (mod && !event.shiftKey && key === 'z') { event.preventDefault(); event.stopPropagation(); undoButton.click(); }
        else if (mod && (key === 'y' || (event.shiftKey && key === 'z'))) { event.preventDefault(); event.stopPropagation(); redoButton.click(); }
    }
    document.addEventListener('keydown', onKey, true);
    host.append(back);
    sync();
    drawBase();
    return dispose;
}

// The button edits the picture under the cursor, or starts a new one.
function openFromCursor() {
    const { from, to } = fgs.editor.cursor();
    const under = drawings(fgs.editor.get()).find(item => from >= item.from && to <= item.to);
    openBoard(under || null);
}
fgs.addButton({ title: 'Рисунок (Exildraw)', icon: 'edit', run: openFromCursor });

// In the preview a click on a picture opens it for editing.
fgs.onPreview(preview => {
    preview.querySelectorAll(`img[alt="${MARK}"]`).forEach((img, index) => {
        img.style.cursor = 'pointer';
        img.title = 'Нажмите, чтобы изменить рисунок';
        img.onclick = () => { const item = drawings(fgs.editor.get())[index]; if (item) openBoard(item); };
    });
});
