/**
 * Offline test for the Meta AI persona helpers.
 * Run: node test-meta-style.js
 */

const assert = require('assert');
const {
    META_PERSONA,
    buildMetaPrompt,
    buildFollowUps,
    formatMetaReply,
    splitForStream,
    streamReply
} = require('./lib/metaStyle');

function run() {
    // --- persona prompt ---
    const prompt = buildMetaPrompt('How do I build a bot?');
    assert.ok(prompt.startsWith(META_PERSONA), 'persona first');
    assert.ok(prompt.includes('How do I build a bot?'), 'question included');
    assert.ok(/meta ai/i.test(prompt), 'mentions Meta AI style');

    // --- follow-ups are topic aware ---
    assert.ok(buildFollowUps('how do i build a bot').some((q) => /deploy/i.test(q)), 'bot topic');
    assert.ok(buildFollowUps('what is the premium price').some((q) => /premium|pay/i.test(q)), 'pricing topic');
    assert.ok(buildFollowUps('tell me about the blogger template').some((q) => /template|install|demo/i.test(q)), 'template topic');
    assert.strictEqual(buildFollowUps('random gibberish').length, 3, 'default suggestions');

    // --- headline is added when missing ---
    const noHead = formatMetaReply('Osunhive is a digital learning hub.', {
        userMessage: 'what is osunhive', suggest: false, sources: false
    });
    assert.ok(noHead.startsWith('*Osunhive is a digital learning hub.*'), 'headline bolded');

    // --- headline is preserved when already bold ---
    const withHead = formatMetaReply('*Welcome to Osunhive*\n\nMore text here.', {
        userMessage: 'hi', suggest: false, sources: false
    });
    assert.ok(withHead.startsWith('*Welcome to Osunhive*'), 'headline kept');
    assert.ok(!withHead.startsWith('**'), 'not double bolded');

    // --- follow-ups + footer ---
    const full = formatMetaReply('*Bot Building*\n\nYou can build bots step by step.', {
        userMessage: 'how do i build a bot', suggest: true, sources: true
    });
    assert.ok(full.includes('*You might also ask* 🤔'), 'follow-up header');
    assert.ok(/• .+\n• .+\n• /.test(full), 'three follow-up bullets');
    assert.ok(full.includes('— 🔷 *Osunhive AI*'), 'signature');
    assert.ok(full.includes('🔗 https://www.osunhive.name.ng'), 'source link');

    // --- no duplicate link when the answer already has one ---
    const linked = formatMetaReply('*Links*\n\nSee https://www.osunhive.name.ng for more.', {
        userMessage: 'site', suggest: false, sources: true
    });
    assert.strictEqual((linked.match(/osunhive\.name\.ng/g) || []).length, 1, 'link not duplicated');

    // --- toggles ---
    const bare = formatMetaReply('*Title*\n\nBody.', { suggest: false, sources: false, signature: false });
    assert.ok(!bare.includes('You might also ask'), 'suggestions off');
    assert.ok(!bare.includes('Osunhive AI'), 'signature off');

    // --- code blocks are never split mid-fence ---
    const codeReply = [
        '*Example*',
        '',
        '```js',
        'const a = 1;',
        'const b = 2;',
        'const c = a + b;',
        'console.log(c);',
        '```',
        '',
        'That is all.'
    ].join('\n');
    const chunks = splitForStream(codeReply, 40);
    const opened = chunks.filter((c) => /^\s*```/.test(c)).length;
    assert.ok(chunks.length >= 2, 'splits into chunks');
    // Every chunk must have balanced fences (open+close) or none at all.
    for (const chunk of chunks) {
        const fences = (chunk.match(/```/g) || []).length;
        assert.strictEqual(fences % 2, 0, `unbalanced fence in chunk: ${JSON.stringify(chunk)}`);
    }

    // --- short reply: single message, no edits ---
    let sends = 0;
    const sock = {
        sendMessage: async () => { sends++; return { key: { id: 'M1' } }; }
    };
    return (async () => {
        await streamReply(sock, 'chat', 'Short reply', {});
        assert.strictEqual(sends, 1, 'short reply sent once');

        // --- long reply: streams then edits, final has no cursor ---
        const edits = [];
        const streamSock = {
            sendMessage: async (jid, content) => {
                if (content.edit) { edits.push(content.text); return { key: content.edit }; }
                return { key: { id: 'M2' } };
            }
        };
        const long = Array.from({ length: 12 }, (_, i) => `Line ${i + 1} with some words to make it long.`).join('\n');
        await streamReply(streamSock, 'chat', long, { chunkSize: 60, delayMs: 0, maxEdits: 20 });
        assert.ok(edits.length > 0, 'streamed via edits');
        assert.ok(!edits[edits.length - 1].includes('▍'), 'final edit removes the cursor');
        assert.strictEqual(edits[edits.length - 1], long, 'final text is complete');

        // --- edit failure falls back to a plain send ---
        let fallback = null;
        const brokenSock = {
            sendMessage: async (jid, content) => {
                if (content.edit) throw new Error('Connection Closed');
                if (content.text && content.text === long) fallback = content.text;
                return { key: { id: 'M3' } };
            }
        };
        await streamReply(brokenSock, 'chat', long, { chunkSize: 60, delayMs: 0, maxEdits: 20 });
        assert.strictEqual(fallback, long, 'fallback plain send used the full text');

        console.log('✅ all meta-style tests passed');
    })();
}

Promise.resolve()
    .then(run)
    .catch((error) => {
        console.error('❌ test failed:', error);
        process.exitCode = 1;
    });
