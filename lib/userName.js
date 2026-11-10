/**
 * User name lookup & greeting helpers.
 *
 * Persists a small jid→name map at data/userName.json so the bot can greet
 * people by name across restarts. Names come from `message.pushName` —
 * the reliable in-band source WhatsApp gives us — with phone number as the
 * last-resort fallback.
 */

const fs = require('fs');
const path = require('path');
const { jidDecode } = require('@whiskeysockets/baileys');

const NAMES_PATH = path.join(__dirname, '..', 'data', 'userName.json');

// Bare greetings we react to with a personal hello
const GREETING_PATTERNS = [
    'good morning',
    'good afternoon',
    'good evening',
    'hello',
    'hi',
    'hey',
    'yo',
    'whats up'
];

function loadUserNames() {
    try {
        return JSON.parse(fs.readFileSync(NAMES_PATH, 'utf8'));
    } catch {
        return {};
    }
}

function saveUserNames(names) {
    try {
        fs.writeFileSync(NAMES_PATH, JSON.stringify(names, null, 2));
        return true;
    } catch (error) {
        console.error('❌ [userName] failed to persist names:', error.message);
        return false;
    }
}

/** Best phone number extracted synchronously from a jid. */
function phoneOf(jid) {
    if (!jid) return null;
    try {
        const decoded = jidDecode(jid);
        return decoded?.user || null;
    } catch {
        return null;
    }
}

/**
 * Resolve a display name for the sender of `message`.
 * Priority: pushName (in-band) → cached name → phone number → null.
 * Also records the in-band name so subsequent messages can greet it.
 */
function resolveDisplayName(sock, chatId, message) {
    const jid = message?.key?.participant || message?.key?.remoteJid || chatId;
    const inBand = message?.pushName ? String(message.pushName).trim() : '';

    if (inBand) {
        if (jid) storeName(jid, inBand);
        return inBand;
    }

    if (jid) {
        const cached = loadUserNames()[jid];
        if (cached) return cached;
    }

    return phoneOf(jid);
}

/** Low-level getter used elsewhere (reads cache only). */
function getName(jid) {
    if (!jid) return null;
    return loadUserNames()[jid] || null;
}

/** Store jid → name (does not stomp a fresher value with the same string). */
function storeName(jid, name) {
    if (!jid || !name) return false;
    const clean = String(name).trim().slice(0, 60);
    if (!clean) return false;
    const names = loadUserNames();
    if (names[jid] === clean) return true;
    names[jid] = clean;
    return saveUserNames(names);
}

/** True when userMessage is *only* a greeting token. */
function isGreetingMessage(userMessage) {
    const clean = String(userMessage || '').trim().toLowerCase().replace(/[.!?]+/g, '');
    if (!clean || clean.length > 32) return false;
    return GREETING_PATTERNS.some((g) => clean === g || clean.startsWith(`${g} `));
}

/** Build a personal greeting reply (the “how are you doing <name>” case). */
function buildGreetingReply(name) {
    const label = name ? String(name).trim() : null;
    return label
        ? `👋 How are you doing, ${label}? What can I help you with today?`
        : '👋 How are you doing? What can I help you with today?';
}

module.exports = {
    NAMES_PATH,
    GREETING_PATTERNS,
    loadUserNames,
    saveUserNames,
    resolveDisplayName,
    getName,
    storeName,
    isGreetingMessage,
    buildGreetingReply
};
