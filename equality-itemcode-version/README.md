# equality-itemcode-version


รุ่นแยกของ ItemCode Watcher สำหรับ flow แบบ Browser ตั้งแต่ login, รับ
`access_token`, check serial, แจ้งเตือน Telegram ไปจนถึงใช้ itemcode ผ่านหน้าเว็บ

รุ่นนี้ **ตัด Discord ออกทั้งหมด** เหลือ Telegram เป็นช่องทางแจ้งเตือนแบบ optional:
ถ้าไม่ใส่ Telegram ใน `service_config.json` ระบบยังสแกน, check serial และใช้ itemcode
ต่อได้ เพียงข้ามการแจ้งเตือน

## ติดตั้งแบบคำสั่งเดียว

### macOS / Ubuntu / Debian

จากโฟลเดอร์รากของโปรเจกต์:

```bash
bash equality-itemcode-version/install.sh
```

สคริปต์จะตรวจหรือติดตั้ง Node.js 20+, FFmpeg, yt-dlp, Tesseract, compile OCR helper
บน macOS, ติดตั้ง npm dependencies และดาวน์โหลด Browser ที่จำเป็นเมื่อเปิดใช้ครั้งแรก

### Windows PowerShell

```powershell
powershell -ExecutionPolicy Bypass -File .\equality-itemcode-version\install.ps1
```

หลังติดตั้งเสร็จ ให้แก้ `service_config.json` ก่อนเริ่มระบบ

บน Windows `install.ps1` จะตรวจหา path จริงของ `yt-dlp.exe` และ `ffmpeg.exe`
จาก PATH แล้วเขียนค่าให้อัตโนมัติใน `service_config.json` พร้อมใส่ path จริงของ
`ocr_helper.ps1` จากโฟลเดอร์โปรเจกต์ ดังนั้นไม่ต้องกรอก `ytdl_path_win`,
`ffmpeg_path_win` และ `ocr_helper_path_win` เอง หากคำสั่งติดตั้งทำงานสำเร็จ

ถ้าในโฟลเดอร์มี `service_config.json` อยู่แล้ว สคริปต์จะเก็บค่า account และ token เดิมไว้
แล้วแก้เฉพาะสามค่า path นี้เท่านั้น

## บัญชีที่ใช้ในระบบ

| ค่า | ใช้ทำอะไร |
|---|---|
| `username` / `password` | บัญชีหลัก ใช้ login ผ่าน Browser เพื่อรับ `access_token` และใช้ check serial ผ่าน API |
| `username2` / `password2` | บัญชีรอง ใช้ login ผ่าน Browser เพื่อกรอกและใช้ itemcode |

## Flow การทำงาน

1. โหลด session เดิมและตรวจสอบ `access_token`
2. ถ้าไม่มี token ที่ใช้ได้ เปิด CloakBrowser ด้วย `username/password`
3. ผ่าน Cloudflare/Turnstile และดึง `access_token` จาก Cookie/Storage
4. บันทึก token ลง `.session_config.json` แล้วใช้ check serial
5. เมื่อพบ code ส่งแจ้งเตือนไป Telegram ถ้ามีการตั้งค่า
6. หลังแจ้งเตือนเสร็จ เปิด Browser ด้วย `username2/password2`
7. ไปที่หน้า [TalesRunner itemcode](https://member.thehof.gg/talesrunner/itemcode)
8. กรอก code, ผ่าน Turnstile และกด `ใช้ไอเทมโค้ด`
9. ส่งผลสำเร็จ/ไม่สำเร็จ/ปิดปรับปรุงไป Telegram
10. ถ้า Browser redeem ไม่สำเร็จ ลองใหม่สูงสุด 5 ครั้ง เว้น 10 วินาทีระหว่างครั้ง

## ตั้งค่า

สร้าง config จากตัวอย่าง:

```bash
cd equality-itemcode-version
cp service_config.json.example service_config.json
```

ไฟล์ตัวอย่างเป็น JSONC: มี comment แบบ `//` กำกับแต่ละกลุ่ม และโปรแกรมรองรับ comment
แบบบรรทัดเดียวใน `service_config.json` ได้ จึงสามารถคัดลอกแล้วแก้ค่าได้ทันที

### ค่าหลักที่ต้องแก้

| ฟิลด์ | รายละเอียด |
|---|---|
| `youtube_url` | URL ช่องหรือไลฟ์ที่ต้องการสแกน |
| `username` / `password` | บัญชีหลักสำหรับ login และ check serial |
| `username2` / `password2` | บัญชีรองสำหรับใช้ itemcode |
| `browser_token_login_enabled` | เปิด login บัญชีหลักผ่าน Browser; ค่าเริ่มต้น `true` |
| `browser_token_login_headless` | `true` ทำงานเบื้องหลัง, `false` เปิด Browser ให้เห็น |
| `browser_redeem_enabled` | เปิดการใช้ itemcode ผ่าน Browser |
| `browser_redeem_headless` | `true` ทำงานเบื้องหลัง, `false` เปิด Browser ให้เห็น |
| `telegram_token` | Telegram Bot Token; ไม่บังคับ |
| `telegram_chat_id` | Telegram Chat ID; ไม่บังคับ |
| `telegram_enabled` | เปิด/ปิด Telegram |
| `scan_interval` | ช่วงเวลาระหว่างการสแกนภาพ หน่วยวินาที |
| `proxy_url` | HTTP/HTTPS Proxy; ปล่อยว่างถ้าไม่ใช้ |

ถ้าไม่ต้องการ Telegram ให้ปล่อย `telegram_token` และ `telegram_chat_id` เป็นค่าว่าง
หรือกำหนด `telegram_enabled` เป็น `false` ระบบจะทำงานส่วนอื่นต่อได้ตามปกติ

## การ login และรับ `access_token`

ระบบจะใช้ `username/password` ผ่าน Browser เป็นวิธีหลัก ไม่ต้องคัดลอก token จาก
Cookie-Editor ในการใช้งานปกติ:

1. เปิดหน้า HOF login
2. ผ่าน Turnstile อัตโนมัติ
3. login ด้วยบัญชีหลัก
4. อ่าน `access_token` จาก Cookie หรือ Browser Storage
5. บันทึก session และนำ token ไป check serial
6. ถ้า Browser login ไม่สำเร็จ จึงลอง OAuth PKCE เป็น fallback

### ทดสอบ Browser login และ token

```bash
node index.js --test-browser-token-login
```

คำสั่งนี้จะบันทึก session แล้วจบการทำงาน โดยไม่แสดงค่า token จริงออกทางหน้าจอ

### ดึง token ด้วย Cookie-Editor (ทางเลือกสำรอง)

1. ติดตั้ง [Cookie-Editor สำหรับ Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/cookieeditor/neaplmfkghagebokkhpjpoebhdledlfi)
2. เปิด [หน้า HOF login](https://passport.thehof.gg/hall-of-fame-web/login)
3. login และทำ Turnstile ให้เสร็จ
4. เปิดส่วนขยาย ค้นหา `access_token`
5. คัดลอกค่าในช่อง `Value` แล้วบันทึกด้วย:

```bash
node index.js --set-token "<ACCESS_TOKEN>"
```

ห้ามเผยแพร่หรือ commit `access_token`, password, Telegram token หรือ config จริง

## คำสั่งใช้งาน

### รันระบบจริง

```bash
cd equality-itemcode-version
node index.js
```

### รันเบื้องหลัง

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

ถ้าต้องการทดสอบ login token แบบเปิดหน้าต่าง:

```bash
BROWSER_TOKEN_LOGIN_HEADLESS=false node index.js --test-browser-token-login
```

### ทดสอบการกรอกและใช้ itemcode ผ่าน Browser

```bash
node index.js --test-browser-redeem KEXEDP8BSF8P
```

คำสั่งนี้ใช้บัญชี `username2/password2` และไม่เริ่มสแกนไลฟ์

## Headless และการ retry

ค่าปกติใน example ทำงานเบื้องหลัง:

```json
"browser_token_login_headless": true,
"browser_redeem_headless": true
```

เมื่อ redeem ไม่สำเร็จ ระบบจะเปิด flow ใหม่สูงสุด 5 ครั้ง และรอ 10 วินาทีระหว่างครั้ง
ผลของแต่ละรอบและผลสุดท้ายจะถูกส่ง Telegram เมื่อ Telegram ถูกตั้งค่าไว้

## ไฟล์ runtime และข้อมูลลับ

- `service_config.json`
- `.session_config.json`
- `.browser-profile/`
- `.auth/`
- `ocr_history.json`
- `notified_codes.log`
- `node_service.log`

ไฟล์เหล่านี้ควรเก็บไว้ในเครื่องและไม่ควร commit ลง repository

## แก้ปัญหาเบื้องต้น

- **ไม่มี token:** ตรวจ `username/password` แล้วรัน `node index.js --test-browser-token-login`
- **Turnstile ไม่ผ่าน:** ลองโหมด visible ด้วย `BROWSER_TOKEN_LOGIN_HEADLESS=false`
- **ใช้ itemcode ไม่ได้:** ตรวจ `username2/password2` และ `browser_redeem_enabled`
- **ไม่มี Telegram:** ตรวจ `telegram_token`, `telegram_chat_id` และ `telegram_enabled`
- **OCR ไม่ทำงาน:** ตรวจ yt-dlp, FFmpeg, Tesseract และ `ocr_helper` ตามระบบปฏิบัติการ
