/**
 * Offline test for commands/celebrate.js — fireworks + holiday countdowns.
 * Run: node test-celebrate.js
 */

const assert = require('assert');
const {
    fireworksCommand, countdownCommand,
    nextChristmas, nextNewYear, nextRamadan,
    buildCountdown, buildOne, FIREWORK_FRAMES, RAMADAN_STARTS
} = require('./commands/celebrate');

const DAY = 24 * 60 * 60 * 1000;

// --- fixed-date math -----------------------------------------------------
// 11 Nov 2026 UTC
const NOW = new Date(Date.UTC(2026, 10, 11, 12, 0, 0));

const xmas = nextChristmas(NOW);
assert.strictEqual(xmas.date.toISOString().slice(0, 10), '2026-12-25', 'Christmas 2026');
assert.strictEqual(xmas.days, 44, 'days to Christmas');

const ny = nextNewYear(NOW);
assert.strictEqual(ny.date.toISOString().slice(0, 10), '2027-01-01', 'New Year 2027');
assert.strictEqual(ny.days, 51, 'days to New Year');

const ram = nextRamadan(NOW);
assert.strictEqual(ram.date.toISOString().slice(0, 10), '2027-02-08', 'Ramadan 2027');
assert.strictEqual(ram.days, 89, 'days to Ramadan');

// roll-over: the day after Christmas points at next year
const afterXmas = new Date(Date.UTC(2026, 11, 26, 9, 0, 0));
assert.strictEqual(nextChristmas(afterXmas).date.toISOString().slice(0, 10), '2027-12-25');
// on the day itself => 0
const xmasDay = new Date(Date.UTC(2026, 11, 25, 8, 0, 0));
assert.strictEqual(nextChristmas(xmasDay).days, 0);

// Ramadan table is ordered and valid
for (let i = 0; i < RAMADAN_STARTS.length; i++) {
    const t = Date.parse(RAMADAN_STARTS[i] + 'T00:00:00Z');
    assert.ok(Number.isFinite(t), `${RAMADAN_STARTS[i]} is a real date`);
    if (i) assert.ok(t > Date.parse(RAMADAN_STARTS[i - 1] + 'T00:00:00Z'), 'Ramadan dates ascend');
}

// --- text builders -------------------------------------------------------
const all = buildCountdown(NOW);
for (const word of ['Christmas', 'New Year', 'Ramadan', '44 days', '51 days', '89 days']) {
    assert.ok(all.includes(word), `countdown mentions ${word}`);
}

assert.ok(buildOne('christmas', NOW).includes('25 Dec 2026'));
assert.ok(buildOne('xmas', NOW).includes('Christmas'), 'alias xmas');
assert.ok(buildOne('new year', NOW).includes('New Year'), 'alias new year');
assert.ok(buildOne('fasting', NOW).includes('Ramadan'), 'alias fasting');
assert.strictEqual(buildOne('easter', NOW), null, 'unknown event returns null');
assert.strictEqual(buildOne('', NOW), null, 'empty returns null');

// --- fireworks animation -------------------------------------------------
assert.ok(FIREWORK_FRAMES.length >= 3, 'several frames');
assert.ok(FIREWORK_FRAMES.some((f) => f.includes('🎆')), 'frames have fireworks');

(async () => {
    // countdownCommand: no arg => all three; with arg => one
    const sent = [];
    const sock = {
        sendMessage: async (jid, content) => {
            sent.push({ jid, content });
            // emulate a message key so edits can reference it
            return { key: { id: 'FW' + sent.length, remoteJid: jid } };
        }
    };
    const msg = { key: { remoteJid: 'chat@s.whatsapp.net', id: 'q1' } };

    sent.length = 0;
    await countdownCommand(sock, 'chat@s.whatsapp.net', msg, '');
    assert.ok(sent[0].content.text.includes('Christmas'), 'countdown all');
    assert.ok(!sent[0].content.edit, 'countdown is a plain message');

    sent.length = 0;
    await countdownCommand(sock, 'chat@s.whatsapp.net', msg, 'ramadan');
    assert.ok(/Ramadan/.test(sent[0].content.text), 'countdown one');
    assert.ok(sent[0].content.text.includes('🌙'), 'ramadan icon');

    sent.length = 0;
    await countdownCommand(sock, 'chat@s.whatsapp.net', msg, 'nonsense');
    assert.ok(sent[0].content.text.includes('Christmas'), 'unknown arg falls back to all');

    // fireworks: first message, then edits referencing its key
    sent.length = 0;
    await fireworksCommand(sock, 'chat@s.whatsapp.net', msg, 'Happy New Year');
    assert.ok(sent.length >= 2, 'fireworks animates');
    assert.ok(sent[0].content.text.includes('FIREWORKS'), 'header present');
    assert.ok(sent[0].content.text.includes('Happy New Year'), 'greeting included');
    assert.ok(!sent[0].content.edit, 'first send is not an edit');
    for (const later of sent.slice(1)) {
        assert.ok(later.content.edit, 'subsequent frames are edits');
        assert.strictEqual(later.content.edit.id, 'FW1', 'edits target the first message');
    }

    console.log('✅ all celebrate tests passed');
})().catch((error) => {
    console.error('❌ test failed:', error);
    process.exitCode = 1;
});