#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SERVICE_DIR = __dirname;
const CORPUS_FILE = path.join(SERVICE_DIR, "..", "codes_only.txt");
const ITEMCODE_FILE = path.join(SERVICE_DIR, "itemcode.json");
const LOG_FILE = path.join(SERVICE_DIR, "log.json");
const SESSION_FILE = path.join(SERVICE_DIR, ".session_config.json");

const DEFAULT_API_BASE_URL = process.env.ITEMCODE_API_BASE_URL || "https://core-api.thehof.gg";
const DEFAULT_GAME_ID = process.env.ITEMCODE_GAME_ID || "ece25107-ec4f-4c83-9f2b-38afd0e77cc2";
const MEMBER_DOMAIN = "member.thehof.gg";

const FAMILY_LABELS = {
    letters: "letters only",
    one: "one numeric block (1 digit)",
    two: "one numeric block (2 digits)",
    three: "one numeric block (3 digits)",
    multi: "multiple numeric blocks"
};

let stopping = false;

function log(message) {
    const timestamp = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
    console.log(`[${timestamp}] ${message}`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message) {
    console.error(`[ERROR] ${message}`);
    process.exitCode = 1;
}

function readJsonArray(filePath) {
    try {
        if (!fs.existsSync(filePath)) return [];
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
        return parsed;
    } catch (error) {
        throw new Error(`${filePath}: ${error.message}`);
    }
}

function writeJsonAtomic(filePath, value) {
    const temporaryPath = `${filePath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, filePath);
}

function loadCorpus() {
    if (!fs.existsSync(CORPUS_FILE)) {
        throw new Error(`ไม่พบ corpus: ${CORPUS_FILE}`);
    }
    const codes = fs.readFileSync(CORPUS_FILE, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim().toUpperCase())
        .filter((code) => /^[A-Z0-9]+$/.test(code));
    return [...new Set(codes)];
}

function codeRuns(code) {
    const runs = [];
    for (const char of code.toUpperCase()) {
        const kind = /\d/.test(char) ? "D" : "L";
        if (runs.length > 0 && runs[runs.length - 1].kind === kind) {
            runs[runs.length - 1].length += 1;
        } else {
            runs.push({ kind, length: 1 });
        }
    }
    return runs;
}

function familyFor(code) {
    const numericBlocks = code.match(/\d+/g) || [];
    if (numericBlocks.length === 0) return "letters";
    if (numericBlocks.length === 1) {
        return { 1: "one", 2: "two", 3: "three" }[numericBlocks[0].length] || "multi";
    }
    return "multi";
}

function buildTemplates(corpus) {
    const templates = {
        letters: [],
        one: [],
        two: [],
        three: [],
        multi: []
    };
    for (const code of corpus) {
        const family = familyFor(code);
        const runs = codeRuns(code);
        const signature = runs.map((run) => `${run.kind}${run.length}`).join("");
        if (!templates[family].some((item) => item.signature === signature)) {
            templates[family].push({ signature, runs });
        }
    }
    return templates;
}

function buildLetterBank(corpus) {
    const bank = {};
    for (const code of corpus) {
        for (const match of code.matchAll(/[A-Z]+/g)) {
            const fragment = match[0];
            const length = fragment.length;
            if (!bank[length]) bank[length] = [];
            if (!bank[length].includes(fragment)) bank[length].push(fragment);
        }
    }
    return bank;
}

function randomInt(max) {
    return crypto.randomInt(0, max);
}

function randomLetters(length, bank, useBank = true) {
    if (useBank && bank[length] && bank[length].length > 0) {
        return bank[length][randomInt(bank[length].length)];
    }
    let result = "";
    for (let index = 0; index < length; index += 1) {
        result += String.fromCharCode(65 + randomInt(26));
    }
    return result;
}

function randomDigits(length) {
    let result = "";
    for (let index = 0; index < length; index += 1) {
        result += String(randomInt(10));
    }
    return result;
}

function renderTemplate(template, bank, family) {
    return template.runs.map((run) => {
        if (run.kind === "D") return randomDigits(run.length);
        return randomLetters(run.length, bank, family !== "letters");
    }).join("");
}

class CandidateGenerator {
    constructor(corpus, generated) {
        this.templates = buildTemplates(corpus);
        this.bank = buildLetterBank(corpus);
        this.seen = new Set([...corpus, ...generated].map((code) => String(code).toUpperCase()));
    }

    next(family) {
        const families = family === "all" ? Object.keys(FAMILY_LABELS) : [family];
        const available = families.filter((name) => this.templates[name] && this.templates[name].length > 0);
        if (available.length === 0) throw new Error(`ไม่พบ template สำหรับ pattern: ${family}`);

        for (let attempt = 0; attempt < 10000; attempt += 1) {
            const selectedFamily = available[randomInt(available.length)];
            const template = this.templates[selectedFamily][randomInt(this.templates[selectedFamily].length)];
            const candidate = renderTemplate(template, this.bank, selectedFamily);
            if (!this.seen.has(candidate)) {
                this.seen.add(candidate);
                return { code: candidate, family: selectedFamily, template: template.signature };
            }
        }
        throw new Error("สุ่ม candidate ใหม่ไม่สำเร็จภายในจำนวนครั้งที่กำหนด");
    }
}

function parseArgs(argv) {
    const args = {
        apiBaseUrl: DEFAULT_API_BASE_URL,
        gameId: DEFAULT_GAME_ID,
        pattern: "all",
        count: null,
        delayMs: 1500,
        rateLimitDelayMs: 120000,
        token: null,
        dryRun: false,
        showPatterns: false
    };

    const requireValue = (index, name) => {
        if (!argv[index + 1] || argv[index + 1].startsWith("--")) {
            throw new Error(`${name} ต้องมีค่า`);
        }
        return argv[index + 1];
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--set-token" || arg === "--token") {
            args.token = requireValue(index, arg).replace(/^Bearer\s+/i, "").trim();
            index += 1;
        } else if (arg === "--pattern") {
            args.pattern = requireValue(index, arg).toLowerCase();
            index += 1;
        } else if (arg === "--count") {
            args.count = Number.parseInt(requireValue(index, arg), 10);
            index += 1;
        } else if (arg === "--delay-ms") {
            args.delayMs = Number.parseInt(requireValue(index, arg), 10);
            index += 1;
        } else if (arg === "--rate-limit-delay-ms") {
            args.rateLimitDelayMs = Number.parseInt(requireValue(index, arg), 10);
            index += 1;
        } else if (arg === "--api-base-url") {
            args.apiBaseUrl = requireValue(index, arg).replace(/\/$/, "");
            index += 1;
        } else if (arg === "--game-id") {
            args.gameId = requireValue(index, arg);
            index += 1;
        } else if (arg === "--dry-run") {
            args.dryRun = true;
        } else if (arg === "--show-patterns") {
            args.showPatterns = true;
        } else if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`ไม่รู้จัก argument: ${arg}`);
        }
    }

    if (!Object.prototype.hasOwnProperty.call(FAMILY_LABELS, args.pattern) && args.pattern !== "all") {
        throw new Error(`pattern ต้องเป็น all, letters, one, two, three หรือ multi`);
    }
    if (args.count !== null && (!Number.isInteger(args.count) || args.count < 1)) {
        throw new Error("--count ต้องเป็นจำนวนเต็มอย่างน้อย 1");
    }
    if (!Number.isInteger(args.delayMs) || args.delayMs < 0) {
        throw new Error("--delay-ms ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
    }
    if (!Number.isInteger(args.rateLimitDelayMs) || args.rateLimitDelayMs < 0) {
        throw new Error("--rate-limit-delay-ms ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
    }
    if (args.dryRun && args.count === null) args.count = 20;
    return args;
}

function printHelp() {
    console.log(`Usage:
  node index.js --set-token TOKEN [options]

Options:
  --pattern all|letters|one|two|three|multi  pattern ที่ใช้ (default: all)
  --count N                                  จำนวน code ต่อรอบ; ไม่ใส่ = ทำต่อเนื่อง
  --delay-ms N                               หน่วงระหว่าง request (default: 1500)
  --rate-limit-delay-ms N                    หน่วงเมื่อเจอ rate limit (default: 120000)
  --dry-run                                  สุ่มอย่างเดียว ไม่เรียก API และไม่เขียน log
  --show-patterns                            แสดงจำนวน template แล้วจบ
  --api-base-url URL                         เปลี่ยน API base URL สำหรับ fixture
  --game-id ID                               เปลี่ยน game id สำหรับ fixture
`);
}

function loadToken(cliToken) {
    if (cliToken) return cliToken;
    if (!fs.existsSync(SESSION_FILE)) return null;
    try {
        const session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
        return session.access_token || null;
    } catch (error) {
        throw new Error(`อ่าน ${SESSION_FILE} ไม่สำเร็จ: ${error.message}`);
    }
}

function saveToken(token, gameId) {
    writeJsonAtomic(SESSION_FILE, {
        access_token: token,
        game_id: gameId,
        saved_at: new Date().toISOString()
    });
}

function logTokenExpiration(token) {
    try {
        const payloadPart = token.split(".")[1];
        if (!payloadPart) return;
        const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
        if (typeof payload.exp !== "number") return;
        const date = new Date(payload.exp * 1000);
        log(`[TOKEN] หมดอายุ: ${date.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}`);
    } catch (_) {
        log("[TOKEN] อ่านวันหมดอายุไม่ได้ แต่จะลองใช้งานต่อ");
    }
}

function getLogCode(entry) {
    return typeof entry === "string" ? entry.toUpperCase() : String(entry && entry.code || "").toUpperCase();
}

function extractMessage(payload) {
    const candidates = [
        payload && payload.message,
        payload && payload.error,
        payload && payload.data && payload.data.message,
        payload && payload.data && payload.data.error
    ];
    return candidates.find((value) => typeof value === "string" && value.trim()) || "";
}

function extractDetail(payload) {
    const checkData = payload && payload.checkData ? payload.checkData : payload;
    const data = checkData && checkData.data !== undefined ? checkData.data : checkData;
    const reward = data && (data.reward || (data.data && data.data.reward));
    const bundle = reward && reward.bundle;
    if (bundle && bundle.name) {
        const itemNames = (bundle.items || [])
            .map((item) => item && item.item && item.item.name || item && item.name)
            .filter(Boolean);
        return itemNames.length > 0 ? itemNames.join(",") : String(bundle.name);
    }
    if (reward !== undefined) {
        return typeof reward === "string" ? reward : JSON.stringify(reward);
    }
    const message = extractMessage(payload);
    if (message) return message;
    return JSON.stringify(data || {});
}

function evaluateNodeCheckResponse(statusCode, payload) {
    // node_service uses checkSuccess (HTTP 200/201 from check-serial) as the
    // primary positive signal. Error text is kept separately for filtering
    // invalid-itemcode and handling wait/captcha responses.
    const checkSuccess = statusCode === 200 || statusCode === 201;
    const message = extractMessage(payload);
    const messageLower = message.toLowerCase();
    const isWaitError = messageLower.includes("please wait") ||
        messageLower.includes("captcha token field is required") ||
        messageLower.includes("captcha type is present");
    const invalidItemCode = messageLower.includes("invalid itemcode");
    const shouldNotify = checkSuccess || isWaitError;

    return {
        checkSuccess,
        isWaitError,
        invalidItemCode,
        shouldNotify,
        // A check-success response is the itemcode.json positive result.
        // Invalid-itemcode remains filtered even if an endpoint returns 2xx.
        usable: checkSuccess && !invalidItemCode,
        message
    };
}

async function responseJson(response) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (_) {
        return { raw: text };
    }
}

async function checkSerial({ token, serial, apiBaseUrl, gameId }) {
    const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Authorization": `Bearer ${token}`,
        "Origin": `https://${MEMBER_DOMAIN}`,
        "Referer": `https://${MEMBER_DOMAIN}/talesrunner/itemcode`
    };

    const pendingUrl = `${apiBaseUrl}/me/topup/games/${gameId}/orders/pending`;
    const checkUrl = `${apiBaseUrl}/me/games/${gameId}/itemcodes/check-serial`;

    try {
        // Same session warm-up request used by node_service before check-serial.
        const pending = await fetch(pendingUrl, { headers });
        if (pending.status === 401) {
            return { unauthorized: true, statusCode: 401, payload: {} };
        }
    } catch (error) {
        return { networkError: error, statusCode: 0, payload: {} };
    }

    try {
        const response = await fetch(checkUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({ serial: serial.toUpperCase(), game_id: gameId })
        });
        const payload = await responseJson(response);
        const evaluation = evaluateNodeCheckResponse(response.status, payload);
        const retryAfter = Number.parseInt(response.headers.get("retry-after") || "", 10);
        const rateLimited = response.status === 429 || evaluation.isWaitError;
        return {
            unauthorized: response.status === 401,
            rateLimited,
            retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 0,
            statusCode: response.status,
            payload,
            ...evaluation
        };
    } catch (error) {
        return { networkError: error, statusCode: 0, payload: {} };
    }
}

function addPendingLog(logEntries, code, family, template) {
    const entry = {
        code,
        pattern: family,
        template,
        generatedAt: new Date().toISOString(),
        status: "generated"
    };
    logEntries.push(entry);
    writeJsonAtomic(LOG_FILE, logEntries);
    return entry;
}

function updateLogEntry(logEntry, result) {
    logEntry.checkedAt = new Date().toISOString();
    logEntry.status = result.usable ? "usable" :
        result.invalidItemCode ? "invalid-itemcode" :
        result.unauthorized ? "unauthorized" :
        result.rateLimited ? "rate-limited" :
        result.networkError ? "network-error" : "invalid";
    if (typeof result.checkSuccess === "boolean") logEntry.checkSuccess = result.checkSuccess;
    if (typeof result.shouldNotify === "boolean") logEntry.shouldNotify = result.shouldNotify;
    if (typeof result.isWaitError === "boolean") logEntry.isWaitError = result.isWaitError;
    if (result.statusCode) logEntry.statusCode = result.statusCode;
    if (result.message) logEntry.error = result.message;
    if (result.payload && Object.keys(result.payload).length > 0) {
        logEntry.detail = extractDetail(result.payload);
    }
}

function addItemCode(itemCodes, code, detail) {
    const normalized = code.toUpperCase();
    if (itemCodes.some((item) => String(item.code || "").toUpperCase() === normalized)) return false;
    itemCodes.push({ code, detail });
    writeJsonAtomic(ITEMCODE_FILE, itemCodes);
    return true;
}

function printPatterns(corpus) {
    const templates = buildTemplates(corpus);
    for (const [family, label] of Object.entries(FAMILY_LABELS)) {
        console.log(`${family.padEnd(7)} ${label}: ${(templates[family] || []).length} templates`);
    }
}

async function run() {
    const args = parseArgs(process.argv.slice(2));
    const corpus = loadCorpus();

    if (args.showPatterns) {
        printPatterns(corpus);
        return;
    }

    if (args.dryRun) {
        const generator = new CandidateGenerator(corpus, []);
        for (let index = 0; index < args.count; index += 1) {
            const candidate = generator.next(args.pattern);
            console.log(`${candidate.code}\t${candidate.family}\t${candidate.template}`);
        }
        return;
    }

    const token = loadToken(args.token);
    if (!token) {
        throw new Error("ไม่พบ token: ใช้ node index.js --set-token TOKEN");
    }
    if (args.token) {
        saveToken(token, args.gameId);
        log("บันทึก session token แล้ว");
        logTokenExpiration(token);
    }

    const itemCodes = readJsonArray(ITEMCODE_FILE);
    const logEntries = readJsonArray(LOG_FILE);
    const generated = new Set(logEntries.map(getLogCode).filter(Boolean));
    const generator = new CandidateGenerator(corpus, generated);
    const limit = args.count;
    let generatedThisRun = 0;

    log(`เริ่ม gen/check: pattern=${args.pattern}, delay=${args.delayMs}ms`);
    log(`โหลด itemcode=${itemCodes.length}, log=${generated.size}`);
    if (limit === null) log("โหมดต่อเนื่อง: กด Ctrl+C เพื่อหยุด");

    while (!stopping && (limit === null || generatedThisRun < limit)) {
        const candidate = generator.next(args.pattern);
        const logEntry = addPendingLog(logEntries, candidate.code, candidate.family, candidate.template);
        generated.add(candidate.code);
        generatedThisRun += 1;
        log(`[GEN ${generatedThisRun}] ${candidate.code} (${candidate.family})`);

        const result = await checkSerial({
            token,
            serial: candidate.code,
            apiBaseUrl: args.apiBaseUrl,
            gameId: args.gameId
        });
        updateLogEntry(logEntry, result);
        writeJsonAtomic(LOG_FILE, logEntries);

        if (result.usable) {
            const detail = extractDetail(result.payload);
            addItemCode(itemCodes, candidate.code, detail);
            log(`[VALID] ${candidate.code} -> ${detail}`);
        } else if (result.unauthorized) {
            log(`[STOP] token ใช้งานไม่ได้หรือหมดอายุ (HTTP ${result.statusCode})`);
            break;
        } else if (result.rateLimited) {
            const waitMs = Math.max(args.rateLimitDelayMs, result.retryAfterMs || 0);
            log(`[WAIT] rate limit; รอ ${waitMs}ms`);
            await sleep(waitMs);
        } else if (result.networkError) {
            log(`[ERROR] network: ${result.networkError.message}`);
        } else {
            log(`[SKIP] ${candidate.code} ใช้ไม่ได้ (HTTP ${result.statusCode})`);
        }

        if (!stopping && (limit === null || generatedThisRun < limit)) {
            await sleep(args.delayMs);
        }
    }

    log(`จบการทำงาน: gen รอบนี้ ${generatedThisRun}, itemcode ที่ใช้ได้ ${itemCodes.length}`);
}

process.on("SIGINT", () => {
    stopping = true;
    log("กำลังหยุดหลังจบรอบปัจจุบัน...");
});

process.on("SIGTERM", () => {
    stopping = true;
    log("กำลังหยุดหลังจบรอบปัจจุบัน...");
});

run().catch((error) => {
    fail(error.message);
});
