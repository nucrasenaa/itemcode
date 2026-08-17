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
const ITEMCODE_URL = `https://${MEMBER_DOMAIN}/talesrunner/itemcode`;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15';

// State variables
const TEMP_FRAME = path.join(__dirname, 'service_frame.png');
let config = {};
let history = new Set();
let isRunning = true;
let accessToken = null;
let currentLoggedInUser = null;
let isAutoLoginDisabled = false;
let hasNotifiedTokenExpired = false;
let lastPeriodicSleepTime = Date.now();

// Logger
function log(msg) {
    const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    console.log(`[${timestamp}] ${msg}`);
}

function logTokenExpiration(token) {
    if (!token) return;
    try {
        const parts = token.split('.');
        if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
            if (payload && typeof payload.exp === 'number') {
                const expMs = payload.exp * 1000;
                const remainingMs = expMs - Date.now();
                const remainingMins = Math.round(remainingMs / (1000 * 60));
                if (remainingMins > 0) {
                    log(`[*] Token จะหมดอายุในอีก ${remainingMins} นาที (${new Date(expMs).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })})`);
                } else {
                    log(`[!] Token หมดอายุแล้วเมื่อ ${Math.abs(remainingMins)} นาทีที่แล้ว (${new Date(expMs).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })})`);
                }
                return;
            }
        }
    } catch (e) {
        log(`[-] ไม่สามารถตรวจสอบวันหมดอายุของ Token ได้: ${e.message}`);
    }
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
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

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
    const platform = isWindows ? 'Windows' : (isMac ? 'macOS' : (isLinux ? 'Linux' : process.platform));
    log(`[*] OS detected: ${platform}`);

    if (isLinux) {
        config.ytdl_path = config.ytdl_path_linux || (config.ytdl_path && !config.ytdl_path.includes('/homebrew/') ? config.ytdl_path : 'yt-dlp');
        config.ffmpeg_path = config.ffmpeg_path_linux || (config.ffmpeg_path && !config.ffmpeg_path.includes('/homebrew/') ? config.ffmpeg_path : 'ffmpeg');
        config.ocr_helper_path = config.ocr_helper_path_linux || (config.ocr_helper_path && config.ocr_helper_path !== './ocr_helper' ? config.ocr_helper_path : 'tesseract');
        config.ytdl_path = expandPathVars(config.ytdl_path);
        config.ffmpeg_path = expandPathVars(config.ffmpeg_path);
        config.ocr_helper_path = expandPathVars(config.ocr_helper_path);
        log(`[*]   yt-dlp     → ${config.ytdl_path}`);
        log(`[*]   ffmpeg     → ${config.ffmpeg_path}`);
        log(`[*]   ocr_helper → ${config.ocr_helper_path}`);
        return;
    }

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

    if (config.ytdl_cookies_file) {
        config.ytdl_cookies_file = expandPathVars(config.ytdl_cookies_file);
    }

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
            if (!config.username2) config.username2 = "";
            if (!config.password2) config.password2 = "";
            if (config.browser_redeem_enabled === undefined) {
                config.browser_redeem_enabled = !!(config.username2 && config.password2);
            }
            if (config.browser_redeem_headless === undefined) {
                config.browser_redeem_headless = true;
            }
            if (config.browser_token_login_enabled === undefined) {
                config.browser_token_login_enabled = true;
            }
            if (config.browser_token_login_headless === undefined) {
                config.browser_token_login_headless = true;
            }
            if (!config.ytdl_cookies_from_browser) config.ytdl_cookies_from_browser = "";
            if (!config.ytdl_cookies_file) config.ytdl_cookies_file = "";
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
            username2: "",
            password2: "",
            browser_redeem_enabled: false,
            browser_redeem_headless: true,
            browser_token_login_enabled: true,
            browser_token_login_headless: true,
            game_id: "ece25107-ec4f-4c83-9f2b-38afd0e77cc2",
            proxy_url: "",
            ytdl_cookies_from_browser: "",
            ytdl_cookies_file: ""
        };
    }
    adjustPathsForOS();

    // Set proxy environment variables if configured
    if (config.proxy_url) {
        process.env.HTTP_PROXY = config.proxy_url;
        process.env.HTTPS_PROXY = config.proxy_url;
    }
}

const SESSION_FILE = path.join(__dirname, '.session_config.json');

function loadSession() {
    try {
        if (fs.existsSync(SESSION_FILE)) {
            const data = fs.readFileSync(SESSION_FILE, 'utf8');
            const sess = JSON.parse(data);
            if (sess.access_token) {
                accessToken = sess.access_token;
                currentLoggedInUser = sess.username || config.username || "SessionUser";
                return sess.access_token;
            }
        }
    } catch (e) {
        log(`[-] Error loading session: ${e.message}`);
    }
    return null;
}

function saveSession(token, username = "") {
    try {
        const sessData = {
            access_token: token,
            game_id: config.game_id || "ece25107-ec4f-4c83-9f2b-38afd0e77cc2",
            username: username || config.username || ""
        };
        fs.writeFileSync(SESSION_FILE, JSON.stringify(sessData, null, 4), 'utf8');
        isAutoLoginDisabled = false;
        hasNotifiedTokenExpired = false;
        log(`[+] บันทึก Session Token ลงใน .session_config.json เรียบร้อยแล้ว`);
    } catch (e) {
        log(`[-] Error saving session: ${e.message}`);
    }
}

async function notifyTokenExpired() {
    if (hasNotifiedTokenExpired) return;
    hasNotifiedTokenExpired = true;
    const msg = `⚠️ *[TalesRunner Watcher Alert]*\n\n🔒 *Access Token หมดอายุแล้ว!*\n\nระบบไม่สามารถทำการเคลมโค้ดไอเทมอัตโนมัติได้ กรุณาล็อกอินผ่านเบราว์เซอร์แล้วนำ Bearer Token ใหม่มาตั้งค่าด้วยคำสั่ง:\n\`node index.js --set-token <YOUR_BEARER_TOKEN>\``;
    log(`[!] ส่งการแจ้งเตือน Telegram: Token หมดอายุแล้ว`);
    await sendTelegram(msg);
}

async function verifyToken(token) {
    if (!token) return false;
    try {
        const pendingUrl = `${API_BASE_URL}/me/topup/games/${config.game_id || 'ece25107-ec4f-4c83-9f2b-38afd0e77cc2'}/orders/pending`;
        const res = await fetch(pendingUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'Origin': `https://${MEMBER_DOMAIN}`
            }
        });
        return res.status !== 401;
    } catch (e) {
        return false;
    }
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

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
    'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
};

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
        const authUrl = `${PASSPORT_BASE_URL}/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

        let currentUrl = authUrl;
        let currentAuthRes = await fetch(currentUrl, {
            headers: {
                ...BROWSER_HEADERS,
                'Sec-Fetch-Site': 'none'
            },
            redirect: 'manual'
        });
        cookieJar.update(currentAuthRes.headers.getSetCookie());

        // Follow the redirect chain until login page (status 200)
        let authHops = 0;
        while (currentAuthRes.status >= 300 && currentAuthRes.status < 400 && authHops < 10) {
            const location = currentAuthRes.headers.get('location');
            if (!location) break;
            const prevUrl = currentUrl;
            currentUrl = location.startsWith('http') ? location : new URL(location, PASSPORT_BASE_URL).toString();
            currentAuthRes = await fetch(currentUrl, {
                method: 'GET',
                headers: {
                    ...BROWSER_HEADERS,
                    'Cookie': cookieJar.getCookieHeader(),
                    'Referer': prevUrl
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
                ...BROWSER_HEADERS,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': cookieJar.getCookieHeader(),
                'Origin': PASSPORT_BASE_URL,
                'Referer': loginPageUrl
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

            const prevLoginUrl = finalUrl;
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
                    ...BROWSER_HEADERS,
                    'Cookie': cookieJar.getCookieHeader(),
                    'Referer': prevLoginUrl
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
                isAutoLoginDisabled = false;
                return true;
            }
            isAutoLoginDisabled = true;
            return false;
        } else {
            log(`[-] Node: เข้าสู่ระบบล้มเหลว หรือไม่พบ Auth Code ใน URL เปลี่ยนเส้นทาง: ${finalUrl}`);
            isAutoLoginDisabled = true;
            return false;
        }
    } catch (e) {
        log(`[-] Node: เกิดข้อผิดพลาดระหว่างล็อกอิน: ${e.message}`);
        isAutoLoginDisabled = true;
        return false;
    }
}

// Log in through the browser, then reuse the access_token cookie for API checks.
async function loginWithBrowserForAccessToken(username, password) {
    username = username || config.username || "";
    password = password || config.password || "";
    if (!username || !password) return false;

    let browser;
    try {
        const { launch } = await import('cloakbrowser/puppeteer');
        const headless = process.env.BROWSER_TOKEN_LOGIN_HEADLESS !== 'false' &&
            config.browser_token_login_headless !== false;
        log(`[BROWSER-AUTH] กำลัง login เพื่อดึง access_token (${headless ? 'headless' : 'headed'})...`);
        browser = await launch({ headless, humanize: true, args: [] });
        const pages = await browser.pages();
        const page = pages[0] || await browser.newPage();
        page.setDefaultNavigationTimeout(120000);

        const sleepMs = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        async function waitForTurnstileToken(timeoutMs = 30000) {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const token = await page.$eval(
                    'input[name="cf-turnstile-response"]',
                    el => el.value || ''
                ).catch(() => '');
                if (token) return true;
                await sleepMs(500);
            }
            return false;
        }

        async function clickTurnstileIfVisible(timeoutMs = 120000) {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                if (await waitForTurnstileToken(1000)) return true;

                const wrapper = await page.$('div:has(> div > div > input[name="cf-turnstile-response"])');
                const wrapperBox = wrapper ? await wrapper.boundingBox().catch(() => null) : null;
                if (wrapperBox && wrapperBox.width > 250 && wrapperBox.height > 40) {
                    await sleepMs(800);
                    await page.mouse.click(wrapperBox.x + 22, wrapperBox.y + 32);
                } else {
                    const iframe = await page.$('iframe[src*="challenges.cloudflare.com"]');
                    const iframeBox = iframe ? await iframe.boundingBox().catch(() => null) : null;
                    if (iframeBox && iframeBox.width > 250 && iframeBox.height > 40) {
                        await sleepMs(800);
                        await page.mouse.click(iframeBox.x + 42, iframeBox.y + 45);
                    }
                }

                if (await waitForTurnstileToken(2000)) return true;
            }
            return false;
        }

        async function getAccessTokenFromBrowser() {
            const urls = [
                `${PASSPORT_BASE_URL}/`,
                `${PASSPORT_BASE_URL}/hall-of-fame-web/login`,
                `https://${MEMBER_DOMAIN}/`,
                `https://${MEMBER_DOMAIN}/oauth/callback`
            ];
            const cookies = [];
            for (const url of urls) {
                const scoped = await page.cookies(url).catch(() => []);
                cookies.push(...scoped);
            }
            const accessCookie = cookies.find(cookie => cookie.name === 'access_token' && cookie.value);
            if (accessCookie) return accessCookie.value;

            return await page.evaluate(() => {
                for (const storage of [window.localStorage, window.sessionStorage]) {
                    for (const key of ['access_token', 'accessToken']) {
                        const value = storage.getItem(key);
                        if (value) return value;
                    }
                }
                return '';
            }).catch(() => '');
        }

        await page.goto(`${PASSPORT_BASE_URL}/hall-of-fame-web/login`, {
            waitUntil: 'domcontentloaded'
        });

        if ((await page.content()).includes('challenge-platform')) {
            log(`[BROWSER-AUTH] พบ Cloudflare challenge กำลังดำเนินการอัตโนมัติ...`);
            const solved = await clickTurnstileIfVisible();
            if (!solved) throw new Error('ไม่สามารถผ่าน Cloudflare challenge ได้');
            for (let i = 0; i < 60 && (await page.content()).includes('challenge-platform'); i++) {
                await sleepMs(1000);
            }
        }

        await page.goto(`${PASSPORT_BASE_URL}/hall-of-fame-web/login`, {
            waitUntil: 'domcontentloaded'
        });
        const usernameInput = await page.waitForSelector(
            'input[name="username"], input[type="email"]',
            { visible: true, timeout: 60000 }
        );
        const passwordInput = await page.waitForSelector(
            'input[name="password"], input[type="password"]',
            { visible: true, timeout: 60000 }
        );
        await usernameInput.type(username);
        await passwordInput.type(password);

        const loginCaptchaSolved = await waitForTurnstileToken(5000) ||
            await clickTurnstileIfVisible(120000);
        if (!loginCaptchaSolved) throw new Error('ไม่พบ access_token หลังผ่าน Turnstile หน้า login');

        const submit = await page.$('button[type="submit"], input[type="submit"]');
        if (!submit) throw new Error('ไม่พบปุ่ม submit หน้า login');
        await Promise.allSettled([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 }),
            submit.click()
        ]);
        await sleepMs(2500);

        if (page.url().includes('/login')) {
            throw new Error('ล็อกอินผ่าน Browser ไม่สำเร็จ');
        }

        const token = await getAccessTokenFromBrowser();
        if (!token) throw new Error('ล็อกอินสำเร็จแต่ไม่พบ access_token ใน Browser');

        accessToken = token;
        currentLoggedInUser = username;
        isAutoLoginDisabled = false;
        saveSession(accessToken, username);
        log(`[BROWSER-AUTH] ได้ access_token จาก Browser และบันทึก session แล้ว`);
        logTokenExpiration(accessToken);
        return true;
    } catch (e) {
        log(`[BROWSER-AUTH] login เพื่อดึง access_token ล้มเหลว: ${e.message}`);
        return false;
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (e) { }
        }
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
                logTokenExpiration(accessToken);
                saveSession(accessToken, currentLoggedInUser);
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

async function readApiResponse(response) {
    const raw = await response.text();
    if (!raw.trim()) {
        return { data: {}, raw, isJson: true };
    }

    try {
        return { data: JSON.parse(raw), raw, isJson: true };
    } catch (_) {
        return { data: {}, raw, isJson: false };
    }
}

function extractApiMessage(payload) {
    const candidates = [
        payload && payload.message,
        payload && payload.error,
        payload && payload.detail,
        payload && payload.data && payload.data.message,
        payload && payload.data && payload.data.error,
        payload && payload.data && payload.data.detail
    ];
    return candidates.find((value) => typeof value === 'string' && value.trim()) || '';
}

function isInvalidItemCodeMessage(message) {
    const normalized = String(message || '').toLowerCase().replace(/\s+/g, ' ');
    return normalized.includes('invalid itemcode') ||
        normalized.includes('invalid item code') ||
        normalized.includes('itemcode is invalid') ||
        normalized.includes('item code is invalid') ||
        normalized.includes('ไอเทมโค้ดไม่ถูกต้อง') ||
        normalized.includes('ไอเท็มโค้ดไม่ถูกต้อง') ||
        normalized.includes('itemcode ไม่ถูกต้อง') ||
        normalized.includes('item code ไม่ถูกต้อง');
}

function formatApiResponseError(action, response, parsed) {
    const contentType = response.headers.get('content-type') || 'ไม่ระบุ content-type';
    if (!parsed.isJson) {
        const htmlResponse = contentType.toLowerCase().includes('text/html');
        return `${action}: HTTP ${response.status} ได้ response ที่ไม่ใช่ JSON (${contentType})${htmlResponse ? ' — อาจถูก Cloudflare/หน้าเว็บบล็อก' : ''}`;
    }
    return extractApiMessage(parsed.data) || `${action}: HTTP ${response.status}`;
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

    if (!accessToken) {
        if (!isAutoLoginDisabled) {
            log(`[*] Node: ไม่มี Token ในระบบ กำลังพยายามเข้าสู่ระบบ...`);
            const success = await loginWithCredentials(targetUsername, targetPassword);
            if (!success) {
                isAutoLoginDisabled = true;
                return { success: false, message: "ไม่มี Access Token ที่ใช้งานได้ (โปรดอัปเดต Token ด้วย --set-token)" };
            }
        } else {
            return { success: false, message: "ไม่มี Access Token ที่ใช้งานได้" };
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
            log(`[!] Node: พบสถานะ 401 (Unauthorized Token หมดอายุ)`);
            await notifyTokenExpired();
            if (!isAutoLoginDisabled) {
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
                    isAutoLoginDisabled = true;
                    return { success: false, checkSuccess: false, message: "Unauthorized (Token หมดอายุ)" };
                }
            } else {
                return { success: false, checkSuccess: false, message: "Unauthorized (Token หมดอายุ)" };
            }
        }

        const parsedCheck = await readApiResponse(responseCheck);
        const checkMessage = extractApiMessage(parsedCheck.data);

        if (responseCheck.status !== 200 && responseCheck.status !== 201) {
            return {
                success: false,
                checkSuccess: false,
                statusCode: responseCheck.status,
                data: parsedCheck.data,
                message: formatApiResponseError("Check serial failed", responseCheck, parsedCheck)
            };
        }

        if (!parsedCheck.isJson) {
            return {
                success: false,
                checkSuccess: false,
                statusCode: responseCheck.status,
                data: parsedCheck.data,
                message: formatApiResponseError("Check serial failed", responseCheck, parsedCheck)
            };
        }

        if (isInvalidItemCodeMessage(checkMessage)) {
            return {
                success: false,
                checkSuccess: false,
                invalidItemCode: true,
                statusCode: responseCheck.status,
                data: parsedCheck.data,
                message: checkMessage
            };
        }

        checkData = parsedCheck.data;
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
        const parsedRedeem = await readApiResponse(responseRedeem);
        const redeemMessage = extractApiMessage(parsedRedeem.data);

        return {
            success: (responseRedeem.status === 200 || responseRedeem.status === 201) && parsedRedeem.isJson,
            checkSuccess: true,
            checkData: checkData,
            statusCode: responseRedeem.status,
            data: parsedRedeem.data,
            ...(!parsedRedeem.isJson ? {
                message: formatApiResponseError("Redeem failed", responseRedeem, parsedRedeem)
            } : (redeemMessage ? { message: redeemMessage } : {}))
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

// Browser redemption flow for the secondary account.
// This keeps the CAPTCHA step in a real visible browser and submits through the
// item-code page instead of sending an empty captcha_token to the API.
async function redeemCodeWithBrowser(serial, username = null, password = null) {
    const targetUsername = username || config.username2 || "";
    const targetPassword = password || config.password2 || "";
    const normalizedSerial = String(serial || "").trim().toUpperCase();

    if (!targetUsername || !targetPassword) {
        return { completed: false, success: false, message: "ไม่ได้กำหนด username2/password2" };
    }
    if (!normalizedSerial) {
        return { completed: false, success: false, message: "ไม่ได้กำหนด itemcode" };
    }

    let browser;
    try {
        const { launch } = await import('cloakbrowser/puppeteer');
        const headless = process.env.BROWSER_REDEEM_HEADLESS === 'true' || config.browser_redeem_headless === true;
        log(`[BROWSER] โหมดการแสดงผล: ${headless ? 'เบื้องหลัง (headless)' : 'มีหน้าต่าง (headed)'}`);
        browser = await launch({ headless, humanize: true, args: [] });
        const pages = await browser.pages();
        const page = pages[0] || await browser.newPage();
        page.setDefaultNavigationTimeout(120000);
        const dialogMessages = [];
        const responseSignals = [];
        page.on('dialog', async dialog => {
            dialogMessages.push(dialog.message());
            await dialog.dismiss().catch(() => {});
        });
        page.on('response', async response => {
            const method = response.request().method();
            if (method === 'GET' || method === 'OPTIONS') return;
            const text = await response.text().catch(() => '');
            const lower = text.toLowerCase();
            if (text.includes('ปิดปรับปรุงระบบ') ||
                text.includes('กรุณาลองใหม่อีกครั้งในภายหลัง') ||
                lower.includes('temporarily unavailable') ||
                lower.includes('try again later')) {
                responseSignals.push(text.slice(0, 1000));
            }
        });

        const sleepMs = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        async function clickTurnstileIfVisible() {
            for (let attempt = 0; attempt < 15; attempt++) {
                const wrapper = await page.$('div:has(> div > div > input[name="cf-turnstile-response"])');
                if (wrapper) {
                    const rect = await wrapper.boundingBox();
                    if (rect && rect.width > 250 && rect.height > 40) {
                        await sleepMs(1000 + Math.random() * 1000);
                        await page.mouse.click(
                            rect.x + 20 + Math.random() * 6,
                            rect.y + 30 + Math.random() * 6
                        );
                        return true;
                    }
                }
                await sleepMs(1000);
            }
            return false;
        }

        async function waitForTurnstileToken(timeoutMs = 30000) {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const token = await page.$eval(
                    'input[name="cf-turnstile-response"]',
                    el => el.value || ''
                ).catch(() => '');
                if (token) return true;
                await sleepMs(500);
            }
            return false;
        }

        async function clickButtonByText(text) {
            const buttons = await page.$$('button');
            for (const button of buttons) {
                const label = await page.evaluate(el => (el.innerText || '').trim(), button).catch(() => '');
                if (label.includes(text)) {
                    await button.click();
                    return true;
                }
            }
            return false;
        }

        async function dismissCookieBanner() {
            return (await clickButtonByText('ยอมรับทั้งหมด')) ||
                (await clickButtonByText('ปฏิเสธ'));
        }

        // 1. Login through the visible browser and pass the WAF interstitial.
        await page.goto(`${PASSPORT_BASE_URL}/hall-of-fame-web/login`, {
            waitUntil: 'domcontentloaded'
        });
        if ((await page.content()).includes('challenge-platform')) {
            log(`[BROWSER] พบ Cloudflare challenge สำหรับบัญชีสำรอง กำลังดำเนินการ...`);
            await clickTurnstileIfVisible();
            for (let i = 0; i < 30 && (await page.content()).includes('challenge-platform'); i++) {
                await sleepMs(1000);
            }
        }

        await page.goto(`${PASSPORT_BASE_URL}/hall-of-fame-web/login`, {
            waitUntil: 'domcontentloaded'
        });
        const usernameInput = await page.waitForSelector(
            'input[name="username"], input[type="email"]',
            { visible: true, timeout: 60000 }
        );
        const passwordInput = await page.waitForSelector(
            'input[name="password"], input[type="password"]',
            { visible: true, timeout: 60000 }
        );
        await usernameInput.type(targetUsername);
        await passwordInput.type(targetPassword);

        // The login form can have its own Turnstile widget even after the
        // Cloudflare interstitial has been cleared.
        let loginCaptchaSolved = await waitForTurnstileToken(5000);
        if (!loginCaptchaSolved) {
            log(`[BROWSER] หน้า login ต้องยืนยัน Turnstile กำลังดำเนินการ...`);
            await clickTurnstileIfVisible();
            loginCaptchaSolved = await waitForTurnstileToken(30000);
        }
        if (!loginCaptchaSolved) {
            return {
                completed: true,
                success: false,
                stage: 'captcha',
                message: 'ไม่พบ captcha token ของหน้า login'
            };
        }

        const loginSubmit = await page.$('button[type="submit"], input[type="submit"]');
        if (!loginSubmit) throw new Error('ไม่พบปุ่ม submit ของหน้า login');
        await Promise.allSettled([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 }),
            loginSubmit.click()
        ]);
        await sleepMs(2000);

        if (page.url().includes('/login')) {
            const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
            return {
                completed: true,
                success: false,
                stage: 'login',
                message: bodyText.slice(0, 500) || 'ล็อกอินบัญชีสำรองไม่สำเร็จ'
            };
        }

        // 2. Open item-code page and wait for the embedded Turnstile widget.
        await page.goto(ITEMCODE_URL, { waitUntil: 'domcontentloaded' });
        await sleepMs(5000);
        await dismissCookieBanner();
        const codeInput = await page.waitForSelector('input[name="code"]', {
            visible: true,
            timeout: 60000
        });
        await codeInput.click();
        await codeInput.type(normalizedSerial);

        let captchaSolved = await waitForTurnstileToken(5000);
        if (!captchaSolved) {
            await clickTurnstileIfVisible();
            captchaSolved = await waitForTurnstileToken(30000);
        }
        if (!captchaSolved) {
            return {
                completed: true,
                success: false,
                stage: 'captcha',
                message: 'ไม่พบ captcha token ของหน้า itemcode'
            };
        }

        // 3. Submit the item code through the page UI.
        const submit = await page.$('button[type="submit"]');
        if (!submit) throw new Error('ไม่พบปุ่มใช้ไอเทมโค้ด');
        await Promise.allSettled([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
            submit.click()
        ]);
        await sleepMs(3000);

        const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
        const visibleDialogText = dialogMessages.join('\n');
        const resultText = `${bodyText}\n${visibleDialogText}\n${responseSignals.join('\n')}`;
        const lowerText = resultText.toLowerCase();
        const maintenance = resultText.includes('ปิดปรับปรุงระบบ') ||
            resultText.includes('กรุณาลองใหม่อีกครั้งในภายหลัง') ||
            lowerText.includes('temporarily unavailable') ||
            lowerText.includes('try again later');

        return {
            completed: true,
            success: !maintenance,
            stage: 'submit',
            maintenance,
            url: page.url(),
            title: await page.title(),
            message: resultText.slice(0, 1000)
        };
    } catch (e) {
        return {
            completed: false,
            success: false,
            stage: 'exception',
            message: e.message
        };
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (e) { }
        }
    }
}

async function runBrowserRedeemAfterNotification(serial) {
    if (!config.browser_redeem_enabled) return null;
    if (!config.username2 || !config.password2) {
        log(`[BROWSER] ข้ามการเคลมผ่านหน้าเว็บ: ไม่มี username2/password2`);
        return null;
    }

    log(`[BROWSER] แจ้งเตือนเสร็จแล้ว กำลังเปิดหน้า itemcode ด้วยบัญชีสำรอง...`);
    const result = await redeemCodeWithBrowser(serial, config.username2, config.password2);
    if (result.maintenance) {
        log(`[BROWSER] หน้าเว็บตอบกลับว่าอยู่ระหว่างปิดปรับปรุงระบบ`);
    } else if (result.success) {
        log(`[BROWSER] ส่ง itemcode ผ่านหน้าเว็บสำเร็จ: ${serial}`);
    } else {
        log(`[BROWSER] flow ไม่สำเร็จ (${result.stage || 'unknown'}): ${result.message || 'unknown error'}`);
    }

    const browserStatus = result.maintenance
        ? 'ปิดปรับปรุงระบบ'
        : result.success
            ? 'เคลมสำเร็จ'
            : 'เคลมไม่สำเร็จ';
    const browserDetail = result.maintenance
        ? 'ปิดปรับปรุงระบบชั่วคราว กรุณาลองใหม่อีกครั้งในภายหลัง'
        : result.success
            ? 'ส่ง itemcode ผ่านหน้าเว็บเรียบร้อยแล้ว'
            : result.stage === 'captcha'
                ? 'ไม่สามารถยืนยัน Turnstile ได้'
                : result.stage === 'login'
                    ? 'ล็อกอินบัญชีสำรองไม่สำเร็จ'
                    : result.stage === 'exception'
                        ? 'เกิดข้อผิดพลาดระหว่างทำรายการ'
                        : 'ไม่สามารถส่ง itemcode ผ่านหน้าเว็บได้';
    const browserTelegramMessage = [
        '🖥️ ผลการเคลมผ่าน Browser',
        `โค้ด: ${serial}`,
        `สถานะ: ${browserStatus}`,
        `ขั้นตอน: ${result.stage || 'unknown'}`,
        `รายละเอียด: ${browserDetail}`
    ].join('\n');
    const browserTelegramSent = await sendTelegram(browserTelegramMessage);
    if (browserTelegramSent) {
        log(`[BROWSER] ส่งผลการเคลมผ่าน Browser ไป Telegram แล้ว`);
    }

    return result;
}

async function runBrowserRedeemWithRetries(serial, maxAttempts = 5) {
    if (!config.browser_redeem_enabled || !config.username2 || !config.password2) {
        return null;
    }

    let lastResult = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        log(`[BROWSER] ลองใช้ itemcode รอบที่ ${attempt}/${maxAttempts}: ${serial}`);
        try {
            lastResult = await runBrowserRedeemAfterNotification(serial);
        } catch (error) {
            lastResult = {
                completed: false,
                success: false,
                stage: 'exception',
                message: error.message
            };
            log(`[BROWSER] รอบที่ ${attempt} เกิดข้อผิดพลาด: ${error.message}`);
        }

        if (lastResult && lastResult.success === true) {
            return lastResult;
        }

        if (attempt < maxAttempts) {
            log(`[BROWSER] รอบที่ ${attempt} ไม่สำเร็จ รอ 10 วินาทีก่อนลองใหม่...`);
            await sleep(10000);
        }
    }

    log(`[BROWSER] ใช้ itemcode ไม่สำเร็จครบ ${maxAttempts} รอบ: ${serial}`);
    return lastResult;
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
        if (isInvalidItemCodeMessage(reason)) {
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
    if (!isEnabled) {
        return false;
    }

    if (redeemResult && !redeemResult.success) {
        const data = redeemResult.data || {};
        const reason = data.message || data.error || redeemResult.message || "Unknown error";

        // Ignore invalid itemcode spam
        if (isInvalidItemCodeMessage(reason)) {
            return false;
        }
    }

    // Support both single string (comma-separated) and array of URLs
    let urls = [];
    if (Array.isArray(config.discord_webhook_url)) {
        urls = config.discord_webhook_url.filter(Boolean);
    } else if (typeof config.discord_webhook_url === 'string') {
        urls = config.discord_webhook_url.split(',').map(u => u.trim()).filter(Boolean);
    }

    if (urls.length === 0) {
        return false;
    }

    const payload = {
        username: "TalesRunner Bot",
        content: message
    };

    let sentAny = false;
    for (const url of urls) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                log(`[+] Discord Notification sent to ${url.substring(0, 45)}...`);
                sentAny = true;
            } else {
                const txt = await res.text();
                log(`[-] Discord Webhook (${url.substring(0, 45)}...) returned failure (HTTP ${res.status}): ${txt}`);
            }
        } catch (e) {
            log(`[-] Discord network error for ${url.substring(0, 45)}...: ${e.message}`);
        }
    }
    return sentAny;
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

async function retryCheckSerialAndNotify(serial, initialMessage) {
    const initialMessageLower = String(initialMessage || '').toLowerCase();
    let waitSeconds = initialMessageLower.includes('please wait')
        ? parseWaitTime(initialMessage)
        : 10;
    let lastResult = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
        log(`[*] Node: รอ ${waitSeconds} วินาทีก่อน check serial ซ้ำ (รอบที่ ${attempt}/3): ${serial}`);
        await sleep(waitSeconds * 1000);

        log(`[*] Node: กำลังเข้าสู่ระบบใหม่เพื่อรีเฟรช Token (check serial รอบที่ ${attempt}/3)...`);
        await loginWithCredentials(config.username, config.password);

        log(`[*] Node: กำลัง check serial ซ้ำรอบที่ ${attempt}/3 เพื่ออ่านรายการรางวัล: ${serial}...`);
        lastResult = await redeemCode(serial);
        const retryCheckSuccess = lastResult && lastResult.checkSuccess;
        const retryData = (lastResult && lastResult.data) || {};
        const retryMessage = retryData.message || retryData.error || (lastResult && lastResult.message) || 'Unknown error';
        const retryMessageLower = String(retryMessage).toLowerCase();

        if (retryCheckSuccess) {
            log(`[🎉] Node: check serial ซ้ำสำเร็จในรอบที่ ${attempt}: ${serial}`);

            let messageToSend = 'ไม่ทราบรางวัล';
            if (lastResult.checkData) {
                try {
                    const reward = lastResult.checkData.data?.reward;
                    const bundle = reward?.bundle;
                    if (bundle && bundle.name) {
                        const bundleName = bundle.name;
                        const items = bundle.items || [];
                        const itemNames = items.map(it => it.item?.name || it.name).filter(Boolean);
                        const itemDetails = itemNames.join(',');
                        messageToSend = itemDetails || bundleName;
                    }
                } catch (error) {
                    log(`[-] Error formatting retry reward message: ${error.message}`);
                }
            }

            const sentTelegram = await sendTelegram(messageToSend, lastResult);
            const sentDiscord = await sendDiscord(messageToSend, lastResult);
            return {
                retrySuccess: true,
                result: lastResult,
                sentTelegram,
                sentDiscord
            };
        }

        const stillWaiting = retryMessageLower.includes('please wait') ||
            retryMessageLower.includes('captcha token field is required') ||
            retryMessageLower.includes('captcha type is present');
        if (!stillWaiting) {
            log(`[❌] Node: check serial ซ้ำล้มเหลวด้วยข้อผิดพลาดอื่น: ${retryMessage}`);
            break;
        }

        waitSeconds = retryMessageLower.includes('please wait')
            ? parseWaitTime(retryMessage)
            : 10;
    }

    return { retrySuccess: false, result: lastResult, sentTelegram: false, sentDiscord: false };
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

// Helper to construct yt-dlp arguments with cookie options
function getYtdlArgs(args = []) {
    const finalArgs = [...args];
    if (config.ytdl_cookies_from_browser) {
        finalArgs.push('--cookies-from-browser', config.ytdl_cookies_from_browser);
    } else if (config.ytdl_cookies_file) {
        finalArgs.push('--cookies', config.ytdl_cookies_file);
    }
    return finalArgs;
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
        const { stdout } = await execFileAsync(ytdl, getYtdlArgs(['--get-id', liveUrl]), { timeout: 15000 });
        const videoId = stdout.trim();
        if (videoId && !videoId.includes('\n')) {
            return `https://www.youtube.com/watch?v=${videoId}`;
        }
    } catch (e) {
        log(`[-] checkChannelLive error: ${e.message}`);
    }
    return null;
}

// Check if a YouTube video is still live
async function isStreamLive(videoUrl) {
    const ytdl = config.ytdl_path || 'yt-dlp';
    try {
        const { stdout } = await execFileAsync(ytdl, getYtdlArgs(['--print', 'is_live', videoUrl]), { timeout: 15000 });
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
        const { stdout } = await execFileAsync(ytdl, getYtdlArgs([
            '-g',
            '-f', '134/bestvideo[height<=360]/best',
            videoUrl
        ]), { timeout: 15000 });
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
    const ocrPath = config.ocr_helper_path || (isWindows ? path.join(__dirname, 'ocr_helper.ps1') : 'tesseract');

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
    } else if (isLinux || ocrPath.toLowerCase().includes('tesseract')) {
        try {
            const { stdout } = await execFileAsync(ocrPath, [imagePath, 'stdout', '-l', 'tha+eng'], { timeout: 15000 });
            return stdout.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);
        } catch (e) {
            if (e.message.includes('Error opening data file') || e.message.includes('tha.traineddata')) {
                try {
                    log(`[!] Warning: Tesseract Thai language pack not found. Falling back to English only.`);
                    const { stdout } = await execFileAsync(ocrPath, [imagePath, 'stdout', '-l', 'eng'], { timeout: 15000 });
                    return stdout.split('\n')
                        .map(line => line.trim())
                        .filter(line => line.length > 0);
                } catch (err) {
                    log(`[-] Tesseract OCR execution fallback failed: ${err.message}`);
                    return [];
                }
            }
            log(`[-] OCR Error: Tesseract execution failed: ${e.message}`);
            log(`[-] On Linux (Debian/Ubuntu), make sure it is installed:`);
            log(`[-]   sudo apt-get update && sudo apt-get install -y tesseract-ocr tesseract-ocr-tha tesseract-ocr-eng`);
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

                        // Browser redemption and API check-retry run independently.
                        // The browser uses the secondary account; the API check uses the primary token.
                        const browserPromise = runBrowserRedeemWithRetries(varCode, 5);
                        const checkPromise = retryCheckSerialAndNotify(varCode, msg);
                        const [browserSettled, checkSettled] = await Promise.allSettled([
                            browserPromise,
                            checkPromise
                        ]);

                        const browserResult = browserSettled.status === 'fulfilled'
                            ? browserSettled.value
                            : null;
                        if (browserSettled.status === 'rejected') {
                            log(`[BROWSER] retry flow ล้มเหลว: ${browserSettled.reason?.message || browserSettled.reason}`);
                        }

                        const retryOutcome = checkSettled.status === 'fulfilled'
                            ? checkSettled.value
                            : { retrySuccess: false, result: null, sentTelegram: false, sentDiscord: false };
                        if (checkSettled.status === 'rejected') {
                            log(`[❌] Node: check serial retry flow ล้มเหลว: ${checkSettled.reason?.message || checkSettled.reason}`);
                        }

                        if (retryOutcome.retrySuccess) {
                            redeemResult = retryOutcome.result;
                            sentTele = retryOutcome.sentTelegram || sentTele;
                            sentDisc = retryOutcome.sentDiscord || sentDisc;
                        }

                        const browserSuccess = browserResult && browserResult.success === true;
                        if (browserSuccess || retryOutcome.retrySuccess) {
                            log(`[+] Node: parallel retry จบสำเร็จ (Browser=${browserSuccess ? 'สำเร็จ' : 'ไม่สำเร็จ'}, Check=${retryOutcome.retrySuccess ? 'สำเร็จ' : 'ไม่สำเร็จ'})`);
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
                                            messageToSend = `${varCode}\n${itemDetails}`;
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

                        await runBrowserRedeemAfterNotification(varCode);


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
    const hasDiscord = Array.isArray(config.discord_webhook_url) ? config.discord_webhook_url.length > 0 : !!config.discord_webhook_url;
    log(`  แจ้งเตือน Discord: ${hasDiscord ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}`);
    log(`  Browser login ดึง access_token: ${config.browser_token_login_enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}`);
    log(`  Browser itemcode ด้วยบัญชีสำรอง: ${config.browser_redeem_enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}`);
    if (config.proxy_url) {
        log(`  Proxy Server: ${config.proxy_url}`);
        log(`  [⚠️] บอทจะเชื่อมต่อผ่าน Proxy Server อัตโนมัติ`);
    }
    log(`==================================================\n`);

    const browserRedeemArgIdx = process.argv.findIndex(arg => arg === '--test-browser-redeem');
    if (browserRedeemArgIdx !== -1 && process.argv[browserRedeemArgIdx + 1]) {
        const testCode = process.argv[browserRedeemArgIdx + 1].trim().toUpperCase();
        log(`\n==================================================`);
        log(`[🧪] โหมดทดสอบ browser itemcode: ${testCode}`);
        log(`==================================================`);

        if (!config.username2 || !config.password2) {
            log(`[RESULT] ไม่ได้กำหนด username2/password2 ใน service_config.json`);
            process.exit(1);
        }

        const result = await redeemCodeWithBrowser(testCode, config.username2, config.password2);
        log(`[RESULT] ${JSON.stringify({
            completed: result.completed,
            success: result.success,
            stage: result.stage,
            maintenance: result.maintenance,
            url: result.url,
            title: result.title,
            message: result.message
        }, null, 2)}`);
        process.exit(result.completed ? 0 : 1);
    }

    if (process.argv.includes('--test-browser-token-login')) {
        log(`\n==================================================`);
        log(`[🧪] โหมดทดสอบ Browser login และดึง access_token`);
        log(`==================================================`);
        if (!config.username || !config.password) {
            log(`[RESULT] ไม่ได้กำหนด username/password ใน service_config.json`);
            process.exit(1);
        }
        const ok = await loginWithBrowserForAccessToken(config.username, config.password);
        log(`[RESULT] Browser token login: ${ok ? 'สำเร็จ' : 'ไม่สำเร็จ'}`);
        process.exit(ok ? 0 : 1);
    }

    // Check CLI argument for manual token setting
    const tokenArgIdx = process.argv.findIndex(arg => arg === '--set-token' || arg === '--token');
    if (tokenArgIdx !== -1 && process.argv[tokenArgIdx + 1]) {
        const rawToken = process.argv[tokenArgIdx + 1].replace("Bearer ", "").trim();
        log(`[*] กำลังบันทึก Access Token ใหม่จากคำสั่ง...`);
        saveSession(rawToken, config.username || "ManualUser");
        accessToken = rawToken;
        logTokenExpiration(rawToken);
    }

    // 1. Try loading existing session token
    const savedToken = loadSession();
    let primaryLoginSuccess = false;

    if (savedToken) {
        log(`[*] พบ Session Token ที่เคยบันทึกไว้ กำลังตรวจสอบความถูกต้อง...`);
        const isValid = await verifyToken(savedToken);
        if (isValid) {
            log(`[+] Session Token ใช้งานได้ปกติ! ข้ามการล็อกอินผ่าน Cloudflare`);
            logTokenExpiration(savedToken);
            primaryLoginSuccess = true;
        } else {
            log(`[-] Session Token เดิมหมดอายุแล้ว`);
        }
    }

    // 2. Auto login if no valid session token exists and credentials provided
    if (!primaryLoginSuccess && config.username && config.password) {
        if (config.browser_token_login_enabled !== false) {
            log(`[*] พบข้อมูลล็อกอินในค่าตั้งค่า กำลัง login ผ่าน Browser เพื่อดึง access_token...`);
            primaryLoginSuccess = await loginWithBrowserForAccessToken(config.username, config.password);
        }

        if (!primaryLoginSuccess) {
            log(`[*] กำลังใช้ OAuth PKCE login เป็น fallback...`);
            primaryLoginSuccess = await loginWithCredentials(config.username, config.password);
        }

        if (primaryLoginSuccess) {
            log(`[+] เชื่อมต่อบัญชีผู้ใช้ HOF สำเร็จ! (${config.username}) ระบบจะทำการเคลมโค้ดอัตโนมัติ`);
        } else {
            log(`[-] ไม่สามารถเชื่อมต่อบัญชี HOF ได้ทั้ง Browser login และ OAuth PKCE`);
            log(`[💡] คำแนะนำ: กรุณาล็อกอินผ่านเบราว์เซอร์ แล้วนำ Bearer Token มาตั้งค่าด้วยคำสั่ง:`);
            log(`     node index.js --set-token <YOUR_BEARER_TOKEN>`);
            await notifyTokenExpired();
        }
    } else if (!primaryLoginSuccess) {
        await notifyTokenExpired();
    }

    if (process.argv.includes('--test-login')) {
        log(`\n==================================================`);
        log(`[🧪] โหมดทดสอบการล็อกอิน (--test-login)`);
        log(`[1] บัญชีหลัก (${config.username || 'ไม่ได้ระบุ'}): ${primaryLoginSuccess ? '✅ สำเร็จ' : '❌ ล้มเหลว (ติด Cloudflare Verification)'}`);
        
        if (config.username2 && config.password2) {
            log(`[*] กำลังทดสอบล็อกอินบัญชีสำรอง (${config.username2})...`);
            const secSuccess = await loginWithCredentials(config.username2, config.password2);
            log(`[2] บัญชีสำรอง (${config.username2}): ${secSuccess ? '✅ สำเร็จ' : '❌ ล้มเหลว'}`);
        }
        log(`==================================================`);
        process.exit(primaryLoginSuccess ? 0 : 1);
    }

    const redeemArgIdx = process.argv.findIndex(arg => arg === '--redeem' || arg === '--check');
    if (redeemArgIdx !== -1 && process.argv[redeemArgIdx + 1]) {
        const testCode = process.argv[redeemArgIdx + 1].trim().toUpperCase();
        log(`\n==================================================`);
        log(`[🎯] โหมดทดสอบตรวจสอบรหัสไอเทมโค้ด: ${testCode}`);
        log(`==================================================`);
        const result = await redeemCode(testCode);
        log(`[RESULT] ผลลัพธ์: ${JSON.stringify(result, null, 2)}`);
        process.exit(result.success || result.checkSuccess ? 0 : 1);
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
