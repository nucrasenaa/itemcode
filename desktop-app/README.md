# Equality ItemCode Watcher Desktop

แอป Electron สำหรับ Windows และ macOS โดยใช้ `equality-itemcode-version` เป็น worker เบื้องหลัง

## เริ่มใช้งานในโหมดพัฒนา

```bash
cd desktop-app
npm install
npm start
```

เมื่อเปิดครั้งแรก แอปจะตรวจสอบ Node.js, yt-dlp, FFmpeg, OCR และ Playwright Chromium
ถ้ารายการใดยังไม่พร้อม ให้กด `Download` ที่รายการนั้น แล้วกด `ตรวจสอบอีกครั้ง`

## สร้างไฟล์ติดตั้ง

```bash
npm run dist -- --mac
npm run dist -- --win
```

หน้าจอหลักมีช่องกรอกบัญชี 4 ช่อง ปุ่ม `Start/Stop` และ log ที่แสดงเฉพาะ ItemCode,
รายละเอียด, สถานะรับไอเทม และ retry แต่ละรอบ
