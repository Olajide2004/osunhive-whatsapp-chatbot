/**
 * Schedule command — manage recurring automated actions.
 *
 * Usage:
 *   .schedule add here every 30m text Reminder: do X
 *   .schedule add here daily 08:30 text Good morning
 *   .schedule add here daily 08:30 voice Time for standup
 *   .schedule add status daily 09:00 text Fresh article online
 *   .schedule add <PHONE_NUMBER>@s.whatsapp.net every 1h text Check in
 *   .schedule list | .schedule remove <id> | .schedule enable <id> | .schedule disable <id>
 */
const isOwnerOrSudo = require('../lib/isOwner');
const scheduler = require('../lib/scheduler');

const SCHEDULE_PATTERN =
    '(?:every\\s+\\d+\\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)|hourly|daily\\s+(?:at\\s+)?\\d{1,2}:\\d{2})';
const ADD_NO_LEADING_ACTION = new RegExp(
    `^(\\S+)\\s+(${SCHEDULE_PATTERN})\\s+(text|voice|status)\\s+([\\s\\S]+)$`,
    'i'
);

async function resolveTarget(input, currentChat) {
    const token = String(input || '').trim();
    if (!token) return null;
    if (token === 'here') return currentChat;
    if (token === 'status') return 'status@broadcast';
    if (token.includes('@')) return token;
    const cleaned = token.replace(/[^0-9]/g, '');
    if (cleaned.length >= 8) return `${cleaned}@s.whatsapp.net`;
    return null;
}

function usage() {
    return (
        '❌ Usage:\n' +
        '• `.schedule add here every 30m text Reminder: do X`\n' +
        '• `.schedule add here daily 08:30 text Good morning`\n' +
        '• `.schedule add here daily 08:30 voice Time for standup`\n' +
        '• `.schedule add status daily 09:00 text Fresh article online`\n' +
        '• `.schedule add <jid> every 1h text Check in`\n' +
        '• Lists: `.schedule list`  Manage: `.schedule remove|enable|disable <id>`\n' +
        '• Intervals: `every <N>m|h|d` or `hourly`. Times: `daily HH:MM` (24h).'
    );
}

async function scheduleCommand(sock, chatId, args, message, senderId) {
    if (!(await isOwnerOrSudo(senderId, sock, chatId))) {
        await sock.sendMessage(chatId, { text: '❌ Owner only command!' });
        return;
    }

    const raw = String(Array.isArray(args) ? args.join(' ') : args || '').trim();
    const [sub, ...restTokens] = raw.split(/\s+/);
    const rest = restTokens.join(' ');
    const addKind = String(sub || '').toLowerCase();

    if (!addKind || addKind === 'help') {
        await sock.sendMessage(chatId, { text: usage() });
        return;
    }

    if (addKind === 'list') {
        const tasks = scheduler.listTasks();
        if (tasks.length === 0) {
            await sock.sendMessage(chatId, { text: '🗓️ No scheduled tasks. Add one with `.schedule add ...`' });
            return;
        }
        await sock.sendMessage(chatId, { text: `🗓️ *Scheduled tasks*\n${tasks.map(scheduler.renderTask).join('\n')}` });
        return;
    }

    if (addKind === 'add') {
        // Two shapes, both case-insensitive:
        //   status daily 09:00 text msg            (target is `status`)
        //   here every 30m text msg                 (target is `here`)
        //   <PHONE_NUMBER>@s.whatsapp.net every 1h text msg
        //   <PHONE_NUMBER> every 1h text msg
        const m = ADD_NO_LEADING_ACTION.exec(rest);
        if (!m) { await sock.sendMessage(chatId, { text: usage() }); return; }

        const [, targetTok, scheduleText, actionTok, ...textParts] = m;
        const action = actionTok.toLowerCase();
        const text = textParts.join(' ').trim();
        if (!text) { await sock.sendMessage(chatId, { text: '❌ Missing message text.' }); return; }

        const schedule = scheduler.parseSchedule(scheduleText);
        if (!schedule) { await sock.sendMessage(chatId, { text: '❌ Could not parse schedule. Use: `every 30m` or `daily 08:30`' }); return; }

        const target = await resolveTarget(targetTok, chatId);
        if (!target) { await sock.sendMessage(chatId, { text: '❌ Invalid target. Use `here`, `status` or a JID.' }); return; }

        const task = scheduler.addTask({ action, target, text, schedule: scheduleText });
        if (!task) { await sock.sendMessage(chatId, { text: '❌ Failed to create task.' }); return; }

        await sock.sendMessage(chatId, {
            text: `✅ Scheduled **${task.id}** — ${scheduler.renderTask(task).replace(/^•\s*/, '')}`
        });
        return;
    }

    if (addKind === 'remove' || addKind === 'delete') {
        const id = rest.trim();
        if (!id) { await sock.sendMessage(chatId, { text: '❌ Usage: `.schedule remove <id>`' }); return; }
        await sock.sendMessage(chatId, { text: scheduler.removeTask(id) ? '✅ Task removed.' : '❌ No such task.' });
        return;
    }

    if (addKind === 'enable' || addKind === 'disable') {
        const id = rest.trim();
        if (!id) { await sock.sendMessage(chatId, { text: `❌ Usage: \`.schedule ${addKind} <id>\`` }); return; }
        await sock.sendMessage(chatId, {
            text: scheduler.setEnabled(id, addKind === 'enable') ? `✅ Task ${addKind}.` : '❌ No such task.'
        });
        return;
    }

    if (addKind === 'clear' || addKind === 'clear-all') {
        const ids = scheduler.listTasks().map((t) => t.id);
        for (const id of ids) scheduler.removeTask(id);
        await sock.sendMessage(chatId, { text: `🧹 Removed ${ids.length} task(s).` });
        return;
    }

    await sock.sendMessage(chatId, { text: `❌ Unknown subcommand "${addKind}". Try \`.schedule help\`` });
}

module.exports = scheduleCommand;
