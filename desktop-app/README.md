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

หน้าจอหลักมีบัญชี Check Serial และรายการบัญชีรับ ItemCode ที่เพิ่มได้หลายรายการ
ระบบจะรับ ItemCode ตามลำดับบัญชีที่เพิ่มไว้ แล้ววนกลับรายการแรกเมื่อถึงรายการสุดท้าย
สามารถลากจุดจับเพื่อเรียงลำดับบัญชีได้ และสถานะย่อของ Requirement/ข้อมูลบัญชีจะถูกจำไว้
เมื่อ Requirement ครบ ระบบจะย่อส่วน Requirement ให้อัตโนมัติเมื่อเปิดแอปครั้งถัดไป
พร้อม Discord Webhook หลายรายการที่เปิด/ปิดได้, ปุ่มทดสอบการแจ้งเตือน,
ปุ่ม `Start/Stop` ด้านบน, ปุ่มตรวจสอบ Update ข้างสถานะการทำงาน,
Changelog ภาษาไทย และ log ที่กรองได้ทุกสถานะ

## Auto update ผ่าน GitHub Releases

โปรเจกต์ตั้งค่า `electron-updater` ให้ใช้ public repository
`nucrasenaa/itemcode` แล้ว การปล่อยเวอร์ชันให้เพิ่ม version ใน
`package.json` เช่น `0.2.0` และสร้าง tag ให้ตรงกัน เช่น `v0.2.0` จากนั้น GitHub Actions
จะ build และ publish artifacts ของ macOS/Windows ไปยัง GitHub Release

```bash
git tag v0.2.0
git push origin v0.2.0
```

แอปจะตรวจสอบ Update อัตโนมัติหลังเปิดประมาณ 3 วินาที และมีปุ่มตรวจสอบเอง
เมื่อดาวน์โหลดเสร็จจะกด `ติดตั้งและเปิดใหม่` ได้ โดยจะหยุด service ก่อนติดตั้ง

macOS DMG แบบไม่ code sign ยังแจกและติดตั้งด้วยการกด Trust ได้ แต่ auto-update
ของ macOS ต้องใช้ signed app จึงจะทำงานได้สมบูรณ์
