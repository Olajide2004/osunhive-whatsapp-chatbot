/**
 * Offline test for lib/health.js — the container liveness endpoint.
 *
 * Verifies:
 *   - no PORT  -> no server is started (Termux / plain VPS stay untouched)
 *   - with PORT -> GET /healthz and / return 200 JSON with the bot status
 *   - unknown paths return 404
 *   - a throwing status getter never crashes the endpoint
 *
 * Run: node test-health.js
 */

const assert = require('assert');
const http = require('http');

const { startHealthServer } = require('./lib/health');

function get(port, path) {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.setTimeout(5000, () => req.destroy(new Error('request timeout')));
    });
}

function listen(server) {
    return new Promise((resolve, reject) => {
        if (server.listening) return resolve(server.address().port);
        server.once('listening', () => resolve(server.address().port));
        server.once('error', reject);
    });
}

(async () => {
    // 1. No PORT -> nothing listens.
    assert.strictEqual(startHealthServer({ port: undefined }), null, 'no PORT => no server');
    assert.strictEqual(startHealthServer({ port: '' }), null, 'empty PORT => no server');
    assert.strictEqual(startHealthServer({ port: 'not-a-port' }), null, 'garbage PORT => no server');

    // 2. With a PORT -> healthy JSON.
    const server = startHealthServer({
        port: 0,
        getStatus: () => ({ connected: true, phone: '2348106439881', version: '2.0.0' })
    });
    assert.ok(server, 'server started');
    const port = await listen(server);

    const health = await get(port, '/healthz');
    assert.strictEqual(health.status, 200, '/healthz is 200');
    const payload = JSON.parse(health.body);
    assert.strictEqual(payload.ok, true, 'ok flag');
    assert.strictEqual(payload.service, 'osunhive-chatbot', 'service name');
    assert.strictEqual(payload.connected, true, 'status getter is included');
    assert.strictEqual(payload.phone, '2348106439881', 'phone is included');
    assert.ok(typeof payload.uptimeSec === 'number', 'uptime reported');
    assert.ok(typeof payload.pid === 'number', 'pid reported');

    const root = await get(port, '/health?probe=1');
    assert.strictEqual(root.status, 200, '/health alias works, query string ignored');

    const missing = await get(port, '/does-not-exist');
    assert.strictEqual(missing.status, 404, 'unknown path is 404');
    assert.strictEqual(JSON.parse(missing.body).ok, false, '404 body is JSON');

    // 3. A broken status getter must not take the endpoint down.
    const flaky = startHealthServer({ port: 0, getStatus: () => { throw new Error('boom'); } });
    const flakyPort = await listen(flaky);
    const flakyRes = await get(flakyPort, '/healthz');
    assert.strictEqual(flakyRes.status, 200, 'still healthy when the getter throws');
    assert.strictEqual(JSON.parse(flakyRes.body).statusError, 'boom', 'error is surfaced, not thrown');

    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => flaky.close(resolve));

    console.log('✅ all health tests passed');
})().catch((error) => {
    console.error('❌ test failed:', error);
    process.exitCode = 1;
});