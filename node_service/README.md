# TalesRunner ItemCode Watcher — `node_service`


บริการ Node.js สำหรับเฝ้าดูไลฟ์ TalesRunner, อ่าน itemcode จากภาพ, ตรวจสอบ serial
กับ HOF และแจ้งเตือนเมื่อพบ code รองรับ macOS, Windows และ Linux

โปรเจกต์นี้ยังรองรับการแจ้งเตือนทั้ง **Telegram** และ **Discord** ส่วนการใช้ itemcode
ผ่านหน้าเว็บทำงานด้วย CloakBrowser และ Turnstile ใน Browser

## ติดตั้ง

### macOS

```bash
cd node_service
chmod +x install_mac.sh
./install_mac.sh
npm install
```

สคริปต์จะติดตั้ง Homebrew dependencies, Node.js, `yt-dlp`, FFmpeg และ compile
Apple Vision OCR helper ให้

### Windows PowerShell

```powershell
cd <โฟลเดอร์โปรเจกต์>\node_service
powershell -ExecutionPolicy Bypass -File .\install_win.ps1
npm install
```

### Ubuntu/Debian Linux

```bash
sudo apt-get update
sudo apt-get install -y nodejs npm ffmpeg tesseract-ocr tesseract-ocr-eng
sudo wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
cd /path/to/itemcode/node_service
npm install
```

แนะนำ Node.js 20 ขึ้นไปเพื่อให้ Browser dependencies ทำงานตรงกับสภาพแวดล้อมที่ทดสอบ

## ภาพรวมการทำงาน

1. ดึงภาพจาก `youtube_url` ตามรอบเวลาที่กำหนด
2. ใช้ OCR อ่าน itemcode และสร้างชุดรหัสที่ใกล้เคียง
3. ตรวจสอบ serial ผ่าน HOF API ด้วย `access_token`
4. แจ้ง code ที่พบไปยัง Telegram/Discord ตามที่เปิดใช้งาน
5. ถ้าเปิด `browser_redeem_enabled` ให้ใช้บัญชี `username2/password2` เปิดหน้า
   itemcode กรอก code และกด `ใช้ไอเทมโค้ด`
6. แจ้งผลการทำรายการผ่าน Browser ไปยัง Telegram เพิ่มเติม
7. หาก Browser redeem ไม่สำเร็จ จะลองใหม่สูงสุด 5 รอบ โดยเว้น 10 วินาที

## บัญชีที่ใช้ในระบบ

| ค่า | ใช้ทำอะไร |
|---|---|
| `username` / `password` | บัญชีหลัก ใช้ login ผ่าน Browser เพื่อรับ `access_token` และใช้ตรวจสอบ/check serial ผ่าน API |
| `username2` / `password2` | บัญชีรอง ใช้ login ผ่าน Browser เพื่อเปิดหน้า itemcode และเคลม code |

บัญชีทั้งสองชุดใช้แยกกันได้ และไม่จำเป็นต้องเป็นบัญชีเดียวกัน

## ตั้งค่า `service_config.json`

สร้างไฟล์จากตัวอย่าง:

```bash
cd node_service
cp service_config.json.example service_config.json
```

จากนั้นแก้ค่าเหล่านี้:

| ฟิลด์ | รายละเอียด |
|---|---|
| `youtube_url` | URL ช่องหรือไลฟ์ที่ต้องการสแกน |
| `username` / `password` | บัญชีหลักสำหรับ login และ check serial |
| `username2` / `password2` | บัญชีรองสำหรับใช้ itemcode ผ่าน Browser |
| `browser_token_login_enabled` | เปิด Browser login เพื่อดึง `access_token` อัตโนมัติ; ค่าเริ่มต้น `true` |
| `browser_token_login_headless` | `true` ทำงานเบื้องหลัง, `false` เปิดหน้าต่าง Browser |
| `browser_redeem_enabled` | เปิด flow กรอกและใช้ itemcode ผ่าน Browser |
| `browser_redeem_headless` | `true` ทำงานเบื้องหลัง, `false` เปิดหน้าต่าง Browser |
| `telegram_token` | Telegram Bot Token; ไม่บังคับ |
| `telegram_chat_id` | Telegram Chat ID; ไม่บังคับ |
| `telegram_enabled` | เปิด/ปิด Telegram |
| `discord_webhook_url` | Discord Webhook URL หรือรายการ URL |
| `discord_enabled` | เปิด/ปิด Discord |
| `scan_interval` | ช่วงเวลาระหว่างการสแกนภาพ หน่วยวินาที |
| `regex_pattern` | รูปแบบ code ที่ OCR จะค้นหา |
| `game_id` | Game ID ของ TalesRunner |
| `proxy_url` | HTTP/HTTPS Proxy; ปล่อยว่างถ้าไม่ใช้ |

ถ้าไม่ได้ใส่ `browser_token_login_enabled` หรือ `browser_token_login_headless` ระบบจะ
เติมค่าเริ่มต้นเป็น `true` ให้เอง

## การ login และรับ `access_token`

เมื่อไม่มี session ที่ใช้งานได้ ระบบจะทำตามลำดับนี้:

1. เปิดหน้า HOF login ด้วย CloakBrowser
2. ผ่าน Cloudflare/Turnstile อัตโนมัติ
3. login ด้วย `username/password`
4. อ่าน `access_token` จาก Cookie หรือ Browser Storage
5. บันทึกลง `.session_config.json` โดยไม่แสดงค่าจริงของ token
6. ใช้ token ที่บันทึกไว้สำหรับ check serial
7. หาก Browser login ไม่สำเร็จ จะลอง OAuth PKCE เป็น fallback

ดังนั้นการใช้งานปกติไม่ต้องติดตั้ง extension หรือใส่ Turnstile key เพิ่ม

### ทดสอบ Browser login โดยตรง

```bash
cd node_service
node index.js --test-browser-token-login
```

คำสั่งนี้จะ login บัญชีหลัก, บันทึก session แล้วจบการทำงานโดยไม่เริ่มสแกนไลฟ์

### ทางเลือกสำรอง: Cookie-Editor

1. ติดตั้ง [Cookie-Editor สำหรับ Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/cookieeditor/neaplmfkghagebokkhpjpoebhdledlfi)
2. เปิด [หน้า HOF login](https://passport.thehof.gg/hall-of-fame-web/login)
3. login และทำ Turnstile ให้เสร็จ
4. เปิด Cookie-Editor แล้วค้นหา `access_token`
5. คัดลอกค่าในช่อง `Value` แล้วตั้งค่า:

```bash
node index.js --set-token "<ACCESS_TOKEN>"
```

`access_token` เป็นข้อมูลลับ ห้ามส่งในแชต ห้าม commit และห้ามใส่ไว้ใน README

## คำสั่งใช้งานและทดสอบ

### รันระบบจริง

```bash
cd node_service
node index.js
```

### รันเบื้องหลังบน macOS/Linux

```bash
nohup node index.js > node_service.log 2>&1 &
```

### ทดสอบ login แบบเปิด Chromium

```bash
npm run test:login:show
```

ทดสอบบัญชีรอง:

```bash
HOF_ACCOUNT=secondary npm run test:login:show
```

### ทดสอบ Browser redeem ด้วย code จำลอง

```bash
node index.js --test-browser-redeem KEXEDP8BSF8P
```

คำสั่งนี้ใช้ `username2/password2` เปิดหน้า itemcode, กรอก code, ผ่าน Turnstile,
กดปุ่มใช้ itemcode และแสดงผลลัพธ์โดยไม่เริ่มสแกนไลฟ์

### ตรวจสอบ serial ผ่าน API

```bash
node index.js --redeem KEXEDP8BSF8P
```

## การทำงานแบบ Headless/Visible

ค่าปกติทำงานแบบเบื้องหลัง:

```json
"browser_token_login_headless": true,
"browser_redeem_headless": true
```

ถ้าต้องการดู Browser ตอนทดสอบ login token:

```bash
BROWSER_TOKEN_LOGIN_HEADLESS=false node index.js --test-browser-token-login
```

## ไฟล์ runtime และข้อมูลลับ

ไฟล์ต่อไปนี้สร้างระหว่างทำงานและไม่ควร commit:

- `service_config.json`
- `.session_config.json`
- `.browser-profile/`
- `.auth/`
- `ocr_history.json`
- `notified_codes.log`
- `node_service.log`

## แก้ปัญหาเบื้องต้น

- **ไม่มี token:** ตรวจ `username/password` และลอง `node index.js --test-browser-token-login`
- **Turnstile ไม่ผ่าน:** ลองโหมด visible ด้วย `BROWSER_TOKEN_LOGIN_HEADLESS=false`
- **หน้า itemcode ไม่ทำงาน:** ตรวจ `username2/password2` และ `browser_redeem_enabled`
- **ไม่มีข้อความแจ้งเตือน:** ตรวจ `telegram_token`, `telegram_chat_id`, `telegram_enabled`
  หรือค่า Discord ที่เกี่ยวข้อง
- **OCR ไม่ทำงาน:** ตรวจ `yt-dlp`, FFmpeg, Tesseract หรือ `ocr_helper` ตามระบบปฏิบัติการ
