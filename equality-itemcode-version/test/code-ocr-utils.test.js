'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractCodes } = require('../ocr-code-utils');

test('prefers a 12-character ItemCode over unrelated screen text', () => {
    assert.deepEqual(extractCodes([
        'www.P2WTOPUP.co',
        'WATT2T6F9L3N',
        'COMING SOON'
    ]), ['WATT2T6F9L3N']);
});

test('normalizes OCR I/ S to digits 1/5 after the four-letter code prefix', () => {
    assert.deepEqual(extractCodes(['RANKIN7BST6M']), ['RANK1N7B5T6M']);
});

test('joins OCR-inserted spaces inside a code', () => {
    assert.deepEqual(extractCodes(['RANK 1 N7B5T6M']), ['RANK1N7B5T6M']);
});

test('uses agreement across OCR passes to reject code-like website text', () => {
    assert.deepEqual(extractCodes([
        { text: 'www.P2WTOPUP.oo', pass: 0 },
        { text: 'WATT2T6F9L3N', pass: 0 },
        { text: 'www.P2WTOPW.oo', pass: 1 },
        { text: 'II WATT2T6F9L3N', pass: 1 }
    ]), ['WATT2T6F9L3N']);
});
