/**
 * Link unfurl — fetch OpenGraph info and render a preview card next to the user's link.
 *
 * Usage:
 *   .unfurl https://example.com   preview title/description/image
 */

const isOwnerOrSudo = require('../lib/isOwner');
const { sendUnfurl } = require('../lib/linkPreview');

async function unfurlCommand(sock, chatId, url, message, senderId) {
    if (!url) {
        await sock.sendMessage(chatId, { text: '❌ Usage: `.unfurl <url>`' });
        return;
    }

    if (!/^https?:\/\//i.test(url)) {
        await sock.sendMessage(chatId, { text: '❌ Must be a full URL: `.unfurl https://example.com`' });
        return;
    }

    if (!(await isOwnerOrSudo(senderId, sock, chatId))) {
        await sock.sendMessage(chatId, { text: '❌ Owner only command!' });
        return;
    }

    await sendUnfurl(sock, chatId, url, { quoted: message });
}

module.exports = unfurlCommand;
