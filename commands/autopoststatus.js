/**
 * Osunhive Bot — Auto-post to WhatsApp Status
 *
 * Posts text or media statuses to `status@broadcast`, on a schedule or on demand.
 *
 * Owner commands:
 *   .autopoststatus                      show settings
 *   .autopoststatus on | off             enable / disable scheduler
 *   .autopoststatus now [text]           post now (text, media you replied to, or a direct link)
 *   .autopoststatus <direct-link.mp4>    post media straight from a URL (alias: .autostatuspost)
 *   .autostatuspost cdn:<fileId>         post a file from the Osunhive CDN
 *   .autopoststatus preview              preview the next status in this chat
 *   .autopoststatus text <message>       set the main text
 *   .autopoststatus add <message>        add a text to the rotation
 *   .autopoststatus list                 list rotation entries
 *   .autopoststatus remove <n>           remove rotation entry n
 *   .autopoststatus clear                clear rotation
 *   .autopoststatus bg <#RRGGBB>         set text status background
 *   .autopoststatus font <0-5>           set text status font
 *   .autopoststatus interval <minutes>   minutes between posts (5-1440)
 *   .autopoststatus delete               delete the last posted status
 */

const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');
const store = require('../lib/lightweight_store');
const settings = require('../settings');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const configPath = path.join(__dirname, '..', 'data', 'autoPostStatus.json');

const DEFAULT_TEXT =
    '🤖 *Osunhive Chatbot* is online!\n\n' +
    'Type *.menu* to explore commands.\n' +
    '🌐 https://www.osunhive.name.ng';

const DEFAULT_BG = '#1F2C34';
const DEFAULT_FONT = 1;

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

function readConfig() {
    try {
        if (!fs.existsSync(configPath)) {
            const initial = {
                enabled: false,
                intervalMinutes: 60,
                text: DEFAULT_TEXT,
                texts: [],
                textIndex: 0,
                backgroundColor: DEFAULT_BG,
                font: DEFAULT_FONT,
                recipients: [],
                maxRecipients: DEFAULT_MAX_RECIPIENTS,
                lastPostedAt: 0,
                lastStatus: null
            };
            fs.writeFileSync(configPath, JSON.stringify(initial, null, 2));
            return initial;
        }

        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return {
            enabled: !!cfg.enabled,
            intervalMinutes: Number(cfg.intervalMinutes) || 60,
            text: typeof cfg.text === 'string' ? cfg.text : DEFAULT_TEXT,
            texts: Array.isArray(cfg.texts)
                ? cfg.texts.filter((t) => typeof t === 'string' && t.trim())
                : [],
            textIndex: Number(cfg.textIndex) || 0,
            backgroundColor: typeof cfg.backgroundColor === 'string' ? cfg.backgroundColor : DEFAULT_BG,
            font: Number.isInteger(cfg.font) ? cfg.font : DEFAULT_FONT,
            recipients: Array.isArray(cfg.recipients)
                ? cfg.recipients.filter((r) => typeof r === 'string' && r.trim())
                : [],
            maxRecipients: Number.isInteger(cfg.maxRecipients) ? cfg.maxRecipients : DEFAULT_MAX_RECIPIENTS,
            autoPostStatusReact: !!cfg.autoPostStatusReact,
            lastPostedAt: Number(cfg.lastPostedAt) || 0,
            lastStatus: cfg.lastStatus && cfg.lastStatus.id ? cfg.lastStatus : null
        };
    } catch (error) {
        console.error('[autopoststatus] config read failed:', error.message);
        return {
            enabled: false,
            intervalMinutes: 60,
            text: DEFAULT_TEXT,
            texts: [],
            textIndex: 0,
            backgroundColor: DEFAULT_BG,
            font: DEFAULT_FONT,
            recipients: [],
            maxRecipients: DEFAULT_MAX_RECIPIENTS,
            lastPostedAt: 0,
            lastStatus: null
        };
    }
}

function writeConfig(config) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/** Text for this run (rotation pool when present). */
function nextStatusText(config) {
    if (!config.texts.length) {
        return { text: config.text, nextIndex: 0 };
    }
    const idx = config.textIndex % config.texts.length;
    return {
        text: config.texts[idx],
        nextIndex: (idx + 1) % config.texts.length
    };
}

function isValidColor(value) {
    return /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(String(value || '').trim());
}

/* ------------------------------------------------------------------ */
/* Media helpers                                                       */
/* ------------------------------------------------------------------ */

function unwrapMessage(message) {
    if (!message || typeof message !== 'object') return message;
    if (message.ephemeralMessage?.message) return unwrapMessage(message.ephemeralMessage.message);
    if (message.viewOnceMessage?.message) return unwrapMessage(message.viewOnceMessage.message);
    if (message.viewOnceMessageV2?.message) return unwrapMessage(message.viewOnceMessageV2.message);
    if (message.viewOnceMessageV2Extension?.message) {
        return unwrapMessage(message.viewOnceMessageV2Extension.message);
    }
    return message;
}

/** Find an image/video either attached to the command or quoted. */
function resolveMedia(message) {
    const own = unwrapMessage(message.message);
    if (own?.imageMessage) return { kind: 'image', media: own.imageMessage };
    if (own?.videoMessage) return { kind: 'video', media: own.videoMessage };

    const ctx =
        own?.extendedTextMessage?.contextInfo ||
        own?.imageMessage?.contextInfo ||
        own?.videoMessage?.contextInfo ||
        message.message?.extendedTextMessage?.contextInfo;

    const quoted = unwrapMessage(ctx?.quotedMessage);
    if (quoted?.imageMessage) return { kind: 'image', media: quoted.imageMessage };
    if (quoted?.videoMessage) return { kind: 'video', media: quoted.videoMessage };

    return null;
}

async function downloadMedia(media, kind) {
    const stream = await downloadContentFromMessage(media, kind);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

/* ------------------------------------------------------------------ */
/* Direct media links                                                  */
/* ------------------------------------------------------------------ */

const URL_RE = /https?:\/\/[^\s|]+/i;
const VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v|mkv|3gp)(?:\?|#|$)/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)(?:\?|#|$)/i;
const MAX_URL_MEDIA_BYTES = 80 * 1024 * 1024; // WhatsApp status media ceiling

const CDN_HOST = 'cdn.osunhive.name.ng';
const CDN_BASE = `https://${CDN_HOST}`;

/** First http(s) URL inside a string. */
function extractUrl(text) {
    const match = URL_RE.exec(String(text || ''));
    return match ? match[0] : null;
}

/**
 * Turn an Osunhive CDN reference into a direct download URL.
 *   https://cdn.osunhive.name.ng/<fileId>      → .../download/<fileId>
 *   cdn:<fileId>                               → .../download/<fileId>
 * Any other URL is returned unchanged.
 */
function normalizeMediaUrl(url) {
    const raw = String(url || '').trim();

    const shorthand = /^cdn:\s*([A-Za-z0-9_-]{10,})$/i.exec(raw);
    if (shorthand) return `${CDN_BASE}/download/${shorthand[1]}`;

    try {
        const parsed = new URL(raw);
        if (parsed.hostname === CDN_HOST && !/^\/download\//i.test(parsed.pathname)) {
            const id = parsed.pathname.replace(/^\/+/, '');
            if (id) return `${CDN_BASE}/download/${id}`;
        }
    } catch { /* not a URL — leave as-is */ }

    return raw;
}

/** Resolve a direct link from free text (URL or cdn:<id>). */
function resolveLink(text) {
    const url = extractUrl(text);
    if (url) return normalizeMediaUrl(url);

    const shorthand = /(?:^|\s)cdn:\s*([A-Za-z0-9_-]{10,})/i.exec(String(text || ''));
    if (shorthand) return `${CDN_BASE}/download/${shorthand[1]}`;

    return null;
}

/**
 * True when a link clearly points at an image/video: a media file extension,
 * or an Osunhive CDN download link (which serves whatever the file is).
 */
function looksLikeMediaLink(url) {
    if (!url) return false;
    return guessMediaKind(url) !== null || url.startsWith(`${CDN_BASE}/download/`);
}

// Command words that must not be mistaken for a media link.
const KNOWN_ACTIONS = new Set([
    'on', 'off', 'enable', 'disable', 'enable', 'now', 'post', 'preview',
    'text', 'add', 'list', 'remove', 'clear', 'bg', 'font', 'interval',
    'delete', 'recipients', 'limit', 'react', 'help'
]);

/** Caption = the text left after removing the link. */
function captionFromBody(body) {
    let text = String(body || '');
    const url = extractUrl(text);
    if (url) text = text.replace(url, '');
    else text = text.replace(/cdn:\s*[A-Za-z0-9_-]{10,}/i, '');
    return text.replace(/^\s*\|?\s*/, '').trim();
}

/** Guess the media kind from the URL extension (may be null). */
function guessMediaKind(url) {
    if (VIDEO_EXT_RE.test(url)) return 'video';
    if (IMAGE_EXT_RE.test(url)) return 'image';
    return null;
}

/**
 * Download an image/video from a direct link.
 * Kind comes from the extension, then the Content-Type header as a fallback.
 * @returns {Promise<{kind: string, buffer: Buffer}>}
 */
async function downloadUrlMedia(url) {
    if (typeof fetch !== 'function') {
        throw new Error('fetch() is unavailable — Node 18+ is required.');
    }

    let kind = guessMediaKind(url);

    const res = await withTimeout(fetch(url, { redirect: 'follow' }), 60000, 'media download');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const length = Number(res.headers.get('content-length') || 0);
    if (length && length > MAX_URL_MEDIA_BYTES) {
        throw new Error(`File too large (${(length / 1048576).toFixed(1)} MB > 80 MB).`);
    }

    if (!kind) {
        if (contentType.startsWith('video/')) kind = 'video';
        else if (contentType.startsWith('image/')) kind = 'image';
        else throw new Error(`Unsupported content-type: ${contentType || 'unknown'}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) throw new Error('Downloaded file was empty.');
    if (buffer.length > MAX_URL_MEDIA_BYTES) {
        throw new Error(`File too large (${(buffer.length / 1048576).toFixed(1)} MB > 80 MB).`);
    }

    return { kind, buffer };
}

/* ------------------------------------------------------------------ */
/* Posting                                                             */
/* ------------------------------------------------------------------ */

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
            if (timer.unref) timer.unref();
        })
    ]);
}

/* ------------------------------------------------------------------ */
/* Recipient discovery                                                 */
/* ------------------------------------------------------------------ */

const SESSION_DIR = path.join(__dirname, '..', 'session');
const DEFAULT_MAX_RECIPIENTS = 300;

let lidCache = { at: 0, numbers: [] };

/**
 * Read every `lid-mapping-<lid>_reverse.json` in the session folder.
 * These files map a LID to its phone number and are the bot's real
 * contact book — far more complete than the lightweight store.
 */
function readLidMappedContacts() {
    if (Date.now() - lidCache.at < 60_000) return lidCache.numbers;

    const numbers = [];
    try {
        for (const file of fs.readdirSync(SESSION_DIR)) {
            const match = /^lid-mapping-(\d+)_reverse\.json$/.exec(file);
            if (!match) continue;
            try {
                const raw = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, file), 'utf8'));
                const digits = String(raw).replace(/[^0-9]/g, '');
                if (digits.length >= 7 && digits.length <= 15) numbers.push(digits);
            } catch {
                /* skip unreadable mapping */
            }
        }
    } catch (error) {
        console.warn('[autopoststatus] session scan failed:', error.message);
    }

    lidCache = { at: Date.now(), numbers };
    return numbers;
}

function normalizePhone(value) {
    if (!value) return null;
    const digits = String(value).replace(/[^0-9]/g, '');
    if (digits.length < 7 || digits.length > 15) return null;
    return digits + '@s.whatsapp.net';
}

/** Group JIDs the store has seen (message history is the reliable source). */
function collectGroupJids(storeRef) {
    const set = new Set();
    const scan = (jid) => {
        if (typeof jid === 'string' && jid.endsWith('@g.us')) set.add(jid);
    };
    Object.keys(storeRef?.chats || {}).forEach(scan);
    Object.keys(storeRef?.messages || {}).forEach(scan);
    return [...set];
}

async function scanGroupParticipants(sock, groupJids, add) {
    // groupMetadata is far lighter than groupFetchAllParticipating, which stalls here.
    for (const jid of groupJids.slice(0, 50)) {
        try {
            const meta = await withTimeout(sock.groupMetadata(jid), 3000, `groupMetadata ${jid}`);
            for (const participant of meta?.participants || []) {
                add(participant.id);
                add(participant.phoneNumber);
            }
        } catch (error) {
            console.warn(`[autopoststatus] group ${jid} skipped:`, error.message);
        }
    }
}

/**
 * Build the status fan-out list.
 * Phone-number JIDs only — @lid recipients can terminate the stream.
 */
async function discoverStatusRecipients(sock, storeRef) {
    const config = readConfig();
    const list = new Set();

    const add = (jid) => {
        if (typeof jid !== 'string') return;
        if (!jid.endsWith('@s.whatsapp.net')) return;
        const digits = jid.split('@')[0].split(':')[0];
        if (digits.length >= 7 && digits.length <= 15) list.add(digits + '@s.whatsapp.net');
    };

    // 1. Manual list wins (first in, so it survives the cap).
    for (const entry of config.recipients) add(normalizePhone(entry));

    // 2. Bot + owner always get it.
    if (sock.user?.id) add(sock.user.id.split('@')[0].split(':')[0] + '@s.whatsapp.net');
    if (settings.ownerNumber) add(normalizePhone(settings.ownerNumber));

    // 3. Known personal chats / contacts.
    Object.keys(storeRef?.contacts || {}).forEach(add);
    Object.keys(storeRef?.chats || {}).forEach(add);
    Object.keys(storeRef?.messages || {}).forEach(add);

    // 4. Full contact book from the LID mappings on disk.
    const mapped = readLidMappedContacts();
    for (const digits of mapped) add(normalizePhone(digits));

    // 5. Group participants (phoneNumber may differ from id when id is a LID).
    //    Only while connected — these queries cannot succeed on a dead socket.
    const online = sock?.ws?.readyState === 1;
    if (online) {
        await scanGroupParticipants(sock, collectGroupJids(storeRef), add);
    }

    // 6. Everything the socket knows, best effort.
    if (online) {
        try {
            const groups = await withTimeout(sock.groupFetchAllParticipating(), 4000, 'groupFetchAllParticipating');
            for (const group of Object.values(groups || {})) {
                for (const participant of group.participants || []) {
                    add(participant.id);
                    add(participant.phoneNumber);
                }
            }
        } catch (error) {
            console.warn('[autopoststatus] group scan skipped:', error.message);
        }
    }

    const known = [...list];
    const cap = Number.isInteger(config.maxRecipients) ? config.maxRecipients : DEFAULT_MAX_RECIPIENTS;
    const limited = cap > 0 ? known.slice(0, cap) : known;

    return { list: limited, knownCount: known.length, capped: limited.length < known.length };
}

async function buildStatusJidList(sock, storeRef) {
    const { list } = await discoverStatusRecipients(sock, storeRef);
    return list;
}

/** Scale the send timeout with fan-out size. */
function statusTimeout(recipientCount) {
    return Math.min(300_000, 20_000 + recipientCount * 40);
}

function isConnectionError(error) {
    return /connection (closed|lost|terminated)|websocket|not open/i.test(String(error?.message || ''));
}

/** Wait until the underlying WebSocket reports OPEN (or give up). */
async function waitForSocket(sock, timeoutMs = 45_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (sock?.ws?.readyState === 1) return true;
        await new Promise((resolve) => {
            const timer = setTimeout(resolve, 1500);
            if (timer.unref) timer.unref();
        });
    }
    return false;
}

async function sendStatus(sock, content, storeRef, timeoutMs = 30000, extraOptions = {}) {
    const { list: jidList, knownCount, capped } = await discoverStatusRecipients(sock, storeRef);
    const options = { ...extraOptions };
    if (jidList.length) options.statusJidList = jidList;

    const wait = Math.max(timeoutMs, statusTimeout(jidList.length));

    let msg;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            msg = await withTimeout(
                sock.sendMessage('status@broadcast', content, options),
                wait,
                'status send'
            );
            break;
        } catch (error) {
            // The socket often drops mid-fan-out; reconnect once and retry.
            if (attempt === 0 && isConnectionError(error)) {
                console.warn('[autopoststatus] connection dropped, waiting for reconnect...');
                const ready = await waitForSocket(sock, 45_000);
                if (!ready) throw error;
                console.log('[autopoststatus] reconnected, retrying status send');
                continue;
            }
            throw error;
        }
    }

    console.log(
        `📤 Status posted: id=${msg?.key?.id || 'n/a'} recipients=${jidList.length}` +
        (capped ? ` (capped from ${knownCount})` : '')
    );

    // Acknowledge the post with a 👍 reaction to the status broadcast message.
    const cfgForReact = readConfig();
    const autoReaction = cfgForReact && typeof cfgForReact.autoPostStatusReact === 'boolean' ? cfgForReact.autoPostStatusReact : false;
    if (autoReaction) {
        try {
            await sock.sendMessage('status@broadcast', {
                react: { text: '👍', key: { id: msg?.key?.id, remoteJid: 'status@broadcast' } }
            });
        } catch { /* no-op: some clients reject status reactions */ }
    }

    return { msg, recipients: jidList.length, knownCount, capped, jidList };
}

async function postTextStatus(sock, text, storeRef, backgroundColor = DEFAULT_BG, font = DEFAULT_FONT) {
    // Styled text status: WhatsApp needs a background colour + font to render it.
    const style = { backgroundColor, font };
    try {
        return await sendStatus(sock, { text }, storeRef, 25000, style);
    } catch (error) {
        // Retry once unstyled, in case a client rejects the styling.
        if (/timed out/i.test(error.message)) throw error;
        console.warn('[autopoststatus] styled text failed, retrying plain:', error.message);
        return sendStatus(sock, { text }, storeRef, 25000);
    }
}

async function postMediaStatus(sock, mediaKind, buffer, caption, storeRef) {
    const content = mediaKind === 'video'
        ? { video: buffer, caption: caption || '' }
        : { image: buffer, caption: caption || '' };
    return sendStatus(sock, content, storeRef, 60000);
}

/** Download a direct media link and post it as a status. */
async function postUrlStatus(sock, url, caption, storeRef) {
    const { kind, buffer } = await downloadUrlMedia(url);
    const result = await postMediaStatus(sock, kind, buffer, caption, storeRef);
    return { ...result, kind, bytes: buffer.length };
}

async function deleteLastStatus(sock, lastStatus, storeRef) {
    if (!lastStatus?.id) throw new Error('No stored status to delete');
    const jidList = await buildStatusJidList(sock, storeRef);
    const ownJid = sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : undefined;
    const key = {
        remoteJid: 'status@broadcast',
        fromMe: true,
        id: lastStatus.id,
        participant: ownJid
    };
    const options = jidList.length ? { statusJidList: jidList } : {};
    return withTimeout(
        sock.sendMessage('status@broadcast', { delete: key }, options),
        25000,
        'status delete'
    );
}

/* ------------------------------------------------------------------ */
/* Scheduler                                                           */
/* ------------------------------------------------------------------ */

let posterTimer = null;
let posterSock = null;
let posterStore = null;

async function tick() {
    const config = readConfig();
    if (!config.enabled) return;
    if (!config.texts.length && !config.text.trim()) return;

    const intervalMs = Math.max(5, config.intervalMinutes) * 60_000;
    if (Date.now() - config.lastPostedAt < intervalMs) return;

    const { text, nextIndex } = nextStatusText(config);

    // Persist before posting so a failure cannot hammer WhatsApp.
    writeConfig({ ...config, lastPostedAt: Date.now(), textIndex: nextIndex });

    try {
        const result = await postTextStatus(
            posterSock,
            text,
            posterStore,
            config.backgroundColor,
            config.font
        );
        const latest = readConfig();
        latest.lastStatus = { id: result.msg?.key?.id || null, at: Date.now() };
        writeConfig(latest);
        console.log('✅ Auto status posted');
    } catch (error) {
        console.error('❌ Auto status post failed:', error.message);
    }
}

function startAutoStatusPoster(sock, storeRef) {
    posterSock = sock;
    posterStore = storeRef;

    if (posterTimer) return;

    posterTimer = setInterval(tick, 60_000);
    if (posterTimer.unref) posterTimer.unref();

    const warmup = setTimeout(tick, 15_000);
    if (warmup.unref) warmup.unref();

    // One-shot diagnostic: AUTOPOST_STATUS_TEST=1 node index.js
    if (process.env.AUTOPOST_STATUS_TEST === '1') {
        const test = setTimeout(async () => {
            try {
                const config = readConfig();
                const { text } = nextStatusText(config);
                const result = await postTextStatus(
                    posterSock,
                    text,
                    posterStore,
                    config.backgroundColor,
                    config.font
                );
                console.log(`🧪 TEST status accepted: id=${result.msg?.key?.id} recipients=${result.recipients}`);
            } catch (error) {
                console.error('🧪 TEST status failed:', error.message);
            }
        }, 20_000);
        if (test.unref) test.unref();
    }

    console.log('🗓️  Auto status poster started');
}

function stopAutoStatusPoster() {
    if (posterTimer) {
        clearInterval(posterTimer);
        posterTimer = null;
    }
}

/* ------------------------------------------------------------------ */
/* Command                                                             */
/* ------------------------------------------------------------------ */

function settingsText(config) {
    const next = config.enabled
        ? new Date(config.lastPostedAt + Math.max(5, config.intervalMinutes) * 60_000)
        : null;

    const pool = config.texts.length
        ? config.texts.map((t, i) => `${i + 1}. ${t.replace(/\n/g, ' ')}`).join('\n')
        : '(none — using main text)';

    const known = readLidMappedContacts().length;
    const cap = Number.isInteger(config.maxRecipients) ? config.maxRecipients : DEFAULT_MAX_RECIPIENTS;
    const effective = cap > 0 ? Math.min(known, cap) : known;

    return (
        `🗓️ *Auto Status Post*\n\n` +
        `Status: ${config.enabled ? '✅ ON' : '🚫 OFF'}\n` +
        `Interval: every ${config.intervalMinutes} min\n` +
        `Next post: ${next ? next.toLocaleString() : '—'}\n` +
        `Background: ${config.backgroundColor}\n` +
        `Font: ${config.font}\n` +
        `Last status: ${config.lastStatus?.id || '—'}\n` +
        `Recipients: *${effective}* of ${known} known contacts (cap ${cap || 'none'})\n` +
        `Manual list: ${config.recipients.length} number(s)\n\n` +
        `*Main text:*\n${config.text}\n\n` +
        `*Rotation:*\n${pool}\n\n` +
        `*Commands:*\n` +
        `• \`.autopoststatus on|off\`\n` +
        `• \`.autopoststatus now [text]\` (reply to an image/video, or paste a direct link)\n` +
        `• \`.autostatuspost <direct-link.mp4>\` post media from a link (image or video)\n` +
        `• \`.autostatuspost cdn:<fileId>\` post a file from the Osunhive CDN\n` +
        `• \`.autopoststatus preview\`\n` +
        `• \`.autopoststatus text <message>\`\n` +
        `• \`.autopoststatus add <message>\`\n` +
        `• \`.autopoststatus list\` / \`remove <n>\` / \`clear\`\n` +
        `• \`.autopoststatus bg <#RRGGBB>\` / \`font <0-5>\`\n` +
        `• \`.autopoststatus interval <minutes>\`\n` +
        `• \`.autopoststatus limit <n>\` (0 = unlimited)\n` +
        `• \`.autopoststatus recipients\` / \`add\` / \`remove\` / \`clear\`\n` +
        `• \`.autopoststatus delete\`\n\n` +
        `_Aliases: .autostatuspost, .statuspost, .autopost_`
    );
}

async function autopostStatusCommand(sock, chatId, message, storeRef = store) {
    const reply = (text) => sock.sendMessage(chatId, { text }, { quoted: message });

    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        if (!message.key.fromMe && !isOwner) {
            return reply('❌ This command is only available for the owner!');
        }

        const raw =
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            message.message?.imageMessage?.caption ||
            message.message?.videoMessage?.caption ||
            '';
        const body = raw.replace(/^\.(autopoststatus|autostatuspost|statuspost|autopost)\s*/i, '').trim();
        const args = body ? body.split(/\s+/) : [];
        const action = (args[0] || '').toLowerCase();
        const config = readConfig();

        /* --- no args: settings --- */
        if (!action) return reply(settingsText(config));

        /* --- enable / disable --- */
        if (action === 'on' || action === 'enable') {
            config.enabled = true;
            writeConfig(config);
            return reply(
                `✅ Auto status posting *enabled*.\n` +
                `Next post in ~${config.intervalMinutes} min (or use \`.autopoststatus now\`).`
            );
        }

        if (action === 'off' || action === 'disable') {
            config.enabled = false;
            writeConfig(config);
            return reply('🚫 Auto status posting *disabled*.');
        }

        /* --- direct media link: .autopoststatus <url.mp4> [| caption] --- */
        const directLink = resolveLink(body);
        if (directLink && looksLikeMediaLink(directLink) && !KNOWN_ACTIONS.has(action)) {
            const caption = captionFromBody(body);

            await reply(`⏳ Downloading from link...`);
            try {
                const result = await postUrlStatus(sock, directLink, caption, storeRef);
                config.lastPostedAt = Date.now();
                config.lastStatus = { id: result.msg?.key?.id || null, at: Date.now() };
                writeConfig(config);
                return reply(
                    `✅ ${result.kind} status posted from link to *${result.recipients}* recipient(s).` +
                    `\n_${(result.bytes / 1048576).toFixed(2)} MB downloaded._` +
                    (result.capped ? `\n_Cap ${result.recipients} of ${result.knownCount} known._` : '')
                );
            } catch (error) {
                console.error('[autopoststatus] URL status failed:', error.message);
                return reply('❌ Failed to post status from link: ' + error.message);
            }
        }

        /* --- post now (text, replied media, or a direct link) --- */
        if (action === 'now' || action === 'post') {
            const oneOff = body.slice(action.length).trim();
            const media = resolveMedia(message);
            const oneOffLink = resolveLink(oneOff);
            const oneOffIsMedia = oneOffLink && looksLikeMediaLink(oneOffLink);

            if (!media && oneOffIsMedia) {
                const caption = captionFromBody(oneOff);
                await reply('⏳ Downloading from link...');
                try {
                    const result = await postUrlStatus(sock, oneOffLink, caption, storeRef);
                    config.lastPostedAt = Date.now();
                    config.lastStatus = { id: result.msg?.key?.id || null, at: Date.now() };
                    writeConfig(config);
                    return reply(
                        `✅ ${result.kind} status posted from link to *${result.recipients}* recipient(s).` +
                        `\n_${(result.bytes / 1048576).toFixed(2)} MB downloaded._` +
                        (result.capped ? `\n_Cap ${result.recipients} of ${result.knownCount} known._` : '')
                    );
                } catch (error) {
                    console.error('[autopoststatus] URL status failed:', error.message);
                    return reply('❌ Failed to post status from link: ' + error.message);
                }
            }

            if (media) {
                await reply(`⏳ Downloading ${media.kind}...`);
                let buffer;
                try {
                    buffer = await downloadMedia(media.media, media.kind);
                } catch (error) {
                    console.error('[autopoststatus] media download failed:', error.message);
                    return reply('❌ Could not download that media.');
                }

                if (!buffer?.length) return reply('❌ Downloaded media was empty.');

                await reply('⏳ Posting media status...');
                try {
                    const result = await postMediaStatus(sock, media.kind, buffer, oneOff, storeRef);
                    config.lastPostedAt = Date.now();
                    config.lastStatus = { id: result.msg?.key?.id || null, at: Date.now() };
                    writeConfig(config);
                    return reply(
                        `✅ ${media.kind} status posted to *${result.recipients}* recipient(s).` +
                        (result.capped ? `\n_Cap ${result.recipients} of ${result.knownCount} known._` : '')
                    );
                } catch (error) {
                    console.error('[autopoststatus] media status failed:', error.message);
                    return reply('❌ Failed to post media status: ' + error.message);
                }
            }

            const { text: scheduledText } = nextStatusText(config);
            const text = oneOff || scheduledText;
            if (!text) return reply('❌ No status text set.');

            await reply('⏳ Posting status...');
            try {
                const result = await postTextStatus(
                    sock,
                    text,
                    storeRef,
                    config.backgroundColor,
                    config.font
                );
                config.lastPostedAt = Date.now();
                config.lastStatus = { id: result.msg?.key?.id || null, at: Date.now() };
                writeConfig(config);
                return reply(
                    `✅ Status posted to *${result.recipients}* recipient(s).` +
                    (result.capped ? `\n_Cap ${result.recipients} of ${result.knownCount} known._` : '')
                );
            } catch (error) {
                console.error('[autopoststatus] post failed:', error.message);
                return reply('❌ Failed to post status: ' + error.message);
            }
        }

        /* --- preview --- */
        if (action === 'preview') {
            const { text } = nextStatusText(config);
            return reply(`👀 *Next status preview*\n\n${text}\n\n_Background: ${config.backgroundColor} • Font: ${config.font}_`);
        }

        /* --- set main text --- */
        if (action === 'text') {
            const text = body.slice(4).trim();
            if (!text) return reply('❌ Usage: `.autopoststatus text <message>`');
            config.text = text;
            writeConfig(config);
            return reply('✅ Status text updated:\n\n' + text);
        }

        /* --- rotation pool --- */
        if (action === 'add') {
            const text = body.slice(3).trim();
            if (!text) return reply('❌ Usage: `.autopoststatus add <message>`');
            config.texts.push(text);
            writeConfig(config);
            return reply(`✅ Added to rotation (${config.texts.length} entries).`);
        }

        if (action === 'list') {
            if (!config.texts.length) return reply('📋 Rotation is empty. Use `.autopoststatus add <message>`.');
            const lines = config.texts.map((t, i) => `${i + 1}. ${t}`).join('\n\n');
            return reply(`📋 *Status rotation*\n\n${lines}`);
        }

        if (action === 'remove' || action === 'del') {
            const n = Number(args[1]);
            if (!Number.isInteger(n) || n < 1 || n > config.texts.length) {
                return reply(`❌ Pick a number between 1 and ${config.texts.length || 0}.`);
            }
            const [removed] = config.texts.splice(n - 1, 1);
            if (config.textIndex >= config.texts.length) config.textIndex = 0;
            writeConfig(config);
            return reply(`✅ Removed:\n${removed}`);
        }

        if (action === 'clear') {
            config.texts = [];
            config.textIndex = 0;
            writeConfig(config);
            return reply('✅ Rotation cleared.');
        }

        /* --- auto 👍 reaction on the broadcast message (owner only) --- */
        if (action === 'react') {
            const mode = (args[1] || 'toggle').toLowerCase();
            if (mode === 'toggle') config.autoPostStatusReact = !config.autoPostStatusReact;
            else if (['on', 'enable', 'yes'].includes(mode)) config.autoPostStatusReact = true;
            else if (['off', 'disable', 'no'].includes(mode)) config.autoPostStatusReact = false;
            else return reply('❌ Usage: `.autopoststatus react on|off`');
            writeConfig(config);
            return reply(`✅ Auto 👍 reaction ${config.autoPostStatusReact ? 'ON' : 'OFF'}.`);
        }

        /* --- styling --- */
        if (action === 'bg' || action === 'background') {
            const color = (args[1] || '').trim();
            if (!isValidColor(color)) {
                return reply('❌ Usage: `.autopoststatus bg #1F2C34` (6 or 8 hex digits)');
            }
            config.backgroundColor = color.startsWith('#') ? color : '#' + color;
            writeConfig(config);
            return reply(`✅ Background set to ${config.backgroundColor}.`);
        }

        if (action === 'font') {
            const font = Number(args[1]);
            if (!Number.isInteger(font) || font < 0 || font > 5) {
                return reply('❌ Font must be a number from 0 to 5.');
            }
            config.font = font;
            writeConfig(config);
            return reply(`✅ Font set to ${font}.`);
        }

        /* --- recipients (manual list + discovery stats) --- */
        if (action === 'recipients' || action === 'recipient' || action === 'contacts') {
            const sub = (args[1] || '').toLowerCase();

            if (!sub || sub === 'list' || sub === 'show') {
                const { list, knownCount, capped } = await discoverStatusRecipients(sock, storeRef);
                const manual = config.recipients.length
                    ? config.recipients.map((r, i) => `${i + 1}. ${r}`).join('\n')
                    : '(empty)';
                return reply(
                    `👥 *Status recipients*\n\n` +
                    `Known contacts: *${knownCount}*\n` +
                    `Will receive: *${list.length}*${capped ? ' (capped)' : ''}\n` +
                    `Cap: ${config.maxRecipients || 'none'}\n\n` +
                    `*Manual list:*\n${manual}\n\n` +
                    `• \`.autopoststatus recipients add <number>\`\n` +
                    `• \`.autopoststatus recipients remove <n>\`\n` +
                    `• \`.autopoststatus recipients clear\``
                );
            }

            if (sub === 'add') {
                const numbers = args.slice(2).join(' ').split(/[\s,]+/).filter(Boolean);
                if (!numbers.length) {
                    return reply('❌ Usage: `.autopoststatus recipients add 2348012345678`');
                }

                const added = [];
                const rejected = [];
                for (const value of numbers) {
                    const jid = normalizePhone(value);
                    if (!jid) {
                        rejected.push(value);
                        continue;
                    }
                    const digits = jid.split('@')[0];
                    if (!config.recipients.includes(digits)) config.recipients.push(digits);
                    added.push(digits);
                }

                writeConfig(config);
                return reply(
                    `✅ Added ${added.length} number(s). Total manual: ${config.recipients.length}.` +
                    (rejected.length ? `\n⚠️ Rejected: ${rejected.join(', ')}` : '')
                );
            }

            if (sub === 'remove' || sub === 'del') {
                const n = Number(args[2]);
                if (!Number.isInteger(n) || n < 1 || n > config.recipients.length) {
                    return reply(`❌ Pick a number between 1 and ${config.recipients.length || 0}.`);
                }
                const [removed] = config.recipients.splice(n - 1, 1);
                writeConfig(config);
                return reply(`✅ Removed ${removed}.`);
            }

            if (sub === 'clear') {
                config.recipients = [];
                writeConfig(config);
                return reply('✅ Manual recipient list cleared.');
            }

            return reply('❌ Use: `.autopoststatus recipients [list|add|remove|clear]`');
        }

        /* --- recipient cap --- */
        if (action === 'limit' || action === 'max') {
            const n = Number(args[1]);
            if (!Number.isInteger(n) || n < 0 || n > 100000) {
                return reply('❌ Usage: `.autopoststatus limit <n>` (0 = unlimited, max 100000)');
            }
            config.maxRecipients = n;
            writeConfig(config);
            return reply(
                n === 0
                    ? '✅ Recipient cap removed — posts to every known contact.'
                    : `✅ Recipient cap set to ${n}.`
            );
        }

        /* --- interval --- */
        if (action === 'interval') {
            const minutes = Number(args[1]);
            if (!Number.isFinite(minutes) || minutes < 5 || minutes > 1440) {
                return reply('❌ Interval must be between 5 and 1440 minutes.');
            }
            config.intervalMinutes = Math.round(minutes);
            writeConfig(config);
            return reply(`✅ Interval set to ${config.intervalMinutes} minutes.`);
        }

        /* --- delete last status --- */
        if (action === 'delete' || action === 'revoke') {
            if (!config.lastStatus?.id) return reply('❌ No stored status to delete.');
            await reply('⏳ Deleting last status...');
            try {
                await deleteLastStatus(sock, config.lastStatus, storeRef);
                config.lastStatus = null;
                writeConfig(config);
                return reply('✅ Last status deleted.');
            } catch (error) {
                console.error('[autopoststatus] delete failed:', error.message);
                return reply('❌ Failed to delete status: ' + error.message);
            }
        }

        return reply(
            '❌ Unknown option.\nUse: `.autopoststatus` to see all options.'
        );
    } catch (error) {
        console.error('[autopoststatus] command error:', error);
        try {
            await sock.sendMessage(chatId, { text: '❌ Error: ' + error.message }, { quoted: message });
        } catch {}
    }
}

module.exports = {
    autopostStatusCommand,
    startAutoStatusPoster,
    stopAutoStatusPoster,
    postTextStatus,
    postMediaStatus,
    deleteLastStatus,
    buildStatusJidList,
    discoverStatusRecipients,
    readLidMappedContacts,
    normalizePhone,
    statusTimeout,
    nextStatusText,
    readConfig,
    // Direct-link / CDN helpers (exported for tests)
    extractUrl,
    normalizeMediaUrl,
    resolveLink,
    looksLikeMediaLink,
    guessMediaKind,
    captionFromBody,
    downloadUrlMedia,
    postUrlStatus
};
