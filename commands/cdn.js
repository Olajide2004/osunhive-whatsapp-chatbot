/**
 * Osunhive Bot — CDN browser
 *
 * The Osunhive CDN (https://cdn.osunhive.name.ng) is a Cloudflare worker that
 * mirrors a Google Drive folder. It understands two routes:
 *
 *   GET /<folder>/<folder>/...      → JSON listing of that folder (by name path)
 *   GET /download/<fileId>          → the binary file, with its real content-type
 *
 * Folders are addressed by their *name path* (e.g. `GDrive Upload BOT` or
 * `A/B`), so this command keeps a current folder per chat and lets you walk in
 * and out of folders and post files to Status.
 *
 * Owner commands:
 *   .cdn                      list the current folder (root by default)
 *   .cdn <n>                  folder → open it; media → post to Status; else → info
 *   .cdn <path>               open a folder path, e.g. `.cdn GDrive Upload BOT`
 *   .cdn open <n|path>        same, explicit
 *   .cdn ..  |  up | back     go up one folder
 *   .cdn /   |  root          go back to the CDN root
 *   .cdn path                 show the current folder path
 *   .cdn page <n>             page within the current folder
 *   .cdn refresh              re-fetch the current folder
 *   .cdn info|link|send <n>   details / direct link / send file to this chat
 *   .cdn post <n> [| caption] post a file (image/video) to Status
 */

const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');
const store = require('../lib/lightweight_store');
const { downloadUrlMedia, postUrlStatus } = require('./autopoststatus');

const CDN_BASE = 'https://cdn.osunhive.name.ng';
const cachePath = path.join(__dirname, '..', 'data', 'cdnCache.json');
const statePath = path.join(__dirname, '..', 'data', 'cdnState.json');

const PAGE_SIZE = 20;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_BUFFER = 80 * 1024 * 1024;

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GDRIVE_MIME = /^application\/vnd\.google-apps\./;

/* ------------------------------------------------------------------ */
/* Tiny JSON file store                                                */
/* ------------------------------------------------------------------ */

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

function writeJson(file, value) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(value, null, 2));
    } catch (error) {
        console.error('[cdn] could not write', path.basename(file), '-', error.message);
    }
}

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

/** Normalise a folder path: trim slashes/space, collapse separators. */
function normalizePath(input) {
    return String(input || '')
        .replace(/\\/g, '/')
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean)
        .join('/');
}

function parentPath(folderPath) {
    const parts = normalizePath(folderPath).split('/').filter(Boolean);
    parts.pop();
    return parts.join('/');
}

function joinPath(base, name) {
    return normalizePath([normalizePath(base), name].filter(Boolean).join('/'));
}

function cdnUrlForPath(folderPath) {
    const key = normalizePath(folderPath);
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    return `${CDN_BASE}/${encoded}${encoded ? '/' : ''}`;
}

/* ------------------------------------------------------------------ */
/* Listing + cache                                                     */
/* ------------------------------------------------------------------ */

async function fetchListing(folderPath = '') {
    if (typeof fetch !== 'function') {
        throw new Error('fetch() is unavailable — Node 18+ is required.');
    }
    const key = normalizePath(folderPath);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    let res;
    try {
        res = await fetch(cdnUrlForPath(key), {
            signal: controller.signal,
            headers: { accept: 'application/json' }
        });
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

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

    writeCache(key, items);
    return items;
}

function readCacheMap() {
    const raw = readJson(cachePath, {});
    return raw && typeof raw === 'object' ? raw : {};
}

function writeCache(folderPath, items) {
    const map = readCacheMap();
    map[folderPath] = { fetchedAt: Date.now(), items };
    // Keep the cache from growing without bound.
    const keys = Object.keys(map);
    if (keys.length > 50) {
        keys.sort((a, b) => (map[a].fetchedAt || 0) - (map[b].fetchedAt || 0))
            .slice(0, keys.length - 50)
            .forEach((k) => delete map[k]);
    }
    writeJson(cachePath, map);
}

async function getListing(folderPath, { force = false } = {}) {
    const key = normalizePath(folderPath);
    const cached = readCacheMap()[key];

    if (!force && cached && Array.isArray(cached.items) && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return { items: cached.items, fetchedAt: cached.fetchedAt };
    }
    try {
        const items = await fetchListing(key);
        return { items, fetchedAt: Date.now() };
    } catch (error) {
        if (cached && Array.isArray(cached.items)) {
            return { items: cached.items, fetchedAt: cached.fetchedAt, stale: true };
        }
        throw error;
    }
}

/* ------------------------------------------------------------------ */
/* Per-chat current folder                                             */
/* ------------------------------------------------------------------ */

function getState() {
    return readJson(statePath, {});
}

function getCurrentPath(chatId) {
    const all = getState();
    return normalizePath(all[chatId] || '');
}

function setCurrentPath(chatId, folderPath) {
    const all = getState();
    all[chatId] = normalizePath(folderPath);
    writeJson(statePath, all);
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
    if (mimeType === 'application/zip') return '🗜️';
    if (GDRIVE_MIME.test(mimeType)) return '📄';
    return '📦';
}

function kind(mimeType) {
    if (mimeType === FOLDER_MIME) return 'folder';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType === 'application/zip') return 'zip';
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

function listingText(items, folderPath, page, fetchedAt) {
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
    const parent = parentPath(folderPath);
    const where = folderPath ? `📂 */${folderPath}*` : '🏠 *CDN root*';
    const upLine = folderPath ? `⬆️ \`..\` or \`.cdn back\` — up to ${parent ? '/' + parent : 'root'}\n` : '';

    const counts = items.reduce((acc, it) => {
        const k = kind(it.mimeType);
        acc[k] = (acc[k] || 0) + 1;
        return acc;
    }, {});
    const info = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'empty';

    return (
        `🗂️ *Osunhive CDN* — ${where}` +
        `${pages > 1 ? ` (page ${current}/${pages})` : ''}\n` +
        `_${total ? info : 'This folder is empty'} • fetched ${when}_\n\n` +
        upLine +
        (lines.length ? lines.join('\n') + '\n' : '') +
        `\n*What now?*\n` +
        `• \`.cdn <n>\` — open a folder / post a media file\n` +
        `• \`.cdn send <n>\` — send it to this chat\n` +
        `• \`.cdn link <n>\` — direct link\n` +
        `• \`.cdn info <n>\` — details\n` +
        (pages > 1 ? `• \`.cdn page <n>\` — other pages\n` : '') +
        (folderPath ? `• \`.cdn back\` — up one folder\n` : '') +
        `✅ = can be posted as a status.`
    );
}

function infoText(n, item) {
    return (
        `#${n} ${icon(item.mimeType)} *${item.name}*\n\n` +
        `• Type: \`${item.mimeType || 'unknown'}\` (${kind(item.mimeType)})\n` +
        `• Size: ${item.size ? humanSize(item.size) : '—'}\n` +
        `• Id: \`${item.id}\`\n` +
        `• Link: ${downloadUrl(item)}\n` +
        (isPostable(item.mimeType)
            ? `\n✅ Ready — \`.cdn ${n}\` posts it to your status.`
            : `\n⚠️ This type cannot be posted to WhatsApp Status.`)
    );
}

/* ------------------------------------------------------------------ */
/* Command parsing                                                     */
/* ------------------------------------------------------------------ */

function parseCommand(body) {
    let text = String(body || '').trim();
    let caption = '';

    const bar = text.indexOf('|');
    if (bar >= 0) {
        caption = text.slice(bar + 1).trim();
        text = text.slice(0, bar).trim();
    }

    if (!text) return { action: 'list' };
    const low = text.toLowerCase();
    if (low === '..' || low === 'back' || low === 'up') return { action: 'up' };
    if (low === '/' || low === 'root') return { action: 'root' };
    if (low === 'path' || low === 'pwd') return { action: 'path' };

    const word = text.split(/\s+/)[0].toLowerCase();
    const rest = text.slice(word.length).trim();

    if (word === 'open' || word === 'cd') {
        if (!rest) return { action: 'list' };
        if (/^\d+$/.test(rest)) return { action: 'open', index: Number(rest) };
        return { action: 'open', path: normalizePath(rest) };
    }
    if (word === 'list') {
        if (!rest) return { action: 'list' };
        if (/^\d+$/.test(rest)) return { action: 'list', page: Number(rest) };
        return { action: 'list', path: normalizePath(rest) };
    }
    if (word === 'page') return { action: 'list', page: rest ? Number(rest) : 1 };
    if (word === 'refresh') return { action: 'refresh', path: rest ? normalizePath(rest) : undefined };
    if (['info', 'link', 'send', 'post'].includes(word)) {
        return { action: word, index: /^\d+$/.test(rest) ? Number(rest) : null, caption };
    }
    if (/^\d+$/.test(text)) return { action: 'select', index: Number(text), caption };

    // Anything else is treated as a folder path to open.
    return { action: 'open', path: normalizePath(text) };
}

/* ------------------------------------------------------------------ */
/* Command                                                             */
/* ------------------------------------------------------------------ */

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
        const cmd = parseCommand(raw.replace(/^\.cdn\s*/i, '').trim());

        const show = async (folderPath, { force = false, page = 1 } = {}) => {
            let listing;
            try {
                listing = await getListing(folderPath, { force });
            } catch (error) {
                console.error('[cdn] listing failed:', error.message);
                return reply(`❌ Could not open *${folderPath || 'root'}*: ${error.message}`);
            }
            setCurrentPath(chatId, folderPath);
            return reply(listingText(listing.items, folderPath, page, listing.fetchedAt));
        };

        const current = getCurrentPath(chatId);

        if (cmd.action === 'path') {
            return reply(`📂 Current CDN folder: *${current || 'root'}*`);
        }
        if (cmd.action === 'up') {
            return show(parentPath(current));
        }
        if (cmd.action === 'root') {
            return show('');
        }
        if (cmd.action === 'refresh') {
            return show(cmd.path !== undefined ? cmd.path : current, { force: true });
        }
        if (cmd.action === 'list') {
            return show(cmd.path !== undefined ? cmd.path : current, { page: cmd.page || 1 });
        }

        if (cmd.action === 'open') {
            if (cmd.path !== undefined) return show(cmd.path);
            // open by index — must be a folder
            const listing = await getListing(current);
            const item = listing.items[cmd.index - 1];
            if (!item) return reply(`❌ No entry #${cmd.index} in *${current || 'root'}*. Send \`.cdn\`.`);
            if (item.mimeType !== FOLDER_MIME) {
                return reply(`#${cmd.index} is a *${kind(item.mimeType)}*, not a folder.\nTry \`.cdn ${cmd.index}\`.`);
            }
            return show(joinPath(current, item.name));
        }

        // select / info / link / send / post — all take a number
        if (!Number.isInteger(cmd.index) || cmd.index < 1) {
            return reply('❌ Give an entry number, e.g. `.cdn 3`.\nSend `.cdn` to see the list.');
        }

        let listing;
        try {
            listing = await getListing(current);
        } catch (error) {
            return reply('❌ Could not reach the CDN: ' + error.message);
        }
        const item = listing.items[cmd.index - 1];
        if (!item) {
            return reply(`❌ No entry #${cmd.index} in *${current || 'root'}*. The folder has ${listing.items.length} entr${listing.items.length === 1 ? 'y' : 'ies'} — send \`.cdn\`.`);
        }

        if (cmd.action === 'select') {
            if (item.mimeType === FOLDER_MIME) return show(joinPath(current, item.name));
            if (isPostable(item.mimeType)) return handlePost(cmd.index, item, cmd.caption);
            return reply(infoText(cmd.index, item));
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
            const payload = media.kind === 'video'
                ? { video: media.buffer, caption: `📦 ${item.name}` }
                : { image: media.buffer, caption: `📦 ${item.name}` };
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
            return handlePost(cmd.index, item, cmd.caption);
        }

        return reply('❌ Unknown option. Send `.cdn` for the list.');

        async function handlePost(index, mediaItem, caption) {
            await reply(`⏳ Downloading *${shortName(mediaItem.name, 30)}*...`);
            try {
                const result = await postUrlStatus(sock, downloadUrl(mediaItem), caption, store);
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
module.exports.normalizePath = normalizePath;
module.exports.parentPath = parentPath;
module.exports.joinPath = joinPath;
module.exports.cdnUrlForPath = cdnUrlForPath;
module.exports.CDN_BASE = CDN_BASE;
