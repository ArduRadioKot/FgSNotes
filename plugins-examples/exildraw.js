// ==FgsPlugin==
// @name        Exildraw
// @version     1.0
// @description Доска для набросков в духе Excalidraw: перо, линии, стрелки, фигуры, текст. Рисунок вставляется в заметку как SVG и открывается для правки по клику.
// @author      FgSNotes
// ==/FgsPlugin==
//
// Кнопка «Рисунок» в панели форматирования открывает доску. «Вставить» кладёт в заметку картинку вида ![exildraw](data:image/svg+xml;base64,…).
// Сама сцена хранится внутри SVG, поэтому рисунок можно открыть и поправить: поставьте курсор на строку с картинкой и нажмите кнопку
// или щёлкните по рисунку в предпросмотре. Работает без интернета и без сторонних библиотек.

const MARK = 'exildraw';
const COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5'];
const WIDTHS = [2, 4, 7];
const TOOLS = [
    ['pen', 'Перо'], ['line', 'Линия'], ['arrow', 'Стрелка'], ['rect', 'Прямоугольник'],
    ['ellipse', 'Эллипс'], ['text', 'Текст'], ['erase', 'Ластик']
];
const W = 1000, H = 640;
const FONT = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';

fgs.addStyle(`
.exd-back { position: fixed; inset: 0; z-index: 9000; display: grid; place-items: center; padding: 16px; background: rgba(0, 0, 0, .55); }
.exd-box { display: flex; flex-direction: column; gap: 10px; width: min(1040px, 100%); max-height: 100%; padding: 12px; border-radius: 14px; background: var(--card-bg, #27282c); color: var(--text-color, #eee); }
.exd-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.exd-bar .exd-sep { width: 1px; height: 22px; margin: 0 4px; background: var(--border-color, #444); }
.exd-bar button { height: 32px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
.exd-bar button:hover { background: rgba(128, 128, 128, .22); }
.exd-bar button.on { background: var(--accent-color, #21aabe); color: var(--accent-text, #fff); }
.exd-bar button.exd-sw { width: 24px; height: 24px; padding: 0; border-radius: 50%; border: 2px solid rgba(128, 128, 128, .45); background: var(--c); }
.exd-bar button.exd-sw.on { border-color: var(--text-color, #eee); box-shadow: 0 0 0 2px var(--card-bg, #27282c) inset; }
.exd-bar .exd-wd { width: 32px; padding: 0; display: grid; place-items: center; }
.exd-bar .exd-wd i { display: block; width: 18px; background: currentColor; border-radius: 4px; }
.exd-bar .exd-grow { flex: 1; }
.exd-stage { position: relative; overflow: hidden; border-radius: 10px; background: #fff; touch-action: none; min-height: 0; }
.exd-stage canvas { display: block; width: 100%; height: auto; aspect-ratio: ${W} / ${H}; cursor: crosshair; touch-action: none; }
.exd-text { position: absolute; min-width: 60px; padding: 0; border: 0; outline: 1px dashed #888; background: transparent; font: 24px ${FONT}; }
@media (max-width: 720px) { .exd-bar button { height: 36px; } }
`);

// --- scene -------------------------------------------------------------------------------------------------------------------
const escapeXml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toBase64 = text => btoa(unescape(encodeURIComponent(text)));
const fromBase64 = data => decodeURIComponent(escape(atob(data)));

function bounds(element) {
    if (element.type === 'pen') {
        const xs = element.points.map(p => p[0]), ys = element.points.map(p => p[1]);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    if (element.type === 'text') return [element.x1, element.y1, element.x1 + element.text.length * element.size * 0.62, element.y1 + element.size * 1.2];
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
        const mx = (points[i][0] + points[i + 1][0]) / 2, my = (points[i][1] + points[i + 1][1]) / 2;
        d += `Q${points[i][0]} ${points[i][1]} ${mx} ${my}`;
    }
    const last = points[points.length - 1];
    return d + `L${last[0]} ${last[1]}`;
}

// Draws one element on a canvas context.
function paint(ctx, element) {
    ctx.strokeStyle = ctx.fillStyle = element.color;
    ctx.lineWidth = element.width;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    if (element.type === 'pen') ctx.stroke(new Path2D(penPath(element.points)));
    else if (element.type === 'line' || element.type === 'arrow') {
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
    const live = scene.filter(Boolean);
    const box = live.map(bounds).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const pad = 24;
    const x = Math.floor(box[0] - pad), y = Math.floor(box[1] - pad), w = Math.ceil(box[2] - box[0] + pad * 2), h = Math.ceil(box[3] - box[1] + pad * 2);
    const common = el => `stroke="${el.color}" stroke-width="${el.width}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
    const body = live.map(el => {
        if (el.type === 'pen') return `<path d="${penPath(el.points)}" ${common(el)}/>`;
        if (el.type === 'line') return `<line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" ${common(el)}/>`;
        if (el.type === 'arrow') { const [a, b] = arrowHead(el); return `<path d="M${el.x1} ${el.y1}L${el.x2} ${el.y2}M${el.x2} ${el.y2}L${a[0]} ${a[1]}M${el.x2} ${el.y2}L${b[0]} ${b[1]}" ${common(el)}/>`; }
        if (el.type === 'rect') return `<rect x="${Math.min(el.x1, el.x2)}" y="${Math.min(el.y1, el.y2)}" width="${Math.abs(el.x2 - el.x1)}" height="${Math.abs(el.y2 - el.y1)}" ${common(el)}/>`;
        if (el.type === 'ellipse') return `<ellipse cx="${(el.x1 + el.x2) / 2}" cy="${(el.y1 + el.y2) / 2}" rx="${Math.abs(el.x2 - el.x1) / 2}" ry="${Math.abs(el.y2 - el.y1) / 2}" ${common(el)}/>`;
        const lines = el.text.split('\n').map((line, i) => `<tspan x="${el.x1}" dy="${i ? el.size * 1.2 : 0}">${escapeXml(line)}</tspan>`).join('');
        return `<text x="${el.x1}" y="${el.y1}" dominant-baseline="hanging" font-family='${FONT.replace(/"/g, '&quot;')}' font-size="${el.size}" fill="${el.color}">${lines}</text>`;
    }).join('');
    // The scene itself rides along in <metadata>, which is what makes the picture editable again.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}"><metadata id="${MARK}">${escapeXml(JSON.stringify(live))}</metadata><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>${body}</svg>`;
}
function fromSvg(svg) {
    const match = /<metadata id="exildraw">([\s\S]*?)<\/metadata>/.exec(svg);
    if (!match) return [];
    try { return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')); } catch { return []; }
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
    let scene = existing ? fromSvg(fromBase64(existing.data)) : [];
    let redo = [];
    let tool = 'pen', color = COLORS[0], width = WIDTHS[1];
    let draft = null, typing = null;

    const back = document.createElement('div');
    back.className = 'exd-back';
    back.innerHTML = `<div class="exd-box" role="dialog" aria-label="Рисунок"><div class="exd-bar"></div><div class="exd-stage"><canvas width="${W * 2}" height="${H * 2}"></canvas></div></div>`;
    const bar = back.querySelector('.exd-bar'), stage = back.querySelector('.exd-stage'), canvas = back.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    const button = (label, onClick, className = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = className; b.addEventListener('click', onClick); return b; };
    const toolButtons = TOOLS.map(([id, label]) => { const b = button(label, () => { commitText(); tool = id; sync(); }); b.dataset.tool = id; return b; });
    const swatches = COLORS.map(c => { const b = button('', () => { color = c; sync(); }, 'exd-sw'); b.style.setProperty('--c', c); b.title = c; b.setAttribute('aria-label', 'Цвет ' + c); b.dataset.color = c; return b; });
    const widths = WIDTHS.map(w => { const b = button('', () => { width = w; sync(); }, 'exd-wd'); b.innerHTML = `<i style="height:${w}px"></i>`; b.title = 'Толщина ' + w; b.dataset.width = w; return b; });
    const sep = () => Object.assign(document.createElement('span'), { className: 'exd-sep' });
    const grow = Object.assign(document.createElement('span'), { className: 'exd-grow' });
    const undoButton = button('Отменить', () => { commitText(); const el = scene.pop(); if (el) redo.push(el); draw(); });
    const redoButton = button('Вернуть', () => { const el = redo.pop(); if (el) scene.push(el); draw(); });
    const clearButton = button('Очистить', () => { commitText(); scene = []; redo = []; draw(); });
    const cancelButton = button('Закрыть', () => close());
    const insertButton = button(existing ? 'Сохранить' : 'Вставить', () => insert(), 'on');
    bar.append(...toolButtons, sep(), ...swatches, sep(), ...widths, sep(), undoButton, redoButton, clearButton, grow, cancelButton, insertButton);

    function sync() {
        for (const b of toolButtons) b.classList.toggle('on', b.dataset.tool === tool);
        for (const b of swatches) b.classList.toggle('on', b.dataset.color === color);
        for (const b of widths) b.classList.toggle('on', Number(b.dataset.width) === width);
        canvas.style.cursor = tool === 'erase' ? 'cell' : tool === 'text' ? 'text' : 'crosshair';
    }
    function draw() {
        ctx.clearRect(0, 0, W, H);
        for (const el of scene) paint(ctx, el);
        if (draft) paint(ctx, draft);
    }
    const point = event => {
        const rect = canvas.getBoundingClientRect();
        return [Math.round((event.clientX - rect.left) * W / rect.width), Math.round((event.clientY - rect.top) * H / rect.height)];
    };
    const hit = ([x, y]) => {
        for (let i = scene.length - 1; i >= 0; i--) {
            const [x1, y1, x2, y2] = bounds(scene[i]);
            const slack = scene[i].width / 2 + 8;
            if (x >= x1 - slack && x <= x2 + slack && y >= y1 - slack && y <= y2 + slack) return i;
        }
        return -1;
    };

    function commitText() {
        if (!typing) return;
        const { field, x, y } = typing;
        typing = null;
        const value = field.value.replace(/\s+$/, '');
        field.remove();
        if (value) { scene.push({ type: 'text', x1: x, y1: y, text: value, color, width: 1, size: 12 + width * 3 }); redo = []; draw(); }
    }
    function startText([x, y], event) {
        commitText();
        const field = document.createElement('textarea');
        field.className = 'exd-text';
        field.rows = 1; field.cols = 14;
        field.style.color = color;
        field.style.fontSize = (12 + width * 3) + 'px';
        const rect = canvas.getBoundingClientRect(), box = stage.getBoundingClientRect();
        field.style.left = (event.clientX - box.left) + 'px';
        field.style.top = (event.clientY - box.top) + 'px';
        field.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { field.value = ''; commitText(); } else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); } });
        field.addEventListener('blur', () => setTimeout(commitText, 0));
        stage.append(field);
        typing = { field, x, y: y - 0 };
        setTimeout(() => field.focus(), 0);
    }

    canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const p = point(event);
        if (tool === 'text') { event.preventDefault(); startText(p, event); return; }
        commitText();
        canvas.setPointerCapture(event.pointerId);
        if (tool === 'erase') { const i = hit(p); if (i >= 0) { scene.splice(i, 1); redo = []; draw(); } draft = { erasing: true }; return; }
        draft = tool === 'pen' ? { type: 'pen', points: [p], color, width } : { type: tool, x1: p[0], y1: p[1], x2: p[0], y2: p[1], color, width };
        draw();
    });
    canvas.addEventListener('pointermove', event => {
        if (!draft) return;
        const p = point(event);
        if (draft.erasing) { const i = hit(p); if (i >= 0) { scene.splice(i, 1); draw(); } return; }
        if (draft.type === 'pen') draft.points.push(p);
        else { draft.x2 = p[0]; draft.y2 = p[1]; }
        draw();
    });
    const finish = () => {
        if (!draft) return;
        const done = draft;
        draft = null;
        if (!done.erasing) {
            const tiny = done.type !== 'pen' && Math.hypot(done.x2 - done.x1, done.y2 - done.y1) < 3;
            if (!tiny) { scene.push(done); redo = []; }
        }
        draw();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    function insert() {
        commitText();
        if (!scene.length) { close(); return; }
        const markdown = `![${MARK}](data:image/svg+xml;base64,${toBase64(toSvg(scene))})`;
        if (existing) {
            // the note may have changed while the board was open: look the picture up again
            const now = drawings(fgs.editor.get()).find(item => item.data === existing.data);
            if (now) fgs.editor.replace(now.from, now.to, markdown); else fgs.editor.insert(markdown);
        } else fgs.editor.insert(markdown);
        fgs.notify('Рисунок сохранён в заметке');
        close();
    }
    function close() { document.removeEventListener('keydown', onKey, true); back.remove(); }
    function onKey(event) {
        if (!back.isConnected) return;
        if (event.key === 'Escape' && !typing) { event.stopPropagation(); close(); }
        else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !typing) { event.preventDefault(); event.stopPropagation(); undoButton.click(); }
        else if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z')) && !typing) { event.preventDefault(); event.stopPropagation(); redoButton.click(); }
    }
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', event => { if (event.target === back) close(); });
    document.body.append(back);
    fgs.onUnload(close);
    sync();
    draw();
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
