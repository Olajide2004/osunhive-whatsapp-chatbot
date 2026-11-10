/**
 * Feedback helpers for Osunhive Chatbot.
 *
 * 1. Voice replies — after the text reply is sent, optionally read the first
 *    sentence out loud as a WhatsApp voice note (needs the `voice` toggle).
 * 2. Emoji reactions — short `react` messages for bot/owner actions like
 *    the auto-reply heart-check or the `.autopoststatus` acknowledge.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const execFile = require('child_process').execFile;
const gtts = require('gtts');

const MAX_TEXT_LENGTH = 140; // voice notes stay short & readable
const MIN_WORDS = 6;

function cleanForSpeech(text) {
    return String(text || '')
        .replace(/```[\s\S]*?```/g, '')   // skip fences
        .replace(/\{[^}]+\}/g, '')        // skip template braces
        .replace(/[•—║]+/g, ' ')          // drop bullet glyphs
        .replace(/[^a-zA-Z0-9 .,!?'"-]/g, ' ')
        .trim();
}

/**
 * Turn the first sentence of `text` into an OGG/OPUS voice note and send it.
 * Returns true if the voice note was sent.
 */
async function sendReplyVoiceNote(sock, place, text) {
    const sentence = cleanForSpeech(String(text || '').split('\n')[0] || '');
    const words = sentence.split(/\s+/).filter(Boolean);

    if (words.length < MIN_WORDS || sentence.length > MAX_TEXT_LENGTH) {
        return false;
    }

    const tmpFile = path.join(os.tmpdir(), `sunhive-vtt-${Date.now()}.mp3`);
    const outFile = tmpFile.replace(/\.mp3$/, '.opus-x.ogg');
    fs.mkdirSync(os.tmpdir(), { recursive: true });

    try {
        // gtts is callback-based; wrap it with a promise.
        await new Promise((resolve, reject) => {
            new gtts(sentence, 'en').save(tmpFile, (err) => (err ? reject(err) : resolve()));
        });

        // WhatsApp expects Opus in an OGG container; flip mp3 -> ogg with libopus.
        await new Promise((resolve, reject) => {
            execFile(
                'ffmpeg',
                ['-y', '-i', tmpFile, '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', outFile],
                (error) => (error ? reject(error) : resolve())
            );
        });

        const buf = fs.readFileSync(outFile);
        await sock.sendMessage(place, {
            audio: buf,
            ptt: true,
            mimetype: 'audio/ogg; codecs=opus'
        });
        return true;
    } catch (error) {
        console.error('[feedback] voice reply failed:', error.message);
        return false;
    } finally {
        for (const f of [tmpFile, outFile]) {
            try { fs.unlinkSync(f); } catch { /* may not exist */ }
        }
    }
}

/**
 * React to the referenced message with a small emoji.
 * `ctx` is the explicit MessageKey if known, otherwise falls back to the
 * `{ messageKey }` object returned by sendMessage.
 */
async function react(sock, payload, emoji = '❤️') {
    if (!payload || !payload.remoteJid || !payload.id) return false;
    try {
        await sock.sendMessage(payload.remoteJid, {
            react: { text: String(emoji || '❤️'), key: payload }
        });
        return true;
    } catch (error) {
        console.error('[feedback] react failed:', error.message);
        return false;
    }
}

module.exports = {
    sendReplyVoiceNote,
    react
};
