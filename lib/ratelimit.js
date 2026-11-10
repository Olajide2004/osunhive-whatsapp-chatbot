/**
 * Osunhive Chatbot — Per-sender rate limiting
 *
 * Prevents one user from flooding the bot's auto-reply.
 * Tracks message timestamps per sender in memory and prunes the window.
 */

const DEFAULT_MAX_MESSAGES = 5;
const DEFAULT_WINDOW_MS = 60_000;      // 1 minute
const DEFAULT_REPLY_GAP_MS = 4_000;    // 4 seconds between replies per sender

const buckets = new Map();
const lastReply = new Map();
const MAX_ENTRIES = 1000;

function pruneBucket(jid, windowMs) {
    const now = Date.now();
    const list = buckets.get(jid) || [];
    const next = list.filter((ts) => now - ts < windowMs);
    buckets.set(jid, next);
    return next.length;
}

/** Record an incoming message and return the current count in the window. */
function recordMessage(jid, windowMs = DEFAULT_WINDOW_MS) {
    if (!jid) return 0;
    const next = pruneBucket(jid, windowMs);
    const list = buckets.get(jid) || [];
    list.push(Date.now());
    buckets.set(jid, list);
    if (buckets.size > MAX_ENTRIES) {
        const first = buckets.keys().next().value;
        if (first) buckets.delete(first);
    }
    return next + 1;
}

/** True if this sender has already exceeded the max for the window. */
function isRateLimited(jid, windowMs = DEFAULT_WINDOW_MS, maxMessages = DEFAULT_MAX_MESSAGES) {
    if (!jid) return false;
    const count = pruneBucket(jid, windowMs);
    return count >= maxMessages;
}

/** True if this sender can receive another reply within the gap window. */
function canReceiveReply(jid, gapMs = DEFAULT_REPLY_GAP_MS) {
    if (!jid) return true;
    const last = lastReply.get(jid) || 0;
    return Date.now() - last >= gapMs;
}

/** Record that the bot replied to this sender. */
function markReplySent(jid) {
    if (!jid) return;
    lastReply.set(jid, Date.now());
}

/** Remove stale entries; run occasionally. */
function sweep() {
    const now = Date.now();
    for (const [jid, list] of [...buckets.entries()]) {
        const fresh = list.filter((ts) => now - ts < DEFAULT_WINDOW_MS);
        if (fresh.length) buckets.set(jid, fresh);
        else buckets.delete(jid);
    }
    for (const [jid, ts] of [...lastReply.entries()]) {
        if (now - ts > DEFAULT_WINDOW_MS) lastReply.delete(jid);
    }
}

const sweepTimer = setInterval(sweep, 60_000);
if (sweepTimer.unref) sweepTimer.unref();

module.exports = {
    recordMessage,
    isRateLimited,
    canReceiveReply,
    markReplySent,
    sweep,
    DEFAULT_MAX_MESSAGES,
    DEFAULT_WINDOW_MS,
    DEFAULT_REPLY_GAP_MS
};
