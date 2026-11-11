const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { writeFile } = require('fs/promises');
const settings = require('../settings');

const CONFIG_PATH = path.join(__dirname, '../data/antidelete.json');
const TEMP_MEDIA_DIR = path.join(__dirname, '../tmp');

// How many messages to keep in memory (and how long, in ms).
const MAX_STORE = 500;
const TTL_MS = 24 * 60 * 60 * 1000;
// Never download media bigger than this for antidelete (WhatsApp status/chat caps aside).
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
// Clean the tmp folder once it grows past this (MB).
const TEMP_LIMIT_MB = 200;

const messageStore = new Map();

// Ensure tmp dir exists
if (!fs.existsSync(TEMP_MEDIA_DIR)) {
    fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Baileys returns a stream (or buffer) — always normalise to a Buffer. */
async function toBuffer(stream) {
    if (!stream) return Buffer.alloc(0);
    if (Buffer.isBuffer(stream)) return stream;
    if (stream instanceof Uint8Array) return Buffer.from(stream);
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

/** The numeric part of a jid/lid, e.g. "234...:30@s.whatsapp.net" -> "234..." */
function numberPart(jid) {
    return String(jid || '').split(':')[0].split('@')[0].replace(/\D/g, '');
}

/** Where antidelete reports go: the configured owner, else the bot itself. */
function ownerJid(sock) {
    const num = numberPart(settings.ownerNumber) || numberPart(sock?.user?.id);
    return num ? `${num}@s.whatsapp.net` : null;
}

// Function to get folder size in MB
const getFolderSizeInMB = (folderPath) => {
    try {
        const files = fs.readdirSync(folderPath);
        let totalSize = 0;

        for (const file of files) {
            const filePath = path.join(folderPath, file);
            try {
                if (fs.statSync(filePath).isFile()) {
                    totalSize += fs.statSync(filePath).size;
                }
            } catch { /* file vanished — ignore */ }
        }

        return totalSize / (1024 * 1024); // Convert bytes to MB
    } catch (err) {
        console.error('Error getting folder size:', err);
        return 0;
    }
};

// Function to clean temp folder if size exceeds the limit
const cleanTempFolderIfLarge = () => {
    try {
        const sizeMB = getFolderSizeInMB(TEMP_MEDIA_DIR);
        if (sizeMB > TEMP_LIMIT_MB) {
            const files = fs.readdirSync(TEMP_MEDIA_DIR);
            for (const file of files) {
                try { fs.unlinkSync(path.join(TEMP_MEDIA_DIR, file)); } catch { /* ignore */ }
            }
        }
    } catch (err) {
        console.error('Temp cleanup error:', err);
    }
};

/** Drop the oldest stored messages and their temp media. */
function pruneStore() {
    const now = Date.now();
    for (const [id, entry] of messageStore) {
        const age = now - (entry.storedAt || 0);
        if (age > TTL_MS) {
            if (entry.mediaPath) { try { fs.unlinkSync(entry.mediaPath); } catch { /* ignore */ } }
            messageStore.delete(id);
        }
    }
    while (messageStore.size > MAX_STORE) {
        const oldest = messageStore.keys().next().value;
        if (oldest === undefined) break;
        const entry = messageStore.get(oldest);
        if (entry?.mediaPath) { try { fs.unlinkSync(entry.mediaPath); } catch { /* ignore */ } }
        messageStore.delete(oldest);
    }
}

/** Start periodic maintenance (cleanup + prune) every 5 minutes. */
setInterval(() => {
    cleanTempFolderIfLarge();
    pruneStore();
}, 5 * 60 * 1000).unref?.();

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

function loadAntideleteConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return { enabled: false };
        const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : { enabled: false };
    } catch {
        return { enabled: false };
    }
}

function saveAntideleteConfig(config) {
    try {
        fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (err) {
        console.error('Config save error:', err);
    }
}

const isOwnerOrSudo = require('../lib/isOwner');

// Injectable so tests can supply a stub; the bot uses Baileys' downloader.
let mediaDownloader = downloadContentFromMessage;

/* ------------------------------------------------------------------ */
/* Command                                                             */
/* ------------------------------------------------------------------ */

async function handleAntideleteCommand(sock, chatId, message, match) {
    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

    if (!message.key.fromMe && !isOwner) {
        return sock.sendMessage(chatId, { text: '*Only the bot owner can use this command.*' }, { quoted: message });
    }

    const config = loadAntideleteConfig();
    const arg = String(match || '').trim().toLowerCase();

    if (!arg) {
        return sock.sendMessage(chatId, {
            text: `*ANTIDELETE SETUP*\n\nCurrent Status: ${config.enabled ? '✅ Enabled' : '❌ Disabled'}\n\n*.antidelete on* - Enable\n*.antidelete off* - Disable`
        }, { quoted: message });
    }

    if (arg === 'on' || arg === 'enable') {
        config.enabled = true;
    } else if (arg === 'off' || arg === 'disable') {
        config.enabled = false;
    } else {
        return sock.sendMessage(chatId, { text: '*Invalid command. Use .antidelete to see usage.*' }, { quoted: message });
    }

    saveAntideleteConfig(config);
    return sock.sendMessage(chatId, {
        text: `*Antidelete ${config.enabled ? 'enabled' : 'disabled'}*`
    }, { quoted: message });
}

/* ------------------------------------------------------------------ */
/* Media capture                                                       */
/* ------------------------------------------------------------------ */

/**
 * Download a media message to tmp and return the file path (or '' if skipped).
 * Never throws — a failed download must not lose the text content.
 */
async function saveMedia(messageId, mediaMessage, kind, ext) {
    try {
        if (!mediaMessage) return '';
        const declared = Number(mediaMessage.fileLength || 0);
        if (declared && declared > MAX_MEDIA_BYTES) return '';

        const stream = await mediaDownloader(mediaMessage, kind);
        const buffer = await toBuffer(stream);
        if (!buffer || !buffer.length) return '';
        if (buffer.length > MAX_MEDIA_BYTES) return '';

        const mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.${ext}`);
        await writeFile(mediaPath, buffer);
        return mediaPath;
    } catch (err) {
        console.error(`storeMessage ${kind} download error:`, err?.message || err);
        return '';
    }
}

/* ------------------------------------------------------------------ */
/* Store incoming messages                                             */
/* ------------------------------------------------------------------ */

async function storeMessage(sock, message) {
    try {
        const config = loadAntideleteConfig();
        if (!config.enabled) return; // Don't store if antidelete is disabled

        if (!message?.key?.id || !message?.message) return;

        const messageId = message.key.id;
        const remoteJid = message.key.remoteJid || '';
        // Revokes/protocol messages and ephemeral wrappers carry no content.
        if (message.message.protocolMessage) return;
        // Skip status broadcasts and newsletter posts — nothing to trail there.
        if (remoteJid.endsWith('@broadcast') || remoteJid.endsWith('@newsletter')) return;

        let content = '';
        let mediaType = '';
        let mediaPath = '';
        let isViewOnce = false;

        const sender = message.key.participant || remoteJid;

        const viewOnceContainer = message.message?.viewOnceMessageV2?.message
            || message.message?.viewOnceMessage?.message
            || message.message?.viewOnceMessageV2Extension?.message;

        if (viewOnceContainer) {
            if (viewOnceContainer.imageMessage) {
                mediaType = 'image';
                content = viewOnceContainer.imageMessage.caption || '';
                mediaPath = await saveMedia(messageId, viewOnceContainer.imageMessage, 'image', 'jpg');
                isViewOnce = true;
            } else if (viewOnceContainer.videoMessage) {
                mediaType = 'video';
                content = viewOnceContainer.videoMessage.caption || '';
                mediaPath = await saveMedia(messageId, viewOnceContainer.videoMessage, 'video', 'mp4');
                isViewOnce = true;
            }
        } else if (message.message?.conversation) {
            content = message.message.conversation;
        } else if (message.message?.extendedTextMessage?.text) {
            content = message.message.extendedTextMessage.text;
        } else if (message.message?.imageMessage) {
            mediaType = 'image';
            content = message.message.imageMessage.caption || '';
            mediaPath = await saveMedia(messageId, message.message.imageMessage, 'image', 'jpg');
        } else if (message.message?.stickerMessage) {
            mediaType = 'sticker';
            mediaPath = await saveMedia(messageId, message.message.stickerMessage, 'sticker', 'webp');
        } else if (message.message?.videoMessage) {
            mediaType = 'video';
            content = message.message.videoMessage.caption || '';
            mediaPath = await saveMedia(messageId, message.message.videoMessage, 'video', 'mp4');
        } else if (message.message?.audioMessage) {
            mediaType = 'audio';
            const mime = message.message.audioMessage.mimetype || '';
            const ext = mime.includes('ogg') ? 'ogg' : 'mp3';
            mediaPath = await saveMedia(messageId, message.message.audioMessage, 'audio', ext);
        }

        // Nothing useful (reactions, receipts, poll updates, etc.).
        if (!content && !mediaPath) return;

        messageStore.set(messageId, {
            content,
            mediaType: mediaPath ? mediaType : '',
            mediaPath,
            sender,
            group: remoteJid.endsWith('@g.us') ? remoteJid : null,
            storedAt: Date.now(),
            timestamp: new Date().toISOString()
        });
        pruneStore();

        // Anti-ViewOnce: forward immediately to the owner if captured.
        if (isViewOnce && mediaType && mediaPath && fs.existsSync(mediaPath)) {
            const target = ownerJid(sock);
            if (!target) return;
            try {
                const senderName = numberPart(sender);
                const mediaOptions = {
                    caption: `*Anti-ViewOnce ${mediaType}*\nFrom: @${senderName}`,
                    mentions: [sender]
                };
                if (mediaType === 'image') {
                    await sock.sendMessage(target, { image: { url: mediaPath }, ...mediaOptions });
                } else if (mediaType === 'video') {
                    await sock.sendMessage(target, { video: { url: mediaPath }, ...mediaOptions });
                }
                // Cleanup immediately for view-once forward
                try { fs.unlinkSync(mediaPath); } catch { /* ignore */ }
            } catch (err) {
                console.error('anti-viewonce forward error:', err?.message || err);
            }
        }
    } catch (err) {
        console.error('storeMessage error:', err);
    }
}

/* ------------------------------------------------------------------ */
/* Handle message deletion                                             */
/* ------------------------------------------------------------------ */

async function handleMessageRevocation(sock, revocationMessage) {
    try {
        const config = loadAntideleteConfig();
        if (!config.enabled) return;

        const revoked = revocationMessage?.message?.protocolMessage;
        const messageId = revoked?.key?.id;
        if (!messageId) return;

        const deletedBy = revocationMessage.participant
            || revocationMessage.key?.participant
            || revocationMessage.key?.remoteJid
            || '';

        // Ignore deletions performed by the bot itself or the owner.
        const target = ownerJid(sock);
        const selfNum = numberPart(sock?.user?.id);
        const ownerNum = numberPart(settings.ownerNumber);
        const deletedNum = numberPart(deletedBy);
        if (deletedNum && (deletedNum === selfNum || deletedNum === ownerNum)) return;

        const original = messageStore.get(messageId);
        if (!original) return;

        if (!target) return;

        const sender = original.sender || '';
        const senderName = numberPart(sender);

        let groupName = '';
        if (original.group) {
            try {
                groupName = (await sock.groupMetadata(original.group))?.subject || '';
            } catch { /* left the group / metadata unavailable */ }
        }

        const time = new Date().toLocaleString('en-US', {
            timeZone: 'Asia/Kolkata',
            hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit',
            day: '2-digit', month: '2-digit', year: 'numeric'
        });

        let text = `*🔰 ANTIDELETE REPORT 🔰*\n\n` +
            `*🗑️ Deleted By:* @${numberPart(deletedBy)}\n` +
            `*👤 Sender:* @${senderName}\n` +
            `*📱 Number:* ${sender || '_unknown_'}\n` +
            `*🕒 Time:* ${time}\n`;

        if (groupName) text += `*👥 Group:* ${groupName}\n`;

        if (original.content) {
            text += `\n*💬 Deleted Message:*\n${original.content}`;
        }

        const mentions = [deletedBy, sender].filter(Boolean);

        try {
            await sock.sendMessage(target, { text, mentions });
        } catch (err) {
            console.error('antidelete report send error:', err?.message || err);
            return;
        }

        // Media sending
        if (original.mediaType && original.mediaPath && fs.existsSync(original.mediaPath)) {
            const mediaOptions = {
                caption: `*Deleted ${original.mediaType}*\nFrom: @${senderName}`,
                mentions: [sender].filter(Boolean)
            };

            try {
                switch (original.mediaType) {
                    case 'image':
                        await sock.sendMessage(target, { image: { url: original.mediaPath }, ...mediaOptions });
                        break;
                    case 'sticker':
                        await sock.sendMessage(target, { sticker: { url: original.mediaPath }, ...mediaOptions });
                        break;
                    case 'video':
                        await sock.sendMessage(target, { video: { url: original.mediaPath }, ...mediaOptions });
                        break;
                    case 'audio':
                        await sock.sendMessage(target, {
                            audio: { url: original.mediaPath },
                            mimetype: 'audio/mpeg',
                            ptt: false,
                            ...mediaOptions
                        });
                        break;
                }
            } catch (err) {
                console.error('antidelete media send error:', err?.message || err);
                try {
                    await sock.sendMessage(target, { text: `⚠️ Error sending deleted media: ${err?.message || err}` });
                } catch { /* ignore */ }
            }

            // Cleanup
            try { fs.unlinkSync(original.mediaPath); } catch { /* ignore */ }
        }

        messageStore.delete(messageId);
    } catch (err) {
        console.error('handleMessageRevocation error:', err);
    }
}

module.exports = {
    handleAntideleteCommand,
    handleMessageRevocation,
    storeMessage,
    _internal: {
        toBuffer, numberPart, ownerJid, messageStore, CONFIG_PATH, TEMP_MEDIA_DIR,
        setDownloader: (fn) => { mediaDownloader = fn; }
    }
};