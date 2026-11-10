/**
 * React command — quick emoji reaction to the quoted message.
 *
 * Usage:
 *   .react 👍           react to the quoted message
 *   .react 👍 3         (alias) same
 */

const isOwnerOrSudo = require('../lib/isOwner');

async function reactCommand(sock, chatId, args, message, senderId) {
    if (!(await isOwnerOrSudo(senderId, sock, chatId))) {
        await sock.sendMessage(chatId, { text: '❌ Owner only command!' });
        return;
    }

    const emoji = ((args && args[0]) || '❤️').trim();
    const ctx = message?.message?.extendedTextMessage?.contextInfo;
    if (!ctx?.stanzaId) {
        await sock.sendMessage(chatId, {
            text: '❌ Reply to a message with `.react <emoji>`.\nExample: `.react 👍`'
        });
        return;
    }

    const key = {
        id: ctx.stanzaId,
        remoteJid: chatId,
        participant: ctx.participant || message.key?.participant || undefined
    };

    try {
        await sock.sendMessage(chatId, { react: { text: emoji, key } });
    } catch (error) {
        await sock.sendMessage(chatId, { text: `❌ Couldn't react: ${error.message}` });
    }
}

module.exports = reactCommand;
