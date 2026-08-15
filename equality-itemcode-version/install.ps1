#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

function Info($Message) { Write-Host "[*] $Message" -ForegroundColor Yellow }
function Ok($Message) { Write-Host "[✓] $Message" -ForegroundColor Green }
function Fail($Message) { Write-Host "[✗] $Message" -ForegroundColor Red; exit 1 }

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Fail "ไม่พบ winget กรุณาติดตั้ง App Installer จาก Microsoft Store"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Info "ติดตั้ง Node.js LTS"
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
}

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Info "ติดตั้ง FFmpeg"
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
}

if (-not (Get-Command yt-dlp -ErrorAction SilentlyContinue)) {
    Info "ติดตั้ง yt-dlp"
    winget install --id yt-dlp.yt-dlp -e --accept-source-agreements --accept-package-agreements
}

$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
$NodeMajor = [int]((node -p "process.versions.node.split('.')[0]").Trim())
if ($NodeMajor -lt 20) { Fail "ต้องใช้ Node.js 20 ขึ้นไป" }

if (-not (Test-Path (Join-Path $RootDir "service_config.json"))) {
    Copy-Item (Join-Path $RootDir "service_config.json.example") (Join-Path $RootDir "service_config.json")
    Info "สร้าง service_config.json จาก example"
}

Info "ติดตั้ง Node.js dependencies และ CloakBrowser"
npm ci
Ok "ติดตั้ง equality-itemcode-version เสร็จสมบูรณ์"
Write-Host "แก้ไข service_config.json ก่อนใช้งาน แล้วรัน: node index.js"
