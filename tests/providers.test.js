const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const providers = require('../providers');
const { createKeystore } = require('../keystore');

function server(handler) {
    return new Promise(resolve => {
        const instance = http.createServer(handler).listen(0, '127.0.0.1', () => resolve({ instance, url: `http://127.0.0.1:${instance.address().port}` }));
    });
}
const readBody = req => new Promise(resolve => { let body = ''; req.on('data', part => { body += part; }); req.on('end', () => resolve(body ? JSON.parse(body) : {})); });
const collect = async (options) => { let text = ''; const result = await providers.chat(options, delta => { text += delta; }); return { result, text }; };

test('OpenAI-compatible: lists chat models and streams SSE split across chunks, sending the bearer key', async () => {
    const seen = {};
    const { instance, url } = await server(async (req, res) => {
        seen.auth = req.headers.authorization;
        if (req.url === '/models') return res.end(JSON.stringify({ data: [{ id: 'gpt-b' }, { id: 'text-embedding-3' }, { id: 'gpt-a' }, { id: 'whisper-1' }] }));
        seen.body = await readBody(req);
        const first = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'При' } }] }) + '\n\n';
        const second = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'вет' } }] }) + '\n\ndata: [DONE]\n\n';
        res.write(first + second.slice(0, 12));
        setTimeout(() => res.end(second.slice(12)), 15);
    });
    assert.deepEqual(await providers.listModels({ provider: 'custom', url, key: 'sk-test' }), { ok: true, models: ['gpt-a', 'gpt-b'] });
    const { result, text } = await collect({ provider: 'custom', url, key: 'sk-test', model: 'gpt-a', messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }] });
    assert.equal(result.ok, true);
    assert.equal(text, 'Привет');
    assert.equal(seen.auth, 'Bearer sk-test');
    assert.equal(seen.body.stream, true);
    assert.equal(seen.body.messages.length, 2);
    instance.close();
});

test('Anthropic: system prompt is separate, text deltas are streamed, key goes in x-api-key', async () => {
    const seen = {};
    const { instance, url } = await server(async (req, res) => {
        seen.headers = req.headers;
        seen.body = await readBody(req);
        const events = [{ type: 'message_start' }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } }, { type: 'message_stop' }];
        res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
    });
    // the hosted base URL is fixed, so point the preset at the test server for this check
    const original = providers.PRESETS.anthropic.base;
    providers.PRESETS.anthropic.base = url + '/v1';
    const { result, text } = await collect({ provider: 'anthropic', key: 'ant-key', model: 'claude-x', messages: [{ role: 'system', content: 'Be brief' }, { role: 'user', content: 'Hi' }] });
    providers.PRESETS.anthropic.base = original;
    assert.equal(result.ok, true);
    assert.equal(text, 'Hello');
    assert.equal(seen.headers['x-api-key'], 'ant-key');
    assert.equal(seen.headers['anthropic-version'], '2023-06-01');
    assert.equal(seen.body.system, 'Be brief');
    assert.deepEqual(seen.body.messages, [{ role: 'user', content: 'Hi' }]);
    assert.ok(seen.body.max_tokens > 0);
    instance.close();
});

test('Gemini: roles are mapped, the key goes in a header, only generateContent models are listed', async () => {
    const seen = {};
    const { instance, url } = await server(async (req, res) => {
        seen.key = req.headers['x-goog-api-key'];
        if (req.url.startsWith('/v1beta/models?')) return res.end(JSON.stringify({ models: [{ name: 'models/gemini-b', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }] }));
        seen.url = req.url;
        seen.body = await readBody(req);
        res.end('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Ответ' }] } }] }) + '\n\n');
    });
    const original = providers.PRESETS.gemini.base;
    providers.PRESETS.gemini.base = url + '/v1beta';
    assert.deepEqual(await providers.listModels({ provider: 'gemini', key: 'g-key' }), { ok: true, models: ['gemini-b'] });
    const { result, text } = await collect({ provider: 'gemini', key: 'g-key', model: 'gemini-b', messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'Q' }, { role: 'assistant', content: 'A' }] });
    providers.PRESETS.gemini.base = original;
    assert.equal(result.ok, true);
    assert.equal(text, 'Ответ');
    assert.equal(seen.key, 'g-key');
    assert.match(seen.url, /gemini-b:streamGenerateContent\?alt=sse/);
    assert.deepEqual(seen.body.contents.map(entry => entry.role), ['user', 'model']);
    assert.equal(seen.body.systemInstruction.parts[0].text, 'S');
    instance.close();
});

test('errors are explained: missing key, rejected key, rate limit, bad address', async () => {
    assert.match((await providers.chat({ provider: 'openai', model: 'm', messages: [] }, () => {})).error, /ключ API/);
    const { instance, url } = await server((req, res) => { res.statusCode = req.url.includes('limit') ? 429 : 401; res.end(JSON.stringify({ error: { message: 'nope' } })); });
    assert.match((await providers.chat({ provider: 'custom', url, key: 'bad', model: 'm', messages: [] }, () => {})).error, /не принял ключ/);
    assert.match((await providers.chat({ provider: 'custom', url: url + '/limit', key: 'k', model: 'm', messages: [] }, () => {})).error, /лимит/);
    assert.match((await providers.listModels({ provider: 'custom', url: 'ftp://x' })).error, /http/);
    assert.throws(() => providers.baseOf('nobody'), /Неизвестный/);
    instance.close();
});

test('local and custom providers do not need a key; hosted ones do', () => {
    assert.deepEqual(['ollama', 'lmstudio', 'custom', 'openai', 'anthropic', 'gemini', 'openrouter', 'groq'].map(id => providers.needsKey(id)), [false, false, false, true, true, true, true, true]);
    assert.equal(providers.baseOf('openai', 'http://evil.example'), 'https://api.openai.com/v1');
    assert.equal(providers.baseOf('lmstudio', ''), 'http://127.0.0.1:1234/v1');
});

test('keystore encrypts when it can, never returns keys through status, and survives a restart', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ks-')), 'keys.json');
    const fake = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from('ENC:' + text), decryptString: buffer => buffer.toString().slice(4) };
    const store = createKeystore(file, fake);
    store.set('openai', ' sk-123 ');
    assert.equal(store.get('openai'), 'sk-123');
    assert.deepEqual(store.status(['openai', 'groq']), { openai: true, groq: false });
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /sk-123/);
    assert.equal(createKeystore(file, fake).get('openai'), 'sk-123');
    store.clear('openai');
    assert.equal(store.has('openai'), false);
    const plain = createKeystore(file, { isEncryptionAvailable: () => false });
    plain.set('groq', 'g');
    assert.equal(plain.secure(), false);
    assert.equal(plain.get('groq'), 'g');
});
