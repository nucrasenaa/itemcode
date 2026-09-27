'use strict';

const THAI_DIGIT_MAP = Object.freeze({
    '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4',
    '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9'
});

function normalizeThaiDigits(text) {
    return String(text || '').replace(/[๐-๙]/g, digit => THAI_DIGIT_MAP[digit] || digit);
}

function extractCodes(lines, pattern = "\\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{8,24}\\b") {
    const codes = [];
    const likelyItemCodePasses = new Map();
    const regex = new RegExp(pattern, 'gi');

    for (const entry of lines || []) {
        const line = String(entry && typeof entry === 'object' ? entry.text || '' : entry || '');
        const pass = entry && typeof entry === 'object' && entry.pass !== undefined
            ? String(entry.pass)
            : 'single';
        let targetText = line;
        if (line.includes(':')) {
            const parts = line.split(':');
            const beforeColon = parts[0].trim();
            if (!beforeColon.toLowerCase().startsWith('code') && !/^\d+$/.test(beforeColon)) {
                targetText = parts.slice(1).join(':');
            }
        }
        targetText = targetText.replace(/@\w+/g, '');
        // Avoid joining URL punctuation into a code-like run (e.g.
        // "www.P2WTOPUP.oo" becoming "WWWP2WTOPWOO").
        targetText = targetText.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ');

        const uppercaseText = normalizeThaiDigits(targetText.normalize('NFKC')).toUpperCase();
        const joinedText = uppercaseText.replace(/(?<=[A-Z0-9])[\s._|·-]+(?=[A-Z0-9])/g, '');
        for (const textToMatch of joinedText === uppercaseText ? [uppercaseText] : [uppercaseText, joinedText]) {
            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(textToMatch)) !== null) {
                const code = match[0].replace(/[\s._|·-]+/g, '').trim();
                if (code && !codes.includes(code)) codes.push(code);
                if (/^[A-Z]{4}[A-Z0-9]{8}$/.test(code) && /\d/.test(code)) {
                    const canonical = code.slice(0, 4) + code.slice(4).replace(/[IS]/g, char => char === 'I' ? '1' : '5');
                    if (!likelyItemCodePasses.has(canonical)) likelyItemCodePasses.set(canonical, new Set());
                    likelyItemCodePasses.get(canonical).add(pass);
                }
            }
        }
    }

    // Prefer 4-letter-prefix 12-character codes confirmed by multiple OCR
    // passes; this suppresses screen text that accidentally resembles a code.
    if (likelyItemCodePasses.size > 0) {
        const bestScore = Math.max(...[...likelyItemCodePasses.values()].map(passes => passes.size));
        return [...likelyItemCodePasses.entries()]
            .filter(([, passes]) => passes.size === bestScore)
            .map(([code]) => code);
    }
    return codes;
}

module.exports = { extractCodes, normalizeThaiDigits };
