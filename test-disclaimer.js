/**
 * Offline test: the disclaimer/credit lives in the README ONLY — not in the
 * bot's menu/guide output and not in USAGE.md.
 *
 * Run: node test-disclaimer.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const help = require('./commands/help');
const guide = require('./commands/guide');

const readme = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
const usage = fs.readFileSync(path.join(__dirname, 'USAGE.md'), 'utf8');

// --- README carries the disclaimer -------------------------------------
assert.ok(/\[!WARNING\]/.test(readme), 'README has a warning block');
assert.ok(/⚠️/.test(readme), 'README has a warning icon');
assert.ok(/not affiliated/i.test(readme), 'README says "not affiliated"');
for (const credit of ['WhatsApp', 'Baileys', 'Osunhive']) {
    assert.ok(readme.includes(credit), `README credits ${credit}`);
}

// --- USAGE has none -----------------------------------------------------
assert.ok(!/Disclaimer/i.test(usage), 'USAGE has no disclaimer');
assert.ok(!/not affiliated/i.test(usage), 'USAGE has no affiliation note');

// --- the bot menu / guide have none ------------------------------------
const menuOutput = [help.sectionText('general'), help.fullMenuText()].join('\n');
const sent = [];
const sock = { sendMessage: async (_jid, content) => { sent.push(content.text); } };

(async () => {
    await guide(sock, 'chat@s.whatsapp.net', [], { key: {} });
    const botOutput = menuOutput + '\n' + sent.join('\n');

    assert.ok(!/Disclaimer/i.test(botOutput), 'bot output has no disclaimer');
    assert.ok(!/not affiliated/i.test(botOutput), 'bot output has no affiliation note');
    assert.ok(!botOutput.includes('Baileys'), 'bot output has no credit line');

    console.log('✅ all disclaimer tests passed');
})().catch((error) => {
    console.error('❌ test failed:', error);
    process.exitCode = 1;
});