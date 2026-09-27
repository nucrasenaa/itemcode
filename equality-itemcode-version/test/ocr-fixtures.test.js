'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { extractCodes } = require('../ocr-code-utils');

if (process.platform !== 'win32') {
    console.error('OCR fixture test requires Windows built-in OCR (WinRT).');
    process.exit(2);
}

const helper = path.join(__dirname, '..', 'ocr_helper.ps1');
const fixtures = [
    ['01-watt.jpg', 'WATT2T6F9L3N'],
    ['02-fame.jpg', 'FAME5C4Q8V3H'],
    ['03-rank.jpg', 'RANK1N7B5T6M']
];
const actualInOrder = [];

for (const [filename, expected] of fixtures) {
    const imagePath = path.join(__dirname, 'fixtures', filename);
    assert.ok(fs.existsSync(imagePath), `fixture exists: ${filename}`);

    const stdout = execFileSync('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', helper,
        imagePath
    ], { encoding: 'utf8', timeout: 30000 });
    let pass = 0;
    const recognizedLines = [];
    for (const rawLine of stdout.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const marker = line.match(/^__OCR_PASS_(\d+)__$/);
        if (marker) {
            pass = Number(marker[1]);
            continue;
        }
        recognizedLines.push({ text: line, pass });
    }
    const codes = extractCodes(recognizedLines);

    assert.deepEqual(codes, [expected], `${filename} should produce only the expected ItemCode`);
    actualInOrder.push(codes[0]);
    console.log(`PASS ${filename}: ${codes[0]}`);
}

assert.deepEqual(actualInOrder, [
    'WATT2T6F9L3N',
    'FAME5C4Q8V3H',
    'RANK1N7B5T6M'
]);
