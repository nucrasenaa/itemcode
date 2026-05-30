#!/usr/bin/env bash
# =============================================================================
#  TalesRunner ItemCode Watcher (Web UI) — macOS Installer
#  ใช้งาน: chmod +x install_mac.sh && ./install_mac.sh
# =============================================================================
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
info() { echo -e "${YELLOW}[*]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo "============================================================"
echo "   TalesRunner ItemCode Watcher (Web UI) — macOS Installer"
echo "============================================================"
echo ""

# ── 1. Homebrew ──────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
    info "ติดตั้ง Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    ok "Homebrew installed"
else
    ok "Homebrew พร้อมใช้งานแล้ว"
fi

# ── 2. Python 3 ──────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    info "ติดตั้ง Python 3..."
    brew install python
    ok "Python installed: $(python3 --version)"
else
    ok "Python พร้อมใช้งานแล้ว: $(python3 --version)"
fi

# ── 3. yt-dlp ────────────────────────────────────────────────
if ! command -v yt-dlp &>/dev/null; then
    info "ติดตั้ง yt-dlp..."
    brew install yt-dlp
    ok "yt-dlp installed: $(yt-dlp --version)"
else
    ok "yt-dlp พร้อมใช้งานแล้ว"
fi

# ── 4. FFmpeg ────────────────────────────────────────────────
if ! command -v ffmpeg &>/dev/null; then
    info "ติดตั้ง FFmpeg..."
    brew install ffmpeg
    ok "FFmpeg installed"
else
    ok "FFmpeg พร้อมใช้งานแล้ว"
fi

# ── 5. Setup Python Virtual Environment & Packages ───────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

info "สร้างและตั้งค่า Python Virtual Environment (venv)..."
python3 -m venv venv
./venv/bin/pip install --upgrade pip --quiet
./venv/bin/pip install flask requests playwright --quiet
ok "ติดตั้งแพ็คเกจ Python เรียบร้อยแล้ว (flask, requests, playwright)"

info "ติดตั้ง Playwright Chromium..."
./venv/bin/playwright install chromium
ok "ติดตั้ง Playwright Chromium เรียบร้อยแล้ว"

# ── 6. Compile Swift OCR helper ──────────────────────────────
OCR_SWIFT="$SCRIPT_DIR/ocr_helper.swift"
OCR_BIN="$SCRIPT_DIR/ocr_helper"

if [ -f "$OCR_SWIFT" ]; then
    info "กำลัง compile OCR helper (Swift)..."
    swiftc "$OCR_SWIFT" -o "$OCR_BIN" -framework Vision -framework AppKit
    chmod +x "$OCR_BIN"
    ok "ocr_helper compiled → $OCR_BIN"
else
    err "ไม่พบไฟล์ ocr_helper.swift ในโฟลเดอร์"
fi

# ── 7. Setup config files ────────────────────────────────────
if [ ! -f "$SCRIPT_DIR/service_config.json" ] && [ -f "$SCRIPT_DIR/service_config.json.example" ]; then
    cp "$SCRIPT_DIR/service_config.json.example" "$SCRIPT_DIR/service_config.json"
    info "สร้าง service_config.json จาก example (กรุณากรอกข้อมูลก่อนใช้งาน)"
fi
if [ ! -f "$SCRIPT_DIR/web_config.json" ] && [ -f "$SCRIPT_DIR/web_config.json.example" ]; then
    cp "$SCRIPT_DIR/web_config.json.example" "$SCRIPT_DIR/web_config.json"
fi
if [ ! -f "$SCRIPT_DIR/.session_config.json" ] && [ -f "$SCRIPT_DIR/.session_config.json.example" ]; then
    cp "$SCRIPT_DIR/.session_config.json.example" "$SCRIPT_DIR/.session_config.json"
fi

echo ""
echo "============================================================"
echo -e "${GREEN}  ✅  ติดตั้งฝั่ง Web UI (Python) เสร็จสมบูรณ์!${NC}"
echo "============================================================"
echo ""
echo "  วิธีใช้งาน:"
echo "    รันระบบ Web UI:  ./venv/bin/python web_app.py"
echo ""
echo "  ⚠️  อย่าลืมกรอกข้อมูลใน service_config.json และ web_config.json ก่อนรัน"
echo ""
