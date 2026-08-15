# equality-itemcode-version

ระบบเฝ้าดู itemcode รุ่นแยกจากโปรเจกต์หลัก โดยตัด Discord ออกทั้งหมด เหลือ
Telegram เป็นช่องทางแจ้งเตือนแบบ optional

## Flow การทำงาน

1. ดึงภาพจาก YouTube Live ตาม `youtube_url`
2. อ่านรหัสจากภาพด้วย OCR และสร้างชุดรหัสใกล้เคียงตามกติกาเดิม
3. ตรวจสอบรหัสกับระบบ HOF
4. ส่งรหัสที่พบไป Telegram ถ้ามีการตั้งค่า Telegram
5. เปิด CloakBrowser ด้วย `username2/password2`
6. ผ่าน Cloudflare Turnstile อัตโนมัติ
7. ไปหน้า Tales Runner itemcode กรอกรหัส และกด `ใช้ไอเทมโค้ด`
8. ส่งผลเคลมผ่าน Browser ไป Telegram เพิ่มเติม ถ้ามีการตั้งค่า Telegram

หากการเคลมผ่าน Browser ไม่สำเร็จ ระบบจะเปิด flow ใหม่และลองซ้ำอัตโนมัติสูงสุด
5 ครั้ง โดยเว้นระยะ 5 วินาทีระหว่างครั้ง

การสแกนใช้ pipeline เดิมของ `node_service` คืออ่านรหัสจากเฟรมภาพ/ข้อความของ
ไลฟ์ แล้วจึงนำรหัสไปใช้ผ่าน Browser

## ติดตั้งแบบคำสั่งเดียว

### macOS / Ubuntu / Debian

```bash
bash equality-itemcode-version/install.sh
```

ตัวติดตั้งจะจัดการ Node.js 20+, FFmpeg, yt-dlp, OCR และ `npm ci` ให้ทั้งหมด
บน macOS จะ compile Apple Vision OCR helper ให้ด้วย ส่วน CloakBrowser จะดาวน์โหลด
Chromium ประมาณ 200MB ในการเปิดใช้งานครั้งแรก

### Windows PowerShell

```powershell
powershell -ExecutionPolicy Bypass -File .\equality-itemcode-version\install.ps1
```

## ตั้งค่า

สร้าง config จากไฟล์ตัวอย่าง:

```bash
cp service_config.json.example service_config.json
```

แก้ค่าใน `service_config.json`:

| ฟิลด์ | รายละเอียด |
|---|---|
| `youtube_url` | URL ช่องหรือไลฟ์ที่ต้องการสแกน |
| `username` / `password` | บัญชีหลักสำหรับตรวจสอบระบบเดิม |
| `username2` / `password2` | บัญชีสำรองสำหรับเคลมผ่านหน้าเว็บ |
| `browser_redeem_enabled` | เปิด flow เคลมผ่าน Browser |
| `browser_redeem_headless` | `true` ให้ Browser ทำงานเบื้องหลัง |
| `telegram_token` | Telegram Bot Token (ไม่บังคับ) |
| `telegram_chat_id` | Telegram Chat ID (ไม่บังคับ) |
| `telegram_enabled` | `true` เมื่อต้องการส่ง Telegram |
| `scan_interval` | ระยะห่างระหว่างการสแกน หน่วยวินาที |
| `proxy_url` | Proxy แบบ HTTP/HTTPS ถ้ามี |

### ใช้งานโดยไม่ตั้ง Telegram

ลบ `telegram_token`, `telegram_chat_id` ออกจาก `service_config.json` ได้ หรือปล่อย
เป็นค่าว่างและตั้ง `telegram_enabled` เป็น `false` ระบบจะยังสแกน ตรวจสอบ และเคลม
ผ่าน Browser ต่อไป โดยข้ามเฉพาะการแจ้งเตือน Telegram

## วิธีใช้งาน

รันระบบตามปกติ:

```bash
node index.js
```

ตั้ง Access Token แล้วเริ่มระบบ:

```bash
node index.js --set-token <TOKEN>
```

## วิธีดึง `access_token` ด้วย Cookie-Editor

ใช้ส่วนขยาย [Cookie-Editor สำหรับ Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/cookieeditor/neaplmfkghagebokkhpjpoebhdledlfi)
เพื่อคัดลอก token หลังล็อกอิน:

1. ติดตั้ง Cookie-Editor ใน Microsoft Edge
2. เปิดหน้า [HOF Login](https://passport.thehof.gg/hall-of-fame-web/login)
3. ล็อกอินด้วยบัญชีหลัก และทำ Cloudflare/Turnstile ให้เสร็จ
4. กดไอคอน Cookie-Editor บนแถบเครื่องมือของ Edge
5. ค้นหาหรือขยายรายการชื่อ `access_token`
6. คัดลอกค่าในช่อง `Value` ทั้งหมดตามภาพ โดยไม่ต้องคัดลอก `refresh_token`
7. กลับไปที่ Terminal แล้วบันทึก token ด้วยคำสั่ง:

```bash
cd equality-itemcode-version
node index.js --set-token "<ACCESS_TOKEN>"
```

คำสั่งนี้จะบันทึก token ลงใน `.session_config.json` แล้วเริ่มระบบต่ออัตโนมัติ
สามารถใส่ค่าแบบมีหรือไม่มีคำนำหน้า `Bearer ` ได้

`access_token` เป็นข้อมูลลับ ห้ามส่งต่อหรือ commit ลง Git หาก token หมดอายุให้
ล็อกอินใหม่แล้วคัดลอกค่าใหม่จาก Cookie-Editor

รันเบื้องหลัง:

```bash
nohup node index.js > node_service.log 2>&1 &
```

## คำสั่งทดสอบ

ทดสอบ login โดยเปิด Chromium และกด Turnstile อัตโนมัติ:

```bash
npm run test:login:show
```

ทดสอบบัญชีสำรอง:

```bash
HOF_ACCOUNT=secondary npm run test:login:show
```

ทดสอบ flow กรอกรหัสและใช้ itemcode:

```bash
node index.js --test-browser-redeem KEXEDP8BSF8P
```

## ไฟล์ที่สร้างระหว่างทำงาน

ไฟล์ต่อไปนี้เป็นข้อมูล runtime และไม่ควร commit:

- `service_config.json`
- `.session_config.json`
- `ocr_history.json`
- `notified_codes.log`
- `.browser-profile/`
- `.auth/`
- `node_service.log`
