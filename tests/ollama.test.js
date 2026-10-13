const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { listModels, chat, baseUrl } = require('../ollama');

function server(handler) {
    return new Promise(resolve => {
        const instance = http.createServer(handler).listen(0, '127.0.0.1', () => resolve({ instance, url: `http://127.0.0.1:${instance.address().port}` }));
    });
}

test('baseUrl accepts http(s) hosts and rejects everything else', () => {
    assert.equal(baseUrl('http://localhost:11434/'), 'http://127.0.0.1:11434');
    assert.equal(baseUrl(''), 'http://127.0.0.1:11434');
    assert.equal(baseUrl('https://localhost.example.com:1'), 'https://localhost.example.com:1');
    assert.throws(() => baseUrl('file:///etc/passwd'));
    assert.throws(() => baseUrl('localhost:11434'));
});
test('listModels returns sorted model names', async () => {
    const { instance, url } = await server((req, res) => { assert.equal(req.url, '/api/tags'); res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'llama3.2:3b' }] })); });
    assert.deepEqual(await listModels(url), { ok: true, models: ['llama3.2:3b', 'qwen3:8b'] });
    instance.close();
});
test('listModels reports a server that is not running', async () => {
    const { instance, url } = await server(() => {});
    instance.close();
    const result = await listModels(url);
    assert.equal(result.ok, false);
    assert.match(result.error, /Ollama не запущена/);
});
test('chat streams pieces split across network chunks', async () => {
    const { instance, url } = await server((req, res) => {
        let body = '';
        req.on('data', part => { body += part; });
        req.on('end', () => {
            assert.equal(JSON.parse(body).model, 'm');
            const lines = ['Привет', ', ', 'мир'].map(content => JSON.stringify({ message: { content }, done: false }) + '\n');
            res.write(lines[0] + lines[1].slice(0, 10));
            setTimeout(() => { res.write(lines[1].slice(10) + lines[2]); res.end(JSON.stringify({ done: true }) + '\n'); }, 20);
        });
    });
    let text = '';
    const result = await chat({ url, model: 'm', messages: [{ role: 'user', content: 'hi' }] }, delta => { text += delta; });
    assert.equal(result.ok, true);
    assert.equal(text, 'Привет, мир');
    instance.close();
});
test('chat surfaces the server error and honours abort', async () => {
    const { instance, url } = await server((req, res) => { res.statusCode = 500; res.end(JSON.stringify({ error: 'out of memory' })); });
    const failed = await chat({ url, model: 'x', messages: [] }, () => {});
    assert.deepEqual([failed.ok, failed.error], [false, 'out of memory']);
    const slow = await server(() => {});
    const controller = new AbortController();
    const pending = chat({ url: slow.url, model: 'm', messages: [] }, () => {}, controller.signal);
    setTimeout(() => controller.abort(), 30);
    assert.equal((await pending).aborted, true);
    instance.close(); slow.instance.closeAllConnections(); slow.instance.close();
});

test('pull reports progress and rejects odd model names', async () => {
    const { instance, url } = await server((req, res) => {
        res.write(JSON.stringify({ status: 'pulling abc', total: 100, completed: 40 }) + '\n');
        res.end(JSON.stringify({ status: 'success' }) + '\n');
    });
    const seen = [];
    const result = await require('../ollama').pull({ url, model: 'llama3.2:3b' }, p => seen.push(p));
    assert.equal(result.ok, true);
    assert.deepEqual(seen[0], { status: 'pulling abc', completed: 40, total: 100 });
    assert.equal((await require('../ollama').pull({ url, model: 'a b; rm' }, () => {})).ok, false);
    instance.close();
});

test('chat turns thinking off and retries without the flag when the server rejects it', async () => {
    const bodies = [];
    const { instance, url } = await server((req, res) => {
        let body = '';
        req.on('data', part => { body += part; });
        req.on('end', () => {
            const parsed = JSON.parse(body);
            bodies.push(parsed);
            if ('think' in parsed) { res.statusCode = 400; return res.end(JSON.stringify({ error: '"m" does not support thinking' })); }
            res.end(JSON.stringify({ message: { content: 'ok' } }) + '\n');
        });
    });
    let text = '';
    const result = await chat({ url, model: 'm', messages: [] }, delta => { text += delta; });
    assert.equal(result.ok, true);
    assert.equal(text, 'ok');
    assert.equal(bodies[0].think, false);
    assert.equal('think' in bodies[1], false);
    instance.close();
});

test('chat explains a model that is not installed', async () => {
    const { instance, url } = await server((req, res) => { res.statusCode = 404; res.end(JSON.stringify({ error: 'model "x" not found, try pulling it first' })); });
    const result = await chat({ url, model: 'x', messages: [] }, () => {});
    assert.match(result.error, /не скачана/);
    instance.close();
});

test('chat asks for reasoning only on request, streams it apart from the answer and sets no length limit', async () => {
    const bodies = [];
    const { instance, url } = await server((req, res) => {
        let body = '';
        req.on('data', part => { body += part; });
        req.on('end', () => {
            bodies.push(JSON.parse(body));
            res.write(JSON.stringify({ message: { thinking: 'хмм' } }) + '\n');
            res.end(JSON.stringify({ message: { content: 'да' } }) + '\n');
        });
    });
    let text = '', thoughts = '';
    await chat({ url, model: 'm', messages: [], think: true }, d => { text += d; }, undefined, t => { thoughts += t; });
    assert.equal(bodies[0].think, true);
    assert.equal(bodies[0].options.num_predict, -1);
    assert.deepEqual([text, thoughts], ['да', 'хмм']);
    await chat({ url, model: 'm', messages: [] }, () => {});
    assert.equal(bodies[1].think, false);
    instance.close();
});
