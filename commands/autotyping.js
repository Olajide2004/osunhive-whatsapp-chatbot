/**
 * Osunhive Bot - A WhatsApp Bot
 * Autotyping & AI Assistant Module (BJ-GPT-OSS-20B & Local Fallback)
 */

const fs = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');
const { sendCtaButtons, sendQuickReply } = require('../lib/button');
const { generateRawReply, VALID_ENGINES } = require('../lib/autoreply');
const {
    buildMetaPrompt,
    formatMetaReply,
    streamReply
} = require('../lib/metaStyle');
const {
    recordMessage,
    isRateLimited,
    canReceiveReply,
    markReplySent
} = require('../lib/ratelimit');

const {
    simulateHumanPresence,
    pulseTyping
} = require('../lib/presence');
const settings = require('../settings');
const { react, sendReplyVoiceNote } = require('../lib/feedback');
const { resolveDisplayName, isGreetingMessage, buildGreetingReply, storeName, getName } = require('../lib/userName');

// Paths to store configuration files

const configPath = path.join(__dirname, '..', 'data', 'autotyping.json');
const osunhiveLLMPath = path.join(__dirname, '..', 'data', 'OsunhiveLLM.json');

// Initialize configuration file if it doesn't exist
function initConfig() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({ enabled: false, autoreply: false }, null, 2));
    }
    return JSON.parse(fs.readFileSync(configPath));
}

// ✅ EXTENDED CONFIG
function initExtendedConfig() {
    const config = initConfig();
    let updated = false;

    if (typeof config.autoreply !== 'boolean') {
        config.autoreply = false;
        updated = true;
    }

    // Human-like presence: online, typing, recording, fake file upload
    if (typeof config.presence !== 'boolean') {
        config.presence = true;
        updated = true;
    }

    // Send replies with interactive buttons
    if (typeof config.buttons !== 'boolean') {
        config.buttons = true;
        updated = true;
    }

    // Group auto-reply mode: 'off' | 'mention' | 'all'
    // Default is 'off' so the bot never spams busy groups.
    if (!['off', 'mention', 'all'].includes(config.groupReply)) {
        config.groupReply = 'off';
        updated = true;
    }

    // Minimum gap (ms) between two auto-replies in the same group
    if (typeof config.groupCooldownMs !== 'number' || config.groupCooldownMs < 0) {
        config.groupCooldownMs = 12000;
        updated = true;
    }

    // Voice replies (TTS): off by default, owner can toggle with `.autoreply voice on`
    if (typeof config.voiceReplies !== 'boolean') {
        config.voiceReplies = false;
        updated = true;
    }

    // Auto-heart: ❤️ to the user's message after the bot finishes replying
    if (typeof config.autoReactHeart !== 'boolean') {
        config.autoReactHeart = false;
        updated = true;
    }

    // Render AI code samples as WhatsApp monospace blocks
    if (typeof config.codeHighlight !== 'boolean') {
        config.codeHighlight = true;
        updated = true;
    }

    // Copy-box style for auto-replies (WhatsApp code block with a copy button):
    // 'code' = fenced code only, 'all' = every reply (code or TXT), 'off' = never
    if (!['off', 'code', 'all'].includes(config.copyBox)) {
        config.copyBox = 'code';
        updated = true;
    }

    // Reply persona: 'classic' = plain formatted answer,
    // 'meta' = Meta-AI-style headline, follow-ups, footer and streaming.
    if (!['classic', 'meta'].includes(config.replyStyle)) {
        config.replyStyle = 'meta';
        updated = true;
    }
    for (const key of ['metaSuggest', 'metaSources', 'metaStream']) {
        if (typeof config[key] !== 'boolean') {
            config[key] = true;
            updated = true;
        }
    }

    // AI engine: auto (chatgpt -> bjgpt -> offline) | chatgpt | bjgpt | offline
    if (!VALID_ENGINES.includes(config.aiEngine)) {
        config.aiEngine = 'auto';
        updated = true;
    }

    // Clean up outdated Gemini properties if they exist
    if (config.geminiApiKey !== undefined || config.geminiApiKeys !== undefined) {
        delete config.geminiApiKey;
        delete config.geminiApiKeys;
        updated = true;
    }

    if (updated) {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }

    return config;
}

// ✅ OFFLINE LLM DATA INITIALIZATION
function initOsunhiveLLM() {
    if (!fs.existsSync(osunhiveLLMPath)) {
        const dataDir = path.dirname(osunhiveLLMPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        // Default templates and answers
        const defaultLLMData = {
            "fallback_template": "👋 Greetings from Osunhive Support!\n\nWe received your query: \"{{query}}\". Our online AI services are temporarily resting, but please visit our portal for quick answers or standard menus:\n🌐 https://www.osunhive.name.ng",
            "rules": [
                {
                    "keywords": ["hello", "hi", "hey", "greetings"],
                    "response": "👋 Hello! Welcome to Osunhive, Nigeria's premier digital tech hub. How can I assist you today?"
                },
                {
                    "keywords": ["help", "menu"],
                    "response": "📌 *Osunhive Help Menu*\n\nYou can interact with me offline using these keywords:\n• *product* - View our templates & tools\n• *website* - Official URL\n• *application* - Learn about our mobile apps\n• *offline* - View quick FAQs"
                },
                {
                    "keywords": ["price", "buy", "cost", "template"],
                    "response": "Osunhive UI is our premium modern responsive Blogger template. Visit our portal for details: https://www.osunhive.name.ng"
                }
            ]
        };
        fs.writeFileSync(osunhiveLLMPath, JSON.stringify(defaultLLMData, null, 2));
    }
    try {
        return JSON.parse(fs.readFileSync(osunhiveLLMPath, 'utf8'));
    } catch (error) {
        console.error("Error reading OsunhiveLLM.json:", error);
        return null;
    }
}

// Get response from local OsunhiveLLM.json
function getOfflineLLMResponse(userMessage) {
    const llmData = initOsunhiveLLM();
    if (!llmData) {
        return `⚠️ System offline. Please visit our website: https://www.osunhive.name.ng`;
    }

    const queryClean = userMessage.toLowerCase().trim();

    // 1. Scan the JSON database for matching rule keywords
    if (Array.isArray(llmData.rules)) {
        for (const rule of llmData.rules) {
            if (Array.isArray(rule.keywords)) {
                const matched = rule.keywords.some(keyword => queryClean.includes(keyword.toLowerCase()));
                if (matched) {
                    return markdownToWhatsApp(rule.response);
                }
            }
        }
    }

    // 2. Return the custom template inside OsunhiveLLM.json if no rule matches
    const template = llmData.fallback_template || "👋 Greetings from Osunhive!\n\nWe processed your query: \"{{query}}\" in offline mode. Please visit our official site:\n🌐 https://www.osunhive.name.ng";
    const processedTemplate = template.replace(/\{\{query\}\}/g, userMessage);
    
    return markdownToWhatsApp(processedTemplate);
}

// Toggle autotyping feature
async function autotypingCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        
        if (!message.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, {
                text: '❌ This command is only available for the owner!',
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363419178084647@newsletter',
                        newsletterName: 'Osunhive Bot',
                        serverMessageId: -1
                    }
                }
            });
            return;
        }

        const args = message.message?.conversation?.trim().split(' ').slice(1) || 
                     message.message?.extendedTextMessage?.text?.trim().split(' ').slice(1) || 
                     [];
        
        const config = initConfig();
        
        if (args.length > 0) {
            const action = args[0].toLowerCase();
            if (action === 'on' || action === 'enable') {
                config.enabled = true;
            } else if (action === 'off' || action === 'disable') {
                config.enabled = false;
            } else {
                await sock.sendMessage(chatId, {
                    text: '❌ Invalid option! Use: .autotyping on/off'
                });
                return;
            }
        } else {
            config.enabled = !config.enabled;
        }
        
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        const presenceOn = config.presence !== false;
        const nextAction = config.enabled ? 'off' : 'on';

        await sendQuickReply(sock, chatId, {
            text:
                `✅ *Auto-typing* has been ${config.enabled ? 'enabled' : 'disabled'}!\n\n` +
                `🎭 *Human presence simulation:* ${presenceOn ? 'ON' : 'OFF'}\n` +
                `• 🟢 Online status\n` +
                `• ⌨️ Typing indicator\n` +
                `• 🎙️ Recording indicator\n` +
                `• 📤 Fake file upload indicator`,
            footer: `© ${settings.botName || 'Osunhive Chatbot'}`,
            buttons: [
                { id: `autotyping_${nextAction}`, text: config.enabled ? '⏹️ Turn Off' : '▶️ Turn On' },
                { id: 'autoreply_on', text: '🤖 Enable Auto-reply' },
                { id: 'menu', text: '📋 Menu' }
            ],
            quoted: message
        });

    } catch (error) {
        console.error('Error in autotyping command:', error);
    }
}

// Function to check if autotyping is enabled
function isAutotypingEnabled() {
    try {
        return initConfig().enabled;
    } catch (error) {
        console.error('Error checking autotyping status:', error);
        return false;
    }
}

// Function to handle autotyping for regular messages
// Shows the full human cycle: online → typing → recording → fake upload → paused
async function handleAutotypingForMessage(sock, chatId, userMessage) {
    if (!isAutotypingEnabled()) return false;

    try {
        const typingDelay = Math.max(1200, Math.min(5000, String(userMessage || '').length * 80));
        await simulateHumanPresence(sock, chatId, {
            showOnline: true,
            showTyping: true,
            showRecording: true,
            showUpload: true,
            onlineDelay: 250,
            typingDelay,
            recordingDelay: 900,
            uploadDelay: 700,
            finalTypingDelay: 500
        });
        return true;
    } catch (error) {
        console.error('❌ Error sending typing indicator:', error);
        return false;
    }
}

// Function to handle autotyping for commands (shorter cycle)
async function handleAutotypingForCommand(sock, chatId) {
    if (!isAutotypingEnabled()) return false;

    try {
        await simulateHumanPresence(sock, chatId, {
            showOnline: true,
            showTyping: true,
            showRecording: true,
            showUpload: true,
            onlineDelay: 200,
            typingDelay: 1200,
            recordingDelay: 600,
            uploadDelay: 500,
            finalTypingDelay: 400
        });
        return true;
    } catch (error) {
        console.error('❌ Error sending command typing indicator:', error);
        return false;
    }
}

// Function to show typing status AFTER command execution
async function showTypingAfterCommand(sock, chatId) {
    if (!isAutotypingEnabled()) return false;

    try {
        await pulseTyping(sock, chatId, 1000);
        return true;
    } catch (error) {
        console.error('❌ Error sending post-command typing indicator:', error);
        return false;
    }
}

/* =====================================================
   ✅ MARKDOWN TO WHATSAPP FORMATTER
===================================================== */

/**
 * Extract ```lang ... ``` blocks that open and close on their own lines.
 * Backticks inside the code (e.g. a markdown template string) are preserved.
 */
function extractFencedBlocks(text) {
    const lines = String(text).split('\n');
    const blocks = [];
    const out = [];
    let i = 0;

    while (i < lines.length) {
        const open = /^\s*```([A-Za-z0-9_+.#-]*)\s*$/.exec(lines[i]);
        if (!open) {
            out.push(lines[i]);
            i++;
            continue;
        }

        const lang = (open[1] || '').toLowerCase();
        const code = [];
        i++;
        let closed = false;
        while (i < lines.length) {
            if (/^\s*```\s*$/.test(lines[i])) {
                closed = true;
                i++;
                break;
            }
            code.push(lines[i]);
            i++;
        }

        if (!closed) {
            // Unterminated fence — keep it verbatim rather than eating the tail.
            out.push('```' + lang);
            out.push(...code);
            continue;
        }

        blocks.push({
            lang,
            code: code.join('\n').replace(/\r/g, '').replace(/^\n+|\n+$/g, '')
        });
        out.push(`\u0000CODEBLOCK${blocks.length - 1}\u0000`);
    }

    return { text: out.join('\n'), blocks };
}

/**
 * Convert markdown formatting to WhatsApp formatting
 * @param {string} text - Text with markdown formatting
 * @returns {string} - Text with WhatsApp formatting
 */
function markdownToWhatsApp(text) {
    if (!text || typeof text !== 'string') return text;

    let formatted = text;

    // 1. Pull fenced code blocks out first so the markdown rules below
    //    cannot corrupt them (e.g. "#include" being read as a heading).
    //    Line-based extraction keeps backticks *inside* the code safe.
    const codeBlocks = [];
    const extracted = extractFencedBlocks(formatted);
    formatted = extracted.text;
    codeBlocks.push(...extracted.blocks);

    // 1b. Any remaining inline ```code``` fences on a single line.
    formatted = formatted.replace(
        /```([A-Za-z0-9_+.#-]*)[ \t]*\r?\n?([\s\S]*?)```/g,
        (match, lang, code) => {
            const token = `\u0000CODEBLOCK${codeBlocks.length}\u0000`;
            codeBlocks.push({
                lang: String(lang || '').trim().toLowerCase(),
                code: String(code).replace(/\r/g, '').replace(/^\n+|\n+$/g, '')
            });
            return token;
        }
    );

    // 2. Pull inline code out too — WhatsApp renders `text` as monospace.
    const inlineCode = [];
    formatted = formatted.replace(/`([^`\n]+)`/g, (match, code) => {
        const token = `\u0000INLINECODE${inlineCode.length}\u0000`;
        inlineCode.push(code);
        return token;
    });

    // 3. Protect bold first, otherwise the italic rule would eat it
    const boldParts = [];
    const stashBold = (match, inner) => {
        const token = `\u0000BOLD${boldParts.length}\u0000`;
        boldParts.push(inner);
        return token;
    };

    // 4. Convert headers (# Header) to bold with emoji. They are stashed as
    //    bold immediately so the italic rule below cannot turn them italic.
    formatted = formatted.replace(/^### (.*?)$/gm, (m, t) => `📌 ${stashBold(m, t)}`);
    formatted = formatted.replace(/^## (.*?)$/gm, (m, t) => `📍 ${stashBold(m, t)}`);
    formatted = formatted.replace(/^# (.*?)$/gm, (m, t) => `🔷 ${stashBold(m, t)}`);

    // 5. Convert markdown bold to the same protected form
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, stashBold);
    formatted = formatted.replace(/__(.+?)__/g, stashBold);

    // 6. Convert italic: *text* or _text_ to _text_
    formatted = formatted.replace(/(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, '_$1_');
    formatted = formatted.replace(/(?<!_)_(?!_)([^_\n]+?)(?<!_)_(?!_)/g, '_$1_');

    // 7. Convert strikethrough: ~~text~~ to ~text~
    formatted = formatted.replace(/~~(.+?)~~/g, '~$1~');

    // 8. Convert bullet lists: - item or * item to • item
    formatted = formatted.replace(/^[\-\*] (.+)$/gm, '• $1');

    // 9. Convert numbered lists: 1. item to 1️⃣ item
    formatted = formatted.replace(/^(\d+)\. (.+)$/gm, (match, num, item) => {
        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        const emoji = emojis[parseInt(num) - 1] || `${num}.`;
        return `${emoji} ${item}`;
    });

    // 9. Convert links: [text](url) to text (url)
    formatted = formatted.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '$1 ($2)');

    // 10. Convert blockquotes: > text to ❝ text
    formatted = formatted.replace(/^> (.+)$/gm, '❝ $1');

    // 11. Clean up excessive newlines (more than 2)
    formatted = formatted.replace(/\n{3,}/g, '\n\n');

    // 12. Remove horizontal rules
    formatted = formatted.replace(/^[\-\*_]{3,}$/gm, '');

    // 13. Restore bold outside code
    formatted = formatted.replace(/\u0000BOLD(\d+)\u0000/g, (m, i) => `*${boldParts[Number(i)]}*`);

    // 14. Restore inline code as single-backtick monospace
    formatted = formatted.replace(/\u0000INLINECODE(\d+)\u0000/g, (m, i) => `\`${inlineCode[Number(i)]}\``);

    // 15. Restore fenced code as highlighted monospace blocks, with a
    //     language label when the model provides one. WhatsApp renders these
    //     as a code block with a copy button (the "Meta AI" style).
    formatted = formatted.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (m, i) => {
        const block = codeBlocks[Number(i)];
        // Never let a stray fence inside the code break the outer block.
        const safeCode = block.code.replace(/`{3,}/g, "'''");
        const langLabel = block.lang ? `🖥️ *${block.lang}*\n` : '';
        return `${langLabel}\`\`\`\n${safeCode}\n\`\`\``;
    });

    return formatted.trim();
}

/**
 * Wrap a reply in a WhatsApp code block so it gets a copy button.
 */
function wrapInCopyBox(text) {
    const safe = String(text)
        .replace(/`{3,}/g, "'''")   // a nested fence would break the block
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (!safe) return safe;
    return '```\n' + safe + '\n```';
}

/**
 * Apply the configured copy-box style:
 *   'code' -> fenced code only (already handled above)
 *   'all'  -> every reply, code or plain TXT, delivered in a copy box
 *   'off'  -> never
 */
function applyCopyBox(text, config) {
    const mode = config.copyBox || 'code';
    if (mode === 'off' || !text) return text;
    // Already contains a code block: that block itself is the copy box.
    if (/```/.test(text)) return text;
    if (mode === 'all') return wrapInCopyBox(text);
    return text;
}

/**
 * Format an auto-reply body, keeping code blocks monospace/highlighted
 * and optionally wrapping the reply in a copy box.
 * Set config.codeHighlight = false to send plain text untouched.
 */
function formatAutoReply(text) {
    if (!text || typeof text !== 'string') return text;
    const config = initExtendedConfig();
    if (config.codeHighlight === false) return text.trim();
    return applyCopyBox(markdownToWhatsApp(text), config);
}

/* =====================================================
   ✅ OFFLINE CHATBOT DATA & HELPERS
===================================================== */

const offlineQA = {
    "what is osunhive": "Osunhive is a digital learning hub founded in Nigeria by Dev Olajide Sherif Oyinlola. It provides free, beginner-friendly resources to help creators master Telegram bot development, mobile app creation, and website development.",
    "who is the ceo": "The CEO and founder of Osunhive is Dev Olajide Sherif Oyinlola, an expert software developer and tech educator.",
    "how to build a bot": "We offer step-by-step guides on bot building! You can visit our tutorials on https://www.osunhive.name.ng or join our community.",
    "premium templates": "Osunhive UI is our flagship premium modern responsive blogger template, designed with optimized layouts and fast-loading configurations.",
    "contact": "You can reach out to us directly through the contact portal on our website: https://www.osunhive.name.ng"
};

/**
 * Checks for matched keywords in the offline QA bank
 * @param {string} messageText 
 * @returns {string|null}
 */
function getOfflineAnswer(messageText) {
    const text = messageText.toLowerCase().trim();
    for (const [question, answer] of Object.entries(offlineQA)) {
        if (text.includes(question)) {
            return `🤖 *Offline Chatbot Response* 🤖\n\n${answer}\n\n_— Osunhive Assistant_\n🌐 https://www.osunhive.name.ng`;
        }
    }
    return null;
}

/* =====================================================
   ✅ NAVIGATION MENUS
===================================================== */

function getMenuResponse() {
    return `📌 *OSUNHIVE BOT MENU* 📌
Welcome to Osunhive, Nigeria's premier digital hub for developers, creators, and tech enthusiasts.

Explore our features using these keywords:

1️⃣ *PRODUCT* (Type: \`.product\` or \`product\`)
   Explore our templates (like Osunhive UI), tools, and blogger options.

2️⃣ *WEBSITE* (Type: \`.website\` or \`website\`)
   Visit our official hub for guides, assets, and news:
   🌐 https://www.osunhive.name.ng

3️⃣ *APPLICATION* (Type: \`.application\` or \`application\`)
   Discover our latest apps, Sketchware setups, and utility software.

4️⃣ *OFFLINE AI QUESTIONS* (Type: \`.offline\` or \`offline\`)
   View instant queries that I can answer offline without internet connection.

_Please type a keyword above to proceed._`;
}

function getProductResponse() {
    return `📦 *OSUNHIVE PRODUCTS* 📦

• *Osunhive UI Premium Template*: A premium blogger template styled for maximum performance, responsiveness, and speed.
• *Blogger AI Generator*: Generate SEO-optimized blog posts instantly.
• *Free AI Utilities*: Free article rewriters, voice synthesizers, and graphic editors.

🌐 Discover more products and stores at:
https://www.osunhive.name.ng`;
}

function getApplicationResponse() {
    return `📱 *OSUNHIVE APPLICATIONS* 📱

We design and host useful applications and helper tools:
• *TubeLinker*: Powerful link processor designed by Osunhive.
• *Gmail SMTP Mailer*: Fast utility to manage and process SMTP notifications.
• *Chess Mini (Osunhive Edition)*: Lightweight chess game setup.
• *Local Library Maker v5*: Essential tooling built for Sketchware development environment.

Find guides and download links on our portal:
🌐 https://www.osunhive.name.ng`;
}

function getOfflineAiQuestionsResponse() {
    let response = `💡 *OFFLINE CHATBOT QUESTIONS (FAQs)* 💡\n`;
    response += `You can ask me any of the following questions directly to receive an automated local response:\n\n`;
    for (const question of Object.keys(offlineQA)) {
        response += `• _"${question}"_\n`;
    }
    response += `\nFeel free to type any of these exact questions.`;
    return response;
}

/* =====================================================
   ✅ API AUTO-REPLY VIA MULTI-ENGINE (ChatGPT Android → BJ-GPT → offline)
===================================================== */

/**
 * Generate a reply using the configured engine chain, with offline fallback
 * @param {string} userMessage - User's message
 * @param {string} [userName] - Sender display name injected into the Meta prompt
 * @returns {string} - Formatted response
 */
async function generateApiReply(userMessage, userName) {
    const config = initExtendedConfig();
    const meta = config.replyStyle === 'meta';
    const normalizedName = (userName || '').trim();
    const greetPrompt = normalizedName
        ? `The user's name is "${normalizedName}". Address them by name naturally, at most once, in the very first line of your answer.`
        : '';
    const prompt = meta
        ? `${greetPrompt ? greetPrompt + '\n\n' : ''}${buildMetaPrompt(userMessage)}`
        : `${greetPrompt ? greetPrompt + '\n\n' : ''}${userMessage}`;

    const { text: apiOutput, engine } = await generateRawReply(prompt, config.aiEngine || 'auto');

    if (apiOutput) {
        let reply = formatAutoReply(apiOutput);

        if (meta) {
            // Meta AI layout: headline + follow-up questions + footer
            reply = formatMetaReply(reply, {
                userMessage,
                suggest: config.metaSuggest !== false,
                sources: config.metaSources !== false
            });
        } else if (reply.length > 50) {
            // Classic signature + link
            if (!reply.includes('CEO') && !reply.includes('— Osunhive')) {
                reply += '\n\n_— CEO, Osunhive_';
            }
            if (!reply.includes('osunhive.name.ng')) {
                reply += '\n🌐 https://www.osunhive.name.ng';
            }
        }

        if (engine) console.log(`🤖 Auto-reply via ${engine}${meta ? ' (meta style)' : ''}`);
        return reply;
    }

    // Fallback to local chatbot if every API fails
    const offline = getOfflineLLMResponse(userMessage);
    return meta
        ? formatMetaReply(offline, {
            userMessage,
            suggest: config.metaSuggest !== false,
            sources: config.metaSources !== false
        })
        : offline;
}

// Auto-reply command
async function autoreplyCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);

        if (!message.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, { text: '❌ Owner only command!' });
            return;
        }

        const args =
            message.message?.conversation?.trim().split(' ').slice(1) ||
            message.message?.extendedTextMessage?.text?.trim().split(' ').slice(1) ||
            [];

        const config = initExtendedConfig();

        if (args.length === 0) {
            config.autoreply = !config.autoreply;
        } else {
            const action = args[0].toLowerCase();

            if (action === 'on' || action === 'enable') {
                config.autoreply = true;
            } else if (action === 'off' || action === 'disable') {
                config.autoreply = false;
            } else if (action === 'group') {
                // Group reply policy: off | mention | all
                const order = ['off', 'mention', 'all'];
                const mode = (args[1] || 'toggle').toLowerCase();

                if (mode === 'toggle' || mode === 'next') {
                    const idx = order.indexOf(config.groupReply || 'off');
                    config.groupReply = order[(idx + 1) % order.length];
                } else if (mode === 'on' || mode === 'enable' || mode === 'mention') {
                    config.groupReply = 'mention';
                } else if (mode === 'no' || mode === 'disable') {
                    config.groupReply = 'off';
                } else if (order.includes(mode)) {
                    config.groupReply = mode;
                } else {
                    await sock.sendMessage(chatId, {
                        text: '❌ Invalid group mode.\nUse: `.autoreply group off|mention|all`'
                    });
                    return;
                }
            } else if (action === 'cooldown') {
                // Seconds between two auto-replies in the same group
                const seconds = Number(args[1]);
                if (!Number.isFinite(seconds) || seconds < 0 || seconds > 300) {
                    await sock.sendMessage(chatId, {
                        text: '❌ Invalid cooldown.\nUse: `.autoreply cooldown <0-300>` (seconds)'
                    });
                    return;
                }
                config.groupCooldownMs = Math.round(seconds * 1000);
            } else if (action === 'engine') {
                const mode = (args[1] || '').toLowerCase();
                if (!VALID_ENGINES.includes(mode)) {
                    await sock.sendMessage(chatId, {
                        text:
                            '❌ Invalid engine.\nUse: `.autoreply engine auto|chatgpt|bjgpt|offline`\n' +
                            '• auto = ChatGPT → BJ-GPT → offline\n' +
                            '• chatgpt = ChatGPT Android only\n' +
                            '• bjgpt = BJ-GPT-OSS-20b only\n' +
                            '• offline = local JSON only'
                    });
                    return;
                }
                config.aiEngine = mode;
            } else if (action === 'code') {
                const mode = (args[1] || 'toggle').toLowerCase();
                if (mode === 'toggle') config.codeHighlight = config.codeHighlight === false;
                else if (['on', 'enable', 'yes'].includes(mode)) config.codeHighlight = true;
                else if (['off', 'disable', 'no'].includes(mode)) config.codeHighlight = false;
                else {
                    await sock.sendMessage(chatId, {
                        text: '❌ Invalid option.\nUse: `.autoreply code on|off`'
                    });
                    return;
                }
            } else if (action === 'copybox' || action === 'copy') {
                const mode = (args[1] || '').toLowerCase();
                if (mode === 'toggle') {
                    const order = ['off', 'code', 'all'];
                    const idx = order.indexOf(config.copyBox || 'code');
                    config.copyBox = order[(idx + 1) % order.length];
                } else if (['off', 'none', 'no'].includes(mode)) {
                    config.copyBox = 'off';
                } else if (['code', 'on', 'enable'].includes(mode)) {
                    config.copyBox = 'code';
                } else if (['all', 'text', 'txt', 'yes'].includes(mode)) {
                    config.copyBox = 'all';
                } else {
                    await sock.sendMessage(chatId, {
                        text:
                            '❌ Invalid option.\nUse: `.autoreply copybox off|code|all`\n' +
                            '• off = no copy box\n' +
                            '• code = only code blocks get a copy box\n' +
                            '• all = every reply (code or TXT) gets a copy box'
                    });
                    return;
                }
            } else if (action === 'meta' || action === 'style') {
                const mode = (args[1] || 'toggle').toLowerCase();
                if (mode === 'toggle') config.replyStyle = config.replyStyle === 'meta' ? 'classic' : 'meta';
                else if (['on', 'meta', 'enable', 'yes'].includes(mode)) config.replyStyle = 'meta';
                else if (['off', 'classic', 'disable', 'no'].includes(mode)) config.replyStyle = 'classic';
                else {
                    await sock.sendMessage(chatId, {
                        text: '❌ Invalid option.\nUse: `.autoreply meta on|off`'
                    });
                    return;
                }
            } else if (action === 'voice') {
                const mode = (args[1] || 'toggle').toLowerCase();
                if (mode === 'toggle') config.voiceReplies = !config.voiceReplies;
                else if (['on', 'enable', 'yes'].includes(mode)) config.voiceReplies = true;
                else if (['off', 'disable', 'no'].includes(mode)) config.voiceReplies = false;
                else {
                    await sock.sendMessage(chatId, {
                        text: '❌ Invalid option.\nUse: `.autoreply voice on|off`'
                    });
                    return;
                }
            } else if (action === 'react') {
                const mode = (args[1] || 'toggle').toLowerCase();
                if (mode === 'toggle') config.autoReactHeart = !config.autoReactHeart;
                else if (['on', 'enable', 'yes'].includes(mode)) config.autoReactHeart = true;
                else if (['off', 'disable', 'no'].includes(mode)) config.autoReactHeart = false;
                else {
                    await sock.sendMessage(chatId, {
                        text: '❌ Invalid option.\nUse: `.autoreply react on|off`'
                    });
                    return;
                }
            } else if (action === 'buttons' || action === 'button') {
                const mode = (args[1] || 'toggle').toLowerCase();
                if (mode === 'toggle') config.buttons = config.buttons === false;
                else if (['on', 'enable', 'yes'].includes(mode)) config.buttons = true;
                else if (['off', 'disable', 'no'].includes(mode)) config.buttons = false;
                else {
                    await sock.sendMessage(chatId, {
                        text: '❌ Invalid option.\nUse: `.autoreply buttons on|off`'
                    });
                    return;
                }
            } else if (['stream', 'suggest', 'sources'].includes(action)) {
                const flag = { stream: 'metaStream', suggest: 'metaSuggest', sources: 'metaSources' }[action];
                const mode = (args[1] || 'toggle').toLowerCase();
                if (mode === 'toggle') config[flag] = config[flag] === false;
                else if (['on', 'enable', 'yes'].includes(mode)) config[flag] = true;
                else if (['off', 'disable', 'no'].includes(mode)) config[flag] = false;
                else {
                    await sock.sendMessage(chatId, {
                        text: `❌ Invalid option.\nUse: \`.autoreply ${action} on|off\``
                    });
                    return;
                }
            } else {
                await sock.sendMessage(chatId, {
                    text:
                        '❌ Invalid arguments. Use:\n' +
                        '• `.autoreply on` / `.autoreply off`\n' +
                        '• `.autoreply group off|mention|all`\n' +
                        '• `.autoreply cooldown <seconds>`\n' +
                        '• `.autoreply code on|off`\n' +
                        '• `.autoreply copybox off|code|all`\n' +
                        '• `.autoreply meta on|off`\n' +
                        '• `.autoreply stream|suggest|sources on|off`\n' +
                        '• `.autoreply buttons on|off`\n' +
                        '• `.autoreply voice on|off`\n' +
                        '• `.autoreply react on|off`'
                });
                return;
            }
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        const presenceOn = config.presence !== false;
        const nextAction = config.autoreply ? 'off' : 'on';
        const groupReply = config.groupReply || 'off';
        const groupIcon = groupReply === 'off' ? '🚫' : groupReply === 'mention' ? '🔔' : '🌐';
        const engineLabels = {
            auto: 'Auto (ChatGPT → BJ-GPT → Offline)',
            chatgpt: 'ChatGPT Android',
            bjgpt: 'BJ-GPT-OSS-20b',
            offline: 'Offline JSON'
        };
        const engineLabel = engineLabels[config.aiEngine] || engineLabels.auto;

        await sendQuickReply(sock, chatId, {
            text:
                `✅ *Auto-reply* has been ${config.autoreply ? 'enabled' : 'disabled'}!\n\n` +
                `🔌 AI Engine: ${engineLabel}\n` +
                `🎭 Human presence: ${presenceOn ? 'ON' : 'OFF'}\n` +
                `👥 Groups: ${groupIcon} ${groupReply} • cooldown ${Math.round((config.groupCooldownMs || 0) / 1000)}s\n` +
                `🖥️ Code highlight: ${config.codeHighlight === false ? 'OFF' : 'ON'}\n` +
                `🗂️ Copy box: ${config.copyBox || 'code'}\n` +
                `🔗 Action buttons: ${config.buttons === false ? 'OFF' : 'ON'}\n` +
                `🤖 Persona: ${config.replyStyle === 'classic' ? 'Classic' : 'Meta AI'} ` +
                `(stream ${config.metaStream !== false ? 'on' : 'off'}, ` +
                `suggest ${config.metaSuggest !== false ? 'on' : 'off'}, ` +
                `sources ${config.metaSources !== false ? 'on' : 'off'})\n` +
                `🗣️ Voice replies: ${config.voiceReplies === true ? 'ON' : 'OFF'} • ❤️ Heart: ${config.autoReactHeart === true ? 'ON' : 'OFF'}\n\n` +
                `_Group modes: off = never reply, mention = only when @mentioned/replied, all = reply to everything_`,
            footer: `© ${settings.botName || 'Osunhive Chatbot'}`,
            buttons: [
                { id: `autoreply_${nextAction}`, text: config.autoreply ? '⏹️ Turn Off' : '▶️ Turn On' },
                { id: 'autoreply_group_toggle', text: `👥 Group: ${groupReply}` },
                { id: 'menu', text: '📋 Menu' }
            ],
            quoted: message
        });

    } catch (error) {
        console.error('Auto-reply command error:', error);
    }
}

// Per-group cooldown so the bot can never spam a busy group
const groupReplyCooldown = new Map();
const GROUP_COOLDOWN_MAX_ENTRIES = 500;

function numericOf(jid) {
    return String(jid || '').split('@')[0].split(':')[0];
}

function isBotMentioned(message, sock) {
    const msg = message?.message || {};
    const ctx =
        msg.extendedTextMessage?.contextInfo ||
        msg.imageMessage?.contextInfo ||
        msg.videoMessage?.contextInfo ||
        msg.documentMessage?.contextInfo ||
        msg.audioMessage?.contextInfo ||
        {};

    const botIds = new Set(
        [sock?.user?.id, sock?.user?.lid].map(numericOf).filter(Boolean)
    );

    // Direct @mention
    const mentions = ctx?.mentionedJid || [];
    if (mentions.some(j => botIds.has(numericOf(j)))) return true;

    // Reply/quote to one of the bot's own messages
    if (ctx?.participant && botIds.has(numericOf(ctx.participant))) return true;

    // Plain "@<bot number>" inside the text
    const text =
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        '';
    if (text && [...botIds].some(n => n && text.includes(`@${n}`))) return true;

    return false;
}

/**
 * Handle auto-reply with proper routing (Checks and ignores bot owner & self messages)
 * @param {object} sock - WhatsApp socket connection
 * @param {string} chatId - Chat ID
 * @param {string} userMessage - User's message
 * @param {object} [message=null] - The original Baileys message object
 * @returns {boolean} - Success status
 */
async function handleAutoReply(sock, chatId, userMessage, message = null) {
    const config = initExtendedConfig();
    if (!config.autoreply) return false;

    // 0. Never reply to status broadcasts
    if (chatId === 'status@broadcast') return false;

    // 1. Safeguard: never auto-reply to messages sent from the linked account
    //    (i.e. messages *you* send to other people). This is checked first and
    //    cannot be overridden by config.
    if (message?.key?.fromMe) return false;

    // 2. Group policy: off by default, optional mention-only, optional all
    const isGroupChat = typeof chatId === 'string' && chatId.endsWith('@g.us');
    if (isGroupChat) {
        const mode = config.groupReply || 'off';
        if (mode === 'off') return false;
        if (mode === 'mention' && !isBotMentioned(message, sock)) return false;

        const cooldown = Number(config.groupCooldownMs) || 0;
        const lastReply = groupReplyCooldown.get(chatId) || 0;
        if (cooldown > 0 && Date.now() - lastReply < cooldown) return false; // throttled
        groupReplyCooldown.set(chatId, Date.now());

        // Keep the map from growing forever
        if (groupReplyCooldown.size > GROUP_COOLDOWN_MAX_ENTRIES) {
            const oldest = groupReplyCooldown.keys().next().value;
            groupReplyCooldown.delete(oldest);
        }
    }

    // Resolve the sender's display name once, used for greetings & the Meta prompt
    const displayName = (() => {
        try { return resolveDisplayName(sock, chatId, message); }
        catch (error) { console.error('❌ [userName] resolve failed:', error.message); return null; }
    })();

    // 3. Safeguard: Ignore messages sent by the owner/sudo users
    try {
        const senderId = message?.key?.participant || message?.key?.remoteJid || chatId;
        if (senderId && typeof senderId === 'string') {
            const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
            if (isOwner) {
                return false; // Silently exit for owner/sudo messages
            }
        }
    } catch (error) {
        console.error('❌ Error checking owner status in auto-reply:', error.message);
    }

    // 4. Per-sender rate limit (prevents a single user from flooding auto-reply)
    const senderJid = message?.key?.participant || chatId;
    recordMessage(senderJid);
    if (isRateLimited(senderJid) || !canReceiveReply(senderJid)) {
        console.log('[autoreply] rate limited:', senderJid);
        return false;
    }

    try {
        const textClean = userMessage.toLowerCase().trim();
        let replyText = null;
        const presenceEnabled = config.presence !== false;
        const buttonsEnabled = config.buttons !== false;

        // Greeting shortcut — answer with a personal “how are you” instead of the AI/chat engine.
        const isGreeting = isGreetingMessage(textClean);
        if (isGreeting) {
            replyText = buildGreetingReply(displayName);
            // Presence pulse tuned for a greeting conversation
            if (presenceEnabled) {
                await pulseTyping(sock, chatId, 900);
            }
        } else if (textClean === 'menu' || textClean === '.menu' || textClean === 'help' || textClean === '.help') {
            replyText = getMenuResponse();
        } else if (textClean === 'product' || textClean === '.product') {
            replyText = getProductResponse();
        } else if (textClean === 'website' || textClean === '.website') {
            replyText = `🌐 *Osunhive Official Website* 🌐\n\nAccess our learning tutorials, modern blogging designs, and developer codebases:\nhttps://www.osunhive.name.ng`;
        } else if (textClean === 'application' || textClean === '.application' || textClean === 'app' || textClean === '.app') {
            replyText = getApplicationResponse();
        } else if (textClean === 'offline' || textClean === '.offline') {
            replyText = getOfflineAiQuestionsResponse();
        } else {
            // Check offline dataset answers first
            replyText = getOfflineAnswer(userMessage);
        }

        // Human-like presence: online → typing → recording → fake file upload

        // If no keyword patterns matched, trigger the BJ-GPT-OSS-20B API
        let replyFromApi = false;
        if (!replyText) {
            if (presenceEnabled) {
                const typingDelay = Math.max(1200, Math.min(5000, String(userMessage || '').length * 80));
                await simulateHumanPresence(sock, chatId, {
                    showOnline: true,
                    showTyping: true,
                    showRecording: true,
                    showUpload: true,
                    onlineDelay: 250,
                    typingDelay,
                    recordingDelay: 900,
                    uploadDelay: 700,
                    finalTypingDelay: 500
                });
            }
            replyText = await generateApiReply(userMessage, displayName);
            replyFromApi = true;
        } else if (presenceEnabled) {
            // Short human pulse for the built-in navigation replies
            await pulseTyping(sock, chatId, 900);
        }

        // Canned/keyword replies also get the Meta AI layout (but plain greetings don't).
        if (
            !replyFromApi &&
            !isGreeting &&
            config.replyStyle === 'meta' &&
            typeof replyText === 'string' &&
            replyText.trim()
        ) {
            replyText = formatMetaReply(replyText, {
                userMessage,
                suggest: config.metaSuggest !== false,
                sources: config.metaSources !== false
            });
        }

        const replyContext = {
            forwardingScore: 1,
            isForwarded: false,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363419178084647@newsletter',
                newsletterName: 'Osunhive Bot',
                serverMessageId: -1
            }
        };

        const finishReply = async () => {
            if (config.voiceReplies) {
                sendReplyVoiceNote(sock, chatId, replyText).catch(() => {});
            }
            if (config.autoReactHeart && message?.key) {
                react(sock, message.key, '❤️').catch(() => {});
            }
        };

        markReplySent(senderJid);

        // Dispatch the final payload. Interactive buttons give the user a
        // one-tap "Website" link plus "Menu" / "Products" shortcuts.
        const canUseButtons =
            buttonsEnabled &&
            typeof replyText === 'string' &&
            replyText.length > 0 &&
            replyText.length <= 900;

        if (canUseButtons) {
            await sendCtaButtons(sock, chatId, {
                text: replyText,
                footer: `© ${settings.botName || 'Osunhive Chatbot'}`,
                ctaUrl: 'https://www.osunhive.name.ng',
                ctaUrlText: '🌐 Osunhive',
                quickReplies: [
                    { id: 'ar_menu', text: '📋 Menu' },
                    { id: 'ar_product', text: '📦 Products' }
                ],
                quoted: message,
                contextInfo: replyContext
            });
            await finishReply();
            return true;
        }

        // Meta AI style: stream the answer with progressive edits.
        // Streaming cannot carry buttons, so it is only used when the reply is
        // too long for an interactive message or buttons are disabled.
        if (
            config.replyStyle === 'meta' &&
            config.metaStream !== false &&
            typeof replyText === 'string' &&
            replyText.trim().length > 0
        ) {
            await streamReply(sock, chatId, replyText, {
                quoted: message,
                contextInfo: replyContext
            });
            await finishReply();
            return true;
        }

        await sock.sendMessage(chatId, {
            text: replyText,
            contextInfo: replyContext
        });

        await finishReply();
        return true;
    } catch (error) {
        console.error('❌ Auto-reply failed:', error);
        
        // Error handling fallback (Utilizes OsunhiveLLM's local fallback mechanism)
        try {
            const errorFallback = getOfflineLLMResponse(userMessage);
            await sock.sendMessage(chatId, { 
                text: errorFallback
            });
        } catch (sendError) {
            console.error('❌ Failed to send fallback message:', sendError);
        }
        
        return false;
    }
}

module.exports = {
    autotypingCommand,
    autoreplyCommand,
    isAutotypingEnabled,
    handleAutotypingForMessage,
    handleAutotypingForCommand,
    showTypingAfterCommand,
    handleAutoReply,
    markdownToWhatsApp,
    formatAutoReply,
    wrapInCopyBox,
    applyCopyBox,
    isBotMentioned
};