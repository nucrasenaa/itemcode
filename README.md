# ItemCode Watcher

ชุดโปรแกรมข้ามแพลตฟอร์มสำหรับตรวจจับ ItemCode จากแหล่งวิดีโอ/ไลฟ์ด้วย OCR,
ตรวจสอบ code ผ่าน upstream API และเลือกใช้ Browser flow สำหรับทำรายการต่อ
รองรับ macOS, Windows และ Linux

## โครงสร้างโปรเจกต์

- `node_service` — service แบบ headless สำหรับรันผ่าน command line
- `equality-itemcode-version` — service รุ่นแยกที่รองรับ Browser flow และการแจ้งเตือนแบบ optional
- `desktop-app` — Electron desktop UI สำหรับ macOS และ Windows

## เริ่มต้นใช้งาน

### Service แบบ command line

```bash
cd node_service
npm install
node index.js
```

### Service รุ่น equality

macOS / Linux:

```bash
bash equality-itemcode-version/install.sh
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\equality-itemcode-version\install.ps1
```

### Desktop app

```bash
cd desktop-app
npm install
npm start
```

## ตั้งค่า

สร้างไฟล์ config จากไฟล์ตัวอย่างภายใน service ที่ต้องการใช้ แล้วกรอกค่าที่จำเป็นในเครื่อง
ไฟล์ config, session, token, cookie, log และ profile เป็นข้อมูล runtime และต้องไม่ commit

```bash
cp node_service/service_config.json.example node_service/service_config.json
cp node_service/.session_config.json.example node_service/.session_config.json
```

## Build และ Release

Desktop app ใช้ Electron Builder และเผยแพร่ผ่าน GitHub Releases เมื่อ push tag รูปแบบ `v*`

```bash
cd desktop-app
npm run dist -- --mac
npm run dist -- --win
```

Workflow release อยู่ที่ `.github/workflows/release-desktop.yml`

## แนวทางด้านความปลอดภัย

- เก็บรหัสผ่าน, access token, webhook และ cookie ไว้นอก Git
- ใช้ไฟล์ `.example` เป็น template เท่านั้น
- ตรวจ `git diff` และ secret scanner ก่อน push
- หากพบ credential ที่เคยถูกใช้งานจริง ให้ rotate/revoke ทันที
