/**
 * Tiny health/readiness endpoint.
 *
 * Container platforms (Render, Railway, Koyeb, Fly) require a web process to
 * bind `$PORT` or they consider the service dead. The bot itself only opens a
 * WhatsApp socket, so this exposes `/healthz` (and `/`) as a liveness probe:
 *
 *   GET /healthz -> {"ok":true,"service":"osunhive-chatbot","connected":true,...}
 *
 * It is only started when PORT is set, so Termux / plain VPS runs are
 * completely unaffected. No dependencies.
 */

'use strict';

const http = require('http');

function startHealthServer({ port = process.env.PORT, getStatus = () => ({}), host = '0.0.0.0' } = {}) {
    // No PORT set (Termux, plain VPS, pm2) -> do not listen at all.
    if (port === undefined || port === null || port === '') return null;

    const usePort = Number(port);
    if (!Number.isInteger(usePort) || usePort < 0 || usePort > 65535) return null;

    const startedAt = Date.now();

    const server = http.createServer((req, res) => {
        const pathname = (req.url || '/').split('?')[0];

        if (pathname !== '/' && pathname !== '/healthz' && pathname !== '/health') {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'not found' }));
            return;
        }

        let status = {};
        try {
            status = getStatus() || {};
        } catch (error) {
            status = { statusError: error.message };
        }

        const body = JSON.stringify({
            ok: true,
            service: 'osunhive-chatbot',
            uptimeSec: Math.round((Date.now() - startedAt) / 1000),
            pid: process.pid,
            node: process.versions.node,
            ...status
        });

        res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'content-length': Buffer.byteLength(body)
        });
        res.end(body);
    });

    server.on('error', (error) => {
        console.warn(`[health] could not listen on :${usePort} — ${error.message}`);
    });

    server.listen(usePort, host, () => {
        const bound = server.address();
        const actual = bound && typeof bound === 'object' ? bound.port : usePort;
        console.log(`[health] listening on http://${host}:${actual}/healthz`);
    });

    return server;
}

module.exports = { startHealthServer };