# gen_service

สร้าง candidate จาก pattern ใน `../codes_only.txt` แล้วส่ง `check-serial` ตามโครงสร้างของ `node_service` โดยบันทึกเฉพาะ code ที่ใช้ได้ลง `itemcode.json`

เกณฑ์ผลลัพธ์อิงจาก `node_service`: `checkSuccess` คือ HTTP 200/201 จาก `check-serial`; ข้อความ `please wait`, `captcha token field is required` และ `captcha type is present` ถูกจัดเป็น wait/rate-limit; ข้อความ `invalid itemcode` ถูกกรองออก

## ใช้งาน

```bash
cd /Users/crase/OS/itemcode/gen_service
node index.js --set-token TOKEN
```

ตัวเลือกที่ใช้บ่อย:

```bash
# จำกัดจำนวน 100 รอบ
node index.js --set-token TOKEN --count 100

# เลือก pattern เดียว
node index.js --set-token TOKEN --pattern two --count 100

# ดู pattern โดยไม่เรียก API
node index.js --dry-run --pattern all --count 20

# เปิดตาราง HTML ผ่าน local server
python3 -m http.server 8787
```

ไฟล์ผลลัพธ์:

- `itemcode.json`: `[ { "code": "...", "detail": "..." } ]`
- `log.json`: เก็บทุก code ที่ gen แล้ว พร้อมสถานะ เพื่อไม่ให้ gen ซ้ำ
- `index.html`: ตารางอ่านข้อมูลจาก `itemcode.json` และ refresh ทุก 5 วินาที
- `.session_config.json`: token ที่ตั้งผ่าน `--set-token` (ไม่ควรนำไป commit)

ระบบไม่เรียก redeem endpoint; ตรวจด้วย `check-serial` เท่านั้น และหยุดเมื่อ token ได้ HTTP 401
