/**
 * Voice note command — turns text into a WhatsApp-friendly voice note using
 * Google TTS and lib/ttsAudio.
 *
 * Usage:
 *   .voice <text> [lang]        e.g. `.voice hello there`
 */

const { ttsToFile, cleanupFile } = require('../lib/ttsAudio');

async function voiceCommand(sock, chatId, args, message) {
    const rawArgs = Array.isArray(args) ? args : String(args || '').split(' ').filter(Boolean);
    const text = rawArgs.join(' ').trim();
    const quoted = message ? { quoted: message } : undefined;

    if (!text) {
        await sock.sendMessage(chatId, { text: 'Usage: `.voice <text> [lang]`' }, quoted);
        return;
    }

    let file;
    try {
        file = await ttsToFile(text, 'en');
        await sock.sendMessage(chatId, {
            audio: { url: file.path },
            mimetype: file.mimetype,
            ptt: true
        }, quoted);
    } catch (error) {
        console.error('[voice] failed:', error.message);
        await sock.sendMessage(chatId, { text: '❌ Failed to create voice note.' }, quoted);
    } finally {
        if (file) cleanupFile(file.path);
    }
}

module.exports = voiceCommand;
