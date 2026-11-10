const fs = require('fs');
const path = require('path');

const dirsToClean = [
    path.join(__dirname, 'tmp'),
    path.join(__dirname, 'temp'),
];

console.log('🧹 Cleaning temporary files...');
let removedCount = 0;

dirsToClean.forEach(dir => {
    if (fs.existsSync(dir)) {
        try {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                try {
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        fs.rmSync(fullPath, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(fullPath);
                    }
                    removedCount++;
                } catch (e) {
                    // ignore locked files
                }
            }
        } catch (err) {
            console.error(`Error reading ${dir}:`, err.message);
        }
    } else {
        fs.mkdirSync(dir, { recursive: true });
    }
});

console.log(`✅ Cleanup completed. ${removedCount} temporary files removed.`);
