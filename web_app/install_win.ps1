# =============================================================================
#  TalesRunner ItemCode Watcher (Web UI) — Windows Installer (PowerShell)
#  ใช้งาน: คลิกขวา → "Run with PowerShell" หรือ
#           powershell -ExecutionPolicy Bypass -File install_win.ps1
# =============================================================================
#Requires -Version 5.1
$ErrorActionPreference = "Stop"

function ok   { param($msg) Write-Host "[✓] $msg" -ForegroundColor Green }
function info { param($msg) Write-Host "[*] $msg" -ForegroundColor Yellow }
function err  { param($msg) Write-Host "[✗] $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   TalesRunner ItemCode Watcher (Web UI) — Windows Installer"  -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# ── 1. winget check ──────────────────────────────────────────
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    err "ไม่พบ winget — กรุณาอัปเดต Windows หรือติดตั้ง App Installer จาก Microsoft Store"
}
ok "winget พร้อมใช้งาน"

# ── 2. Python 3 ──────────────────────────────────────────────
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    info "ติดตั้ง Python 3..."
    winget install --id Python.Python.3.11 -e --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    ok "Python installed"
} else {
    ok "Python พร้อมใช้งานแล้ว: $(python --version)"
}

# ── 3. yt-dlp ────────────────────────────────────────────────
if (-not (Get-Command yt-dlp -ErrorAction SilentlyContinue)) {
    info "ติดตั้ง yt-dlp..."
    winget install --id yt-dlp.yt-dlp -e --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    ok "yt-dlp installed"
} else {
    ok "yt-dlp พร้อมใช้งานแล้ว"
}

# ── 4. FFmpeg ────────────────────────────────────────────────
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    info "ติดตั้ง FFmpeg..."
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    ok "FFmpeg installed"
} else {
    ok "FFmpeg พร้อมใช้งานแล้ว"
}

# ── 5. Setup Python Virtual Environment & Packages ───────────
info "สร้างและตั้งค่า Python Virtual Environment (venv)..."
python -m venv venv
& .\venv\Scripts\pip install --upgrade pip --quiet
& .\venv\Scripts\pip install flask requests playwright --quiet
ok "ติดตั้งแพ็คเกจ Python เรียบร้อยแล้ว (flask, requests, playwright)"

info "ติดตั้ง Playwright Chromium..."
& .\venv\Scripts\playwright install chromium
ok "ติดตั้ง Playwright Chromium เรียบร้อยแล้ว"

# ── 6. Verify ocr_helper.ps1 ─────────────────────────────────
$OcrScript = Join-Path $ScriptDir "ocr_helper.ps1"
if (Test-Path $OcrScript) {
    ok "ocr_helper.ps1 พบที่ $OcrScript"
} else {
    Write-Host "[!] ไม่พบ ocr_helper.ps1 — OCR บน Windows จะไม่ทำงาน" -ForegroundColor Red
}

# ── 7. Set PowerShell execution policy (user scope) ──────────
info "ตั้งค่า PowerShell ExecutionPolicy เป็น RemoteSigned..."
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
ok "ExecutionPolicy set"

# ── 8. Setup config files ────────────────────────────────────
$cfgSrc = Join-Path $ScriptDir "service_config.json.example"
$cfgDst = Join-Path $ScriptDir "service_config.json"
if (-not (Test-Path $cfgDst) -and (Test-Path $cfgSrc)) {
    Copy-Item $cfgSrc $cfgDst
    info "สร้าง service_config.json จาก example (กรุณากรอกข้อมูลก่อนใช้งาน)"
}
$webSrc = Join-Path $ScriptDir "web_config.json.example"
$webDst = Join-Path $ScriptDir "web_config.json"
if (-not (Test-Path $webDst) -and (Test-Path $webSrc)) {
    Copy-Item $webSrc $webDst
}
$sessSrc = Join-Path $ScriptDir ".session_config.json.example"
$sessDst = Join-Path $ScriptDir ".session_config.json"
if (-not (Test-Path $sessDst) -and (Test-Path $sessSrc)) {
    Copy-Item $sessSrc $sessDst
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  ✅  ติดตั้งฝั่ง Web UI (Python) เสร็จสมบูรณ์!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  วิธีใช้งาน:"
Write-Host "    รันระบบ Web UI:  .\venv\Scripts\python web_app.py"
Write-Host ""
Write-Host "  ⚠️  อย่าลืมกรอกข้อมูลใน service_config.json และ web_config.json ก่อนรัน" -ForegroundColor Yellow
Write-Host ""
Write-Host "  กด Enter เพื่อปิดหน้าต่างนี้..."
Read-Host
