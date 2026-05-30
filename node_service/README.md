# 🎮 TalesRunner ItemCode Watcher — Headless Node.js Service

ระบบสแกนโค้ดไอเทมอัตโนมัติแบบรันเบื้องหลัง (Headless) รวดเร็วและกินทรัพยากรเครื่องน้อยมาก  
รองรับทั้ง **macOS** และ **Windows** พร้อมแจ้งเตือนผ่าน **Telegram** และ **Discord**

---

## ✨ ฟีเจอร์หลัก
* 📺 **OCR สแกนไลฟ์สตรีม:** ดึงภาพเฟรมตรงจาก YouTube Live และอ่านตัวหนังสือบนจอด้วย AI-OCR
* 🔑 **ตรวจสอบโค้ดอัตโนมัติ (Check Serial):** ยิงเช็ค API ของ HOF ทันทีเพื่อดูความถูกต้องและรางวัล
* 📲 **ระบบแจ้งเตือนด่วน:** ส่งรหัสเข้า Telegram/Discord ทันทีที่พบเพื่อให้สามารถกดเคลมเองได้สะดวก
* ⏳ **Rate-limit / Captcha Handling:** รอและจัดระบบล็อกอิน (Re-auth) อัตโนมัติเมื่อชนขีดจำกัด
* 🖥️ **Cross-platform:** ใช้ Apple Vision Framework บน macOS (Swift) และ WinRT OCR บน Windows

---

## 🚀 การติดตั้ง

### macOS
1. เปิด Terminal เข้ามาในโฟลเดอร์นี้:
   ```bash
   cd node_service
   ```
2. รันสคริปต์ติดตั้ง:
   ```bash
   chmod +x install_mac.sh
   ./install_mac.sh
   ```

### Windows
1. เปิด PowerShell (หรือคลิกขวาที่ไฟล์) แล้วรัน:
   ```powershell
   powershell -ExecutionPolicy Bypass -File install_win.ps1
   ```

---

## ⚙️ การตั้งค่า (`service_config.json`)

คัดลอกจากตัวอย่างแล้วแก้ไขข้อมูลบัญชีและโทเคน:
```bash
cp service_config.json.example service_config.json
```

| ฟิลด์ | คำอธิบาย |
|---|---|
| `youtube_url` | URL ช่อง YouTube ที่ต้องการสแกนสด |
| `telegram_token` | Bot Token จาก @BotFather |
| `telegram_chat_id` | Chat ID ที่ต้องการให้บอทส่งข้อความแจ้งเตือน |
| `telegram_enabled` | `true` / `false` |
| `discord_webhook_url` | Discord Webhook URL |
| `discord_enabled` | `true` / `false` |
| `scan_interval` | ความถี่ในการจับภาพสแกน (วินาที, default: `10`) |
| `username` | บัญชี HOF หลัก |
| `password` | รหัสผ่านบัญชี HOF หลัก |
| `game_id` | รหัสอ้างอิงเกมของ Talesrunner |

---

## 🎯 วิธีใช้งาน

```bash
node index.js
```
* โปรแกรมจะทำงานในรูปแบบ Background / Console-only
* บันทึกความเคลื่อนไหวลงในหน้าจอ Terminal และบันทึกล็อกเข้า `node_service.log`
