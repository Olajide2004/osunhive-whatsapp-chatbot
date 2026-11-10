/**
 * Osunhive products / store command.
 *
 *   .products  (aliases: .product, .shop, .store)
 *
 * Sends the Osunhive product catalogue with a website CTA button and quick
 * navigation replies.
 */

const settings = require('../settings');
const { sendCtaButtons } = require('../lib/button');

const WEBSITE = 'https://www.osunhive.name.ng';

const PRODUCTS_TEXT =
    `📦 *OSUNHIVE PRODUCTS & SERVICES* 📦\n\n` +
    `• *Osunhive UI Premium Template* — a fast, responsive, SEO-ready Blogger theme.\n` +
    `• *Blogger AI Generator* — create SEO-optimised blog posts in seconds.\n` +
    `• *WhatsApp Bot Templates* — ready-to-deploy bots like this one.\n` +
    `• *Website & App Templates* — landing pages, portfolios and Android starters.\n` +
    `• *Free AI Utilities* — article rewriter, voice synthesis and graphic tools.\n\n` +
    `🌐 Browse everything and order at:\n${WEBSITE}\n\n` +
    `_Type *menu* for commands, or tap a button below._`;

async function productsCommand(sock, chatId, message) {
    await sendCtaButtons(sock, chatId, {
        text: PRODUCTS_TEXT,
        footer: `© ${settings.botName || 'Osunhive Chatbot'}`,
        ctaUrl: WEBSITE,
        ctaUrlText: '🛍️ Visit Store',
        quickReplies: [
            { id: 'ar_menu', text: '📋 Menu' },
            { id: 'ar_website', text: '🌐 Website' }
        ],
        quoted: message
    });
}

module.exports = productsCommand;
module.exports.PRODUCTS_TEXT = PRODUCTS_TEXT;
