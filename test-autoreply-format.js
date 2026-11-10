/**
 * Offline test for auto-reply formatting & copy boxes.
 * Run: node test-autoreply-format.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'data', 'autotyping.json');
const backup = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null;

const { markdownToWhatsApp, wrapInCopyBox, applyCopyBox, formatAutoReply } = require('./commands/autotyping');

function setConfig(patch) {
    const cfg = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    fs.writeFileSync(configPath, JSON.stringify({ ...cfg, ...patch }, null, 2));
}

function run() {
    // --- fenced code becomes a WhatsApp code block (copy button) ---
    const code = 'Here you go:\n\n```js\nconst a = 1;\nconsole.log(a);\n```\nDone.';
    const out = markdownToWhatsApp(code);
    assert.ok(out.includes('```\nconst a = 1;'), 'code fence preserved');
    assert.ok(out.includes('🖥️ *js*'), 'language label present');
    assert.ok(out.includes('```\nconst a = 1;\nconsole.log(a);\n```'), 'fence block intact');
    assert.ok(!out.includes('*js*const'), 'label is outside the fence');

    // --- code containing a stray fence cannot break the block ---
    const nasty = '```js\nconst s = "```";\n```';
    const nastyOut = markdownToWhatsApp(nasty);
    assert.strictEqual((nastyOut.match(/```/g) || []).length, 2, 'exactly one fenced block');

    // --- inline code stays single-backtick ---
    const inline = 'Use `npm install` then run.';
    assert.ok(markdownToWhatsApp(inline).includes('`npm install`'));

    // --- bold stays bold, not italic (regression) ---
    assert.ok(markdownToWhatsApp('**bold** word').includes('*bold*'));

    // --- header / list conversion still works ---
    assert.ok(markdownToWhatsApp('# Title').includes('🔷 *Title*'));
    assert.ok(markdownToWhatsApp('- one\n- two').includes('• one'));

    // --- copy box helpers ---
    const box = wrapInCopyBox('hello\nworld');
    assert.strictEqual(box, '```\nhello\nworld\n```');
    assert.strictEqual((wrapInCopyBox('a ``` b').match(/```/g) || []).length, 2, 'inner fence neutralised');

    // --- applyCopyBox: mode 'code' leaves plain text alone ---
    assert.strictEqual(applyCopyBox('plain text', { copyBox: 'code' }), 'plain text');
    // --- mode 'all' wraps plain TXT ---
    assert.ok(applyCopyBox('plain text', { copyBox: 'all' }).startsWith('```'));
    // --- an existing code block is already the copy box ---
    const block = '🖥️ *js*\n```\ncode\n```';
    assert.strictEqual(applyCopyBox(block, { copyBox: 'all' }), block, 'no double wrapping');
    // --- mode 'off' does nothing ---
    assert.strictEqual(applyCopyBox('plain text', { copyBox: 'off' }), 'plain text');

    // --- end-to-end through formatAutoReply ---
    setConfig({ codeHighlight: true, copyBox: 'all' });
    const e2e = formatAutoReply('Plain answer with no code.');
    assert.ok(e2e.startsWith('```') && e2e.endsWith('```'), 'txt reply wrapped in copy box');

    setConfig({ codeHighlight: true, copyBox: 'code' });
    const e2e2 = formatAutoReply('Plain answer with no code.');
    assert.ok(!e2e2.startsWith('```'), 'code mode leaves txt alone');

    setConfig({ codeHighlight: true, copyBox: 'all' });
    const e2e3 = formatAutoReply('```py\nprint(1)\n```');
    assert.strictEqual((e2e3.match(/```/g) || []).length, 2, 'code reply not double-wrapped');

    console.log('✅ all auto-reply format tests passed');
}

try {
    run();
} catch (error) {
    console.error('❌ test failed:', error);
    process.exitCode = 1;
} finally {
    if (backup !== null) fs.writeFileSync(configPath, backup);
}
