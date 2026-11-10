/**
 * Osunhive Chatbot — ChatGPT Android endpoint client
 *
 * JavaScript port of the PHP `conversation` client. It talks to the same
 * SSE endpoint used by the Android app and extracts the assistant text from
 * the streamed patches.
 *
 * The endpoint is stateless from our side: every call gets a fresh device id
 * and a fresh cookie jar, so nothing is persisted between messages.
 */

const crypto = require('crypto');

const ENDPOINT = 'https://android.chat.openai.com/backend-api/f/conversation';
const USER_AGENT = 'ChatGPT/1.2027.000 (Android 12; SM-F741N; build 27230000)';

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_RETRIES = 1;

const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

/** PHP: sprintf('%s-%s-4%s-%s-%s', ...) */
function buildMessageId() {
    const part3 = hex(2).slice(1); // 3 hex chars
    const part4 = (8 + Math.floor(Math.random() * 4)).toString(16) + hex(2).slice(1);
    return `${hex(4)}-${hex(2)}-4${part3}-${part4}-${hex(6)}`;
}

/** PHP: random __cflb / __cfuvid / oai-sc / __cf_bm cookies */
function buildCookie() {
    return [
        `__cflb=${hex(20)}`,
        `__cfuvid=${hex(24)}`,
        `oai-sc=${hex(64)}`,
        `__cf_bm=${hex(48)}`
    ].join('; ');
}

function buildPayload(message, { timezone = 'Asia/Ho_Chi_Minh', timezoneOffsetMin = -420 } = {}) {
    return {
        action: 'next',
        messages: [{
            id: buildMessageId(),
            author: { role: 'user' },
            content: {
                parts: [message],
                content_type: 'text'
            },
            status: 'finished_successfully',
            recipient: 'all',
            metadata: {
                is_visually_hidden_from_conversation: false,
                exclude_after_next_user_message: false,
                content_references: [],
                search_result_groups: [],
                search_queries: [],
                image_results: [],
                real_time_audio_has_video: false,
                dictation: false,
                image_gen_async: false,
                trigger_async_ux: false,
                writing_blocks: {}
            }
        }],
        model: 'auto',
        history_and_training_disabled: false,
        fork_from_shared_post: false,
        enable_message_followups: false,
        force_use_sse: true,
        force_use_search: null,
        force_paragen: false,
        supported_encodings: ['v1'],
        supports_buffering: true,
        timezone,
        timezone_offset_min: timezoneOffsetMin,
        system_hints: [],
        is_onboarding_conversation: false,
        stream: true
    };
}

/**
 * Walk the SSE stream and collect the assistant reply.
 * Mirrors the two extraction branches from the PHP script.
 */
function parseSse(body) {
    let text = '';
    const lines = String(body || '').split('\n');

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;

        let data;
        try {
            data = JSON.parse(line.slice(5).trim());
        } catch {
            continue; // keep-alive comments / partial frames
        }
        if (!data || typeof data !== 'object') continue;

        // Branch 1: streaming append patches
        if (Array.isArray(data.v) && data.v.length > 0) {
            for (const patch of data.v) {
                if (
                    patch &&
                    patch.p === '/message/content/parts/0' &&
                    patch.o === 'append' &&
                    typeof patch.v === 'string'
                ) {
                    text += patch.v;
                }
            }
        }

        // Branch 2: a complete assistant message object
        const part = data.v?.message?.content?.parts?.[0];
        if (text === '' && data.v?.message?.author?.role === 'assistant' && typeof part === 'string') {
            text = part;
        }
    }

    return text.trim();
}

/**
 * Ask the endpoint for a reply.
 * @param {string} message User text
 * @param {{timeoutMs?: number, retries?: number}} [options]
 * @returns {Promise<string|null>} assistant text, or null on failure
 */
async function askChatGpt(message, options = {}) {
    const text = String(message ?? '').trim();
    if (!text) return null;

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retries = options.retries ?? DEFAULT_RETRIES;

    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'text/event-stream,application/json',
                    'Content-Type': 'application/json',
                    'Cookie': buildCookie(),
                    'oai-device-id': hex(10)
                },
                body: JSON.stringify(buildPayload(text, options)),
                signal: AbortSignal.timeout(timeoutMs)
            });

            if (!res.ok) {
                lastError = new Error(`HTTP ${res.status}`);
                continue;
            }

            const reply = parseSse(await res.text());
            if (reply) return reply;

            lastError = new Error('Empty assistant reply');
        } catch (error) {
            lastError = error;
        }
    }

    console.error(`❌ [chatgpt-android] ${lastError?.name || 'Error'}: ${lastError?.message || lastError}`);
    return null;
}

module.exports = {
    askChatGpt,
    parseSse,
    buildPayload,
    buildCookie,
    buildMessageId,
    ENDPOINT
};
