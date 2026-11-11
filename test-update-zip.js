/**
 * Offline test for the built-in (pure-Node) ZIP extractor in commands/update.js.
 * It builds a real ZIP in memory — stored + deflated entries, a directory
 * entry, and a path-traversal attempt — and checks the extractor without
 * needing unzip/7z/busybox on the machine.
 *
 * Run: node test-update-zip.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const { extractZipNode, buildRelaunchCommand } = require('./commands/update');

/* ------------------------------------------------------------------ */
/* Minimal ZIP writer (enough to exercise the reader)                  */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const e of entries) {
        const name = Buffer.from(e.name, 'utf8');
        const raw = e.dir ? Buffer.alloc(0) : Buffer.from(e.data || '', 'utf8');
        const stored = e.method === 0;
        const comp = stored ? raw : zlib.deflateRawSync(raw);
        const method = stored ? 0 : 8;
        const crc = crc32(raw);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(0, 10);
        local.writeUInt16LE(0, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(comp.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);

        locals.push(local, name, comp);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(0, 12);
        central.writeUInt16LE(0, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(comp.length, 20);
        central.writeUInt32LE(raw.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(e.dir ? 0x10 : 0, 38);
        central.writeUInt32LE(offset, 42);

        centrals.push(central, name);
        offset += local.length + name.length + comp.length;
    }

    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...locals, cd, eocd]);
}

/* ------------------------------------------------------------------ */

function main() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'osunhive-zip-'));
    const zipPath = path.join(tmp, 'fixture.zip');
    const outDir = path.join(tmp, 'out');

    const fixture = buildZip([
        { name: 'osunhive-main/', dir: true },
        { name: 'osunhive-main/', dir: true }, // duplicate dir entry — must not throw
        { name: 'osunhive-main/index.js', data: 'console.log("hi");\n', method: 8 },
        { name: 'osunhive-main/commands/cdn.js', data: 'module.exports = 1;\n', method: 0 },
        { name: 'osunhive-main/lib/deep/nested/file.txt', data: 'deep\n', method: 8 },
        { name: '../escape.txt', data: 'nope\n', method: 8 }
    ]);
    fs.writeFileSync(zipPath, fixture);

    const count = extractZipNode(zipPath, outDir);

    assert.strictEqual(count, 4, 'four files extracted');
    assert.strictEqual(fs.readFileSync(path.join(outDir, 'osunhive-main/index.js'), 'utf8'), 'console.log("hi");\n');
    assert.strictEqual(fs.readFileSync(path.join(outDir, 'osunhive-main/commands/cdn.js'), 'utf8'), 'module.exports = 1;\n');
    assert.strictEqual(fs.readFileSync(path.join(outDir, 'osunhive-main/lib/deep/nested/file.txt'), 'utf8'), 'deep\n');
    assert.ok(fs.existsSync(path.join(outDir, 'osunhive-main')), 'directory created');

    // Path traversal must not escape the target directory.
    assert.ok(!fs.existsSync(path.join(tmp, 'escape.txt')), 'no zip-slip escape');

    // Reading twice (idempotent overwrite) must work.
    const again = extractZipNode(zipPath, outDir);
    assert.strictEqual(again, 4, 're-extract overwrites cleanly');

    // Not-a-zip input fails with a clear error.
    fs.writeFileSync(path.join(tmp, 'bad.zip'), 'not a zip');
    assert.throws(() => extractZipNode(path.join(tmp, 'bad.zip'), path.join(tmp, 'bad')),
        /not a ZIP file/, 'rejects non-zip input');

    fs.rmSync(tmp, { recursive: true, force: true });

    // Restart helper: detached relaunch command (used when pm2 is absent).
    assert.strictEqual(
        buildRelaunchCommand('/usr/bin/node', ['index.js'], 2000),
        "sleep 2; exec '/usr/bin/node' 'index.js'"
    );
    assert.strictEqual(
        buildRelaunchCommand('/usr/bin/node', [], 2500),
        "sleep 3; exec '/usr/bin/node'",
        'delay rounds up to whole seconds'
    );
    const spaced = buildRelaunchCommand('/opt/my node/node', ['a b.js'], 1000);
    assert.ok(spaced.includes("'/opt/my node/node'"), 'spaces in exec path are quoted');
    assert.ok(spaced.includes("'a b.js'"), 'spaces in args are quoted');
    assert.ok(
        buildRelaunchCommand("/o'brien/node", [], 1000).includes("'/o'\\''brien/node'"),
        'single quotes are escaped'
    );

    console.log('✅ all update-zip tests passed');
}

try {
    main();
} catch (error) {
    console.error('❌ test failed:', error);
    process.exitCode = 1;
}
