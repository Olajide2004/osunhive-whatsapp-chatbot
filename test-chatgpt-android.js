/**
 * Standalone probe for the ChatGPT Android endpoint.
 * Mirrors the PHP script 1:1 so we can see the raw result before wiring it in.
 *
 * Usage: node test-chatgpt-android.js "hello"
 */

const crypto = require('crypto');

const ENDPOINT = 'https://android.chat.openai.com/backend-api/f/conversation';

const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

function buildMessageId() {
    const part3 = hex(2).slice(1);                    // 3 hex chars
    const part4 = (8 + Math.floor(Math.random() * 4)).toString(16) + hex(2).slice(1);
    return `${hex(4)}-${hex(2)}-4${part3}-${part4}-${hex(6)}`;
}

function buildCookie() {
    return [
        `__cflb=${hex(20)}`,
        `__cfuvid=${hex(24)}`,
        `oai-sc=${hex(64)}`,
        `__cf_bm=${hex(48)}`
    ].join('; ');
}

function buildPayload(message) {
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
        timezone: 'Asia/Ho_Chi_Minh',
        timezone_offset_min: -420,
        system_hints: [],
        is_onboarding_conversation: false,
        stream: true
    };
}

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
            continue;
        }
        if (!data || typeof data !== 'object') continue;

        // 1. Streaming append patches
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

        // 2. Fallback: a full assistant message object
        const part = data.v?.message?.content?.parts?.[0];
        if (text === '' && data.v?.message?.author?.role === 'assistant' && typeof part === 'string') {
            text = part;
        }
    }

    return text.trim();
}

async function ask(message) {
    const started = Date.now();
    const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
            'User-Agent': 'ChatGPT/1.2027.000 (Android 12; SM-F741N; build 27230000)',
            'Accept': 'text/event-stream,application/json',
            'Content-Type': 'application/json',
            'Cookie': buildCookie(),
            'oai-device-id': hex(10)
        },
        body: JSON.stringify(buildPayload(message)),
        signal: AbortSignal.timeout(30000)
    });

    const body = await res.text();
    return {
        status: res.status,
        contentType: res.headers.get('content-type'),
        ms: Date.now() - started,
        bytes: body.length,
        reply: parseSse(body),
        head: body.slice(0, 400)
    };
}

if (require.main === module) {
    const message = process.argv[2] || 'Say hello in one short sentence.';
    ask(message)
        .then((r) => {
            console.log('status      :', r.status);
            console.log('content-type:', r.contentType);
            console.log('time        :', r.ms + 'ms');
            console.log('bytes       :', r.bytes);
            console.log('reply       :', JSON.stringify(r.reply));
            console.log('--- head ---');
            console.log(r.head);
        })
        .catch((e) => {
            console.error('REQUEST FAILED:', e.name, e.message);
            process.exit(1);
        });
}

module.exports = { ask, parseSse, buildPayload, buildCookie };
