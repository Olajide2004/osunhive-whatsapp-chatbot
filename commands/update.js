const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const settings = require('../settings');
const isOwnerOrSudo = require('../lib/isOwner');

function run(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { cwd: path.join(__dirname, '..'), windowsHide: true }, (err, stdout, stderr) => {
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

async function hasGitRepo() {
    const gitDir = path.join(process.cwd(), '.git');
    if (!fs.existsSync(gitDir)) return false;
    try {
        await run('git --version');
        return true;
    } catch {
        return false;
    }
}

async function updateViaGit() {
    const oldRev = (await run('git rev-parse HEAD').catch(() => 'unknown')).trim();
    await run('git fetch --all --prune');
    const newRev = (await run('git rev-parse origin/main')).trim();
    const alreadyUpToDate = oldRev === newRev;
    const commits = alreadyUpToDate ? '' : await run(`git log --pretty=format:"%h %s (%an)" ${oldRev}..${newRev}`).catch(() => '');
    const files = alreadyUpToDate ? '' : await run(`git diff --name-status ${oldRev} ${newRev}`).catch(() => '');
    await run(`git reset --hard ${newRev}`);
    await run('git clean -fd -e node_modules -e session -e tmp -e temp -e data -e .env');
    return { oldRev, newRev, alreadyUpToDate, commits, files };
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

/**
 * Pure-Node ZIP extractor — no external unzip/7z/busybox required.
 * Reads the ZIP central directory and inflates entries with zlib, so the
 * source-only release can update itself even on a bare device.
 */
function extractZipNode(zipPath, outDir) {
    const zlib = require('zlib');
    const buf = fs.readFileSync(zipPath);

    const EOCD_SIG = 0x06054b50;
    const CEN_SIG = 0x02014b50;
    const LOC_SIG = 0x04034b50;

    // Locate the End Of Central Directory record (scan backwards, max comment 64K).
    let eocd = -1;
    const minEocd = Math.max(0, buf.length - 22 - 0xffff);
    for (let i = buf.length - 22; i >= minEocd; i--) {
        if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error('not a ZIP file (no end-of-central-directory)');

    let totalEntries = buf.readUInt16LE(eocd + 10);
    let cdOffset = buf.readUInt32LE(eocd + 16);
    let cdSize = buf.readUInt32LE(eocd + 12);

    // Minimal ZIP64 support (locator sits 20 bytes before the EOCD).
    if ((totalEntries === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) && eocd >= 20) {
        const locSig = buf.readUInt32LE(eocd - 20);
        if (locSig === 0x07064b50) {
            const z64 = Number(buf.readBigUInt64LE(eocd - 20 + 8));
            if (buf.readUInt32LE(z64) === 0x06064b50) {
                totalEntries = Number(buf.readBigUInt64LE(z64 + 32));
                cdSize = Number(buf.readBigUInt64LE(z64 + 40));
                cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
            }
        }
    }

    const root = path.resolve(outDir);
    fs.mkdirSync(root, { recursive: true });

    let offset = cdOffset;
    let written = 0;

    for (let i = 0; i < totalEntries; i++) {
        if (buf.readUInt32LE(offset) !== CEN_SIG) throw new Error('corrupt ZIP central directory');
        const method = buf.readUInt16LE(offset + 10);
        let compSize = buf.readUInt32LE(offset + 20);
        let uncompSize = buf.readUInt32LE(offset + 24);
        const nameLen = buf.readUInt16LE(offset + 28);
        const extraLen = buf.readUInt16LE(offset + 30);
        const commentLen = buf.readUInt16LE(offset + 32);
        let localOffset = buf.readUInt32LE(offset + 42);
        const name = buf.slice(offset + 46, offset + 46 + nameLen).toString('utf8');

        // ZIP64 extended information extra field (0x0001).
        if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
            let ex = offset + 46 + nameLen;
            const exEnd = ex + extraLen;
            while (ex + 4 <= exEnd) {
                const id = buf.readUInt16LE(ex);
                const len = buf.readUInt16LE(ex + 2);
                if (id === 0x0001) {
                    let p = ex + 4;
                    if (uncompSize === 0xffffffff) { uncompSize = Number(buf.readBigUInt64LE(p)); p += 8; }
                    if (compSize === 0xffffffff) { compSize = Number(buf.readBigUInt64LE(p)); p += 8; }
                    if (localOffset === 0xffffffff) { localOffset = Number(buf.readBigUInt64LE(p)); p += 8; }
                    break;
                }
                ex += 4 + len;
            }
        }

        offset += 46 + nameLen + extraLen + commentLen;

        // Guard against path traversal.
        const safeRel = String(name).split('/').filter((p) => p && p !== '.' && p !== '..').join('/');
        if (!safeRel) continue;
        const dest = path.resolve(root, safeRel);
        if (dest !== root && !dest.startsWith(root + path.sep)) {
            throw new Error(`unsafe path in ZIP: ${name}`);
        }

        if (name.endsWith('/')) {
            fs.mkdirSync(dest, { recursive: true });
            continue;
        }

        if (buf.readUInt32LE(localOffset) !== LOC_SIG) throw new Error(`corrupt ZIP local header for ${name}`);
        const lnameLen = buf.readUInt16LE(localOffset + 26);
        const lextraLen = buf.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + lnameLen + lextraLen;
        const comp = buf.slice(dataStart, dataStart + compSize);

        let out;
        if (method === 0) out = comp;
        else if (method === 8) out = zlib.inflateRawSync(comp);
        else throw new Error(`unsupported ZIP compression method ${method} for ${name}`);

        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, out);
        written++;
    }

    return written;
}

async function extractZip(zipPath, outDir) {
    if (process.platform === 'win32') {
        try {
            const cmd = `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${outDir.replace(/\\/g, '/')}' -Force"`;
            await run(cmd);
            return;
        } catch { /* fall through to the built-in extractor */ }
    }
    for (const cmd of [
        `unzip -o '${zipPath}' -d '${outDir}'`,
        `7z x -y '${zipPath}' -o'${outDir}'`,
        `busybox unzip -o '${zipPath}' -d '${outDir}'`
    ]) {
        try {
            await run(cmd);
            return;
        } catch { /* try the next tool */ }
    }
    // No external tool available — fall back to the pure-Node extractor.
    try {
        const count = extractZipNode(zipPath, outDir);
        console.log(`[update] extracted ${count} file(s) with the built-in ZIP reader`);
        return;
    } catch (e) {
        throw new Error(`No unzip tool found (unzip/7z/busybox) and built-in extraction failed: ${e.message}`);
    }
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

async function updateViaZip(sock, chatId, message, zipOverride) {
    const zipUrl = (zipOverride || process.env.UPDATE_ZIP_URL || '').trim();
    let resolvedZipUrl = zipUrl;
    if (!resolvedZipUrl) {
        try {
            const slug = await getRepoSlug();
            resolvedZipUrl = `https://github.com/${slug}/archive/refs/heads/main.zip`;
        } catch { /* fall back below */ }
    }
    if (!resolvedZipUrl) resolvedZipUrl = (settings.updateZipUrl || '').trim();
    if (!resolvedZipUrl) {
        throw new Error('No ZIP URL configured. Set settings.updateZipUrl or UPDATE_ZIP_URL env.');
    }
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const zipPath = path.join(tmpDir, 'update.zip');
    await downloadFile(resolvedZipUrl, zipPath);
    const extractTo = path.join(tmpDir, 'update_extract');
    if (fs.existsSync(extractTo)) fs.rmSync(extractTo, { recursive: true, force: true });
    await extractZip(zipPath, extractTo);

    const [root] = fs.readdirSync(extractTo).map(n => path.join(extractTo, n));
    const srcRoot = fs.existsSync(root) && fs.lstatSync(root).isDirectory() ? root : extractTo;

    // Copy over while preserving runtime dirs/files
    const ignore = ['node_modules', '.git', 'session', 'tmp', 'temp', 'data', 'baileys_store.json', '.env'];
    const copied = [];
    
    // Preserve owner and custom settings
    let preservedOwner = null;
    let preservedBotOwner = null;
    try {
        const currentSettings = require('../settings');
        preservedOwner = currentSettings && currentSettings.ownerNumber ? String(currentSettings.ownerNumber) : null;
        preservedBotOwner = currentSettings && currentSettings.botOwner ? String(currentSettings.botOwner) : null;
    } catch {}

    copyRecursive(srcRoot, process.cwd(), ignore, '', copied);

    if (preservedOwner) {
        try {
            const settingsPath = path.join(process.cwd(), 'settings.js');
            if (fs.existsSync(settingsPath)) {
                let text = fs.readFileSync(settingsPath, 'utf8');
                text = text.replace(/ownerNumber:\s*'[^']*'/, `ownerNumber: '${preservedOwner}'`);
                if (preservedBotOwner) {
                    text = text.replace(/botOwner:\s*'[^']*'/, `botOwner: '${preservedBotOwner}'`);
                }
                fs.writeFileSync(settingsPath, text);
            }
        } catch {}
    }

    try { fs.rmSync(extractTo, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(zipPath, { force: true }); } catch {}
    return { copiedFiles: copied };
}

async function getRepoSlug() {
    try {
        const url = (await run('git remote get-url origin')).trim();
        const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
        if (m) return `${m[1]}/${m[2]}`;
    } catch { /* not a git repo */ }
    return settings.githubRepo || 'Osunhive/osunhive-whatsapp-chatbot';
}

async function getLocalSha() {
    try {
        return (await run('git rev-parse HEAD')).trim();
    } catch {
        return null;
    }
}

function githubJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Osunhive-Updater/2.0',
                'Accept': 'application/vnd.github.v3+json'
            }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let body;
                try {
                    body = JSON.parse(data);
                } catch {
                    return reject(new Error(`Invalid response from GitHub (HTTP ${res.statusCode})`));
                }
                if (res.statusCode >= 400) {
                    return reject(new Error(body.message || `GitHub HTTP ${res.statusCode}`));
                }
                resolve(body);
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => req.destroy(new Error('GitHub request timed out')));
    });
}

async function checkRemoteUpdate(repo) {
    const slug = repo || await getRepoSlug();
    const remote = await githubJson(`https://api.github.com/repos/${slug}/commits/main`);
    return { slug, remote };
}

/** Compare the local checkout with the remote tip (best effort). */
async function compareCommits(slug, localSha, remoteSha) {
    if (!localSha || !remoteSha || localSha === remoteSha) return { behind: 0, ahead: 0 };
    try {
        const cmp = await githubJson(`https://api.github.com/repos/${slug}/compare/${localSha}...${remoteSha}`);
        return {
            behind: typeof cmp.behind_by === 'number' ? cmp.behind_by : null,
            ahead: typeof cmp.ahead_by === 'number' ? cmp.ahead_by : null
        };
    } catch {
        return { behind: null, ahead: null };
    }
}

/** Build a detached shell command that waits for this process to die, then restarts it. */
function buildRelaunchCommand(execPath = process.execPath, argv = process.argv.slice(1), delayMs = 2000) {
    const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
    const args = argv.map(quote).join(' ');
    return `sleep ${Math.max(1, Math.round(delayMs / 1000))}; exec ${quote(execPath)}${args ? ' ' + args : ''}`;
}

/**
 * Restart without pm2: spawn a detached child that waits a moment for this
 * process to release the session, then starts the bot again. Log output is
 * appended to `temp/bot.log` so it is not lost.
 */
function relaunchDetached(delayMs = 2000) {
    const childProcess = require('child_process');
    let stdio = 'ignore';
    let fd = null;
    try {
        const logDir = path.join(__dirname, '..', 'temp');
        fs.mkdirSync(logDir, { recursive: true });
        fd = fs.openSync(path.join(logDir, 'bot.log'), 'a');
        stdio = ['ignore', fd, fd];
    } catch {
        /* no log file, just run quietly */
    }

    const child = childProcess.spawn('/bin/sh', ['-c', buildRelaunchCommand(process.execPath, process.argv.slice(1), delayMs)], {
        cwd: path.join(__dirname, '..'),
        detached: true,
        stdio,
        env: process.env
    });
    child.unref();
    return child.pid;
}

async function restartProcess(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, { text: '✅ Update complete! Restarting Osunhive Chatbot…' }, { quoted: message });
    } catch {}
    try {
        await run('pm2 restart all');
        return;
    } catch {}
    try {
        relaunchDetached();
    } catch (error) {
        console.warn('[update] could not relaunch automatically:', error.message);
    }
    setTimeout(() => {
        process.exit(0);
    }, 800);
}

async function updateCommand(sock, chatId, message, zipOverride) {
    const senderId = message.key.participant || message.key.remoteJid;
    const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
    
    if (!message.key.fromMe && !isOwner) {
        await sock.sendMessage(chatId, { text: '❌ Only the bot owner or sudo can use .update' }, { quoted: message });
        return;
    }

    const rawText = message.message?.conversation || 
                    message.message?.extendedTextMessage?.text || '';
    const args = rawText.trim().split(/\s+/).slice(1);

    // Check subcommand: .update check
    if (args[0] === 'check' || args[0] === '-c') {
        try {
            await sock.sendMessage(chatId, { text: '🔍 Checking for Osunhive Chatbot updates...' }, { quoted: message });

            const { slug, remote } = await checkRemoteUpdate();
            const localSha = await getLocalSha();
            const remoteSha = remote?.sha || null;
            const same = !!(localSha && remoteSha && localSha === remoteSha);
            const cmp = same ? { behind: 0, ahead: 0 } : await compareCommits(slug, localSha, remoteSha);

            const report = [
                '*🤖 Osunhive Chatbot Update Status*',
                '',
                `• *Version:* ${settings.version || '2.0.0'}`,
                `• *Repository:* \`${slug}\``,
                `• *Local commit:* ${localSha ? localSha.substring(0, 7) : '_not a git checkout_'}`,
                `• *Remote commit:* ${remoteSha ? remoteSha.substring(0, 7) : '_unknown_'}`
            ];
            if (remote?.commit?.message) {
                report.push(`• *Latest change:* ${remote.commit.message.split('\n')[0]}`);
            }
            if (remote?.commit?.committer?.date) {
                report.push(`• *Updated on:* ${remote.commit.committer.date}`);
            }
            report.push('');
            if (!localSha) {
                report.push('ℹ️ Not a git checkout — `.update` will use the ZIP package.');
            } else if (same) {
                report.push('✅ *You are on the latest commit.*');
            } else if (cmp.behind === 0 && cmp.ahead > 0) {
                report.push(`ℹ️ *Your checkout is ahead of GitHub* by ${cmp.ahead} local commit${cmp.ahead === 1 ? '' : 's'}.`);
            } else {
                report.push(`⬆️ *Update available${cmp.behind ? ` — ${cmp.behind} commit${cmp.behind === 1 ? '' : 's'} behind` : ''}.*`);
                report.push('Reply with `.update` to apply it.');
            }

            await sock.sendMessage(chatId, { text: report.join('\n') }, { quoted: message });
        } catch (e) {
            await sock.sendMessage(chatId, { text: `⚠️ Could not check remote updates: ${e.message}` }, { quoted: message });
        }
        return;
    }

    try {
        await sock.sendMessage(chatId, { text: '🔄 Updating Osunhive Chatbot, please wait…' }, { quoted: message });
        
        let updateSummary = '';
        if (await hasGitRepo()) {
            const { oldRev, newRev, alreadyUpToDate, commits } = await updateViaGit();
            updateSummary = alreadyUpToDate ? `✅ Already on latest commit: ${newRev.substring(0, 7)}` : `✅ Updated to commit ${newRev.substring(0, 7)}`;
        } else {
            const { copiedFiles } = await updateViaZip(sock, chatId, message, zipOverride);
            updateSummary = `✅ Successfully synchronized ${copiedFiles.length} files from repository.`;
        }

        // Install dependencies using available package manager
        const pm = await getPackageManager();
        if (pm) {
            try {
                await run(`${pm} install`);
            } catch (instErr) {
                console.warn(`[update] ${pm} install warning:`, instErr.message);
            }
        }

        let currentVersion = '2.0.0';
        try {
            delete require.cache[require.resolve('../settings')];
            const freshSettings = require('../settings');
            currentVersion = freshSettings.version || currentVersion;
        } catch {}

        await sock.sendMessage(chatId, {
            text: `🎉 *Osunhive Chatbot Updated!*\n\n${updateSummary}\n• *Version:* ${currentVersion}\n• *Status:* Restarting process now…`
        }, { quoted: message });

        await restartProcess(sock, chatId, message);
    } catch (err) {
        console.error('Update failed:', err);
        await sock.sendMessage(chatId, { text: `❌ Update failed:\n${String(err.message || err)}` }, { quoted: message });
    }
}

module.exports = updateCommand;
module.exports.extractZip = extractZip;
module.exports.extractZipNode = extractZipNode;
module.exports.buildRelaunchCommand = buildRelaunchCommand;
module.exports.relaunchDetached = relaunchDetached;
