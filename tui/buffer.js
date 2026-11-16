// A single note as a string plus a cursor. Offsets are JavaScript string indexes.
function createBuffer(text) {
    let value = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let cursor = 0;
    let anchor = 0;
    let goal = 0;
    const undo = [];
    const redo = [];

    const posOf = offset => {
        const cut = value.slice(0, Math.max(0, Math.min(offset, value.length)));
        const lines = cut.split('\n');
        return { line: lines.length - 1, col: lines[lines.length - 1].length };
    };
    const offsetOf = (line, col) => {
        const lines = value.split('\n');
        const at = Math.max(0, Math.min(line, lines.length - 1));
        const column = Math.max(0, Math.min(col, lines[at].length));
        let offset = column;
        for (let i = 0; i < at; i++) offset += lines[i].length + 1;
        return offset;
    };
    const selection = () => cursor === anchor ? null : { from: Math.min(cursor, anchor), to: Math.max(cursor, anchor) };
    const remember = () => {
        undo.push({ value, cursor, anchor });
        if (undo.length > 200) undo.shift();
        redo.length = 0;
    };
    function place(offset, extend, keepGoal) {
        cursor = Math.max(0, Math.min(offset, value.length));
        if (!extend) anchor = cursor;
        if (!keepGoal) goal = posOf(cursor).col;
    }
    function insert(text) {
        const chunk = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (!chunk && !selection()) return;
        remember();
        const sel = selection();
        const from = sel ? sel.from : cursor;
        const to = sel ? sel.to : cursor;
        value = value.slice(0, from) + chunk + value.slice(to);
        place(from + chunk.length, false);
    }
    function remove(backward) {
        const sel = selection();
        if (!sel) {
            if (backward ? cursor === 0 : cursor === value.length) return;
            remember();
            const from = backward ? cursor - 1 : cursor;
            value = value.slice(0, from) + value.slice(from + 1);
            place(from, false);
            return;
        }
        remember();
        value = value.slice(0, sel.from) + value.slice(sel.to);
        place(sel.from, false);
    }
    function wordAt(dir) {
        let i = cursor;
        const space = index => /\s/u.test(value[index] || '');
        if (dir < 0) {
            while (i > 0 && space(i - 1)) i--;
            while (i > 0 && !space(i - 1)) i--;
            return i;
        }
        while (i < value.length && !space(i)) i++;
        while (i < value.length && space(i)) i++;
        return i;
    }
    function move(kind, extend, page) {
        const lines = value.split('\n');
        const { line } = posOf(cursor);
        const go = (li, column) => place(offsetOf(li, column), extend, true);
        if (kind === 'left') return place(cursor - 1, extend);
        if (kind === 'right') return place(cursor + 1, extend);
        if (kind === 'up' || kind === 'down') {
            const next = line + (kind === 'up' ? -1 : 1);
            if (next < 0 || next >= lines.length) return;
            return go(next, goal);
        }
        if (kind === 'home') return place(offsetOf(line, 0), extend);
        if (kind === 'end') return place(offsetOf(line, lines[line].length), extend);
        if (kind === 'docstart') return place(0, extend);
        if (kind === 'docend') return place(value.length, extend);
        if (kind === 'pageup' || kind === 'pagedown') {
            const step = Math.max(1, page || 1);
            const next = Math.max(0, Math.min(lines.length - 1, line + (kind === 'pageup' ? -step : step)));
            return go(next, goal);
        }
        if (kind === 'wordleft' || kind === 'wordright') return place(wordAt(kind === 'wordleft' ? -1 : 1), extend);
    }
    return {
        get text() { return value; },
        get cursor() { return cursor; },
        get anchor() { return anchor; },
        selection,
        insert,
        remove,
        move,
        undo() {
            const prev = undo.pop();
            if (!prev) return;
            redo.push({ value, cursor, anchor });
            ({ value, cursor, anchor } = prev);
            goal = posOf(cursor).col;
        },
        redo() {
            const next = redo.pop();
            if (!next) return;
            undo.push({ value, cursor, anchor });
            ({ value, cursor, anchor } = next);
            goal = posOf(cursor).col;
        },
        selectAll() { anchor = 0; cursor = value.length; goal = posOf(cursor).col; },
        pos: () => posOf(cursor),
        setCursor(offset, extend) { place(offset, !!extend); },
        replaceRange(from, to, text, selFrom, selTo) {
            remember();
            value = value.slice(0, from) + text + value.slice(to);
            anchor = Math.max(0, Math.min(selFrom, value.length));
            cursor = Math.max(0, Math.min(selTo, value.length));
            goal = posOf(cursor).col;
        },
        indentLines(out) {
            const { lines, start } = spanLines();
            const end = spanLines().end;
            remember();
            for (let i = start; i <= end; i++) lines[i] = out ? lines[i].replace(/^(?: {1,4}|\t)/, '') : '    ' + lines[i];
            value = lines.join('\n');
            place(offsetOf(start, 0), false);
        },
        moveLines(dir) {
            const { lines, start, end } = spanLines();
            if (start + dir < 0 || end + dir >= lines.length) return;
            remember();
            const block = lines.splice(start, end - start + 1);
            lines.splice(start + dir, 0, ...block);
            value = lines.join('\n');
            place(offsetOf(start + dir, 0), false);
        },
        gotoLine(n) { place(offsetOf((Number(n) || 1) - 1, 0), false); },
        lineCount: () => value.split('\n').length
    };

    function spanLines() {
        const lines = value.split('\n');
        const from = posOf(Math.min(cursor, anchor));
        const to = posOf(Math.max(cursor, anchor));
        return { lines, start: from.line, end: to.line };
    }
}

module.exports = { createBuffer };
