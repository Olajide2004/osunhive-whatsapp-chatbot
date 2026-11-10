/**
 * Link preview command — owner-controlled automatic URL unfurling.
 *
 * Enabled globally (or per-chat) so that any incoming URL is turned into a
 * preview card next to the original message.
 *
 * Usage:
 *   .linkpreview on|off          enable / disable auto-unfurl
 *   .linkpreview status         show current state
 */

const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');
const { sendUnfurl } = require('../lib/linkPreview');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'linkpreview.json');

function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (error) {
        return { enabled: false };
    }
}

function saveConfig(config) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (error) {
        console.error('❌ [linkpreview] failed to save config:', error.message);
    }
}

async function toggle(sock, chatId, args, message, senderId) {
    if (!(await isOwnerOrSudo(senderId, sock, chatId))) {
        await sock.sendMessage(chatId, { text: '❌ Owner only command!' });
        return;
    }

    const cfg = loadConfig();
    const mode = (args[0] || '').toString().toLowerCase();

    if (mode === 'on' || mode === 'enable') {
        cfg.enabled = true;
        saveConfig(cfg);
        await sock.sendMessage(chatId, { text: '✅ Auto link unfurling is ON.' });
    } else if (mode === 'off' || mode === 'disable') {
        cfg.enabled = false;
        saveConfig(cfg);
        await sock.sendMessage(chatId, { text: '✅ Auto link unfurling is OFF.' });
    } else {
        await sock.sendMessage(chatId, {
            text: '📌 Auto link unfurling is ' +
                (cfg.enabled ? 'ON' : 'OFF') +
                '.\nUse `.linkpreview on|off` to change.',
            contextInfo: {}
        });
    }
}

module.exports = function linkPreviewCommand(sock, chatId, args, message, senderId) {
    return toggle(sock, chatId, args, message, senderId);
};
