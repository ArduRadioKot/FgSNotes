// Draws one frame into the alternate screen. Styles follow the terminal theme: accent is only the active tab and the cursor.
const ESC = '\x1b[';
const reset = ESC + '0m';
const dim = ESC + '2m';
const bold = ESC + '1m';
const reverse = ESC + '7m';
const accent = ESC + '36m';
const findMark = ESC + '4m' + accent;
const { pixel, captionAt } = require('./mascot');

function fit(text, width) {
    const out = Array.from(text || '');
    if (out.length > width) return out.slice(0, width);
    while (out.length < width) out.push(' ');
    return out;
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
    const chars = fit(row.text, room);
    const cells = Array.from(gutter).map(ch => ({ ch, style: dim }));
    chars.forEach((ch, index) => {
        let style = styleAt(row, index);
        let drawn = ch;
        const empty = ch === ' ' && row.cursor !== index && !covers(row.sel, index) && !(row.marks || []).some(mark => covers(mark, index));
        if (empty && art && row.kind !== 'rule' && row.kind !== 'menu') {
            const spot = pixel(art.row, index, art.rows, room, art.light) || (art.caption ? { ch: captionAt(art.row, index, art.rows, room, art.caption), style: dim } : null);
            if (spot && spot.ch) { drawn = spot.ch; style = spot.style || dim; }
        }
        if (covers(row.sel, index)) style = reverse;
        if ((row.marks || []).some(mark => covers(mark, index))) style = findMark;
        if (row.cursor === index) style = reverse + bold;
        cells.push({ ch: drawn, style });
    });
    return paintCells(cells);
}

function covers(span, index) {
    return !!span && index >= span[0] && index < span[1];
}

function tabLine(frame, width) {
    const cells = [];
    frame.tabs.forEach((tab, index) => {
    const label = ' ' + (tab.pinned ? '^ ' : '') + tab.title + (tab.dirty ? '*' : '') + ' ';
        for (const ch of label) cells.push({ ch, style: tab.active ? bold + accent : dim });
        if (index < frame.tabs.length - 1) cells.push({ ch: ' ', style: '' });
    });
    const count = ` ${frame.tabs.filter(tab => tab.active).length ? frame.tabs.findIndex(tab => tab.active) + 1 : 1}/${frame.tabs.length} `;
    while (cells.length < width - count.length) cells.push({ ch: ' ', style: '' });
    if (cells.length > width - count.length) cells.length = Math.max(0, width - count.length);
    for (const ch of count) cells.push({ ch, style: dim });
    return paintCells(cells.slice(0, width));
}

function paintSideLine(line, width) {
    const mark = line && line.mark ? line.mark : '';
    const caret = !!(line && line.caret);
    const room = Math.max(0, width - (mark ? 1 : 0) - (caret ? 1 : 0));
    const chars = fit(line && line.text, room);
    let style = dim;
    if (line && line.kind === 'head') style = dim + bold;
    else if (line && line.kind === 'user') style = bold;
    else if (line && line.kind === 'err') style = accent;
    else if (line && line.cursor) style = reverse;
    else if (line && line.active) style = bold;
    const cells = chars.map(ch => ({ ch, style }));
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
        lines.push(paintCells(fit(text, Math.max(0, cols - count.length)).map(ch => ({ ch, style: '' })).concat(Array.from(count).map(ch => ({ ch, style: dim })))));
    }
    const art = frame.mascot ? { rows: frame.rows.length, caption: frame.caption || '', light: !!frame.caption } : null;
    for (let i = 0; i < frame.rows.length; i++) {
        let editor = paintRow(frame.rows[i], editorW, art && { ...art, row: i });
        if (frame.split) editor += dim + '\u2502' + reset + paintRow(frame.split.rows[i] || { text: '' }, frame.split.width, null);
        if (frame.side) editor = joinSide(editor, frame.side, i);
        if (frame.chat) editor = joinSide(editor, frame.chat, i);
        lines.push(editor);
    }
    if (frame.prompt) lines.push(paintCells(fit(frame.prompt.label + frame.prompt.value, cols).map((ch, index) => ({ ch, style: index === (frame.prompt.label + frame.prompt.value).length ? reverse : '' }))));
    const status = (frame.status || '').slice(0, cols);
    const mood = frame.face ? ' ' + frame.face : '';
    const hintFull = (frame.hint || '').slice(0, Math.max(0, cols - status.length - mood.length - 2));
    const hint = cols - status.length - mood.length > 12 ? hintFull : '';
    const gap = Math.max(0, cols - status.length - mood.length - hint.length);
    lines.push(paintCells(
        fit(status, status.length).map(ch => ({ ch, style: dim }))
            .concat(fit('', gap).map(ch => ({ ch, style: '' })))
            .concat(Array.from(hint).map(ch => ({ ch, style: dim })))
            .concat(Array.from(mood).map(ch => ({ ch, style: accent })))
    ));
    while (lines.length < height) lines.push(paintCells(fit('', cols).map(ch => ({ ch, style: '' }))));
    return ESC + '?25l' + ESC + 'H' + lines.slice(0, height).map(line => line + ESC + 'K').join(ESC + 'B\r' + ESC + '1G');
}

const enter = ESC + '?1049h' + ESC + '?2004h' + ESC + '?25l' + ESC + 'H';
const leave = ESC + '?2004l' + ESC + '?25h' + ESC + '?1049l';

module.exports = { paint, enter, leave };
