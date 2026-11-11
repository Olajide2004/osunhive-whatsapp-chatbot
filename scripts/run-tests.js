#!/usr/bin/env node
/**
 * Osunhive Chatbot — offline test runner.
 *
 * Runs every suite that needs no network, no WhatsApp session and no API keys.
 * (test-chatgpt-android.js is intentionally excluded: it talks to the live
 * ChatGPT Android endpoint.)
 *
 *   node scripts/run-tests.js            run all offline suites
 *   node scripts/run-tests.js --list     list them
 *   node scripts/run-tests.js cdn cdn    run suites matching "cdn"
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SUITES = [
    'test-autopoststatus.js',
    'test-cdn.js',
    'test-meta-style.js',
    'test-autoreply-format.js',
    'test-update-zip.js',
    'test-antidelete.js',
    'test-disclaimer.js',
    'test-celebrate.js',
    'test-menu-buttons.js',
    'test-polls.js',
    'test-scheduler.js'
];

const args = process.argv.slice(2);
if (args.includes('--list')) {
    console.log(SUITES.join('\n'));
    process.exit(0);
}

const filters = args.filter((a) => !a.startsWith('-')).map((a) => a.toLowerCase());
const selected = filters.length
    ? SUITES.filter((s) => filters.some((f) => s.toLowerCase().includes(f)))
    : SUITES;

if (!selected.length) {
    console.error(`No suites matched: ${filters.join(', ')}`);
    process.exit(1);
}

let passed = 0;
const failed = [];

for (const suite of selected) {
    const started = Date.now();
    process.stdout.write(`\n▶ ${suite}\n`);
    const result = spawnSync(process.execPath, [suite], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, CI: '1' }
    });
    const ms = Date.now() - started;
    if (result.status === 0) {
        passed++;
        console.log(`✅ ${suite} (${ms} ms)`);
    } else {
        failed.push(suite);
        console.error(`❌ ${suite} (exit ${result.status ?? 'signal'} , ${ms} ms)`);
    }
}

console.log('\n' + '─'.repeat(50));
console.log(`Suites: ${selected.length} · passed: ${passed} · failed: ${failed.length}`);
if (failed.length) {
    console.log('Failed:', failed.join(', '));
    process.exit(1);
}