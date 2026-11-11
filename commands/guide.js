/**
 * Guide command — sends the end-user quick reference.
 *
 *   .guide            quick-reference card
 *   .guide full       full guide, sent as several messages
 */

const GUIDE_QUICK =
    `📘 *Osunhive Chatbot — Quick Guide*\n\n` +
    `*Open menu*\n` +
    `.menu • .menu all • .menu general\n\n` +
    `*Auto-reply*\n` +
    `.autoreply on|off\n` +
    `.autoreply group off|mention|all\n` +
    `.autoreply cooldown 10\n` +
    `.autoreply meta on|off\n` +
    `.autoreply buttons on|off\n` +
    `.autoreply voice on|off\n` +
    `.autoreply react on|off\n\n` +
    `*Status posting*\n` +
    `.autopoststatus on|off\n` +
    `.autopoststatus text <msg>\n` +
    `.autopoststatus interval 60\n` +
    `.autopoststatus recipients add <num>\n\n` +
    `*Scheduled tasks*\n` +
    `.schedule add here every 30m text Reminder\n` +
    `.schedule add status daily 09:00 text Online\n` +
    `.schedule list\n\n` +
    `*Utilities*\n` +
    `.ping • .voice <text> • .unfurl <url>\n` +
    `.fireworks [text] • .countdown [christmas|newyear|ramadan]\n` +
    `.products / .shop • .website / .links\n` +
    `.linkpreview on|off • .react 👍 • .poll\n\n` +
    `*Moderation*\n` +
    `.ban • .kick • .promote • .demote • .mute\n` +
    `.antilink • .tagall • .hidetag\n\n` +
    `Full guide: .guide full • Website: https://www.osunhive.name.ng`;

const GUIDE_FULL = [
    `📘 *Osunhive Chatbot — Usage*\n\n` +
    `Commands start with a dot. Plain text is handled by the AI assistant ` +
    `only when auto-reply is enabled (.autoreply on).`,

    `*Menus*\n` +
    `.menu opens the interactive list.\n` +
    `.menu all shows every command.\n` +
    `.menu general|admin|owner|... opens one section.`,

    `*Auto-reply*\n` +
    `.autoreply on|off\n` +
    `.autoreply group off|mention|all — group policy\n` +
    `.autoreply cooldown <seconds> — per-group gap\n` +
    `.autoreply meta on|off — Meta-AI style\n` +
    `.autoreply stream|suggest|sources on|off\n` +
    `.autoreply copybox off|code|all\n` +
    `.autoreply buttons on|off — Website/Menu/Products buttons\n` +
    `.autoreply code on|off\n` +
    `.autoreply engine auto|chatgpt|bjgpt|offline\n` +
    `.autoreply voice on|off — speak first sentence\n` +
    `.autoreply react on|off — ❤️ the user's message`,

    `*Safety*\n` +
    `Per-sender rate limit (5/min, ~4s gap).\n` +
    `Owner messages are never auto-replied.\n` +
    `Groups default to groupReply: off.`,

    `*Status posting*\n` +
    `.autopoststatus on|off|now|preview|delete\n` +
    `.autopoststatus interval <minutes> (5-1440)\n` +
    `.autopoststatus text <msg> | add <msg> | list\n` +
    `.autopoststatus remove <n> | clear\n` +
    `.autopoststatus bg #1F2C34 | font 0-5\n` +
    `.autopoststatus recipients add|remove|clear|list\n` +
    `.autopoststatus limit <n> (0 = everyone)\n` +
    `.autostatuspost <direct-link.mp4 | cdn:<fileId>>\n` +
    `.cdn [list/page/info/link/send/post] [n]`,

    `*CDN browser*\n` +
    `.cdn — list the current folder\n` +
    `.cdn <n> — open a folder / post a media file\n` +
    `.cdn <folder/path> — open by name\n` +
    `.cdn .. | back — up one folder\n` +
    `.cdn / | root — back to the CDN root\n` +
    `.cdn link|send|info <n> — link, file, details\n` +
    `.cdn buttons on|off — interactive buttons`,

    `*Scheduled tasks*\n` +
    `.schedule add here every 30m text Reminder\n` +
    `.schedule add here daily 08:30 voice Standup\n` +
    `.schedule add status daily 09:00 text Online\n` +
    `.schedule list | remove <id>\n` +
    `.schedule enable|disable <id> | clear-all`,

    `*Commands*\n` +
    `.help .menu .ping .alive .tts .voice\n` +
    `.poll .unfurl .linkpreview .vcard .react\n` +
    `.ban .kick .promote .demote .mute .warn\n` +
    `.antilink .antitag .antibot .welcome .goodbye\n` +
    `.sticker .ai .gpt .imagine .play .tiktok\n\n` +
    `See .menu all for the complete list.`
];

module.exports = async function guideCommand(sock, chatId, args, message) {
    const mode = (Array.isArray(args) && args.length ? args[0] : args || '')
        .toString()
        .toLowerCase();

    if (mode === 'full') {
        for (const part of GUIDE_FULL) {
            await sock.sendMessage(chatId, { text: part });
        }
        return;
    }

    await sock.sendMessage(chatId, { text: GUIDE_QUICK });
};
