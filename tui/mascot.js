// The app frog. The original picture greets an empty note, packed into half blocks; once there is text, only its face stays, in the tab bar.
const RAW = [
    '                      __ggggggx_              _agggggg__',
    '                    _g@@@@@@@@@@@y          a@@@@@@@@@@@b_',
    '                   a@@$~_ag  "4@@@@ggg$gggg@@@@F` ygy_?@@@L',
    '                  j@@$ a@@@    `@@@@@@@@@@@@@@`   4@@@L`@@@',
    '                  1@@% `~~      @@@@@@@@@@@@@%     `~~  B@@/',
    '                  `@@@         _@@@@@@@@@@@@@@,        _@@@',
    '                   ~@@@y_   __g@@@@@@@@@@@@@@@@g_    _a@@@\'',
    '                 _$@@@@@@@@@@@@@@@@$_Z@@L_@@@@@@@@@@@@@@@@@g_',
    '                j@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
    '                1@~ ``     ~@@@y@@@`      `@@@@@@@```      "@L',
    '                1@@gggggggg@@@@@@@@$gggggg@@@@@@@@@ggggg$$g@@L',
    '                1@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
    '      __________j@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@___________',
    '    a@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@y',
    '   4RRR@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@RRRR\\',
    '        @@@@@@@@@@~   $@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@$   J@@@@@@@@@@',
    '        ~~~~~TTT~T    7@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@^   ~~~~~~~~~~`',
    '                       4@@@@@@@E~~F@@@@@@@@~~~@@@@@@@@[y_',
    '             ~^     ^" 4@@@@@@@%   $@@@@@@$   @@@@@@@@  ~',
    '                       4@@@@PR@%   ~~~~~~~    @@R@@@@@',
    '                       4@@@`  `%              @   7@@@',
    '         ______        4@@@@gg@$_____    _____@ggg@@@@[       _______',
    '        g@@@@@@@       4@@@@@@@@@@@@@    @@@@@@@@@@@@@[      j@@@@@@@i',
    '        ~@@R~@@P       $@@@@@@@@@~~~^    ~~~D@@@@@@@@@[       R@P~@@P^',
    '                       $@@@`  @@@@         J@@@$  4@@@[',
    '                       `=P=   ~4RF          ?P=\'  `=PF'
];
const width = Math.max(...RAW.map(line => line.length));
const FROG = RAW.map(line => line.padEnd(width));

// The colour of each cell of the picture, as an index into PALETTE.
const PALETTE = ['16', '230', '156', '71', '22', '24', '80'];
const TINT = [
    '                      2222222223              2222222222                   ',
    '                    22222222222222          22222222222223                 ',
    '                   22031110  02222222222222222000 111042223                ',
    '                  2200 1300    2222222222222200   011403222                ',
    '                  2240 000      22222222222220     000  2222               ',
    '                  2222         2222222222222222        2222                ',
    '                   222222   222222202223422222222    222222                ',
    '                 22222222222222222222222222222222222222222222              ',
    '                300000000011111113000000001111111000000000022              ',
    '                222 22     111111111      11111111111      223             ',
    '                2222221111111111111111111111111111111122222223             ',
    '                222222111111111111111111111111111111112222222              ',
    '      222222222222222211111111111111111111111111111111222222222222222222   ',
    '    2222222222222222221111111111111111111111111111111122222222222222222222 ',
    '   555222222222266666222222221111111111111111122222222266662222222222255555',
    '        22222222266   2222222211111111111111122222222226   22222222225     ',
    '        5556666666    2222222221111111111111122222222266   66666655555     ',
    '                       2222222355511111111555222222222566                  ',
    '             55     55 222222235   11111115   22222222  5                  ',
    '                       222355225   5555555    25522222                     ',
    '                       22255  25              5   2222                     ',
    '         555555        22222222222355    22222222222225       5555555      ',
    '        22222255       22222222222222    22222222222222      222222222     ',
    '        22222255       22222222222222    22322222222221       22222222     ',
    '                       22222  2223         22222  22221                    ',
    '                       2223   2222          2221  2222                     '
].map(line => line.padEnd(width));

const ACCENT = '\x1b[1;38;5;38m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function face(view, dirty) {
    if (view === 'preview') return '(-.-)';
    if (view === 'split') return '(o.O)';
    return dirty ? '(O.O)' : '(o.o)';
}

// A letter of the picture is one cell wide and two pixels tall. Each pixel of the smaller picture takes the colour most of its source pixels have.
function shrink(cols) {
    const srcW = width;
    const srcH = FROG.length * 2;
    const rows = Math.max(2, Math.round(srcH * cols / srcW / 2) * 2);
    const grid = [];
    for (let y = 0; y < rows; y++) {
        const line = [];
        const y0 = Math.floor(y * srcH / rows), y1 = Math.max(y0 + 1, Math.floor((y + 1) * srcH / rows));
        for (let x = 0; x < cols; x++) {
            const x0 = Math.floor(x * srcW / cols), x1 = Math.max(x0 + 1, Math.floor((x + 1) * srcW / cols));
            const votes = new Map();
            let filled = 0, total = 0;
            for (let sy = y0; sy < y1; sy++) {
                for (let sx = x0; sx < x1; sx++) {
                    total++;
                    const tone = TINT[sy >> 1][sx];
                    if (FROG[sy >> 1][sx] === ' ' || tone === ' ') continue;
                    filled++;
                    votes.set(tone, (votes.get(tone) || 0) + 1);
                }
            }
            line.push(filled * 2.5 >= total ? [...votes].sort((a, b) => b[1] - a[1])[0][0] : null);
        }
        grid.push(line);
    }
    const out = [];
    for (let y = 0; y < rows; y += 2) {
        out.push(grid[y].map((top, x) => {
            const bottom = grid[y + 1][x];
            if (top === null && bottom === null) return { ch: ' ', style: '' };
            if (bottom === null) return { ch: '▀', style: `\x1b[38;5;${PALETTE[top]}m` };
            if (top === null) return { ch: '▄', style: `\x1b[38;5;${PALETTE[bottom]}m` };
            if (top === bottom) return { ch: '█', style: `\x1b[38;5;${PALETTE[top]}m` };
            return { ch: '▀', style: `\x1b[38;5;${PALETTE[top]};48;5;${PALETTE[bottom]}m` };
        }));
    }
    while (out.length && out[out.length - 1].every(cell => cell.ch === ' ')) out.pop();
    return out;
}

const cells = (text, style) => Array.from(text).map(ch => ({ ch, style: ch === ' ' ? '' : style }));

// The welcome card: the frog, the question, and a few keys to start with. The frog shrinks to the room left; the keys go first when space runs out.
function card(welcome, rows, cols) {
    const caption = [cells(welcome.caption || '', BOLD)];
    const keyW = Math.max(0, ...(welcome.hints || []).map(([key]) => key.length));
    const keys = (welcome.hints || []).map(([key, label]) => cells(key.padEnd(keyW + 2), ACCENT).concat(cells(label, DIM)));
    const keysW = Math.max(0, ...keys.map(line => line.length));
    const hints = keys.map(line => line.concat(cells(' '.repeat(keysW - line.length), '')));
    const room = rows - 1;
    const stack = (...parts) => {
        const lines = [];
        parts.filter(part => part.length).forEach((part, index) => { if (index) lines.push([]); lines.push(...part); });
        return lines;
    };
    const tail = [caption, hints].filter(part => part.length && part[0].length);
    for (const parts of [tail, tail.slice(0, 1)]) {
        const used = stack(...parts).length + 1;
        for (let w = Math.min(36, cols - 4); w >= 18; w -= 2) {
            const frog = shrink(w);
            if (frog.length + used <= room) return stack(frog, ...parts);
        }
    }
    const fallback = stack(...tail);
    return fallback.length <= room ? fallback : stack(caption);
}

let cached = null;

function layoutCard(welcome, rows, cols) {
    const key = JSON.stringify([welcome, rows, cols]);
    if (cached && cached.key === key) return cached;
    const lines = card(welcome, rows, cols);
    const top = Math.max(0, Math.floor((rows - lines.length) * 0.42));
    cached = { key, top, lines: lines.map(line => ({ left: Math.floor((cols - line.length) / 2), line })) };
    return cached;
}

function pixel(row, col, rows, cols, welcome) {
    if (!welcome) return null;
    const art = layoutCard(welcome, rows, cols);
    const entry = art.lines[row - art.top];
    if (!entry) return null;
    const cell = entry.line[col - entry.left];
    return cell && cell.ch !== ' ' ? cell : null;
}

module.exports = { FROG, face, pixel, shrink };
