const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp, helpLines } = require('./app');
const { createI18n } = require('./i18n');
const { paint, enter, leave } = require('./paint');

function language() {
    const chosen = process.env.FGS_LANG;
    if (chosen === 'ru' || chosen === 'en') return chosen;
    try {
        const file = path.join(os.homedir(), 'Documents', 'FgSNotes', 'config.json');
        const saved = JSON.parse(fs.readFileSync(file, 'utf8')).language;
        if (saved === 'ru' || saved === 'en') return saved;
    } catch { /* no saved language */ }
    return /^ru/i.test(process.env.LANG || process.env.LC_ALL || '') ? 'ru' : 'en';
}

function run(argv) {
    const lang = language();
    const t = createI18n(lang);
    const args = argv.filter(arg => arg !== '--help' && arg !== '-h');
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(helpLines(lang));
        console.log('\nnode tui.js [file.md ...]');
        return;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error(t('Нужен терминал. Запустите команду в обычном окне терминала.'));
        process.exit(1);
    }
    let closed = false;
    const app = createApp({ lang, files: args, onChange: () => { if (!closed) draw(); } });
    const parser = require('./keys').createParser();
    let timer = null;
    const draw = () => {
        const frame = app.layout(process.stdout.columns, process.stdout.rows);
        process.stdout.write(paint(frame, process.stdout.columns, process.stdout.rows));
        if (frame.quit) finish(0);
    };
    const finish = code => {
        if (closed) return;
        closed = true;
        app.abort();
        process.stdout.write(leave);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.exit(code);
    };
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdout.write(enter);
    process.stdin.on('data', chunk => {
        if (timer) clearTimeout(timer);
        parser.push(chunk, key => { app.press(key); draw(); });
        timer = setTimeout(() => parser.flush(key => { app.press(key); draw(); }), 30);
    });
    process.stdout.on('resize', draw);
    process.on('SIGTERM', () => finish(0));
    draw();
}

module.exports = { run };
