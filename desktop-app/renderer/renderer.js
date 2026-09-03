const api = window.itemcodeDesktop;
const elements = {
    requirementsList: document.getElementById('requirementsList'),
    requirementSummary: document.getElementById('requirementSummary'),
    repairRequirementPaths: document.getElementById('repairRequirementPaths'),
    refreshRequirements: document.getElementById('refreshRequirements'),
    workspaceCard: document.getElementById('workspaceCard'),
    itemcodeAccountsList: document.getElementById('itemcodeAccountsList'),
    addItemcodeAccount: document.getElementById('addItemcodeAccount'),
    discordWebhookList: document.getElementById('discordWebhookList'),
    addDiscordWebhook: document.getElementById('addDiscordWebhook'),
    startStop: document.getElementById('startStop'),
    testLogin: document.getElementById('testLogin'),
    testItemcode: document.getElementById('testItemcode'),
    testTelegram: document.getElementById('testTelegram'),
    testDiscord: document.getElementById('testDiscord'),
    checkUpdate: document.getElementById('checkUpdate'),
    openChangelog: document.getElementById('openChangelog'),
    changelogModal: document.getElementById('changelogModal'),
    closeChangelog: document.getElementById('closeChangelog'),
    itemcodeModal: document.getElementById('itemcodeModal'),
    itemcodeForm: document.getElementById('itemcodeForm'),
    testItemcodeValue: document.getElementById('testItemcodeValue'),
    cancelItemcode: document.getElementById('cancelItemcode'),
    runState: document.getElementById('runState'),
    runStateText: document.getElementById('runStateText'),
    configStatus: document.getElementById('configStatus'),
    logList: document.getElementById('logList'),
    emptyLog: document.getElementById('emptyLog'),
    logCount: document.getElementById('logCount'),
    logFilter: document.getElementById('logFilter'),
    debugLog: document.getElementById('debugLog'),
    clearDebugLog: document.getElementById('clearDebugLog'),
    toast: document.getElementById('toast')
};

let requirements = [];
let running = false;
let eventCount = 0;
let toastTimer = null;
let debugLogStarted = false;
let itemcodeAccounts = [{ username: '', password: '' }];
let discordWebhooks = [{ url: '' }];
let draggedAccountIndex = null;
let lastRequirementsReady = null;
let accountOrderSaveQueue = Promise.resolve();
let configRevision = 0;

const SECTION_STATE_PREFIX = 'itemcode.desktop.section.';
const LOG_STATUS_LABELS = {
    available: 'ใช้ได้',
    redeemed: 'รับไอเทมสำเร็จ',
    redeem_failed: 'รับไอเทมไม่สำเร็จ',
    retry: 'กำลัง retry',
    retry_success: 'retry สำเร็จ',
    info: 'ข้อมูล'
};

function showToast(message, error = false) {
    elements.toast.textContent = message;
    elements.toast.classList.toggle('error', error);
    elements.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 4200);
}

function setUpdateState(state = {}) {
    const busy = ['checking', 'downloading', 'verifying'].includes(state.state);
    elements.checkUpdate.disabled = busy;
    elements.checkUpdate.textContent = busy ? 'กำลังตรวจสอบ...' : 'ตรวจสอบ Update';
}

async function checkForUpdate() {
    try {
        const result = await api.checkForUpdate();
        if (result?.state) setUpdateState(result);
    } catch (error) {
        setUpdateState({ state: 'error', message: error.message });
    }
}

function toggleSection(button) {
    const target = button.dataset.target;
    const content = document.getElementById(target);
    if (!content) return;
    setSectionCollapsed(target, !content.classList.contains('collapsed'));
}

function setSectionCollapsed(target, collapsed, persist = true) {
    const content = document.getElementById(target);
    const button = document.querySelector(`.collapse-toggle[data-target="${target}"]`);
    if (!content) return;
    const isCollapsed = Boolean(collapsed);
    content.classList.toggle('collapsed', isCollapsed);
    if (button) {
        button.textContent = isCollapsed ? 'ขยาย' : 'ย่อ';
        button.setAttribute('aria-expanded', String(!isCollapsed));
    }
    if (persist) {
        try {
            localStorage.setItem(`${SECTION_STATE_PREFIX}${target}`, String(isCollapsed));
        } catch (error) {
            // UI state persistence is best-effort when storage is unavailable.
        }
    }
}

function storedSectionState(target) {
    try {
        const value = localStorage.getItem(`${SECTION_STATE_PREFIX}${target}`);
        return value === null ? null : value === 'true';
    } catch (error) {
        return null;
    }
}

function restoreSectionState(target, defaultCollapsed = false) {
    const stored = storedSectionState(target);
    setSectionCollapsed(target, stored === null ? defaultCollapsed : stored, false);
}

function normalizeItemcodeAccounts(values) {
    const raw = Array.isArray(values?.itemcodeAccounts)
        ? values.itemcodeAccounts
        : values?.username2 || values?.password2
            ? [{ username: values.username2, password: values.password2 }]
            : [];
    const accounts = raw.map(account => ({
        username: String(account?.username || ''),
        password: String(account?.password || '')
    }));
    return accounts.length > 0 ? accounts : [{ username: '', password: '' }];
}

function readItemcodeAccounts() {
    return [...elements.itemcodeAccountsList.querySelectorAll('.itemcode-account-row')].map(row => ({
        username: row.querySelector('[data-account-field="username"]')?.value || '',
        password: row.querySelector('[data-account-field="password"]')?.value || ''
    }));
}

function markConfigDirty() {
    configRevision += 1;
    elements.configStatus.textContent = 'มีการแก้ไข';
    elements.configStatus.classList.remove('saved');
}

function persistItemcodeAccountOrder() {
    const accounts = readItemcodeAccounts();
    if (accounts.length === 0 || accounts.some(account => !account.username.trim() || !account.password)) {
        return;
    }

    const revision = configRevision;
    const snapshot = accounts.map(account => ({ ...account }));
    accountOrderSaveQueue = accountOrderSaveQueue
        .catch(() => {})
        .then(async () => {
            const saved = await api.saveItemcodeAccountOrder(snapshot);
            if (!saved?.ok) throw new Error(saved?.message || 'บันทึกลำดับบัญชีไม่สำเร็จ');
            if (revision === configRevision) {
                elements.configStatus.textContent = 'บันทึกลำดับบัญชีแล้ว';
                elements.configStatus.classList.add('saved');
            }
        })
        .catch(error => {
            markConfigDirty();
            showToast(error.message || 'บันทึกลำดับบัญชีไม่สำเร็จ', true);
        });
}

function renderItemcodeAccounts(accounts = itemcodeAccounts) {
    itemcodeAccounts = accounts.length > 0 ? accounts : [{ username: '', password: '' }];
    elements.itemcodeAccountsList.replaceChildren();

    itemcodeAccounts.forEach((account, index) => {
        const row = document.createElement('div');
        row.className = 'itemcode-account-row';
        row.dataset.accountIndex = String(index);

        const dragHandle = document.createElement('button');
        dragHandle.type = 'button';
        dragHandle.className = 'account-drag-handle';
        dragHandle.textContent = '⋮⋮';
        dragHandle.title = 'ลากเพื่อเปลี่ยนลำดับบัญชี';
        dragHandle.setAttribute('aria-label', `ลากเพื่อเปลี่ยนลำดับบัญชีที่ ${index + 1}`);
        dragHandle.draggable = !running;
        dragHandle.addEventListener('dragstart', event => {
            if (running) {
                event.preventDefault();
                return;
            }
            draggedAccountIndex = index;
            row.classList.add('dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(index));
        });
        dragHandle.addEventListener('dragend', clearAccountDragState);

        row.addEventListener('dragover', event => {
            if (running || draggedAccountIndex === null) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            const midpoint = row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
            row.classList.toggle('drop-before', event.clientY < midpoint);
            row.classList.toggle('drop-after', event.clientY >= midpoint);
        });
        row.addEventListener('dragleave', event => {
            if (!row.contains(event.relatedTarget)) {
                row.classList.remove('drop-before', 'drop-after');
            }
        });
        row.addEventListener('drop', event => {
            if (running || draggedAccountIndex === null) return;
            event.preventDefault();
            const midpoint = row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
            const fromIndex = draggedAccountIndex;
            let toIndex = index + (event.clientY >= midpoint ? 1 : 0);
            const next = readItemcodeAccounts();
            if (fromIndex < 0 || fromIndex >= next.length) {
                clearAccountDragState();
                return;
            }
            const [moved] = next.splice(fromIndex, 1);
            if (fromIndex < toIndex) toIndex -= 1;
            next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved);
            clearAccountDragState();
            renderItemcodeAccounts(next);
            markConfigDirty();
            persistItemcodeAccountOrder();
        });

        const order = document.createElement('div');
        order.className = 'account-order';
        order.textContent = String(index + 1);

        const usernameField = document.createElement('label');
        usernameField.className = 'field';
        const usernameLabel = document.createElement('span');
        usernameLabel.textContent = 'Username รับ ItemCode';
        const usernameInput = document.createElement('input');
        usernameInput.type = 'text';
        usernameInput.autocomplete = 'username';
        usernameInput.placeholder = 'กรอก username';
        usernameInput.value = account.username;
        usernameInput.dataset.accountField = 'username';
        usernameInput.addEventListener('input', markConfigDirty);
        usernameField.append(usernameLabel, usernameInput);

        const passwordField = document.createElement('label');
        passwordField.className = 'field';
        const passwordLabel = document.createElement('span');
        passwordLabel.textContent = 'Password รับ ItemCode';
        const passwordInput = document.createElement('input');
        passwordInput.type = 'password';
        passwordInput.autocomplete = 'current-password';
        passwordInput.placeholder = 'กรอก password';
        passwordInput.value = account.password;
        passwordInput.dataset.accountField = 'password';
        passwordInput.addEventListener('input', markConfigDirty);
        passwordField.append(passwordLabel, passwordInput);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'button button-ghost remove-account';
        remove.textContent = 'ลบ';
        remove.disabled = itemcodeAccounts.length <= 1;
        remove.addEventListener('click', () => {
            if (readItemcodeAccounts().length <= 1) return;
            const next = readItemcodeAccounts();
            next.splice(index, 1);
            renderItemcodeAccounts(next);
            markConfigDirty();
        });

        row.append(dragHandle, order, usernameField, passwordField, remove);
        elements.itemcodeAccountsList.append(row);
    });
    elements.addItemcodeAccount.disabled = running;
}

function clearAccountDragState() {
    draggedAccountIndex = null;
    for (const row of elements.itemcodeAccountsList.querySelectorAll('.itemcode-account-row')) {
        row.classList.remove('dragging', 'drop-before', 'drop-after');
    }
}

function normalizeDiscordWebhooks(values) {
    const raw = Array.isArray(values?.discordWebhookUrls)
        ? values.discordWebhookUrls
        : Array.isArray(values?.discord_webhook_urls)
            ? values.discord_webhook_urls
            : Array.isArray(values?.discord_webhook_url)
                ? values.discord_webhook_url
                : typeof values?.discord_webhook_url === 'string'
                    ? values.discord_webhook_url.split(',')
                    : values?.discordWebhookUrl
                        ? [values.discordWebhookUrl]
                        : [];
    const urls = raw.map(url => String(url || '')).map(url => ({ url }));
    return urls.length > 0 ? urls : [{ url: '' }];
}

function readDiscordWebhooks() {
    return [...elements.discordWebhookList.querySelectorAll('.discord-webhook-row')]
        .map(row => row.querySelector('[data-webhook-field="url"]')?.value.trim() || '')
        .filter(Boolean);
}

function renderDiscordWebhooks(webhooks = discordWebhooks) {
    discordWebhooks = webhooks.length > 0 ? webhooks : [{ url: '' }];
    elements.discordWebhookList.replaceChildren();

    discordWebhooks.forEach((webhook, index) => {
        const row = document.createElement('div');
        row.className = 'discord-webhook-row';
        row.dataset.webhookIndex = String(index);

        const order = document.createElement('div');
        order.className = 'webhook-order';
        order.textContent = String(index + 1);

        const field = document.createElement('label');
        field.className = 'field';
        const label = document.createElement('span');
        label.textContent = 'Discord Webhook URL';
        const input = document.createElement('input');
        input.type = 'url';
        input.autocomplete = 'off';
        input.placeholder = 'https://discord.com/api/webhooks/...';
        input.value = webhook.url;
        input.dataset.webhookField = 'url';
        input.addEventListener('input', markConfigDirty);
        field.append(label, input);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'button button-ghost remove-webhook';
        remove.textContent = 'ลบ';
        remove.disabled = discordWebhooks.length <= 1;
        remove.addEventListener('click', () => {
            const rows = [...elements.discordWebhookList.querySelectorAll('.discord-webhook-row')];
            if (rows.length <= 1) return;
            const next = rows
                .map(item => ({ url: item.querySelector('[data-webhook-field="url"]')?.value || '' }));
            next.splice(index, 1);
            renderDiscordWebhooks(next);
            markConfigDirty();
        });

        row.append(order, field, remove);
        elements.discordWebhookList.append(row);
    });
    elements.addDiscordWebhook.disabled = running;
}

function inputValues() {
    const accounts = readItemcodeAccounts();
    const firstAccount = accounts.find(account => account.username.trim() && account.password) || {};
    const webhookUrls = readDiscordWebhooks();
    return {
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        itemcodeAccounts: accounts,
        // Keep the first account available for older service builds.
        username2: firstAccount.username || '',
        password2: firstAccount.password || '',
        telegramToken: document.getElementById('telegramToken').value,
        telegramChatId: document.getElementById('telegramChatId').value,
        telegramEnabled: document.getElementById('telegramEnabled').checked,
        discordWebhookUrls: webhookUrls,
        discordEnabled: document.getElementById('discordEnabled').checked
    };
}

function setInputs(values) {
    for (const key of ['username', 'password']) {
        document.getElementById(key).value = values?.[key] || '';
    }
    renderItemcodeAccounts(normalizeItemcodeAccounts(values));
    document.getElementById('telegramToken').value = values?.telegramToken || '';
    document.getElementById('telegramChatId').value = values?.telegramChatId || '';
    document.getElementById('telegramEnabled').checked = Boolean(values?.telegramEnabled);
    renderDiscordWebhooks(normalizeDiscordWebhooks(values));
    document.getElementById('discordEnabled').checked = Boolean(values?.discordEnabled);
}

function setRunning(value, mode = 'running') {
    running = Boolean(value);
    elements.runState.dataset.running = String(running);
    elements.runStateText.textContent = !running
        ? 'หยุดทำงาน'
        : mode === 'test-login'
            ? 'กำลังทดสอบ Login'
            : mode === 'test-itemcode'
                ? 'กำลังทดสอบ ItemCode'
                : 'กำลังทำงาน';
    elements.startStop.textContent = running ? 'Stop' : 'Start';
    elements.startStop.classList.toggle('button-danger', running);
    elements.startStop.classList.toggle('button-primary', !running);
    elements.testLogin.disabled = running;
    elements.testItemcode.disabled = running;
    elements.testTelegram.disabled = running;
    elements.testDiscord.disabled = running;
    elements.addItemcodeAccount.disabled = running;
    elements.addDiscordWebhook.disabled = running;
    for (const button of document.querySelectorAll('.remove-account')) {
        button.disabled = running || elements.itemcodeAccountsList.querySelectorAll('.itemcode-account-row').length <= 1;
    }
    for (const button of document.querySelectorAll('.remove-webhook')) {
        button.disabled = running || elements.discordWebhookList.querySelectorAll('.discord-webhook-row').length <= 1;
    }
    for (const handle of document.querySelectorAll('.account-drag-handle')) {
        handle.draggable = !running;
        handle.setAttribute('aria-disabled', String(running));
    }
    for (const input of document.querySelectorAll('.field input, .switch-label input')) input.disabled = running;
}

function renderRequirements() {
    elements.requirementsList.replaceChildren();
    const missing = requirements.filter(item => !item.ready);
    for (const item of requirements) {
        const row = document.createElement('div');
        row.className = 'requirement-row';
        row.dataset.ready = String(item.ready);

        const icon = document.createElement('div');
        icon.className = 'requirement-icon';
        icon.textContent = item.ready ? '✓' : '!';

        const info = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'requirement-name';
        name.textContent = item.label;
        const detail = document.createElement('div');
        detail.className = 'requirement-detail';
        detail.textContent = item.detail;
        info.append(name, detail);

        const version = document.createElement('div');
        version.className = 'requirement-version';
        version.textContent = item.version || '';

        const action = document.createElement('button');
        action.type = 'button';
        action.className = `button ${item.ready ? 'button-ghost' : 'button-primary'}`;
        action.textContent = item.ready ? 'ตรวจสอบแล้ว' : 'Download';
        action.disabled = item.ready;
        if (!item.ready) {
            action.addEventListener('click', async () => {
                action.disabled = true;
                action.textContent = 'กำลังทำงาน...';
                const result = await api.downloadRequirement(item.id);
                if (result.ok) showToast(result.message || `ดำเนินการ ${item.label} แล้ว`);
                else showToast(result.message || `ดำเนินการ ${item.label} ไม่สำเร็จ`, true);
                await refreshRequirements();
            });
        }
        row.append(icon, info, version, action);
        elements.requirementsList.append(row);
    }

    const allReady = requirements.length > 0 && missing.length === 0;
    elements.requirementSummary.textContent = allReady
        ? 'Requirement พร้อมครบทุกตัว สามารถกรอกข้อมูลและกด Start ได้'
        : `ยังขาด ${missing.length} รายการ กรุณาดาวน์โหลดหรือติดตั้งให้ครบก่อนเริ่มงาน`;
    elements.requirementSummary.className = `requirement-summary ${allReady ? 'ready' : 'missing'}`;
    elements.workspaceCard.classList.toggle('locked', !allReady);
    elements.startStop.disabled = !allReady && !running;
    elements.testLogin.disabled = !allReady || running;
    elements.testItemcode.disabled = !allReady || running;
    elements.testTelegram.disabled = running;

    // A complete requirement check is collapsed automatically on the first
    // launch, and again when the user fixes missing requirements. The user's
    // manual expand/collapse choice is preserved while the state is unchanged.
    if (lastRequirementsReady === null || allReady !== lastRequirementsReady) {
        setSectionCollapsed('requirementsContent', allReady, true);
    } else if (!allReady) {
        setSectionCollapsed('requirementsContent', false, false);
    }
    lastRequirementsReady = allReady;
}

async function refreshRequirements() {
    elements.refreshRequirements.disabled = true;
    elements.refreshRequirements.textContent = 'กำลังตรวจสอบ...';
    try {
        requirements = await api.checkRequirements();
        renderRequirements();
    } catch (error) {
        showToast(error.message || 'ตรวจสอบ requirement ไม่สำเร็จ', true);
    } finally {
        elements.refreshRequirements.disabled = false;
        elements.refreshRequirements.textContent = 'ตรวจสอบอีกครั้ง';
    }
}

async function repairRequirementPaths() {
    elements.repairRequirementPaths.disabled = true;
    elements.repairRequirementPaths.textContent = 'กำลังค้นหา...';
    try {
        const result = await api.repairRequirementPaths();
        if (!result.ok) throw new Error(result.message || 'ค้นหา Path ไม่สำเร็จ');
        requirements = result.requirements || [];
        renderRequirements();
        showToast(result.changed ? 'ค้นหาและบันทึก Path ใหม่แล้ว' : 'ตรวจพบ Path ปัจจุบันแล้ว');
    } catch (error) {
        showToast(error.message || 'ค้นหา Path ไม่สำเร็จ', true);
    } finally {
        elements.repairRequirementPaths.disabled = false;
        elements.repairRequirementPaths.textContent = 'ค้นหา Path ใหม่';
    }
}

function statusText(event) {
    const attempt = event.attempt ? ` ${event.attempt}/${event.attemptTotal || 3}` : '';
    if (event.status === 'retry') return `retry${attempt}`;
    if (event.status === 'retry_success') return `retry สำเร็จ${event.attempt ? ` รอบที่ ${event.attempt}` : ''}`;
    return LOG_STATUS_LABELS[event.status] || event.status || LOG_STATUS_LABELS.info;
}

function ensureLogFilterOption(status) {
    if (!status || [...elements.logFilter.options].some(option => option.value === status)) return;
    const option = document.createElement('option');
    option.value = status;
    option.textContent = `เฉพาะ${LOG_STATUS_LABELS[status] || status}`;
    elements.logFilter.append(option);
}

function applyLogFilter() {
    const selectedStatus = elements.logFilter.value;
    const rows = [...elements.logList.querySelectorAll('.log-line')];
    let visible = 0;
    for (const row of rows) {
        const show = selectedStatus === 'all' || row.dataset.status === selectedStatus;
        row.hidden = !show;
        row.classList.toggle('log-line-filtered-out', !show);
        if (show) visible += 1;
    }
    elements.emptyLog.hidden = visible > 0;
    elements.emptyLog.textContent = selectedStatus === 'all'
        ? 'ยังไม่มี ItemCode ที่ตรวจพบ'
        : `ยังไม่มีรายการสถานะ ${LOG_STATUS_LABELS[selectedStatus] || selectedStatus}`;
    elements.logCount.textContent = selectedStatus === 'all'
        ? `${visible} รายการ`
        : `${visible}/${rows.length} รายการ`;
}

function addItemcodeEvent(event) {
    if (!event?.code) return;
    const eventStatus = String(event.status || 'info');
    ensureLogFilterOption(eventStatus);
    elements.emptyLog.hidden = true;
    const row = document.createElement('div');
    row.className = 'log-line';
    row.dataset.status = eventStatus;

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = new Date(event.time || Date.now()).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const code = document.createElement('span');
    code.className = 'log-code';
    code.textContent = event.code;
    const detail = document.createElement('span');
    detail.className = 'log-detail';
    detail.title = event.detail || '';
    detail.textContent = event.detail || '-';
    const status = document.createElement('span');
    status.className = 'log-status';
    status.classList.add(eventStatus.replace(/[^a-zA-Z0-9_-]/g, '_') || 'info');
    status.textContent = statusText(event);

    row.append(time, code, detail, status);
    elements.logList.prepend(row);
    eventCount += 1;
    while (elements.logList.querySelectorAll('.log-line').length > 200) {
        const rows = elements.logList.querySelectorAll('.log-line');
        rows[rows.length - 1]?.remove();
    }
    applyLogFilter();
}

function addServiceLog(entry) {
    if (!entry?.text) return;
    if (!debugLogStarted) {
        elements.debugLog.textContent = '';
        debugLogStarted = true;
    }
    const prefix = entry.stream === 'stderr' ? '[stderr] ' : '[stdout] ';
    elements.debugLog.textContent += `${prefix}${entry.text}`;
    if (!elements.debugLog.textContent.endsWith('\n')) elements.debugLog.textContent += '\n';
    const lines = elements.debugLog.textContent.split('\n');
    if (lines.length > 1000) elements.debugLog.textContent = lines.slice(-1000).join('\n');
    elements.debugLog.scrollTop = elements.debugLog.scrollHeight;
}

async function toggleService() {
    if (running) {
        await api.stop();
        return;
    }
    const values = inputValues();
    const readyValues = credentialsReady(values);
    if (!readyValues) {
        return;
    }
    elements.startStop.disabled = true;
    try {
        const saved = await api.saveSettings(readyValues);
        if (!saved.ok) throw new Error('บันทึกข้อมูลไม่สำเร็จ');
        elements.configStatus.textContent = 'บันทึกแล้ว';
        elements.configStatus.classList.add('saved');
        const result = await api.start(readyValues);
        if (!result.running) throw new Error('เปิด service ไม่สำเร็จ');
        setRunning(true);
        showToast('เริ่มการสแกนแล้ว');
    } catch (error) {
        showToast(error.message || 'เริ่มการทำงานไม่สำเร็จ', true);
        setRunning(false);
    } finally {
        elements.startStop.disabled = false;
    }
}

function credentialsReady(values = inputValues()) {
    const accounts = values.itemcodeAccounts || [];
    const completeAccounts = accounts.filter(account => account.username.trim() && account.password);
    const incompleteAccounts = accounts.filter(account =>
        (account.username.trim() || account.password) && !(account.username.trim() && account.password)
    );
    if (!values.username || !values.password) {
        showToast('กรุณากรอก username/password สำหรับ Check Serial', true);
        return null;
    }
    if (incompleteAccounts.length > 0) {
        showToast('กรุณากรอก username/password ของบัญชีรับ ItemCode ให้ครบทุกแถว', true);
        return null;
    }
    if (completeAccounts.length === 0) {
        showToast('กรุณาเพิ่ม username/password สำหรับรับ ItemCode อย่างน้อย 1 บัญชี', true);
        return null;
    }
    return {
        ...values,
        itemcodeAccounts: completeAccounts,
        username2: completeAccounts[0].username.trim(),
        password2: completeAccounts[0].password
    };
}

async function startTest(mode, code = '') {
    if (running) return;
    const values = credentialsReady();
    if (!values) return;
    elements.testLogin.disabled = true;
    elements.testItemcode.disabled = true;
    try {
        const saved = await api.saveSettings(values);
        if (!saved.ok) throw new Error('บันทึกข้อมูลไม่สำเร็จ');
        elements.configStatus.textContent = 'บันทึกแล้ว';
        elements.configStatus.classList.add('saved');
        const result = mode === 'test-login'
            ? await api.testLogin(values)
            : await api.testItemcode({ settings: values, code });
        if (!result.running) throw new Error('เปิดโหมดทดสอบไม่สำเร็จ');
        setRunning(true, mode);
        showToast(mode === 'test-login' ? 'เริ่มทดสอบ Login แล้ว' : `เริ่มทดสอบ ItemCode: ${code}`);
    } catch (error) {
        showToast(error.message || 'เริ่มโหมดทดสอบไม่สำเร็จ', true);
        setRunning(false);
    } finally {
        if (!running) {
            elements.testLogin.disabled = false;
            elements.testItemcode.disabled = false;
        }
    }
}

async function runTelegramTest() {
    if (running) return;
    const values = inputValues();
    if (!values.telegramToken || !values.telegramChatId) {
        showToast('กรุณากรอก Telegram Bot Token และ Chat ID ก่อนทดสอบ', true);
        return;
    }
    elements.testTelegram.disabled = true;
    try {
        await api.saveSettings(values);
        const result = await api.testTelegram(values);
        elements.configStatus.textContent = result.ok ? 'Telegram ทดสอบสำเร็จ' : 'Telegram ทดสอบไม่สำเร็จ';
        elements.configStatus.classList.toggle('saved', result.ok);
        showToast(result.message || (result.ok ? 'ส่งข้อความสำเร็จ' : 'ส่งข้อความไม่สำเร็จ'), !result.ok);
    } catch (error) {
        showToast(error.message || 'ทดสอบ Telegram ไม่สำเร็จ', true);
    } finally {
        elements.testTelegram.disabled = running;
    }
}

async function runDiscordTest() {
    if (running) return;
    const values = inputValues();
    if (values.discordWebhookUrls.length === 0) {
        showToast('กรุณาเพิ่ม Discord Webhook อย่างน้อย 1 รายการก่อนทดสอบ', true);
        return;
    }
    elements.testDiscord.disabled = true;
    try {
        await api.saveSettings(values);
        const result = await api.testDiscord(values);
        elements.configStatus.textContent = result.ok ? 'Discord ทดสอบสำเร็จ' : 'Discord ทดสอบไม่สำเร็จ';
        elements.configStatus.classList.toggle('saved', result.ok);
        showToast(result.message || (result.ok ? 'ส่งข้อความ Discord สำเร็จ' : 'ส่งข้อความ Discord ไม่สำเร็จ'), !result.ok);
    } catch (error) {
        showToast(error.message || 'ทดสอบ Discord ไม่สำเร็จ', true);
    } finally {
        elements.testDiscord.disabled = running;
    }
}

function openItemcodeModal() {
    if (running) return;
    elements.itemcodeModal.hidden = false;
    elements.testItemcodeValue.value = '';
    elements.testItemcodeValue.focus();
}

function closeItemcodeModal() {
    elements.itemcodeModal.hidden = true;
}

function openChangelog() {
    elements.changelogModal.hidden = false;
    elements.closeChangelog.focus();
}

function closeChangelog() {
    elements.changelogModal.hidden = true;
    elements.openChangelog.focus();
}

elements.refreshRequirements.addEventListener('click', refreshRequirements);
elements.repairRequirementPaths.addEventListener('click', repairRequirementPaths);
elements.startStop.addEventListener('click', toggleService);
elements.testLogin.addEventListener('click', () => startTest('test-login'));
elements.testItemcode.addEventListener('click', openItemcodeModal);
elements.testTelegram.addEventListener('click', runTelegramTest);
elements.testDiscord.addEventListener('click', runDiscordTest);
elements.checkUpdate.addEventListener('click', checkForUpdate);
elements.openChangelog.addEventListener('click', openChangelog);
elements.closeChangelog.addEventListener('click', closeChangelog);
elements.changelogModal.addEventListener('click', event => {
    if (event.target === elements.changelogModal) closeChangelog();
});
elements.logFilter.addEventListener('change', applyLogFilter);
elements.addItemcodeAccount.addEventListener('click', () => {
    if (running) return;
    const next = readItemcodeAccounts();
    next.push({ username: '', password: '' });
    renderItemcodeAccounts(next);
    markConfigDirty();
    elements.itemcodeAccountsList.lastElementChild?.querySelector('[data-account-field="username"]')?.focus();
});
elements.addDiscordWebhook.addEventListener('click', () => {
    if (running) return;
    const next = [...elements.discordWebhookList.querySelectorAll('.discord-webhook-row')]
        .map(row => ({ url: row.querySelector('[data-webhook-field="url"]')?.value || '' }));
    next.push({ url: '' });
    renderDiscordWebhooks(next);
    markConfigDirty();
    elements.discordWebhookList.lastElementChild?.querySelector('[data-webhook-field="url"]')?.focus();
});
elements.clearDebugLog.addEventListener('click', () => {
    elements.debugLog.textContent = 'ยังไม่มีข้อความจาก service';
    debugLogStarted = false;
});
elements.cancelItemcode.addEventListener('click', closeItemcodeModal);
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !elements.changelogModal.hidden) closeChangelog();
});
for (const button of document.querySelectorAll('.collapse-toggle')) {
    button.addEventListener('click', () => toggleSection(button));
}
restoreSectionState('accountContent');
restoreSectionState('debugContent');
elements.itemcodeForm.addEventListener('submit', async event => {
    event.preventDefault();
    const code = elements.testItemcodeValue.value.trim().toUpperCase();
    if (!code) {
        showToast('กรุณากรอก ItemCode', true);
        return;
    }
    closeItemcodeModal();
    await startTest('test-itemcode', code);
});
for (const input of document.querySelectorAll('.field input')) {
    input.addEventListener('input', markConfigDirty);
}
document.getElementById('telegramEnabled').addEventListener('change', () => {
    markConfigDirty();
});
document.getElementById('discordEnabled').addEventListener('change', () => {
    markConfigDirty();
});

api.onServiceState(state => {
    setRunning(state.running, state.mode);
    if (state.error) showToast(state.error, true);
    if (!state.running && state.finishedMode === 'test-login') {
        const success = state.code === 0;
        elements.configStatus.textContent = success ? 'Test Login สำเร็จ' : 'Test Login ไม่สำเร็จ';
        elements.configStatus.classList.toggle('saved', success);
        showToast(success ? 'Test Login สำเร็จ' : `Test Login ไม่สำเร็จ (code ${state.code ?? 'unknown'})`, !success);
    }
});
api.onItemcodeEvent(addItemcodeEvent);
api.onServiceLog(addServiceLog);
api.onUpdateState(setUpdateState);
api.onUpdateNotification(notification => {
    if (notification?.body) showToast(`${notification.title ? `${notification.title}: ` : ''}${notification.body}`);
});
api.onRequirementsUpdate(next => {
    requirements = next;
    renderRequirements();
});

(async function init() {
    try {
        const [settings, state, update] = await Promise.all([
            api.loadSettings(),
            api.getServiceState(),
            api.getUpdateStatus()
        ]);
        setInputs(settings);
        setRunning(state.running, state.mode);
        setUpdateState(update);
        await refreshRequirements();
    } catch (error) {
        showToast(error.message || 'เปิดแอปไม่สำเร็จ', true);
    }
})();
