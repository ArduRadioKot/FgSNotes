// The app in a real browser (Chromium through Playwright): what the unit tests cannot see.
// Run with `npm run test:ui`; the first time, fetch the browser with `npx playwright install chromium`.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../src');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
let server, browser, origin;

before(async () => {
    server = http.createServer((request, response) => {
        const file = path.join(ROOT, decodeURIComponent(new URL(request.url, 'http://x').pathname));
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); response.end(); return; }
        response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
});
after(async () => { await browser.close(); server.close(); });

// A fresh profile with the app open and its notes restored.
async function open(options = {}) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU', ...options });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/MarkDownEditor.html`);
    await page.evaluate(() => window.FgsStore.restored);
    await page.waitForSelector('.tab-item', { state: 'attached' });
    return { context, page, errors };
}
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const reopen = async page => { await page.reload(); await page.evaluate(() => window.FgsStore.restored); await page.waitForSelector('.tab-item', { state: 'attached' }); };
const titles = page => page.evaluate(() => window.FgsActions.notes().map(note => note.title));
// One finger moved across the screen, through the browser's own touch input.
async function swipe(page, from, to, steps = 8) {
    const client = await page.context().newCDPSession(page);
    const point = (x, y) => [{ x, y, id: 1 }];
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(...from) });
    for (let i = 1; i <= steps; i++) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps) });
        await page.waitForTimeout(16);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(450);
}

test('typed text survives a restart, and a note larger than localStorage can hold is kept', async () => {
    const { context, page, errors } = await open();
    await page.click('.new-tab-button');
    await page.click('#markdown-editor');
    await page.keyboard.type('Список покупок');
    await page.evaluate(() => window.FgsActions.createDocument('Большая.md', 'x'.repeat(6 * 1024 * 1024)));
    await page.waitForFunction(() => document.getElementById('save-status').textContent.includes('сохран'));
    await page.waitForTimeout(600);
    await reopen(page);
    const notes = await page.evaluate(() => window.FgsActions.notes().map(note => ({ title: note.title, size: note.content.length, text: note.content.slice(0, 20) })));
    assert.equal(notes.length, 3);
    assert.equal(notes[1].text, 'Список покупок');
    assert.equal(notes[2].size, 6 * 1024 * 1024);
    assert.deepEqual(errors, []);
    await context.close();
});

test('notes saved by an older version in localStorage are moved over', async () => {
    const context = await browser.newContext({ locale: 'ru-RU' });
    await context.addInitScript(() => {
        if (localStorage.getItem('seeded')) return;
        localStorage.setItem('seeded', '1');
        localStorage.setItem('fgsnotes.workspace.v1', JSON.stringify({ documents: [{ id: 1, uid: 'old', title: 'Старая.md', content: 'из прошлой версии' }], activeDocumentIndex: 0, nextDocumentId: 2 }));
    });
    const page = await context.newPage();
    await page.goto(`${origin}/MarkDownEditor.html`);
    await page.evaluate(() => window.FgsStore.restored);
    assert.deepEqual(await titles(page), ['Старая.md']);
    await page.click('#markdown-editor');
    await page.keyboard.type('!');
    await page.waitForFunction(() => localStorage.getItem('fgsnotes.workspace.v1') === null);
    await reopen(page);
    assert.equal(await page.evaluate(() => window.FgsActions.notes()[0].content), 'из прошлой версии!');
    await context.close();
});

test('a change made right before the app closes is not lost', async () => {
    const { context, page } = await open();
    await page.click('#markdown-editor');
    await page.keyboard.type('успел');
    await reopen(page);                     // at once: the 300 ms autosave has not fired yet
    assert.equal((await page.evaluate(() => window.FgsActions.notes()[0].content)).includes('успел'), true);
    await context.close();
});

test('a closed note waits in "Недавно закрытые" and comes back with its text', async () => {
    const { context, page, errors } = await open();
    await page.evaluate(() => window.FgsActions.createDocument('Поход.md', 'Купить палатку'));
    await page.click('.tab-item.active .close-tab');
    assert.equal((await titles(page)).includes('Поход.md'), false);
    await page.click('#notes-button');
    await page.click('.notes-window .nl-trash summary');
    assert.equal(await page.textContent('.notes-window .nl-trash .nl-title'), 'Поход');
    await page.click('.notes-window .nl-restore');
    assert.equal(await page.isVisible('.notes-window'), false);
    assert.equal(await page.inputValue('#markdown-editor'), 'Купить палатку');
    assert.equal(await page.evaluate(() => window.FgsActions.trash().length), 0);
    await reopen(page);
    assert.equal((await titles(page)).includes('Поход.md'), true);
    assert.deepEqual(errors, []);
    await context.close();
});

test('the notes window: search, tags, pinning and order', async () => {
    const { context, page, errors } = await open();
    await page.evaluate(() => {
        window.FgsActions.createDocument('Работа.md', 'Отчёт к пятнице #работа');
        window.FgsActions.createDocument('Отпуск.md', 'Билеты и отель #отдых');
    });
    await page.click('#notes-button');
    const rows = () => page.$$eval('.notes-window .nl-scroll > .nl-list .nl-title', nodes => nodes.map(node => node.textContent));
    assert.deepEqual(await rows(), ['Начните здесь', 'Работа', 'Отпуск']);
    await page.fill('.notes-window .nl-search input', 'отель');
    assert.deepEqual(await rows(), ['Отпуск']);
    await page.fill('.notes-window .nl-search input', '');
    await page.click('.notes-window .nl-tag:text("#работа")');
    assert.deepEqual(await rows(), ['Работа']);
    await page.click('.notes-window .nl-tag:text("Все")');
    await page.click('.notes-window .nl-item:nth-child(3) .nl-pin');
    assert.deepEqual(await rows(), ['Отпуск', 'Начните здесь', 'Работа']);
    await page.click('.notes-window .nl-sort');
    assert.deepEqual(await rows(), ['Отпуск', 'Работа', 'Начните здесь']);
    await page.click('.notes-window .nl-item:nth-child(2) .nl-open');
    assert.equal(await page.inputValue('#markdown-editor'), 'Отчёт к пятнице #работа');
    await reopen(page);
    assert.equal(await page.evaluate(() => window.FgsActions.notes().find(note => note.title === 'Отпуск.md').pinned), true);
    assert.deepEqual(errors, []);
    await context.close();
});

test('settings open, switch section and close with Escape', async () => {
    const { context, page, errors } = await open();
    await page.click('#settings-button');
    assert.equal(await page.isVisible('.settings-window'), true);
    await page.click('.settings-nav-item[data-settings-section="sync"]');
    assert.equal(await page.isVisible('#sync-enabled + .setting-toggle-track'), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('.settings-window'), false);
    assert.deepEqual(errors, []);
    await context.close();
});

test('phone: the drawer follows an edge swipe and the title swipes between notes', async () => {
    const { context, page, errors } = await open(phone);
    await page.evaluate(() => { window.FgsActions.createDocument('Вторая.md', 'текст'); document.querySelector('.tab-item .tab-select').click(); });
    const drawerOpen = () => page.evaluate(() => document.documentElement.classList.contains('m-drawer-open'));
    await swipe(page, [6, 400], [280, 404]);
    assert.equal(await drawerOpen(), true);
    assert.equal(await page.locator('.m-drawer .nl-item').count(), 2);
    await swipe(page, [300, 500], [60, 504]);
    assert.equal(await drawerOpen(), false);
    const title = () => page.textContent('.m-title');
    assert.equal(await title(), 'Начните здесь');
    await swipe(page, [280, 30], [110, 32]);
    assert.equal(await title(), 'Вторая');
    await swipe(page, [110, 30], [280, 32]);
    assert.equal(await title(), 'Начните здесь');
    assert.deepEqual(errors, []);
    await context.close();
});

test('phone: the actions sheet opens from the dock, makes a note and is dragged away', async () => {
    const { context, page, errors } = await open(phone);
    const sheetOpen = () => page.evaluate(() => document.documentElement.classList.contains('m-sheet-open'));
    await swipe(page, [150, 800], [152, 700]);
    assert.equal(await sheetOpen(), true);
    await page.tap('.m-tile[data-sheet="new"]');
    await page.waitForFunction(() => window.FgsActions.notes().length === 2);
    assert.equal(await sheetOpen(), false);
    await page.tap('.m-header .m-icon:last-child');
    assert.equal(await sheetOpen(), true);
    await page.waitForTimeout(450);         // let it slide in before taking hold of it
    const top = await page.evaluate(() => document.querySelector('.m-sheet-head').getBoundingClientRect().top);
    await swipe(page, [195, top + 10], [196, top + 330]);
    assert.equal(await sheetOpen(), false);
    assert.deepEqual(errors, []);
    await context.close();
});
