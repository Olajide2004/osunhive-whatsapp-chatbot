/**
 * Osunhive Chatbot Updater Script
 * Allows updating the bot directly via CLI: node update.js [--check]
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const settings = require('./settings');

function run(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { cwd: __dirname, windowsHide: true }, (err, stdout, stderr) => {
            if (err) return reject(new Error((stderr || stdout || err.message || '').toString()));
            resolve((stdout || '').toString());
        });
    });
}

async function getPackageManager() {
    try {
        await run('pnpm --version');
        return 'pnpm';
    } catch {
        try {
            await run('npm --version');
            return 'npm';
        } catch {
            return null;
        }
    }
}

function downloadFile(url, dest, visited = new Set()) {
    return new Promise((resolve, reject) => {
        try {
            if (visited.has(url) || visited.size > 5) {
                return reject(new Error('Too many redirects'));
            }
            visited.add(url);

            const useHttps = url.startsWith('https://');
            const client = useHttps ? https : http;
            const req = client.get(url, {
                headers: {
                    'User-Agent': 'Osunhive-Updater/2.0',
                    'Accept': '*/*'
                }
            }, res => {
                if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
                    const location = res.headers.location;
                    if (!location) return reject(new Error(`HTTP ${res.statusCode} without Location`));
                    const nextUrl = new URL(location, url).toString();
                    res.resume();
                    return downloadFile(nextUrl, dest, visited).then(resolve).catch(reject);
                }

                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }

                const file = fs.createWriteStream(dest);
                res.pipe(file);
                file.on('finish', () => file.close(resolve));
                file.on('error', err => {
                    try { file.close(() => {}); } catch {}
                    fs.unlink(dest, () => reject(err));
                });
            });
            req.on('error', err => {
                fs.unlink(dest, () => reject(err));
            });
        } catch (e) {
            reject(e);
        }
    });
}

async function extractZip(zipPath, outDir) {
    if (process.platform === 'win32') {
        const cmd = `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${outDir.replace(/\\/g, '/')}' -Force"`;
        await run(cmd);
        return;
    }
    try {
        await run(`unzip -o '${zipPath}' -d '${outDir}'`);
        return;
    } catch {}
    try {
        await run(`7z x -y '${zipPath}' -o'${outDir}'`);
        return;
    } catch {}
    try {
        await run(`busybox unzip -o '${zipPath}' -d '${outDir}'`);
        return;
    } catch {}
    throw new Error('No unzip utility found (unzip, 7z, or busybox required)');
}

function copyRecursive(src, dest, ignore = [], relative = '', outList = []) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
        if (ignore.includes(entry)) continue;
        const s = path.join(src, entry);
        const d = path.join(dest, entry);
        const stat = fs.lstatSync(s);
        if (stat.isDirectory()) {
            copyRecursive(s, d, ignore, path.join(relative, entry), outList);
        } else {
            fs.copyFileSync(s, d);
            if (outList) outList.push(path.join(relative, entry).replace(/\\/g, '/'));
        }
    }
}

async function checkForUpdates() {
    console.log('🔍 Checking for updates...');
    try {
        const res = await new Promise((resolve, reject) => {
            const req = https.get('https://api.github.com/repos/Osunhive/osunhive-whatsapp-chatbot/commits/main', {
                headers: {
                    'User-Agent': 'Osunhive-Updater/2.0',
                    'Accept': 'application/vnd.github.v3+json'
                }
            }, res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
        });

        if (res && res.sha) {
            console.log(`📌 Latest commit on main: ${res.sha.substring(0, 7)}`);
            console.log(`💬 Message: ${res.commit?.message?.split('\n')[0]}`);
            console.log(`📅 Date: ${res.commit?.committer?.date}`);
            return res.sha;
        }
    } catch (err) {
        console.log('⚠️ Could not query GitHub API:', err.message);
    }
    return null;
}

async function main() {
    const isCheckOnly = process.argv.includes('--check') || process.argv.includes('-c');
    
    if (isCheckOnly) {
        await checkForUpdates();
        return;
    }

    console.log('🔄 Starting Osunhive Chatbot Update...');
    await checkForUpdates();

    const zipUrl = settings.updateZipUrl || 'https://github.com/Osunhive/osunhive-whatsapp-chatbot/archive/refs/heads/main.zip';
    const tmpDir = path.join(__dirname, 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const zipPath = path.join(tmpDir, 'update.zip');

    console.log(`⬇️ Downloading update archive from ${zipUrl}...`);
    await downloadFile(zipUrl, zipPath);

    const extractTo = path.join(tmpDir, 'update_extract');
    if (fs.existsSync(extractTo)) fs.rmSync(extractTo, { recursive: true, force: true });
    console.log('📦 Extracting update archive...');
    await extractZip(zipPath, extractTo);

    const [root] = fs.readdirSync(extractTo).map(n => path.join(extractTo, n));
    const srcRoot = fs.existsSync(root) && fs.lstatSync(root).isDirectory() ? root : extractTo;

    // Backup current critical settings
    const preservedConfig = {
        ownerNumber: settings.ownerNumber,
        botOwner: settings.botOwner,
        botName: settings.botName,
        packname: settings.packname,
        giphyApiKey: settings.giphyApiKey
    };

    const ignore = ['node_modules', '.git', 'session', 'tmp', 'temp', 'data', 'baileys_store.json', '.env'];
    const copiedFiles = [];
    console.log('📂 Applying updated files...');
    copyRecursive(srcRoot, __dirname, ignore, '', copiedFiles);

    // Restore preserved config in settings.js if needed
    try {
        const settingsPath = path.join(__dirname, 'settings.js');
        if (fs.existsSync(settingsPath)) {
            let text = fs.readFileSync(settingsPath, 'utf8');
            if (preservedConfig.ownerNumber) {
                text = text.replace(/ownerNumber:\s*'[^']*'/, `ownerNumber: '${preservedConfig.ownerNumber}'`);
            }
            if (preservedConfig.botOwner) {
                text = text.replace(/botOwner:\s*'[^']*'/, `botOwner: '${preservedConfig.botOwner}'`);
            }
            fs.writeFileSync(settingsPath, text);
        }
    } catch (e) {
        console.warn('Warning updating settings.js:', e.message);
    }

    // Cleanup temp
    try { fs.rmSync(extractTo, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(zipPath, { force: true }); } catch {}

    // Update dependencies
    const pm = await getPackageManager();
    if (pm) {
        console.log(`📦 Running ${pm} install to update dependencies...`);
        try {
            await run(`${pm} install`);
            console.log('✅ Dependencies updated successfully.');
        } catch (err) {
            console.warn(`⚠️ Warning during ${pm} install:`, err.message);
        }
    }

    console.log(`🎉 Osunhive Chatbot updated successfully! (${copiedFiles.length} files processed)`);
    console.log('💡 Restart the bot with: npm start (or pnpm start)');
}

if (require.main === module) {
    main().catch(err => {
        console.error('❌ Update failed:', err.message);
        process.exit(1);
    });
}

module.exports = { main, checkForUpdates };
