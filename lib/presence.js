/**
 * Osunhive Chatbot - Presence Simulation Helpers
 *
 * Reusable wrappers around Baileys presence/chatstate so every module can
 * look "human": online, typing, recording a voice note and uploading a file.
 *
 * WhatsApp only officially exposes:
 *   unavailable | available | composing | recording | paused
 *
 * The "file upload" indicator is sent as a raw chatstate:
 *   <chatstate><composing media="document"/></chatstate>
 * Clients that understand the media hint show an upload indicator; others
 * gracefully ignore it, so we fall back to normal composing.
 */

const { jidDecode } = require('@whiskeysockets/baileys');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolve the identity WhatsApp expects in the `from` attribute. */
function getSelfJid(sock) {
    const me = sock?.user || {};
    // Prefer LID when the chat is LID-based; Baileys sets me.lid for those.
    return me.lid || me.id || null;
}

async function subscribe(sock, chatId) {
    if (!chatId) return false;
    try {
        await sock.presenceSubscribe(chatId);
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Show the bot as online.
 * Note: Baileys sends `available` as a global presence; `chatId` is optional.
 */
async function setOnline(sock, chatId) {
    try {
        if (chatId) await subscribe(sock, chatId);
        await sock.sendPresenceUpdate('available', chatId);
        return true;
    } catch (err) {
        console.error('❌ Presence (online) failed:', err?.message || err);
        return false;
    }
}

/** Show the typing… indicator. */
async function setTyping(sock, chatId) {
    if (!chatId) return false;
    try {
        await sock.sendPresenceUpdate('composing', chatId);
        return true;
    } catch (err) {
        return false;
    }
}

/** Show the recording-audio… indicator (microphone). */
async function setRecording(sock, chatId) {
    if (!chatId) return false;
    try {
        await sock.sendPresenceUpdate('recording', chatId);
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Show the "uploading file…" indicator.
 * Sends a raw chatstate with a media hint, then falls back to composing.
 */
async function setUploading(sock, chatId, media = 'document') {
    if (!chatId) return false;

    const selfJid = getSelfJid(sock);
    if (!selfJid || typeof sock.sendNode !== 'function') {
        return setTyping(sock, chatId);
    }

    try {
        const { server } = jidDecode(chatId) || {};
        const from = server === 'lid' && sock?.user?.lid ? sock.user.lid : selfJid;

        await sock.sendNode({
            tag: 'chatstate',
            attrs: { from, to: chatId },
            content: [{ tag: 'composing', attrs: { media } }]
        });
        return true;
    } catch (err) {
        return setTyping(sock, chatId);
    }
}

/** Clear the indicator / go back to idle. */
async function clearPresence(sock, chatId) {
    if (!chatId) return false;
    try {
        await sock.sendPresenceUpdate('paused', chatId);
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Run a full human-like presence cycle:
 *   online → typing → recording → uploading → typing → paused
 *
 * All steps are optional via `options`. Delay values are in milliseconds.
 *
 * @param {object} sock Baileys socket
 * @param {string} chatId Recipient JID
 * @param {object} [options]
 * @returns {Promise<void>}
 */
async function simulateHumanPresence(sock, chatId, options = {}) {
    const {
        showOnline = true,
        showTyping = true,
        showRecording = true,
        showUpload = true,
        onlineDelay = 300,
        typingDelay = 1500,
        recordingDelay = 1000,
        uploadDelay = 800,
        finalTypingDelay = 600,
        clear = true
    } = options;

    if (showOnline) {
        await setOnline(sock, chatId);
        if (onlineDelay > 0) await sleep(onlineDelay);
    } else {
        await subscribe(sock, chatId);
    }

    if (showTyping) {
        await setTyping(sock, chatId);
        if (typingDelay > 0) await sleep(typingDelay);
    }

    if (showRecording) {
        await setRecording(sock, chatId);
        if (recordingDelay > 0) await sleep(recordingDelay);
    }

    if (showUpload) {
        await setUploading(sock, chatId);
        if (uploadDelay > 0) await sleep(uploadDelay);
    }

    if (showTyping && finalTypingDelay > 0) {
        await setTyping(sock, chatId);
        await sleep(finalTypingDelay);
    }

    if (clear) await clearPresence(sock, chatId);
}

/** Short "online + typing" pulse, useful for quick navigation replies. */
async function pulseTyping(sock, chatId, duration = 900) {
    await setOnline(sock, chatId);
    await setTyping(sock, chatId);
    if (duration > 0) await sleep(duration);
    await clearPresence(sock, chatId);
}

module.exports = {
    sleep,
    subscribe,
    setOnline,
    setTyping,
    setRecording,
    setUploading,
    clearPresence,
    simulateHumanPresence,
    pulseTyping
};
