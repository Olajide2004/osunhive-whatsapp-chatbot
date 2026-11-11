/**
 * Offline test: the disclaimer / credit line must appear in the menu and the
 * guide, and must credit WhatsApp, Baileys and Osunhive.
 *
 * Run: node test-disclaimer.js
 */

const assert = require('assert');
const help = require('./commands/help');
const guideModule = require('./commands/guide');

const { DISCLAIMER } = help;
assert.ok(DISCLAIMER, 'DISCLAIMER exported');

// credits all three
for (const name of ['WhatsApp', 'Baileys', 'Osunhive']) {
    assert.ok(DISCLAIMER.includes(name), `disclaimer credits ${name}`);
}
assert.ok(DISCLAIMER.includes('⚠️'), 'disclaimer has a warning icon');
assert.ok(/not affiliated/i.test(DISCLAIMER), 'disclaimer says "not affiliated"');

// appears in the section text and the full menu
assert.ok(help.sectionText('general').includes(DISCLAIMER), 'section text has disclaimer');
assert.ok(help.fullMenuText().includes(DISCLAIMER), 'full menu has disclaimer');

// appears in the quick guide (sent to users)
const sent = [];
const sock = { sendMessage: async (_jid, content) => { sent.push(content.text); } };
guideModule(sock, 'chat@s.whatsapp.net', [], { key: {} })
    .then(() => {
        assert.ok(sent.length >= 1, 'guide sent something');
        assert.ok(sent[0].includes(DISCLAIMER), 'quick guide has disclaimer');
        console.log('✅ all disclaimer tests passed');
    })
    .catch((error) => {
        console.error('❌ test failed:', error);
        process.exitCode = 1;
    });
