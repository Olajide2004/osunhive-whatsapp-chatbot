/**
 * Link unfurling helper — fetches OpenGraph metadata and builds the WhatsApp
 * external-ad reply context that renders a preview card next to the text.
 */

const { getLinkPreview } = require('link-preview-js');

const DEFAULT_TIMEOUT_MS = 6000;

/** Fetch open-graph info without crashing on dead sites. */
async function getPreview(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
    let result;
    try {
        result = await Promise.race([
            getLinkPreview(url, undefined, undefined, timeoutMs),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
        ]);
    } catch (error) {
        return { url, siteName: new URL(url).hostname, error: error.message || String(error) };
    }

    if (!result) {
        try { const hostname = new URL(url).hostname; return { url, siteName: hostname, error: 'no preview data' }; }
        catch { return { url, siteName: 'unknown', error: 'invalid url' }; }
    }

    const ogTitle = result.title ? String(result.title).slice(0, 60) : null;
    const ogDesc = result.description ? String(result.description).slice(0, 300) : null;
    const image = Array.isArray(result.images && result.images[0]) && result.images[0].url
        ? result.images[0].url
        : result.url;
    return {
        url: String(result.url || url),
        title: ogTitle,
        description: ogDesc,
        siteName: result.siteName || new URL(result.url || url).hostname,
        imageUrl: String(image),
        error: null
    };
}

/** Build the Baileys contextInfo used for a link preview card. */
function buildAdContext(preview) {
    const p = preview || {};
    const host = p.siteName || new URL(p.url).hostname || '';
    return {
        title: p.title || host,
        body: p.description || '',
        sourceType: 'web',
        sourceId: p.url,
        sourceUrl: p.url,
        originalImageUrl: p.imageUrl || p.url,
        renderLargerThumbnail: true,
        mediaType: 1 // IMAGE (proto.ChatRowOpaqueData.ExternalAdReplyInfoMediaType.IMAGE)
    };
}

/** Send a link preview card for `url`, attached after the quoted reply. */
async function sendUnfurl(sock, chatId, url, options = {}) {
    const quoted = options.quoted || null;
    const preview = await getPreview(url);
    const headline = preview.error ? `🔗 ${preview.siteName}` : `${preview.title || preview.siteName}`;
    const body = preview.description ? `\n${preview.description}` : '';
    await sock.sendMessage(chatId, {
        text: `${headline}${body}`,
        contextInfo: buildAdContext(preview)
    }, quoted ? { quoted } : undefined);
}

module.exports = {
    getPreview,
    buildAdContext,
    sendUnfurl
};
