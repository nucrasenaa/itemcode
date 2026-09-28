'use strict';

function createDetectedCodeQueue(processCode) {
    if (typeof processCode !== 'function') {
        throw new TypeError('processCode must be a function');
    }

    const pending = [];
    let processing = false;
    let sequence = 0;

    async function drain() {
        if (processing) return;
        processing = true;
        try {
            while (pending.length > 0) {
                pending.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
                const item = pending.shift();
                try {
                    item.resolve(await processCode(item.code, item.source));
                } catch (error) {
                    item.reject(error);
                }
            }
        } finally {
            processing = false;
            if (pending.length > 0) void drain();
        }
    }

    function enqueue(codes, source = 'OCR') {
        const uniqueCodes = [...new Set(Array.isArray(codes) ? codes : [])];
        if (uniqueCodes.length === 0) return Promise.resolve({ success: true });

        const priority = source === 'YouTube Chat' ? 0 : 1;
        const tasks = uniqueCodes.map(code => new Promise((resolve, reject) => {
            pending.push({ code, source, priority, sequence: sequence++, resolve, reject });
        }));
        void drain();
        return Promise.all(tasks).then(() => ({ success: true }));
    }

    return { enqueue };
}

module.exports = { createDetectedCodeQueue };
