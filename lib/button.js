/**
 * Osunhive Chatbot - Button Helper Library
 * Wrapper around GitHub button helper utilities for WhatsApp / Baileys
 * Provides high-level interactive buttons, URL buttons, call buttons, and list menus.
 */

const {
    sendButtons,
    sendInteractiveMessage,
    sendInteractiveMessageV2,
    getButtonType,
    getButtonArgs,
    InteractiveValidationError,
    validateAuthoringButtons,
    validateSendButtonsPayload,
} = require('@ryuu-reinzz/button-helper');
const settings = require('../settings');

const DEFAULT_NEWSLETTER = {
    newsletterJid: '120363419178084647@newsletter',
    newsletterName: 'Osunhive Chatbot',
    serverMessageId: -1
};

/**
 * Send standard quick-reply buttons with automatic graceful fallback
 * @param {object} sock Baileys socket instance
 * @param {string} chatId Recipient JID (individual or group)
 * @param {object} options Options object
 * @param {string} options.text Body text of the message
 * @param {string} [options.footer] Footer text (optional)
 * @param {Array<{id: string, text: string}>} options.buttons Array of buttons
 * @param {object} [options.quoted] Quoted message object (optional)
 * @param {object} [options.contextInfo] Additional context info (optional)
 */
async function sendQuickReply(sock, chatId, {
    text,
    footer = `© ${settings.botName || 'Osunhive Chatbot'}`,
    buttons = [],
    quoted = null,
    contextInfo = {}
}) {
    const formattedButtons = buttons.map((btn, idx) => ({
        id: btn.id || `btn_${idx + 1}`,
        text: btn.text || btn.displayText || `Option ${idx + 1}`
    }));

    const mergedContext = {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: DEFAULT_NEWSLETTER,
        ...contextInfo
    };

    try {
        return await sendButtons(sock, chatId, {
            text,
            footer,
            buttons: formattedButtons,
            contextInfo: mergedContext,
            quoted
        });
    } catch (err) {
        console.warn('⚠️ Interactive button send failed, falling back to text:', err.message);
        // Fallback to formatted text with numbers
        let fallbackText = `${text}\n\n`;
        formattedButtons.forEach((b, i) => {
            fallbackText += `*${i + 1}.* ${b.text} (reply: \`${b.id}\`)\n`;
        });
        if (footer) fallbackText += `\n_${footer}_`;

        return await sock.sendMessage(chatId, {
            text: fallbackText,
            contextInfo: mergedContext
        }, { quoted });
    }
}

/**
 * Send CTA URL and Call buttons alongside quick replies
 * @param {object} sock Baileys socket instance
 * @param {string} chatId Recipient JID
 * @param {object} options
 */
async function sendCtaButtons(sock, chatId, {
    text,
    footer = `© ${settings.botName || 'Osunhive Chatbot'}`,
    ctaUrl = null,
    ctaUrlText = 'Visit Website',
    ctaCall = null,
    ctaCallText = 'Call Support',
    quickReplies = [],
    quoted = null,
    contextInfo = {}
}) {
    const interactiveButtons = [];

    // CTA URL button
    if (ctaUrl) {
        interactiveButtons.push({
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: ctaUrlText,
                url: ctaUrl,
                merchant_url: ctaUrl
            })
        });
    }

    // CTA Call button
    if (ctaCall) {
        interactiveButtons.push({
            name: 'cta_call',
            buttonParamsJson: JSON.stringify({
                display_text: ctaCallText,
                phone_number: ctaCall
            })
        });
    }

    // Quick replies
    quickReplies.forEach((btn, idx) => {
        interactiveButtons.push({
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({
                display_text: btn.text || `Option ${idx + 1}`,
                id: btn.id || `btn_${idx + 1}`
            })
        });
    });

    const mergedContext = {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: DEFAULT_NEWSLETTER,
        ...contextInfo
    };

    try {
        return await sendInteractiveMessage(sock, chatId, {
            text,
            footer,
            interactiveButtons,
            contextInfo: mergedContext,
            quoted
        });
    } catch (err) {
        console.warn('⚠️ CTA button failed, sending text fallback:', err.message);
        let fallback = `${text}\n`;
        if (ctaUrl) fallback += `\n🔗 *${ctaUrlText}:* ${ctaUrl}`;
        if (ctaCall) fallback += `\n📞 *${ctaCallText}:* ${ctaCall}`;
        if (quickReplies.length) {
            fallback += '\n\n*Options:*\n';
            quickReplies.forEach((b, i) => {
                fallback += `• ${b.text}: \`${b.id}\`\n`;
            });
        }
        if (footer) fallback += `\n_${footer}_`;

        return await sock.sendMessage(chatId, {
            text: fallback,
            contextInfo: mergedContext
        }, { quoted });
    }
}

/**
 * Send interactive single-select list menu
 * @param {object} sock Baileys socket
 * @param {string} chatId Recipient JID
 * @param {object} options
 */
async function sendListMenu(sock, chatId, {
    title,
    text,
    footer = `© ${settings.botName || 'Osunhive Chatbot'}`,
    buttonText = 'Select Option',
    sections = [],
    quoted = null,
    contextInfo = {}
}) {
    const listParams = {
        title: title || 'Menu',
        sections: sections.map(sec => ({
            title: sec.title || 'Options',
            rows: (sec.rows || []).map(r => ({
                header: r.header || '',
                title: r.title,
                description: r.description || '',
                id: r.id
            }))
        }))
    };

    const interactiveButtons = [{
        name: 'single_select',
        buttonParamsJson: JSON.stringify(listParams)
    }];

    const mergedContext = {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: DEFAULT_NEWSLETTER,
        ...contextInfo
    };

    try {
        return await sendInteractiveMessage(sock, chatId, {
            title,
            text,
            footer,
            interactiveButtons,
            contextInfo: mergedContext,
            quoted
        });
    } catch (err) {
        console.warn('⚠️ List menu failed, sending text fallback:', err.message);
        let fallback = `*${title || 'MENU'}*\n${text}\n\n`;
        sections.forEach(sec => {
            if (sec.title) fallback += `*─── ${sec.title} ───*\n`;
            (sec.rows || []).forEach(r => {
                fallback += `• *${r.title}* - ${r.description || ''} (\`${r.id}\`)\n`;
            });
            fallback += '\n';
        });
        if (footer) fallback += `_${footer}_`;

        return await sock.sendMessage(chatId, {
            text: fallback,
            contextInfo: mergedContext
        }, { quoted });
    }
}

module.exports = {
    sendButtons,
    sendInteractiveMessage,
    sendInteractiveMessageV2,
    sendQuickReply,
    sendCtaButtons,
    sendListMenu,
    getButtonType,
    getButtonArgs,
    InteractiveValidationError,
    validateAuthoringButtons,
    validateSendButtonsPayload,
};
