// Sync over the local network: an HTTP endpoint other copies of FgSNotes send their notes to, and a UDP beacon so
// computers on the same network find each other. This process only relays sealed text: the page holds the notes and
// the key, encrypts, decrypts and merges. A request from a device with another sync code never gets past the page.
const http = require('http');
const dgram = require('dgram');
const os = require('os');

const SYNC_PORT = 47390;          // the first free port from here up is used and announced in the beacon
const BEACON_PORT = 47389;
const BEACON_EVERY = 5000;
const PEER_TTL = 20000;           // a computer that stopped announcing is forgotten after this
const MAX_BODY = 32 * 1024 * 1024;

// IPv4 addresses of this machine on the local network, with the broadcast address of each subnet.
function localAddresses() {
    const result = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const item of list || []) {
            if (item.family !== 'IPv4' && item.family !== 4) continue;
            // Skip addresses a phone cannot reach: link-local (169.254) and the 198.18/15 range VPN clients use.
            if (item.internal || /^169\.254\.|^198\.1[89]\./.test(item.address)) continue;
            const ip = item.address.split('.').map(Number), mask = item.netmask.split('.').map(Number);
            result.push({ address: item.address, broadcast: ip.map((part, i) => (part | (~mask[i] & 255))).join('.') });
        }
    }
    // Home network ranges first: that is the address to type on the phone.
    const rank = address => (/^192\.168\./.test(address) ? 0 : /^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(address) ? 1 : 2);
    return result.sort((x, y) => rank(x.address) - rank(y.address));
}

function createSyncTransport({ onRequest, log = () => {} }) {
    let server = null, beacon = null, timer = null, port = 0;
    let identity = null;              // { group, device, name } while sync is on
    const peers = new Map();          // device -> { device, name, address, port, seen }

    function listen() {
        return new Promise((resolve, reject) => {
            const attempt = candidate => {
                const next = http.createServer(handle);
                next.once('error', error => {
                    if (error.code === 'EADDRINUSE' && candidate < SYNC_PORT + 10) attempt(candidate + 1);
                    else reject(error);
                });
                next.listen(candidate, '0.0.0.0', () => { server = next; port = candidate; resolve(); });
            };
            attempt(SYNC_PORT);
        });
    }

    function handle(request, response) {
        const reply = (status, body = '') => { response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(body); };
        if (request.method !== 'POST' || request.url !== '/fgs-sync') return reply(404);
        // The group tag is a cheap filter for strangers; the real check is decryption with the sync code.
        if (!identity || request.headers['x-fgs-group'] !== identity.group) return reply(403);
        const chunks = [];
        let size = 0;
        request.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BODY) { reply(413); request.destroy(); return; }
            chunks.push(chunk);
        });
        request.on('end', async () => {
            if (response.headersSent) return;
            try {
                const answer = await onRequest(Buffer.concat(chunks).toString('utf8'));
                if (typeof answer === 'string') reply(200, answer); else reply(403);
            } catch (error) {
                log('sync request failed:', error.message);
                reply(500);
            }
        });
    }

    function announce() {
        if (!beacon || !identity) return;
        const message = Buffer.from(JSON.stringify({ app: 'fgsnotes', v: 1, group: identity.group, device: identity.device, name: identity.name, port }));
        const targets = new Set(['255.255.255.255', ...localAddresses().map(item => item.broadcast)]);
        for (const target of targets) beacon.send(message, BEACON_PORT, target, () => {});
        const now = Date.now();
        for (const [device, peer] of peers) if (now - peer.seen > PEER_TTL) peers.delete(device);
    }

    function openBeacon() {
        return new Promise(resolve => {
            const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
            socket.on('error', error => { log('sync beacon:', error.message); try { socket.close(); } catch { /* already closed */ } if (beacon === socket) beacon = null; resolve(); });
            socket.on('message', (raw, info) => {
                let message;
                try { message = JSON.parse(raw.toString('utf8')); } catch { return; }
                if (!identity || message.app !== 'fgsnotes' || message.group !== identity.group || message.device === identity.device) return;
                if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535) return;
                peers.set(String(message.device), { device: String(message.device), name: String(message.name || '').slice(0, 80), address: info.address, port: message.port, seen: Date.now() });
            });
            socket.bind(BEACON_PORT, () => {
                try { socket.setBroadcast(true); } catch { /* some systems refuse; we still listen */ }
                beacon = socket;
                resolve();
            });
        });
    }

    async function start(next) {
        const groupChanged = !identity || identity.group !== next.group;
        identity = { group: String(next.group), device: String(next.device), name: String(next.name || os.hostname()).slice(0, 80) };
        if (groupChanged) peers.clear();
        if (!server) await listen();
        if (!beacon) await openBeacon();
        if (!timer) timer = setInterval(announce, BEACON_EVERY);
        announce();
        return info();
    }

    function stop() {
        identity = null;
        peers.clear();
        clearInterval(timer); timer = null;
        if (beacon) { try { beacon.close(); } catch { /* already closed */ } beacon = null; }
        if (server) { server.close(); server = null; port = 0; }
    }

    function info() {
        return { running: !!identity, port, name: os.hostname(), addresses: localAddresses().map(item => item.address) };
    }

    function list() {
        const now = Date.now();
        return [...peers.values()].filter(peer => now - peer.seen <= PEER_TTL).map(({ device, name, address, port: peerPort }) => ({ device, name, address, port: peerPort }));
    }

    // Send our sealed notes to another device and return its sealed answer.
    function send(address, body) {
        const match = /^\[?([0-9a-z.:-]+?)\]?(?::(\d{1,5}))?$/i.exec(String(address).trim());
        if (!match) return Promise.reject(new Error('bad address'));
        const host = match[1], targetPort = Number(match[2] || SYNC_PORT);
        return new Promise((resolve, reject) => {
            const request = http.request({ host, port: targetPort, path: '/fgs-sync', method: 'POST', timeout: 15000,
                headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Fgs-Group': identity ? identity.group : '', 'Content-Length': Buffer.byteLength(body) } }, response => {
                const chunks = [];
                let size = 0;
                response.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) request.destroy(new Error('answer too large')); else chunks.push(chunk); });
                response.on('end', () => {
                    if (response.statusCode !== 200) reject(new Error(response.statusCode === 403 ? 'forbidden' : 'HTTP ' + response.statusCode));
                    else resolve(Buffer.concat(chunks).toString('utf8'));
                });
            });
            request.on('timeout', () => request.destroy(new Error('timeout')));
            request.on('error', reject);
            request.end(body);
        });
    }

    return { start, stop, info, peers: list, send };
}

module.exports = { createSyncTransport, localAddresses, SYNC_PORT };
