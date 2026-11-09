// For assistants that can only start a program and talk to it over stdin/stdout (Claude Desktop, Codex): relays each
// line to the MCP server inside the running app. Takes the path of the connection file the app writes (port and key).
const fs = require('fs');
const http = require('http');
const readline = require('readline');

const connectionFile = process.argv[2];
const write = message => process.stdout.write(JSON.stringify(message) + '\n');
const failure = (id, text) => ({ jsonrpc: '2.0', id, error: { code: -32000, message: text } });

function connection() {
    try {
        const { port, token } = JSON.parse(fs.readFileSync(connectionFile, 'utf8'));
        return port && token ? { port, token } : null;
    } catch { return null; }
}

function post(body, { port, token }) {
    return new Promise((resolve, reject) => {
        const request = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Length': Buffer.byteLength(body) } }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
        });
        request.on('error', reject);
        request.end(body);
    });
}

async function relay(line) {
    let id = null;
    try { ({ id = null } = JSON.parse(line)); } catch { /* the server answers a parse error itself */ }
    const closed = 'FgSNotes is not running, or access for assistants is turned off in its settings';
    const target = connection();
    if (!target) { if (id !== null) write(failure(id, closed)); return; }
    let answer;
    try { answer = await post(line, target); } catch { if (id !== null) write(failure(id, closed)); return; }
    if (answer.status === 202) return;
    try { write(JSON.parse(answer.text)); } catch { if (id !== null) write(failure(id, `FgSNotes answered HTTP ${answer.status}`)); }
}

// One at a time, so answers leave in the order the requests came.
let queue = Promise.resolve();
readline.createInterface({ input: process.stdin }).on('line', line => {
    if (line.trim()) queue = queue.then(() => relay(line));
});
