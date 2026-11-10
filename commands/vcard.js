/**
 * vCard command — send the Osunhive contact card (owner) or the bot's own card.
 */

const settings = require('../settings');

function buildCard({ name, phone, title, org, notes, website, email }) {
    const waNum = String(phone || '').replace(/\D/g, '');
    const vcard =
        'BEGIN:VCARD\n' +
        'VERSION:3.0\n' +
        `FN:${name}\n` +
        `ORG:${org || 'Osunhive'};\n` +
        `TITLE:${title || 'Business'}\n` +
        `NOTE:${notes || ''}\n` +
        `URL:${website || 'https://www.osunhive.name.ng'}\n` +
        `EMAIL;TYPE=internet:${email || 'hello@osunhive.name.ng'}\n` +
        `TEL;waid=${waNum}:+${waNum}\n` +
        'END:VCARD';
    return { name, vcard };
}

async function handleVCard(sock, chatId, args, message) {
    const kind = (Array.isArray(args) ? args[0] : args || '').toString().toLowerCase();

    const card = kind === 'owner' || !kind
        ? buildCard({
            name: 'Osunhive',
            phone: settings.ownerNumber,
            title: 'Owner, Osunhive',
            org: 'Osunhive',
            notes: 'WhatsApp inquiries: 2349076129380',
            website: 'https://www.osunhive.name.ng',
            email: 'hello@osunhive.name.ng'
        })
        : kind === 'bot'
        ? buildCard({
            name: settings.botName,
            phone: settings.ownerNumber,
            title: 'WhatsApp automation by Osunhive',
            org: 'Osunhive',
            website: 'https://www.osunhive.name.ng'
        })
        : null;

    if (!card) {
        await sock.sendMessage(chatId, { text: '❌ Usage: `.vcard [owner|bot]`' });
        return;
    }

    await sock.sendMessage(chatId, {
        contacts: {
            displayName: card.name,
            contacts: [{ vcard: card.vcard }]
        }
    }, { quoted: message });
}

module.exports = handleVCard;
