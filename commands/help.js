const settings = require('../settings');
const { sendListMenu } = require('../lib/button');

const WEBSITE = 'https://www.osunhive.name.ng';
const DEFAULT_CHANNEL = global.channelLink || 'https://whatsapp.com/channel/0029Vb967rbHVvTcm04X9g3x';

const contextInfo = {
    forwardingScore: 1,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: '120363419178084647@newsletter',
        newsletterName: 'Osunhive Chatbot',
        serverMessageId: -1
    }
};

/**
 * Menu sections. Each entry is used both by the interactive list and by the
 * `.menu <section>` sub-commands.
 */
const SECTIONS = {
    general: {
        emoji: '🌐',
        title: 'General Commands',
        body: [
            '.help / .menu', '.ping', '.alive', '.button / .btn', '.tts <text>', '.guide [full]',
            '.products / .shop', '.website / .links',
            '.owner', '.joke', '.quote', '.fact', '.weather <city>', '.news',
            '.attp <text>', '.lyrics <song_title>', '.8ball <question>',
            '.groupinfo', '.staff / .admins', '.vv', '.vv2',
            '.trt <text> <lang>', '.ss <link>', '.jid', '.url',
            '.poll Question? | A | B [| C]', '.poll multi', '.poll results [id]', '.poll list', '.poll delete',
            '.unfurl <url>', '.vcard', '.react [emoji]', '.linkpreview on|off', '.voice <text>',
            '.schedule add|list|remove|enable|disable', '.schedule help'
        ]
    },
    admin: {
        emoji: '👮‍♂️',
        title: 'Admin Commands',
        body: [
            '.ban @user', '.promote @user', '.demote @user', '.mute <minutes>',
            '.unmute', '.delete / .del', '.kick @user', '.warnings @user',
            '.warn @user', '.antilink', '.antibadword', '.clear',
            '.tag <message>', '.tagall', '.tagnotadmin', '.hidetag <message>',
            '.chatbot', '.resetlink', '.antitag <on/off>', '.welcome <on/off>',
            '.goodbye <on/off>', '.antibot <on/off/set/get>',
            '.setgdesc <description>', '.setgname <new name>',
            '.setgpp (reply to image)', '.groupstatus [caption]'
        ]
    },
    owner: {
        emoji: '🔒',
        title: 'Owner Commands',
        body: [
            '.mode <public/private>', '.clearsession', '.antidelete', '.cleartmp',
            '.update', '.settings', '.setpp <reply to image>',
            '.autoreact <on/off>', '.autostatus <on/off>',
            '.autostatus react <on/off>', '.savestatus [on/off]',
            '.autotyping <on/off>', '.autoreply <on/off/meta/copybox/group/cooldown/engine/code/buttons>', '.autoread <on/off>',
            '.autopoststatus [on/off/now/text/add/list/remove/clear/bg/font/interval/delete]',
            '.autostatuspost <direct-link.mp4 | cdn:<fileId>>',
            '.cdn [list/page/info/link/send/post/back/root] [n|path]',
            '.anticall <on/off>', '.pmblocker <on/off/status>',
            '.pmblocker setmsg <text>', '.setmention <reply to msg>',
            '.mention <on/off>'
        ]
    },
    media: {
        emoji: '🎨',
        title: 'Image & Sticker Commands',
        body: [
            '.blur <image>', '.simage <reply to sticker>', '.sticker <reply to image>',
            '.removebg', '.remini', '.crop (reply sticker/image/video)',
            '.tgsticker <Link>', '.meme', '.take <packname>',
            '.emojimix <emj1>+<emj2>', '.igs <insta link>', '.igsc <insta link>'
        ]
    },
    textmaker: {
        emoji: '🔤',
        title: 'Textmaker Commands',
        body: [
            '.metallic <text>', '.ice <text>', '.snow <text>', '.impressive <text>',
            '.matrix <text>', '.light <text>', '.neon <text>', '.devil <text>',
            '.purple <text>', '.thunder <text>', '.leaves <text>', '.1917 <text>',
            '.arena <text>', '.hacker <text>', '.sand <text>', '.blackpink <text>',
            '.glitch <text>', '.fire <text>'
        ]
    },
    downloader: {
        emoji: '📥',
        title: 'Downloader Commands',
        body: [
            '.play <song_name>', '.song <song_name>', '.spotify <query>',
            '.instagram <link>', '.facebook <link>', '.twitter <link>',
            '.tiktok <link>', '.video <song name>', '.ytmp4 <Link>'
        ]
    },
    games: {
        emoji: '🎮',
        title: 'Game Commands',
        body: [
            '.tictactoe @user', '.hangman', '.guess <letter>', '.trivia',
            '.answer <answer>', '.truth', '.dare'
        ]
    },
    fun: {
        emoji: '🎯',
        title: 'Fun Commands',
        body: [
            '.compliment @user', '.insult @user', '.flirt', '.shayari',
            '.goodnight', '.roseday', '.character @user', '.wasted @user',
            '.ship @user', '.simp @user', '.stupid @user [text]'
        ]
    },
    anime: {
        emoji: '🖼️',
        title: 'Anime Commands',
        body: ['.nom', '.poke', '.cry', '.kiss', '.pat', '.hug', '.wink', '.facepalm']
    },
    misc: {
        emoji: '🧩',
        title: 'Misc Commands',
        body: [
            '.heart', '.horny', '.circle', '.lgbt', '.lolice', '.its-so-stupid',
            '.namecard', '.oogway', '.tweet', '.ytcomment', '.comrade', '.gay',
            '.glass', '.jail', '.passed', '.triggered'
        ]
    },
    ai: {
        emoji: '🤖',
        title: 'AI Commands',
        body: [
            '.ai <question>', '.gpt <question>', '.gemini <question>',
            '.imagine <prompt>', '.flux <prompt>', '.sora <prompt>'
        ]
    },
    github: {
        emoji: '💻',
        title: 'GitHub Commands',
        body: ['.git', '.github', '.sc', '.script', '.repo']
    }
};

function sectionText(key) {
    const section = SECTIONS[key];
    if (!section) return null;
    const lines = section.body.map((cmd) => `║ ➤ ${cmd}`).join('\n');
    return (
        `╔═══════════════════╗\n` +
        `   *${section.emoji} ${section.title}*\n` +
        `╚═══════════════════╝\n\n` +
        `${lines}\n\n` +
        `🌐 ${WEBSITE}`
    );
}

function fullMenuText() {
    return Object.keys(SECTIONS)
        .map((key) => {
            const section = SECTIONS[key];
            return (
                `╔═══════════════════╗\n` +
                `   *${section.emoji} ${section.title}*\n` +
                `╚═══════════════════╝\n` +
                section.body.map((cmd) => `║ ➤ ${cmd}`).join('\n')
            );
        })
        .join('\n\n');
}

/** Send the interactive main menu (single-select list). */
async function sendMainMenu(sock, chatId, message) {
    await sendListMenu(sock, chatId, {
        title: `🤖 ${settings.botName || 'Osunhive Chatbot'}`,
        text:
            `*🤖 ${settings.botName || 'Osunhive Chatbot'}*\n` +
            `Version *${settings.version || '2.0.0'}* by ${settings.botOwner || 'Osunhive'}\n\n` +
            `Tap *📋 Open Menu* below to browse commands by category.\n\n` +
            `🌐 ${WEBSITE}`,
        footer: `© ${settings.botName || 'Osunhive Chatbot'}`,
        buttonText: '📋 Open Menu',
        sections: [
            {
                title: '🤖 Bot',
                rows: [
                    { title: 'General', description: 'Basic bot commands', id: 'menu_general' },
                    { title: 'Admin', description: 'Group moderation commands', id: 'menu_admin' },
                    { title: 'Owner', description: 'Owner-only commands', id: 'menu_owner' },
                    { title: 'All Commands', description: 'Show the complete list', id: 'menu_all' }
                ]
            },
            {
                title: '🎨 Media & Fun',
                rows: [
                    { title: 'Media & Stickers', description: 'Sticker/image tools', id: 'menu_media' },
                    { title: 'Textmaker', description: 'Stylised text images', id: 'menu_textmaker' },
                    { title: 'Games', description: 'Tic-tac-toe, trivia, hangman', id: 'menu_games' },
                    { title: 'Fun', description: 'Compliments, ship, character', id: 'menu_fun' },
                    { title: 'Anime', description: 'Anime reaction commands', id: 'menu_anime' },
                    { title: 'Misc', description: 'Extra image commands', id: 'menu_misc' }
                ]
            },
            {
                title: '📥 AI & Downloads',
                rows: [
                    { title: 'AI', description: 'AI chat & image generation', id: 'menu_ai' },
                    { title: 'Downloader', description: 'YouTube, TikTok, Instagram', id: 'menu_downloader' },
                    { title: 'GitHub', description: 'Repository links', id: 'menu_github' }
                ]
            },
            {
                title: '🛍️ Osunhive',
                rows: [
                    { title: '📦 Products & Services', description: 'Templates, bots, tools', id: 'ar_product' },
                    { title: '🌐 Website & Links', description: 'All official channels', id: 'ar_website' },
                    { title: '📘 Guide', description: 'How to use the bot', id: 'ar_guide' }
                ]
            }
        ],
        quoted: message,
        contextInfo
    });
}

/** Send one section as a clickable list (Back / All / General rows). */
async function sendSection(sock, chatId, message, key) {
    const text = sectionText(key);
    if (!text) return sendMainMenu(sock, chatId, message);

    await sendListMenu(sock, chatId, {
        title: `${SECTIONS[key].emoji} ${SECTIONS[key].title}`,
        text,
        footer: `© ${settings.botName || 'Osunhive Chatbot'}`,
        buttonText: '🧭 Navigation',
        sections: [{
            title: 'Navigation',
            rows: [
                { title: '⬅️ Back to Menu', description: 'Return to the category list', id: 'menu' },
                { title: '📜 All Commands', description: 'Show every command', id: 'menu_all' },
                { title: '🌐 General', description: 'Basic bot commands', id: 'menu_general' }
            ]
        }],
        quoted: message,
        contextInfo
    });
}

/** Send the full list as text, then a clickable navigation list. */
async function sendAll(sock, chatId, message) {
    await sock.sendMessage(chatId, {
        text: fullMenuText(),
        contextInfo
    }, { quoted: message });

    await sendListMenu(sock, chatId, {
        title: '🧭 Navigation',
        text: '📋 *Menu options*',
        footer: `© ${settings.botName || 'Osunhive Chatbot'}`,
        buttonText: '🧭 Navigation',
        sections: [{
            title: 'Navigation',
            rows: [
                { title: '⬅️ Back to Menu', description: 'Return to the category list', id: 'menu' },
                { title: '👮 Admin', description: 'Group moderation commands', id: 'menu_admin' },
                { title: '🔒 Owner', description: 'Owner-only commands', id: 'menu_owner' }
            ]
        }],
        quoted: message,
        contextInfo
    });
}

/**
 * Main help/menu handler.
 * Supports:
 *   .menu            → interactive category list
 *   .menu general    → one section
 *   .menu all        → full command list
 */
async function helpCommand(sock, chatId, message, channelLink, commandText) {
    try {
        const raw = commandText ||
            message?.message?.conversation ||
            message?.message?.extendedTextMessage?.text ||
            '';
        const args = raw.trim().split(/\s+/);
        const section = (args[1] || '').toLowerCase();

        if (!section) return await sendMainMenu(sock, chatId, message);
        if (section === 'all' || section === 'list') return await sendAll(sock, chatId, message);
        if (SECTIONS[section]) return await sendSection(sock, chatId, message, section);

        await sendMainMenu(sock, chatId, message);
    } catch (error) {
        console.error('Error in help command:', error);
        try {
            await sock.sendMessage(chatId, { text: fullMenuText(), contextInfo });
        } catch (sendError) {
            console.error('Error sending menu fallback:', sendError);
        }
    }
}

module.exports = helpCommand;
module.exports.SECTIONS = SECTIONS;
