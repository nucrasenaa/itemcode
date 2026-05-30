// Global state variables
let isScanning = false;
let logCount = 0;
let lastLogLine = "";
let ytPlayer = null;
let ytPlayerReady = false;
let currentVideoId = null;

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => {
    // Initial fetch of state
    pollStatus();
    // Start periodic status polling (every 1.5 seconds)
    setInterval(pollStatus, 1500);

    // Bind login actions
    document.getElementById("btn-login-pw").addEventListener("click", loginCredentials);
    document.getElementById("btn-login-token").addEventListener("click", loginToken);
    document.getElementById("btn-logout").addEventListener("click", logout);

    // Bind config/params saving
    document.getElementById("btn-save-tele").addEventListener("click", saveTelegramConfig);
    document.getElementById("btn-test-tele").addEventListener("click", testTelegram);
    document.getElementById("telegram-enabled").addEventListener("change", saveTelegramConfig);
    
    document.getElementById("btn-save-discord").addEventListener("click", saveDiscordConfig);
    document.getElementById("btn-test-discord").addEventListener("click", testDiscord);
    document.getElementById("discord-enabled").addEventListener("change", saveDiscordConfig);
    
    document.getElementById("btn-save-params").addEventListener("click", saveParameters);

    // Bind scan toggling
    document.getElementById("btn-toggle-scan").addEventListener("click", toggleScan);

    // Bind log clearing
    document.getElementById("btn-clear-logs").addEventListener("click", () => {
        const console = document.getElementById("log-console");
        console.innerHTML = '<div class="console-line text-mute">--- เคลียร์ประวัติหน้าจอสำเร็จ ---</div>';
    });
});

// Toast notification helper
function showToast(message, isError = false) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.style.borderColor = isError ? "var(--text-red)" : "var(--primary-glow)";
    toast.classList.remove("hide");
    
    // Hide toast after 3 seconds
    setTimeout(() => {
        toast.classList.add("hide");
    }, 3000);
}

// Switch between tab views
function switchLoginTab(tabId) {
    // Switch active buttons
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    const activeBtn = event.target;
    activeBtn.classList.add("active");

    // Switch active tabs
    document.querySelectorAll(".tab-content").forEach(content => content.classList.remove("active"));
    document.getElementById(tabId).classList.add("active");
}

// Extract YouTube Video ID from URL
function extractYoutubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|live\/|shorts\/)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// Load YouTube Embed Player
function loadYoutubePlayer(videoUrl) {
    const videoId = extractYoutubeId(videoUrl);
    if (!videoId) return;

    // Prevent reloading if the same video is already loaded
    if (videoId === currentVideoId) return;
    currentVideoId = videoId;

    const placeholder = document.getElementById("yt-player-placeholder");
    const iframeWrap = document.getElementById("yt-player-iframe");
    
    placeholder.classList.add("hide");
    iframeWrap.classList.remove("hide");

    if (ytPlayer) {
        ytPlayer.loadVideoById(videoId);
    } else {
        ytPlayer = new YT.Player('player', {
            height: '100%',
            width: '100%',
            videoId: videoId,
            playerVars: {
                'playsinline': 1,
                'autoplay': 1
            }
        });
    }
}

// Poll state and update UI
async function pollStatus() {
    try {
        let url = "/api/status";
        if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
            try {
                const currentTime = ytPlayer.getCurrentTime() || 0;
                let isLive = false;
                if (typeof ytPlayer.getVideoData === 'function') {
                    const videoData = ytPlayer.getVideoData();
                    if (videoData && (videoData.isLive === true || videoData.isLive === 1)) {
                        isLive = true;
                    }
                }
                if (ytPlayer.getDuration() === 0) {
                    isLive = true;
                }
                url += `?current_time=${encodeURIComponent(currentTime)}&is_live=${encodeURIComponent(isLive)}`;
            } catch (playerErr) {
                console.error("Error reading player state:", playerErr);
            }
        }

        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();

        // 1. Update scanning state
        isScanning = data.scanning;
        const scanPulse = document.getElementById("scan-pulse");
        const scanStatusText = document.getElementById("scan-status-text");
        const toggleBtn = document.getElementById("btn-toggle-scan");
        const placeholder = document.getElementById("yt-player-placeholder");
        const placeholderText = placeholder.querySelector("p");
        const iframeWrap = document.getElementById("yt-player-iframe");

        if (isScanning) {
            if (data.ocr_sleeping) {
                scanPulse.classList.remove("active");
                scanPulse.classList.add("sleeping");
                
                const min = Math.floor(data.ocr_sleep_remaining / 60);
                const sec = data.ocr_sleep_remaining % 60;
                const timeStr = `${min}:${sec.toString().padStart(2, '0')}`;
                scanStatusText.textContent = `หยุดพัก OCR ชั่วคราว (เหลือเวลา ${timeStr} น.)`;
            } else {
                scanPulse.classList.remove("sleeping");
                scanPulse.classList.add("active");
                scanStatusText.textContent = `กำลังตรวจจับ: ${data.current_url.substring(0, 30)}...`;
            }
            toggleBtn.innerHTML = '<i class="fa-solid fa-stop"></i> หยุดการสแกนระบบ';
            toggleBtn.classList.add("stop");
            
            const currentId = extractYoutubeId(data.current_url);
            if (currentId) {
                placeholder.classList.add("hide");
                iframeWrap.classList.remove("hide");
                if (currentId !== currentVideoId) {
                    loadYoutubePlayer(data.current_url);
                }
            } else {
                // Channel URL / waiting for live stream
                placeholder.classList.remove("hide");
                iframeWrap.classList.add("hide");
                placeholderText.textContent = "🔔 กำลังตรวจจับสัญญาณถ่ายทอดสดของช่อง... ระบบจะเล่นวิดีโอและสแกนทันทีเมื่อสตรีมเปิดตัว";
            }
        } else {
            scanPulse.classList.remove("active");
            scanPulse.classList.remove("sleeping");
            scanStatusText.textContent = "ระบบปิดอยู่";
            toggleBtn.innerHTML = '<i class="fa-solid fa-play"></i> เริ่มดึงภาพ & OCR';
            toggleBtn.classList.remove("stop");
            
            placeholder.classList.remove("hide");
            iframeWrap.classList.add("hide");
            placeholderText.textContent = "วิดีโอจะเล่นที่นี่เมื่อใส่ลิงก์และเริ่มระบบสแกน";
            currentVideoId = null;
        }

        // 2. Update HOF login status block
        const hofBlock = document.getElementById("hof-status-block");
        const hofMsg = document.getElementById("hof-status-msg");
        const loggedIn = data.hof_status.logged_in;
        
        document.getElementById("username").disabled = loggedIn;
        document.getElementById("password").disabled = loggedIn;
        document.getElementById("bearer-token").disabled = loggedIn;

        if (loggedIn) {
            hofBlock.className = "status-block logged";
            hofMsg.textContent = `เข้าสู่ระบบสำเร็จ (${data.hof_status.token_preview})`;
            document.getElementById("btn-login-pw").classList.add("hide");
            document.getElementById("btn-login-token").classList.add("hide");
            document.getElementById("logout-container").classList.remove("hide");
        } else {
            hofBlock.className = "status-block unlogged";
            hofMsg.textContent = "ยังไม่ได้ล็อกอินเกม";
            document.getElementById("btn-login-pw").classList.remove("hide");
            document.getElementById("btn-login-token").classList.remove("hide");
            document.getElementById("logout-container").classList.add("hide");
        }

        // Fill credentials forms with configs if inputs are empty
        const teleTokenInput = document.getElementById("telegram-token");
        const teleChatIdInput = document.getElementById("telegram-chat-id");

        if (teleTokenInput.value === "" && data.config.telegram_token) {
            teleTokenInput.value = data.config.telegram_token;
        }
        if (teleChatIdInput.value === "" && data.config.telegram_chat_id) {
            teleChatIdInput.value = data.config.telegram_chat_id;
        }
        
        document.getElementById("telegram-enabled").checked = !!data.config.telegram_enabled;

        // Fill Discord config if inputs are empty
        const discordInput = document.getElementById("discord-webhook");
        
        if (discordInput.value === "" && data.config.discord_webhook_url) {
            discordInput.value = data.config.discord_webhook_url;
        }
        
        document.getElementById("discord-enabled").checked = !!data.config.discord_enabled;

        if (document.getElementById("game-id").value === "" && data.config.game_id) {
            document.getElementById("game-id").value = data.config.game_id;
            document.getElementById("scan-interval").value = data.config.scan_interval;
            document.getElementById("regex-pattern").value = data.config.regex_pattern;
        }

        // 3. Update Console Logs
        const logConsole = document.getElementById("log-console");
        if (data.logs.length > 0) {
            // Check if there are new lines
            const incomingLastLine = data.logs[data.logs.length - 1];
            if (incomingLastLine !== lastLogLine || data.logs.length !== logCount) {
                logConsole.innerHTML = "";
                data.logs.forEach(log => {
                    const lineDiv = document.createElement("div");
                    lineDiv.className = "console-line";
                    
                    // Highlight colors
                    if (log.includes("[🎉]") || log.includes("[+]")) lineDiv.style.color = "var(--text-green)";
                    else if (log.includes("[❌]") || log.includes("[-]")) lineDiv.style.color = "var(--text-red)";
                    else if (log.includes("[⭐]") || log.includes("[!]")) lineDiv.style.color = "var(--text-gold)";
                    
                    lineDiv.textContent = log;
                    logConsole.appendChild(lineDiv);
                });
                
                // Scroll to bottom
                logConsole.scrollTop = logConsole.scrollHeight;
                
                logCount = data.logs.length;
                lastLogLine = incomingLastLine;
            }
        }

        // 4. Update stats and detected codes
        document.getElementById("stat-redeemed-count").textContent = data.redeemed_count;

        const codesList = document.getElementById("detected-codes-list");
        if (data.last_ocr_results.length > 0) {
            codesList.innerHTML = "";
            data.last_ocr_results.forEach(code => {
                const pill = document.createElement("div");
                pill.className = "code-pill";
                pill.innerHTML = `<span>${code}</span> <span class="code-pill-meta">จับได้ในสตรีม</span>`;
                codesList.appendChild(pill);
            });
        } else if (codesList.children.length === 0 || codesList.querySelector(".no-code-msg") === null) {
            codesList.innerHTML = '<div class="no-code-msg">ยังไม่พบโค้ดในขณะนี้...</div>';
        }

    } catch (err) {
        console.error("Polling error:", err);
    }
}

// Log in via username and password
async function loginCredentials() {
    const u = document.getElementById("username").value.trim();
    const p = document.getElementById("password").value.trim();
    
    if (!u || !p) {
        showToast("กรุณากรอกทั้ง Username และ Password", true);
        return;
    }

    showToast("กำลังเริ่มเข้าสู่ระบบ HOF...");
    try {
        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "credentials", username: u, password: p })
        });
        const data = await res.json();
        if (data.success) {
            showToast("ล็อกอินผ่านระบบหลังบ้านสำเร็จ!");
            document.getElementById("username").value = "";
            document.getElementById("password").value = "";
        } else {
            showToast(data.message, true);
        }
    } catch (err) {
        showToast("เกิดข้อผิดพลาดในการเชื่อมต่อ", true);
    }
}

// Set Bearer Token directly
async function loginToken() {
    const t = document.getElementById("bearer-token").value.trim();
    if (!t) {
        showToast("กรุณาวาง Bearer Token ก่อนบันทึก", true);
        return;
    }

    try {
        const res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "token", token: t })
        });
        const data = await res.json();
        if (data.success) {
            showToast("อัปเดต Token สำเร็จ!");
            document.getElementById("bearer-token").value = "";
        } else {
            showToast(data.message, true);
        }
    } catch (err) {
        showToast("เกิดข้อผิดพลาดในการเชื่อมต่อ", true);
    }
}

// Save Telegram Config Settings
async function saveTelegramConfig() {
    const token = document.getElementById("telegram-token").value.trim();
    const chat_id = document.getElementById("telegram-chat-id").value.trim();

    try {
        const res = await fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ telegram_token: token, telegram_chat_id: chat_id })
        });
        const data = await res.json();
        if (data.success) {
            showToast("บันทึกการตั้งค่า Telegram สำเร็จ!");
        } else {
            showToast(data.message, true);
        }
    } catch (err) {
        showToast("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อบันทึกได้", true);
    }
}

// Send test message to Telegram Channel
async function testTelegram() {
    showToast("กำลังส่งข้อความทดสอบไป Telegram...");
    try {
        const res = await fetch("/api/telegram-test", { method: "POST" });
        const data = await res.json();
        if (data.success) {
            showToast("ส่งข้อความทดสอบสำเร็จ! โปรดเช็คในแอป Telegram ของคุณ");
        } else {
            showToast(data.message, true);
        }
    } catch (err) {
        showToast("การเชื่อมต่อล้มเหลว", true);
    }
}

// Save parameters (Game ID, interval, regex)
async function saveParameters() {
    const game_id = document.getElementById("game-id").value.trim();
    const interval = document.getElementById("scan-interval").value;
    const regex = document.getElementById("regex-pattern").value.trim();

    try {
        const res = await fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ game_id: game_id, scan_interval: interval, regex_pattern: regex })
        });
        const data = await res.json();
        if (data.success) {
            showToast("อัปเดตพารามิเตอร์การตรวจจับสำเร็จ!");
        } else {
            showToast(data.message, true);
        }
    } catch (err) {
        showToast("เกิดข้อผิดพลาดในการบันทึกพารามิเตอร์", true);
    }
}

// Start or Stop the scan loop
async function toggleScan() {
    if (isScanning) {
        // Stop scan
        try {
            const res = await fetch("/api/stop", { method: "POST" });
            const data = await res.json();
            if (data.success) {
                showToast("สั่งหยุดการทำงานระบบสแกนแล้ว");
            } else {
                showToast(data.message, true);
            }
        } catch (err) {
            showToast("เกิดข้อผิดพลาดในการเชื่อมต่อ", true);
        }
    } else {
        // Start scan
        const url = document.getElementById("youtube-url").value.trim();
        if (!url) {
            showToast("กรุณาระบุลิงก์ YouTube ก่อนเริ่มสแกน", true);
            return;
        }

        const isChannel = url.includes("/@") || url.includes("/channel/") || url.includes("/c/") || url.includes("/user/");
        const videoId = extractYoutubeId(url);
        
        if (!isChannel && !videoId) {
            showToast("รูปแบบลิงก์ YouTube ไม่ถูกต้อง (รองรับลิงก์วิดีโอ หรือลิงก์หน้าช่อง)", true);
            return;
        }

        // Auto load player so user can watch it if it is a direct video
        if (videoId) {
            loadYoutubePlayer(url);
        }

        try {
            const res = await fetch("/api/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: url })
            });
            const data = await res.json();
            if (data.success) {
                showToast("ระบบดึงวิดีโอและ OCR ทำงานแล้ว!");
            } else {
                showToast(data.message, true);
            }
        } catch (err) {
            showToast("การเชื่อมต่อล้มเหลว", true);
        }
    }
}

// Log out and clear session config
async function logout() {
    try {
        const res = await fetch("/api/logout", { method: "POST" });
        const data = await res.json();
        if (data.success) {
            showToast("ออกจากระบบ HOF สำเร็จ!");
            document.getElementById("username").value = "";
            document.getElementById("password").value = "";
            document.getElementById("bearer-token").value = "";
            pollStatus();
        } else {
            showToast(data.message, true);
        }
    } catch (err) {
        showToast("เกิดข้อผิดพลาดในการเชื่อมต่อเพื่อออกจากระบบ", true);
    }
}

// Save Telegram Config Settings
async function saveTelegramConfig() {
    const token = document.getElementById("telegram-token").value.trim();
    const chat_id = document.getElementById("telegram-chat-id").value.trim();
    const enabled = document.getElementById("telegram-enabled").checked;

    try {
        const res = await fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                telegram_token: token, 
                telegram_chat_id: chat_id,
                telegram_enabled: enabled
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast("บันทึกการตั้งค่า Telegram สำเร็จ!");
        } else {
            showToast(data.message, true);
        }
    } catch (err) {
        showToast("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อบันทึกได้", true);
    }
}

// Save Discord Webhook Config Settings
async function saveDiscordConfig() {
    const webhookUrl = document.getElementById("discord-webhook").value.trim();
    const enabled = document.getElementById("discord-enabled").checked;

    try {
        const res = await fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                discord_webhook_url: webhookUrl,
                discord_enabled: enabled
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast("บันทึกการตั้งค่า Discord สำเร็จ!");
        } else {
            showToast(data.message, true);
        }
    } catch (err) {
        showToast("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อบันทึกได้", true);
    }
}

// Send test message to Discord Webhook
async function testDiscord() {
    showToast("กำลังส่งข้อความทดสอบไป Discord Webhook...");
    try {
        const res = await fetch("/api/discord-test", { method: "POST" });
        const data = await res.json();
        if (data.success) {
            showToast("ส่งข้อความทดสอบสำเร็จ! โปรดเช็คในเซิร์ฟเวอร์ Discord ของคุณ");
        } else {
            showToast(data.message, true);
        }
    } catch (err) {
        showToast("การเชื่อมต่อล้มเหลว", true);
    }
}
