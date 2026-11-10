/**
 * Offline test for commands/cdn.js — no network, no WhatsApp connection.
 * Run: node test-cdn.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const cachePath = path.join(__dirname, 'data', 'cdnCache.json');
const cacheBackup = fs.existsSync(cachePath) ? fs.readFileSync(cachePath, 'utf8') : null;

const realFetch = global.fetch;

// --- stub the CDN ---------------------------------------------------------
const LISTING = [
    { mimeType: 'application/vnd.google-apps.folder', size: undefined, id: 'FOLDER123', name: 'Zeta Folder' },
    { mimeType: 'image/jpeg', size: '269901', id: 'IMG123', name: 'photo.jpg' },
    { mimeType: 'audio/mpeg', size: '2097722', id: 'AUD123', name: 'km.mp3' },
    { mimeType: 'application/vnd.google-apps.spreadsheet', size: '1024', id: 'SHEET123', name: 'Monthly Sheet' }
];

global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/download/')) {
        return {
            ok: true,
            status: 200,
            headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
            arrayBuffer: async () => Buffer.from('FAKE-JPEG-BYTES')
        };
    }
    return {
        ok: true,
        status: 200,
        json: async () => LISTING
    };
};

const cdnCommand = require('./commands/cdn');
const { parseCommand, listingText, isPostable } = cdnCommand;

// --- mock socket ----------------------------------------------------------
const sent = [];
const sock = {
    user: { id: '<PHONE_NUMBER>:30@s.whatsapp.net' },
    groupFetchAllParticipating: async () => ({}),
    groupMetadata: async () => ({ participants: [] }),
    sendMessage: async (jid, content, options = {}) => {
        sent.push({ jid, content, options });
        return { key: { id: 'T' + sent.length, remoteJid: jid, fromMe: true } };
    }
};
function makeMsg(body) {
    return {
        key: { remoteJid: '<PHONE_NUMBER>@s.whatsapp.net', fromMe: true, id: 'M' + Date.now() },
        message: { conversation: body }
    };
}
const lastText = () => [...sent].reverse().find((s) => s.content?.text)?.content.text || '';
const reset = () => { sent.length = 0; };

async function run() {
    // --- parseCommand -----------------------------------------------------
    assert.deepStrictEqual(parseCommand(''), { action: 'list', page: 1 });
    assert.deepStrictEqual(parseCommand('3'), { action: 'post', index: 3, caption: '' });
    assert.deepStrictEqual(parseCommand('page 2'), { action: 'list', page: 2 });
    assert.deepStrictEqual(parseCommand('refresh'), { action: 'list', page: 1, force: true });
    assert.deepStrictEqual(parseCommand('link 3'), { action: 'link', index: 3, caption: '' });
    assert.deepStrictEqual(parseCommand('info 4'), { action: 'info', index: 4, caption: '' });
    assert.deepStrictEqual(parseCommand('post 3 | My caption'), { action: 'post', index: 3, caption: 'My caption' });
    assert.deepStrictEqual(parseCommand('3 | Hi'), { action: 'post', index: 3, caption: 'Hi' });

    // --- isPostable / listingText ----------------------------------------
    assert.ok(isPostable('image/png'));
    assert.ok(isPostable('video/mp4'));
    assert.ok(!isPostable('audio/mpeg'));
    assert.ok(!isPostable('application/vnd.google-apps.folder'));

    // sorted: folder first, then files alphabetical (km.mp3, photo.jpg, Monthly Sheet)
    const text = listingText(LISTING.slice().sort((a, b) => {
        const af = a.mimeType.includes('folder') ? 0 : 1;
        const bf = b.mimeType.includes('folder') ? 0 : 1;
        return af !== bf ? af - bf : a.name.localeCompare(b.name);
    }), 1, Date.now());
    assert.ok(text.includes('Osunhive CDN'), 'has header');
    assert.ok(text.includes('1. 📁'), 'folder listed first');

    // --- .cdn list --------------------------------------------------------
    reset();
    await cdnCommand(sock, 'x@s.whatsapp.net', makeMsg('.cdn'));
    const list = lastText();
    assert.ok(list.includes('Osunhive CDN'), 'lists CDN');
    assert.ok(list.includes('Zeta Folder'), 'shows folder');
    assert.ok(list.includes('photo.jpg'), 'shows image');
    assert.ok(list.includes('✅'), 'marks postable media');

    // --- .cdn 1 (folder) is refused --------------------------------------
    reset();
    await cdnCommand(sock, 'x@s.whatsapp.net', makeMsg('.cdn 1'));
    assert.ok(/cannot be posted|only accepts images and videos|folder/i.test(lastText()), 'folder not postable');

    // --- .cdn 2 (audio) is refused ---------------------------------------
    reset();
    await cdnCommand(sock, 'x@s.whatsapp.net', makeMsg('.cdn 2'));
    assert.ok(/folder|only accepts images and videos|audio/i.test(lastText()), 'audio not postable');

    // --- .cdn link 4 (the image) -----------------------------------------
    reset();
    await cdnCommand(sock, 'x@s.whatsapp.net', makeMsg('.cdn link 4'));
    assert.ok(lastText().includes('/download/IMG123'), 'link points at the image');

    // --- .cdn info 4 ------------------------------------------------------
    reset();
    await cdnCommand(sock, 'x@s.whatsapp.net', makeMsg('.cdn info 4'));
    assert.ok(lastText().includes('image/jpeg'), 'info shows mime');

    // --- .cdn send 4 ------------------------------------------------------
    reset();
    await cdnCommand(sock, 'x@s.whatsapp.net', makeMsg('.cdn send 4'));
    const sentImage = sent.find((s) => s.content?.image);
    assert.ok(sentImage, 'sent image to chat');
    assert.strictEqual(sentImage.jid, 'x@s.whatsapp.net');

    // --- .cdn 4 posts a status -------------------------------------------
    reset();
    await cdnCommand(sock, 'x@s.whatsapp.net', makeMsg('.cdn 4'));
    const status = sent.find((s) => s.jid === 'status@broadcast');
    assert.ok(status, 'posted to status@broadcast');
    assert.ok(status.content.image || status.content.video, 'status has media');

    // --- .cdn page 9 clamps ----------------------------------------------
    reset();
    await cdnCommand(sock, 'x@s.whatsapp.net', makeMsg('.cdn page 9'));
    assert.ok(lastText().includes('Osunhive CDN'), 'out-of-range page still lists');

    console.log('✅ all cdn tests passed');
}

run()
    .catch((error) => {
        console.error('❌ test failed:', error);
        process.exitCode = 1;
    })
    .finally(() => {
        global.fetch = realFetch;
        if (cacheBackup !== null) fs.writeFileSync(cachePath, cacheBackup);
        else { try { fs.unlinkSync(cachePath); } catch { /* ignore */ } }
    });
