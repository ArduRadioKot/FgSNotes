// Bytes from a raw terminal become key names. Incomplete escape sequences wait until more input or flush().
function charKey(ch) {
    if (ch === '\r' || ch === '\n') return { name: 'enter' };
    if (ch === '\t') return { name: 'tab' };
    if (ch === '\x7f' || ch === '\b') return { name: 'backspace' };
    const code = ch.charCodeAt(0);
    if (code >= 1 && code <= 26) return { name: String.fromCharCode(96 + code), ctrl: true };
    return { name: ch, text: ch };
}

function modifiers(param) {
    const parts = param ? param.split(';') : [];
    const mod = Number(parts[1] || 1);
    return {
        code: Number(parts[0] || 0),
        shift: mod === 2 || mod === 4 || mod === 6,
        alt: mod === 3 || mod === 4 || mod === 7 || mod === 8,
        ctrl: mod >= 5 && mod <= 8
    };
}

function fromCode(code, mod) {
    const letter = code >= 97 && code <= 122 ? String.fromCharCode(code) : code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : '';
    const named = { 13: 'enter', 9: 'tab', 27: 'escape', 8: 'backspace', 127: 'backspace', 32: 'space' };
    const name = letter || named[code];
    if (!name) return { name: 'unknown' };
    const key = { name };
    if (letter) key.text = letter;
    const flags = modifiers(String(code) + ';' + (mod || 1));
    if (flags.shift) key.shift = true;
    if (flags.alt) key.alt = true;
    if (flags.ctrl) key.ctrl = true;
    return key;
}

function csiKey(param, final) {
    const parts = param ? param.split(';') : [];
    // Kitty and fixterms: CSI code ; modifier u. xterm modifyOtherKeys: CSI 27 ; modifier ; code ~
    if (final === 'u') return fromCode(Number(parts[0]), Number(parts[1] || 1));
    if (final === '~' && parts[0] === '27' && parts.length >= 3) return fromCode(Number(parts[2]), Number(parts[1] || 1));
    const mod = modifiers(param);
    const arrows = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end', Z: 'tab' };
    const key = { name: arrows[final] || 'unknown' };
    if (arrows[final]) key.name = arrows[final];
    else if (final === '~') {
        const named = { 1: 'home', 2: 'insert', 3: 'delete', 4: 'end', 5: 'pageup', 6: 'pagedown', 11: 'f1', 12: 'f2', 13: 'f3', 14: 'f4', 17: 'f6' };
        key.name = named[mod.code] || 'unknown';
    }
    if (final === 'Z' || mod.shift) key.shift = true;
    if (mod.ctrl) key.ctrl = true;
    if (mod.alt) key.alt = true;
    return key;
}

function ss3Key(final) {
    const named = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end', P: 'f1', Q: 'f2', R: 'f3', S: 'f4' };
    return { name: named[final] || 'unknown' };
}

// One complete key from the front of buf, or null when an escape sequence is still arriving.
function take(buf) {
    if (!buf) return null;
    if (buf.startsWith('\x1b[200~')) {
        const end = buf.indexOf('\x1b[201~', 6);
        if (end < 0) return null;
        return { n: end + 6, key: { name: 'paste', text: buf.slice(6, end) } };
    }
    if (buf.startsWith('\x1b[')) {
        const csi = /^\x1b\[([0-9;]*)([@A-Za-z~])/.exec(buf);
        if (!csi) return null;
        return { n: csi[0].length, key: csiKey(csi[1], csi[2]) };
    }
    if (buf.startsWith('\x1bO')) {
        const ss3 = /^\x1bO([A-Za-z])/.exec(buf);
        if (!ss3) return null;
        return { n: ss3[0].length, key: ss3Key(ss3[1]) };
    }
    if (buf[0] === '\x1b') {
        if (buf.length < 2) return null;
        return { n: 2, key: { ...charKey(buf[1]), alt: true } };
    }
    return { n: 1, key: charKey(buf[0]) };
}

function createParser() {
    let buf = '';
    return {
        push(text, emit) {
            buf += text;
            let next = take(buf);
            while (next) {
                buf = buf.slice(next.n);
                if (next.key.name !== 'unknown') emit(next.key);
                next = buf ? take(buf) : null;
            }
        },
        flush(emit) {
            if (!buf) return;
            if (buf[0] === '\x1b') {
                buf = buf.slice(1);
                emit({ name: 'escape' });
            }
            this.push('', emit);
        }
    };
}

module.exports = { createParser, take };
