const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBuffer } = require('../tui/buffer');
const { createParser } = require('../tui/keys');
const { previewText } = require('../tui/text');
const { createApp } = require('../tui/app');
const { createI18n } = require('../tui/i18n');
const { paint } = require('../tui/paint');
const { pixel } = require('../tui/mascot');

function keysOf(text) {
    const out = [];
    const parser = createParser();
    parser.push(text, key => out.push(key));
    parser.flush(key => out.push(key));
    return out;
}

test('keys: letters, shortcuts, arrows and pasted text', () => {
    assert.deepEqual(keysOf('й'), [{ name: 'й', text: 'й' }]);
    assert.deepEqual(keysOf('\x13'), [{ name: 's', ctrl: true }]);
    assert.deepEqual(keysOf('\x1b[A'), [{ name: 'up' }]);
    assert.deepEqual(keysOf('\x1b[1;5D'), [{ name: 'left', ctrl: true }]);
    assert.deepEqual(keysOf('\x1b[3~'), [{ name: 'delete' }]);
    assert.deepEqual(keysOf('\x1b[200~hello\n\x1b[201~'), [{ name: 'paste', text: 'hello\n' }]);
    assert.deepEqual(keysOf('\x1b'), [{ name: 'escape' }]);
    assert.deepEqual(keysOf('\x1b[106;3u'), [{ name: 'j', text: 'j', alt: true }]);
    assert.deepEqual(keysOf('\x1b[27;3;106~'), [{ name: 'j', text: 'j', alt: true }]);
    assert.deepEqual(keysOf('\x1b[17~'), [{ name: 'f6' }]);
});

test('buffer: typing, a remembered column, selection and undo', () => {
    const buffer = createBuffer('');
    buffer.insert('abcde\nhi');
    buffer.move('up');
    assert.deepEqual(buffer.pos(), { line: 0, col: 2 });
    buffer.move('down');
    assert.deepEqual(buffer.pos(), { line: 1, col: 2 });
    buffer.move('docstart');
    buffer.move('right', true);
    buffer.insert('X');
    assert.equal(buffer.text, 'Xbcde\nhi');
    buffer.undo();
    assert.equal(buffer.text, 'abcde\nhi');
    buffer.move('docstart');
    buffer.move('wordright');
    assert.equal(buffer.cursor, 6);
});

test('preview drops marks but keeps the words', () => {
    const lines = previewText('# Hello\n\nSee [FgSNotes](https://example.com) and **bold**.');
    assert.equal(lines[0].text, 'Hello');
    assert.equal(lines[0].kind, 'h');
    assert.equal(lines[2].text, 'See FgSNotes and bold.');
    const wrapped = previewText('one two three four', 10);
    assert.ok(wrapped.length > 1);
    assert.ok(wrapped.every(line => line.text.length <= 10));
    assert.equal(wrapped.map(line => line.text).join(' '), 'one two three four');
    const table = previewText('| A | B |\n| --- | --- |\n| **yes** | no |', 40);
    const grid = table.map(line => line.text).join('\n');
    assert.match(grid, /A/);
    assert.match(grid, /B/);
    assert.match(grid, /yes/);
    assert.match(grid, /no/);
    assert.match(grid, /│/);
    const yes = table.find(line => line.text.includes('yes'));
    assert.ok(yes.spans.some(span => span.style === '\x1b[1m' || span.style.startsWith('\x1b[1;')));
    const code = previewText('```js\nconst a = "hi"\n```', 40);
    const statement = code.find(line => line.text.includes('const'));
    assert.ok(statement);
    assert.ok(statement.spans.some(span => span.style.includes('38;5;173')));
    assert.ok(statement.spans.some(span => span.style.includes('38;5;108')));
    const tasks = previewText('- [x] Done\n- [ ] Later', 40).map(line => line.text).join('\n');
    assert.match(tasks, /☑ Done/);
    assert.match(tasks, /☐ Later/);
    const quote = previewText('> noted', 40);
    assert.ok(quote.some(line => line.text.includes('│') && line.text.includes('noted')));
});

test('split scrolls the preview with the source', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fgs-tui-'));
    const file = path.join(dir, 'long.md');
    const lines = ['START'];
    for (let i = 0; i < 80; i++) lines.push('line ' + i);
    lines.push('END');
    fs.writeFileSync(file, lines.join('\n'));
    const app = createApp({ lang: 'ru', files: [file] });
    app.press({ name: 'f2' });
    const top = app.layout(80, 24);
    assert.match(top.split.rows.map(row => row.text).join('\n'), /START/);
    assert.doesNotMatch(top.split.rows.map(row => row.text).join('\n'), /END/);
    app.press({ name: 'end', ctrl: true });
    const bottom = app.layout(80, 24);
    assert.match(bottom.rows.map(row => row.text).join('\n'), /END/);
    assert.match(bottom.split.rows.map(row => row.text).join('\n'), /END/);
    assert.doesNotMatch(bottom.split.rows.map(row => row.text).join('\n'), /START/);
    app.press({ name: 'home', ctrl: true });
    const back = app.layout(80, 24);
    assert.match(back.split.rows.map(row => row.text).join('\n'), /START/);
    assert.doesNotMatch(back.split.rows.map(row => row.text).join('\n'), /END/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('editor opens a file, finds a word, saves and asks before quitting', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fgs-tui-'));
    const file = path.join(dir, 'note.md');
    fs.writeFileSync(file, '# Hello\n');
    const app = createApp({ lang: 'ru', files: [file] });
    const first = app.layout(80, 24);
    assert.equal(first.tabs[0].title, 'note.md');
    assert.equal(first.tabs[0].dirty, false);
    assert.match(first.status, /Стр 1, стлб 1/);
    assert.match(first.rows[0].text, /# Hello/);
    assert.ok(first.rows[0].spans.some(span => span.style.includes('38;5;80')));
    assert.ok(first.rows[0].spans.some(span => span.style.includes('38;5;243')));

    app.press({ name: 'f', ctrl: true });
    app.press({ name: 'H', text: 'H' });
    app.press({ name: 'e', text: 'e' });
    app.press({ name: 'enter' });
    const found = app.layout(80, 24);
    assert.equal(found.find.count, '1/1');
    assert.ok(found.rows.some(row => row.sel));
    app.press({ name: 'escape' });

    app.press({ name: 'f2' });
    const split = app.layout(80, 24);
    assert.equal(split.view, 'split');
    assert.ok(split.split);
    assert.match(split.rows.map(row => row.text).join('\n'), /# Hello/);
    assert.match(split.split.rows.map(row => row.text).join('\n'), /^Hello/m);
    assert.equal(split.split.rows[0].text.includes('#'), false);
    const painted = paint(split, 80, 24);
    const body = painted.split('\x1b[B')[1].replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
    assert.equal(Array.from(body).length, 80);
    const hashAt = body.indexOf('# Hello');
    assert.ok(hashAt >= 0 && body.indexOf('Hello', hashAt + '# Hello'.length) > hashAt);
    app.press({ name: 'f2' });
    const preview = app.layout(80, 24);
    assert.equal(preview.view, 'preview');
    assert.equal(preview.rows[0].text.includes('#'), false);
    app.press({ name: 'f2' });

    app.press({ name: 'end' });
    app.press({ name: '!', text: '!' });
    assert.equal(app.layout(80, 24).tabs[0].dirty, true);
    app.press({ name: 's', ctrl: true });
    assert.equal(fs.readFileSync(file, 'utf8'), '# Hello!\n');
    assert.equal(app.layout(80, 24).tabs[0].dirty, false);

    app.press({ name: 'n', ctrl: true });
    app.press({ name: 'a', text: 'a' });
    assert.equal(app.layout(80, 24).tabs.length, 2);
    app.press({ name: 'left', alt: true });
    assert.equal(app.layout(80, 24).tabs.find(tab => tab.active).title, 'note.md');

    app.press({ name: 'c', ctrl: true });
    assert.match(app.layout(40, 12).prompt.label, /Выйти/);
    app.press({ name: 'n', text: 'n' });
    assert.equal(app.quit, false);
    app.press({ name: 'c', ctrl: true });
    app.press({ name: 'y', text: 'y' });
    assert.equal(app.quit, true);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('tabs, formatting, commands and the frog behind an empty note', () => {
    const app = createApp({ lang: 'ru' });
    const empty = app.layout(80, 24);
    assert.equal(empty.caption, 'С чего начнём?');
    assert.equal(empty.face, '(o.o)');
    const drawn = paint(empty, 80, 24);
    assert.match(drawn, /38;5;156/);
    assert.match(drawn, /38;5;230/);
    assert.match(drawn, /38;5;24/);
    assert.doesNotMatch(drawn, /2;38;5;/);
    const count = (rows, cols) => {
        let n = 0;
        for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) if (pixel(row, col, rows, cols)) n++;
        return n;
    };
    const squeezed = count(12, 36);
    const fitted = count(30, 80);
    const stretched = count(48, 160);
    assert.ok(squeezed < fitted && fitted < stretched);

    app.press({ name: 'b', ctrl: true });
    const written = app.layout(80, 24);
    assert.match(written.rows.map(row => row.text).join(''), /\*\*текст\*\*/);
    const behind = paint(written, 80, 24);
    assert.match(behind, /2;38;5;22/);
    assert.doesNotMatch(behind, /38;5;156/);

    app.press({ name: 'n', ctrl: true });
    app.press({ name: 'x', text: 'x' });
    app.press({ name: 'left', alt: true, shift: true });
    const moved = app.layout(80, 24);
    assert.equal(moved.tabs[0].title, 'Документ 2');
    assert.equal(moved.tabs[0].active, true);

    app.press({ name: 'p', alt: true });
    assert.equal(app.layout(40, 12).tabs.find(tab => tab.active).pinned, true);

    app.press({ name: '2', alt: true });
    assert.equal(app.layout(40, 12).tabs.find(tab => tab.active).title, 'Документ 1');

    app.press({ name: 'w', ctrl: true });
    app.press({ name: 'y', text: 'y' });
    app.press({ name: 'z', alt: true });
    assert.equal(app.layout(40, 12).tabs.length, 2);

    app.press({ name: 'p', ctrl: true });
    for (const ch of 'жир') app.press({ name: ch, text: ch });
    const menu = app.layout(60, 16);
    assert.match(menu.rows.map(row => row.text).join('\n'), /Жирный/);
    app.press({ name: 'escape' });

    app.press({ name: 'l', ctrl: true });
    app.press({ name: '1', text: '1' });
    app.press({ name: 'enter' });
    assert.match(app.layout(40, 12).status, /Стр 1/);
});

test('a selection stays on the lines it covers', () => {
    const app = createApp({ lang: 'ru' });
    app.press({ name: 'a', text: 'a' });
    app.press({ name: 'b', text: 'b' });
    app.press({ name: 'enter' });
    app.press({ name: 'c', text: 'c' });
    app.press({ name: 'up', shift: true });
    const rows = app.layout(60, 18).rows;
    const marked = rows.filter(row => row.sel);
    assert.ok(marked.length > 0 && marked.length <= 2);
    assert.equal(rows.filter(row => row.text === '' && row.sel).length, 0);
    assert.ok(marked.every(row => row.sel[1] - row.sel[0] < row.text.length + 2));
});

test('the tab list is a panel on the left', () => {
    const app = createApp({ lang: 'ru' });
    app.press({ name: 'n', ctrl: true });
    app.press({ name: 'b', text: 'b' });
    assert.ok(app.layout(80, 24).side);
    assert.ok(app.layout(80, 24).side.lines.some(line => line.text.includes('Документ 2')));
    app.press({ name: 'f4' });
    const frame = app.layout(80, 24);
    assert.ok(frame.side);
    assert.ok(frame.side.width >= 22);
    assert.ok(frame.side.lines.some(line => line.text.includes('Документ 2')));
    assert.ok(frame.side.lines.some(line => line.mark === '●'));
    assert.match(frame.rows.map(row => row.text).join(''), /b/);
    const drawn = paint(frame, 80, 24);
    const row = drawn.replace(/\x1b\[[0-9;?]*m/g, '').split('\x1b[B')[1];
    const titleAt = row.indexOf('Открытые редакторы');
    const barAt = row.indexOf('\u2502');
    assert.ok(titleAt >= 0 && barAt > titleAt);
    app.press({ name: 'up' });
    assert.equal(app.layout(80, 24).tabs.find(tab => tab.active).title, 'Документ 1');
    app.press({ name: 'escape' });
    app.press({ name: 'z', text: 'z' });
    assert.match(app.layout(80, 24).rows.map(row => row.text).join(''), /z/);
    assert.ok(app.layout(80, 24).side);
    app.press({ name: 'f4' });
    app.press({ name: 'f4' });
    assert.equal(app.layout(80, 24).side, null);
});

test('english status and a painted tab', () => {
    const app = createApp({ lang: 'en' });
    app.press({ name: 'a', text: 'a' });
    const frame = app.layout(60, 10);
    assert.match(frame.status, /Ln 1, Col 2/);
    assert.match(frame.status, /1 word/);
    const drawn = paint(frame, 60, 10);
    assert.match(drawn, /Document 1/);
    assert.match(drawn, /\x1b\[H/);
    assert.equal(drawn.split('\x1b[B').length, 10);
});

test('chat attaches the selection and inserts the answer', async () => {
    let sent = null;
    const app = createApp({
        lang: 'ru',
        chat: {
            describe: () => ({ name: 'Ollama', model: 'test', local: true, privacy: 'Текст остаётся на этом компьютере: работает Ollama.' }),
            complete({ messages, onDelta }) {
                sent = messages;
                onDelta('готово');
                return { ok: true };
            }
        }
    });
    app.press({ name: 'a', text: 'a' });
    app.press({ name: 'left', shift: true });
    app.press({ name: 'j', alt: true });
    const opened = app.layout(80, 24);
    const files = opened.side.lines.map(line => line.text).join('\n');
    const panel = opened.chat.lines.map(line => line.text).join('\n');
    assert.match(files, /Открытые редакторы/);
    assert.ok(opened.side.left);
    assert.ok(!opened.chat.left);
    assert.match(panel, /Чат/);
    assert.match(panel, /Выделено/);
    const drawn = paint(opened, 80, 24).replace(/\x1b\[[0-9;?]*m/g, '');
    const row = drawn.split('\x1b[B')[1];
    const filesAt = row.indexOf('Открытые редакторы');
    const chatAt = row.indexOf('Чат');
    assert.ok(filesAt >= 0 && chatAt > filesAt);
    for (const ch of 'да') app.press({ name: ch, text: ch });
    app.press({ name: 'enter' });
    await app.settled();
    const user = sent.find(message => message.role === 'user');
    assert.match(user.content, /<текст>\na\n<\/текст>/);
    assert.match(app.layout(80, 24).chat.lines.map(line => line.text).join('\n'), /готово/);
    assert.match(app.layout(80, 24).side.lines.map(line => line.text).join('\n'), /Открытые редакторы/);
    app.press({ name: 'i', alt: true });
    assert.match(app.layout(80, 24).rows.map(row => row.text).join(''), /готово/);
    app.press({ name: 'j', alt: true });
    const closed = app.layout(80, 24);
    assert.equal(closed.chat, null);
    assert.match(closed.side.lines.map(line => line.text).join('\n'), /Открытые редакторы/);
});

test('the terminal does not use a key encrypted by the window', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fgs-tui-'));
    const configFile = path.join(dir, 'config.json');
    const keyFile = path.join(dir, 'keys.json');
    fs.writeFileSync(configFile, JSON.stringify({ 'ai-provider': 'openai', 'ai-model-openai': 'gpt-test' }));
    fs.writeFileSync(keyFile, JSON.stringify({ openai: { enc: true, value: 'secret' } }));
    const { createClient } = require('../tui/ai');
    const client = createClient({ t: key => key, configFile, keyFiles: [keyFile] });
    assert.equal(client.describe().locked, true);
    const result = await client.complete({ messages: [{ role: 'user', content: 'hi' }], onDelta() {} });
    assert.equal(result.ok, false);
    assert.match(result.error, /зашифрован/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('the terminal editor speaks Russian and English', () => {
    const ru = createI18n('ru');
    const en = createI18n('en');
    assert.equal(ru('Язык'), 'Язык');
    assert.equal(en('Язык'), 'Language');
    assert.match(en('Ollama не запущена. Откройте приложение Ollama или выполните «ollama serve».'), /not running/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fgs-lang-'));
    const configFile = path.join(dir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ theme: 'dark', language: 'ru' }));
    const app = createApp({ lang: 'ru', configFile });
    assert.match(app.layout(60, 16).status, /Стр/);
    app.press({ name: 'p', ctrl: true });
    for (const ch of 'Язык') app.press({ name: ch, text: ch });
    app.press({ name: 'enter' });
    assert.match(app.layout(60, 16).status, /Ln /);
    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    assert.equal(saved.language, 'en');
    assert.equal(saved.theme, 'dark');
    fs.rmSync(dir, { recursive: true, force: true });
});
