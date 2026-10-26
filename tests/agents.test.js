const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('os');
const path = require('path');
const agents = require('../agents');
const providers = require('../providers');

const BANNED = /dangerously-skip-permissions|dangerously-bypass|danger-full-access|workspace-write|\byolo\b|bypassPermissions|acceptEdits/;

function script(dir, name, source) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, '#!/usr/bin/env node\n' + source);
    fs.chmodSync(file, 0o755);
    return file;
}

test('arguments stay read-only and never put the note on the command line', () => {
    const claude = agents.argumentsFor('claude-code', { model: 'sonnet' });
    const codex = agents.argumentsFor('codex', { model: 'gpt-5.4' });
    assert.equal(claude.includes('--permission-mode') && claude[claude.indexOf('--permission-mode') + 1], 'plan');
    assert.equal(claude[claude.indexOf('--tools') + 1], '');
    assert.equal(claude.includes('--dangerously-skip-permissions'), false);
    assert.equal(codex[codex.indexOf('--sandbox') + 1], 'read-only');
    assert.equal(codex.at(-1), '-');
    assert.equal(codex.includes('--ask-for-approval') && codex[codex.indexOf('--ask-for-approval') + 1], 'never');
    for (const provider of ['claude-code', 'codex']) {
        assert.doesNotMatch(agents.argumentsFor(provider, { model: 'sonnet' }).join(' '), BANNED);
        for (const args of agents.fallbacks(provider, 'sonnet')) assert.doesNotMatch(args.join(' '), BANNED);
    }
    const filtered = agents.argumentsFor('claude-code', { help: '--print --model', model: 'haiku' });
    assert.deepEqual(filtered, ['--print', '--model', 'haiku']);
});

test('a model name cannot smuggle extra arguments', () => {
    assert.throws(() => agents.safeModel('sonnet;touch /tmp/x'), /буквы/);
    assert.equal(agents.safeModel('  gpt-5.4  '), 'gpt-5.4');
    assert.equal(agents.safeModel(''), '');
});

test('the prompt keeps the conversation and drops nothing from the command', () => {
    const prompt = agents.buildPrompt([
        { role: 'system', content: 'Правила' },
        { role: 'user', content: 'Привет' },
        { role: 'assistant', content: 'Здравствуйте' },
        { role: 'user', content: 'Ещё' }
    ]);
    assert.match(prompt, /Правила/);
    assert.match(prompt, /Пользователь:\nЕщё/);
    assert.match(prompt, /Ассистент:\nЗдравствуйте/);
    const huge = agents.buildPrompt([{ role: 'user', content: 'я'.repeat(250000) }]);
    assert.equal(huge.length, 200000);
});

test('Claude stream deltas are not repeated when the final result arrives', () => {
    let text = '', thought = '';
    const parser = agents.createClaudeParser(delta => { text += delta; }, value => { thought += value; });
    parser.push({ type: 'stream_event', event: { delta: { type: 'thinking_delta', thinking: 'думаю' } } });
    parser.push({ type: 'stream_event', event: { delta: { type: 'text_delta', text: 'При' } } });
    parser.push({ type: 'stream_event', event: { delta: { type: 'text_delta', text: 'вет' } } });
    parser.push({ type: 'assistant', message: { content: [{ type: 'text', text: 'Привет' }] } });
    parser.push({ type: 'result', result: 'Привет' });
    parser.flush();
    assert.equal(text, 'Привет');
    assert.equal(thought, 'думаю');
    let only = '';
    const fallback = agents.createClaudeParser(delta => { only += delta; });
    fallback.push({ type: 'result', result: 'Один' });
    fallback.flush();
    assert.equal(only, 'Один');
    assert.throws(() => agents.createClaudeParser(() => {}).push({ type: 'result', is_error: true, result: 'нет входа' }), /нет входа/);
});

test('Codex sends only the new part of a message and surfaces a failed turn', () => {
    let text = '';
    const parser = agents.createCodexParser(delta => { text += delta; });
    parser.push({ type: 'item.completed', item: { type: 'agent_message', text: 'Раз' } });
    parser.push({ type: 'item.completed', item: { type: 'agent_message', text: 'Раз два' } });
    parser.flush();
    assert.equal(text, 'Раз два');
    assert.throws(() => agents.createCodexParser(() => {}).push({ type: 'turn.failed', error: { message: 'отказано' } }), /отказано/);
});

test('the program is looked up in the given directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fgs-agents-'));
    const dir = path.join(root, 'bin');
    const fileName = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const file = path.join(dir, fileName);
    assert.equal(agents.findIn('claude', dir, candidate => candidate === file), file);
    assert.equal(agents.findIn('missing', '', () => false), '');
});

test('the shared client does not call Claude Code or Codex over HTTP', async () => {
    assert.equal(providers.needsKey('claude-code'), false);
    assert.equal(providers.needsKey('codex'), false);
    const listed = await providers.listModels({ provider: 'claude-code' });
    assert.equal(listed.ok, false);
    assert.match(listed.error, /компьютер/);
    const chatted = await providers.chat({ provider: 'codex', model: 'gpt-5.4', messages: [{ role: 'user', content: 'hi' }] }, () => {});
    assert.equal(chatted.ok, false);
});

test('Claude Code reads the note from stdin, and an unknown flag falls back to print mode', { skip: process.platform === 'win32' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fgs-claude-'));
    const log = path.join(dir, 'seen.json');
    const bin = script(dir, 'claude', `
        const fs = require('fs');
        let stdin = '';
        process.stdin.on('data', chunk => { stdin += chunk; });
        process.stdin.on('end', () => {
            const all = fs.existsSync(${JSON.stringify(log)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(log)}, 'utf8')) : [];
            all.push({ argv: process.argv.slice(2), stdin, cwd: process.cwd() });
            fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(all));
            if (process.argv.includes('--tools')) {
                process.stderr.write("error: unexpected argument '--tools' found");
                process.exit(2);
            }
            process.stdout.write('Готово');
        });
    `);
    let answer = '';
    const result = await agents.chat({
        provider: 'claude-code', bin, help: null, model: 'sonnet',
        messages: [{ role: 'user', content: 'СЕКРЕТ-ЗАМЕТКА' }]
    }, delta => { answer += delta; });
    const seen = JSON.parse(fs.readFileSync(log, 'utf8'));
    assert.equal(result.ok, true);
    assert.equal(answer, 'Готово');
    assert.equal(seen.length, 2);
    assert.equal(seen[0].argv.includes('--permission-mode'), true);
    assert.equal(seen[0].argv[seen[0].argv.indexOf('--permission-mode') + 1], 'plan');
    assert.equal(seen[1].argv.includes('--print'), true);
    assert.equal(seen[1].argv.includes('--tools'), false);
    for (const call of seen) {
        assert.equal(call.argv.join(' ').includes('СЕКРЕТ-ЗАМЕТКА'), false);
        assert.match(call.stdin, /СЕКРЕТ-ЗАМЕТКА/);
        assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(os.tmpdir()));
        assert.doesNotMatch(call.argv.join(' '), BANNED);
    }
});

test('Codex streams the answer and stays in the read-only sandbox', { skip: process.platform === 'win32' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fgs-codex-'));
    const log = path.join(dir, 'seen.json');
    const bin = script(dir, 'codex', `
        const fs = require('fs');
        let stdin = '';
        process.stdin.on('data', chunk => { stdin += chunk; });
        process.stdin.on('end', () => {
            fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), stdin, cwd: process.cwd() }));
            if (!process.argv.includes('read-only') || !process.argv.includes('--json')) {
                process.stderr.write('missing lock');
                process.exit(2);
            }
            process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Раз' } }) + '\\n');
            process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Раз два' } }) + '\\n');
        });
    `);
    let answer = '';
    const result = await agents.chat({
        provider: 'codex', bin, help: null, model: 'gpt-5.4',
        messages: [{ role: 'user', content: 'СЕКРЕТ-ЗАМЕТКА' }]
    }, delta => { answer += delta; });
    const seen = JSON.parse(fs.readFileSync(log, 'utf8'));
    assert.equal(result.ok, true);
    assert.equal(answer, 'Раз два');
    assert.equal(seen.argv.includes('СЕКРЕТ-ЗАМЕТКА'), false);
    assert.match(seen.stdin, /СЕКРЕТ-ЗАМЕТКА/);
    assert.equal(seen.argv[seen.argv.indexOf('--sandbox') + 1], 'read-only');
    assert.doesNotMatch(seen.argv.join(' '), BANNED);
});

test('stopping the request kills the program', { skip: process.platform === 'win32' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fgs-abort-'));
    const bin = script(dir, 'claude', 'setInterval(() => {}, 1000);\n');
    const controller = new AbortController();
    const pending = agents.chat({
        provider: 'claude-code', bin, help: '--print', model: '',
        messages: [{ role: 'user', content: 'жди' }]
    }, () => {}, controller.signal);
    setTimeout(() => controller.abort(), 80);
    const result = await Promise.race([
        pending,
        new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 4000))
    ]);
    assert.equal(result.aborted, true);
    assert.equal(result.timeout, undefined);
});

test('a rejected model is not executed', async () => {
    const result = await agents.chat({ provider: 'claude-code', model: 'sonnet && id', messages: [], bin: '/no/such/claude' }, () => {});
    assert.equal(result.ok, false);
    assert.match(result.error, /буквы/);
});
