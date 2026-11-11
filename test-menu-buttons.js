/**
 * Offline test: the interactive MENU buttons route correctly.
 *
 * It exercises the real decoding/routing helpers exported by main.js
 * (extractButtonId / resolveButtonCommand) for every reply shape WhatsApp
 * clients use, and renders the menu through the help command to confirm the
 * expected sections/ids are produced.
 *
 * Run: node test-menu-buttons.js
 */

const assert = require('assert');

const main = require('./main');
const help = require('./commands/help');

const { extractButtonId, resolveButtonCommand } = main;

/* ------------------------------------------------------------------ */
/* 1. Decoding every supported reply shape                             */
/* ------------------------------------------------------------------ */

// Native list menu (single_select) — the main menu uses this.
const listReply = {
    message: {
        listResponseMessage: {
            title: 'Menu',
            singleSelectReply: { selectedRowId: 'menu_general' }
        }
    }
};
assert.strictEqual(extractButtonId(listReply), 'menu_general', 'list row id decoded');

// Quick-reply button
assert.strictEqual(
    extractButtonId({ message: { buttonsResponseMessage: { selectedButtonId: 'menu_all', selectedDisplayText: 'All' } } }),
    'menu_all',
    'quick-reply id decoded'
);

// Template button reply
assert.strictEqual(
    extractButtonId({ message: { templateButtonReplyMessage: { selectedId: 'menu_owner' } } }),
    'menu_owner',
    'template id decoded'
);

// Interactive native flow (paramsJson as string AND double-encoded)
assert.strictEqual(
    extractButtonId({ message: { interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: JSON.stringify({ id: 'menu_admin' }) } } } }),
    'menu_admin',
    'native flow (string) decoded'
);
assert.strictEqual(
    extractButtonId({ message: { interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: JSON.stringify(JSON.stringify({ id: 'menu_media' })) } } } }),
    'menu_media',
    'native flow (double-encoded) decoded'
);

// Label-only fallback: clients that drop the id but keep the text.
assert.strictEqual(
    extractButtonId({ message: { buttonsResponseMessage: { selectedDisplayText: '⬅️ Back to Menu' } } }),
    'menu',
    'label fallback -> menu id'
);

/* ------------------------------------------------------------------ */
/* 2. Id -> command resolution                                         */
/* ------------------------------------------------------------------ */

assert.strictEqual(resolveButtonCommand('menu_general'), '.menu general');
assert.strictEqual(resolveButtonCommand('menu_all'), '.menu all');
assert.strictEqual(resolveButtonCommand('menu'), '.menu');
assert.strictEqual(resolveButtonCommand('ar_product'), '.products');
assert.strictEqual(resolveButtonCommand('.cdn up'), '.cdn up', 'raw command ids pass through');
assert.strictEqual(resolveButtonCommand('unknown_id'), 'unknown_id', 'unknown ids pass through');
assert.strictEqual(resolveButtonCommand(null), null);

// Every menu section has a working button id.
for (const key of Object.keys(help.SECTIONS)) {
    assert.strictEqual(
        resolveButtonCommand(`menu_${key}`),
        `.menu ${key}`,
        `menu_${key} -> .menu ${key}`
    );
}

/* ------------------------------------------------------------------ */
/* 3. Menu rendering (text fallback in a bare Node process)            */
/* ------------------------------------------------------------------ */

const sent = [];
const sock = {
    user: { id: '2348106439881:30@s.whatsapp.net' },
    sendMessage: async (jid, content) => {
        sent.push({ jid, content });
        return { key: { id: 'M' + sent.length, remoteJid: jid } };
    }
};
const msg = { key: { remoteJid: 'chat@s.whatsapp.net', fromMe: true, id: 'm1' } };
const lastText = () => [...sent].reverse().find((s) => s.content?.text)?.content.text || '';

(async () => {
    // .menu -> main menu
    sent.length = 0;
    await help(sock, 'chat@s.whatsapp.net', msg, null, '.menu');
    let t = lastText();
    assert.ok(/Open Menu/.test(t) || /Osunhive Chatbot/.test(t), 'main menu rendered');
    assert.ok(t.includes('menu_general'), 'main menu exposes section ids');

    // .menu general -> section body
    sent.length = 0;
    await help(sock, 'chat@s.whatsapp.net', msg, null, '.menu general');
    t = lastText();
    assert.ok(t.includes('General Commands'), 'general section rendered');
    assert.ok(t.includes('.ping'), 'general section has commands');
    assert.ok(t.includes('menu_owner') || t.includes('Back to Menu') || t.includes('menu'), 'navigation present');

    // .menu all -> full list
    sent.length = 0;
    await help(sock, 'chat@s.whatsapp.net', msg, null, '.menu all');
    assert.ok(
        sent.some((s) => (s.content?.text || '').includes('Owner Commands')),
        'full list rendered'
    );

    console.log('✅ all menu-button tests passed');
    process.exit(0);
})().catch((error) => {
    console.error('❌ test failed:', error);
    process.exit(1);
});