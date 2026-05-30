# 🌐 TalesRunner ItemCode Watcher — Web UI Dashboard

ระบบหน้าเว็บควบคุม (Web Dashboard) สำหรับจัดการสแกนโค้ดไอเทมจากไลฟ์สตรีม YouTube HOF  
แสดงล็อกและของรางวัลแบบ Real-time พร้อมฟังก์ชันควบคุมความถี่และการแจ้งเตือน

---

## ✨ ฟีเจอร์หลัก
* 🖥️ **Web Dashboard:** หน้าควบคุมเปิดปิดการสแกนผ่านบราวเซอร์ ดูวิดีโอสด และแสดงสถานะแบบ Real-time
* 📺 **OCR สแกนไลฟ์สตรีม:** ดึงภาพและอ่านตัวหนังสือบนจอด้วย AI-OCR
* 🔑 **ตรวจสอบโค้ดอัตโนมัติ (Check Serial):** ดึงข้อมูลของรางวัล (ถุง/กล่องไอเทม) ออกมาแสดงทันที
* 📲 **ส่งพุชแจ้งเตือน:** แจ้งเตือนเข้า Telegram/Discord ทันทีที่พบโค้ด (ช่วยให้คัดลอกโค้ดไปเคลมเองได้ทันที)
* 🖥️ **Cross-platform:** ใช้ Apple Vision Framework บน macOS (Swift) และ WinRT OCR บน Windows

---

## 🚀 การติดตั้ง

### macOS
1. เปิด Terminal เข้ามาในโฟลเดอร์นี้:
   ```bash
   cd web_app
   ```
2. รันสคริปต์ติดตั้งเพื่อตั้งค่า Virtual Environment และ Playwright:
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

## ⚙️ การตั้งค่า

### 1. `service_config.json` (ตั้งค่าบัญชี HOF)
คัดลอกจากตัวอย่างแล้วใส่ชื่อผู้ใช้และรหัสผ่าน:
```bash
cp service_config.json.example service_config.json
```
* `username`: ชื่อบัญชีหลัก HOF
* `password`: รหัสผ่านหลัก HOF

### 2. `web_config.json` (ตั้งค่าเว็บบอร์ดและการแจ้งเตือน)
คัดลอกจากตัวอย่างและใส่ข้อมูลบอทแจ้งเตือน:
```bash
cp web_config.json.example web_config.json
```
* `telegram_token`: บอทโทเคน
* `telegram_chat_id`: Chat ID ผู้รับข้อความ
* `discord_webhook_url`: เว็บบุ๊ค Discord

---

## 🎯 วิธีใช้งาน

1. เปิดใช้งานระบบผ่าน Virtual Environment:
   * **macOS:** `./venv/bin/python web_app.py`
   * **Windows:** `.\venv\Scripts\python web_app.py`
2. เปิดบราวเซอร์ไปที่: `http://localhost:5000`
3. ใส่ลิงก์สตรีมของ YouTube กดปุ่ม **Start Scanning** เพื่อเริ่มต้นระบบตรวจจับ
