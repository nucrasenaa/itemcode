# `equality-itemcode-version`

Service รุ่นแยกของ ItemCode Watcher สำหรับ flow แบบ Browser ตั้งแต่ login,
สร้าง session/access token, ตรวจสอบ code, แจ้งเตือน และทำรายการผ่านหน้าเว็บ
โดยรองรับ Telegram แบบ optional

## ติดตั้งแบบคำสั่งเดียว

### macOS / Ubuntu / Debian

จากโฟลเดอร์รากของโปรเจกต์:

```bash
bash equality-itemcode-version/install.sh
```

สคริปต์จะตรวจหรือติดตั้ง Node.js 20+, FFmpeg, `yt-dlp`, OCR helper,
npm dependencies และ Browser ที่จำเป็น

### Windows PowerShell

```powershell
powershell -ExecutionPolicy Bypass -File .\equality-itemcode-version\install.ps1
```

หลังติดตั้ง ให้สร้างหรือแก้ `service_config.json` ก่อนเริ่มระบบ

## บัญชีที่ใช้ในระบบ

| ค่า | ใช้ทำอะไร |
|---|---|
| `username` / `password` | บัญชีหลักสำหรับ login และตรวจสอบ code |
| `username2` / `password2` | บัญชีสำหรับ Browser flow ถ้าเปิดใช้ |

## Flow การทำงาน

1. โหลด session เดิมและตรวจสอบ access token
2. ถ้า session ใช้ไม่ได้ ให้เปิด Browser login
3. ดึง token จาก Cookie/Storage ตาม flow ที่ตั้งค่าไว้
4. บันทึก session ในไฟล์ runtime และใช้ตรวจสอบ code
5. ส่งแจ้งเตือนเมื่อพบ code หากเปิด Telegram
6. เปิด Browser flow เพื่อทำรายการต่อหากเปิดใช้งาน
7. ส่งผลสำเร็จ/ล้มเหลว และ retry ตามค่าที่ตั้งไว้

## ตั้งค่า

สร้าง config จากตัวอย่าง:

```bash
cd equality-itemcode-version
cp service_config.json.example service_config.json
```

ไฟล์ตัวอย่างเป็น JSONC และรองรับ comment แบบ `//` ใน config runtime

ค่าหลักที่ต้องตรวจ:

- `youtube_url`
- `username`, `password`
- `username2`, `password2`
- `browser_token_login_enabled`
- `browser_token_login_headless`
- `browser_redeem_enabled`
- `browser_redeem_headless`
- `telegram_token`, `telegram_chat_id`, `telegram_enabled`
- `scan_interval`, `regex_pattern`, `proxy_url`

## การทดสอบ

```bash
node index.js --test-browser-token-login
node index.js --test-browser-redeem ITEM_CODE
node index.js
```

## ไฟล์ runtime และข้อมูลลับ

ไฟล์ต่อไปนี้สร้างระหว่างทำงานและต้องไม่ commit:

- `service_config.json`
- `.session_config.json`
- `.browser-profile/`
- `.auth/`
- `ocr_history.json`
- `notified_codes.log`
- `*.log`

ห้ามใส่ password, access token, cookie หรือ webhook จริงใน source, README หรือไฟล์ตัวอย่าง
