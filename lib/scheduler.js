/**
 * Osunhive Chatbot — Task scheduler
 *
 * Persists tasks in `data/schedule.json` and runs them on a fixed tick.
 * Supported actions: `text`, `voice` (TTS voice-note), `status` (text status).
 * Targets: `here` is resolved to the current chat at add time; otherwise any
 * JID. `status` always posts to status@broadcast.
 *
 * Schedule kinds:
 *   every <N>m | every <N>h | hourly      (interval schedule)
 *   daily HH:MM                            (once daily at fixed time)
 *
 * Scheduling runs on the JS timer only (survives restarts because tasks are
 * persisted). Tick interval: 30s, low overhead.
 */
const fs = require('fs');
const path = require('path');
const { sendReplyVoiceNote } = require('./feedback');

const storePath = path.join(__dirname, '..', 'data', 'schedule.json');
const TICK_MS = 30000;
const MAX_TASKS = 30;
let timer = null;

/* ------------------------------------------------------------------ */
/* Persistence                                                        */
/* ------------------------------------------------------------------ */

function emptyStore() {
    return { tasks: [] };
}

function load() {
    try {
        const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8') || '');
        if (Array.isArray(parsed?.tasks)) return parsed;
    } catch (error) { /* first run */ }
    return emptyStore();
}

function save(store) {
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

function genId() {
    return Math.random().toString(16).slice(2, 8);
}

/* ------------------------------------------------------------------ */
/* Parsing                                                            */
/* ------------------------------------------------------------------ */

const TIME_REGEX = /^(\d{1,2}):(\d{2})$/;

/** Parse a schedule string: returns { mode, intervalMinutes?, timeOfDay? } or null. */
function parseSchedule(text) {
    const raw = String(text || '').trim().toLowerCase();

    if (raw === 'hourly' || raw === 'hourly!' || raw === 'hour') {
        return { mode: 'every', intervalMinutes: 60 };
    }

    const everyMatch = /^every\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?\s*$/.exec(raw);
    if (everyMatch) {
        const value = Number(everyMatch[1]);
        if (!Number.isFinite(value) || value <= 0) return null;
        const unit = everyMatch[2] || 'm';
        const intervalMinutes = /^(h|hr|hrs|hour|hours)$/.test(unit)
            ? value * 60
            : /^(d|day|days)$/.test(unit)
                ? value * 1440
                : value;
        return { mode: 'every', intervalMinutes };
    }

    const dailyMatch = /^(daily\s*(?:at\s+)?)?(\d{1,2}):(\d{2})$/.exec(raw);
    if (dailyMatch) {
        const hour = Math.max(0, Math.min(23, Number(dailyMatch[2])));
        const minute = Math.max(0, Math.min(59, Number(dailyMatch[3])));
        return { mode: 'daily', timeOfDay: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
    }

    return null;
}

/* ------------------------------------------------------------------ */
/* Public API (used by commands/schedule.js)                          */
/* ------------------------------------------------------------------ */

function listTasks() {
    const tasks = load().tasks;
    return tasks.slice().sort((a, b) => b.createdAt - a.createdAt);
}

function addTask({ action, target, text, schedule }) {
    const parsed = parseSchedule(schedule);
    if (!parsed) return null;

    const store = load();
    const task = {
        id: genId(),
        createdAt: Date.now(),
        lastRun: 0,
        runCount: 0,
        enabled: true,
        text: String(text || '').trim(),
        action: ['text', 'voice', 'status'].includes(action) ? action : 'text',
        schedule: parsed,
        target
    };
    store.tasks.push(task);
    store.tasks = store.tasks.slice(-MAX_TASKS);
    save(store);
    return task;
}

function removeTask(id) {
    const store = load();
    const before = store.tasks.length;
    store.tasks = store.tasks.filter((t) => t.id !== String(id));
    save(store);
    return before !== store.tasks.length;
}

function setEnabled(id, enabled) {
    const store = load();
    let changed = false;
    for (const task of store.tasks) {
        if (task.id === String(id)) { task.enabled = Boolean(enabled); changed = true; }
    }
    if (changed) save(store);
    return changed;
}

function renderTask(task) {
    const sched = task.schedule;
    const scheduleText = sched.mode === 'every'
        ? ((sched.intervalMinutes % 60 === 0) ? `every ${sched.intervalMinutes / 60}h` : `every ${sched.intervalMinutes}min`)
        : `daily at ${sched.timeOfDay}`;
    const preview = String(task.text || '').replace(/\n/g, ' ').slice(0, 60);
    return `• ${task.id} — [${task.action}] ${scheduleText} → ${preview} (${task.runCount || 0} run(s), ${task.enabled ? '✅ on' : '⛔ off'})`;
}

/* ------------------------------------------------------------------ */
/* Runtime                                                            */
/* ------------------------------------------------------------------ */

async function runTask(sock, task) {
    const target = task.action === 'status' ? 'status@broadcast' : task.target;
    if (!target) return false;

    if (task.action === 'text' || task.action === 'status') {
        await sock.sendMessage(target, task.action === 'status' ? { text: task.text } : { text: task.text });
        return true;
    }
    if (task.action === 'voice') {
        return await sendReplyVoiceNote(sock, target, task.text);
    }
    return false;
}

function dueForNow(task, nowHrs) {
    if (!task.enabled) return false;
    const now = Date.now();
    if (task.schedule.mode === 'every') {
        const last = task.lastRun || 0;
        if (now - last < (task.schedule.intervalMinutes * 60_000)) return false;
        return true;
    }
    const [hh, mm] = String(task.schedule.timeOfDay).split(':').map(Number);
    const last = task.lastRun || 0;
    const dayLast = new Date(last);
    const ranToday = dayLast.getFullYear() === nowHrs.getFullYear() && dayLast.getMonth() === nowHrs.getMonth() && dayLast.getDate() === nowHrs.getDate();
    if (ranToday) return false;
    const due = new Date(nowHrs);
    due.setHours(hh, mm, 0, 0);
    return now >= due.getTime();
}

async function runDueTasks(sock) {
    if (!sock) return;
    const store = load();
    const nowHrs = new Date();
    const due = store.tasks.filter((t) => dueForNow(t, nowHrs));
    if (due.length === 0) return;

    let changed = false;
    for (const task of due) {
        try {
            await runTask(sock, task);
            task.lastRun = Date.now();
            task.runCount = (task.runCount || 0) + 1;
            changed = true;
        } catch (error) {
            console.error(`[scheduler] task ${task.id} failed:`, error.message);
            task.lastRun = Date.now(); // avoid fast retry loops; run again next cycle
            changed = true;
        }
    }
    if (changed) save(store);
}

/** Start the 30s tick. Pass the live socket. Idempotent per socket instance. */
function start(sock) {
    if (timer) return; // single global scheduler
    if (!sock) return;
    timer = setInterval(() => {
        runDueTasks(sock).catch((error) => {
            console.error('[scheduler] tick failed:', error.message);
        });
    }, TICK_MS);
    if (timer.unref) timer.unref();
    console.log('🗓️  Scheduler started (tick 30s)');
}

/** Stop the scheduler; used on shutdown/tests. */
function stop() {
    if (timer) { clearInterval(timer); timer = null; }
}

module.exports = {
    listTasks,
    addTask,
    removeTask,
    setEnabled,
    parseSchedule,
    runDueTasks,
    renderTask,
    start,
    stop
};
