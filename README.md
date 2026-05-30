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
* **ลิงก์หน้าคู่มือและตัวติดตั้ง:** ดูรายละเอียดได้ที่ [web_app/README.md](file:///Users/crase/OS/itemcode/web_app/README.md)

---

## ⚙️ ข้อกำหนดหลัก (Requirements)
* **macOS:** รองรับ macOS 12+ (ใช้ Apple Vision Framework สำหรับ OCR)
* **Windows:** รองรับ Windows 10/11 (ใช้ WinRT OCR)
* จำเป็นต้องมี `yt-dlp` และ `FFmpeg` ติดตั้งในเครื่อง (มีมาให้ในตัวช่วยติดตั้งภายในแต่ละโฟลเดอร์)
