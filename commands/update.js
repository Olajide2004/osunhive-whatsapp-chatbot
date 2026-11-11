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
    throw new Error('No unzip tool found (unzip/7z/busybox).');
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

async function restartProcess(sock, chatId, message) {
    try {
        await sock.sendMessage(chatId, { text: '✅ Update complete! Restarting Osunhive Chatbot…' }, { quoted: message });
    } catch {}
    try {
        await run('pm2 restart all');
        return;
    } catch {}
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
