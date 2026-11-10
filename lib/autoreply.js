/**
 * Osunhive Chatbot — auto-reply engine selector
 *
 * Engines, in priority order:
 *   1. chatgpt  — ChatGPT Android SSE endpoint (lib/chatgpt-android.js)
 *   2. bjgpt    — legacy BJ-GPT-OSS-20B JSON API
 *   3. offline  — data/OsunhiveLLM.json (handled by the caller)
 *
 * `engine` may be 'auto' (default), 'chatgpt', 'bjgpt' or 'offline'.
 */

const axios = require('axios');
const { askChatGpt } = require('./chatgpt-android');

const BJGPT_URL = 'https://bj-gpt-oss-20b-api.vercel.app/';
const VALID_ENGINES = ['auto', 'chatgpt', 'bjgpt', 'offline'];

async function callBjGpt(message, timeoutMs = 15000) {
    try {
        const response = await axios.get(BJGPT_URL, {
            params: { message },
            timeout: timeoutMs
        });

        if (response.data && response.data.ok === true && typeof response.data.Result === 'string') {
            return response.data.Result;
        }
    } catch (error) {
        console.error('❌ [autoreply] BJ-GPT request failed:', error.message);
    }
    return null;
}

/**
 * Generate a raw (unformatted) reply.
 * @param {string} message
 * @param {string} [engine='auto']
 * @returns {Promise<{text: string|null, engine: string|null}>}
 */
async function generateRawReply(message, engine = 'auto') {
    const mode = VALID_ENGINES.includes(engine) ? engine : 'auto';

    const order =
        mode === 'chatgpt' ? ['chatgpt'] :
        mode === 'bjgpt' ? ['bjgpt'] :
        mode === 'offline' ? [] :
        ['chatgpt', 'bjgpt'];

    for (const name of order) {
        const text = name === 'chatgpt'
            ? await askChatGpt(message)
            : await callBjGpt(message);

        if (text && text.trim()) {
            return { text: text.trim(), engine: name };
        }
    }

    return { text: null, engine: null };
}

module.exports = {
    generateRawReply,
    callBjGpt,
    VALID_ENGINES
};
