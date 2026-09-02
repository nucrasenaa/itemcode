#!/bin/bash

# TalesRunner ItemCode Watcher — Ubuntu/Linux Auto Installer
# Script to install all dependencies for Linux VPS

# Color codes for pretty printing
GREEN='\033[0;32m'
NC='\033[0;3m' # No Color
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'

echo -e "${BLUE}======================================================${NC}"
echo -e "   TalesRunner ItemCode Watcher - Linux Auto-Installer"
echo -e "${BLUE}======================================================${NC}"

# Check if running with sudo/root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[-] Please run this script with sudo or as root!${NC}"
  echo -e "    Example: sudo ./install_linux.sh"
  exit 1
fi

echo -e "${YELLOW}[*] 1. Updating APT Package Lists...${NC}"
apt update -y

echo -e "${YELLOW}[*] 2. Installing Prerequisites (curl, wget)...${NC}"
apt install -y curl wget gnupg

# Check if Node.js is already installed and matches version >= 18
NODE_INSTALLED=false
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VER" -ge 18 ]; then
    NODE_INSTALLED=true
    echo -e "${GREEN}[+] Found Node.js version $(node -v) (Version >= 18). Skipping Node.js installation.${NC}"
  fi
fi

if [ "$NODE_INSTALLED" = false ]; then
  echo -e "${YELLOW}[*] Installing Node.js 20.x from NodeSource...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi

echo -e "${YELLOW}[*] 3. Installing FFmpeg, Python 3, and Tesseract OCR...${NC}"
apt install -y ffmpeg python3 tesseract-ocr tesseract-ocr-eng

# Install/Update yt-dlp from official Github source to get the absolute latest signatures
echo -e "${YELLOW}[*] 4. Installing the latest yt-dlp binary...${NC}"
wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp

# Verify yt-dlp installation
if command -v yt-dlp >/dev/null 2>&1; then
  echo -e "${GREEN}[+] yt-dlp installed successfully! Version: $(yt-dlp --version)${NC}"
else
  echo -e "${RED}[-] Failed to install yt-dlp from Github releases. Trying standard APT fallback...${NC}"
  apt install -y yt-dlp
fi

echo -e "${YELLOW}[*] 5. Creating configuration file...${NC}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/service_config.json"
CONFIG_EXAMPLE="$CONFIG_FILE.example"

if [ -f "$CONFIG_FILE" ]; then
  echo -e "${GREEN}[+] service_config.json already exists. Skipping creation.${NC}"
else
  if [ -f "$CONFIG_EXAMPLE" ]; then
    cp "$CONFIG_EXAMPLE" "$CONFIG_FILE"
    echo -e "${GREEN}[+] Created service_config.json from template successfully!${NC}"
  else
    echo -e "${RED}[-] Warning: service_config.json.example not found. Please create service_config.json manually.${NC}"
  fi
fi

echo -e "${BLUE}======================================================${NC}"
echo -e "${GREEN}[+] Installation Completed Successfully!${NC}"
echo -e "${BLUE}======================================================${NC}"
echo -e "   How to run:"
echo -e "   1. Edit ${YELLOW}service_config.json${NC} to set your HOF account credentials and Telegram/Discord configuration."
echo -e "   2. Start the service by running:"
echo -e "      ${GREEN}node index.js${NC}"
echo -e "   3. (Optional) Run in background using screen, pm2, or nohup:"
echo -e "      ${GREEN}nohup node index.js > node_service.log 2>&1 &${NC}"
echo -e "${BLUE}======================================================${NC}"
