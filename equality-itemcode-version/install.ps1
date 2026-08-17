#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

function Info($Message) { Write-Host "[*] $Message" -ForegroundColor Yellow }
function Ok($Message) { Write-Host "[✓] $Message" -ForegroundColor Green }
function Fail($Message) { Write-Host "[✗] $Message" -ForegroundColor Red; exit 1 }

function Get-ExecutablePath($CommandName) {
    $command = Get-Command $CommandName -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $command) {
        return $null
    }

    if ($command.Source) {
        return $command.Source
    }
    if ($command.Path) {
        return $command.Path
    }
    return $command.Definition
}

function Set-ConfigStringValue($ConfigText, $Key, $Value) {
    $jsonValue = $Value | ConvertTo-Json -Compress
    $escapedKey = [regex]::Escape($Key)
    $pattern = '(?m)^(\s*"' + $escapedKey + '"\s*:\s*)("(?:\\.|[^"\\])*"|null)'

    if ([regex]::IsMatch($ConfigText, $pattern)) {
        $evaluator = [System.Text.RegularExpressions.MatchEvaluator]{
            param($Match)
            return $Match.Groups[1].Value + $jsonValue
        }
        return [regex]::Replace($ConfigText, $pattern, $evaluator)
    }

    $trimmed = $ConfigText.TrimEnd()
    if ($trimmed.EndsWith('}')) {
        $withoutClosingBrace = $trimmed.Substring(0, $trimmed.Length - 1).TrimEnd()
        if (-not $withoutClosingBrace.EndsWith(',')) {
            $withoutClosingBrace += ','
        }
        return $withoutClosingBrace + "`r`n  `"$Key`": $jsonValue`r`n}`r`n"
    }

    Fail "ไม่สามารถเพิ่ม $Key ลงใน service_config.json ได้"
}

function Update-WindowsConfigPaths($ConfigPath, $RootPath) {
    $ytdlPath = Get-ExecutablePath 'yt-dlp'
    $ffmpegPath = Get-ExecutablePath 'ffmpeg'
    $ocrPath = Join-Path $RootPath 'ocr_helper.ps1'

    if (-not $ytdlPath) {
        Fail "ติดตั้ง yt-dlp แล้วแต่ไม่พบคำสั่ง yt-dlp ใน PATH"
    }
    if (-not $ffmpegPath) {
        Fail "ติดตั้ง FFmpeg แล้วแต่ไม่พบคำสั่ง ffmpeg ใน PATH"
    }
    if (-not (Test-Path $ocrPath)) {
        Fail "ไม่พบ OCR helper: $ocrPath"
    }

    $configText = [System.IO.File]::ReadAllText($ConfigPath)
    $configText = Set-ConfigStringValue $configText 'ytdl_path_win' $ytdlPath
    $configText = Set-ConfigStringValue $configText 'ffmpeg_path_win' $ffmpegPath
    $configText = Set-ConfigStringValue $configText 'ocr_helper_path_win' $ocrPath

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($ConfigPath, $configText, $utf8NoBom)

    Info "บันทึก Windows paths ลงใน service_config.json แล้ว"
    Write-Host "  ytdl_path_win       = $ytdlPath"
    Write-Host "  ffmpeg_path_win     = $ffmpegPath"
    Write-Host "  ocr_helper_path_win = $ocrPath"
}

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

Update-WindowsConfigPaths (Join-Path $RootDir "service_config.json") $RootDir

Info "ติดตั้ง Node.js dependencies และ CloakBrowser"
npm ci
Ok "ติดตั้ง equality-itemcode-version เสร็จสมบูรณ์"
Write-Host "แก้ไข service_config.json ก่อนใช้งาน แล้วรัน: node index.js"
