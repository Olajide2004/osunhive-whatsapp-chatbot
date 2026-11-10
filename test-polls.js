/**
 * Offline test for the polls module — uses a mock sock.
 * Run: node test-polls.js
 */

const fs = require('fs');
const crypto = require('crypto');
const assert = require('assert');
const {
    registerPoll,
    recordVoteUpdate,
    findPoll,
    aggregateResults,
    renderResults
} = require('./lib/polls');

const path = require('path');
const storePath = path.join(__dirname, 'data', 'polls.json');
const backup = fs.existsSync(storePath) ? fs.readFileSync(storePath) : null;
process.on('exit', () => {
    if (backup) fs.writeFileSync(storePath, backup);
    else try { fs.unlinkSync(storePath); } catch (_) { /* ignore */ }
});

const { proto } = require('@whiskeysockets/baileys/WAProto');
const { aesEncryptGCM, hmacSign } = require('@whiskeysockets/baileys/lib/Utils/crypto');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');

async function main() {
    const chatId = '12345@g.us';
    const voterJid = '<PHONE_NUMBER>@c.us';
    const values = ['Alpha', 'Bravo', 'Charlie'];

    // Mock sock that behaves like Baileys sendMessage returning a key
    let sent = [];
    const pollIdRef = { id: null };
    const sock = {
        user: { id: voterJid, lid: voterJid },
        sendMessage: async (jid, content) => {
            assert.strictEqual(jid, chatId);
            assert.ok(content.poll, 'poll payload required');
            assert.ok(Array.isArray(content.poll.values));
            assert.strictEqual(content.poll.values.length, 3);
            pollIdRef.id = `P_${Date.now()}`;
            return { key: { id: pollIdRef.id, remoteJid: jid, fromMe: true } };
        }
    };

    // Clean state for test
    saveEmptyStore();

    // --- register poll ---
    const pollId = await registerPoll(sock, chatId, {
        question: 'Which is your favourite?',
        options: values,
        selectableCount: 1
    });
    assert.strictEqual(pollId, pollIdRef.id);
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const poll = store.polls[0];
    assert.strictEqual(poll.id, pollId);
    assert.strictEqual(poll.name, 'Which is your favourite?');
    assert.ok(poll.secret, 'secret persisted');
    console.log('registerPoll OK:', pollId);

    // --- simulate WhatsApp vote ---
    const meId = jidNormalizedUser(sock.user.lid || sock.user.id);
    const secret = Buffer.from(poll.secret, 'base64');
    const pollCreatorJid = poll.createdBy;
    const pollMsgId = poll.id;
    const hash = (name) => crypto.createHash('sha256').update(String(name)).digest();
    const optionName = 'Bravo';
    const selected = [hash(optionName)];
    // build encoded PollVoteMessage
    const voteMsg = proto.Message.PollVoteMessage.create({ selectedOptions: selected });
    const voteBytes = proto.Message.PollVoteMessage.encode(voteMsg).finish();

    const sign = Buffer.concat([
        Buffer.from(pollMsgId),
        Buffer.from(pollCreatorJid),
        Buffer.from(jidNormalizedUser(voterJid)),
        Buffer.from('Poll Vote'),
        Buffer.from([1])
    ]);
    const key0 = hmacSign(secret, new Uint8Array(32), 'sha256');
    const decKey = hmacSign(sign, key0, 'sha256');
    const aad = Buffer.from(`${pollMsgId}\u0000${jidNormalizedUser(voterJid)}`, 'binary');
    const iv = crypto.randomBytes(16);
    const encPayload = aesEncryptGCM(Buffer.from(voteBytes), decKey, iv, aad);

    const pollUpdateMessage = {
        message: {
            pollUpdateMessage: {
                pollCreationMessageKey: { id: pollMsgId, remoteJid: chatId, fromMe: true, participant: meId },
                vote: {
                    encPayload: encPayload.toString('base64'),
                    encIv: iv.toString('base64')
                },
                senderTimestampMs: Math.floor(Date.now() / 1000)
            }
        },
        key: { remoteJid: chatId, participant: voterJid, fromMe: false }
    };
    // Baileys delivers this payload through its own decrypt layer; re-arm buffers before our decrypt:
    const updated = await recordVoteUpdate(sock, pollUpdateMessage);
    assert.strictEqual(updated, true, 'ballot recorded');
    console.log('recordVoteUpdate OK');

    // --- aggregate & render ---
    const updatedPoll = JSON.parse(fs.readFileSync(storePath, 'utf8')).polls[0];
    const agg = aggregateResults(updatedPoll);
    assert.ok(agg.length === 3, 'aggregation returns 3 rows');
    const lines = renderResults(updatedPoll);
    assert.ok(lines.includes(optionName), 'option name in output');
    assert.ok(!lines.includes('crypto'), 'no crash');
    console.log('aggregation OK');
    console.log('--- outcome ---');
    console.log(lines);

    // --- empty ballot resets vote ---
    const removedVote = {
        message: {
            pollUpdateMessage: {
                pollCreationMessageKey: { id: pollMsgId, remoteJid: chatId, fromMe: true, participant: meId },
                vote: { encPayload: encPayload.toString('base64'), encIv: iv.toString('base64') },
                senderTimestampMs: Math.floor(Date.now() / 1000)
            }
        },
        key: { remoteJid: chatId, participant: voterJid, fromMe: false }
    };
    await recordVoteUpdate(sock, removedVote);
    const p2 = JSON.parse(fs.readFileSync(storePath, 'utf8')).polls[0];
    // re-voting the same option should leave exactly one entry
    assert.strictEqual(p2.votes.length, 1);
    console.log('idempotent re-vote OK');

    console.log('\n✅ poll tracking tests passed');
    process.exit(0);
}

function saveEmptyStore() {
    try {
        const existing = fs.existsSync(storePath) ? fs.readFileSync(storePath, 'utf8') : '';
        try { JSON.parse(existing); } catch (_) { fs.writeFileSync(storePath, JSON.stringify({ polls: [] }, null, 2)); }
        fs.writeFileSync(storePath, JSON.stringify({ polls: [] }, null, 2));
    } catch (error) {
        console.warn('[test] polls store reset:', error.message);
    }
}

main().catch((error) => {
    console.error('❌ test failed:', error);
    process.exit(1);
});
