const api = window.itemcodeDesktop;
const elements = {
    requirementsList: document.getElementById('requirementsList'),
    requirementSummary: document.getElementById('requirementSummary'),
    refreshRequirements: document.getElementById('refreshRequirements'),
    workspaceCard: document.getElementById('workspaceCard'),
    startStop: document.getElementById('startStop'),
    testLogin: document.getElementById('testLogin'),
    testItemcode: document.getElementById('testItemcode'),
    testTelegram: document.getElementById('testTelegram'),
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
    toast: document.getElementById('toast')
};

let requirements = [];
let running = false;
let eventCount = 0;
let toastTimer = null;

function showToast(message, error = false) {
    elements.toast.textContent = message;
    elements.toast.classList.toggle('error', error);
    elements.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 4200);
}

function toggleSection(button) {
    const content = document.getElementById(button.dataset.target);
    if (!content) return;
    const collapsed = content.classList.toggle('collapsed');
    button.textContent = collapsed ? 'ขยาย' : 'ย่อ';
    button.setAttribute('aria-expanded', String(!collapsed));
}

function inputValues() {
    return {
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        username2: document.getElementById('username2').value,
        password2: document.getElementById('password2').value,
        telegramToken: document.getElementById('telegramToken').value,
        telegramChatId: document.getElementById('telegramChatId').value,
        telegramEnabled: document.getElementById('telegramEnabled').checked
    };
}

function setInputs(values) {
    for (const key of ['username', 'password', 'username2', 'password2']) {
        document.getElementById(key).value = values?.[key] || '';
    }
    document.getElementById('telegramToken').value = values?.telegramToken || '';
    document.getElementById('telegramChatId').value = values?.telegramChatId || '';
    document.getElementById('telegramEnabled').checked = Boolean(values?.telegramEnabled);
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

function statusText(event) {
    const attempt = event.attempt ? ` ${event.attempt}/${event.attemptTotal || 3}` : '';
    const labels = {
        available: 'ใช้ได้',
        redeemed: 'รับไอเทมสำเร็จ',
        redeem_failed: 'รับไอเทมไม่สำเร็จ',
        retry: `retry${attempt}`,
        retry_success: `retry สำเร็จ${event.attempt ? ` รอบที่ ${event.attempt}` : ''}`
    };
    return labels[event.status] || event.status;
}

function isSuccessfulEvent(status) {
    return ['available', 'redeemed', 'retry_success'].includes(status);
}

function applyLogFilter() {
    const onlySuccess = elements.logFilter.value === 'success';
    const rows = [...elements.logList.querySelectorAll('.log-line')];
    let visible = 0;
    for (const row of rows) {
        const show = !onlySuccess || isSuccessfulEvent(row.dataset.status);
        row.hidden = !show;
        if (show) visible += 1;
    }
    elements.emptyLog.hidden = visible > 0;
    elements.emptyLog.textContent = onlySuccess && rows.length > 0
        ? 'ยังไม่มี ItemCode ที่สำเร็จ'
        : 'ยังไม่มี ItemCode ที่ตรวจพบ';
    elements.logCount.textContent = onlySuccess
        ? `${visible}/${eventCount} รายการ`
        : `${eventCount} รายการ`;
}

function addItemcodeEvent(event) {
    if (!event?.code) return;
    elements.emptyLog.hidden = true;
    const row = document.createElement('div');
    row.className = 'log-line';
    row.dataset.status = event.status || '';

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
    status.className = `log-status ${event.status || ''}`;
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

async function toggleService() {
    if (running) {
        await api.stop();
        return;
    }
    const values = inputValues();
    if (!values.username || !values.password || !values.username2 || !values.password2) {
        showToast('กรุณากรอกข้อมูลให้ครบทั้ง 4 ช่อง', true);
        return;
    }
    elements.startStop.disabled = true;
    try {
        const saved = await api.saveSettings(values);
        if (!saved.ok) throw new Error('บันทึกข้อมูลไม่สำเร็จ');
        elements.configStatus.textContent = 'บันทึกแล้ว';
        elements.configStatus.classList.add('saved');
        const result = await api.start(values);
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

function credentialsReady() {
    const values = inputValues();
    if (!values.username || !values.password || !values.username2 || !values.password2) {
        showToast('กรุณากรอกข้อมูลให้ครบทั้ง 4 ช่อง', true);
        return null;
    }
    return values;
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

function openItemcodeModal() {
    if (running) return;
    elements.itemcodeModal.hidden = false;
    elements.testItemcodeValue.value = '';
    elements.testItemcodeValue.focus();
}

function closeItemcodeModal() {
    elements.itemcodeModal.hidden = true;
}

elements.refreshRequirements.addEventListener('click', refreshRequirements);
elements.startStop.addEventListener('click', toggleService);
elements.testLogin.addEventListener('click', () => startTest('test-login'));
elements.testItemcode.addEventListener('click', openItemcodeModal);
elements.testTelegram.addEventListener('click', runTelegramTest);
elements.logFilter.addEventListener('change', applyLogFilter);
elements.cancelItemcode.addEventListener('click', closeItemcodeModal);
for (const button of document.querySelectorAll('.collapse-toggle')) {
    button.addEventListener('click', () => toggleSection(button));
}
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
    input.addEventListener('input', () => {
        elements.configStatus.textContent = 'มีการแก้ไข';
        elements.configStatus.classList.remove('saved');
    });
}
document.getElementById('telegramEnabled').addEventListener('change', () => {
    elements.configStatus.textContent = 'มีการแก้ไข';
    elements.configStatus.classList.remove('saved');
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
api.onRequirementsUpdate(next => {
    requirements = next;
    renderRequirements();
});

(async function init() {
    try {
        const [settings, state] = await Promise.all([api.loadSettings(), api.getServiceState()]);
        setInputs(settings);
        setRunning(state.running, state.mode);
        await refreshRequirements();
    } catch (error) {
        showToast(error.message || 'เปิดแอปไม่สำเร็จ', true);
    }
})();
