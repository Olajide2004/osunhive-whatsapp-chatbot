/**
 * Osunhive Chatbot — "Meta AI" reply persona
 *
 * Makes auto-replies look and behave like a Meta AI answer in WhatsApp:
 *   • a warm assistant tone with consistent emoji
 *   • a short bold headline, • bullets and tight spacing
 *   • suggested follow-up questions
 *   • a source/signature footer
 *   • an optional "streaming" effect (progressive message edits)
 *
 * Everything here is presentation-only; the answer text still comes from the
 * configured AI engine chain.
 */

const WEBSITE = 'https://www.osunhive.name.ng';

/**
 * Persona instructions prepended to the user's question for API engines.
 * The footer / follow-ups are added by us, so the model is told not to.
 */
const META_PERSONA = [
    'You are Osunhive AI, the friendly WhatsApp assistant for Osunhive (https://www.osunhive.name.ng).',
    'Answer in the style of Meta AI: warm, confident, accurate and concise.',
    '',
    'Formatting rules:',
    '- Open with a short *bold* headline (max 8 words).',
    '- Use • bullets for lists and keep paragraphs to 1-2 lines.',
    '- Use a few relevant emoji, consistently, but do not overdo it.',
    '- Use WhatsApp formatting: *bold*, _italic_, ~strikethrough~ and backticks for inline code.',
    '- Put any code in a fenced block with the language name, e.g. ```js ... ```.',
    '- Do NOT add a signature, a "Sources" line, or suggested follow-up questions; the app adds those.'
].join('\n');

/** Build the prompt sent to the engine when Meta style is on. */
function buildMetaPrompt(userMessage) {
    return `${META_PERSONA}\n\nUser question: ${String(userMessage || '').trim()}`;
}

/* ------------------------------------------------------------------ */
/* Follow-up suggestions                                               */
/* ------------------------------------------------------------------ */

const TOPIC_SUGGESTIONS = [
    {
        test: /(bot|automation|baileys|whatsapp bot|deploy|host|vps|server)/i,
        items: ['Show me a ready bot template', 'How do I deploy a bot to a VPS?', 'Which commands does the bot support?']
    },
    {
        test: /(premium|price|pricing|pay|cost|plan|subscribe)/i,
        items: ['What is included in Premium?', 'How do I pay for Premium?', 'Do you have a free plan?']
    },
    {
        test: /(template|blogger|blog|theme|website|site|landing|ui)/i,
        items: ['How do I install the template?', 'Is the template SEO friendly?', 'Show me a live demo']
    },
    {
        test: /(app|android|flutter|build an app|mobile)/i,
        items: ['How do I build an Android app?', 'Do you offer app templates?', 'How long does it take?']
    },
    {
        test: /(learn|course|tutorial|tutorials|training|teach)/i,
        items: ['Where do I start learning?', 'Are the tutorials free?', 'Do you have a community?']
    }
];

const DEFAULT_SUGGESTIONS = [
    'What is Osunhive?',
    'How do I build a bot?',
    'Show me your premium templates'
];

/**
 * Pick 3 follow-up questions relevant to the user's message.
 * @param {string} userMessage
 * @param {string} [reply]
 * @returns {string[]}
 */
function buildFollowUps(userMessage = '', reply = '') {
    const haystack = `${userMessage} ${reply}`;

    for (const topic of TOPIC_SUGGESTIONS) {
        if (topic.test.test(haystack)) return topic.items.slice(0, 3);
    }

    return DEFAULT_SUGGESTIONS.slice(0, 3);
}

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

/** Give the answer a Meta-AI-style bold headline if it lacks one. */
function ensureHeadline(body) {
    const lines = body.split('\n');
    const firstIndex = lines.findIndex((line) => line.trim());

    if (firstIndex === -1) return body;

    const first = lines[firstIndex].trim();
    const alreadyBold = /^\*[^*].*\*$/.test(first) || /^[^\w]*\*[^*].*\*/.test(first);

    // Don't touch bullets, numbered lines, quotes or code fences.
    if (/^([•\-*>]|\d+[.)])/.test(first)) return body;
    if (alreadyBold || first.startsWith('```')) return body;

    if (first.length <= 100) {
        lines[firstIndex] = `*${first.replace(/\*/g, '')}*`;
        return lines.join('\n');
    }

    // Long opening line: bold just the first sentence and push the rest down.
    const sentence = /^(.{1,120}?[.!?])\s+(.*)$/.exec(first);
    if (sentence) {
        lines[firstIndex] = `*${sentence[1].replace(/\*/g, '')}*\n\n${sentence[2]}`;
    }

    return lines.join('\n');
}

/**
 * Apply the Meta AI layout: headline, follow-ups and footer.
 * @param {string} text Formatted answer
 * @param {{userMessage?: string, suggest?: boolean, sources?: boolean, signature?: boolean}} [options]
 * @returns {string}
 */
function formatMetaReply(text, options = {}) {
    if (!text || typeof text !== 'string') return text;

    const {
        userMessage = '',
        suggest = true,
        sources = true,
        signature = true
    } = options;

    let body = text.replace(/\n{3,}/g, '\n\n').trim();
    body = ensureHeadline(body);

    const alreadyLinked = body.includes('osunhive.name.ng');

    if (suggest) {
        const followUps = buildFollowUps(userMessage, body);
        body += `\n\n*You might also ask* 🤔\n${followUps.map((q) => `• ${q}`).join('\n')}`;
    }

    const footer = [];
    if (signature) footer.push('— 🔷 *Osunhive AI*');
    if (sources && !alreadyLinked) footer.push(`🔗 ${WEBSITE}`);
    if (footer.length) body += `\n\n${footer.join('\n')}`;

    return body;
}

/* ------------------------------------------------------------------ */
/* Streaming                                                           */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Split a reply into chunks for the streaming effect.
 * Fenced code blocks are treated as a single segment so a block is never
 * broken across chunks (and every chunk has balanced fences).
 */
function splitForStream(text, maxLen = 110) {
    const source = String(text || '');
    if (!source) return [];

    const lines = source.split('\n');
    const segments = [];

    let i = 0;
    while (i < lines.length) {
        if (/^\s*```/.test(lines[i])) {
            const block = [lines[i]];
            i++;
            while (i < lines.length) {
                const line = lines[i];
                block.push(line);
                i++;
                if (/^\s*```\s*$/.test(line)) break;
            }
            segments.push({ type: 'block', content: block.join('\n') });
        } else {
            segments.push({ type: 'text', content: lines[i] });
            i++;
        }
    }

    const chunks = [];
    let buffer = '';
    const flush = () => {
        if (buffer) {
            chunks.push(buffer);
            buffer = '';
        }
    };

    for (const segment of segments) {
        if (segment.type === 'block') {
            flush();
            chunks.push(segment.content);
            continue;
        }

        const candidate = buffer ? `${buffer}\n${segment.content}` : segment.content;
        if (buffer && candidate.length > maxLen) {
            flush();
            buffer = segment.content;
        } else {
            buffer = candidate;
        }
    }
    flush();

    return chunks;
}

/**
 * Send a reply with a Meta-AI-style streaming effect.
 * Falls back to a normal send if message editing is not available.
 *
 * @param {object} sock Baileys socket
 * @param {string} chatId
 * @param {string} text Final text
 * @param {{quoted?: object, contextInfo?: object, chunkSize?: number, delayMs?: number, maxEdits?: number}} [options]
 * @returns {Promise<object|null>} the sent message
 */
async function streamReply(sock, chatId, text, options = {}) {
    const {
        quoted = null,
        contextInfo = null,
        chunkSize = 110,
        delayMs = 260,
        maxEdits = 14
    } = options;

    const sendOptions = { ...(contextInfo ? { contextInfo } : {}) };
    if (quoted) sendOptions.quoted = quoted;

    const chunks = splitForStream(text, chunkSize);

    // Short replies, or too many chunks: just send once.
    if (chunks.length <= 1 || chunks.length - 1 > maxEdits) {
        return sock.sendMessage(chatId, { text, ...(contextInfo ? { contextInfo } : {}) }, quoted ? { quoted } : undefined);
    }

    let shown = chunks[0];
    let sent;
    try {
        sent = await sock.sendMessage(
            chatId,
            { text: shown + ' ▍', ...(contextInfo ? { contextInfo } : {}) },
            quoted ? { quoted } : undefined
        );
    } catch (error) {
        console.error('[metaStyle] stream start failed:', error.message);
        return sock.sendMessage(chatId, { text, ...(contextInfo ? { contextInfo } : {}) }, quoted ? { quoted } : undefined);
    }

    for (let i = 1; i < chunks.length; i++) {
        await sleep(delayMs);
        shown += `\n${chunks[i]}`;
        const partial = i === chunks.length - 1 ? shown : `${shown} ▍`;

        try {
            await sock.sendMessage(chatId, { text: partial, edit: sent.key });
        } catch (error) {
            // Editing unavailable — finish with one plain message and stop.
            console.warn('[metaStyle] edit failed, finishing with a plain send:', error.message);
            try {
                await sock.sendMessage(chatId, { text, ...(contextInfo ? { contextInfo } : {}) });
            } catch { /* socket closed */ }
            return sent;
        }
    }

    return sent;
}

module.exports = {
    META_PERSONA,
    META_WEBSITE: WEBSITE,
    buildMetaPrompt,
    buildFollowUps,
    formatMetaReply,
    splitForStream,
    streamReply
};
