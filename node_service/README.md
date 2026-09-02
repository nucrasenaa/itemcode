# ItemCode Watcher — `node_service`

บริการ Node.js แบบ headless สำหรับเฝ้าดูแหล่งวิดีโอ/ไลฟ์, อ่าน ItemCode จากภาพ,
ตรวจสอบ code กับ upstream API และเลือกใช้ Browser flow สำหรับทำรายการต่อ
รองรับ macOS, Windows และ Linux

รองรับการแจ้งเตือนผ่าน Telegram และ Discord แบบเลือกใช้ได้

## ติดตั้ง

### macOS

```bash
cd node_service
chmod +x install_mac.sh
./install_mac.sh
npm install
```

### Windows PowerShell

```powershell
cd <PROJECT_DIR>\node_service
powershell -ExecutionPolicy Bypass -File .\install_win.ps1
npm install
```

### Ubuntu/Debian Linux

```bash
sudo apt-get update
sudo apt-get install -y nodejs npm ffmpeg tesseract-ocr tesseract-ocr-eng
cd /path/to/project/node_service
npm install
```

แนะนำ Node.js 20 ขึ้นไป และติดตั้ง `yt-dlp`, FFmpeg, OCR และ Browser dependency
ให้ครบตามระบบปฏิบัติการ

## ภาพรวมการทำงาน

1. ดึงภาพจากค่าที่กำหนดใน `youtube_url`
2. ใช้ OCR อ่าน ItemCode และสร้าง candidate ที่ใกล้เคียง
3. ตรวจสอบ code ผ่าน upstream API ด้วย session/access token
4. แจ้ง code ที่พบไปยังช่องทางที่เปิดใช้งาน
5. หากเปิด Browser flow ให้ login และทำรายการด้วยบัญชีที่กำหนด
6. แจ้งผลสำเร็จ/ล้มเหลว และ retry ตามค่าที่ตั้งไว้

## ตั้งค่า

สร้าง config จากตัวอย่าง:

```bash
cd node_service
cp service_config.json.example service_config.json
```

ค่าหลักที่ใช้บ่อย:

| ฟิลด์ | รายละเอียด |
|---|---|
| `youtube_url` | URL แหล่งวิดีโอหรือไลฟ์ที่ต้องการสแกน |
| `username` / `password` | บัญชีสำหรับ login และตรวจสอบ code |
| `username2` / `password2` | บัญชีสำหรับ Browser flow ถ้าเปิดใช้ |
| `browser_token_login_enabled` | เปิด/ปิดการ login เพื่อสร้าง session อัตโนมัติ |
| `browser_token_login_headless` | เปิด/ปิดหน้าต่าง Browser ตอน login |
| `browser_redeem_enabled` | เปิด/ปิด Browser flow |
| `browser_redeem_headless` | เปิด/ปิดหน้าต่าง Browser ตอนทำรายการ |
| `telegram_token` / `telegram_chat_id` | ข้อมูล Telegram; ไม่บังคับ |
| `discord_webhook_url` | Discord Webhook; ไม่บังคับ |
| `scan_interval` | ช่วงเวลาระหว่างรอบสแกน |
| `regex_pattern` | รูปแบบ ItemCode ที่ OCR จะค้นหา |
| `proxy_url` | Proxy ถ้าต้องการใช้ |

## Session และข้อมูลลับ

ระบบอาจเก็บ session/access token ใน `.session_config.json` และสร้าง profile/log ระหว่างทำงาน
ไฟล์เหล่านี้ถูก ignore ไว้แล้ว ห้ามเปลี่ยนเป็นไฟล์ tracked หรือใส่ค่าจริงใน README

## คำสั่งทดสอบ

```bash
node index.js --test-browser-token-login
node index.js --test-browser-redeem ITEM_CODE
node index.js --redeem ITEM_CODE
node index.js
```

## โหมด Browser

ค่าปกติทำงานแบบ headless หากต้องการดูหน้าต่าง Browser ตอนทดสอบ ให้ตั้งค่า headless เป็น `false`
ใน config หรือใช้ environment variable ที่โปรแกรมรองรับ

## แก้ปัญหาเบื้องต้น

- ตรวจ Node.js, `yt-dlp`, FFmpeg, OCR และ Browser dependency
- ตรวจ account และ session ในไฟล์ config/runtime
- เปิด Browser แบบ visible เพื่อดูขั้นตอน login
- ตรวจค่า Telegram/Discord และ log ล่าสุด
- ตรวจว่า `youtube_url` และ `regex_pattern` ถูกต้อง
