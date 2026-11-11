/**
 * Offline test for commands/autopoststatus.js — no WhatsApp connection needed.
 * Run: node test-autopoststatus.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'data', 'autoPostStatus.json');
const backup = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null;

const {
    autopostStatusCommand,
    nextStatusText,
    readConfig,
    postTextStatus,
    deleteLastStatus
} = require('./commands/autopoststatus');

const sent = [];

function makeSock() {
    return {
        user: { id: '<PHONE_NUMBER>:30@s.whatsapp.net' },
        groupFetchAllParticipating: async () => ({}),
        groupMetadata: async () => ({ participants: [] }),
        sendMessage: async (jid, content, options = {}) => {
            sent.push({ jid, content, options });
            return { key: { id: 'TEST' + sent.length, remoteJid: jid, fromMe: true } };
        }
    };
}

function makeMessage(body, extra = {}) {
    return {
        key: { remoteJid: '<PHONE_NUMBER>@s.whatsapp.net', fromMe: true, id: 'MSG' + Date.now() },
        message: { conversation: body, ...extra }
    };
}

const sock = makeSock();
// Enough known contacts that the recipient cap can be exercised without
// relying on a real `session/` folder (CI has no session and must not need one).
const knownContacts = [
    '2348011111111', '2348022222222', '2348033333333', '2348044444444',
    '2348055555555', '2348066666666', '2348077777777', '2348088888888'
];
const storeRef = {
    contacts: Object.fromEntries(knownContacts.map((n) => [`${n}@s.whatsapp.net`, {}])),
    chats: {},
    messages: {}
};

function lastText() {
    const entry = sent[sent.length - 1];
    return entry && entry.content && entry.content.text;
}

async function run() {
    // Fresh config
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    let config = readConfig();
    assert.strictEqual(config.enabled, false, 'defaults to disabled');
    assert.strictEqual(config.texts.length, 0, 'empty rotation');

    // nextStatusText with empty pool returns main text
    assert.strictEqual(nextStatusText({ ...config, text: 'hello', texts: [] }).text, 'hello');

    // rotation cycles
    const rot = { text: 'main', texts: ['a', 'b'], textIndex: 1 };
    assert.deepStrictEqual(nextStatusText(rot), { text: 'b', nextIndex: 0 });

    // command: settings
    await autopostStatusCommand(sock, '<PHONE_NUMBER>@s.whatsapp.net', makeMessage('.autopoststatus'), storeRef);
    assert.ok(lastText().includes('Auto Status Post'), 'settings shown');

    // on/off
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus on'), storeRef);
    assert.strictEqual(readConfig().enabled, true);
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus off'), storeRef);
    assert.strictEqual(readConfig().enabled, false);

    // text
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus text Hello world'), storeRef);
    assert.strictEqual(readConfig().text, 'Hello world');

    // add / list / remove / clear
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus add First'), storeRef);
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus add Second'), storeRef);
    assert.strictEqual(readConfig().texts.length, 2);

    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus list'), storeRef);
    assert.ok(lastText().includes('First') && lastText().includes('Second'));

    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus remove 1'), storeRef);
    assert.deepStrictEqual(readConfig().texts, ['Second']);

    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus clear'), storeRef);
    assert.deepStrictEqual(readConfig().texts, []);

    // bg / font validation
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus bg #FF0000'), storeRef);
    assert.strictEqual(readConfig().backgroundColor, '#FF0000');
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus bg nope'), storeRef);
    assert.ok(lastText().includes('6 or 8 hex'), 'rejects bad colour');

    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus font 3'), storeRef);
    assert.strictEqual(readConfig().font, 3);
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus font 9'), storeRef);
    assert.ok(lastText().includes('0 to 5'), 'rejects bad font');

    // interval bounds
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus interval 10'), storeRef);
    assert.strictEqual(readConfig().intervalMinutes, 10);
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus interval 1'), storeRef);
    assert.ok(lastText().includes('between 5 and 1440'));

    // preview
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus preview'), storeRef);
    assert.ok(lastText().includes('Next status preview'));

    // now: text post applies style + statusJidList
    sent.length = 0;
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus now Instant post'), storeRef);
    const post = sent.find((s) => s.jid === 'status@broadcast');
    assert.ok(post, 'posted to status@broadcast');
    assert.strictEqual(post.content.text, 'Instant post');
    assert.strictEqual(post.options.backgroundColor, '#FF0000');
    assert.strictEqual(post.options.font, 3);
    assert.ok(Array.isArray(post.options.statusJidList) && post.options.statusJidList.length >= 1);
    assert.ok(post.options.statusJidList.every((j) => j.endsWith('@s.whatsapp.net')),
        'no @lid recipients');
    assert.ok(lastText().includes('recipient(s)'), 'reports recipient count');

    // postTextStatus uses passed style
    sent.length = 0;
    await postTextStatus(sock, 'styled', storeRef, '#123456', 2);
    const styled = sent[sent.length - 1];
    assert.strictEqual(styled.options.backgroundColor, '#123456');
    assert.strictEqual(styled.options.font, 2);

    // scheduled text via now
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus text Scheduled'), storeRef);
    sent.length = 0;
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus now'), storeRef);
    assert.strictEqual(sent.find((s) => s.jid === 'status@broadcast').content.text, 'Scheduled');

    // delete uses stored id
    config = readConfig();
    assert.ok(config.lastStatus && config.lastStatus.id, 'last status stored');
    const storedId = config.lastStatus.id;
    sent.length = 0;
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus delete'), storeRef);
    const del = sent.find((s) => s.jid === 'status@broadcast');
    assert.ok(del && del.content.delete, 'delete issued');
    assert.strictEqual(del.content.delete.id, storedId, 'deletes the stored status id');
    assert.strictEqual(del.content.delete.remoteJid, 'status@broadcast');
    assert.strictEqual(del.content.delete.fromMe, true);
    assert.strictEqual(readConfig().lastStatus, null);

    // media post helpers
    sent.length = 0;
    const { postMediaStatus } = require('./commands/autopoststatus');
    await postMediaStatus(sock, 'image', Buffer.from('fake-jpeg'), 'caption here', storeRef);
    const img = sent.find((s) => s.jid === 'status@broadcast');
    assert.ok(img && Buffer.isBuffer(img.content.image), 'image status sent');
    assert.strictEqual(img.content.caption, 'caption here');

    sent.length = 0;
    await postMediaStatus(sock, 'video', Buffer.from('fake-mp4'), '', storeRef);
    const vid = sent.find((s) => s.jid === 'status@broadcast');
    assert.ok(vid && Buffer.isBuffer(vid.content.video), 'video status sent');

    // delete with nothing stored
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus delete'), storeRef);
    assert.ok(lastText().includes('No stored status'));

    // recipients: manual list
    sent.length = 0;
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus recipients add 2348012345678, +2348098765432'), storeRef);
    assert.deepStrictEqual(readConfig().recipients, ['2348012345678', '2348098765432']);

    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus recipients add abc'), storeRef);
    assert.ok(lastText().includes('Rejected'), 'rejects invalid number');

    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus recipients'), storeRef);
    assert.ok(lastText().includes('Known contacts'), 'shows discovery stats');
    assert.ok(lastText().includes('2348012345678'), 'shows manual numbers');

    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus recipients remove 1'), storeRef);
    assert.deepStrictEqual(readConfig().recipients, ['2348098765432']);

    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus recipients clear'), storeRef);
    assert.deepStrictEqual(readConfig().recipients, []);

    // limit / cap
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus limit 5'), storeRef);
    assert.strictEqual(readConfig().maxRecipients, 5);
    const { discoverStatusRecipients, normalizePhone, statusTimeout } = require('./commands/autopoststatus');
    const discovered = await discoverStatusRecipients(sock, storeRef);
    assert.strictEqual(discovered.list.length, 5, 'cap applies');
    assert.ok(discovered.knownCount >= discovered.list.length);
    assert.strictEqual(discovered.capped, discovered.knownCount > 5);

    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus limit 0'), storeRef);
    assert.strictEqual(readConfig().maxRecipients, 0);
    assert.ok(lastText().includes('every known contact'));

    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus limit -3'), storeRef);
    assert.ok(lastText().includes('0 = unlimited'));

    // phone normalisation
    assert.strictEqual(normalizePhone('+234 801 234 5678'), '2348012345678@s.whatsapp.net');
    assert.strictEqual(normalizePhone('abc'), null);
    assert.strictEqual(normalizePhone('123'), null);

    // timeout scales with fan-out
    assert.ok(statusTimeout(5000) > statusTimeout(10));
    assert.ok(statusTimeout(999999) <= 300000);

    // unknown action
    await autopostStatusCommand(sock, 'x@s.whatsapp.net', makeMessage('.autopoststatus wat'), storeRef);
    assert.ok(lastText().includes('Unknown option'));

    // non-owner is rejected — patch isOwner via fromMe false and non-owner JID
    sent.length = 0;
    const strangerMsg = {
        key: { remoteJid: '2348099999999@s.whatsapp.net', fromMe: false, id: 'M2' },
        message: { conversation: '.autopoststatus on' }
    };
    await autopostStatusCommand(sock, '2348099999999@s.whatsapp.net', strangerMsg, storeRef);
    assert.ok(lastText().includes('only available for the owner'), 'non-owner blocked');

    // direct-link / CDN helpers
    const {
        extractUrl, normalizeMediaUrl, resolveLink, looksLikeMediaLink,
        guessMediaKind, captionFromBody
    } = require('./commands/autopoststatus');

    const ID = '1GwuQmqxrh2cexkO5RwZAItslY7KXdOKZ';
    const CDN = `https://cdn.osunhive.name.ng/download/${ID}`;

    assert.strictEqual(extractUrl(`see ${CDN} now`), CDN);
    assert.strictEqual(extractUrl('no link here'), null);

    // every CDN form normalises to /download/<id>
    assert.strictEqual(normalizeMediaUrl(`https://cdn.osunhive.name.ng/${ID}`), CDN);
    assert.strictEqual(normalizeMediaUrl(CDN), CDN);
    assert.strictEqual(normalizeMediaUrl(`cdn:${ID}`), CDN);
    assert.strictEqual(normalizeMediaUrl('https://example.com/a.mp4'), 'https://example.com/a.mp4');

    assert.strictEqual(resolveLink(`cdn:${ID}`), CDN);
    assert.strictEqual(resolveLink(`x https://example.com/a.mp4`), 'https://example.com/a.mp4');
    assert.strictEqual(resolveLink('.autopoststatus list'), null);

    assert.ok(looksLikeMediaLink(CDN));
    assert.ok(looksLikeMediaLink('https://example.com/a.mp4'));
    assert.strictEqual(looksLikeMediaLink('https://example.com/page'), false);

    assert.strictEqual(guessMediaKind('https://x/a.MP4'), 'video');
    assert.strictEqual(guessMediaKind('https://x/a.webp?x=1'), 'image');
    assert.strictEqual(guessMediaKind(CDN), null);

    assert.strictEqual(captionFromBody(`${CDN} | My caption`), 'My caption');
    assert.strictEqual(captionFromBody(`cdn:${ID} hello`), 'hello');

    console.log('✅ all autopoststatus tests passed');
}

run()
    .catch((error) => {
        console.error('❌ test failed:', error);
        process.exitCode = 1;
    })
    .finally(() => {
        if (backup !== null) fs.writeFileSync(configPath, backup);
    });
