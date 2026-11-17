const TAB = 4;

// How many terminal columns a character takes: CJK and emoji take two, combining marks and joiners take none.
function charWidth(code) {
    if (code === 0x200d || (code >= 0x300 && code <= 0x36f) || (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0x1f3fb && code <= 0x1f3ff) || (code >= 0xe0020 && code <= 0xe007f)) return 0;
    if (code < 0x1100) return 1;
    if (code <= 0x115f || code === 0x2329 || code === 0x232a
        || (code >= 0x231a && code <= 0x231b) || (code >= 0x23e9 && code <= 0x23ec) || code === 0x23f0 || code === 0x23f3
        || (code >= 0x25fd && code <= 0x25fe) || (code >= 0x2614 && code <= 0x2615) || (code >= 0x2648 && code <= 0x2653)
        || code === 0x267f || code === 0x2693 || code === 0x26a1 || (code >= 0x26aa && code <= 0x26ab) || (code >= 0x26bd && code <= 0x26be)
        || (code >= 0x26c4 && code <= 0x26c5) || code === 0x26ce || code === 0x26d4 || code === 0x26ea || (code >= 0x26f2 && code <= 0x26f3)
        || code === 0x26f5 || code === 0x26fa || code === 0x26fd || code === 0x2705 || (code >= 0x270a && code <= 0x270b) || code === 0x2728
        || code === 0x274c || code === 0x274e || (code >= 0x2753 && code <= 0x2755) || code === 0x2757 || (code >= 0x2795 && code <= 0x2797)
        || code === 0x27b0 || code === 0x27bf || (code >= 0x2b1b && code <= 0x2b1c) || code === 0x2b50 || code === 0x2b55
        || (code >= 0x2e80 && code <= 0x303e) || (code >= 0x3041 && code <= 0x33ff) || (code >= 0x3400 && code <= 0x4dbf)
        || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xa000 && code <= 0xa4cf) || (code >= 0xa960 && code <= 0xa97f)
        || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe10 && code <= 0xfe19)
        || (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6)
        || (code >= 0x1f004 && code <= 0x1f0cf) || code === 0x1f18e || (code >= 0x1f191 && code <= 0x1f19a) || (code >= 0x1f200 && code <= 0x1f251)
        || (code >= 0x1f300 && code <= 0x1f64f) || (code >= 0x1f680 && code <= 0x1f6ff) || (code >= 0x1f7e0 && code <= 0x1f7eb)
        || (code >= 0x1f900 && code <= 0x1f9ff) || (code >= 0x1fa70 && code <= 0x1faff) || (code >= 0x20000 && code <= 0x3fffd)) return 2;
    return 1;
}

function textWidth(text) {
    let width = 0;
    for (const ch of String(text || '')) width += ch === '\t' ? TAB : charWidth(ch.codePointAt(0));
    return width;
}

// The longest start of the text that fits into the given number of columns.
function clipText(text, columns) {
    let width = 0, out = '';
    for (const ch of String(text || '')) {
        const size = charWidth(ch.codePointAt(0));
        if (width + size > columns) break;
        width += size;
        out += ch;
    }
    return out;
}

module.exports = { TAB, charWidth, textWidth, clipText };
