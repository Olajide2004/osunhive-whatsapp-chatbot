/**
 * Osunhive Chatbot — Poll tracking
 *
 * WhatsApp polls are encrypted ballot messages. Baileys ships with a
 * `decryptPollVote` utility, but the vote path is commented out of
 * `processMessage`, so we collect votes ourselves in `data/polls.json`:
 *
 *   • send our own polls with a locally generated `messageSecret`,
 *   • collect incoming `pollUpdateMessage` events,
 *   • decrypt each ballot and count votes per option.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { decryptPollVote } = require('@whiskeysockets/baileys/lib/Utils/process-message');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');

const CREATE_LIMIT = 12;          // WhatsApp polls cap at ~12 options
const OPTION_FIELD = 256;         // protocol limit for question/option text
const pollsPath = path.join(__dirname, '..', 'data', 'polls.json');

/** SHA-256 raw digest string (UTF-8) used as the ballot option key. */
const hashOption = (name) =>
    crypto.createHash('sha256').update(String(name || '')).digest().toString();

const optionHashes = (values) => new Map(values.map((n) => [hashOption(n), n]));

/** Ensure decryptPollVote gets Buffers (it is tolerant of base64 strings). */
const asBuffer = (value) => {
    if (!value) return value;
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (typeof value === 'string') return Buffer.from(value, 'base64');
    if (typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
    return Buffer.from(String(value));
};

/* ------------------------------------------------------------------ */
/* Storage                                                            */
/* ------------------------------------------------------------------ */

function load() {
    try {
        const raw = JSON.parse(fs.readFileSync(pollsPath, 'utf8') || '');
        if (Array.isArray(raw?.polls)) return raw;
    } catch (error) { /* first run */ }
    return { polls: [] };
}

function save(store) {
    fs.writeFileSync(pollsPath, JSON.stringify(store, null, 2));
}

/** Key of `chatId || poll.id` that identifies the author of a poll or poll update. */
function creatorJid(meId, poll) {
    return poll.createdBy || meId || '';
}

/** Extract participant (voter) JID from a poll-update message. */
function voterJid(metaKey, msgKey) {
    const key = metaKey || msgKey || {};
    if (key.fromMe) return '';
    return jidNormalizedUser(key.participantAlt || key.participant || key.remoteJid || '');
}

/* ------------------------------------------------------------------ */
/* Public API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Create a poll and persist it so we can decrypt future ballot updates.
 * @returns {Promise<string>} poll id (creation message key id)
 */
async function registerPoll(sock, chatId, { question, options, selectableCount = 1, quoted = null }) {
    const cleanOptions = [...new Set(
        options.map((o) => String(o || '').trim()).filter((o) => o.length > 0)
    )].slice(0, CREATE_LIMIT);
    if (!question || cleanOptions.length < 2) return null;

    const total = cleanOptions.length;
    const selectable = Math.max(1, Math.min(selectableCount === -1 ? total : Number(selectableCount) || 1, total));
    const secret = crypto.randomBytes(32);
    const meId = jidNormalizedUser(sock?.user?.lid || sock?.user?.id || '');

    const result = await sock.sendMessage(chatId, {
        poll: {
            name: String(question || '').trim().slice(0, OPTION_FIELD),
            values: cleanOptions,
            selectableCount: selectable,
            messageSecret: secret,
            toAnnouncementGroup: false
        }
    }, quoted ? { quoted } : undefined);

    const store = load();
    const id = result?.key?.id || crypto.randomBytes(6).toString('hex');
    store.polls.unshift({
        id,
        chatId,
        createdBy: meId,
        name: String(question || '').trim().slice(0, OPTION_FIELD),
        values: cleanOptions,
        selectableCount: selectable,
        secret: secret.toString('base64'),
        votes: [], // [{ voterJid, selected: [optionHash] }]
        updatedAt: Date.now(),
        createdAt: Date.now()
    });
    store.polls = store.polls.slice(0, 50);
    save(store);
    return id;
}

/** Look up a poll by id (or, for `results`, the latest for this chat). */
function findPoll(pollId, fallbackChatId) {
    const store = load();
    if (pollId) return store.polls.find((p) => p.id === pollId);
    return store.polls.find((p) => p.chatId === fallbackChatId) || store.polls[0] || null;
}

/**
 * Process one `pollUpdateMessage` from `messages.upsert` and record the voter's
 * selections. Returns true when a known poll was updated.
 */
async function recordVoteUpdate(sock, message) {
    const meta = message?.message?.pollUpdateMessage;
    if (!meta?.pollCreationMessageKey?.id || !meta?.vote?.encPayload) return false;

    const store = load();
    const poll = store.polls.find((p) => p.id === meta.pollCreationMessageKey.id);
    if (!poll) return false;

    // The voter JIDs in the sign are relative to the ballot creator.
    const meId = jidNormalizedUser(sock?.user?.lid || sock?.user?.id || '');
    const creator = creatorJid(meId, poll);
    const voter = voterJid(meta.pollUpdateMessageKey, message?.key);
    const optionMap = optionHashes(poll.values);

    let decrypted = null;
    try {
        decrypted = decryptPollVote(
            { encPayload: asBuffer(meta.vote.encPayload), encIv: asBuffer(meta.vote.encIv) },
            {
                pollCreatorJid: creator,
                pollMsgId: poll.id,
                pollEncKey: asBuffer(poll.secret),
                voterJid: jidNormalizedUser(voter || meId)
            }
        );
    } catch (error) {
        console.error('[polls] decrypt failed:', error.message);
        return false;
    }

    const selectedHashes = (decrypted?.selectedOptions || [])
        .map((b) => Buffer.from(b).toString())
        .filter((h) => optionMap.has(h));

    // Latest vote deselects previous entries from the same voter.
    store.polls = store.polls.map((p) => {
        if (p.id !== poll.id) return p;
        p.votes = (p.votes || []).filter((vote) => vote.voterJid !== voter && vote.voterJid !== '');
        if (voter && selectedHashes.length > 0) p.votes.push({ voterJid: voter, selected: selectedHashes });
        p.updatedAt = Date.now();
        return p;
    });
    save(store);
    return true;
}

/** Aggregate vote counts percentage wise. Returns a printable list. */
function aggregateResults(poll) {
    const counts = new Map(poll.values.map((n) => [hashOption(n), { name: n, count: 0 }]));
    for (const vote of poll.votes || []) {
        for (const h of vote.selected || []) {
            if (counts.has(h)) counts.get(h).count += 1;
        }
    }
    const total = poll.votes.length || 1;
    return [...counts.values()]
        .sort((a, b) => b.count - a.count)
        .map((r) => `${Math.round((r.count / total) * 100)}% · ${r.count} — ${r.name}`);
}

/** Multi-line results string for `.poll results`. */
function renderResults(poll) {
    const rows = aggregateResults(poll);
    return [
        `🗳️ *${poll.name}*`,
        `👥 ${poll.votes.length} voter(s)`,
        '',
        ...rows
    ].join('\n');
}

/** Recent polls in unspecified chat order. */
function pollList() {
    return load().polls;
}

module.exports = {
    registerPoll,
    recordVoteUpdate,
    findPoll,
    aggregateResults,
    renderResults,
    pollList,
    OPTION_FIELD,
    CREATE_LIMIT
};
