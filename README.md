# 🎮 TalesRunner ItemCode Watcher

โปรแกรมสแกนภาพสตรีมเพื่อตรวจจับรหัสไอเทมโค้ด (Item Code) โดยอัตโนมัติบน YouTube Live ของ HOF

---

## 🗂️ โครงสร้างระบบแยกส่วน (Decoupled Structure)

เพื่อความง่ายในการเลือกใช้งานและพัฒนา โปรแกรมนี้ถูกแยกออกเป็น 2 ส่วนย่อย:

### 1. [node_service (Headless Service)](file:///Users/crase/OS/itemcode/node_service/README.md)
* **ภาษาหลัก:** Node.js
* **รูปแบบการใช้งาน:** รันผ่าน Console เบื้องหลัง (ไม่มีหน้าเว็บ GUI)
* **จุดเด่น:** รวดเร็วมาก กินทรัพยากรระบบและหน่วยความจำต่ำมาก เหมาะสำหรับการเปิดบอททิ้งไว้แบบ 24/7
* **ลิงก์หน้าคู่มือและตัวติดตั้ง:** ดูรายละเอียดได้ที่ [node_service/README.md](file:///Users/crase/OS/itemcode/node_service/README.md)

### 2. [web_app (Web UI Dashboard)](file:///Users/crase/OS/itemcode/web_app/README.md)
* **ภาษาหลัก:** Python (Flask)
* **รูปแบบการใช้งาน:** ควบคุมผ่านหน้าเว็บ Dashboard (`http://localhost:5000`)
* **จุดเด่น:** แสดงสตรีมสด แสดงบันทึกเหตุการณ์ (Logs) ประวัติโค้ดที่เคยพบ และของรางวัลบน Dashboard แบบ Real-time พร้อมสั่งเปิด/ปิดบอทจากหน้าเว็บได้สะดวก

### 3. [gen_service](file:///Users/crase/OS/itemcode/gen_service/README.md)
* **ภาษาหลัก:** Node.js
* **รูปแบบการใช้งาน:** สุ่ม code ตาม pattern, ตรวจด้วย `check-serial`, บันทึก code ที่ใช้ได้ และกันการสุ่มซ้ำด้วย `log.json`
* **ลิงก์หน้าคู่มือและตัวติดตั้ง:** ดูรายละเอียดได้ที่ [web_app/README.md](file:///Users/crase/OS/itemcode/web_app/README.md)

### 4. [equality-itemcode-version](file:///Users/crase/OS/itemcode/equality-itemcode-version/README.md)
รุ่นแยกของ Node.js Service ที่ตัด Discord ออก เหลือ Telegram แบบ optional
และใช้ Browser flow อัตโนมัติสำหรับ login, Turnstile และการใช้ itemcode:

```bash
bash equality-itemcode-version/install.sh
```

---

## ⚙️ ข้อกำหนดหลัก (Requirements)
* **macOS:** รองรับ macOS 12+ (ใช้ Apple Vision Framework สำหรับ OCR)
* **Windows:** รองรับ Windows 10/11 (ใช้ WinRT OCR)
* จำเป็นต้องมี `yt-dlp` และ `FFmpeg` ติดตั้งในเครื่อง (มีมาให้ในตัวช่วยติดตั้งภายในแต่ละโฟลเดอร์)

## 🖥️ Desktop Application สำหรับ Windows / macOS

มีหน้าจอ Electron สำหรับตรวจสอบ requirement, กรอกบัญชี 4 ช่อง และควบคุม service เดิม:

```bash
cd desktop-app
npm install
npm start
```

เมื่อเปิดครั้งแรกให้กด `Download` ในรายการที่ยังไม่พร้อม แล้วกด `ตรวจสอบอีกครั้ง` จากนั้นกรอก
username/password สำหรับ Check Serial และ username/password สำหรับรับ ItemCode แล้วกด `Start`

หน้าจอ log จะแสดงเฉพาะ ItemCode, รายละเอียด, สถานะรับไอเทม และ retry แต่ละรอบ

## 🎲 เครื่องมือสุ่มตามรูปแบบโค้ด

`pattern_generator.py` สร้าง candidate แบบออฟไลน์จากรูปแบบใน `codes_only.txt`
โดยไม่เชื่อมต่อ API และไม่ตรวจสอบหรือแลกโค้ด:

```bash
# ดูจำนวน template ที่พบ
python3 pattern_generator.py --show-patterns

# สุ่มรวมทุก pattern
python3 pattern_generator.py --count 100 --seed 20260814

# เลือก pattern: letters, one, two, three หรือ multi
python3 pattern_generator.py --pattern two --count 1000 --output candidates.txt
```
