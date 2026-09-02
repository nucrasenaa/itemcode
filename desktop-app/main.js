const {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    shell
} = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SERVICE_SOURCE_DIR = path.join(PROJECT_ROOT, 'equality-itemcode-version');
const REQUIREMENT_LINKS = {
    node: 'https://nodejs.org/en/download',
    ytdlp: 'https://github.com/yt-dlp/yt-dlp/releases/latest',
    ffmpeg: 'https://ffmpeg.org/download.html',
    ocr: 'https://github.com/Apple/Vision',
    browser: 'https://playwright.dev/docs/browsers'
};

function requirementLink(id) {
    if (id === 'ocr' && process.platform === 'win32') {
        return 'https://learn.microsoft.com/windows/apps/develop/windows-integration/ocr';
    }
    return REQUIREMENT_LINKS[id] || REQUIREMENT_LINKS.node;
}

let mainWindow = null;
let serviceProcess = null;
let serviceMode = 'idle';
let serviceOutputBuffer = '';
let serviceErrorBuffer = '';
let updateCheckInFlight = false;
let updateReady = false;
let updateState = 'idle';
let updateInfo = null;

// Download updates automatically, then let the user choose when to restart.
// autoInstallOnAppQuit also covers the case where the user closes the app
// after the update has finished downloading.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function updatePayload(extra = {}) {
    return {
        state: updateState,
        currentVersion: app.getVersion(),
        updateReady,
        version: updateInfo?.version || '',
        releaseDate: updateInfo?.releaseDate || '',
        ...extra
    };
}

function setUpdateState(state, extra = {}) {
    updateState = state;
    if (extra.info) updateInfo = extra.info;
    if (state !== 'downloaded') updateReady = false;
    send('update:state', updatePayload(extra));
}

async function checkForUpdates() {
    if (!app.isPackaged) {
        return updatePayload({
            state: 'unavailable',
            message: 'ตรวจสอบ Update ได้เมื่อเปิดจากแอปที่ package แล้วเท่านั้น'
        });
    }
    if (updateReady) {
        return updatePayload({
            state: 'downloaded',
            message: 'มี Update พร้อมติดตั้งแล้ว'
        });
    }
    if (updateCheckInFlight) return updatePayload();

    updateCheckInFlight = true;
    setUpdateState('checking');
    try {
        await autoUpdater.checkForUpdates();
        return updatePayload();
    } catch (error) {
        setUpdateState('error', { message: error.message });
        return updatePayload({ ok: false, message: error.message });
    } finally {
        updateCheckInFlight = false;
    }
}

autoUpdater.on('checking-for-update', () => setUpdateState('checking'));
autoUpdater.on('update-available', info => {
    setUpdateState('available', {
        info,
        message: `พบเวอร์ชัน ${info.version} กำลังดาวน์โหลด...`
    });
});
autoUpdater.on('update-not-available', info => {
    setUpdateState('up-to-date', {
        info,
        message: 'ใช้งานเวอร์ชันล่าสุดแล้ว'
    });
});
autoUpdater.on('download-progress', progress => {
    setUpdateState('downloading', {
        percent: Number(progress.percent || 0),
        bytesPerSecond: Number(progress.bytesPerSecond || 0),
        transferred: Number(progress.transferred || 0),
        total: Number(progress.total || 0)
    });
});
autoUpdater.on('update-downloaded', info => {
    updateReady = true;
    updateInfo = info;
    updateState = 'downloaded';
    send('update:state', updatePayload({
        info,
        message: `ดาวน์โหลดเวอร์ชัน ${info.version} แล้ว`
    }));
});
autoUpdater.on('error', error => {
    setUpdateState('error', { message: error.message });
});

function runtimeDir() {
    if (!app.isPackaged) return SERVICE_SOURCE_DIR;
    return path.join(app.getPath('userData'), 'runtime');
}

function appDataDir() {
    return path.join(app.getPath('userData'), 'itemcode');
}

function expandPath(value) {
    if (!value || typeof value !== 'string') return value;
    return value
        .replace(/\$\{HOMEDIR\}/g, os.homedir())
        .replace(/%([^%]+)%/g, (_match, name) => process.env[name] || process.env[name.toUpperCase()] || _match);
}

function stripJsonComments(text) {
    return text.replace(/^\s*\/\/.*$/gm, '');
}

function normalizeItemcodeAccounts(source = {}) {
    const rawAccounts = Array.isArray(source.itemcodeAccounts)
        ? source.itemcodeAccounts
        : Array.isArray(source.itemcode_accounts)
            ? source.itemcode_accounts
            : [];
    const accounts = rawAccounts
        .map(account => ({
            username: String(account?.username || '').trim(),
            password: String(account?.password || '')
        }))
        .filter(account => account.username && account.password);

    if (accounts.length === 0 && source.username2 && source.password2) {
        accounts.push({
            username: String(source.username2).trim(),
            password: String(source.password2)
        });
    }
    return accounts;
}

function applyItemcodeAccounts(config, source) {
    const accounts = normalizeItemcodeAccounts(source);
    config.itemcode_accounts = accounts;
    // Keep the legacy fields in sync so older service configs remain usable.
    config.username2 = accounts[0]?.username || '';
    config.password2 = accounts[0]?.password || '';
    return accounts;
}

function normalizeDiscordWebhooks(source = {}) {
    const raw = Array.isArray(source.discordWebhookUrls)
        ? source.discordWebhookUrls
        : Array.isArray(source.discord_webhook_urls)
            ? source.discord_webhook_urls
            : Array.isArray(source.discord_webhook_url)
                ? source.discord_webhook_url
                : typeof source.discord_webhook_url === 'string'
                    ? source.discord_webhook_url.split(',')
                    : source.discordWebhookUrl
                        ? [source.discordWebhookUrl]
                        : [];
    return raw.map(url => String(url || '').trim()).filter(Boolean);
}

function applyDiscordWebhooks(config, source) {
    const urls = normalizeDiscordWebhooks(source);
    config.discord_webhook_url = urls;
    config.discord_webhook_urls = urls;
    return urls;
}

function ensureRuntimeDirectory() {
    if (!app.isPackaged) return SERVICE_SOURCE_DIR;

    const source = path.join(process.resourcesPath, 'equality-itemcode-version');
    const target = runtimeDir();
    if (!fs.existsSync(path.join(source, 'index.js'))) {
        throw new Error(`ไม่พบ service runtime ใน ${source}`);
    }
    fs.mkdirSync(target, { recursive: true });
    // Refresh bundled service code on app upgrades while preserving the
    // user's config and downloaded node_modules/browser dependencies.
    for (const file of [
        'index.js',
        'package.json',
        'package-lock.json',
        'playwright_login.mjs',
        'browser_login_test.mjs',
        'ocr_helper.ps1',
        'ocr_helper.swift',
        'service_config.json.example'
    ]) {
        const from = path.join(source, file);
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(target, file));
    }
    for (const file of ['ocr_helper', 'ocr_helper.swift']) {
        const from = path.join(source, file);
        if (fs.existsSync(from) && process.platform === 'darwin') {
            fs.copyFileSync(from, path.join(target, file));
        }
    }
    if (process.platform === 'darwin') {
        const ocrHelper = path.join(target, 'ocr_helper');
        if (fs.existsSync(ocrHelper)) fs.chmodSync(ocrHelper, 0o755);
    }
    return target;
}

function configPath() {
    return path.join(runtimeDir(), 'service_config.json');
}

function readConfig() {
    const file = configPath();
    try {
        if (!fs.existsSync(file)) {
            const example = path.join(runtimeDir(), 'service_config.json.example');
            if (fs.existsSync(example)) {
                fs.copyFileSync(example, file);
            } else {
                fs.writeFileSync(file, JSON.stringify({
                    youtube_url: '',
                    username: '',
                    password: '',
                    itemcode_accounts: [],
                    username2: '',
                    password2: '',
                    discord_webhook_url: [],
                    discord_webhook_urls: [],
                    discord_enabled: false,
                    browser_redeem_enabled: true,
                    browser_redeem_headless: true,
                    browser_token_login_enabled: true,
                    browser_token_login_headless: true
                }, null, 2));
            }
        }
        return JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8')));
    } catch (error) {
        throw new Error(`อ่าน service_config.json ไม่สำเร็จ: ${error.message}`);
    }
}

function writeConfig(config) {
    const file = configPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, file);
}

function send(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
}

function runVersion(command, args = ['--version']) {
    return new Promise(resolve => {
        execFile(command, args, { timeout: 5000, windowsHide: true, env: toolEnvironment() }, (error, stdout, stderr) => {
            const output = String(stdout || stderr || '').trim();
            resolve({
                ok: !error,
                output: output.split(/\r?\n/)[0].slice(0, 160),
                error: error ? error.message : ''
            });
        });
    });
}

async function findWorkingCommand(candidates, args = ['--version']) {
    for (const candidate of candidates.filter(Boolean)) {
        const resolved = resolveExecutable(candidate);
        const result = await runVersion(resolved, args);
        if (result.ok) return { command: resolved, ...result };
    }
    return null;
}

function uniquePaths(values) {
    return [...new Set(values.filter(Boolean))];
}

function childDirectoryNames(root) {
    if (!root || !fs.existsSync(root)) return [];
    try {
        return fs.readdirSync(root, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
    } catch (error) {
        return [];
    }
}

function macNodeVersionDirectories() {
    if (process.platform !== 'darwin') return [];
    const home = os.homedir();
    const nvmRoot = path.join(home, '.nvm', 'versions', 'node');
    const fnmRoots = [
        path.join(home, 'Library', 'Application Support', 'fnm', 'node-versions'),
        path.join(home, '.local', 'share', 'fnm', 'node-versions'),
        path.join(home, '.fnm', 'node-versions')
    ];
    const directories = childDirectoryNames(nvmRoot)
        .map(version => path.join(nvmRoot, version, 'bin'));
    for (const root of fnmRoots) {
        for (const version of childDirectoryNames(root)) {
            directories.push(path.join(root, version, 'installation', 'bin'));
        }
    }
    return uniquePaths(directories);
}

function macPythonScriptDirectories() {
    if (process.platform !== 'darwin') return [];
    const pythonRoot = path.join(os.homedir(), 'Library', 'Python');
    return childDirectoryNames(pythonRoot)
        .filter(version => /^\d+(\.\d+)?$/.test(version))
        .map(version => path.join(pythonRoot, version, 'bin'));
}

function macExecutableDirectories() {
    if (process.platform !== 'darwin') return [];
    const home = os.homedir();
    return uniquePaths([
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/bin',
        '/usr/local/sbin',
        '/opt/local/bin',
        path.join(home, 'bin'),
        path.join(home, '.local', 'bin'),
        path.join(home, '.volta', 'bin'),
        path.join(home, '.asdf', 'shims'),
        path.join(home, '.pyenv', 'shims'),
        path.join(home, 'Library', 'pnpm'),
        ...macNodeVersionDirectories(),
        ...macPythonScriptDirectories()
    ]);
}

function macHomebrewFormulaCandidates(formula, binary) {
    if (process.platform !== 'darwin') return [];
    const candidates = [];
    for (const cellarRoot of [
        path.join('/opt/homebrew', 'Cellar', formula),
        path.join('/usr/local', 'Cellar', formula)
    ]) {
        for (const version of childDirectoryNames(cellarRoot)) {
            candidates.push(path.join(cellarRoot, version, 'bin', binary));
        }
    }
    return candidates;
}

function macToolCandidates(tool) {
    if (process.platform !== 'darwin') return [];
    const home = os.homedir();
    const candidates = macExecutableDirectories().map(directory => path.join(directory, tool));

    if (tool === 'node') {
        candidates.push(
            ...nvmNodeCandidates(),
            ...(process.env.NVM_BIN ? [path.join(expandPath(process.env.NVM_BIN), 'node')] : []),
            ...macHomebrewFormulaCandidates('node', 'node')
        );
    }
    if (tool === 'yt-dlp') {
        candidates.push(
            path.join(appDataDir(), 'tools', 'yt-dlp'),
            path.join(home, '.local', 'pipx', 'venvs', 'yt-dlp', 'bin', 'yt-dlp'),
            path.join(home, '.local', 'share', 'pipx', 'venvs', 'yt-dlp', 'bin', 'yt-dlp'),
            path.join(home, 'Library', 'Application Support', 'pipx', 'venvs', 'yt-dlp', 'bin', 'yt-dlp'),
            path.join('/opt/homebrew', 'opt', 'yt-dlp', 'bin', 'yt-dlp'),
            path.join('/usr/local', 'opt', 'yt-dlp', 'bin', 'yt-dlp'),
            ...macHomebrewFormulaCandidates('yt-dlp', 'yt-dlp')
        );
    }
    if (tool === 'ffmpeg') {
        candidates.push(
            path.join(appDataDir(), 'tools', 'ffmpeg'),
            path.join('/opt/homebrew', 'opt', 'ffmpeg', 'bin', 'ffmpeg'),
            path.join('/usr/local', 'opt', 'ffmpeg', 'bin', 'ffmpeg'),
            path.join('/opt/local', 'bin', 'ffmpeg'),
            ...macHomebrewFormulaCandidates('ffmpeg', 'ffmpeg')
        );
    }
    if (tool === 'brew') {
        candidates.push(
            process.env.HOMEBREW_PREFIX ? path.join(expandPath(process.env.HOMEBREW_PREFIX), 'bin', 'brew') : '',
            'brew'
        );
    }
    return uniquePaths(candidates);
}

function resolveExecutable(command) {
    const expanded = expandPath(command);
    if (!expanded || path.isAbsolute(expanded) || expanded.includes('/') || expanded.includes('\\')) {
        return expanded;
    }
    if (process.platform === 'darwin') {
        const candidate = macToolCandidates(expanded).find(file => fs.existsSync(file));
        if (candidate) return candidate;
    }
    return expanded;
}

function toolEnvironment(overrides = {}) {
    const currentPath = String(process.env.PATH || '').split(path.delimiter);
    const extraPath = process.platform === 'darwin' ? macExecutableDirectories() : [];
    return {
        ...process.env,
        PATH: uniquePaths([...currentPath, ...extraPath]).join(path.delimiter),
        ...overrides
    };
}

function windowsFfmpegCandidates() {
    if (process.platform !== 'win32') return [];

    const candidates = [];
    const wingetRoots = [
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages'),
        path.join(process.env.ProgramFiles || '', 'Microsoft', 'WinGet', 'Packages')
    ].filter(root => root && fs.existsSync(root));

    for (const root of wingetRoots) {
        try {
            const packages = fs.readdirSync(root, { withFileTypes: true })
                .filter(entry => entry.isDirectory() && entry.name.toLowerCase().includes('ffmpeg'))
                .map(entry => path.join(root, entry.name));
            for (const packageRoot of packages) {
                candidates.push(path.join(packageRoot, 'bin', 'ffmpeg.exe'));
                const builds = fs.readdirSync(packageRoot, { withFileTypes: true })
                    .filter(entry => entry.isDirectory())
                    .map(entry => path.join(packageRoot, entry.name));
                for (const buildRoot of builds) {
                    candidates.push(path.join(buildRoot, 'bin', 'ffmpeg.exe'));
                }
            }
        } catch (error) { }
    }

    candidates.push(
        path.join(process.env.LOCALAPPDATA || '', 'ffmpeg', 'bin', 'ffmpeg.exe'),
        path.join(process.env.ProgramFiles || '', 'ffmpeg', 'bin', 'ffmpeg.exe'),
        path.join(process.env.ProgramFiles || '', 'FFmpeg', 'bin', 'ffmpeg.exe')
    );

    return uniquePaths(candidates)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
}

function nvmNodeCandidates() {
    const candidates = [];
    const addVersionedNodes = (root, executable) => {
        if (!root || !fs.existsSync(root)) return;
        try {
            const entries = fs.readdirSync(root, { withFileTypes: true })
                .filter(entry => entry.isDirectory())
                .map(entry => entry.name)
                .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
            for (const entry of entries) candidates.push(path.join(root, entry, executable));
        } catch (error) { }
    };

    // Unix nvm: ~/.nvm/versions/node/v20.x/bin/node
    const nvmDir = expandPath(process.env.NVM_DIR || path.join(os.homedir(), '.nvm'));
    addVersionedNodes(path.join(nvmDir, 'versions', 'node'), process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'));

    // nvm-windows: %NVM_HOME%\v20.x\node.exe or %APPDATA%\nvm\v20.x\node.exe
    if (process.platform === 'win32') {
        addVersionedNodes(expandPath(process.env.NVM_HOME || ''), 'node.exe');
        addVersionedNodes(path.join(process.env.APPDATA || '', 'nvm'), 'node.exe');
        if (process.env.NVM_SYMLINK) candidates.push(path.join(expandPath(process.env.NVM_SYMLINK), 'node.exe'));
    }
    return candidates;
}

function nodeCommandCandidates() {
    const systemCandidates = process.platform === 'win32'
        ? ['node.exe', 'node', 'C:\\Program Files\\nodejs\\node.exe', path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe')]
        : ['node'];
    // Put nvm paths first so a GUI launched outside the shell still finds the
    // same Node.js installation used by the user's terminal.
    const macCandidates = process.platform === 'darwin' ? macToolCandidates('node') : [];
    return uniquePaths([...macCandidates, ...nvmNodeCandidates(), ...systemCandidates]);
}

async function findNodeCommand(candidates = nodeCommandCandidates()) {
    let fallback = null;
    for (const candidate of candidates) {
        const resolved = resolveExecutable(candidate);
        const result = await runVersion(resolved);
        if (!result.ok) continue;
        const major = Number(result.output.match(/v(\d+)/i)?.[1] || 0);
        const found = { command: resolved, ...result, major };
        if (major >= 20) return found;
        fallback ||= found;
    }
    return fallback;
}

function npmCommandForNode(nodeCommand) {
    if (path.isAbsolute(nodeCommand)) {
        const directory = path.dirname(nodeCommand);
        const localNpm = path.join(directory, process.platform === 'win32' ? 'npm.cmd' : 'npm');
        if (fs.existsSync(localNpm)) return localNpm;
    }
    return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function pathCandidates(config, key, fallbackNames) {
    const configured = [config[key], config[`${key}_mac`], config[`${key}_win`], config[`${key}_linux`]];
    const dynamic = key === 'ffmpeg_path'
        ? (process.platform === 'win32' ? windowsFfmpegCandidates() : macToolCandidates('ffmpeg'))
        : key === 'ytdl_path' && process.platform === 'darwin'
            ? macToolCandidates('yt-dlp')
            : [];
    return [...configured, ...dynamic, ...fallbackNames].filter(Boolean).map(candidate => {
        const expanded = expandPath(candidate);
        if (expanded.includes('/') || expanded.includes('\\')) {
            return path.isAbsolute(expanded) ? expanded : path.resolve(runtimeDir(), expanded);
        }
        return expanded;
    });
}

function browserCacheCandidates() {
    return [
        path.join(appDataDir(), 'playwright-browsers'),
        path.join(os.homedir(), '.cache', 'ms-playwright'),
        path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
        path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright-go'),
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : '',
        process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0'
            ? process.env.PLAYWRIGHT_BROWSERS_PATH
            : ''
    ].filter(Boolean);
}

function hasChromiumBrowser(cachePath) {
    if (!cachePath || !fs.existsSync(cachePath)) return false;
    try {
        return fs.readdirSync(cachePath, { withFileTypes: true })
            .some(entry => entry.isDirectory() && entry.name.toLowerCase().startsWith('chromium-'));
    } catch (error) {
        return false;
    }
}

async function checkRequirements() {
    const runtime = runtimeDir();
    const config = readConfig();
    const node = await findNodeCommand();
    const nodeReady = Boolean(node && node.major >= 20);

    const ytdlp = await findWorkingCommand(pathCandidates(config, 'ytdl_path', process.platform === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp']));
    const ffmpeg = await findWorkingCommand(pathCandidates(config, 'ffmpeg_path', process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg']), ['-version']);

    let ocrPath = process.platform === 'win32'
        ? path.join(runtime, 'ocr_helper.ps1')
        : expandPath(config.ocr_helper_path || config.ocr_helper_path_mac || path.join(runtime, 'ocr_helper'));
    if (!path.isAbsolute(ocrPath)) ocrPath = path.resolve(runtime, ocrPath);
    const ocrReady = process.platform === 'win32'
        ? fs.existsSync(ocrPath)
        : fs.existsSync(ocrPath) && fs.statSync(ocrPath).isFile();

    const playwrightPath = path.join(runtime, 'node_modules', 'playwright');
    const hasPlaywrightPackage = fs.existsSync(playwrightPath);
    const hasBrowserCache = [
        ...browserCacheCandidates(),
        path.join(runtime, 'node_modules', '.local-browsers'),
        path.join(runtime, 'node_modules', 'playwright-core', '.local-browsers')
    ].some(hasChromiumBrowser);
    const browserReady = hasPlaywrightPackage && hasBrowserCache;

    return [
        {
            id: 'node',
            label: 'Node.js 20+',
            ready: nodeReady,
            version: node?.output || '',
            detail: nodeReady
                ? `${node.command.includes('.nvm') || node.command.includes('\\nvm\\') ? 'พร้อมใช้งานจาก nvm' : 'พร้อมใช้งาน'}: ${node.command}`
                : node
                    ? `พบ ${node.output} แต่ต้องใช้เวอร์ชัน 20 ขึ้นไป`
                    : 'ยังไม่พบ Node.js ใน PATH หรือ nvm',
            canDownload: true,
            command: node?.command || ''
        },
        {
            id: 'ytdlp',
            label: 'yt-dlp',
            ready: Boolean(ytdlp),
            version: ytdlp?.output || '',
            detail: ytdlp ? `พร้อมใช้งาน: ${ytdlp.command}` : 'ใช้สำหรับอ่านลิงก์สตรีม',
            canDownload: true,
            command: ytdlp?.command || ''
        },
        {
            id: 'ffmpeg',
            label: 'FFmpeg',
            ready: Boolean(ffmpeg),
            version: ffmpeg?.output || '',
            detail: ffmpeg ? `พร้อมใช้งาน: ${ffmpeg.command}` : 'ใช้สำหรับจับภาพจากสตรีม',
            canDownload: true,
            command: ffmpeg?.command || ''
        },
        {
            id: 'ocr',
            label: process.platform === 'win32' ? 'Windows OCR' : 'Apple Vision OCR',
            ready: ocrReady,
            version: '',
            detail: ocrReady ? 'พร้อมใช้งาน' : 'ไม่พบตัวช่วย OCR ของระบบ',
            canDownload: true,
            command: ocrPath
        },
        {
            id: 'browser',
            label: 'Playwright Chromium',
            ready: browserReady,
            version: '',
            detail: browserReady ? 'พร้อมใช้งาน' : !hasPlaywrightPackage ? 'ยังไม่พบแพ็กเกจ Browser' : 'ยังไม่พบ Chromium ที่ดาวน์โหลดไว้',
            canDownload: true,
            command: playwrightPath
        }
    ];
}

function persistDetectedToolPaths(config, requirements) {
    let changed = false;
    const platformSuffix = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    for (const [id, configKey] of [['node', 'node_path'], ['ytdlp', 'ytdl_path'], ['ffmpeg', 'ffmpeg_path']]) {
        const requirement = requirements.find(item => item.id === id);
        if (!requirement?.command) continue;
        const platformKey = `${configKey}_${platformSuffix}`;
        if (config[configKey] !== requirement.command) {
            config[configKey] = requirement.command;
            changed = true;
        }
        if (config[platformKey] !== requirement.command) {
            config[platformKey] = requirement.command;
            changed = true;
        }
    }
    return changed;
}

async function repairRequirementPaths() {
    const config = readConfig();
    const requirements = await checkRequirements();
    const changed = persistDetectedToolPaths(config, requirements);
    if (changed) writeConfig(config);
    return { requirements, changed };
}

function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const cwd = options.cwd || process.cwd();
        if (!command || !fs.existsSync(cwd)) {
            return reject(new Error(`ไม่สามารถเริ่มคำสั่งได้: command=${command || '(ว่าง)'} cwd=${cwd}`));
        }
        const useWindowsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
        // cmd.exe splits an unquoted path such as `C:\Program Files\...` at
        // the space when shell mode is used.
        const spawnCommand = useWindowsShell && !/^".*"$/.test(command)
            ? `"${command}"`
            : command;
        const child = spawn(spawnCommand, args, {
            cwd,
            env: toolEnvironment(options.env || {}),
            windowsHide: true,
            shell: useWindowsShell,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = '';
        child.stdout.on('data', data => {
            output += data.toString();
            if (options.onOutput) options.onOutput(data.toString());
        });
        child.stderr.on('data', data => {
            output += data.toString();
            if (options.onOutput) options.onOutput(data.toString());
        });
        child.once('error', error => reject(new Error(`${error.message} (command=${command}, cwd=${cwd})`)));
        child.once('close', code => code === 0 ? resolve(output) : reject(new Error(output || `process exited with ${code}`)));
    });
}

function downloadFile(url, destination, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error('ดาวน์โหลดถูก redirect มากเกินไป'));
        const client = url.startsWith('https:') ? require('https') : require('http');
        const request = client.get(url, response => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
                response.resume();
                return resolve(downloadFile(new URL(response.headers.location, url).toString(), destination, redirects + 1));
            }
            if (response.statusCode !== 200) {
                response.resume();
                return reject(new Error(`ดาวน์โหลดไม่สำเร็จ (HTTP ${response.statusCode})`));
            }
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            const output = fs.createWriteStream(destination);
            response.pipe(output);
            output.once('finish', () => output.close(resolve));
            output.once('error', error => {
                output.destroy();
                reject(error);
            });
        });
        request.once('error', reject);
    });
}

async function installWithSystemPackageManager(id, config) {
    const packageNames = {
        node: { mac: 'node', win: 'OpenJS.NodeJS.LTS' },
        ffmpeg: { mac: 'ffmpeg', win: 'Gyan.FFmpeg' }
    };
    const packageName = packageNames[id]?.[process.platform === 'darwin' ? 'mac' : 'win'];
    if (!packageName) return false;

    if (process.platform === 'darwin') {
        const brew = await findWorkingCommand(
            process.platform === 'darwin' ? [...macToolCandidates('brew'), 'brew'] : ['brew'],
            ['--version']
        );
        if (!brew) return false;
        await runCommand(brew.command, ['install', packageName], {
            onOutput: output => send('requirements:progress', { id, text: output.slice(-500) })
        });
        if (id === 'ffmpeg') {
            const prefix = await runCommand(brew.command, ['--prefix', packageName]);
            const binary = path.join(prefix.trim(), 'bin', 'ffmpeg');
            if (fs.existsSync(binary)) config.ffmpeg_path_mac = binary;
        }
        writeConfig(config);
        return true;
    }

    if (process.platform === 'win32') {
        const winget = await findWorkingCommand(['winget.exe', 'winget'], ['--version']);
        if (!winget) return false;
        await runCommand(winget.command, [
            'install', '--id', packageName, '-e',
            '--accept-source-agreements', '--accept-package-agreements'
        ], {
            onOutput: output => send('requirements:progress', { id, text: output.slice(-500) })
        });
        return true;
    }
    return false;
}

async function downloadRequirement(id) {
    const runtime = runtimeDir();
    const config = readConfig();
    const toolDir = path.join(appDataDir(), 'tools');

    if (id === 'ytdlp') {
        const fileName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
        const destination = path.join(toolDir, fileName);
        const url = process.platform === 'win32'
            ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
            : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
        await downloadFile(url, destination);
        if (process.platform !== 'win32') fs.chmodSync(destination, 0o755);
        try {
            fs.accessSync(destination, fs.constants.R_OK | fs.constants.X_OK);
        } catch (error) {
            throw new Error(`ดาวน์โหลด yt-dlp แล้ว แต่ไฟล์ไม่มีสิทธิ์ Execute: ${destination}`);
        }
        const verified = await findWorkingCommand([destination]);
        if (!verified) {
            const diagnostic = await runVersion(destination);
            throw new Error(`ดาวน์โหลด yt-dlp แล้ว แต่ไม่สามารถเรียกใช้งานได้: ${diagnostic.error || diagnostic.output || 'ไม่ทราบสาเหตุ'}\nPath: ${destination}`);
        }
        config.ytdl_path = verified.command;
        config[process.platform === 'win32' ? 'ytdl_path_win' : 'ytdl_path_mac'] = verified.command;
        writeConfig(config);
        return { message: `ดาวน์โหลด yt-dlp และตั้งค่า Path แล้ว: ${verified.command}`, path: verified.command };
    }

    if (id === 'browser') {
        const node = await findNodeCommand();
        if (!node) throw new Error('ต้องติดตั้ง Node.js ก่อนดาวน์โหลด Chromium');
        if (!fs.existsSync(runtime)) fs.mkdirSync(runtime, { recursive: true });
        const browserPath = path.join(appDataDir(), 'playwright-browsers');
        fs.mkdirSync(browserPath, { recursive: true });
        let playwrightCli = path.join(runtime, 'node_modules', 'playwright', 'cli.js');
        if (!fs.existsSync(playwrightCli)) {
            // Packaged builds already contain the service dependencies. Copy
            // them into the writable runtime first so an upgrade does not
            // depend on a broken npm bundled with an nvm installation.
            const bundledModules = app.isPackaged
                ? path.join(process.resourcesPath, 'equality-itemcode-version', 'node_modules')
                : '';
            const bundledPlaywright = path.join(bundledModules, 'playwright', 'cli.js');
            if (bundledModules && fs.existsSync(bundledPlaywright)) {
                fs.mkdirSync(path.join(runtime, 'node_modules'), { recursive: true });
                fs.cpSync(bundledModules, path.join(runtime, 'node_modules'), { recursive: true, force: true });
            } else {
                const npmCommand = npmCommandForNode(node.command);
                await runCommand(npmCommand, ['install', '--omit=dev'], {
                    cwd: runtime,
                    onOutput: output => send('requirements:progress', { id, text: output.slice(-500) })
                });
            }
            playwrightCli = path.join(runtime, 'node_modules', 'playwright', 'cli.js');
        }
        if (!fs.existsSync(playwrightCli)) {
            throw new Error('ยังไม่พบ Playwright ใน equality-itemcode-version/node_modules ให้ติดตั้ง dependencies ของ service ก่อน');
        }
        await runCommand(node.command, [playwrightCli, 'install', 'chromium'], {
            cwd: runtime,
            env: { PLAYWRIGHT_BROWSERS_PATH: browserPath },
            onOutput: output => send('requirements:progress', { id, text: output.slice(-500) })
        });
        return { message: 'ดาวน์โหลด Playwright Chromium แล้ว' };
    }

    if (id === 'node' || id === 'ffmpeg') {
        if (await installWithSystemPackageManager(id, config)) {
            return { message: `ติดตั้ง ${id === 'node' ? 'Node.js' : 'FFmpeg'} แล้ว` };
        }
    }

    if (id === 'ocr' && process.platform !== 'win32') {
        const swift = await findWorkingCommand(['swiftc'], ['--version']);
        const source = path.join(runtime, 'ocr_helper.swift');
        const destination = path.join(runtime, 'ocr_helper');
        if (swift && fs.existsSync(source)) {
            await runCommand(swift.command, [source, '-o', destination, '-framework', 'Vision', '-framework', 'AppKit'], { cwd: runtime });
            fs.chmodSync(destination, 0o755);
            config.ocr_helper_path_mac = destination;
            writeConfig(config);
            return { message: 'สร้าง Apple Vision OCR helper แล้ว' };
        }
    }

    await shell.openExternal(requirementLink(id));
    return { message: 'เปิดหน้าดาวน์โหลดอย่างเป็นทางการแล้ว เมื่อติดตั้งเสร็จให้กดตรวจสอบอีกครั้ง' };
}

function normalizeItemcodeEvent(event) {
    if (!event || !event.code) return null;
    return {
        code: String(event.code).trim().toUpperCase().slice(0, 64),
        status: String(event.status || 'info').slice(0, 32),
        detail: String(event.detail || '').replace(/\s+/g, ' ').trim().slice(0, 500),
        attempt: event.attempt ? Number(event.attempt) : null,
        attemptTotal: event.attemptTotal ? Number(event.attemptTotal) : null,
        time: new Date().toISOString()
    };
}

function parseServiceLine(line) {
    const structured = line.match(/\[ITEMCODE\]\s*(\{.*\})/);
    if (structured) {
        try {
            return normalizeItemcodeEvent(JSON.parse(structured[1]));
        } catch (error) {
            return null;
        }
    }
    return null;
}

function consumeServiceOutput(chunk, bufferName) {
    send('service:log', {
        stream: bufferName,
        text: String(chunk || ''),
        time: new Date().toISOString()
    });
    if (bufferName === 'stdout') serviceOutputBuffer += chunk;
    else serviceErrorBuffer += chunk;
    let buffer = bufferName === 'stdout' ? serviceOutputBuffer : serviceErrorBuffer;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    if (bufferName === 'stdout') serviceOutputBuffer = buffer;
    else serviceErrorBuffer = buffer;

    for (const line of lines) {
        const event = parseServiceLine(line);
        if (event) send('service:itemcode', event);
    }
}

async function startService(settings, serviceArgs = [], mode = 'running') {
    if (serviceProcess) return { running: true };
    const runtime = ensureRuntimeDirectory();
    const config = readConfig();
    const itemcodeAccounts = normalizeItemcodeAccounts(settings);
    applyItemcodeAccounts(config, { itemcodeAccounts });
    const discordWebhookUrls = applyDiscordWebhooks(config, settings);
    Object.assign(config, {
        username: String(settings?.username || '').trim(),
        password: String(settings?.password || ''),
        telegram_token: String(settings?.telegramToken || ''),
        telegram_chat_id: String(settings?.telegramChatId || '').trim(),
        telegram_enabled: Boolean(settings?.telegramEnabled),
        discord_enabled: Boolean(settings?.discordEnabled) && discordWebhookUrls.length > 0,
        browser_redeem_enabled: itemcodeAccounts.length > 0,
        browser_redeem_headless: true,
        browser_token_login_enabled: true,
        browser_token_login_headless: true
    });
    if (process.platform === 'win32') {
        // Do not keep the development-machine Documents path from the sample
        // config when running the packaged service.
        config.ocr_helper_path_win = path.join(runtime, 'ocr_helper.ps1');
        // Desktop has no cookie-picker UI. Match node_service and avoid a
        // stale Chrome DPAPI setting from an older runtime config.
        config.ytdl_cookies_from_browser = '';
    }
    writeConfig(config);

    const requirements = await checkRequirements();
    const missing = requirements.filter(item => !item.ready);
    if (missing.length > 0) {
        throw new Error(`ยังขาด requirement: ${missing.map(item => item.label).join(', ')}`);
    }

    // Persist the executable selected by the requirement check. This prevents
    // a stale WinGet path such as ffmpeg-8.1.1 from being reused after the
    // package was upgraded to another version.
    if (persistDetectedToolPaths(config, requirements)) writeConfig(config);

    const node = requirements.find(item => item.id === 'node');
    serviceOutputBuffer = '';
    serviceErrorBuffer = '';
    serviceMode = mode;
    serviceProcess = spawn(node.command || (process.platform === 'win32' ? 'node.exe' : 'node'), ['index.js', ...serviceArgs], {
        cwd: runtime,
        env: toolEnvironment({
            PLAYWRIGHT_BROWSERS_PATH: path.join(appDataDir(), 'playwright-browsers'),
            BROWSER_TOKEN_LOGIN_HEADLESS: 'true',
            BROWSER_REDEEM_HEADLESS: 'true'
        }),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    serviceProcess.stdout.on('data', chunk => consumeServiceOutput(chunk.toString(), 'stdout'));
    serviceProcess.stderr.on('data', chunk => consumeServiceOutput(chunk.toString(), 'stderr'));
    serviceProcess.once('error', error => {
        const finishedMode = serviceMode;
        serviceProcess = null;
        serviceMode = 'idle';
        send('service:state', { running: false, mode: 'idle', finishedMode, error: error.message });
    });
    serviceProcess.once('close', (code, signal) => {
        const finishedMode = serviceMode;
        serviceProcess = null;
        serviceMode = 'idle';
        send('service:state', { running: false, mode: 'idle', finishedMode, code, signal });
    });
    send('service:state', { running: true, mode });
    return { running: true, mode };
}

async function stopService() {
    if (!serviceProcess) return { running: false };
    const child = serviceProcess;
    child.kill('SIGTERM');
    await new Promise(resolve => {
        const timeout = setTimeout(() => {
            if (serviceProcess === child) child.kill('SIGKILL');
            resolve();
        }, 5000);
        child.once('close', () => {
            clearTimeout(timeout);
            resolve();
        });
    });
    serviceProcess = null;
    serviceMode = 'idle';
    send('service:state', { running: false, mode: 'idle' });
    return { running: false, mode: 'idle' };
}

async function testTelegram(settings) {
    const config = readConfig();
    const token = String(settings?.telegramToken || config.telegram_token || '').trim();
    const chatId = String(settings?.telegramChatId || config.telegram_chat_id || '').trim();
    if (!token || !chatId) {
        return { ok: false, message: 'กรุณากรอก Telegram Bot Token และ Chat ID ก่อนทดสอบ' };
    }

    const text = `✅ Equality ItemCode Watcher\nทดสอบ Telegram สำเร็จ\nเวลา: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`;
    try {
        const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) {
            return { ok: false, message: payload.description || `Telegram ตอบกลับ HTTP ${response.status}` };
        }
        return { ok: true, message: 'ส่งข้อความทดสอบ Telegram สำเร็จแล้ว' };
    } catch (error) {
        return { ok: false, message: `เชื่อมต่อ Telegram ไม่สำเร็จ: ${error.message}` };
    }
}

async function testDiscord(settings) {
    const config = readConfig();
    const urls = normalizeDiscordWebhooks(settings || config);
    if (urls.length === 0) {
        return { ok: false, message: 'กรุณาเพิ่ม Discord Webhook อย่างน้อย 1 รายการก่อนทดสอบ' };
    }

    const payload = {
        username: 'TalesRunner Bot',
        content: `✅ Equality ItemCode Watcher\nทดสอบ Discord สำเร็จ\nเวลา: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`
    };
    let sentCount = 0;
    const failures = [];
    for (const url of urls) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (response.ok) {
                sentCount += 1;
            } else {
                failures.push(`HTTP ${response.status}`);
            }
        } catch (error) {
            failures.push(error.message);
        }
    }
    if (sentCount > 0) {
        return { ok: true, message: `ส่งข้อความทดสอบ Discord สำเร็จ ${sentCount}/${urls.length} webhook` };
    }
    return { ok: false, message: `ส่งข้อความ Discord ไม่สำเร็จ${failures[0] ? `: ${failures[0]}` : ''}` };
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1120,
        height: 780,
        minWidth: 900,
        minHeight: 650,
        backgroundColor: '#08111f',
        title: 'Equality ItemCode Watcher',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('requirements:check', async () => {
    const result = await repairRequirementPaths();
    return result.requirements;
});
ipcMain.handle('requirements:download', async (_event, id) => {
    try {
        const result = await downloadRequirement(id);
        const repaired = await repairRequirementPaths();
        send('requirements:update', repaired.requirements);
        return { ok: true, ...result, pathRepaired: repaired.changed };
    } catch (error) {
        return { ok: false, message: error.message };
    }
});
ipcMain.handle('requirements:repair', async () => {
    try {
        const result = await repairRequirementPaths();
        send('requirements:update', result.requirements);
        return { ok: true, ...result };
    } catch (error) {
        return { ok: false, message: error.message };
    }
});
ipcMain.handle('requirements:help', async (_event, id) => {
    await shell.openExternal(requirementLink(id));
    return { ok: true };
});
ipcMain.handle('settings:load', () => {
    const config = readConfig();
    const itemcodeAccounts = normalizeItemcodeAccounts(config);
    const discordWebhookUrls = normalizeDiscordWebhooks(config);
    return {
        username: config.username || '',
        password: config.password || '',
        itemcodeAccounts,
        telegramToken: config.telegram_token || '',
        telegramChatId: config.telegram_chat_id || '',
        telegramEnabled: config.telegram_enabled !== false && Boolean(config.telegram_token && config.telegram_chat_id),
        discordWebhookUrls,
        discordEnabled: config.discord_enabled !== false && discordWebhookUrls.length > 0
    };
});
ipcMain.handle('settings:save', (_event, settings) => {
    const config = readConfig();
    const itemcodeAccounts = normalizeItemcodeAccounts(settings);
    applyItemcodeAccounts(config, { itemcodeAccounts });
    const discordWebhookUrls = applyDiscordWebhooks(config, settings);
    Object.assign(config, {
        username: String(settings?.username || '').trim(),
        password: String(settings?.password || ''),
        telegram_token: String(settings?.telegramToken || ''),
        telegram_chat_id: String(settings?.telegramChatId || '').trim(),
        telegram_enabled: Boolean(settings?.telegramEnabled),
        discord_enabled: Boolean(settings?.discordEnabled) && discordWebhookUrls.length > 0
    });
    writeConfig(config);
    return { ok: true };
});
ipcMain.handle('service:start', (_event, settings) => startService(settings));
ipcMain.handle('service:test-login', (_event, settings) => startService(settings, ['--test-login'], 'test-login'));
ipcMain.handle('service:test-itemcode', (_event, payload) => {
    const code = String(payload?.code || '').trim().toUpperCase();
    if (!code) throw new Error('กรุณากรอก ItemCode สำหรับทดสอบ');
    return startService(payload?.settings || {}, ['--test-browser-redeem', code], 'test-itemcode');
});
ipcMain.handle('telegram:test', (_event, settings) => testTelegram(settings));
ipcMain.handle('discord:test', (_event, settings) => testDiscord(settings));
ipcMain.handle('service:stop', () => stopService());
ipcMain.handle('service:state', () => ({ running: Boolean(serviceProcess), mode: serviceMode }));
ipcMain.handle('update:status', () => updatePayload());
ipcMain.handle('update:check', () => checkForUpdates());
ipcMain.handle('update:install', async () => {
    if (!updateReady) {
        return { ok: false, message: 'ยังไม่มี Update ที่ดาวน์โหลดเสร็จ' };
    }
    await stopService();
    autoUpdater.quitAndInstall();
    return { ok: true };
});

app.whenReady().then(async () => {
    try {
        ensureRuntimeDirectory();
        readConfig();
        createWindow();
        // Register renderer listeners before the first automatic check.
        setTimeout(() => checkForUpdates(), 3000);
    } catch (error) {
        dialog.showErrorBox('Equality ItemCode Watcher', error.message);
        app.quit();
    }
});

app.on('before-quit', event => {
    if (!serviceProcess) return;
    event.preventDefault();
    stopService().finally(() => app.quit());
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
