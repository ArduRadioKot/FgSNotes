const { searchText } = require('../src/find');
const { highlightedLines } = require('./syntax');
const { previewText, previewRows, linkScroll } = require('./preview');
const { textWidth: textColumns } = require('./width');

function lineStarts(text) {
    const lines = text.split('\n');
    const starts = [0];
    for (let i = 0; i < lines.length - 1; i++) starts.push(starts[i] + lines[i].length + 1);
    return { lines, starts };
}

// Rows of the source that fit the editor pane. scroll is updated so the cursor stays visible.
function sourceRows(buffer, width, height, scroll, ranges) {
    const { lines, starts } = lineStarts(buffer.text);
    const { line, col } = buffer.pos();
    const gutter = Math.max(2, String(lines.length).length);
    const textWidth = Math.max(1, width - gutter - 1);
    let top = scroll.top || 0;
    let left = scroll.left || 0;
    if (line < top) top = line;
    if (line >= top + height) top = line - height + 1;
    const current = lines[line] || '';
    if (col < left) left = col;
    const caret = col < current.length ? textColumns(String.fromCodePoint(current.codePointAt(col))) : 1;
    while (left < col && textColumns(current.slice(left, col)) + caret > textWidth) left += current.codePointAt(left) > 0xffff ? 2 : 1;
    scroll.top = top;
    scroll.left = left;
    const sel = buffer.selection();
    const visuals = highlightedLines(buffer.text);
    const rows = [];
    for (let i = 0; i < height; i++) {
        const index = top + i;
        const exists = index < lines.length;
        const raw = exists ? lines[index] : '';
        // A row past the note has no offset. Using 0 would paint the selection on every blank line.
        const from = (exists ? starts[index] : buffer.text.length + 1) + left;
        const to = from + textWidth;
        const look = exists ? visuals[index] : null;
        rows.push({
            gutter: (exists ? String(index + 1).padStart(gutter) : ''.padStart(gutter)) + ' ',
            text: raw.slice(left, left + textWidth),
            cursor: index === line ? col - left : -1,
            sel: exists ? overlap(sel, from, to) : null,
            marks: exists ? (ranges || []).map(range => overlap(range, from, to)).filter(Boolean) : [],
            spans: look && look.text === raw ? sliceSpans(look.spans, left, left + textWidth) : [],
            kind: ''
        });
    }
    return rows;
}

function overlap(range, from, to) {
    if (!range || range.to <= from || range.from >= to) return null;
    return [Math.max(0, range.from - from), Math.min(to, range.to) - from];
}

function sliceSpans(spans, left, right) {
    const out = [];
    for (const span of spans || []) {
        const from = Math.max(span.from, left);
        const to = Math.min(span.to, right);
        if (to > from) out.push({ from: from - left, to: to - left, style: span.style });
    }
    return out;
}

function words(text) {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

module.exports = { sourceRows, previewText, previewRows, linkScroll, words, searchText };
