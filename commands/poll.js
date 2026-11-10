/**
 * Poll command — create polls, track live votes and show results.
 *
 * Usage:
 *   .poll Question? | Option A | Option B [| Option C ...]   create single-choice poll
 *   .poll multi Question? | ...                              create multi-choice poll
 *   .poll count:2 Question? | A | B | C | D                   allow up to 2 votes
 *   .poll results [id]                                        show live aggregated results
 *   .poll list                                                show recent polls created
 *   .poll delete (<id>|reply)                                 delete a poll message
 */

const { registerPoll, findPoll, renderResults, pollList } = require('../lib/polls');

const MAX_OPTIONS = 12;
const MAX_FIELD = 256;
const MAX_Q = 256;

const trimLen = (value, max) => {
    const v = String(value || '').trim();
    return v.length > max ? v.slice(0, max) : v;
};

/**
 * Parse the full argument tail in one pass:
 * [multi|count:N] Question? | A | B | C
 */
function parseCommand(raw) {
    let body = String(raw || '').trim();
    let selectableCount = 1;

    if (/^multi\b/i.test(body)) {
        selectableCount = MAX_OPTIONS;
        body = body.replace(/^multi\b\s*/i, '');
    } else {
        const m = /^count:(\d+)\s*/i.exec(body);
        if (m) {
            selectableCount = Math.max(1, Number(m[1]) || 1);
            body = body.slice(m[0].length);
        }
    }

    const parts = body.split('|').map((s) => s.trim()).filter(Boolean);
    const [question, ...options] = parts;
    return { question, options, selectableCount };
}

async function createPollCommand(sock, chatId, raw, message) {
    const { question, options, selectableCount } = parseCommand(raw);

    if (!question || options.length < 2) {
        await sock.sendMessage(chatId, {
            text: '❌ Usage: `.poll Question? | Option A | Option B [| Option C ...]`\n' +
                '• `.poll multi Question? | A | B | C` for multiple answers\n' +
                '• `.poll count:2 Question? | A | B | C | D` for up to 2 votes per person'
        });
        return;
    }

    await registerPoll(sock, chatId, {
        question: trimLen(question, MAX_Q),
        options: options.slice(0, MAX_OPTIONS).map((o) => trimLen(o, MAX_FIELD)),
        selectableCount,
        quoted: message || null
    });
}

async function resultsCommand(sock, chatId, raw) {
    const id = raw.trim();
    const poll = id ? findPoll(id, chatId) : findPoll(null, chatId);
    if (!poll) {
        await sock.sendMessage(chatId, { text: '❌ No tracked polls for this chat yet. Try `.poll list`.' });
        return;
    }
    await sock.sendMessage(chatId, { text: renderResults(poll) });
}

async function listCommand(sock, chatId) {
    const recent = pollList().slice(0, 5);
    if (recent.length === 0) {
        await sock.sendMessage(chatId, { text: '📊 No polls tracked yet. Create one with `.poll` first.' });
        return;
    }
    const lines = recent.map((p) => `• *${trimLen(p.name, 40)}* — ${(p.votes || []).length} vote(s) · \`${p.id}\``);
    await sock.sendMessage(chatId, { text: `📊 *Recent polls*\n${lines.join('\n')}` });
}

async function deleteCommand(sock, chatId, raw, message) {
    const quoted = message?.message?.extendedTextMessage?.contextInfo?.stanzaId;
    const id = raw.trim() || (quoted ? null : findPoll(null, chatId)?.id);

    try {
        if (quoted) {
            await sock.sendMessage(chatId, {
                delete: {
                    remoteJid: chatId,
                    id: quoted,
                    fromMe: true,
                    participant: message.key?.participant || undefined
                }
            });
            return;
        }
        if (!id) {
            await sock.sendMessage(chatId, { text: '❌ Reply to a poll message with `.poll delete` or pass `.poll delete <poll-id>`.' });
            return;
        }
        const poll = findPoll(id, chatId);
        if (!poll) {
            await sock.sendMessage(chatId, { text: '❌ Poll not found.' });
            return;
        }
        await sock.sendMessage(chatId, { delete: { remoteJid: poll.chatId, id: poll.id, fromMe: true } });
    } catch (error) {
        await sock.sendMessage(chatId, { text: `❌ Couldn't delete poll: ${error.message}` });
    }
}

async function handlePoll(sock, chatId, args, message, senderId) {
    const tokens = Array.isArray(args) ? [...args] : String(args || '').split(' ').filter(Boolean);
    const raw = tokens.join(' ').trim();
    const sub = (tokens[0] || '').toLowerCase();

    if (sub === 'results' || sub === 'result' || sub === 'res') {
        return resultsCommand(sock, chatId, tokens.slice(1).join(' ').trim());
    }
    if (sub === 'list') {
        return listCommand(sock, chatId);
    }
    if (sub === 'delete' || sub === 'remove') {
        return deleteCommand(sock, chatId, tokens.slice(1).join(' ').trim(), message);
    }
    // Create (also handles `.poll multi ...` / `.poll count:N ...`)
    return createPollCommand(sock, chatId, raw, message);
}

module.exports = {
    handlePoll,
    createPollCommand,
    MAX_OPTIONS
};
