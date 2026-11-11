// 🧹 Fix for ENOSPC / temp overflow in hosted panels
const fs = require('fs');
const path = require('path');

// Redirect temp storage away from system /tmp
const customTemp = path.join(process.cwd(), 'temp');
if (!fs.existsSync(customTemp)) fs.mkdirSync(customTemp, { recursive: true });
process.env.TMPDIR = customTemp;
process.env.TEMP = customTemp;
process.env.TMP = customTemp;

// Auto-cleaner every 3 hours
setInterval(() => {
    fs.readdir(customTemp, (err, files) => {
        if (err) return;
        for (const file of files) {
            const filePath = path.join(customTemp, file);
            fs.stat(filePath, (err, stats) => {
                if (!err && Date.now() - stats.mtimeMs > 3 * 60 * 60 * 1000) {
                    fs.unlink(filePath, () => { });
                }
            });
        }
    });
    console.log('🧹 Temp folder auto-cleaned');
}, 3 * 60 * 60 * 1000);

const settings = require('./settings');
require('./config.js');
const { isBanned } = require('./lib/isBanned');
const { isSudo } = require('./lib/index');
const isOwnerOrSudo = require('./lib/isOwner');
const { handleAutotypingForMessage, handleAutoReply } = require('./commands/autotyping');
const { handleAutoread } = require('./commands/autoread');

// Command imports
const { getPreview, buildAdContext } = require('./lib/linkPreview');
const { recordVoteUpdate } = require('./lib/polls');
const { handleTicTacToeMove } = require('./commands/tictactoe');
const { incrementMessageCount } = require('./commands/topmembers');
const ownerCommand = require('./commands/owner');
const { handleTagDetection } = require('./commands/antitag');
const { Antilink } = require('./lib/antilink');
const { handleMentionDetection } = require('./commands/mention');
const { handleJoinEvent } = require('./commands/welcome');
const { handleLeaveEvent } = require('./commands/goodbye');
const { handleBadwordDetection } = require('./lib/antibadword');
const { handleChatbotResponse } = require('./commands/chatbot');
const { handlePromotionEvent } = require('./commands/promote');
const { handleDemotionEvent } = require('./commands/demote');
const { handleStatusUpdate } = require('./commands/autostatus');
const savestatusCommand = require('./commands/savestatus');
const { autoSave: savestatusAutoSave } = savestatusCommand;
const antibotCommand = require('./commands/antibot');
const { handleAntibotDetection } = antibotCommand;
const { handleMessageRevocation, storeMessage } = require('./commands/antidelete');
const { readPmBlockerState } = require('./commands/pmblocker');
const buttonCommand = require('./commands/button');
const { executeCommand } = require('./commands/command-router');

// Global settings

global.packname = settings.packname;
global.author = settings.author;
global.channelLink = "https://whatsapp.com/channel/0029Vb967rbHVvTcm04X9g3x";
global.ytch = "OsunHiveTech";

// Add this near the top of main.js with other global configurations
const channelInfo = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363419178084647@newsletter',
            newsletterName: 'Osunhive Chatbot',
            serverMessageId: -1
        }
    }
};

// Map simple, client-safe button ids to commands.
// WhatsApp clients are unreliable with ids containing dots/spaces, so every
// interactive button uses an alphanumeric id and we translate it here.
const BUTTON_COMMANDS = {
    // Help / menu
    menu: '.menu',
    menu_all: '.menu all',
    menu_general: '.menu general',
    menu_admin: '.menu admin',
    menu_owner: '.menu owner',
    menu_media: '.menu media',
    menu_textmaker: '.menu textmaker',
    menu_games: '.menu games',
    menu_fun: '.menu fun',
    menu_anime: '.menu anime',
    menu_misc: '.menu misc',
    menu_ai: '.menu ai',
    menu_downloader: '.menu downloader',
    menu_github: '.menu github',

    // Autotyping / autoreply toggles
    autotyping_on: '.autotyping on',
    autotyping_off: '.autotyping off',
    autotyping_toggle: '.autotyping',
    autoreply_on: '.autoreply on',
    autoreply_off: '.autoreply off',
    autoreply_toggle: '.autoreply',
    autoreply_group_toggle: '.autoreply group toggle',
    autoreply_group_on: '.autoreply group mention',
    autoreply_group_off: '.autoreply group off',
    autoreply_code_on: '.autoreply code on',
    autoreply_code_off: '.autoreply code off',

    // Auto-reply answer buttons
    ar_menu: '.menu',
    ar_product: '.products',
    ar_website: '.website',
    ar_offline: '.guide',
    ar_guide: '.guide',

    // Misc
    ping: '.ping',
    alive: '.alive'
};

// Some clients reply with the button label instead of its id.
const BUTTON_LABELS = {
    'back to menu': 'menu',
    '⬅️ back to menu': 'menu',
    'all commands': 'menu_all',
    '📜 all commands': 'menu_all',
    '🌐 general': 'menu_general',
    'general': 'menu_general',
    'menu': 'menu',
    '📋 menu': 'menu',
    '📋 open menu': 'menu',
    '📦 products': 'ar_product',
    'product': 'ar_product',
    'products': 'ar_product',
    '🌐 website': 'ar_website',
    'website': 'ar_website',
    '💡 faqs': 'ar_offline',
    'offline': 'ar_offline',
    // CDN browser buttons
    '⬆️ up': '.cdn up',
    'up': '.cdn up',
    '🏠 root': '.cdn root',
    'root': '.cdn root',
    '🔄 refresh': '.cdn refresh',
    'refresh': '.cdn refresh'
};

function normalizeButtonLabel(text) {
    return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Extract the selected id from any supported button / list / interactive reply
function extractButtonId(message) {
    const m = message?.message || {};

    if (m.buttonsResponseMessage?.selectedButtonId) {
        return m.buttonsResponseMessage.selectedButtonId;
    }
    if (m.templateButtonReplyMessage?.selectedId) {
        return m.templateButtonReplyMessage.selectedId;
    }
    if (m.listResponseMessage?.singleSelectReply?.selectedRowId) {
        return m.listResponseMessage.singleSelectReply.selectedRowId;
    }

    const nativeFlow = m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
    if (nativeFlow) {
        try {
            let params = typeof nativeFlow === 'string' ? JSON.parse(nativeFlow) : nativeFlow;
            // Handle clients that double-encode paramsJson
            if (typeof params === 'string') params = JSON.parse(params);
            const id = params.id || params.selectedId || params.selected_id || params.button_id;
            if (id) return id;
        } catch (err) {
            // ignore malformed params
        }
    }

    // Last resort: match the visible label (some clients drop the id).
    const label =
        m.interactiveResponseMessage?.body?.text ||
        m.buttonsResponseMessage?.selectedDisplayText ||
        m.listResponseMessage?.title;
    const mapped = BUTTON_LABELS[normalizeButtonLabel(label)];
    if (mapped) return mapped;

    return null;
}

function resolveButtonCommand(id) {
    if (!id) return null;
    return BUTTON_COMMANDS[id] || id;
}

/** Auto link unfurl for non-command messages containing URLs. */
const LINK_PREVIEW_CONFIG_PATH = path.join(__dirname, 'data', 'linkpreview.json');

function linkPreviewEnabled() {
    try {
        return JSON.parse(fs.readFileSync(LINK_PREVIEW_CONFIG_PATH, 'utf8')).enabled === true;
    } catch (error) {
        return false;
    }
}

function firstUrl(text) {
    const match = text && /https?:\/\/[^\s]+/.exec(text);
    return match ? match[0] : null;
}

async function autoLinkUnfurl(sock, chatId, text, message) {
    if (!linkPreviewEnabled()) return false;
    const url = firstUrl(text);
    if (!url) return false;
    // Never unfurl the bot's own messages or commands (already handled above).
    if (message && message.key && message.key.fromMe) return false;
    try {
        const preview = await getPreview(url);
        await sock.sendMessage(chatId, {
            text: url,
            contextInfo: buildAdContext(preview)
        });
        return true;
    } catch (error) {
        console.error('[linkpreview] auto-unfurl failed:', error.message);
        return false;
    }
}

async function handleMessages(sock, messageUpdate, printLog) {
    // Declared outside the try so the catch block can safely reference it.
    let chatId = null;
    try {
        const { messages, type } = messageUpdate;
        const message = messages[0];
        if (!message?.message) return;
        if (type !== 'notify') return;

        // Handle autoread functionality
        await handleAutoread(sock, message);

        // Store message for antidelete feature
        if (message.message) {
            storeMessage(sock, message);
        }

        // Handle message revocation
        if (message.message?.protocolMessage?.type === 0) {
            await handleMessageRevocation(sock, message);
            return;
        }

        // Collect poll votes for polls this bot created
        if (message.message?.pollUpdateMessage) {
            try {
                await recordVoteUpdate(sock, message);
            } catch (error) {
                console.error('[polls] vote record failed:', error?.message || error);
            }
            return;
        }

        chatId = message.key.remoteJid;
        const senderId = message.key.participant || message.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');
        const senderIsSudo = await isSudo(senderId);
        const senderIsOwnerOrSudo = await isOwnerOrSudo(senderId, sock, chatId);

        // Handle button responses
        const selectedButtonId = extractButtonId(message);
        let buttonCommand = resolveButtonCommand(selectedButtonId);

        // Some clients deliver a tapped button as plain text (the visible label)
        // instead of a structured reply. Map those labels to commands as well,
        // so tapping/typing "⬅️ Back to Menu" always works.
        const rawIncoming = (
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            message.message?.imageMessage?.caption ||
            message.message?.videoMessage?.caption ||
            ''
        ).trim();
        if (!buttonCommand && rawIncoming) {
            const labelId = BUTTON_LABELS[normalizeButtonLabel(rawIncoming)];
            if (labelId) buttonCommand = resolveButtonCommand(labelId);

            // CDN dynamic labels: "📂 #3", "📤 #3", "➡️ Page 2"
            if (!buttonCommand) {
                const norm = normalizeButtonLabel(rawIncoming);
                const entry = /^(?:📂|📤)\s*#?(\d+)$/.exec(norm);
                const page = /^(?:➡️|▶️|➡)\s*page\s*(\d+)$/.exec(norm);
                if (entry) buttonCommand = `.cdn ${entry[1]}`;
                else if (page) buttonCommand = `.cdn page ${page[1]}`;
            }
        }

        // Diagnostics: a structured reply arrived but we could not decode it.
        // Helps capture the exact shape for future clients.
        if (!buttonCommand) {
            const m = message.message || {};
            if (m.interactiveResponseMessage || m.listResponseMessage || m.buttonsResponseMessage || m.templateButtonReplyMessage) {
                console.log('⚠️ Undecoded interactive reply:', JSON.stringify(m).slice(0, 800));
            }
        }

        if (selectedButtonId) {
            if (selectedButtonId === 'channel') {
                await sock.sendMessage(chatId, {
                    text: '📢 *Join our Channel:*\nhttps://whatsapp.com/channel/0029Vb967rbHVvTcm04X9g3x'
                }, { quoted: message });
                return;
            } else if (selectedButtonId === 'owner') {
                const ownerCommand = require('./commands/owner');
                await ownerCommand(sock, chatId);
                return;
            } else if (selectedButtonId === 'support') {
                await sock.sendMessage(chatId, {
                    text: `🔗 *Support*\n\nhttps://chat.whatsapp.com/GA4WrOFythU6g3BFVubYM7?mode=wwt`
                }, { quoted: message });
                return;
            }
        }

        const userMessage = (
            message.message?.conversation?.trim() ||
            message.message?.extendedTextMessage?.text?.trim() ||
            message.message?.imageMessage?.caption?.trim() ||
            message.message?.videoMessage?.caption?.trim() ||
            buttonCommand?.trim() ||
            selectedButtonId?.trim() ||
            ''
        ).toLowerCase().replace(/\.\s+/g, '.').trim();

        // Preserve raw message for commands like .tag that need original casing
        const rawText = message.message?.conversation?.trim() ||
            message.message?.extendedTextMessage?.text?.trim() ||
            message.message?.imageMessage?.caption?.trim() ||
            message.message?.videoMessage?.caption?.trim() ||
            '';

        // Only log command usage
        if (userMessage.startsWith('.')) {
            console.log(`📝 Command used in ${isGroup ? 'group' : 'private'}: ${userMessage}`);
        }
        // Read bot mode once; don't early-return so moderation can still run in private mode
        let isPublic = true;
        try {
            const data = JSON.parse(fs.readFileSync('./data/messageCount.json'));
            if (typeof data.isPublic === 'boolean') isPublic = data.isPublic;
        } catch (error) {
            console.error('Error checking access mode:', error);
            // default isPublic=true on error
        }
        const isOwnerOrSudoCheck = message.key.fromMe || senderIsOwnerOrSudo;
        // Check if user is banned (skip ban check for unban command)
        if (isBanned(senderId) && !userMessage.startsWith('.unban')) {
            // Only respond occasionally to avoid spam
            if (Math.random() < 0.1) {
                await sock.sendMessage(chatId, {
                    text: '❌ You are banned from using the bot. Contact an admin to get unbanned.',
                    ...channelInfo
                });
            }
            return;
        }

        // First check if it's a game move
        if (/^[1-9]$/.test(userMessage) || userMessage.toLowerCase() === 'surrender') {
            await handleTicTacToeMove(sock, chatId, senderId, userMessage);
            return;
        }

        /*  // Basic message response in private chat
          if (!isGroup && (userMessage === 'hi' || userMessage === 'hello' || userMessage === 'bot' || userMessage === 'hlo' || userMessage === 'hey' || userMessage === 'bro')) {
              await sock.sendMessage(chatId, {
                  text: 'Hi, How can I help you?\nYou can use .menu for more info and commands.',
                  ...channelInfo
              });
              return;
          } */

        if (!message.key.fromMe) incrementMessageCount(chatId, senderId);

        // Check for bad words and antilink FIRST, before ANY other processing
        // Always run moderation in groups, regardless of mode
        if (isGroup) {
            // Catch non-BAE5 bot IDs (3EB0 etc.) that weren't dropped in index.js
            await handleAntibotDetection(sock, message);
            if (userMessage) {
                await handleBadwordDetection(sock, chatId, message, userMessage, senderId);
            }
            // Antilink checks message text internally, so run it even if userMessage is empty
            await Antilink(message, sock);
        }

        // PM blocker: block non-owner DMs when enabled (do not ban)
        if (!isGroup && !message.key.fromMe && !senderIsSudo) {
            try {
                const pmState = readPmBlockerState();
                if (pmState.enabled) {
                    // Inform user, delay, then block without banning globally
                    await sock.sendMessage(chatId, { text: pmState.message || 'Private messages are blocked. Please contact the owner in groups only.' });
                    await new Promise(r => setTimeout(r, 1500));
                    try { await sock.updateBlockStatus(chatId, 'block'); } catch (e) { }
                    return;
                }
            } catch (e) { }
        }

        
        // Then check for command prefix
// Then check for command prefix
if (!userMessage.startsWith('.')) {

    // ✅ AUTO-REPLY (SAFE)
    if (userMessage) {
        // Pass the original message so the handler can skip messages you send
        // (fromMe), apply group policy and read mentions/quotes.
        const replied = await handleAutoReply(sock, chatId, rawText || userMessage, message);
        if (replied) return;
    }

    // Auto link unfurling — fetch OG info for any URLs in the message.
    if (!userMessage.startsWith('.') && !message.key.fromMe) {
        const textToUnfurl = rawText || userMessage || '';
        await autoLinkUnfurl(sock, chatId, textToUnfurl, message);
    }

    // Show typing indicator if autotyping is enabled
    await handleAutotypingForMessage(sock, chatId, userMessage);
    
            if (isGroup) {
                // Always run moderation features (antitag) regardless of mode
                await handleTagDetection(sock, chatId, message, senderId);
                await handleMentionDetection(sock, chatId, message);

                // Only run chatbot in public mode or for owner/sudo
                if (isPublic || isOwnerOrSudoCheck) {
                    await handleChatbotResponse(sock, chatId, message, userMessage, senderId);
                }
            }
            return;
        }
        // In private mode, only owner/sudo can run commands
        if (!isPublic && !isOwnerOrSudoCheck) {
            return;
        }

        // Command routing + execution lives in commands/command-router.js.
        await executeCommand({
            sock, chatId, message, senderId, userMessage, rawText, rawIncoming,
            isGroup, isPublic, isOwnerOrSudoCheck, senderIsSudo, senderIsOwnerOrSudo,
            channelInfo
        });
    } catch (error) {
        console.error('❌ Error in message handler:', error.message);
        // Only try to send an error message if we have a valid chat and a live socket.
        if (chatId) {
            try {
                await sock.sendMessage(chatId, {
                    text: '❌ Failed to process command!',
                    ...channelInfo
                });
            } catch {
                /* socket already closed — nothing to report to */
            }
        }
    }
}

async function handleGroupParticipantUpdate(sock, update) {
    try {
        const { id, participants, action, author } = update;

        // Check if it's a group
        if (!id.endsWith('@g.us')) return;

        // Respect bot mode: only announce promote/demote in public mode
        let isPublic = true;
        try {
            const modeData = JSON.parse(fs.readFileSync('./data/messageCount.json'));
            if (typeof modeData.isPublic === 'boolean') isPublic = modeData.isPublic;
        } catch (e) {
            // If reading fails, default to public behavior
        }

        // Handle promotion events
        if (action === 'promote') {
            if (!isPublic) return;
            await handlePromotionEvent(sock, id, participants, author);
            return;
        }

        // Handle demotion events
        if (action === 'demote') {
            if (!isPublic) return;
            await handleDemotionEvent(sock, id, participants, author);
            return;
        }

        // Handle join events
        if (action === 'add') {
            await handleJoinEvent(sock, id, participants);
        }

        // Handle leave events
        if (action === 'remove') {
            await handleLeaveEvent(sock, id, participants);
        }
    } catch (error) {
        console.error('Error in handleGroupParticipantUpdate:', error);
    }
}

// Instead, export the handlers along with handleMessages
module.exports = {
    handleMessages,
    handleGroupParticipantUpdate,
    extractButtonId,
    resolveButtonCommand,
    handleStatus: async (sock, status) => {
        await handleStatusUpdate(sock, status);
        try {
            // Only full status messages (messages.upsert) — never reactions / empty updates
            const msg = status.messages?.[0];
            if (msg?.message && msg.key?.remoteJid === 'status@broadcast') {
                await savestatusAutoSave(sock, msg);
            }
        } catch (e) {
            console.error('[savestatus] hook:', e?.message || e);
        }
    }
};