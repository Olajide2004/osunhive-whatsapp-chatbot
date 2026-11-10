const settings = require("../settings");
const { sendCtaButtons } = require("../lib/button");

async function aliveCommand(sock, chatId, message) {
    try {
        const messageText = `*🤖 Osunhive Chatbot is Active!*\n\n` +
                       `*Version:* ${settings.version || '2.0.0'}\n` +
                       `*Status:* Online & Operational ✅\n` +
                       `*Mode:* ${settings.commandMode || 'Public'}\n` +
                       `*Owner:* ${settings.botOwner || 'Osunhive'}\n\n` +
                       `*🌟 Features:*\n` +
                       `• Group Management & Moderation\n` +
                       `• Antilink & Antibot Shield\n` +
                       `• Interactive Buttons & Media Tools\n` +
                       `• AI & Chatbot Assistants\n\n` +
                       `Type *.menu* for the complete command directory.`;

        await sendCtaButtons(sock, chatId, {
            text: messageText,
            footer: `${settings.botName || 'Osunhive Chatbot'} • https://www.osunhive.name.ng`,
            ctaUrl: 'https://www.osunhive.name.ng',
            ctaUrlText: '🌐 Osunhive Portal',
            quickReplies: [
                { id: 'menu', text: '📜 Command Menu' },
                { id: 'ping', text: '📶 Speed Test' },
                { id: 'owner', text: '👑 Owner Info' }
            ],
            quoted: message
        });
    } catch (error) {
        console.error('Error in alive command:', error);
        await sock.sendMessage(chatId, { text: '🤖 Osunhive Chatbot is alive and running!' }, { quoted: message });
    }
}

module.exports = aliveCommand;