/**
 * Command router — the single place every bot command is dispatched.
 *
 * `main.js` only ingests messages, applies moderation/mode policy and hands the
 * command over here, so all command code lives in the `commands/` folder.
 * Handlers for each command live in their own file (commands/<name>.js); this
 * module owns the parsing, permission checks and routing.
 */

'use strict';

const fs = require('fs');
const path = require('path');

require('../config.js');
const { isBanned } = require('../lib/isBanned');
const { isSudo } = require('../lib/index');
const isOwnerOrSudo = require('../lib/isOwner');
const {
  autotypingCommand,
  autoreplyCommand,
  isAutotypingEnabled,
  handleAutotypingForMessage,
  handleAutotypingForCommand,
  showTypingAfterCommand,
  handleAutoReply
} = require('./autotyping');
const { autoreadCommand, isAutoreadEnabled, handleAutoread } = require('./autoread');

// Command imports
const tagAllCommand = require('./tagall');
const helpCommand = require('./help');
const banCommand = require('./ban');
const { promoteCommand } = require('./promote');
const { demoteCommand } = require('./demote');
const muteCommand = require('./mute');
const unmuteCommand = require('./unmute');
const stickerCommand = require('./sticker');
const isAdmin = require('../lib/isAdmin');
const warnCommand = require('./warn');
const warningsCommand = require('./warnings');
const ttsCommand = require('./tts');
const guideCommand = require('./guide');
const { handlePoll } = require('./poll');
const unfurlCommand = require('./unfurl');
const linkPreviewCommand = require('./linkpreview');
const { getPreview, buildAdContext } = require('../lib/linkPreview');
const scheduleCommand = require('./schedule');
const { recordVoteUpdate } = require('../lib/polls');
const handleVCard = require('./vcard');
const reactCommand = require('./react');
const voiceCommand = require('./voice');
const { tictactoeCommand, handleTicTacToeMove } = require('./tictactoe');
const { incrementMessageCount, topMembers } = require('./topmembers');
const ownerCommand = require('./owner');
const deleteCommand = require('./delete');
const { handleAntilinkCommand, handleLinkDetection } = require('./antilink');
const { handleAntitagCommand, handleTagDetection } = require('./antitag');
const { Antilink } = require('../lib/antilink');
const { handleMentionDetection, mentionToggleCommand, setMentionCommand } = require('./mention');
const memeCommand = require('./meme');
const tagCommand = require('./tag');
const tagNotAdminCommand = require('./tagnotadmin');
const hideTagCommand = require('./hidetag');
const jokeCommand = require('./joke');
const quoteCommand = require('./quote');
const factCommand = require('./fact');
const weatherCommand = require('./weather');
const newsCommand = require('./news');
const kickCommand = require('./kick');
const simageCommand = require('./simage');
const attpCommand = require('./attp');
const { startHangman, guessLetter } = require('./hangman');
const { startTrivia, answerTrivia } = require('./trivia');
const { complimentCommand } = require('./compliment');
const { insultCommand } = require('./insult');
const { eightBallCommand } = require('./eightball');
const { lyricsCommand } = require('./lyrics');
const { dareCommand } = require('./dare');
const { truthCommand } = require('./truth');
const { clearCommand } = require('./clear');
const pingCommand = require('./ping');
const aliveCommand = require('./alive');
const blurCommand = require('./img-blur');
const { welcomeCommand, handleJoinEvent } = require('./welcome');
const { goodbyeCommand, handleLeaveEvent } = require('./goodbye');
const githubCommand = require('./github');
const { handleAntiBadwordCommand, handleBadwordDetection } = require('../lib/antibadword');
const antibadwordCommand = require('./antibadword');
const { handleChatbotCommand, handleChatbotResponse } = require('./chatbot');
const takeCommand = require('./take');
const { flirtCommand } = require('./flirt');
const characterCommand = require('./character');
const wastedCommand = require('./wasted');
const shipCommand = require('./ship');
const groupInfoCommand = require('./groupinfo');
const resetlinkCommand = require('./resetlink');
const staffCommand = require('./staff');
const unbanCommand = require('./unban');
const emojimixCommand = require('./emojimix');
const { handlePromotionEvent } = require('./promote');
const { handleDemotionEvent } = require('./demote');
const viewOnceCommand = require('./viewonce');
const vv2Command = require('./vv2');
const clearSessionCommand = require('./clearsession');
const { autoStatusCommand, handleStatusUpdate } = require('./autostatus');
const { autopostStatusCommand } = require('./autopoststatus');
const cdnCommand = require('./cdn');
const savestatusCommand = require('./savestatus');
const { autoSave: savestatusAutoSave } = savestatusCommand;
const groupstatusCommand = require('./groupstatus');
const antibotCommand = require('./antibot');
const { handleAntibotDetection } = antibotCommand;
const { simpCommand } = require('./simp');
const { stupidCommand } = require('./stupid');
const stickerTelegramCommand = require('./stickertelegram');
const textmakerCommand = require('./textmaker');
const { handleAntideleteCommand, handleMessageRevocation, storeMessage } = require('./antidelete');
const clearTmpCommand = require('./cleartmp');
const setProfilePicture = require('./setpp');
const { setGroupDescription, setGroupName, setGroupPhoto } = require('./groupmanage');
const instagramCommand = require('./instagram');
const facebookCommand = require('./facebook');
const twitterCommand = require('./twitter');
const spotifyCommand = require('./spotify');
const playCommand = require('./play');
const tiktokCommand = require('./tiktok');
const songCommand = require('./song');
const aiCommand = require('./ai');
const urlCommand = require('./url');
const { handleTranslateCommand } = require('./translate');
const { handleSsCommand } = require('./ss');
const { addCommandReaction, handleAreactCommand } = require('../lib/reactions');
const { goodnightCommand } = require('./goodnight');
const { shayariCommand } = require('./shayari');
const { rosedayCommand } = require('./roseday');
const imagineCommand = require('./imagine');
const videoCommand = require('./video');
const sudoCommand = require('./sudo');
const { miscCommand, handleHeart } = require('./misc');
const { animeCommand } = require('./anime');
const { piesCommand, piesAlias } = require('./pies');
const stickercropCommand = require('./stickercrop');
const updateCommand = require('./update');
const { fireworksCommand, countdownCommand } = require('./celebrate');
const removebgCommand = require('./removebg');
const { reminiCommand } = require('./remini');
const { igsCommand } = require('./igs');
const { anticallCommand, readState: readAnticallState } = require('./anticall');
const { pmblockerCommand, readState: readPmBlockerState } = require('./pmblocker');
const settingsCommand = require('./settings');
const soraCommand = require('./sora');
const buttonCommand = require('./button');
const productsCommand = require('./products');
const websiteCommand = require('./website');

/**
 * Execute a command for an incoming message.
 *
 * @param {object} ctx
 * @param {object} ctx.sock                 live Baileys socket
 * @param {string} ctx.chatId               chat the message came from
 * @param {object} ctx.message              the raw message object
 * @param {string} ctx.senderId             participant jid
 * @param {string} ctx.userMessage          lower-cased command text (with button ids resolved)
 * @param {string} ctx.rawText              original-case text
 * @param {string} ctx.rawIncoming          raw, un-normalised text
 * @param {boolean} ctx.isGroup             true for group chats
 * @param {boolean} ctx.isPublic            bot access mode
 * @param {boolean} ctx.isOwnerOrSudoCheck  message from me / owner / sudo
 * @param {boolean} ctx.senderIsSudo        sender is a sudo user
 * @param {boolean} ctx.senderIsOwnerOrSudo sender is owner or sudo
 * @param {object} ctx.channelInfo          newsletter forwarding context
 * @returns {Promise<void>}
 */
async function executeCommand(ctx) {
    const {
        sock, chatId, message, senderId, userMessage, rawText, rawIncoming,
        isGroup, isPublic, isOwnerOrSudoCheck, senderIsSudo, senderIsOwnerOrSudo,
        channelInfo
    } = ctx;

    // List of admin commands
    const adminCommands = ['.mute', '.unmute', '.ban', '.unban', '.promote', '.demote', '.kick', '.tagall', '.tagnotadmin', '.hidetag', '.antilink', '.antitag', '.antibot', '.nobot', '.setgdesc', '.setgname', '.setgpp', '.groupstatus', '.togstatus', '.swgc', '.gstatus', '.gs'];
    const isAdminCommand = adminCommands.some(cmd => userMessage.startsWith(cmd));

    // List of owner commands
    const ownerCommands = ['.mode', '.autostatus', '.autopoststatus', '.autostatuspost', '.statuspost', '.savestatus', '.savesm', '.savest', '.antidelete', '.cleartmp', '.setpp', '.clearsession', '.areact', '.autoreact', '.autotyping', '.autoreply', '.autoread', '.pmblocker', '.schedule', '.linkpreview', '.cdn'];
    const isOwnerCommand = ownerCommands.some(cmd => userMessage.startsWith(cmd));

    let isSenderAdmin = false;
    let isBotAdmin = false;

    // Check admin status only for admin commands in groups
    if (isGroup && isAdminCommand) {
        const adminStatus = await isAdmin(sock, chatId, senderId);
        isSenderAdmin = adminStatus.isSenderAdmin;
        isBotAdmin = adminStatus.isBotAdmin;

        if (!isBotAdmin) {
            await sock.sendMessage(chatId, { text: 'Please make the bot an admin to use admin commands.', ...channelInfo }, { quoted: message });
            return;
        }

        if (
            userMessage.startsWith('.mute') ||
            userMessage === '.unmute' ||
            userMessage.startsWith('.ban') ||
            userMessage.startsWith('.unban') ||
            userMessage.startsWith('.promote') ||
            userMessage.startsWith('.demote')
        ) {
            if (!isSenderAdmin && !message.key.fromMe) {
                await sock.sendMessage(chatId, {
                    text: 'Sorry, only group admins can use this command.',
                    ...channelInfo
                }, { quoted: message });
                return;
            }
        }
    }

    // Check owner status for owner commands
    if (isOwnerCommand) {
        if (!message.key.fromMe && !senderIsOwnerOrSudo) {
            await sock.sendMessage(chatId, { text: '❌ This command is only available for the owner or sudo!' }, { quoted: message });
            return;
        }
    }

    // Command handlers - Execute commands immediately without waiting for typing indicator
    // We'll show typing indicator after command execution if needed
    let commandExecuted = false;

    switch (true) {
        case userMessage === '.simage': {
            const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quotedMessage?.stickerMessage) {
                await simageCommand(sock, quotedMessage, chatId);
            } else {
                await sock.sendMessage(chatId, { text: 'Please reply to a sticker with the .simage command to convert it.', ...channelInfo }, { quoted: message });
            }
            commandExecuted = true;
            break;
        }
        case userMessage.startsWith('.kick'):
            const mentionedJidListKick = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            await kickCommand(sock, chatId, senderId, mentionedJidListKick, message);
            break;
        case userMessage.startsWith('.mute'):
            {
                const parts = userMessage.trim().split(/\s+/);
                const muteArg = parts[1];
                const muteDuration = muteArg !== undefined ? parseInt(muteArg, 10) : undefined;
                if (muteArg !== undefined && (isNaN(muteDuration) || muteDuration <= 0)) {
                    await sock.sendMessage(chatId, { text: 'Please provide a valid number of minutes or use .mute with no number to mute immediately.', ...channelInfo }, { quoted: message });
                } else {
                    await muteCommand(sock, chatId, senderId, message, muteDuration);
                }
            }
            break;
        case userMessage === '.unmute':
            await unmuteCommand(sock, chatId, senderId);
            break;
        case userMessage.startsWith('.ban'):
            if (!isGroup) {
                if (!message.key.fromMe && !senderIsSudo) {
                    await sock.sendMessage(chatId, { text: 'Only owner/sudo can use .ban in private chat.' }, { quoted: message });
                    break;
                }
            }
            await banCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.unban'):
            if (!isGroup) {
                if (!message.key.fromMe && !senderIsSudo) {
                    await sock.sendMessage(chatId, { text: 'Only owner/sudo can use .unban in private chat.' }, { quoted: message });
                    break;
                }
            }
            await unbanCommand(sock, chatId, message);
            break;
        case userMessage === '.help' || userMessage.startsWith('.help ') ||
             userMessage === '.menu' || userMessage.startsWith('.menu ') ||
             userMessage === '.bot' || userMessage === '.list':
            await helpCommand(sock, chatId, message, global.channelLink, userMessage);
            commandExecuted = true;
            break;
        case userMessage === '.guide' || userMessage.startsWith('.guide '):
            await guideCommand(
                sock,
                chatId,
                userMessage.slice(6).trim().split(' ').filter(Boolean),
                message
            );
            commandExecuted = true;
            break;
        case userMessage === '.products' || userMessage === '.product' ||
             userMessage === '.shop' || userMessage === '.store':
            await productsCommand(sock, chatId, message);
            commandExecuted = true;
            break;
        case userMessage === '.website' || userMessage === '.links' ||
             userMessage === '.link' || userMessage === '.socials':
            await websiteCommand(sock, chatId, message);
            commandExecuted = true;
            break;
        case userMessage === '.fireworks' || userMessage.startsWith('.fireworks '):
            await fireworksCommand(sock, chatId, message, rawIncoming.slice(10).trim());
            commandExecuted = true;
            break;
        case userMessage === '.countdown' || userMessage.startsWith('.countdown '):
            await countdownCommand(sock, chatId, message, userMessage.slice(10).trim());
            commandExecuted = true;
            break;
        case userMessage === '.sticker' || userMessage === '.s':
            await stickerCommand(sock, chatId, message);
            commandExecuted = true;
            break;
        case userMessage.startsWith('.warnings'):
            const mentionedJidListWarnings = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            await warningsCommand(sock, chatId, mentionedJidListWarnings);
            break;
        case userMessage.startsWith('.warn'):
            const mentionedJidListWarn = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            await warnCommand(sock, chatId, senderId, mentionedJidListWarn, message);
            break;
        case userMessage.startsWith('.tts'):
            const text = userMessage.slice(4).trim();
            await ttsCommand(sock, chatId, text, message);
            break;
        case userMessage === '.poll' || userMessage.startsWith('.poll '):
            await handlePoll(
                sock,
                chatId,
                userMessage.slice(4).trim().split(' ').filter(Boolean),
                message,
                senderId
            );
            commandExecuted = true;
            break;
        case userMessage.startsWith('.schedule'):
            await scheduleCommand(sock, chatId, userMessage.slice(9).trim().split(' ').filter(Boolean), message, senderId);
            commandExecuted = true;
            break;
        case userMessage.startsWith('.unfurl'):
            await unfurlCommand(sock, chatId, userMessage.slice(7).trim(), message, senderId);
            commandExecuted = true;
            break;
        case userMessage.startsWith('.linkpreview'):
            await linkPreviewCommand(sock, chatId, userMessage.slice(11).trim().split(' ').filter(Boolean), message, senderId);
            commandExecuted = true;
            break;
        case userMessage === '.vcard' || userMessage.startsWith('.vcard '):
            await handleVCard(
                sock,
                chatId,
                userMessage.slice(6).trim().split(' ').filter(Boolean),
                message
            );
            commandExecuted = true;
            break;
        case userMessage === '.react' || userMessage.startsWith('.react '):
            await reactCommand(
                sock,
                chatId,
                userMessage.slice(6).trim().split(' ').filter(Boolean),
                message,
                senderId
            );
            commandExecuted = true;
            break;
        case userMessage === '.voice' || userMessage.startsWith('.voice '):
            await voiceCommand(
                sock,
                chatId,
                userMessage.slice(6).trim().split(' ').filter(Boolean),
                message,
                senderId
            );
            commandExecuted = true;
            break;
        case userMessage.startsWith('.delete') || userMessage.startsWith('.del'):
            await deleteCommand(sock, chatId, message, senderId);
            break;
        case userMessage.startsWith('.attp'):
            await attpCommand(sock, chatId, message);
            break;

        case userMessage === '.settings':
            await settingsCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.mode'):
            // Check if sender is the owner
            if (!message.key.fromMe && !senderIsOwnerOrSudo) {
                await sock.sendMessage(chatId, { text: 'Only bot owner can use this command!', ...channelInfo }, { quoted: message });
                return;
            }
            // Read current data first
            let data;
            try {
                data = JSON.parse(fs.readFileSync('./data/messageCount.json'));
            } catch (error) {
                console.error('Error reading access mode:', error);
                await sock.sendMessage(chatId, { text: 'Failed to read bot mode status', ...channelInfo });
                return;
            }

            const action = userMessage.split(' ')[1]?.toLowerCase();
            // If no argument provided, show current status
            if (!action) {
                const currentMode = data.isPublic ? 'public' : 'private';
                await sock.sendMessage(chatId, {
                    text: `Current bot mode: *${currentMode}*\n\nUsage: .mode public/private\n\nExample:\n.mode public - Allow everyone to use bot\n.mode private - Restrict to owner only`,
                    ...channelInfo
                }, { quoted: message });
                return;
            }

            if (action !== 'public' && action !== 'private') {
                await sock.sendMessage(chatId, {
                    text: 'Usage: .mode public/private\n\nExample:\n.mode public - Allow everyone to use bot\n.mode private - Restrict to owner only',
                    ...channelInfo
                }, { quoted: message });
                return;
            }

            try {
                // Update access mode
                data.isPublic = action === 'public';

                // Save updated data
                fs.writeFileSync('./data/messageCount.json', JSON.stringify(data, null, 2));

                await sock.sendMessage(chatId, { text: `Bot is now in *${action}* mode`, ...channelInfo });
            } catch (error) {
                console.error('Error updating access mode:', error);
                await sock.sendMessage(chatId, { text: 'Failed to update bot access mode', ...channelInfo });
            }
            break;
        case userMessage.startsWith('.anticall'):
            if (!message.key.fromMe && !senderIsOwnerOrSudo) {
                await sock.sendMessage(chatId, { text: 'Only owner/sudo can use anticall.' }, { quoted: message });
                break;
            }
            {
                const args = userMessage.split(' ').slice(1).join(' ');
                await anticallCommand(sock, chatId, message, args);
            }
            break;
        case userMessage.startsWith('.pmblocker'):
            {
                const args = userMessage.split(' ').slice(1).join(' ');
                await pmblockerCommand(sock, chatId, message, args);
            }
            commandExecuted = true;
            break;
        case userMessage === '.owner':
            await ownerCommand(sock, chatId);
            break;
        case userMessage === '.tagall':
            await tagAllCommand(sock, chatId, senderId, message);
            break;
        case userMessage === '.tagnotadmin':
            await tagNotAdminCommand(sock, chatId, senderId, message);
            break;
        case userMessage.startsWith('.hidetag'):
            {
                const messageText = rawText.slice(8).trim();
                const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
                await hideTagCommand(sock, chatId, senderId, messageText, replyMessage, message);
            }
            break;
        case userMessage.startsWith('.tag'):
            const messageText = rawText.slice(4).trim();  // use rawText here, not userMessage
            const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
            await tagCommand(sock, chatId, senderId, messageText, replyMessage, message);
            break;
        case userMessage.startsWith('.antibot') || userMessage.startsWith('.nobot'):
            await antibotCommand(sock, chatId, message, senderId);
            break;
        case userMessage.startsWith('.antilink'):
            if (!isGroup) {
                await sock.sendMessage(chatId, {
                    text: 'This command can only be used in groups.',
                    ...channelInfo
                }, { quoted: message });
                return;
            }
            if (!isBotAdmin) {
                await sock.sendMessage(chatId, {
                    text: 'Please make the bot an admin first.',
                    ...channelInfo
                }, { quoted: message });
                return;
            }
            await handleAntilinkCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
            break;
        case userMessage.startsWith('.antitag'):
            if (!isGroup) {
                await sock.sendMessage(chatId, {
                    text: 'This command can only be used in groups.',
                    ...channelInfo
                }, { quoted: message });
                return;
            }
            if (!isBotAdmin) {
                await sock.sendMessage(chatId, {
                    text: 'Please make the bot an admin first.',
                    ...channelInfo
                }, { quoted: message });
                return;
            }
            await handleAntitagCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
            break;
        case userMessage === '.meme':
            await memeCommand(sock, chatId, message);
            break;
        case userMessage === '.joke':
            await jokeCommand(sock, chatId, message);
            break;
        case userMessage === '.quote':
            await quoteCommand(sock, chatId, message);
            break;
        case userMessage === '.fact':
            await factCommand(sock, chatId, message, message);
            break;
        case userMessage.startsWith('.weather'):
            const city = userMessage.slice(9).trim();
            if (city) {
                await weatherCommand(sock, chatId, message, city);
            } else {
                await sock.sendMessage(chatId, { text: 'Please specify a city, e.g., .weather London', ...channelInfo }, { quoted: message });
            }
            break;
        case userMessage === '.news':
            await newsCommand(sock, chatId);
            break;
        case userMessage.startsWith('.ttt') || userMessage.startsWith('.tictactoe'):
            const tttText = userMessage.split(' ').slice(1).join(' ');
            await tictactoeCommand(sock, chatId, senderId, tttText);
            break;
        case userMessage.startsWith('.move'):
            const position = parseInt(userMessage.split(' ')[1]);
            if (isNaN(position)) {
                await sock.sendMessage(chatId, { text: 'Please provide a valid position number for Tic-Tac-Toe move.', ...channelInfo }, { quoted: message });
            } else {
                tictactoeMove(sock, chatId, senderId, position);
            }
            break;
        case userMessage === '.topmembers':
            topMembers(sock, chatId, isGroup);
            break;
        case userMessage.startsWith('.hangman'):
            startHangman(sock, chatId);
            break;
        case userMessage.startsWith('.guess'):
            const guessedLetter = userMessage.split(' ')[1];
            if (guessedLetter) {
                guessLetter(sock, chatId, guessedLetter);
            } else {
                sock.sendMessage(chatId, { text: 'Please guess a letter using .guess <letter>', ...channelInfo }, { quoted: message });
            }
            break;
        case userMessage.startsWith('.trivia'):
            startTrivia(sock, chatId);
            break;
        case userMessage.startsWith('.answer'):
            const answer = userMessage.split(' ').slice(1).join(' ');
            if (answer) {
                answerTrivia(sock, chatId, answer);
            } else {
                sock.sendMessage(chatId, { text: 'Please provide an answer using .answer <answer>', ...channelInfo }, { quoted: message });
            }
            break;
        case userMessage.startsWith('.compliment'):
            await complimentCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.insult'):
            await insultCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.8ball'):
            const question = userMessage.split(' ').slice(1).join(' ');
            await eightBallCommand(sock, chatId, question);
            break;
        case userMessage.startsWith('.lyrics'):
            const songTitle = userMessage.split(' ').slice(1).join(' ');
            await lyricsCommand(sock, chatId, songTitle, message);
            break;
        case userMessage.startsWith('.simp'):
            const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const mentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            await simpCommand(sock, chatId, quotedMsg, mentionedJid, senderId);
            break;
        case userMessage.startsWith('.stupid') || userMessage.startsWith('.itssostupid') || userMessage.startsWith('.iss'):
            const stupidQuotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const stupidMentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const stupidArgs = userMessage.split(' ').slice(1);
            await stupidCommand(sock, chatId, stupidQuotedMsg, stupidMentionedJid, senderId, stupidArgs);
            break;
        case userMessage === '.dare':
            await dareCommand(sock, chatId, message);
            break;
        case userMessage === '.truth':
            await truthCommand(sock, chatId, message);
            break;
        case userMessage === '.clear':
            if (isGroup) await clearCommand(sock, chatId);
            break;
        case userMessage.startsWith('.promote'):
            const mentionedJidListPromote = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            await promoteCommand(sock, chatId, mentionedJidListPromote, message);
            break;
        case userMessage.startsWith('.demote'):
            const mentionedJidListDemote = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            await demoteCommand(sock, chatId, mentionedJidListDemote, message);
            break;
        case userMessage === '.ping':
            await pingCommand(sock, chatId, message);
            break;
        case userMessage === '.alive':
            await aliveCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.mention '):
            {
                const args = userMessage.split(' ').slice(1).join(' ');
                const isOwner = message.key.fromMe || senderIsSudo;
                await mentionToggleCommand(sock, chatId, message, args, isOwner);
            }
            break;
        case userMessage === '.setmention':
            {
                const isOwner = message.key.fromMe || senderIsSudo;
                await setMentionCommand(sock, chatId, message, isOwner);
            }
            break;
        case userMessage.startsWith('.blur'):
            const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            await blurCommand(sock, chatId, message, quotedMessage);
            break;
        case userMessage.startsWith('.welcome'):
            if (isGroup) {
                // Check admin status if not already checked
                if (!isSenderAdmin) {
                    const adminStatus = await isAdmin(sock, chatId, senderId);
                    isSenderAdmin = adminStatus.isSenderAdmin;
                }

                if (isSenderAdmin || message.key.fromMe) {
                    await welcomeCommand(sock, chatId, message);
                } else {
                    await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.', ...channelInfo }, { quoted: message });
                }
            } else {
                await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
            }
            break;
        case userMessage.startsWith('.goodbye'):
            if (isGroup) {
                // Check admin status if not already checked
                if (!isSenderAdmin) {
                    const adminStatus = await isAdmin(sock, chatId, senderId);
                    isSenderAdmin = adminStatus.isSenderAdmin;
                }

                if (isSenderAdmin || message.key.fromMe) {
                    await goodbyeCommand(sock, chatId, message);
                } else {
                    await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.', ...channelInfo }, { quoted: message });
                }
            } else {
                await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
            }
            break;
        case userMessage === '.git':
        case userMessage === '.github':
        case userMessage === '.sc':
        case userMessage === '.script':
        case userMessage === '.repo':
            await githubCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.antibadword'):
            if (!isGroup) {
                await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                return;
            }

            const adminStatus = await isAdmin(sock, chatId, senderId);
            isSenderAdmin = adminStatus.isSenderAdmin;
            isBotAdmin = adminStatus.isBotAdmin;

            if (!isBotAdmin) {
                await sock.sendMessage(chatId, { text: '*Bot must be admin to use this feature*', ...channelInfo }, { quoted: message });
                return;
            }

            await antibadwordCommand(sock, chatId, message, senderId, isSenderAdmin);
            break;
        case userMessage.startsWith('.chatbot'):
            if (!isGroup) {
                await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                return;
            }

            // Check if sender is admin or bot owner
            const chatbotAdminStatus = await isAdmin(sock, chatId, senderId);
            if (!chatbotAdminStatus.isSenderAdmin && !message.key.fromMe) {
                await sock.sendMessage(chatId, { text: '*Only admins or bot owner can use this command*', ...channelInfo }, { quoted: message });
                return;
            }

            const match = userMessage.slice(8).trim();
            await handleChatbotCommand(sock, chatId, message, match);
            break;
        case userMessage.startsWith('.take') || userMessage.startsWith('.steal'):
            {
                const isSteal = userMessage.startsWith('.steal');
                const sliceLen = isSteal ? 6 : 5; // '.steal' vs '.take'
                const takeArgs = rawText.slice(sliceLen).trim().split(' ');
                await takeCommand(sock, chatId, message, takeArgs);
            }
            break;
        case userMessage === '.flirt':
            await flirtCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.character'):
            await characterCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.waste'):
            await wastedCommand(sock, chatId, message);
            break;
        case userMessage === '.ship':
            if (!isGroup) {
                await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                return;
            }
            await shipCommand(sock, chatId, message);
            break;
        case userMessage === '.groupinfo' || userMessage === '.infogp' || userMessage === '.infogrupo':
            if (!isGroup) {
                await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                return;
            }
            await groupInfoCommand(sock, chatId, message);
            break;
        case userMessage === '.resetlink' || userMessage === '.revoke' || userMessage === '.anularlink':
            if (!isGroup) {
                await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                return;
            }
            await resetlinkCommand(sock, chatId, senderId);
            break;
        case userMessage === '.staff' || userMessage === '.admins' || userMessage === '.listadmin':
            if (!isGroup) {
                await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                return;
            }
            await staffCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.tourl') || userMessage.startsWith('.url'):
            await urlCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.emojimix') || userMessage.startsWith('.emix'):
            await emojimixCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.tg') || userMessage.startsWith('.stickertelegram') || userMessage.startsWith('.tgsticker') || userMessage.startsWith('.telesticker'):
            await stickerTelegramCommand(sock, chatId, message);
            break;

        case userMessage === '.vv':
            await viewOnceCommand(sock, chatId, message);
            break;
        case userMessage === '.vv2':
            await vv2Command(sock, chatId, message, senderId);
            break;
        case userMessage === '.clearsession' || userMessage === '.clearsesi':
            await clearSessionCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.autopoststatus') ||
             userMessage.startsWith('.autostatuspost') ||
             userMessage.startsWith('.statuspost') ||
             userMessage.startsWith('.autopost'):
            await autopostStatusCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.cdn'):
            await cdnCommand(sock, chatId, message);
            break;
        case /^\.autostatus(\s|$)/.test(userMessage):
            const autoStatusArgs = userMessage.split(' ').slice(1);
            await autoStatusCommand(sock, chatId, message, autoStatusArgs);
            break;
        case userMessage.startsWith('.savestatus') || userMessage.startsWith('.savesm') || userMessage.startsWith('.savest'):
            await savestatusCommand(sock, chatId, message, senderId);
            break;
        case userMessage.startsWith('.groupstatus') || userMessage.startsWith('.togstatus') || userMessage.startsWith('.swgc') || userMessage.startsWith('.gstatus') || userMessage === '.gs' || userMessage.startsWith('.gs '):
            await groupstatusCommand(sock, chatId, message, senderId);
            break;
        case userMessage.startsWith('.simp'):
            await simpCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.metallic'):
            await textmakerCommand(sock, chatId, message, userMessage, 'metallic');
            break;
        case userMessage.startsWith('.ice'):
            await textmakerCommand(sock, chatId, message, userMessage, 'ice');
            break;
        case userMessage.startsWith('.snow'):
            await textmakerCommand(sock, chatId, message, userMessage, 'snow');
            break;
        case userMessage.startsWith('.impressive'):
            await textmakerCommand(sock, chatId, message, userMessage, 'impressive');
            break;
        case userMessage.startsWith('.matrix'):
            await textmakerCommand(sock, chatId, message, userMessage, 'matrix');
            break;
        case userMessage.startsWith('.light'):
            await textmakerCommand(sock, chatId, message, userMessage, 'light');
            break;
        case userMessage.startsWith('.neon'):
            await textmakerCommand(sock, chatId, message, userMessage, 'neon');
            break;
        case userMessage.startsWith('.devil'):
            await textmakerCommand(sock, chatId, message, userMessage, 'devil');
            break;
        case userMessage.startsWith('.purple'):
            await textmakerCommand(sock, chatId, message, userMessage, 'purple');
            break;
        case userMessage.startsWith('.thunder'):
            await textmakerCommand(sock, chatId, message, userMessage, 'thunder');
            break;
        case userMessage.startsWith('.leaves'):
            await textmakerCommand(sock, chatId, message, userMessage, 'leaves');
            break;
        case userMessage.startsWith('.1917'):
            await textmakerCommand(sock, chatId, message, userMessage, '1917');
            break;
        case userMessage.startsWith('.arena'):
            await textmakerCommand(sock, chatId, message, userMessage, 'arena');
            break;
        case userMessage.startsWith('.hacker'):
            await textmakerCommand(sock, chatId, message, userMessage, 'hacker');
            break;
        case userMessage.startsWith('.sand'):
            await textmakerCommand(sock, chatId, message, userMessage, 'sand');
            break;
        case userMessage.startsWith('.blackpink'):
            await textmakerCommand(sock, chatId, message, userMessage, 'blackpink');
            break;
        case userMessage.startsWith('.glitch'):
            await textmakerCommand(sock, chatId, message, userMessage, 'glitch');
            break;
        case userMessage.startsWith('.fire'):
            await textmakerCommand(sock, chatId, message, userMessage, 'fire');
            break;
        case userMessage.startsWith('.antidelete'):
            const antideleteMatch = userMessage.slice(11).trim();
            await handleAntideleteCommand(sock, chatId, message, antideleteMatch);
            break;
        case userMessage === '.surrender':
            // Handle surrender command for tictactoe game
            await handleTicTacToeMove(sock, chatId, senderId, 'surrender');
            break;
        case userMessage === '.cleartmp':
            await clearTmpCommand(sock, chatId, message);
            break;
        case userMessage === '.setpp':
            await setProfilePicture(sock, chatId, message);
            break;
        case userMessage.startsWith('.setgdesc'):
            {
                const text = rawText.slice(9).trim();
                await setGroupDescription(sock, chatId, senderId, text, message);
            }
            break;
        case userMessage.startsWith('.setgname'):
            {
                const text = rawText.slice(9).trim();
                await setGroupName(sock, chatId, senderId, text, message);
            }
            break;
        case userMessage.startsWith('.setgpp'):
            await setGroupPhoto(sock, chatId, senderId, message);
            break;
        case userMessage.startsWith('.instagram') || userMessage.startsWith('.insta') || (userMessage === '.ig' || userMessage.startsWith('.ig ')):
            await instagramCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.igsc'):
            await igsCommand(sock, chatId, message, true);
            break;
        case userMessage.startsWith('.igs'):
            await igsCommand(sock, chatId, message, false);
            break;
        case userMessage.startsWith('.fb') || userMessage.startsWith('.facebook'):
            await facebookCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.twitter') || userMessage.startsWith('.x ') || userMessage === '.x' || userMessage.startsWith('.xdl') || userMessage.startsWith('.twdl'):
            await twitterCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.music'):
            await playCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.spotify'):
            await spotifyCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.play') || userMessage.startsWith('.mp3') || userMessage.startsWith('.ytmp3') || userMessage.startsWith('.song'):
            await songCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.video') || userMessage.startsWith('.ytmp4'):
            await videoCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.tiktok') || userMessage.startsWith('.tt'):
            await tiktokCommand(sock, chatId, message);
            break;
        case userMessage === '.ai' || userMessage.startsWith('.ai ') || userMessage.startsWith('.gpt') || userMessage.startsWith('.gemini'):
            await aiCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.translate') || userMessage.startsWith('.trt'):
            const commandLength = userMessage.startsWith('.translate') ? 10 : 4;
            await handleTranslateCommand(sock, chatId, message, userMessage.slice(commandLength));
            return;
        case userMessage.startsWith('.ss') || userMessage.startsWith('.ssweb') || userMessage.startsWith('.screenshot'):
            const ssCommandLength = userMessage.startsWith('.screenshot') ? 11 : (userMessage.startsWith('.ssweb') ? 6 : 3);
            await handleSsCommand(sock, chatId, message, userMessage.slice(ssCommandLength).trim());
            break;
        case userMessage.startsWith('.areact') || userMessage.startsWith('.autoreact') || userMessage.startsWith('.autoreaction'):
            await handleAreactCommand(sock, chatId, message, isOwnerOrSudoCheck);
            break;
        case userMessage.startsWith('.sudo'):
            await sudoCommand(sock, chatId, message);
            break;
        case userMessage === '.goodnight' || userMessage === '.lovenight' || userMessage === '.gn':
            await goodnightCommand(sock, chatId, message);
            break;
        case userMessage === '.shayari' || userMessage === '.shayri':
            await shayariCommand(sock, chatId, message);
            break;
        case userMessage === '.roseday':
            await rosedayCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.imagine') || userMessage.startsWith('.flux') || userMessage.startsWith('.dalle'): await imagineCommand(sock, chatId, message);
            break;
        case userMessage === '.jid': await groupJidCommand(sock, chatId, message);
            break;
        case userMessage.startsWith('.autotyping'):
            await autotypingCommand(sock, chatId, message);
            commandExecuted = true;
            break;
        case userMessage.startsWith('.autoreply') || userMessage.startsWith('.autorespond'):
            await autoreplyCommand(sock, chatId, message);
            commandExecuted = true;
            break;
        case userMessage.startsWith('.autoread'):
            await autoreadCommand(sock, chatId, message);
            commandExecuted = true;
            break;
        case userMessage.startsWith('.heart'):
            await handleHeart(sock, chatId, message);
            break;
        case userMessage.startsWith('.horny'):
            {
                const parts = userMessage.trim().split(/\s+/);
                const args = ['horny', ...parts.slice(1)];
                await miscCommand(sock, chatId, message, args);
            }
            break;
        case userMessage.startsWith('.circle'):
            {
                const parts = userMessage.trim().split(/\s+/);
                const args = ['circle', ...parts.slice(1)];
                await miscCommand(sock, chatId, message, args);
            }
            break;
        case userMessage.startsWith('.lgbt'):
            {
                const parts = userMessage.trim().split(/\s+/);
                const args = ['lgbt', ...parts.slice(1)];
                await miscCommand(sock, chatId, message, args);
            }
            break;
        case userMessage.startsWith('.lolice'):
            {
                const parts = userMessage.trim().split(/\s+/);
                const args = ['lolice', ...parts.slice(1)];
                await miscCommand(sock, chatId, message, args);
            }
            break;
        case userMessage.startsWith('.simpcard'):
            {
                const parts = userMessage.trim().split(/\s+/);
                const args = ['simpcard', ...parts.slice(1)];
                await miscCommand(sock, chatId, message, args);
            }
            break;
        case userMessage.startsWith('.tonikawa'):
            {
                const parts = userMessage.trim().split(/\s+/);
                const args = ['tonikawa', ...parts.slice(1)];
                await miscCommand(sock, chatId, message, args);
            }
            break;
        case userMessage.startsWith('.its-so-stupid'):
            {
                const parts = userMessage.trim().split(/\s+/);
                const args = ['its-so-stupid', ...parts.slice(1)];
                await miscCommand(sock, chatId, message, args);
            }
            break;
        case userMessage.startsWith('.namecard'):
            {
                const parts = userMessage.trim().split(/\s+/);
                const args = ['namecard', ...parts.slice(1)];
                await miscCommand(sock, chatId, message, args);
            }
            break;

        case userMessage.startsWith('.oogway2'):
        case userMessage.startsWith('.oogway'):
            {
                const parts = userMessage.trim().split(/\s+/);
                const sub = userMessage.startsWith('.oogway2') ? 'oogway2' : 'oogway';
                const args = [sub, ...parts.slice(1)];
                await miscCommand(sock, chatId, message, args);
            }
            break;
        case userMessage.startsWith('.tweet'):
            {
                const parts = userMessage.trim().split(/\s+/);
                const args = ['tweet', ...parts.slice(1)];
                await miscCommand(sock, chatId, message, args);
            }
            break;
        case userMessage.startsWith('.ytcomment'):
            {
                const parts = userMessage.trim().split(/\s+/);
                const args = ['youtube-comment', ...parts.slice(1)];
                await miscCommand(sock, chatId, message, args);
            }
            break;
        case userMessage.startsWith('.comrade'):
        case userMessage.startsWith('.gay'):
        case userMessage.startsWith('.glass'):
        case userMessage.startsWith('.jail'):
        case userMessage.startsWith('.passed'):
        case userMessage.startsWith('.triggered'):
            {
                const parts = userMessage.trim().split(/\s+/);
                const sub = userMessage.slice(1).split(/\s+/)[0];
                const args = [sub, ...parts.slice(1)];
                await miscCommand(sock, chatId, message, args);
            }
            break;
        case userMessage.startsWith('.animu'):
            {
                const parts = userMessage.trim().split(/\s+/);
                const args = parts.slice(1);
                await animeCommand(sock, chatId, message, args);
            }
            break;
        // animu aliases
        case userMessage.startsWith('.nom'):
        case userMessage.startsWith('.poke'):
        case userMessage.startsWith('.cry'):
        case userMessage.startsWith('.kiss'):
        case userMessage.startsWith('.pat'):
        case userMessage.startsWith('.hug'):
        case userMessage.startsWith('.wink'):
        case userMessage.startsWith('.facepalm'):
        case userMessage.startsWith('.face-palm'):
        case userMessage.startsWith('.animuquote'):
        case userMessage.startsWith('.quote'):
        case userMessage.startsWith('.loli'):
            {
                const parts = userMessage.trim().split(/\s+/);
                let sub = parts[0].slice(1);
                if (sub === 'facepalm') sub = 'face-palm';
                if (sub === 'quote' || sub === 'animuquote') sub = 'quote';
                await animeCommand(sock, chatId, message, [sub]);
            }
            break;
        case userMessage === '.crop':
            await stickercropCommand(sock, chatId, message);
            commandExecuted = true;
            break;
        case userMessage.startsWith('.pies'):
            {
                const parts = rawText.trim().split(/\s+/);
                const args = parts.slice(1);
                await piesCommand(sock, chatId, message, args);
                commandExecuted = true;
            }
            break;
        case userMessage === '.china':
            await piesAlias(sock, chatId, message, 'china');
            commandExecuted = true;
            break;
        case userMessage === '.indonesia':
            await piesAlias(sock, chatId, message, 'indonesia');
            commandExecuted = true;
            break;
        case userMessage === '.japan':
            await piesAlias(sock, chatId, message, 'japan');
            commandExecuted = true;
            break;
        case userMessage === '.korea':
            await piesAlias(sock, chatId, message, 'korea');
            commandExecuted = true;
            break;
        case userMessage === '.india':
            await piesAlias(sock, chatId, message, 'india');
            commandExecuted = true;
            break;
        case userMessage === '.malaysia':
            await piesAlias(sock, chatId, message, 'malaysia');
            commandExecuted = true;
            break;
        case userMessage === '.thailand':
            await piesAlias(sock, chatId, message, 'thailand');
            commandExecuted = true;
            break;
        case userMessage.startsWith('.update'):
            {
                const parts = rawText.trim().split(/\s+/);
                const zipArg = parts[1] && parts[1].startsWith('http') ? parts[1] : '';
                await updateCommand(sock, chatId, message, zipArg);
            }
            commandExecuted = true;
            break;
        case userMessage === '.button' || userMessage === '.btn' || userMessage.startsWith('.button ') || userMessage.startsWith('.btn '):
            await buttonCommand(sock, chatId, message);
            commandExecuted = true;
            break;
        case userMessage.startsWith('.removebg') || userMessage.startsWith('.rmbg') || userMessage.startsWith('.nobg'):

            await removebgCommand.exec(sock, message, userMessage.split(' ').slice(1));
            break;
        case userMessage.startsWith('.remini') || userMessage.startsWith('.enhance') || userMessage.startsWith('.upscale'):
            await reminiCommand(sock, chatId, message, userMessage.split(' ').slice(1));
            break;
        case userMessage.startsWith('.sora'):
            await soraCommand(sock, chatId, message);
            break;
        default:
            if (isGroup) {
                // Handle non-command group messages
                if (userMessage) {  // Make sure there's a message
                    await handleChatbotResponse(sock, chatId, message, userMessage, senderId);
                }
                await handleTagDetection(sock, chatId, message, senderId);
                await handleMentionDetection(sock, chatId, message);
            }
            commandExecuted = false;
            break;
    }

    // If a command was executed, show typing status after command execution
    if (commandExecuted !== false) {
        // Command was executed, now show typing status after command execution
        await showTypingAfterCommand(sock, chatId);
    }

    // Function to handle .groupjid command
    async function groupJidCommand(sock, chatId, message) {
        const groupJid = message.key.remoteJid;

        if (!groupJid.endsWith('@g.us')) {
            return await sock.sendMessage(chatId, {
                text: "❌ This command can only be used in a group."
            });
        }

        await sock.sendMessage(chatId, {
            text: `✅ Group JID: ${groupJid}`
        }, {
            quoted: message
        });
    }

    if (userMessage.startsWith('.')) {
        // After command is processed successfully
        await addCommandReaction(sock, message);
    }

    return;
}

module.exports = { executeCommand };
