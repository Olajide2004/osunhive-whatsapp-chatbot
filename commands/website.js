/**
 * Osunhive links / website command.
 *
 *   .website  (aliases: .links, .link, .socials)
 *
 * Sends every Osunhive channel with a website CTA button and quick replies.
 */

const settings = require('../settings');
const { sendCtaButtons } = require('../lib/button');

const WEBSITE = 'https://www.osunhive.name.ng';

const LINKS_TEXT =
    `🌐 *OSUNHIVE — OFFICIAL LINKS* 🌐\n\n` +
    `🔗 *Link hub:* https://yo.fan/osunhivetech\n` +
    `▶️ *YouTube:* https://www.youtube.com/channel/UCh0GXMxUUshupWAPvYkvPEA\n` +
    `📘 *Facebook:* https://www.facebook.com/osunhive.name.ng\n` +
    `🐦 *X / Twitter:* https://twitter.com/Sherifhive\n` +
    `💼 *LinkedIn:* https://www.linkedin.com/in/osunhiveofficial/\n` +
    `✈️ *Telegram:* https://t.me/Osunhive\n` +
    `🎵 *TikTok:* https://www.tiktok.com/osunhive.name.ng\n\n` +
    `💻 *Learn to code for free* at ${WEBSITE}`;

async function websiteCommand(sock, chatId, message) {
    await sendCtaButtons(sock, chatId, {
        text: LINKS_TEXT,
        footer: `© ${settings.botName || 'Osunhive Chatbot'}`,
        ctaUrl: WEBSITE,
        ctaUrlText: '🌐 Osunhive Website',
        quickReplies: [
            { id: 'ar_menu', text: '📋 Menu' },
            { id: 'ar_product', text: '📦 Products' }
        ],
        quoted: message
    });
}

module.exports = websiteCommand;
module.exports.LINKS_TEXT = LINKS_TEXT;
