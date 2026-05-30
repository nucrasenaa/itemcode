#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const util = require('util');
const crypto = require('crypto');

const execFileAsync = util.promisify(execFile);

// HOF OAuth PKCE Configuration constants
const PASSPORT_BASE_URL = "https://passport.thehof.gg";
const MEMBER_DOMAIN = "member.thehof.gg";
const API_BASE_URL = "https://core-api.thehof.gg";
const CLIENT_ID = "bcb3b4ce-67ad-11f0-9fe2-0242ac120002";
const REDIRECT_URI = "https://member.thehof.gg/oauth/callback";
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15';

// State variables
const TEMP_FRAME = path.join(__dirname, 'service_frame.png');
let config = {};
let history = new Set();
let isRunning = true;
let accessToken = null;
let currentLoggedInUser = null;
let lastPeriodicSleepTime = Date.now();

// Logger
function log(msg) {
    const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    console.log(`[${timestamp}] ${msg}`);
}

// Cookie Jar implementation to handle OAuth Session context manually
class CookieJar {
    constructor() {
        this.cookies = {};
    }
    update(setCookieHeaders) {
        if (!setCookieHeaders) return;
        const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
        for (const header of headers) {
            const clean = header.split(';')[0].trim();
            const parts = clean.split('=');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const val = parts.slice(1).join('=').trim();
                this.cookies[key] = val;
            }
        }
    }
    getCookieHeader() {
        return Object.entries(this.cookies)
            .map(([key, val]) => `${key}=${val}`)
            .join('; ');
    }
}

const isWindows = process.platform === 'win32';

// Expand path variables: ${HOMEDIR} → os.homedir(), %VAR% → process.env.VAR
function expandPathVars(str) {
    if (!str) return str;
    // ${HOMEDIR}
    str = str.replace(/\$\{HOMEDIR\}/g, os.homedir());
    // %VARNAME% — Windows environment variables
    str = str.replace(/%([^%]+)%/g, (_, varName) => {
        return process.env[varName] || process.env[varName.toUpperCase()] || `%${varName}%`;
    });
    return str;
}

function adjustPathsForOS() {
    const osSuffix = isWindows ? '_win' : '_mac';
    const fallbackSuffix = isWindows ? '_mac' : '_win';

    // Auto-select per-OS paths from config keys like ytdl_path_mac / ytdl_path_win
    for (const base of ['ytdl_path', 'ffmpeg_path', 'ocr_helper_path']) {
        const osKey   = `${base}${osSuffix}`;
        const fbKey   = `${base}${fallbackSuffix}`;
        if (config[osKey]) {
            config[base] = expandPathVars(config[osKey]);
        } else if (!config[base] && config[fbKey]) {
            // No generic key and no OS key — use the other OS as last resort
            config[base] = expandPathVars(config[fbKey]);
        }
    }

    const platform = isWindows ? 'Windows' : 'macOS';
    log(`[*] OS detected: ${platform}`);
    log(`[*]   yt-dlp     → ${config.ytdl_path}`);
    log(`[*]   ffmpeg     → ${config.ffmpeg_path}`);
    log(`[*]   ocr_helper → ${config.ocr_helper_path}`);
}


// Load Configuration
function loadConfig() {
    const configPath = path.join(__dirname, 'service_config.json');
    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf8');
            config = JSON.parse(data);
            if (!config.username) config.username = "";
            if (!config.password) config.password = "";
        } else {
            throw new Error('Config file not found');
        }
    } catch (e) {
        log(`[-] Error loading config: ${e.message}. Using defaults.`);
        config = {
            youtube_url: "https://www.youtube.com/@thehof.talesrunner",
            discord_webhook_url: "",
            discord_enabled: false,
            telegram_token: "",
            telegram_chat_id: "",
            telegram_enabled: false,
            scan_interval: 10.0,
            regex_pattern: "\\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{8,24}\\b",
            history_file: "ocr_history.json",
            ytdl_path: "/opt/homebrew/bin/yt-dlp",
            ffmpeg_path: "/opt/homebrew/bin/ffmpeg",
            ocr_helper_path: "./ocr_helper",
            username: "",
            password: "",
            game_id: "ece25107-ec4f-4c83-9f2b-38afd0e77cc2"
        };
    }
    adjustPathsForOS();
}

// Load History
function loadHistory() {
    const historyFile = config.history_file || 'ocr_history.json';
    try {
        if (fs.existsSync(historyFile)) {
            const data = fs.readFileSync(historyFile, 'utf8');
            const arr = JSON.parse(data);
            history = new Set(arr);
            log(`[+] Loaded ${history.size} items from history file: ${historyFile}`);
        } else {
            history = new Set();
            log(`[*] History file not found, starting fresh: ${historyFile}`);
        }
    } catch (e) {
        log(`[-] Error loading history: ${e.message}`);
        history = new Set();
    }
}

// Save History
function saveHistory() {
    const historyFile = config.history_file || 'ocr_history.json';
    try {
        fs.writeFileSync(historyFile, JSON.stringify(Array.from(history), null, 4), 'utf8');
    } catch (e) {
        log(`[-] Error saving history: ${e.message}`);
    }
}

// Log in via Username/Password and perform PKCE Token Exchange in Node.js
async function loginWithCredentials(username, password) {
    username = username || config.username || "";
    password = password || config.password || "";
    log(`[*] Node: กำลังเริ่มต้นกระบวนการล็อกอินผ่าน OAuth PKCE สำหรับผู้ใช้: ${username}...`);
    try {
        const cookieJar = new CookieJar();

        // 1. Generate PKCE values
        const codeVerifier = crypto.randomBytes(48).toString('base64url');
        const hash = crypto.createHash('sha256').update(codeVerifier).digest();
        const codeChallenge = hash.toString('base64url');
        const state = crypto.randomBytes(12).toString('base64url');

        // 2. GET /oauth/authorize → server stores OAuth session context → redirects to login page
        //    (This flow is confirmed working in Python tests with nucrasenaa)
        const authUrl = `${PASSPORT_BASE_URL}/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

        let currentUrl = authUrl;
        let currentAuthRes = await fetch(currentUrl, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'th,en-GB;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            redirect: 'manual'
        });
        cookieJar.update(currentAuthRes.headers.getSetCookie());

        // Follow the redirect chain until login page (status 200)
        let authHops = 0;
        while (currentAuthRes.status >= 300 && currentAuthRes.status < 400 && authHops < 10) {
            const location = currentAuthRes.headers.get('location');
            if (!location) break;
            currentUrl = location.startsWith('http') ? location : new URL(location, PASSPORT_BASE_URL).toString();
            currentAuthRes = await fetch(currentUrl, {
                method: 'GET',
                headers: {
                    'Cookie': cookieJar.getCookieHeader(),
                    'User-Agent': USER_AGENT,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                redirect: 'manual'
            });
            cookieJar.update(currentAuthRes.headers.getSetCookie());
            authHops++;
        }

        const html = await currentAuthRes.text();
        const loginPageUrl = currentUrl;
        log(`[DEBUG] Login page status: ${currentAuthRes.status}, URL: ${loginPageUrl.substring(0, 80)}`);

        // 3. Extract CSRF token (_token hidden field)
        let csrfToken = null;
        const csrfMatch = html.match(/name="_token"\s+value="([^"]+)"/) || html.match(/name="csrf-token"\s+content="([^"]+)"/);
        if (csrfMatch) csrfToken = csrfMatch[1];
        log(`[DEBUG] CSRF token: ${csrfToken ? csrfToken.substring(0, 15) + '...' : 'NOT FOUND'}`);

        // 4. Extract form action
        let loginAction = `${PASSPORT_BASE_URL}/hall-of-fame-web/login`;
        const formMatch = html.match(/<form[^>]*action=["']([^"']+)["']/i);
        if (formMatch) loginAction = formMatch[1];
        log(`[DEBUG] Form action: ${loginAction}`);

        if (!csrfToken) {
            log(`[-] Node: ไม่พบ CSRF token ในหน้า login`);
            return false;
        }

        // 5. POST credentials (headers confirmed working in Python test)
        const bodyParams = new URLSearchParams();
        bodyParams.append('username', username);
        bodyParams.append('password', password);
        bodyParams.append('_token', csrfToken);

        const loginRes = await fetch(loginAction, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': cookieJar.getCookieHeader(),
                'User-Agent': USER_AGENT,
                'Origin': PASSPORT_BASE_URL,
                'Referer': loginPageUrl,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'th,en-GB;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            body: bodyParams.toString(),
            redirect: 'manual'
        });
        cookieJar.update(loginRes.headers.getSetCookie());
        log(`[DEBUG] POST login: ${loginRes.status}, loc: ${loginRes.headers.get('location')?.substring(0, 80)}`);

        // 6. Follow redirects manually — looking for oauth/callback?code=
        let loginFollowRes = loginRes;
        let finalUrl = loginAction;
        let loginHops = 0;

        while (loginFollowRes.status >= 300 && loginFollowRes.status < 400 && loginHops < 10) {
            const location = loginFollowRes.headers.get('location');
            if (!location) break;

            finalUrl = location.startsWith('http') ? location : new URL(location, PASSPORT_BASE_URL).toString();
            log(`[DEBUG] Login redirect hop ${loginHops + 1}: ${finalUrl.substring(0, 80)}`);

            // If we've reached the member callback with ?code=, stop here
            if (finalUrl.includes('oauth/callback') && finalUrl.includes('code=')) {
                log(`[DEBUG] Reached OAuth callback URL with code!`);
                break;
            }

            loginFollowRes = await fetch(finalUrl, {
                method: 'GET',
                headers: {
                    'Cookie': cookieJar.getCookieHeader(),
                    'User-Agent': USER_AGENT,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Referer': PASSPORT_BASE_URL
                },
                redirect: 'manual'
            });
            cookieJar.update(loginFollowRes.headers.getSetCookie());
            loginHops++;
        }

        // Extract auth code from the final callback URL
        const finalUrlObj = new URL(finalUrl);
        const authCode = finalUrlObj.searchParams.get('code');
        const returnedState = finalUrlObj.searchParams.get('state');

        if (authCode) {
            log(`[+] Node: เข้าสู่ระบบสำเร็จ! ตรวจพบ Auth Code: ${authCode.substring(0, 15)}...`);
            const ok = await exchangeCodeWithVerifier(authCode, codeVerifier);
            if (ok) {
                currentLoggedInUser = username;
                return true;
            }
            return false;
        } else {
            log(`[-] Node: เข้าสู่ระบบล้มเหลว หรือไม่พบ Auth Code ใน URL เปลี่ยนเส้นทาง: ${finalUrl}`);
            return false;
        }
    } catch (e) {
        log(`[-] Node: เกิดข้อผิดพลาดระหว่างล็อกอิน: ${e.message}`);
        return false;
    }
}

// Exchange auth code with verifier for a Bearer Access Token
async function exchangeCodeWithVerifier(authCode, codeVerifier) {
    const tokenUrl = `${PASSPORT_BASE_URL}/oauth/token`;

    const formData = new FormData();
    formData.append('grant_type', 'authorization_code');
    formData.append('client_id', CLIENT_ID);
    formData.append('redirect_uri', REDIRECT_URI);
    formData.append('code_verifier', codeVerifier.trim());
    formData.append('code', authCode.trim());

    try {
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Accept': '*/*',
                'Origin': `https://${MEMBER_DOMAIN}`
            },
            body: formData
        });

        if (response.ok) {
            const resData = await response.json();
            accessToken = resData.access_token;
            if (accessToken) {
                log(`[+] Node: ได้รับ Access Token เรียบร้อย! (${accessToken.substring(0, 15)}...)`);
                return true;
            } else {
                log(`[-] Node: การแลกเปลี่ยนสำเร็จแต่ไม่มี access_token ในระบบ`);
            }
        } else {
            const errText = await response.text();
            log(`[-] Node: แลก Token ล้มเหลว (HTTP ${response.status}): ${errText}`);
        }
    } catch (e) {
        log(`[-] Node: เกิดข้อผิดพลาดตอนแลก Token: ${e.message}`);
    }
    return false;
}

function generateCodeVariations(code, maxVariations = 64) {
    code = code.trim().toUpperCase();
    if (!code) return [];

    const charVariations = {
        '1': ['1', 'I'],
        'I': ['I', '1'],
        '0': ['0', 'O', 'D'],
        'O': ['O', '0', 'D'],
        'D': ['D', '0', 'O'],
        '8': ['8', 'B'],
        'B': ['B', '8'],
        '5': ['5', 'S'],
        'S': ['S', '1S', 'IS', '5'],
        '2': ['2', 'Z'],
        'Z': ['Z', '2'],
        '6': ['6', 'G'],
        'G': ['G', '6'],
        '7': ['7', 'T'],
        'T': ['T', '7'],
        'U': ['U', 'V'],
        'V': ['V', 'U'],
        'A': ['A', '4'],
        '4': ['4', 'A']
    };

    // Find variable indices and limit to the first 6 to keep product size small (max 4^6 = 4096)
    const variableIndices = [];
    for (let i = 0; i < code.length; i++) {
        if (charVariations[code[i]]) {
            variableIndices.push(i);
        }
    }
    const allowedIndices = new Set(variableIndices.slice(0, 6));

    const choices = [];
    for (let i = 0; i < code.length; i++) {
        const char = code[i];
        if (charVariations[char] && allowedIndices.has(i)) {
            const options = [{ char: char, cost: 0 }];
            for (const alt of charVariations[char]) {
                if (alt !== char) {
                    options.push({ char: alt, cost: 1 });
                }
            }
            choices.push(options);
        } else {
            choices.push([{ char: char, cost: 0 }]);
        }
    }

    // Cartesian product helper with cost scoring
    function cartesianProduct(arrays) {
        return arrays.reduce((acc, curr) => {
            const res = [];
            for (const a of acc) {
                for (const b of curr) {
                    res.push({
                        str: a.str + b.char,
                        cost: a.cost + b.cost
                    });
                }
            }
            return res;
        }, [{ str: '', cost: 0 }]);
    }

    const combos = cartesianProduct(choices);

    // Sort by cost (lower cost first = fewer changes first)
    combos.sort((a, b) => a.cost - b.cost);

    // Extract unique strings
    const seen = new Set();
    const uniqueVariations = [];
    for (const item of combos) {
        if (!seen.has(item.str)) {
            seen.add(item.str);
            uniqueVariations.push(item.str);
            if (uniqueVariations.length >= maxVariations) {
                break;
            }
        }
    }

    return uniqueVariations;
}

// Redeem Itemcode using HOF API
async function redeemCode(serial, username = null, password = null, rateLimitCallback = null) {
    const maxRateLimitAttempts = 3;
    for (let rateAttempt = 1; rateAttempt <= maxRateLimitAttempts; rateAttempt++) {
        const res = await redeemCodeInner(serial, username, password);

        let isRateLimited = false;
        const data = res.data || {};
        let msg = "";
        if (data && typeof data === 'object') {
            msg = data.message || data.error || "";
        }
        if (!msg && res.message) {
            msg = res.message;
        }

        const msgStr = String(msg).toLowerCase();
        if (msgStr.includes("please wait") || msgStr.includes("captcha token field is required") || msgStr.includes("captcha type is present")) {
            isRateLimited = true;
        }

        if (isRateLimited) {
            if (rateAttempt === 1 && rateLimitCallback) {
                try {
                    await rateLimitCallback(res);
                } catch (e) {
                    log(`[-] เกิดข้อผิดพลาดใน Callback แจ้งเตือน: ${e.message}`);
                }
            }
            return res;
        }

        return res;
    }
}

async function redeemCodeInner(serial, username = null, password = null) {
    const targetUsername = username || config.username || "";
    const targetPassword = password || config.password || "";

    if (!accessToken || currentLoggedInUser !== targetUsername) {
        log(`[*] Node: Token ปัจจุบันไม่ได้เป็นของ ${targetUsername} หรือไม่มี Token, กำลังเข้าสู่ระบบใหม่...`);
        const success = await loginWithCredentials(targetUsername, targetPassword);
        if (!success) {
            return { success: false, message: "กรุณาเข้าสู่ระบบก่อน" };
        }
    }

    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Authorization': `Bearer ${accessToken}`,
        'Origin': `https://${MEMBER_DOMAIN}`,
        'Referer': `https://${MEMBER_DOMAIN}/talesrunner/itemcode`
    };

    // Step 1: GET orders/pending
    const pendingUrl = `${API_BASE_URL}/me/topup/games/${config.game_id}/orders/pending`;
    try {
        await fetch(pendingUrl, { headers });
    } catch (e) {
        log(`[-] Step 1 (orders/pending) error: ${e.message}`);
    }

    // Step 2: POST check-serial
    const checkUrl = `${API_BASE_URL}/me/games/${config.game_id}/itemcodes/check-serial`;
    const payloadCheck = {
        serial: serial.trim().toUpperCase(),
        game_id: config.game_id
    };

    let responseCheck;
    let checkData = {};
    try {
        responseCheck = await fetch(checkUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payloadCheck)
        });

        // Auto re-authenticate on 401 Unauthorized
        if (responseCheck.status === 401) {
            log(`[!] Node: พบสถานะ 401 (Unauthorized) กำลังเข้าสู่ระบบใหม่โดยอัตโนมัติ...`);
            const success = await loginWithCredentials(targetUsername, targetPassword);
            if (success) {
                log(`[+] Node: ออโต้ล็อกอินสำเร็จ! กำลังทดลองส่งโค้ดใหม่อีกครั้ง...`);
                headers['Authorization'] = `Bearer ${accessToken}`;
                // Retry Step 1
                try {
                    await fetch(pendingUrl, { headers });
                } catch (e) { }
                // Retry Step 2
                responseCheck = await fetch(checkUrl, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payloadCheck)
                });
            } else {
                return { success: false, checkSuccess: false, message: "Unauthorized" };
            }
        }

        if (responseCheck.status !== 200 && responseCheck.status !== 201) {
            const data = responseCheck.status !== 204 ? await responseCheck.json() : {};
            return {
                success: false,
                checkSuccess: false,
                statusCode: responseCheck.status,
                data: data,
                message: "Check serial failed"
            };
        }
        checkData = responseCheck.status !== 204 ? await responseCheck.json() : {};
    } catch (e) {
        return { success: false, checkSuccess: false, message: `เกิดข้อผิดพลาดในการตรวจสอบโค้ด: ${e.message}` };
    }

    // Step 3: POST redeem
    const redeemUrl = `${API_BASE_URL}/me/games/${config.game_id}/itemcodes/redeem`;
    const payloadRedeem = {
        game_id: config.game_id,
        serial: serial.trim().toUpperCase(),
        captcha_type: "CF_TURNSTILE",
        captcha_token: ""
    };

    try {
        const responseRedeem = await fetch(redeemUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payloadRedeem)
        });
        const data = responseRedeem.status !== 204 ? await responseRedeem.json() : {};

        return {
            success: responseRedeem.status === 200 || responseRedeem.status === 201,
            checkSuccess: true,
            checkData: checkData,
            statusCode: responseRedeem.status,
            data: data
        };
    } catch (e) {
        return { 
            success: false, 
            checkSuccess: true, 
            checkData: checkData,
            message: `เกิดข้อผิดพลาดในการเคลมโค้ด: ${e.message}` 
        };
    }
}

// Send Telegram Notification
async function sendTelegram(message, redeemResult = null) {
    const isEnabled = config.telegram_enabled !== undefined ? !!config.telegram_enabled : (!!config.telegram_token && !!config.telegram_chat_id);
    if (!isEnabled || !config.telegram_token || !config.telegram_chat_id) {
        return false;
    }

    if (redeemResult && !redeemResult.success) {
        const data = redeemResult.data || {};
        const reason = data.message || data.error || redeemResult.message || "Unknown error";

        // Ignore invalid itemcode spam
        if (reason.toLowerCase().includes("invalid itemcode")) {
            return false;
        }
    }

    const url = `https://api.telegram.org/bot${config.telegram_token}/sendMessage`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: config.telegram_chat_id,
                text: message,
                parse_mode: 'Markdown'
            })
        });
        if (res.ok) {
            log(`[+] Telegram Notification sent!`);
        } else {
            const txt = await res.text();
            log(`[-] Telegram API returned failure (HTTP ${res.status}): ${txt}`);
        }
    } catch (e) {
        log(`[-] Telegram network error: ${e.message}`);
    }
    return true;
}

// Send Discord Webhook Notification
async function sendDiscord(message, redeemResult = null) {
    const isEnabled = config.discord_enabled !== undefined ? !!config.discord_enabled : !!config.discord_webhook_url;
    if (!isEnabled || !config.discord_webhook_url) {
        return false;
    }

    if (redeemResult && !redeemResult.success) {
        const data = redeemResult.data || {};
        const reason = data.message || data.error || redeemResult.message || "Unknown error";

        // Ignore invalid itemcode spam
        if (reason.toLowerCase().includes("invalid itemcode")) {
            return false;
        }
    }

    const payload = {
        username: "TalesRunner OCR Bot",
        content: message
    };

    try {
        const res = await fetch(config.discord_webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            log(`[+] Discord Notification sent!`);
        } else {
            const txt = await res.text();
            log(`[-] Discord Webhook returned failure (HTTP ${res.status}): ${txt}`);
        }
    } catch (e) {
        log(`[-] Discord network error: ${e.message}`);
    }
    return true;
}

// Parse wait time from message
function parseWaitTime(msg) {
    if (!msg) return 60;
    const lowercaseMsg = String(msg).toLowerCase();
    
    // Check minutes
    const minuteMatch = lowercaseMsg.match(/(\d+)\s*(minute|minutes|min|mins|นาที|m\b)/);
    if (minuteMatch) {
        return parseInt(minuteMatch[1], 10) * 60;
    }
    
    // Check seconds
    const secondMatch = lowercaseMsg.match(/(\d+)\s*(second|seconds|sec|secs|วินาที|s\b)/);
    if (secondMatch) {
        return parseInt(secondMatch[1], 10);
    }
    
    // Generic number
    const genericMatch = lowercaseMsg.match(/(\d+)/);
    if (genericMatch) {
        const val = parseInt(genericMatch[1], 10);
        if (val <= 10) {
            return val * 60;
        } else {
            return val;
        }
    }
    return 60;
}

// Sleep OCR function helper
async function sleepOcr(minutes, reason = 'notification') {
    if (reason === 'periodic') {
        log(`[*] ทำงานสแกนครบ 5 นาที: กำลังหยุดพักการสแกน OCR เป็นเวลา ${minutes} นาทีชั่วคราว... (สตรีมสดจะยังคงเล่นต่อไป)`);
    } else {
        log(`[*] ตรวจพบการส่งแจ้งเตือน: กำลังหยุดพักการสแกน OCR เป็นเวลา ${minutes} นาที... (สตรีมสดจะยังคงเล่นต่อไป)`);
    }
    const ms = minutes * 60 * 1000;
    const segment = 1000; // 1 second
    const totalSegments = ms / segment;
    for (let i = 0; i < totalSegments && isRunning; i++) {
        await sleep(segment);
    }
    lastPeriodicSleepTime = Date.now();
    log(`[*] ครบ ${minutes} นาทีแล้ว เริ่มทำงานสแกน OCR ต่อ...`);
}

// Detect if URL is a YouTube channel
function isYoutubeChannel(url) {
    const lower = url.toLowerCase();
    const hasChannelMarker = ['/@', '/channel/', '/c/', '/user/'].some(marker => lower.includes(marker));
    const hasVideoMarker = ['watch?v=', 'youtu.be/', '/shorts/', '/embed/'].some(marker => lower.includes(marker));
    return hasChannelMarker && !hasVideoMarker;
}

// Get Channel Live stream Video URL
async function checkChannelLive(channelUrl) {
    const ytdl = config.ytdl_path || 'yt-dlp';
    let liveUrl = channelUrl.trim();
    if (liveUrl.endsWith('/')) {
        liveUrl = liveUrl.slice(0, -1);
    }
    if (!liveUrl.toLowerCase().endsWith('/live')) {
        liveUrl = `${liveUrl}/live`;
    }

    try {
        const { stdout } = await execFileAsync(ytdl, ['--get-id', liveUrl], { timeout: 15000 });
        const videoId = stdout.trim();
        if (videoId && !videoId.includes('\n')) {
            return `https://www.youtube.com/watch?v=${videoId}`;
        }
    } catch (e) {
        // Exits with 1 when channel is offline
    }
    return null;
}

// Check if a YouTube video is still live
async function isStreamLive(videoUrl) {
    const ytdl = config.ytdl_path || 'yt-dlp';
    try {
        const { stdout } = await execFileAsync(ytdl, ['--print', 'is_live', videoUrl], { timeout: 15000 });
        const result = stdout.trim().toLowerCase();
        return result === 'true';
    } catch (e) {
        // Assume still live on error (rate limit, network issue) to avoid false exit
        return true;
    }
}

// Resolve stream direct HLS url using yt-dlp
async function resolveDirectUrl(videoUrl) {
    const ytdl = config.ytdl_path || 'yt-dlp';
    try {
        const { stdout } = await execFileAsync(ytdl, [
            '-g',
            '-f', '134/bestvideo[height<=360]/best',
            videoUrl
        ], { timeout: 15000 });
        const directUrl = stdout.trim();
        if (directUrl) {
            return directUrl;
        }
    } catch (e) {
        log(`[-] yt-dlp: Error resolving stream URL: ${e.message}`);
    }
    return null;
}

// Extract frame using FFmpeg
async function captureFrame(directUrl, outputPath) {
    const ffmpeg = config.ffmpeg_path || 'ffmpeg';
    if (fs.existsSync(outputPath)) {
        try {
            fs.unlinkSync(outputPath);
        } catch (e) { }
    }

    try {
        await execFileAsync(ffmpeg, [
            '-y',
            '-loglevel', 'error',
            '-i', directUrl,
            '-vframes', '1',
            '-f', 'image2',
            outputPath
        ], { timeout: 10000 });

        return fs.existsSync(outputPath);
    } catch (e) {
        log(`[-] ffmpeg: Frame capture failed: ${e.message}`);
        return false;
    }
}

// Run OCR on image and return lines
async function runOcr(imagePath) {
    const ocrPath = config.ocr_helper_path || path.join(__dirname, 'ocr_helper.ps1');

    if (isWindows && ocrPath.endsWith('.ps1')) {
        if (!fs.existsSync(ocrPath)) {
            log(`[-] OCR Error: PowerShell OCR script not found at ${ocrPath}`);
            return [];
        }
        try {
            const { stdout } = await execFileAsync('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', ocrPath,
                imagePath
            ], { timeout: 10000 });
            return stdout.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);
        } catch (e) {
            log(`[-] PowerShell OCR script run failed: ${e.message}`);
            return [];
        }
    } else {
        const ocrBinary = ocrPath;
        if (!fs.existsSync(ocrBinary)) {
            log(`[-] OCR Error: Swift binary not found at ${ocrBinary}`);
            return [];
        }
        try {
            const { stdout } = await execFileAsync(ocrBinary, [imagePath], { timeout: 10000 });
            return stdout.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);
        } catch (e) {
            log(`[-] Swift OCR binary run failed: ${e.message}`);
            return [];
        }
    }
}

// Filter and extract codes using Regex heuristics
function extractCodes(lines) {
    const codes = [];
    const pattern = config.regex_pattern || "\\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{8,24}\\b";
    const regex = new RegExp(pattern, 'gi');

    for (const line of lines) {
        let targetText = line;

        // Heuristic 1: If line contains ':', split and skip username prefix (unless it starts with "code" or is digit)
        if (line.includes(':')) {
            const parts = line.split(':');
            const beforeColon = parts[0].trim();
            if (!beforeColon.toLowerCase().startsWith('code') && !/^\d+$/.test(beforeColon)) {
                targetText = parts.slice(1).join(':');
            }
        }

        // Heuristic 2: Remove chat @mentions
        targetText = targetText.replace(/@\w+/g, '');

        // Match regex
        regex.lastIndex = 0;
        let match;
        const uppercaseText = targetText.toUpperCase();
        while ((match = regex.exec(uppercaseText)) !== null) {
            const cleaned = match[0].replace(/\s+/g, '').replace(/\./g, '').trim();
            if (cleaned && !codes.includes(cleaned)) {
                codes.push(cleaned);
            }
        }
    }
    return codes;
}

// Process single scanning round
async function processScan(directUrl) {
    const captured = await captureFrame(directUrl, TEMP_FRAME);
    if (!captured) {
        return { success: false, reason: "FFmpeg frame extraction failed" };
    }

    const lines = await runOcr(TEMP_FRAME);

    // Clean up temporary image frame
    try {
        if (fs.existsSync(TEMP_FRAME)) {
            fs.unlinkSync(TEMP_FRAME);
        }
    } catch (e) { }

    if (lines.length > 0) {
        const preview = lines.slice(0, 3).join(', ') + (lines.length > 3 ? '...' : '');
        log(`[*] OCR read: "${preview}"`);
    } else {
        log(`[*] OCR: No text detected on screen`);
    }

    const codes = extractCodes(lines);
    if (codes.length > 0) {
        for (const code of codes) {
            if (!history.has(code)) {
                if (await checkPrefixAndHandleDuplicate(code, history, saveHistory, sleepOcr)) {
                    break;
                }
                const variations = generateCodeVariations(code);
                log(`[⭐] ตรวจพบโค้ดใหม่: ${code}`);
                log(`[*] สร้างโค้ดใกล้เคียงเพื่อทดสอบ: ${variations.join(', ')}`);

                let success = false;
                for (const varCode of variations) {
                    if (history.has(varCode)) {
                        continue;
                    }

                    log(`[*] Node: กำลังส่งโค้ดเคลมของรางวัล: ${varCode}...`);
                    let notified = false;
                    let redeemResult = await redeemCode(varCode);
                    history.add(varCode);
                    saveHistory();

                    const checkSuccess = redeemResult && redeemResult.checkSuccess;
                    const successRes = redeemResult && redeemResult.success;
                    const data = (redeemResult && redeemResult.data) || {};
                    const msg = data.message || data.error || (redeemResult && redeemResult.message) || "Unknown error";
                    const msgStr = String(msg).toLowerCase();
                    const isWaitError = msgStr.includes("please wait") || msgStr.includes("captcha token field is required") || msgStr.includes("captcha type is present");

                    const shouldNotify = checkSuccess || isWaitError;

                    if (successRes) {
                        log(`[🎉] เคลมโค้ด ${varCode} สำเร็จ!`);
                    } else {
                        log(`[❌] เคลมโค้ด ${varCode} ล้มเหลว: ${msg}`);
                    }

                    const isWaitOnly = msgStr.includes("please wait") || msgStr.includes("captcha token field is required") || msgStr.includes("captcha type is present");
                    if (isWaitOnly) {
                        log(`[!] Node: ตรวจพบข้อความ Please wait/Captcha: "${msg}". ส่งแจ้งเตือนด่วน...`);
                        let sentTele = await sendTelegram(varCode, redeemResult);
                        let sentDisc = await sendDiscord(varCode, redeemResult);
                        if (sentTele || sentDisc) {
                            logNotifiedCode(varCode);
                        }
                        notified = true;

                        let waitSeconds = 10;
                        if (msgStr.includes("please wait")) {
                            waitSeconds = parseWaitTime(msg);
                        }
                        log(`[*] Node: ตรวจพบให้รอตามระบบ: ${waitSeconds} วินาที...`);

                        let retrySuccess = false;
                        let waitFailCount = 1;

                        for (let attempt = 1; attempt <= 3; attempt++) {
                            log(`[*] Node: กำลังนอนรอ ${waitSeconds} วินาทีก่อนลองใหม่ (Attempt ${attempt}/3)...`);
                            await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

                            log(`[*] Node: กำลังเข้าสู่ระบบใหม่เพื่อรีเฟรช Token (Attempt ${attempt}/3)...`);
                            await loginWithCredentials(config.username, config.password);

                            log(`[*] Node: กำลังลองใหม่รอบที่ ${attempt}/3: ${varCode}...`);
                            let retryResult = await redeemCode(varCode);
                            let retryCheckSuccess = retryResult && retryResult.checkSuccess;
                            let retryData = (retryResult && retryResult.data) || {};
                            let retryMsg = retryData.message || retryData.error || (retryResult && retryResult.message) || "Unknown error";
                            let retryMsgStr = String(retryMsg).toLowerCase();

                            if (retryCheckSuccess) {
                                log(`[🎉] Node: ลองใหม่สำเร็จในรอบที่ ${attempt}!`);
                                redeemResult = retryResult;
                                retrySuccess = true;
                                break;
                            }

                            if (retryMsgStr.includes("please wait") || retryMsgStr.includes("captcha token field is required") || retryMsgStr.includes("captcha type is present")) {
                                waitFailCount++;
                                if (waitFailCount > 3) {
                                    log(`[❌] Node: เกิดข้อผิดพลาด Please wait/Captcha เกิน 3 ครั้งแล้ว (สะสม). ข้ามโค้ดนี้เลย...`);
                                    break;
                                }
                                if (retryMsgStr.includes("please wait")) {
                                    waitSeconds = parseWaitTime(retryMsg);
                                } else {
                                    waitSeconds = 10;
                                }
                            } else {
                                log(`[❌] Node: ลองใหม่ล้มเหลวด้วยข้อผิดพลาดอื่น: ${retryMsg}. หยุดลองใหม่...`);
                                break;
                            }
                        }

                        if (retrySuccess) {
                            let retryMessageToSend = "ไม่ทราบรางวัล";
                            if (redeemResult.checkData) {
                                try {
                                    const reward = redeemResult.checkData.data?.reward;
                                    const bundle = reward?.bundle;
                                    if (bundle && bundle.name) {
                                        const bundleName = bundle.name;
                                        const items = bundle.items || [];
                                        const itemNames = items.map(it => it.item?.name || it.name).filter(Boolean);
                                        const itemDetails = itemNames.join(",");
                                        if (itemDetails) {
                                            retryMessageToSend = `${bundleName}\n${itemDetails}`;
                                        } else {
                                            retryMessageToSend = `${bundleName}`;
                                        }
                                    }
                                } catch (e) {
                                    log(`[-] Error formatting retry message: ${e.message}`);
                                }
                            }
                            sentTele = await sendTelegram(retryMessageToSend, redeemResult);
                            sentDisc = await sendDiscord(retryMessageToSend, redeemResult);

                        }

                        for (const v of variations) {
                            history.add(v);
                        }
                        history.add(code);
                        saveHistory();

                        if (sentTele || sentDisc) {
                            await sleepOcr(10);
                        }
                        
                        success = true;
                        break;
                    }

                    if (shouldNotify) {
                        let sentTele = true;
                        let sentDisc = true;
                        if (!notified) {
                            if (checkSuccess) {
                                log(`[⭐] Node: ตรวจพบโค้ดผ่าน Check Serial (200 OK): ${varCode}. ส่งแจ้งเตือน...`);
                            } else {
                                log(`[!] Node: ตรวจพบข้อความแจ้งเตือนสำคัญ (Rate limit/Captcha). ส่งแจ้งเตือน...`);
                            }
                            // Build formatted message
                            let messageToSend = `${varCode}\nไม่ทราบรางวัล`;
                            if (checkSuccess && redeemResult.checkData) {
                                try {
                                    const reward = redeemResult.checkData.data?.reward;
                                    const bundle = reward?.bundle;
                                    if (bundle && bundle.name) {
                                        const bundleName = bundle.name;
                                        const items = bundle.items || [];
                                        const itemNames = items.map(it => it.item?.name || it.name).filter(Boolean);
                                        const itemDetails = itemNames.join(",");
                                        if (itemDetails) {
                                            messageToSend = `${varCode}\n${bundleName}\n${itemDetails}`;
                                        } else {
                                            messageToSend = `${varCode}\n${bundleName}`;
                                        }
                                    }
                                } catch (e) {
                                    log(`[-] Error formatting message: ${e.message}`);
                                }
                            }
                            sentTele = await sendTelegram(messageToSend, redeemResult);
                            sentDisc = await sendDiscord(messageToSend, redeemResult);
                            if (sentTele || sentDisc) {
                                logNotifiedCode(varCode);
                            }
                            notified = true;
                        }


                        // Add all variations to history to prevent duplicate notifications for this code family
                        for (const v of variations) {
                            history.add(v);
                        }
                        history.add(code);
                        saveHistory();

                        if (sentTele || sentDisc) {
                            await sleepOcr(10);
                        }
                        
                        success = true;
                        break;
                    }
                }

                if (!success) {
                    // Also add the original code to history if none succeeded to prevent reprocessing
                    history.add(code);
                    saveHistory();
                }
            }
        }
    }

    return { success: true };
}

// Sleep function helper
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Active Scanning Loop
async function scanStreamLoop(videoUrl) {
    log(`[*] เริ่มทำการสแกนวิดีโอ/สตรีมสด: ${videoUrl}`);
    let cachedDirectUrl = null;
    let failureCount = 0;
    const maxFailures = 6; // ~1 minute of continuous failure
    lastPeriodicSleepTime = Date.now();
    let lastLiveCheckTime = Date.now();

    while (isRunning) {
        // Periodic sleep: 2 minutes sleep every 5 minutes
        if (Date.now() - lastPeriodicSleepTime >= 5 * 60 * 1000) {
            await sleepOcr(2, 'periodic');
            continue;
        }

        // Check if stream has ended every 2 minutes
        if (Date.now() - lastLiveCheckTime >= 2 * 60 * 1000) {
            lastLiveCheckTime = Date.now();
            const live = await isStreamLive(videoUrl);
            if (!live) {
                log(`[*] ตรวจพบว่าสตรีมสดสิ้นสุดการแพร่ภาพแล้ว`);
                break;
            }
        }
        // Resolve direct stream URL if not cached
        if (!cachedDirectUrl) {
            log(`[*] กำลังดึงลิงก์ HLS ด้วย yt-dlp...`);
            cachedDirectUrl = await resolveDirectUrl(videoUrl);
            if (!cachedDirectUrl) {
                failureCount++;
                log(`[-] ล้มเหลวในการดึงลิงก์ HLS (ครั้งที่ ${failureCount}/${maxFailures})`);
                if (failureCount >= maxFailures) {
                    log(`[-] หยุดสแกนสตรีมนี้ เนื่องจากดึงลิงก์ล้มเหลวติดต่อกันครบกำหนด`);
                    break;
                }
                await sleep(10000);
                continue;
            }
        }

        // Process one frame capture + OCR
        const result = await processScan(cachedDirectUrl);
        if (!result.success) {
            failureCount++;
            log(`[-] ${result.reason} (ครั้งที่ ${failureCount}/${maxFailures})`);
            // Clear cached URL on failure to force re-resolving on next round
            cachedDirectUrl = null;

            if (failureCount >= maxFailures) {
                log(`[-] หยุดสแกนสตรีมนี้ เนื่องจากจับเฟรมภาพล้มเหลวติดต่อกันครบกำหนด`);
                break;
            }
        } else {
            // Reset failure counter on success
            failureCount = 0;
        }

        // Wait for scan_interval
        const intervalMs = (config.scan_interval || 10.0) * 1000;
        await sleep(intervalMs);
    }

    log(`[*] ปิดระบบสแกนสตรีม ${videoUrl}`);
}

function clearLogFiles() {
    try {
        const files = fs.readdirSync(__dirname);
        for (const file of files) {
            if (file.endsWith('.log') && file !== 'notified_codes.log') {
                fs.writeFileSync(path.join(__dirname, file), '', 'utf8');
            }
        }
        log(`[+] เคลียร์ไฟล์ล็อกทั้งหมดในไดเรกทอรีสำเร็จ`);
    } catch (e) {
        log(`[-] ไม่สามารถเคลียร์ไฟล์ล็อกได้: ${e.message}`);
    }
}

// Log pushed code to notified_codes.log
function logNotifiedCode(code) {
    const logPath = path.join(__dirname, 'notified_codes.log');
    const timestamp = new Date().toLocaleString('sv', { timeZone: 'Asia/Bangkok' });
    try {
        fs.appendFileSync(logPath, `[${timestamp}] Code: ${code}\n`, 'utf8');
    } catch (e) {
        log(`[-] ไม่สามารถบันทึกประวัติการส่งแจ้งเตือนใน log: ${e.message}`);
    }
}

function checkAndClearLogIfNewDay() {
    const logPath = path.join(__dirname, 'notified_codes.log');
    if (fs.existsSync(logPath)) {
        try {
            const stats = fs.statSync(logPath);
            if (stats.size > 0) {
                const todayStr = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Bangkok' });
                const content = fs.readFileSync(logPath, 'utf8');
                const firstLine = content.split('\n')[0];
                if (firstLine && firstLine.startsWith("[")) {
                    const endBracket = firstLine.indexOf("]");
                    if (endBracket !== -1) {
                        const datePart = firstLine.slice(1, endBracket).split(" ")[0];
                        // Fallback check for old Buddhist Era dates (e.g. 28/5/2569)
                        const tzDate = new Date();
                        const day = tzDate.toLocaleString('en-US', { timeZone: 'Asia/Bangkok', day: 'numeric' });
                        const month = tzDate.toLocaleString('en-US', { timeZone: 'Asia/Bangkok', month: 'numeric' });
                        const year = parseInt(tzDate.toLocaleString('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric' })) + 543;
                        const beDateStr = `${day}/${month}/${year}`;

                        if (datePart !== todayStr && datePart !== beDateStr) {
                            fs.writeFileSync(logPath, '', 'utf8');
                            log(`[+] เคลียร์ข้อมูลประวัติ notified_codes.log (ขึ้นวันใหม่)`);
                        }
                    }
                }
            }
        } catch (e) {
            log(`[-] ไม่สามารถตรวจสอบวันที่ในไฟล์ล็อกได้: ${e.message}`);
        }
    }
}

async function checkPrefixAndHandleDuplicate(code, historySet, saveHistoryCallback, sleepCallback) {
    const logPath = path.join(__dirname, 'notified_codes.log');
    
    // Check log rotation
    checkAndClearLogIfNewDay();
    
    if (!fs.existsSync(logPath)) {
        return false;
    }
    
    const notifiedList = [];
    try {
        const content = fs.readFileSync(logPath, 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
            const match = line.match(/Code:\s*([A-Z0-9]+)/i);
            if (match) {
                notifiedList.push(match[1].toUpperCase());
            }
        }
    } catch (e) {
        log(`[-] Error reading notified_codes.log: ${e.message}`);
        return false;
    }
    
    const scannedPrefix = code.slice(0, 5).toUpperCase();
    let duplicateFound = false;
    for (const notifiedCode of notifiedList) {
        if (notifiedCode.length >= 5 && notifiedCode.slice(0, 5).toUpperCase() === scannedPrefix) {
            duplicateFound = true;
            break;
        }
    }
    
    if (duplicateFound) {
        log(`[!] ตรวจพบรหัส ${scannedPrefix} ซ้ำกับประวัติการแจ้งเตือน (ข้ามการทำงานและหยุดสแกน 5 นาที)`);
        const variations = generateCodeVariations(code);
        
        historySet.add(code);
        for (const v of variations) {
            historySet.add(v);
        }
        
        saveHistoryCallback();
        await sleepCallback(5);
        return true;
    }
    
    return false;
}

// Main Runner
async function main() {
    clearLogFiles();
    loadConfig();
    loadHistory();

    log(`==================================================`);
    log(`  TalesRunner Itemcode Watcher Headless Service   `);
    log(`==================================================`);
    log(`  ช่อง/วิดีโอเป้าหมาย: ${config.youtube_url}`);
    log(`  ความถี่ในการสแกน: ${config.scan_interval} วินาที`);
    log(`  แจ้งเตือน Telegram: ${config.telegram_token ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}`);
    log(`  แจ้งเตือน Discord: ${config.discord_webhook_url ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}`);
    log(`==================================================\n`);

    // Auto login if credentials provided in configuration
    if (config.username && config.password) {
        log(`[*] พบข้อมูลล็อกอินในค่าตั้งค่า กำลังเชื่อมต่อเข้า HOF...`);
        const loginSuccess = await loginWithCredentials(config.username, config.password);
        if (loginSuccess) {
            log(`[+] เชื่อมต่อบัญชีผู้ใช้ HOF สำเร็จ! ระบบจะทำการเคลมโค้ดอัตโนมัติ`);
        } else {
            log(`[-] ไม่สามารถเชื่อมต่อบัญชี HOF ได้ (ระบบจะทำการแจ้งเตือนโค้ดอย่างเดียว)`);
        }
    }

    const targetUrl = config.youtube_url;

    if (isYoutubeChannel(targetUrl)) {
        log(`[*] ตรวจพบลิงก์ประเภทช่อง YouTube กำลังเข้าสู่โหมดเฝ้าระวังไลฟ์สตรีม...`);
        while (isRunning) {
            log(`[*] กำลังตรวจสอบสถานะไลฟ์สตรีมของช่อง...`);
            const liveVideoUrl = await checkChannelLive(targetUrl);
            if (liveVideoUrl) {
                log(`[⭐] ช่องเปิดไลฟ์สตรีมแล้ว! ลิงก์สตรีม: ${liveVideoUrl}`);
                // Scan the active stream
                await scanStreamLoop(liveVideoUrl);
            } else {
                log(`[*] ช่องยังไม่เปิดไลฟ์สตรีม จะเช็คอีกครั้งใน 60 วินาที...`);
                // Sleep for 60 seconds checking if still running
                for (let i = 0; i < 60 && isRunning; i++) {
                    await sleep(1000);
                }
            }
        }
    } else {
        log(`[*] ตรวจพบลิงก์ประเภทวิดีโอ/สตรีมโดยตรง กำลังสแกนทันที...`);
        await scanStreamLoop(targetUrl);
    }
}

// Graceful Shutdown
process.on('SIGINT', () => {
    log('\n[-] ได้รับสัญญาณหยุดทำงาน (SIGINT) กำลังปิดระบบ...');
    isRunning = false;
    // Clean up temporary files
    try {
        if (fs.existsSync(TEMP_FRAME)) {
            fs.unlinkSync(TEMP_FRAME);
        }
    } catch (e) { }
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('\n[-] ได้รับสัญญาณหยุดทำงาน (SIGTERM) กำลังปิดระบบ...');
    isRunning = false;
    // Clean up temporary files
    try {
        if (fs.existsSync(TEMP_FRAME)) {
            fs.unlinkSync(TEMP_FRAME);
        }
    } catch (e) { }
    process.exit(0);
});

// Run main
main().catch(err => {
    log(`[-] Fatal error in main service process: ${err.message}`);
    process.exit(1);
});
