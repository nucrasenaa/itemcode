const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMacOcrRunner } = require('../mac-ocr-runner');

test('Mac OCR keeps accurate mode when it succeeds, including empty images', async () => {
    const calls = [];
    const run = createMacOcrRunner({ execute: async (...args) => {
        calls.push(args);
        return { stdout: calls.length === 1 ? 'CODE12345678\r\n\n' : '' };
    } });
    assert.deepEqual(await run('/helper', '/image with spaces.png'), ['CODE12345678']);
    assert.deepEqual(await run('/helper', '/blank.png'), []);
    assert.deepEqual(calls[0][1], ['/image with spaces.png']);
    assert.equal(calls[1][1].length, 1);
});

test('Mac OCR retries the same frame in Fast mode on timeout and remembers fallback', async () => {
    const calls = [];
    const messages = [];
    const run = createMacOcrRunner({ log: message => messages.push(message), execute: async (binary, args, options) => {
        calls.push(args);
        assert.equal(options.timeout, 10000);
        assert.equal(options.killSignal, 'SIGKILL');
        if (calls.length === 1) throw Object.assign(new Error('timeout'), { killed: true, signal: 'SIGKILL' });
        return { stdout: 'TEXT\n' };
    } });
    assert.deepEqual(await run('/helper', '/frame.png'), ['TEXT']);
    await run('/helper', '/next.png');
    assert.deepEqual(calls, [['/frame.png'], ['/frame.png', '--fast'], ['/next.png', '--fast']]);
    assert.ok(messages.some(message => message.includes('timeout=true')));
});

test('Mac OCR reports execution errors rather than pretending no text was found', async () => {
    const run = createMacOcrRunner({ execute: async () => { throw Object.assign(new Error('missing binary'), { code: 'ENOENT' }); } });
    await assert.rejects(run('/missing', '/frame.png'), /missing binary/);
});

test('Mac OCR propagates failed fallback without retrying indefinitely', async () => {
    let calls = 0;
    const run = createMacOcrRunner({ execute: async () => {
        calls += 1;
        throw Object.assign(new Error('timeout'), { killed: true, signal: 'SIGKILL' });
    } });
    await assert.rejects(run('/helper', '/frame.png'), /timeout/);
    assert.equal(calls, 2);
});
