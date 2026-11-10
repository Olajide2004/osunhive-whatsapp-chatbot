/**
 * Osunhive Bot — CDN browser
 *
 * The Osunhive CDN (https://cdn.osunhive.name.ng) is a Cloudflare worker that
 * mirrors a Google Drive folder:
 *   GET /                  → JSON list of the folder's entries
 *   GET /download/<fileId> → the binary file, with its real content-type
 *
 * This command turns that listing into something you can use from WhatsApp.
 *
 * Owner commands:
 *   .cdn                     list the CDN (numbered, cached)
 *   .cdn refresh             re-fetch the listing
 *   .cdn page <n>            show page n of the listing
 *   .cdn info <n>            details for entry n
 *   .cdn link <n>            the direct download link for entry n
 *   .cdn send <n>            send entry n into this chat
 *   .cdn post <n> [| caption]  post entry n (image/video) as a status
 *   .cdn <n>                 shortcut: post entry n as a status
 */

const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const isOwnerOrSudo = require('../lib/isOwner');
const store = require('../lib/lightweight_store');
const { downloadUrlMedia, postUrlStatus } = require('./autopoststatus');

const CDN_BASE = 'https://cdn.osunhive.name.ng';
const cachePath = path.join(__dirname, '..', 'data', 'cdnCache.json');

const PAGE_SIZE = 20;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_BUFFER = 80 * 1024 * 1024;

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GDRIVE_MIME = /^application\/vnd\.google-apps\./;

/* ------------------------------------------------------------------ */
/* Listing + cache                                                     */
/* ------------------------------------------------------------------ */

async function fetchListing() {
    if (typeof fetch !== 'function') {
        throw new Error('fetch() is unavailable — Node 18+ is required.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    let res;
    try {
        res = await fetch(`${CDN_BASE}/`, { signal: controller.signal, headers: { accept: 'application/json' } });
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`CDN returned HTTP ${res.status}`);

    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('CDN listing was not an array');

    const items = data.map((f) => ({
        id: String(f.id),
        name: String(f.name || f.id),
        mimeType: String(f.mimeType || ''),
        size: Number(f.size) || 0
    }));

    // Deterministic order: folders first, then files, each alphabetical.
    items.sort((a, b) => {
        const af = a.mimeType === FOLDER_MIME ? 0 : 1;
        const bf = b.mimeType === FOLDER_MIME ? 0 : 1;
        if (af !== bf) return af - bf;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    writeCache(items);
    return items;
}

function readCache() {
    try {
        const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (Array.isArray(raw.items) && raw.items.length) {
            return { items: raw.items, fetchedAt: Number(raw.fetchedAt) || 0 };
        }
    } catch { /* no cache yet */ }
    return null;
}

function writeCache(items) {
    try {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(cachePath, JSON.stringify({ fetchedAt: Date.now(), items }, null, 2));
    } catch (error) {
        console.error('[cdn] could not write cache:', error.message);
    }
}

async function getListing({ force = false } = {}) {
    const cached = readCache();
    if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return { items: cached.items, fetchedAt: cached.fetchedAt, cached: true };
    }
    try {
        const items = await fetchListing();
        return { items, fetchedAt: Date.now(), cached: false };
    } catch (error) {
        if (cached) return { items: cached.items, fetchedAt: cached.fetchedAt, cached: true, stale: true };
        throw error;
    }
}

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

function icon(mimeType) {
    if (mimeType === FOLDER_MIME) return '📁';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType === 'application/pdf') return '📕';
    if (GDRIVE_MIME.test(mimeType)) return '📄';
    return '📦';
}

function kind(mimeType) {
    if (mimeType === FOLDER_MIME) return 'folder';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType === 'application/pdf') return 'pdf';
    if (GDRIVE_MIME.test(mimeType)) return 'gdrive';
    return 'file';
}

function isPostable(mimeType) {
    return mimeType.startsWith('image/') || mimeType.startsWith('video/');
}

function humanSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

function downloadUrl(item) {
    return `${CDN_BASE}/download/${item.id}`;
}

function shortName(name, max = 42) {
    const clean = name.replace(/\s+/g, ' ').trim();
    return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

function listingText(items, page, fetchedAt) {
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(Math.max(1, page), pages);
    const slice = items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

    const lines = slice.map((item, i) => {
        const n = (current - 1) * PAGE_SIZE + i + 1;
        const size = item.size ? ` (${humanSize(item.size)})` : '';
        const tag = item.mimeType === FOLDER_MIME ? '' : isPostable(item.mimeType) ? ' ✅' : '';
        return `${n}. ${icon(item.mimeType)} ${shortName(item.name)}${size}${tag}`;
    });

    const when = new Date(fetchedAt).toLocaleTimeString();
    const rowCounts = items.reduce((acc, it) => {
        const k = kind(it.mimeType);
        acc[k] = (acc[k] || 0) + 1;
        return acc;
    }, {});
    const folders = rowCounts.folder || 0;
    const media = (rowCounts.image || 0) + (rowCounts.video || 0);

    return (
        `🗂️ *Osunhive CDN* — ${total} entr${total === 1 ? 'y' : 'ies'}` +
        `${pages > 1 ? ` • page ${current}/${pages}` : ''}\n` +
        `_${folders} folder(s), ${media} postable media, fetched ${when}_\n\n` +
        lines.join('\n') +
        `\n\n*What now?*\n` +
        `• \`.cdn <n>\` — post entry n as a *status*\n` +
        `• \`.cdn send <n>\` — send it to this chat\n` +
        `• \`.cdn link <n>\` — get the direct link\n` +
        `• \`.cdn info <n>\` — details\n` +
        (pages > 1 ? `• \`.cdn page <n>\` — other pages\n` : '') +
        `\n✅ = can be posted as a status.`
    );
}

function infoText(n, item) {
    return (
        `#${n} ${icon(item.mimeType)} *${item.name}*\n\n` +
        `• Type: \`${item.mimeType || 'unknown'}\` (${kind(item.mimeType)})\n` +
        `• Size: ${item.size ? humanSize(item.size) : '—'}\n` +
        `• Id: \`${item.id}\`\n` +
        `• Link: ${downloadUrl(item)}\n` +
        (isPostable(item.mimeType) ? `\n✅ Ready — \`.cdn ${n}\` posts it to your status.` : `\n⚠️ This type cannot be posted to WhatsApp Status.`)
    );
}

/* ------------------------------------------------------------------ */
/* Command                                                             */
/* ------------------------------------------------------------------ */

function parseCommand(body) {
    const trimmed = String(body || '').trim();
    if (!trimmed) return { action: 'list', page: 1 };
    const m = /^(list|refresh|page|info|link|send|post)?\s*(\d*)\s*(?:\|([\s\S]*))?$/.exec(trimmed);
    if (!m) return { action: 'list', page: 1, rest: trimmed };
    const word = (m[1] || '').toLowerCase();
    const num = m[2] ? Number(m[2]) : null;
    const caption = m[3] ? m[3].trim() : '';
    if (!word) return { action: num ? 'post' : 'list', index: num, caption };
    if (word === 'list') return { action: 'list', page: num || 1 };
    if (word === 'page') return { action: 'list', page: num || 1 };
    if (word === 'refresh') return { action: 'list', page: 1, force: true };
    if (word === 'post') return { action: 'post', index: num, caption };
    return { action: word, index: num, caption };
}

async function cdnCommand(sock, chatId, message) {
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
            '';
        const body = raw.replace(/^\.cdn\s*/i, '').trim();
        const cmd = parseCommand(body);

        if (cmd.action === 'list') {
            let listing;
            try {
                listing = await getListing({ force: !!cmd.force });
            } catch (error) {
                console.error('[cdn] listing failed:', error.message);
                return reply('❌ Could not reach the CDN: ' + error.message);
            }
            return reply(listingText(listing.items, cmd.page, listing.fetchedAt));
        }

        // Everything else needs an index
        if (!Number.isInteger(cmd.index) || cmd.index < 1) {
            return reply('❌ Give an entry number, e.g. `.cdn 3`.\nSend `.cdn` to see the list.');
        }

        let listing;
        try {
            listing = await getListing();
        } catch (error) {
            return reply('❌ Could not reach the CDN: ' + error.message);
        }

        const item = listing.items[cmd.index - 1];
        if (!item) {
            return reply(`❌ No entry #${cmd.index}. The CDN has ${listing.items.length} entr${listing.items.length === 1 ? 'y' : 'ies'} — send \`.cdn\`.`);
        }

        if (cmd.action === 'info') return reply(infoText(cmd.index, item));
        if (cmd.action === 'link') return reply(`🔗 ${downloadUrl(item)}`);

        if (cmd.action === 'send') {
            await reply(`⏳ Downloading *${shortName(item.name, 30)}*...`);
            let media;
            try {
                media = await downloadUrlMedia(downloadUrl(item));
            } catch (error) {
                return reply('❌ Could not download it: ' + error.message);
            }
            if (media.buffer.length > MAX_BUFFER) {
                return reply(`❌ Too large to send (${humanSize(media.buffer.length)}).`);
            }
            const caption = `📦 ${item.name}`;
            const payload = media.kind === 'video'
                ? { video: media.buffer, caption }
                : { image: media.buffer, caption };
            try {
                await sock.sendMessage(chatId, payload, { quoted: message });
            } catch (error) {
                return reply('❌ Could not send it: ' + error.message);
            }
            return;
        }

        if (cmd.action === 'post') {
            if (!isPostable(item.mimeType)) {
                return reply(
                    `⚠️ *#${cmd.index}* is a *${kind(item.mimeType)}* — WhatsApp Status only accepts images and videos.\n` +
                    `Try \`.cdn send ${cmd.index}\` or \`.cdn link ${cmd.index}\`.`
                );
            }
            await reply(`⏳ Downloading *${shortName(item.name, 30)}*...`);
            try {
                const result = await postUrlStatus(sock, downloadUrl(item), cmd.caption, store);
                return reply(
                    `✅ ${result.kind} status posted to *${result.recipients}* recipient(s).` +
                    `\n_${(result.bytes / 1048576).toFixed(2)} MB downloaded._` +
                    (result.capped ? `\n_Cap ${result.recipients} of ${result.knownCount} known._` : '')
                );
            } catch (error) {
                console.error('[cdn] status post failed:', error.message);
                return reply('❌ Failed to post that entry: ' + error.message);
            }
        }

        return reply('❌ Unknown option. Send `.cdn` for the list.');
    } catch (error) {
        console.error('[cdn] error:', error);
        try { await sock.sendMessage(chatId, { text: '❌ CDN command failed.' }, { quoted: message }); } catch { /* ignore */ }
    }
}

module.exports = cdnCommand;
module.exports.fetchListing = fetchListing;
module.exports.parseCommand = parseCommand;
module.exports.listingText = listingText;
module.exports.isPostable = isPostable;
module.exports.CDN_BASE = CDN_BASE;
