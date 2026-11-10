/**
 * Offline test for the scheduler's pure parsing/formatting helpers.
 * Run: node test-scheduler.js
 */

const assert = require('assert');
const {
    parseSchedule,
    renderTask
} = require('./lib/scheduler');

function run() {
    // --- parsing: intervals ---
    assert.deepStrictEqual(parseSchedule('every 30m'), { mode: 'every', intervalMinutes: 30 });
    assert.deepStrictEqual(parseSchedule('every 30 min'), { mode: 'every', intervalMinutes: 30 });
    assert.deepStrictEqual(parseSchedule('every 2h'), { mode: 'every', intervalMinutes: 120 });
    assert.deepStrictEqual(parseSchedule('every 1 hour'), { mode: 'every', intervalMinutes: 60 });
    assert.deepStrictEqual(parseSchedule('every 1d'), { mode: 'every', intervalMinutes: 1440 });
    assert.deepStrictEqual(parseSchedule('hourly'), { mode: 'every', intervalMinutes: 60 });

    // --- parsing: daily ---
    assert.deepStrictEqual(parseSchedule('daily 08:30'), { mode: 'daily', timeOfDay: '08:30' });
    assert.deepStrictEqual(parseSchedule('daily at 23:59'), { mode: 'daily', timeOfDay: '23:59' });
    assert.deepStrictEqual(parseSchedule('08:30'), { mode: 'daily', timeOfDay: '08:30' });
    // invalid times clamp instead of crashing
    assert.strictEqual(parseSchedule('daily 25:99').timeOfDay, '23:59');

    // --- parse failures ---
    assert.strictEqual(parseSchedule('every'), null);
    assert.strictEqual(parseSchedule('later today'), null);
    assert.strictEqual(parseSchedule('every 0m'), null);
    assert.strictEqual(parseSchedule('every -5 minutes'), null);

    // --- rendering ---
    const task = {
        id: 'abcdef',
        action: 'text',
        enabled: true,
        runCount: 3,
        schedule: { mode: 'every', intervalMinutes: 120 },
        text: 'Ping'
    };
    assert.ok(renderTask(task).includes('abcdef'));
    assert.ok(renderTask(task).includes('[text]'));
    assert.ok(renderTask(task).includes('every 2h'));
    assert.ok(renderTask(task).includes('3 run(s)'));
    assert.ok(/on/i.test(renderTask(task)));

    const daily = {
        id: 'abc',
        action: 'voice',
        enabled: false,
        runCount: 0,
        schedule: { mode: 'daily', timeOfDay: '09:00' },
        text: 'Wake up'
    };
    assert.ok(renderTask(daily).includes('daily at 09:00'));
    assert.ok(renderTask(daily).includes('[voice]'));
    console.log('\n✅ scheduler tests passed');
}

run();
