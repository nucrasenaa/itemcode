#!/usr/bin/env bash
# =============================================================================
#  TalesRunner ItemCode Watcher (Node.js Service) — macOS Installer
#  ใช้งาน: chmod +x install_mac.sh && ./install_mac.sh
# =============================================================================
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
info() { echo -e "${YELLOW}[*]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo "============================================================"
echo "   TalesRunner ItemCode Watcher (Node.js Service) — macOS"
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

# ── 2. Node.js ───────────────────────────────────────────────
if ! command -v node &>/dev/null; then
    info "ติดตั้ง Node.js..."
    brew install node
    ok "Node.js installed: $(node -v)"
else
    ok "Node.js พร้อมใช้งานแล้ว: $(node -v)"
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

# ── 5. Compile Swift OCR helper ──────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

# ── 6. Setup config files ────────────────────────────────────
if [ ! -f "$SCRIPT_DIR/service_config.json" ] && [ -f "$SCRIPT_DIR/service_config.json.example" ]; then
    cp "$SCRIPT_DIR/service_config.json.example" "$SCRIPT_DIR/service_config.json"
    info "สร้าง service_config.json จาก example (กรุณากรอกข้อมูลก่อนใช้งาน)"
fi
if [ ! -f "$SCRIPT_DIR/.session_config.json" ] && [ -f "$SCRIPT_DIR/.session_config.json.example" ]; then
    cp "$SCRIPT_DIR/.session_config.json.example" "$SCRIPT_DIR/.session_config.json"
fi

echo ""
echo "============================================================"
echo -e "${GREEN}  ✅  ติดตั้งฝั่ง Node.js Service เสร็จสมบูรณ์!${NC}"
echo "============================================================"
echo ""
echo "  วิธีใช้งาน:"
echo "    รันระบบแบบเบื้องหลัง (Headless):  node index.js"
echo ""
echo "  ⚠️  อย่าลืมกรอกข้อมูลใน service_config.json ก่อนรัน"
echo ""
