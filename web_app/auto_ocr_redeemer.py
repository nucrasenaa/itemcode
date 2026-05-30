#!/usr/bin/env python3
import os
import sys
import re
import time
import subprocess
import json
from redeem_tool import HofRedeemer, generate_code_variations

# Configuration
HISTORY_FILE = "ocr_history.json"
DEFAULT_REGEX = r"\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{8,24}\b"  # Alphanumeric, contains at least 1 letter and 1 number
TEMP_IMAGE = "ocr_scan.png"
SWIFT_SOURCE = "ocr_helper.swift"
SWIFT_BINARY = "./ocr_helper"

class AutoOcrRedeemer:
    def __init__(self):
        self.redeemer = HofRedeemer()
        self.regex_pattern = DEFAULT_REGEX
        self.history = self.load_history()
        self.check_and_compile_helper()

    def load_history(self):
        """Load history of redeemed codes to avoid duplicates"""
        if os.path.exists(HISTORY_FILE):
            try:
                with open(HISTORY_FILE, "r") as f:
                    return set(json.load(f))
            except Exception as e:
                print(f"[-] ไม่สามารถโหลดประวัติการเคลมได้: {e}")
        return set()

    def save_history(self):
        """Save history of redeemed codes"""
        try:
            with open(HISTORY_FILE, "w") as f:
                json.dump(list(self.history), f, indent=4)
        except Exception as e:
            print(f"[-] ไม่สามารถบันทึกประวัติการเคลมได้: {e}")

    def check_and_compile_helper(self):
        """Ensure the swift OCR helper is compiled and ready"""
        if not os.path.exists(SWIFT_BINARY):
            print("[*] ไม่พบตัวแปลภาษา OCR Helper กำลังทำการ Compile Swift...")
            if not os.path.exists(SWIFT_SOURCE):
                print(f"[-] ไม่พบไฟล์ซอร์สโค้ด {SWIFT_SOURCE}")
                sys.exit(1)
            try:
                res = subprocess.run(["swiftc", SWIFT_SOURCE, "-o", "ocr_helper"], capture_output=True, text=True)
                if res.returncode == 0 and os.path.exists(SWIFT_BINARY):
                    print("[+] Compile OCR Helper สำเร็จ!")
                else:
                    print(f"[-] Compile ล้มเหลว:\n{res.stderr}")
                    sys.exit(1)
            except Exception as e:
                print(f"[-] เกิดข้อผิดพลาดระหว่าง Compile: {e}")
                sys.exit(1)

    def run_ocr(self, image_path):
        """Run ocr_helper on the given image path and return list of lines"""
        if not os.path.exists(image_path):
            return []
        try:
            res = subprocess.run([SWIFT_BINARY, image_path], capture_output=True, text=True)
            if res.returncode == 0:
                # Split lines and filter empty ones
                return [line.strip() for line in res.stdout.split("\n") if line.strip()]
            else:
                print(f"[-] OCR Helper Error: {res.stderr}")
        except Exception as e:
            print(f"[-] เกิดข้อผิดพลาดขณะรัน OCR: {e}")
        return []

    def extract_codes(self, text_lines):
        """Extract item codes from text lines using Regex, filtering out usernames"""
        codes = []
        compiled_regex = re.compile(self.regex_pattern)
        
        for line in text_lines:
            target_text = line
            # Heuristic 1: If a line contains ':', split by the first colon to isolate the chat message / value
            # This filters out usernames in chat like "User123: COS20269XTR" -> scans only " COS20269XTR"
            if ":" in line:
                parts = line.split(":", 1)
                before_colon = parts[0].strip()
                # If before colon is a label like CODE 1 or just numbers, keep the whole line or scan after.
                # If it's likely a username (does not start with "code" and is not a number), scan only the part after the colon.
                if not before_colon.lower().startswith("code") and not before_colon.isdigit():
                    target_text = parts[1]
            
            # Heuristic 2: Remove words starting with @ (common in chat tagging)
            target_text = re.sub(r'@\w+', '', target_text)

            matches = compiled_regex.findall(target_text.upper())
            for match in matches:
                cleaned = match.replace(" ", "").replace(".", "").strip()
                if cleaned and cleaned not in codes:
                    codes.append(cleaned)
        return codes
    def capture_screen(self, region=None):
        """Capture the screen. Region format: (x, y, w, h)"""
        # Remove old temp file
        if os.path.exists(TEMP_IMAGE):
            try:
                os.remove(TEMP_IMAGE)
            except:
                pass

        try:
            if region:
                x, y, w, h = region
                subprocess.run(["screencapture", "-x", "-R", f"{x},{y},{w},{h}", TEMP_IMAGE], check=True)
            else:
                subprocess.run(["screencapture", "-x", TEMP_IMAGE], check=True)
            return os.path.exists(TEMP_IMAGE)
        except Exception as e:
            print(f"[-] ไม่สามารถจับภาพหน้าจอได้: {e}")
            return False

    def redeem_detected_codes(self, codes):
        """Attempt to redeem list of codes"""
        for code in codes:
            if code in self.history:
                continue
            
            from redeem_tool import check_prefix_and_handle_duplicate
            if check_prefix_and_handle_duplicate(
                code, 
                self.history, 
                lambda h: self.save_history(), 
                lambda m: time.sleep(m * 60)
            ):
                break
            
            variations = generate_code_variations(code)
            print(f"\n[!] ตรวจพบโค้ดใหม่บนจอภาพ: {code}")
            print(f"[*] สร้างโค้ดใกล้เคียงเพื่อทดสอบ: {', '.join(variations)}")
            
            success = False
            for var in variations:
                if var in self.history:
                    continue
                
                print(f"[*] กำลังส่งโค้ดเคลมของรางวัล: {var}...")
                res = self.redeemer.redeem_code(var)
                self.history.add(var)
                self.save_history()

                if res.get("success"):
                    print(f"[+] สำเร็จ! โค้ด: {var} (HTTP {res.get('status_code')})")
                    print(json.dumps(res.get("data"), indent=4, ensure_ascii=False))
                    success = True
                    break
                else:
                    print(f"[-] ล้มเหลว! โค้ด: {var} (HTTP {res.get('status_code', 'Error')})")
                    data = res.get("data", {})
                    msg = data.get("message") or data.get("error") or res.get("message") or "Unknown error"
                    print(f"    ↳ เหตุผล: {msg}")
            
            if not success:
                # Also add the original code to history if none succeeded to prevent reprocessing
                self.history.add(code)
                self.save_history()

    def monitor_loop(self, interval=1.5, region=None):
        """Main loop for screen monitoring"""
        print("\n" + "="*50)
        print("          เริ่มการทำงานระบบตรวจจับหน้าจออัตโนมัติ")
        print("="*50)
        if region:
            print(f" โหมด: ตรวจจับเฉพาะพื้นที่ X:{region[0]} Y:{region[1]} W:{region[2]} H:{region[3]}")
        else:
            print(" โหมด: ตรวจจับทั้งหน้าจอหลัก (Fullscreen)")
        print(f" ความถี่ในการสแกน: ทุก ๆ {interval} วินาที")
        print(f" รูปแบบ Regex ปัจจุบัน: {self.regex_pattern}")
        print(" กด Ctrl+C เพื่อหยุดการสแกน")
        print("="*50 + "\n")

        try:
            while True:
                if self.capture_screen(region):
                    lines = self.run_ocr(TEMP_IMAGE)
                    codes = self.extract_codes(lines)
                    if codes:
                        self.redeem_detected_codes(codes)
                time.sleep(interval)
        except KeyboardInterrupt:
            print("\n[-] หยุดการตรวจจับหน้าจอเรียบร้อยแล้ว")
        finally:
            # Clean up temp file
            if os.path.exists(TEMP_IMAGE):
                try:
                    os.remove(TEMP_IMAGE)
                except:
                    pass

def main():
    app = AutoOcrRedeemer()
    
    while True:
        print("\n" + "="*50)
        print("    TalesRunner/Hof Livestream OCR Auto Redeemer")
        print("="*50)
        if app.redeemer.access_token:
            print(f" สถานะ: เข้าสู่ระบบแล้ว (Token: {app.redeemer.access_token[:15]}...)")
        else:
            print(" สถานะ: ยังไม่ได้ Login (กรุณาไปล็อกอินผ่าน redeem_tool.py หรือเลือกเมนูเข้าสู่ระบบ)")
        print(f" Game ID ปัจจุบัน: {app.redeemer.game_id}")
        print(f" Regex ปัจจุบัน: {app.regex_pattern}")
        print(f" โค้ดที่เคลมไปแล้ว: {len(app.history)} รายการ")
        print("="*50)
        print("1. ล็อกอินเข้าสู่ระบบ (Username & Password)")
        print("2. ใส่ Bearer Token โดยตรง")
        print("3. ตรวจจับหน้าจออัตโนมัติ (Fullscreen)")
        print("4. ตรวจจับหน้าจออัตโนมัติ (กำหนดพิกัดเฉพาะส่วน)")
        print("5. ทดสอบอ่านตัวหนังสือจากไฟล์รูปภาพในเครื่อง (Test OCR)")
        print("6. ตั้งค่า Regex Pattern ใหม่")
        print("7. เคลียร์ประวัติโค้ดที่เคยเคลมแล้วในเครื่อง")
        print("8. ออกจากโปรแกรม")
        print("-"*50)
        
        choice = input("กรุณาเลือกเมนู (1-8): ").strip()
        
        if choice == '1':
            username = input("Username: ").strip()
            password = input("Password: ").strip()
            if username and password:
                success = app.redeemer.login_with_credentials(username, password)
                if success:
                    print("[+] เข้าสู่ระบบสำเร็จ!")
                else:
                    print("[-] เข้าสู่ระบบล้มเหลว")
            else:
                print("[-] กรุณากรอกข้อมูลให้ครบถ้วน")
                
        elif choice == '2':
            token = input("วาง Bearer Token ที่นี่: ").strip()
            if token:
                app.redeemer.set_bearer_token(token)
                print("[+] อัปเดต Bearer Token เรียบร้อย!")
            else:
                print("[-] Token ว่างเปล่า")
                
        elif choice == '3':
            if not app.redeemer.access_token:
                print("[-] กรุณาเข้าสู่ระบบก่อนรันระบบตรวจจับหน้าจอ")
                continue
            app.monitor_loop(interval=1.5, region=None)
            
        elif choice == '4':
            if not app.redeemer.access_token:
                print("[-] กรุณาเข้าสู่ระบบก่อนรันระบบตรวจจับหน้าจอ")
                continue
            try:
                print("\n--- กำหนดพื้นที่การตรวจจับหน้าจอ ---")
                print("คำแนะนำ: สามารถคำนวณพิกัดจากการกด Command+Shift+4 บน Mac เพื่อดูค่าพิกัดพิกเซลได้")
                x = int(input("ระบุพิกัดแกน X (พิกเซลเริ่มต้นจากฝั่งซ้าย): ").strip())
                y = int(input("ระบุพิกัดแกน Y (พิกเซลเริ่มต้นจากฝั่งบน): ").strip())
                w = int(input("ระบุความกว้าง Width (พิกเซล): ").strip())
                h = int(input("ระบุความสูง Height (พิกเซล): ").strip())
                
                app.monitor_loop(interval=1.5, region=(x, y, w, h))
            except ValueError:
                print("[-] พิกัดไม่ถูกต้อง กรุณากรอกเป็นตัวเลขจำนวนเต็มเท่านั้น")
                
        elif choice == '5':
            path = input("ระบุที่อยู่ไฟล์รูปภาพ (เช่น /path/to/screenshot.png): ").strip()
            if not path or not os.path.exists(path):
                print("[-] ไม่พบไฟล์รูปภาพดังกล่าว")
                continue
            print(f"[*] กำลังวิเคราะห์รูปภาพด้วย OCR Helper...")
            lines = app.run_ocr(path)
            print("\n--- ตัวหนังสือทั้งหมดที่ตรวจพบ ---")
            for idx, line in enumerate(lines, 1):
                print(f"{idx}: {line}")
            
            print("\n--- ผลการกรองโค้ดด้วย Regex ปัจจุบัน ---")
            codes = app.extract_codes(lines)
            if codes:
                for code in codes:
                    print(f"[+] พบโค้ด: {code}")
            else:
                print("[-] ไม่พบคำที่ตรงกับแพทเทิร์นของไอเทมโค้ด")
                
        elif choice == '6':
            print(f"\nRegex ปัจจุบัน: {app.regex_pattern}")
            print("ตัวอย่างแพทเทิร์นทั่วไป:")
            print("1. [A-Z0-9-]{8,24} (ตัวอักษรตัวใหญ่/ตัวเลข/ขีด ความยาว 8-24 ตัว)")
            print("2. TR-[A-Z0-9]{8,12} (ต้องขึ้นต้นด้วย TR-)")
            new_pattern = input("ระบุ Regex Pattern ใหม่ (กด Enter หากไม่ต้องการเปลี่ยน): ").strip()
            if new_pattern:
                try:
                    re.compile(new_pattern)
                    app.regex_pattern = new_pattern
                    print("[+] อัปเดต Regex Pattern สำเร็จ!")
                except re.error as e:
                    print(f"[-] รูปแบบ Regex ไม่ถูกต้อง: {e}")
                    
        elif choice == '7':
            confirm = input("คุณแน่ใจหรือไม่ที่จะล้างประวัติการเคลมโค้ดทั้งหมดในเครื่อง (y/n): ").strip().lower()
            if confirm == 'y':
                app.history = set()
                app.save_history()
                print("[+] เคลียร์ประวัติเรียบร้อยแล้ว (จะสแกนเคลมโค้ดเดิมซ้ำได้อีกครั้ง)")
                
        elif choice == '8':
            print("ขอบคุณที่ใช้งานระบบตรวจจับหน้าจอตอบรับรางวัลอัตโนมัติ สวัสดีครับ")
            break
        else:
            print("[-] เมนูไม่ถูกต้อง กรุณาเลือก 1-8")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[-] ออกจากโปรแกรมเนื่องจากปุ่ม Ctrl+C")
        sys.exit(0)
