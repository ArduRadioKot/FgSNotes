const { test } = require('node:test');
const assert = require('node:assert/strict');
const { relayArgs } = require('../launch');

test('a normal launch is the editor', () => {
    assert.equal(relayArgs(['/App/FgSNotes']), null);
    assert.equal(relayArgs(['electron', '.']), null);
});

test('the assistant relay keeps the script and the connection file', () => {
    assert.deepEqual(relayArgs(['/App/FgSNotes', '/App/mcp-stdio.js', '/Users/me/mcp.json']), ['/App/mcp-stdio.js', '/Users/me/mcp.json']);
    assert.deepEqual(relayArgs(['C:\\FgSNotes.exe', 'C:\\a\\mcp-stdio.js', 'C:\\b\\mcp.json']), ['C:\\a\\mcp-stdio.js', 'C:\\b\\mcp.json']);
    assert.deepEqual(relayArgs(['/App/FgSNotes', '--some-switch', '/App/mcp-stdio.js', '--flag', '/tmp/mcp.json']), ['/App/mcp-stdio.js', '/tmp/mcp.json']);
    assert.deepEqual(relayArgs(['/App/FgSNotes', '/App/mcp-stdio.js']), ['/App/mcp-stdio.js']);
});
