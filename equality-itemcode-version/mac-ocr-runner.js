'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

function createMacOcrRunner({ execute = promisify(execFile), log = () => {} } = {}) {
    let fastMode = false;
    const timeout = 10000;
    async function run(binary, imagePath, fast) {
        const args = fast ? [imagePath, '--fast'] : [imagePath];
        const { stdout } = await execute(binary, args, { timeout, killSignal: 'SIGKILL' });
        return stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    }
    return async (binary, imagePath) => {
        try {
            return await run(binary, imagePath, fastMode);
        } catch (error) {
            const detail = String(error.stderr || error.stdout || error.message || '').replace(/\s+/g, ' ').slice(0, 1000);
            const timedOut = error.killed && error.signal === 'SIGKILL';
            log(`[-] macOS OCR failed (mode=${fastMode ? 'fast' : 'accurate'}, timeout=${Boolean(timedOut)}, code=${error.code ?? '-'}, signal=${error.signal || '-'}): ${detail}`);
            if (!fastMode && timedOut) {
                log('[OCR] โหมดละเอียดเกินเวลา 10 วินาที เปลี่ยนเป็น Fast สำหรับรอบการทำงานนี้ (ความแม่นยำอาจลดลง)');
                fastMode = true;
                return run(binary, imagePath, true);
            }
            throw error;
        }
    };
}

module.exports = { createMacOcrRunner };
