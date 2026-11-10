const fs = require('fs');
const path = require('path');

const sessionDir = path.join(__dirname, 'session');

console.log('🔄 Resetting WhatsApp session...');
if (fs.existsSync(sessionDir)) {
    try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        fs.mkdirSync(sessionDir, { recursive: true });
        console.log('✅ Session cleared successfully. Next run will require new pairing or QR scan.');
    } catch (err) {
        console.error('❌ Failed to clear session:', err.message);
    }
} else {
    fs.mkdirSync(sessionDir, { recursive: true });
    console.log('Session directory was already clean.');
}
