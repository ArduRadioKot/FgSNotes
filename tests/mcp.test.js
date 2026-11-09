const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createMcpServer, connectionSnippets, allowedOrigin, VERSIONS } = require('../mcp-server');

const TOKEN = 'test-key';
const calls = [];
const server = createMcpServer({
    version: '9.9.9',
    runTool: async (name, args) => {
        calls.push({ name, args });
        if (args.id === 'boom') throw new Error('no such note');
        return { ok: name };
    }
});
let url;
before(async () => { const { port } = await server.start({ token: TOKEN, write: false }); url = `http://127.0.0.1:${port}/mcp`; });
after(() => server.stop());

let nextId = 1;
const post = (method, params, { headers = {}, address = url, id = nextId++ } = {}) => fetch(address, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) })
});
const rpc = async (...args) => (await post(...args)).json();
const modern = (extra = {}) => ({ ...extra, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } });
const names = result => result.result.tools.map(tool => tool.name);
const withWrite = async run => {
    await server.start({ token: TOKEN, write: true });
    try { return await run(); } finally { await server.start({ token: TOKEN, write: false }); }
};

test('an older client opens with initialize and gets a version it knows', async () => {
    const answer = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
    assert.equal(answer.result.protocolVersion, '2025-06-18');
    assert.equal(answer.result.serverInfo.name, 'fgsnotes');
    assert.deepEqual(answer.result.capabilities, { tools: {} });
    const unknown = await rpc('initialize', { protocolVersion: '1999-01-01', capabilities: {} });
    assert.equal(unknown.result.protocolVersion, '2025-11-25');
});

test('a notification gets 202 and no body', async () => {
    const response = await post('notifications/initialized', undefined, { id: null });
    assert.equal(response.status, 202);
    assert.equal(await response.text(), '');
});

test('a newer client works without initialize', async () => {
    const discovered = await rpc('server/discover', modern());
    assert.deepEqual(discovered.result.supportedVersions, VERSIONS);
    assert.equal(discovered.result.resultType, 'complete');
    assert.equal(discovered.result.cacheScope, 'private');
    const listed = await rpc('tools/list', modern());
    assert.equal(typeof listed.result.ttlMs, 'number');
    assert.equal(listed.result._meta['io.modelcontextprotocol/serverInfo'].name, 'fgsnotes');
});

test('a newer client is refused an unknown version, a mismatched header and an unknown method', async () => {
    const version = await post('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } });
    assert.equal(version.status, 400);
    assert.equal((await version.json()).error.code, -32022);
    const header = await post('tools/list', modern(), { headers: { 'MCP-Method': 'tools/call' } });
    assert.equal(header.status, 400);
    assert.equal((await header.json()).error.code, -32020);
    assert.equal((await post('nothing/here', modern())).status, 404);
});

test('changing tools are hidden and refused until allowed', async () => {
    assert.deepEqual(names(await rpc('tools/list')), ['search', 'fetch']);
    calls.length = 0;
    const refused = await rpc('tools/call', { name: 'create_note', arguments: { title: 'a', content: 'b' } });
    assert.equal(refused.result.isError, true);
    assert.equal(calls.length, 0);
    await withWrite(async () => {
        assert.deepEqual(names(await rpc('tools/list')), ['search', 'fetch', 'create_note', 'append_note', 'update_note']);
        const made = await rpc('tools/call', { name: 'create_note', arguments: { title: 'a', content: 'b' } });
        assert.equal(made.result.isError, false);
        assert.deepEqual(calls, [{ name: 'create_note', args: { title: 'a', content: 'b' } }]);
    });
});

test('tool results and failures', async () => {
    const good = await rpc('tools/call', { name: 'search', arguments: { query: 'x' } });
    assert.deepEqual(JSON.parse(good.result.content[0].text), { ok: 'search' });
    const failed = await rpc('tools/call', { name: 'fetch', arguments: { id: 'boom' } });
    assert.equal(failed.result.isError, true);
    assert.match(failed.result.content[0].text, /no such note/);
    assert.equal((await rpc('tools/call', { name: 'nope', arguments: {} })).error.code, -32602);
    assert.equal((await rpc('tools/call', { name: 'fetch', arguments: { id: 5 } })).error.code, -32602);
});

test('without the key nothing is served', async () => {
    assert.equal((await post('tools/list', undefined, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    const none = await fetch(url, { method: 'POST', body: '{}' });
    assert.equal(none.status, 401);
    assert.equal((await post('tools/list', undefined, { address: `${url}/wrong` })).status, 401);
    assert.equal((await fetch(url.replace('/mcp', '/other'))).status, 404);
});

test('the key can be part of the address, for clients with no header field', async () => {
    const response = await post('tools/list', undefined, { address: `${url}/${TOKEN}`, headers: { Authorization: '' } });
    assert.equal(response.status, 200);
});

test('pages from other sites are refused even with the key', async () => {
    assert.equal((await post('tools/list', undefined, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await post('tools/list', undefined, { headers: { Origin: 'http://localhost:3000' } })).status, 200);
    assert.equal(allowedOrigin('http://127.0.0.1.evil.example'), false);
    assert.equal(allowedOrigin('https://localhost.evil.example:80'), false);
    assert.equal(allowedOrigin(undefined), true);
});

test('only POST is served and bad bodies are errors', async () => {
    const get = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(get.status, 405);
    const bad = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: 'not json' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, -32700);
});

test('a new key replaces the old one at once', async () => {
    server.setToken('other-key');
    try {
        assert.equal((await post('tools/list')).status, 401);
        assert.equal((await post('tools/list', undefined, { headers: { Authorization: 'Bearer other-key' } })).status, 200);
    } finally { server.setToken(TOKEN); }
});

test('connection snippets keep paths intact', () => {
    const windows = 'C:\\Program Files\\FgSNotes\\FgSNotes.exe';
    const snippets = connectionSnippets({ port: 47395, token: 'k', execPath: windows, script: 'C:\\a\\mcp-stdio.js', connectionFile: 'C:\\b\\mcp.json' });
    const desktop = JSON.parse(snippets['claude-desktop']).mcpServers.fgsnotes;
    assert.equal(desktop.command, windows);
    assert.deepEqual(desktop.args, ['C:\\a\\mcp-stdio.js', 'C:\\b\\mcp.json']);
    assert.equal(desktop.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(JSON.parse(snippets.cursor).mcpServers.fgsnotes.headers.Authorization, 'Bearer k');
    assert.match(snippets['claude-code'], /--transport http fgsnotes http:\/\/127\.0\.0\.1:47395\/mcp/);
    assert.match(snippets.chatgpt, /\/mcp\/k$/);
});

// Runs the relay as a real process and feeds it one line per message.
function relay(file, lines) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [path.join(__dirname, '../mcp-stdio.js'), file]);
        let out = '';
        child.stdout.on('data', chunk => { out += chunk; });
        child.on('close', () => resolve(out.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))));
        child.stdin.end(lines.map(line => JSON.stringify(line)).join('\n') + '\n');
    });
}
const listRequest = id => ({ jsonrpc: '2.0', id, method: 'tools/list' });

test('the stdio relay passes requests through in order and swallows notifications', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fgs-mcp-'));
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ token: TOKEN, port: server.info().port }));
    const answers = await relay(file, [listRequest(1), { jsonrpc: '2.0', method: 'notifications/initialized' }, listRequest(2)]);
    assert.deepEqual(answers.map(answer => answer.id), [1, 2]);
    assert.ok(answers[0].result.tools.length >= 2);
    fs.rmSync(dir, { recursive: true });
});

test('the stdio relay explains when the app is closed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fgs-mcp-'));
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ token: TOKEN, port: 0 }));
    const [answer] = await relay(file, [listRequest(7)]);
    assert.equal(answer.id, 7);
    assert.match(answer.error.message, /not running/);
    fs.rmSync(dir, { recursive: true });
});
