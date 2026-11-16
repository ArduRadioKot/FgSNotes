// The app frog, drawn with the ASCII picture behind empty cells of a note.
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

// Full mascot colours for an empty note, and the same hues pushed down once text is on screen.
const BRIGHT = ['16', '230', '156', '71', '22', '24', '80'];
const TONE = ['16', '58', '22', '22', '232', '17', '23'];
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

function face(view, dirty) {
    if (view === 'preview') return '(-.-)';
    if (view === 'split') return '(o.O)';
    return dirty ? '(O.O)' : '(o.o)';
}

// Fit the picture into the free cells: smaller windows squeeze it, larger ones stretch it.
function fitBox(rows, cols) {
    const srcW = FROG[0].length;
    const srcH = FROG.length;
    const padX = cols > 10 ? 1 : 0;
    const padY = rows > 10 ? 2 : 0;
    const availW = Math.max(1, cols - padX * 2);
    const availH = Math.max(1, rows - padY);
    const scale = Math.min(availW / srcW, availH / srcH);
    const destW = Math.max(1, Math.min(availW, Math.round(srcW * scale)));
    const destH = Math.max(1, Math.min(availH, Math.round(srcH * scale)));
    return {
        top: Math.max(0, Math.floor((rows - destH - (padY ? 1 : 0)) / 2)),
        left: Math.max(0, Math.floor((cols - destW) / 2)),
        destW,
        destH,
        srcW,
        srcH
    };
}

function sample(box, y, x) {
    const y0 = Math.floor(y * box.srcH / box.destH);
    const y1 = Math.min(box.srcH, Math.max(y0 + 1, Math.floor((y + 1) * box.srcH / box.destH)));
    const x0 = Math.floor(x * box.srcW / box.destW);
    const x1 = Math.min(box.srcW, Math.max(x0 + 1, Math.floor((x + 1) * box.srcW / box.destW)));
    const counts = new Map();
    const tones = new Map();
    let best = ' ';
    let tone = ' ';
    let score = 0;
    let toneScore = 0;
    for (let sy = y0; sy < y1; sy++) {
        const line = FROG[sy];
        const paint = TINT[sy];
        for (let sx = x0; sx < x1; sx++) {
            const ch = line[sx];
            if (!ch || ch === ' ') continue;
            const next = (counts.get(ch) || 0) + 1;
            counts.set(ch, next);
            if (next > score) { score = next; best = ch; }
            const shade = paint[sx] || ' ';
            if (shade === ' ') continue;
            const seen = (tones.get(shade) || 0) + 1;
            tones.set(shade, seen);
            if (seen > toneScore) { toneScore = seen; tone = shade; }
        }
    }
    return { ch: best, tone };
}

let cached = null;

function scaled(rows, cols) {
    if (cached && cached.rows === rows && cached.cols === cols) return cached;
    const box = fitBox(rows, cols);
    const cells = [];
    const tones = [];
    for (let y = 0; y < box.destH; y++) {
        let line = '';
        let shade = '';
        for (let x = 0; x < box.destW; x++) {
            const spot = sample(box, y, x);
            line += spot.ch;
            shade += spot.tone;
        }
        cells.push(line);
        tones.push(shade);
    }
    cached = { rows, cols, box, cells, tones };
    return cached;
}

function pixel(row, col, rows, cols, light) {
    const art = scaled(rows, cols);
    const y = row - art.box.top;
    const x = col - art.box.left;
    if (y < 0 || x < 0 || y >= art.box.destH || x >= art.box.destW) return null;
    const ch = art.cells[y][x];
    const tone = art.tones[y][x];
    if (!ch || ch === ' ' || tone === ' ') return null;
    const palette = light ? BRIGHT : TONE;
    return { ch, style: (light ? '\x1b[38;5;' : '\x1b[2;38;5;') + palette[tone] + 'm' };
}

function captionAt(row, col, rows, cols, caption) {
    const text = Array.from(caption || '');
    if (!text.length) return null;
    const art = scaled(rows, cols);
    if (row !== art.box.top + art.box.destH + 1) return null;
    const left = Math.max(0, Math.floor((cols - text.length) / 2));
    const x = col - left;
    if (x < 0 || x >= text.length) return null;
    return text[x];
}

module.exports = { FROG, face, pixel, captionAt };
