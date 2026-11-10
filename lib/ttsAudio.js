/**
 * Shared TTS → WhatsApp voice note helper.
 *
 * Used by both the `.voice` command and the auto-reply `.autoreply voice`
 * option. Produces an Opus OGG file (mono, voip) via the system ffmpeg; falls
 * back to raw MP3 if ffmpeg is unavailable.
 */

const gTTS = require('gtts');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

function tempDir() {
    const dir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

async function ttsToFile(text, language = 'en') {
    if (!text) throw new Error('missing text');

    const id = Date.now() + '-' + Math.random().toString(36).slice(2);
    const mp3Path = path.join(tempDir(), `tts-${id}.mp3`);
    const oggPath = path.join(tempDir(), `tts-${id}.ogg`);

    await new Promise((resolve, reject) => {
        const gtts = new gTTS(text, language);
        gtts.save(mp3Path, (err) => (err ? reject(err) : resolve()));
    });

    // Try Opus OGG first (LTT/voip profile, WhatsApp-friendly).
    try {
        await new Promise((resolve, reject) => {
            execFile('ffmpeg', [
                '-y', '-i', mp3Path,
                '-c:a', 'libopus', '-b:a', '24k',
                '-vbr', 'on', '-compression_level', '10', '-application', 'voip',
                '-fs', '1900000',
                oggPath
            ], (error, stdout, stderr) => {
                if (error) reject(new Error(stderr || error.message));
                else resolve();
            });
        });

        if (fs.existsSync(oggPath) && fs.statSync(oggPath).size > 0) {
            fs.unlinkSync(mp3Path);
            return { path: oggPath, mimetype: 'audio/ogg; codecs=opus' };
        }
        throw new Error('empty opus output');
    } catch (error) {
        // mp3 fallback keeps `.voice` working on hosts without ffmpeg.
        return { path: mp3Path, mimetype: 'audio/mpeg' };
    }
}

function cleanupFile(file) {
    if (!file) return;
    try { fs.unlinkSync(file); } catch { }
}

module.exports = { ttsToFile, cleanupFile };
