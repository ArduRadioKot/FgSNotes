// Draws one frame into the alternate screen. Text follows the terminal theme; turquoise, the app accent, marks only the frog's face, the active tab and the view badge.
// Every cell is one terminal column: a wide character (CJK, emoji) fills two cells, the second one empty, so panes never spill into each other.
const ESC = '\x1b[';
const reset = ESC + '0m';
const dim = ESC + '2m';
const bold = ESC + '1m';
const reverse = ESC + '7m';
const accent = ESC + '36m';
const turquoise = ESC + '38;5;38m';
const badge = ESC + '1;38;5;16;48;5;38m';
const findMark = ESC + '4m' + accent;
const { pixel } = require('./mascot');
const { TAB, charWidth, textWidth } = require('./width');

// The columns of a piece of text. index is the position in the text (UTF-16), so cursor, selection and colour spans line up.
function columns(text) {
    const out = [];
    let index = 0;
    for (const ch of String(text || '')) {
        const code = ch.codePointAt(0);
        if (ch === '\t') for (let i = 0; i < TAB; i++) out.push({ ch: ' ', index, head: i === 0 });
        else if (code < 0x20 || code === 0x7f) out.push({ ch: '·', index, head: true });
        else {
            const size = charWidth(code);
            if (size === 0) { if (out.length) out[out.length - 1].ch += ch; }
            else {
                out.push({ ch, index, head: true, wide: size === 2 });
                if (size === 2) out.push({ ch: '', index, head: false });
            }
        }
        index += ch.length;
    }
    return { cells: out, end: index };
}

// Exactly width columns: cut what does not fit (never half of a wide character) and pad the rest.
function clip(cells, width, pad) {
    const out = cells.slice(0, Math.max(0, width));
    if (out.length && out[out.length - 1].wide) out[out.length - 1] = { ...out[out.length - 1], ch: ' ', wide: false };
    for (let i = out.length; i < width; i++) out.push(pad ? pad(i - cells.length) : { ch: ' ', style: '' });
    return out;
}

function fit(text, width, style = '') {
    return clip(columns(text).cells.map(cell => ({ ch: cell.ch, wide: cell.wide, style })), width);
}

function paintCells(cells) {
    let out = '';
    let style = '';
    for (const cell of cells) {
        const next = cell.style || '';
        if (next !== style) { out += reset + next; style = next; }
        out += cell.ch;
    }
    return out + reset;
}

function paintRow(row, width, art) {
    const gutter = row.gutter || '';
    const room = Math.max(0, width - gutter.length);
    const { cells: text, end } = columns(row.text);
    const laid = clip(text, room, extra => ({ ch: ' ', index: end + Math.max(0, extra), head: true }));
    const cells = Array.from(gutter).map(ch => ({ ch, style: dim }));
    laid.forEach((cell, column) => {
        const index = cell.index;
        let style = styleAt(row, index);
        let drawn = cell.ch;
        const marked = covers(row.sel, index) || (row.marks || []).some(mark => covers(mark, index));
        const empty = drawn === ' ' && row.cursor !== index && !marked;
        if (empty && art && row.kind !== 'rule' && row.kind !== 'menu') {
            const spot = pixel(art.row, column, art.rows, room, art.welcome);
            if (spot) { drawn = spot.ch; style = spot.style; }
        }
        if (covers(row.sel, index)) style = reverse;
        if ((row.marks || []).some(mark => covers(mark, index))) style = findMark;
        if (row.cursor === index && cell.head) style = reverse + bold;
        cells.push({ ch: drawn, style });
    });
    return paintCells(cells);
}

function covers(span, index) {
    return !!span && index >= span[0] && index < span[1];
}

const push = (cells, text, style) => { for (const cell of columns(text).cells) cells.push({ ch: cell.ch, wide: cell.wide, style }); };

// The frog's face opens the tab bar. The active tab is turquoise and bold, the rest stay quiet.
function tabLine(frame, width) {
    const cells = [];
    if (frame.face && width >= 30) { push(cells, ' ' + frame.face + ' ', bold + turquoise); push(cells, '│', dim); }
    frame.tabs.forEach((tab, index) => {
        if (index) push(cells, '·', dim);
        push(cells, ' ' + (tab.pinned ? '^ ' : '') + tab.title, tab.active ? bold + turquoise : dim);
        push(cells, tab.dirty ? ' •' : '', tab.active ? turquoise : dim);
        push(cells, ' ', '');
    });
    const at = frame.tabs.findIndex(tab => tab.active);
    const count = ` ${at >= 0 ? at + 1 : 1}/${frame.tabs.length} `;
    const out = clip(cells, Math.max(0, width - count.length));
    push(out, count, dim);
    return paintCells(clip(out, width));
}

// Bottom line: the view as a turquoise badge, then the position and file, the keys on the right. A message replaces the details.
function statusLine(frame, width) {
    const cells = [];
    const tag = frame.badge && width >= 40 ? ' ' + frame.badge.toUpperCase() + ' ' : '';
    push(cells, tag, badge);
    if (tag) push(cells, ' ', '');
    const room = Math.max(0, width - cells.length);
    const status = frame.status || '';
    const statusW = Math.min(room, textWidth(status));
    const hint = room - statusW >= textWidth(frame.hint || '') + 2 ? (frame.hint || '') + ' ' : '';
    cells.push(...fit(status, statusW, frame.flash ? bold + turquoise : dim));
    const out = clip(cells, Math.max(0, width - textWidth(hint)));
    push(out, hint, dim);
    return paintCells(clip(out, width));
}

function paintSideLine(line, width) {
    const mark = line && line.mark ? line.mark : '';
    const caret = !!(line && line.caret);
    const room = Math.max(0, width - (mark ? 1 : 0) - (caret ? 1 : 0));
    let style = dim;
    if (line && line.kind === 'head') style = dim + bold;
    else if (line && line.kind === 'user') style = bold;
    else if (line && line.kind === 'err') style = accent;
    else if (line && line.cursor) style = reverse;
    else if (line && line.active) style = bold;
    const cells = fit(line && line.text, room, style);
    if (caret) cells.push({ ch: ' ', style: reverse });
    if (mark) cells.push({ ch: mark, style: line.cursor ? reverse : accent });
    return paintCells(cells);
}

function styleAt(row, index) {
    const spans = row && row.spans;
    if (spans) {
        for (let i = 0; i < spans.length; i++) {
            const span = spans[i];
            if (index >= span.from && index < span.to) return span.style || '';
        }
    }
    if (row && row.kind === 'h') return bold;
    if (row && (row.kind === 'code' || row.kind === 'rule')) return dim;
    return '';
}

function joinSide(editor, side, index) {
    const line = side.lines[index] || { text: '' };
    const bar = dim + '\u2502' + reset;
    const pane = paintSideLine(line, side.width);
    return side.left ? pane + bar + editor : editor + bar + pane;
}

function paint(frame, width, height) {
    const cols = Math.max(1, width);
    const sideW = frame.side ? frame.side.width + 1 : 0;
    const chatW = frame.chat ? frame.chat.width + 1 : 0;
    const splitW = frame.split ? frame.split.width + 1 : 0;
    const editorW = Math.max(1, cols - sideW - chatW - splitW);
    const lines = [tabLine(frame, cols)];
    if (frame.find) {
        const text = `${frame.find.label}: ${frame.find.query}`;
        const count = frame.find.count ? ' ' + frame.find.count : '';
        const cells = fit(text, Math.max(0, cols - count.length));
        push(cells, count, dim);
        lines.push(paintCells(cells));
    }
    const art = frame.welcome ? { rows: frame.rows.length, welcome: frame.welcome } : null;
    for (let i = 0; i < frame.rows.length; i++) {
        let editor = paintRow(frame.rows[i], editorW, art && { ...art, row: i });
        if (frame.split) editor += dim + '\u2502' + reset + paintRow(frame.split.rows[i] || { text: '' }, frame.split.width, null);
        if (frame.side) editor = joinSide(editor, frame.side, i);
        if (frame.chat) editor = joinSide(editor, frame.chat, i);
        lines.push(editor);
    }
    if (frame.prompt) {
        const text = frame.prompt.label + frame.prompt.value;
        const cells = clip(columns(text).cells.map(cell => ({ ch: cell.ch, wide: cell.wide, style: '' })), Math.max(0, cols - 1));
        const caret = Math.min(textWidth(text), cols - 1);
        cells.splice(caret, 0, { ch: ' ', style: reverse });
        lines.push(paintCells(clip(cells, cols)));
    }
    lines.push(statusLine(frame, cols));
    while (lines.length < height) lines.push(paintCells(fit('', cols)));
    return ESC + '?25l' + ESC + 'H' + lines.slice(0, height).map(line => line + ESC + 'K').join(ESC + 'B\r' + ESC + '1G');
}

const enter = ESC + '?1049h' + ESC + '?2004h' + ESC + '?25l' + ESC + 'H';
const leave = ESC + '?2004l' + ESC + '?25h' + ESC + '?1049l';

module.exports = { paint, enter, leave };
