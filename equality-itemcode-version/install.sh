#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

info() { printf '\033[1;33m[*]\033[0m %s\n' "$1"; }
ok() { printf '\033[0;32m[✓]\033[0m %s\n' "$1"; }
die() { printf '\033[0;31m[✗]\033[0m %s\n' "$1" >&2; exit 1; }

install_node_macos() {
  command -v brew >/dev/null 2>&1 || die "ต้องติดตั้ง Homebrew ก่อน: https://brew.sh"
  brew list node >/dev/null 2>&1 || brew install node
}

install_linux_packages() {
  command -v apt-get >/dev/null 2>&1 || die "ตัวติดตั้ง Linux รองรับ Debian/Ubuntu ที่มี apt-get"
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl ffmpeg python3 tesseract-ocr tesseract-ocr-eng

  if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'parseInt(process.versions.node.split(".")[0], 10)')" -lt 20 ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi

  if ! command -v yt-dlp >/dev/null 2>&1; then
    sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
    sudo chmod a+rx /usr/local/bin/yt-dlp
  fi
}

case "$(uname -s)" in
  Darwin)
    info "ตรวจสอบ dependencies สำหรับ macOS"
    install_node_macos
    command -v yt-dlp >/dev/null 2>&1 || brew install yt-dlp
    command -v ffmpeg >/dev/null 2>&1 || brew install ffmpeg
    command -v swiftc >/dev/null 2>&1 || die "ไม่พบ swiftc; ติดตั้ง Xcode Command Line Tools ก่อน"
    info "กำลัง compile Apple Vision OCR helper"
    swiftc "$ROOT_DIR/ocr_helper.swift" -o "$ROOT_DIR/ocr_helper" -framework Vision -framework AppKit
    chmod +x "$ROOT_DIR/ocr_helper"
    ;;
  Linux)
    info "ตรวจสอบ dependencies สำหรับ Linux"
    install_linux_packages
    ;;
  *)
    die "ระบบนี้ใช้ install.sh ไม่ได้ ให้ใช้ install.ps1 บน Windows"
    ;;
esac

NODE_MAJOR="$(node -p 'parseInt(process.versions.node.split(".")[0], 10)')"
[ "$NODE_MAJOR" -ge 20 ] || die "ต้องใช้ Node.js 20 ขึ้นไป; พบ $(node -v)"
ok "Node.js $(node -v) พร้อมใช้งาน"

info "ติดตั้ง Node.js dependencies และ CloakBrowser"
npm ci

if [ ! -f "$ROOT_DIR/service_config.json" ]; then
  cp "$ROOT_DIR/service_config.json.example" "$ROOT_DIR/service_config.json"
  info "สร้าง service_config.json จาก example"
else
  info "พบ service_config.json เดิม จึงไม่เขียนทับ"
fi

chmod +x "$ROOT_DIR/index.js" "$ROOT_DIR/browser_login_test.mjs"
ok "ติดตั้ง equality-itemcode-version เสร็จสมบูรณ์"
printf '\nแก้ไขไฟล์นี้ก่อนใช้งาน:\n  %s\n\nเริ่มระบบ:\n  cd %s\n  node index.js\n' \
  "$ROOT_DIR/service_config.json" "$ROOT_DIR"
