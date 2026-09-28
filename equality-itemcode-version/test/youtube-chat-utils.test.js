'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractCodes } = require('../ocr-code-utils');
const { parseYoutubeChatTarget, youtubeChatMessageText } = require('../youtube-chat-utils');

test('parses watch, short-link, live, and shorts URLs into live chat targets', () => {
    assert.deepEqual(
        parseYoutubeChatTarget('https://www.youtube.com/watch?v=7RDxTmDU5WA'),
        { liveId: '7RDxTmDU5WA' }
    );
    assert.deepEqual(parseYoutubeChatTarget('https://youtu.be/7RDxTmDU5WA'), { liveId: '7RDxTmDU5WA' });
    assert.deepEqual(parseYoutubeChatTarget('https://www.youtube.com/live/7RDxTmDU5WA'), { liveId: '7RDxTmDU5WA' });
    assert.deepEqual(parseYoutubeChatTarget('https://www.youtube.com/shorts/7RDxTmDU5WA'), { liveId: '7RDxTmDU5WA' });
});

test('parses channel handles and channel IDs', () => {
    assert.deepEqual(parseYoutubeChatTarget('https://www.youtube.com/@thehof.talesrunner'), {
        handle: '@thehof.talesrunner'
    });
    assert.deepEqual(parseYoutubeChatTarget('https://www.youtube.com/channel/UC1234567890123456789012'), {
        channelId: 'UC1234567890123456789012'
    });
});

test('rejects malformed and non-YouTube targets', () => {
    assert.equal(parseYoutubeChatTarget('not-a-video-url'), null);
    assert.equal(parseYoutubeChatTarget('https://example.com/watch?v=7RDxTmDU5WA'), null);
    assert.equal(parseYoutubeChatTarget('https://www.youtube.com/watch?v=short'), null);
});

test('flattens chat text and emojis and uses the same ItemCode extractor as OCR', () => {
    const message = youtubeChatMessageText({
        message: [{ text: 'พบโค้ด ' }, { text: 'MANA5H7N4K9Z' }, { emojiText: ' ✨ ' }]
    });
    assert.equal(message, 'พบโค้ด MANA5H7N4K9Z ✨');
    assert.deepEqual(extractCodes([message]), ['MANA5H7N4K9Z']);
});

test('keeps Thai digit normalization for YouTube chat messages', () => {
    const message = youtubeChatMessageText({ message: [{ text: 'MANA๕H๗N๔K๙Z' }] });
    assert.deepEqual(extractCodes([message]), ['MANA5H7N4K9Z']);
});
