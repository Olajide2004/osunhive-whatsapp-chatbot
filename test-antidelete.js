/**
 * Offline test for commands/antidelete.js
 *
 * The real bug: Baileys 7's `downloadContentFromMessage` returns a *stream*,
 * but the old code passed it straight to fs.writeFile (TypeError). This test
 * stubs Baileys to return a stream and checks that media is captured, stored
 * and replayed on revocation.
 *
 * Run: node test-antidelete.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const CONFIG_PATH = path.join(__dirname, 'data', 'antidelete.json');
const TMP_DIR = path.join(__dirname, 'tmp');

// --- back up runtime state ------------------------------------------------
const hadConfig = fs.existsSync(CONFIG_PATH);
const savedConfig = hadConfig ? fs.readFileSync(CONFIG_PATH, 'utf8') : null;
const createdTmp = !fs.existsSync(TMP_DIR);
if (createdTmp) fs.mkdirSync(TMP_DIR, { recursive: true });

// enable antidelete for the test
fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
fs.writeFileSync(CONFIG_PATH, JSON.stringify({ enabled: true }));

// --- stub the media downloader with a real Readable stream ---------------
const MEDIA = Buffer.from('FAKE-IMAGE-BYTES-1234567890');
const downloads = [];

const antidelete = require('./commands/antidelete');
const { storeMessage, handleMessageRevocation, _internal } = antidelete;
const { toBuffer, numberPart, ownerJid, messageStore } = _internal;

// Baileys 7 returns a stream; reproduce that exactly.
_internal.setDownloader(async (mediaMessage, kind) => {
    downloads.push({ kind, msg: mediaMessage });
    return Readable.from([MEDIA.subarray(0, 10), MEDIA.subarray(10)]);
});

// --- mock socket ---------------------------------------------------------
const sent = [];
const sock = {
    user: { id: '2348106439881:30@s.whatsapp.net' },
    groupMetadata: async () => ({ subject: 'Test Group' }),
    sendMessage: async (jid, content) => {
        sent.push({ jid, content });
        return { key: { id: 'S' + sent.length } };
    }
};
const lastText = () => [...sent].reverse().find((s) => s.content?.text)?.content.text || '';

const MID = 'MSG-' + Date.now();
const GROUP = '120363000000000000@g.us';
const SENDER = '2348011112222@s.whatsapp.net';

function contentMessage() {
    return {
        key: { remoteJid: GROUP, fromMe: false, id: MID, participant: SENDER },
        message: { imageMessage: { caption: 'hello world', fileLength: '100' } }
    };
}

async function main() {
    // --- helpers ---------------------------------------------------------
    assert.deepStrictEqual(await toBuffer(Readable.from([Buffer.from('ab'), Buffer.from('cd')])), Buffer.from('abcd'));
    assert.strictEqual((await toBuffer(Buffer.from('x'))).toString(), 'x');
    assert.strictEqual((await toBuffer(null)).length, 0);

    assert.strictEqual(numberPart('2349076129380:30@s.whatsapp.net'), '2349076129380');
    assert.strictEqual(numberPart('230403738755160@lid'), '230403738755160');
    assert.strictEqual(ownerJid(sock), '2349076129380@s.whatsapp.net', 'reports go to the owner, not the bot');

    // --- store an image (stream -> buffer regression) --------------------
    await storeMessage(sock, contentMessage());
    assert.strictEqual(downloads.length, 1, 'media was downloaded');
    assert.strictEqual(downloads[0].kind, 'image');

    const stored = messageStore.get(MID);
    assert.ok(stored, 'message stored');
    assert.strictEqual(stored.content, 'hello world');
    assert.strictEqual(stored.mediaType, 'image');
    assert.ok(stored.mediaPath && fs.existsSync(stored.mediaPath), 'media file written');
    assert.strictEqual(fs.readFileSync(stored.mediaPath).toString(), MEDIA.toString(), 'bytes match the stream');

    // --- revoke it: a report is sent to the owner ------------------------
    sent.length = 0;
    await handleMessageRevocation(sock, {
        key: { remoteJid: GROUP, id: 'REVOKE-1', participant: SENDER },
        message: {
            protocolMessage: {
                type: 0,
                key: { remoteJid: GROUP, id: MID, participant: SENDER }
            }
        }
    });

    assert.ok(sent.length >= 2, 'report + media sent');
    assert.strictEqual(sent[0].jid, '2349076129380@s.whatsapp.net', 'report goes to owner');
    assert.ok(/ANTIDELETE REPORT/.test(lastText()), 'report text');
    assert.ok(/hello world/.test(lastText()), 'deleted text included');
    assert.ok(/Test Group/.test(lastText()), 'group name included');

    const mediaMsg = sent.find((s) => s.content?.image);
    assert.ok(mediaMsg, 'deleted image replayed');
    assert.ok(!fs.existsSync(stored.mediaPath), 'temp media cleaned up');
    assert.ok(!messageStore.has(MID), 'entry removed');

    // --- owner's own deletion is ignored --------------------------------
    const reportsBefore = sent.filter((s) => /ANTIDELETE REPORT/.test(s.content?.text || '')).length;
    await storeMessage(sock, contentMessage());
    await handleMessageRevocation(sock, {
        key: { remoteJid: '2349076129380@s.whatsapp.net', id: 'REVOKE-2' },
        participant: '2349076129380@s.whatsapp.net',
        message: { protocolMessage: { type: 0, key: { id: MID } } }
    });
    const reportsAfter = sent.filter((s) => /ANTIDELETE REPORT/.test(s.content?.text || '')).length;
    assert.strictEqual(reportsAfter, reportsBefore, 'no report for the owner\'s own deletion');

    // --- revocation without a stored message is a no-op -----------------
    await handleMessageRevocation(sock, {
        key: { remoteJid: GROUP, id: 'R3' },
        message: { protocolMessage: { type: 0, key: { id: 'unknown-id' } } }
    });

    // --- protocol messages are not stored -------------------------------
    const before = messageStore.size;
    await storeMessage(sock, {
        key: { remoteJid: GROUP, id: 'PM', participant: SENDER },
        message: { protocolMessage: { type: 0, key: { id: MID } } }
    });
    assert.strictEqual(messageStore.size, before, 'protocol message skipped');

    console.log('✅ all antidelete tests passed');
}

main()
    .catch((error) => {
        console.error('❌ test failed:', error);
        process.exitCode = 1;
    })
    .finally(() => {
        messageStore.clear();
        // restore runtime state
        try {
            if (hadConfig) fs.writeFileSync(CONFIG_PATH, savedConfig);
            else fs.unlinkSync(CONFIG_PATH);
        } catch { /* ignore */ }
        if (createdTmp) {
            try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });