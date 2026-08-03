#!/usr/bin/env bash
# =============================================================================
#  TalesRunner Itemcode Watcher - Tor & Privoxy Installer (macOS)
# =============================================================================
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
info() { echo -e "${YELLOW}[*]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# 1. Install via Homebrew
info "กำลังติดตั้ง tor และ privoxy ผ่าน Homebrew..."
brew install tor privoxy
ok "ติดตั้ง tor และ privoxy สำเร็จ"

# 2. Find Privoxy Config
if [ -d "/opt/homebrew/etc/privoxy" ]; then
    PRIVOXY_CONF="/opt/homebrew/etc/privoxy/config"
elif [ -d "/usr/local/etc/privoxy" ]; then
    PRIVOXY_CONF="/usr/local/etc/privoxy/config"
else
    PRIVOXY_CONF=""
fi

# 3. Configure Privoxy to use Tor SOCKS5
if [ -n "$PRIVOXY_CONF" ] && [ -f "$PRIVOXY_CONF" ]; then
    info "กำลังตั้งค่า Privoxy ให้เชื่อมต่อกับ Tor SOCKS5 ที่ $PRIVOXY_CONF..."
    if ! grep -q "forward-socks5t / 127.0.0.1:9050 ." "$PRIVOXY_CONF"; then
        # Append forward line
        echo "" >> "$PRIVOXY_CONF"
        echo "forward-socks5t / 127.0.0.1:9050 ." >> "$PRIVOXY_CONF"
        ok "เพิ่มเส้นทาง forward-socks5t ไปยัง Tor สำเร็จ"
    else
        ok "เส้นทาง forward-socks5t ถูกตั้งค่าไว้แล้ว"
    fi
else
    err "ไม่พบไฟล์คอนฟิกของ Privoxy กรุณาตั้งค่าด้วยตนเอง"
fi

# 4. Start / Restart Services
info "กำลังเริ่มทำงานบริการ Tor และ Privoxy..."
brew services restart tor
brew services restart privoxy
ok "เริ่มบริการ Tor และ Privoxy สำเร็จแล้ว!"

echo -e "\n${GREEN}✅ ติดตั้งและเปิดใช้งาน Tor + Privoxy เรียบร้อย!${NC}"
echo "- Tor SOCKS5: SOCKS5 127.0.0.1:9050"
echo "- Privoxy HTTP: HTTP 127.0.0.1:8118 (ใช้ค่านี้ระบุใน proxy_url ของบอท)"
