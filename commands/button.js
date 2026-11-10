const { sendCtaButtons, sendQuickReply } = require('../lib/button');
const settings = require('../settings');

async function buttonCommand(sock, chatId, message) {
    const rawText = message.message?.conversation || 
                    message.message?.extendedTextMessage?.text || '';
    const query = rawText.trim().split(/\s+/).slice(1).join(' ');

    const titleText = query ? `*🔘 Osunhive Chatbot Interactive Test*\n\nPrompt: "${query}"` 
                            : `*🔘 Osunhive Chatbot Interactive Buttons*\n\nTap any button below to trigger actions or open links:`;

    try {
        await sendCtaButtons(sock, chatId, {
            text: titleText,
            footer: `${settings.botName || 'Osunhive Chatbot'} • v${settings.version || '2.0.0'}`,
            ctaUrl: 'https://www.osunhive.name.ng',
            ctaUrlText: '🌐 Visit Osunhive',
            quickReplies: [
                { id: 'menu', text: '📜 Bot Menu' },
                { id: 'alive', text: '⚡ Bot Status' },
                { id: 'ping', text: '📶 Ping' }
            ],
            quoted: message
        });
    } catch (err) {
        console.error('Error in buttonCommand:', err);
        await sock.sendMessage(chatId, { text: `❌ Could not send interactive buttons: ${err.message}` }, { quoted: message });
    }
}

module.exports = buttonCommand;
