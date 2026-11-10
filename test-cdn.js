/**
 * Offline test for commands/cdn.js — no network, no WhatsApp connection.
 * Run: node test-cdn.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const cachePath = path.join(__dirname, 'data', 'cdnCache.json');
const statePath = path.join(__dirname, 'data', 'cdnState.json');
const backups = new Map([[cachePath, null], [statePath, null]]);
for (const [file] of backups) {
    if (fs.existsSync(file)) backups.set(file, fs.readFileSync(file, 'utf8'));
}

const realFetch = global.fetch;

// --- stub the CDN ---------------------------------------------------------
const FOLDER = 'application/vnd.google-apps.folder';
const ROOT = [
    { mimeType: FOLDER, id: 'FA', name: 'Folder A' },
    { mimeType: 'audio/mpeg', size: '2097722', id: 'AUD', name: 'km.mp3' },
    { mimeType: 'image/jpeg', size: '269901', id: 'IMG', name: 'photo.jpg' }
];
const FOLDER_A = [
    { mimeType: FOLDER, id: 'FB', name: 'Sub B' },
    { mimeType: 'video/mp4', size: '361524', id: 'VID', name: 'clip.mp4' }
];
const SUB_B = [
    { mimeType: 'image/png', size: '1234', id: 'PNG', name: 'deep.png' }
];

function listingForUrl(url) {
    const u = decodeURIComponent(String(url));
    if (/\/Folder A\/Sub B\/?$/.test(u)) return SUB_B;
    if (/\/Folder A\/?$/.test(u)) return FOLDER_A;
    return ROOT;
}

global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/download/')) {
        const type = u.includes('VID') ? 'video/mp4' : u.includes('PNG') ? 'image/png' : 'image/jpeg';
        return {
            ok: true, status: 200,
            headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) },
            arrayBuffer: async () => Buffer.from('FAKE-MEDIA-BYTES')
        };
    }
    return { ok: true, status: 200, json: async () => listingForUrl(u) };
};

// start clean so navigation is deterministic
try { fs.unlinkSync(cachePath); } catch { /* ignore */ }
try { fs.unlinkSync(statePath); } catch { /* ignore */ }

const cdnCommand = require('./commands/cdn');
const { parseCommand, listingText, isPostable, normalizePath, parentPath, joinPath, cdnUrlForPath } = cdnCommand;

// --- mock socket ----------------------------------------------------------
const sent = [];
const sock = {
    user: { id: '1234567890:30@s.whatsapp.net' },
    groupFetchAllParticipating: async () => ({}),
    groupMetadata: async () => ({ participants: [] }),
    sendMessage: async (jid, content, options = {}) => {
        sent.push({ jid, content, options });
        return { key: { id: 'T' + sent.length, remoteJid: jid, fromMe: true } };
    }
};
const CHAT = 'chat@s.whatsapp.net';
const makeMsg = (body) => ({
    key: { remoteJid: CHAT, fromMe: true, id: 'M' + Math.random().toString(36).slice(2) },
    message: { conversation: body }
});
const lastText = () => [...sent].reverse().find((s) => s.content?.text)?.content.text || '';
const reset = () => { sent.length = 0; };
const run = (body) => cdnCommand(sock, CHAT, makeMsg(body));

async function main() {
    // --- path helpers -----------------------------------------------------
    assert.strictEqual(normalizePath('/A/B/'), 'A/B');
    assert.strictEqual(parentPath('A/B/C'), 'A/B');
    assert.strictEqual(parentPath('A'), '');
    assert.strictEqual(joinPath('A', 'B'), 'A/B');
    assert.strictEqual(cdnUrlForPath('GDrive Upload BOT'), 'https://cdn.osunhive.name.ng/GDrive%20Upload%20BOT/');
    assert.strictEqual(cdnUrlForPath(''), 'https://cdn.osunhive.name.ng/');

    // --- parseCommand -----------------------------------------------------
    assert.deepStrictEqual(parseCommand(''), { action: 'list' });
    assert.deepStrictEqual(parseCommand('3'), { action: 'select', index: 3, caption: '' });
    assert.deepStrictEqual(parseCommand('..'), { action: 'up' });
    assert.deepStrictEqual(parseCommand('back'), { action: 'up' });
    assert.deepStrictEqual(parseCommand('root'), { action: 'root' });
    assert.deepStrictEqual(parseCommand('path'), { action: 'path' });
    assert.deepStrictEqual(parseCommand('page 2'), { action: 'list', page: 2 });
    assert.deepStrictEqual(parseCommand('refresh'), { action: 'refresh', path: undefined });
    assert.deepStrictEqual(parseCommand('link 3'), { action: 'link', index: 3, caption: '' });
    assert.deepStrictEqual(parseCommand('post 3 | My caption'), { action: 'post', index: 3, caption: 'My caption' });
    assert.deepStrictEqual(parseCommand('open 2'), { action: 'open', index: 2 });
    assert.deepStrictEqual(parseCommand('open A/B'), { action: 'open', path: 'A/B' });
    assert.deepStrictEqual(parseCommand('GDrive Upload BOT'), { action: 'open', path: 'GDrive Upload BOT' });

    // --- isPostable / listingText ----------------------------------------
    assert.ok(isPostable('video/mp4') && isPostable('image/png'));
    assert.ok(!isPostable('audio/mpeg') && !isPostable(FOLDER));

    const text = listingText(ROOT, '', 1, Date.now());
    assert.ok(text.includes('CDN root'), 'root header');
    assert.ok(text.includes('1. 📁 Folder A'), 'folder listed first');

    // --- .cdn (root) ------------------------------------------------------
    reset();
    await run('.cdn');
    assert.ok(lastText().includes('Folder A') && lastText().includes('photo.jpg'), 'root listing');

    // --- .cdn 2 (audio) → info, not posted -------------------------------
    reset();
    await run('.cdn 2');
    assert.ok(lastText().includes('audio/mpeg'), 'audio shows info');
    assert.ok(!sent.some((s) => s.jid === 'status@broadcast'), 'audio not posted');

    // --- .cdn 1 opens the folder -----------------------------------------
    reset();
    await run('.cdn 1');
    let t = lastText();
    assert.ok(t.includes('/Folder A'), 'header shows folder path');
    assert.ok(t.includes('Sub B') && t.includes('clip.mp4'), 'folder contents');

    // --- .cdn path --------------------------------------------------------
    reset();
    await run('.cdn path');
    assert.ok(lastText().includes('Folder A'), 'current path shown');

    // --- .cdn 2 posts the video ------------------------------------------
    reset();
    await run('.cdn 2');
    const status = sent.find((s) => s.jid === 'status@broadcast');
    assert.ok(status && status.content.video, 'video posted to status');

    // --- .cdn send 2 sends the video to chat -----------------------------
    reset();
    await run('.cdn send 2');
    assert.ok(sent.some((s) => s.content?.video && s.jid === CHAT), 'video sent to chat');

    // --- .cdn .. goes back to root ---------------------------------------
    reset();
    await run('.cdn ..');
    assert.ok(lastText().includes('CDN root'), 'back to root');

    // --- nested: .cdn open Folder A/Sub B --------------------------------
    reset();
    await run('.cdn open Folder A/Sub B');
    assert.ok(lastText().includes('deep.png'), 'nested listing');

    // --- .cdn 1 posts the nested image -----------------------------------
    reset();
    await run('.cdn 1');
    const nested = sent.find((s) => s.jid === 'status@broadcast');
    assert.ok(nested && nested.content.image, 'nested image posted');

    // --- .cdn back returns to Folder A -----------------------------------
    reset();
    await run('.cdn back');
    assert.ok(lastText().includes('/Folder A') && lastText().includes('clip.mp4'), 'back one level');

    // --- .cdn link 2 in Folder A -----------------------------------------
    reset();
    await run('.cdn link 2');
    assert.ok(lastText().includes('/download/VID'), 'link points at the video');

    // --- .cdn root --------------------------------------------------------
    reset();
    await run('.cdn root');
    assert.ok(lastText().includes('CDN root'), 'root command');

    // --- .cdn info 3 ------------------------------------------------------
    reset();
    await run('.cdn info 3');
    assert.ok(lastText().includes('image/jpeg'), 'info shows mime');

    // --- .cdn page 9 clamps ----------------------------------------------
    reset();
    await run('.cdn page 9');
    assert.ok(lastText().includes('CDN root'), 'out-of-range page still lists');

    // --- unknown index ----------------------------------------------------
    reset();
    await run('.cdn 99');
    assert.ok(/No entry #99/.test(lastText()), 'bad index handled');

    console.log('✅ all cdn tests passed');
}

main()
    .catch((error) => {
        console.error('❌ test failed:', error);
        process.exitCode = 1;
    })
    .finally(() => {
        global.fetch = realFetch;
        for (const [file, data] of backups) {
            if (data !== null) fs.writeFileSync(file, data);
            else { try { fs.unlinkSync(file); } catch { /* ignore */ } }
        }
    });
