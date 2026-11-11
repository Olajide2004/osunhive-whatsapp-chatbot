/**
 * Celebration commands
 *
 *   .fireworks [text]                       — animated fireworks message
 *   .countdown                              — days to Christmas / New Year / Ramadan
 *   .countdown christmas|newyear|ramadan    — one occasion in detail
 *
 * Ramadan follows the lunar calendar and starts ~11 days earlier each year;
 * the table below is a best-effort Gregorian approximation (moon sighting can
 * move it by a day).
 */

const WEBSITE = 'https://www.osunhive.name.ng';

// Approximate 1 Ramadan (first fasting day) in the Gregorian calendar.
const RAMADAN_STARTS = [
    '2025-03-01', '2026-02-18', '2027-02-08', '2028-01-28',
    '2029-01-16', '2030-01-05', '2030-12-26', '2031-12-15', '2032-12-04'
];

const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Date helpers (UTC, so DST never shifts the day count)               */
/* ------------------------------------------------------------------ */

function utcToday(now = new Date()) {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function daysBetween(fromMs, toMs) {
    return Math.round((toMs - fromMs) / DAY_MS);
}

/** Next occurrence of a fixed month/day (this year or next). */
function nextFixed(month, day, now = new Date()) {
    const today = utcToday(now);
    let target = Date.UTC(now.getUTCFullYear(), month - 1, day);
    if (target < today) target = Date.UTC(now.getUTCFullYear() + 1, month - 1, day);
    return { days: daysBetween(today, target), date: new Date(target) };
}

function nextChristmas(now = new Date()) {
    return nextFixed(12, 25, now);
}

function nextNewYear(now = new Date()) {
    return nextFixed(1, 1, now);
}

function nextRamadan(now = new Date()) {
    const today = utcToday(now);
    for (const iso of RAMADAN_STARTS) {
        const ms = Date.parse(`${iso}T00:00:00Z`);
        if (Number.isFinite(ms) && ms >= today) {
            return { days: daysBetween(today, ms), date: new Date(ms) };
        }
    }
    return null;
}

function formatDate(date) {
    return date.toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'
    });
}

function humanDays(days) {
    if (days <= 0) return 'today 🎉';
    if (days === 1) return '1 day';
    const weeks = Math.floor(days / 7);
    return weeks >= 2 ? `${days} days (~${weeks} weeks)` : `${days} days`;
}

const EVENTS = [
    { key: 'christmas', aliases: ['christmas', 'xmas', 'x-mas'], icon: '🎄', label: 'Christmas', get: nextChristmas },
    { key: 'newyear', aliases: ['newyear', 'new-year', 'new year', 'year'], icon: '🎆', label: 'New Year', get: nextNewYear },
    { key: 'ramadan', aliases: ['ramadan', 'ramadhan', 'fasting', 'fast'], icon: '🌙', label: 'Ramadan (fasting)', get: nextRamadan }
];

function buildCountdown(now = new Date()) {
    const rows = EVENTS.map((ev) => {
        const next = ev.get(now);
        if (!next) return `${ev.icon} *${ev.label}* — date unavailable`;
        return `${ev.icon} *${ev.label}* — ${humanDays(next.days)} · ${formatDate(next.date)}`;
    });

    return (
        `🎉 *Osunhive Countdown*\n\n` +
        rows.join('\n') +
        `\n\n_Counted to the next occasion. Ramadan dates are approximate (moon sighting)._` +
        `\n🌐 ${WEBSITE}`
    );
}

function buildOne(eventKey, now = new Date()) {
    const wanted = String(eventKey || '').trim().toLowerCase();
    const ev = EVENTS.find((e) => e.key === wanted || e.aliases.includes(wanted));
    if (!ev) return null;

    const next = ev.get(now);
    if (!next) {
        return `${ev.icon} *${ev.label}* — I don't have a date that far ahead.`;
    }

    const when = next.days === 0 ? 'is *today*! 🎉' : `is in *${humanDays(next.days)}*`;
    return (
        `${ev.icon} *${ev.label}* ${when}\n\n` +
        `📅 ${formatDate(next.date)}\n` +
        `📆 ${next.days} day${next.days === 1 ? '' : 's'} to go\n\n` +
        `🌐 ${WEBSITE}`
    );
}

/* ------------------------------------------------------------------ */
/* Fireworks                                                          */
/* ------------------------------------------------------------------ */

const FIREWORK_FRAMES = [
    '　✨　　　🎆　　　✨\n🎇　　　💥　　　🎇\n　✨　　　🎆　　　✨',
    '🎆　✨　💥　✨　🎆\n　🎇　　　✨　　　🎇\n✨　🎆　🎇　🎆　✨',
    '✨　🎇　🎆　🎇　✨\n　💥　　　🎆　　　💥\n🎇　✨　🎆　✨　🎇',
    '🎇　🎆　✨　🎆　🎇\n✨　　　💥　　　✨\n🎆　🎇　✨　🎇　🎆',
    '💥　✨　🎇　✨　💥\n　🎆　　　🌟　　　🎆\n✨　🎇　🎆　🎇　✨'
];

const FIREWORK_FINAL = '🎆✨🎇 *HAPPY CELEBRATION!* 🎇✨🎆\n🌟　💥　🌟　💥　🌟';

function fireworkHeader(note) {
    return `🎆✨ *FIREWORKS!* ✨🎆\n\n${note}\n\n`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send a message and animate it through a few firework frames using edits.
 * If the client doesn't support edits, the first frame still gets delivered.
 */
async function fireworksCommand(sock, chatId, message, rawArgs) {
    const note = String(rawArgs || '').trim() || 'Wishing you a sparkling celebration from Osunhive! 💚';
    const header = fireworkHeader(note);

    let sent;
    try {
        sent = await sock.sendMessage(chatId, { text: header + FIREWORK_FRAMES[0] }, { quoted: message });
    } catch (error) {
        console.error('[fireworks] send failed:', error?.message || error);
        return;
    }

    for (let i = 1; i < FIREWORK_FRAMES.length; i++) {
        await sleep(650);
        try {
            await sock.sendMessage(chatId, { text: header + FIREWORK_FRAMES[i], edit: sent?.key });
        } catch {
            return; // edits unsupported — first frame already sent
        }
    }

    await sleep(650);
    try {
        await sock.sendMessage(chatId, { text: header + FIREWORK_FINAL, edit: sent?.key });
    } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* Commands                                                           */
/* ------------------------------------------------------------------ */

async function countdownCommand(sock, chatId, message, rawArgs) {
    const arg = String(rawArgs || '').trim().toLowerCase();
    const text = arg ? (buildOne(arg) || buildCountdown()) : buildCountdown();
    return sock.sendMessage(chatId, { text }, { quoted: message });
}

module.exports = {
    fireworksCommand,
    countdownCommand,
    // helpers (used by tests)
    nextChristmas,
    nextNewYear,
    nextRamadan,
    buildCountdown,
    buildOne,
    FIREWORK_FRAMES,
    RAMADAN_STARTS
};