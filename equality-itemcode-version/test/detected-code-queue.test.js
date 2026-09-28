'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDetectedCodeQueue } = require('../detected-code-queue');

test('YouTube Live Chat codes jump ahead of pending OCR codes', async () => {
    const started = [];
    let releaseActive;
    const activeGate = new Promise(resolve => { releaseActive = resolve; });
    const queue = createDetectedCodeQueue(async code => {
        started.push(code);
        if (code === 'ACTIVE') await activeGate;
    });

    const active = queue.enqueue(['ACTIVE'], 'OCR');
    const ocr = queue.enqueue(['OCR-A', 'OCR-B'], 'OCR');
    const chat = queue.enqueue(['CHAT-A'], 'YouTube Chat');
    releaseActive();

    await Promise.all([active, ocr, chat]);
    assert.deepEqual(started, ['ACTIVE', 'CHAT-A', 'OCR-A', 'OCR-B']);
});

test('preserves FIFO order among queued YouTube Live Chat codes', async () => {
    const started = [];
    let releaseActive;
    const activeGate = new Promise(resolve => { releaseActive = resolve; });
    const queue = createDetectedCodeQueue(async code => {
        started.push(code);
        if (code === 'ACTIVE') await activeGate;
    });

    const active = queue.enqueue(['ACTIVE'], 'OCR');
    const chatFirst = queue.enqueue(['CHAT-1'], 'YouTube Chat');
    const chatSecond = queue.enqueue(['CHAT-2'], 'YouTube Chat');
    releaseActive();

    await Promise.all([active, chatFirst, chatSecond]);
    assert.deepEqual(started, ['ACTIVE', 'CHAT-1', 'CHAT-2']);
});
