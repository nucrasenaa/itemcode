#!/usr/bin/env python3
import requests
import json
import os
import sys
import re
import random
import string
import base64
import hashlib
import secrets
import time
from urllib.parse import urlparse, parse_qs

# Configuration
PASSPORT_BASE_URL = "https://passport.thehof.gg"
MEMBER_DOMAIN = "member.thehof.gg"
API_BASE_URL = "https://core-api.thehof.gg"
DEFAULT_GAME_ID = "ece25107-ec4f-4c83-9f2b-38afd0e77cc2"
SESSION_FILE = ".session_config.json"

# Default Client ID and parameters from the network logs
CLIENT_ID = "bcb3b4ce-67ad-11f0-9fe2-0242ac120002"
REDIRECT_URI = "https://member.thehof.gg/oauth/callback"

def generate_code_variations(code: str, max_variations: int = 64) -> list:
    """Generate variations of the item code by replacing similar characters.
    Sorts variations by number of changes so the closest matches are tried first.
    """
    code = code.strip().upper()
    if not code:
        return []
        
    char_variations = {
        '1': ['1', 'I'],
        'I': ['I', '1'],
        '0': ['0', 'O', 'D'],
        'O': ['O', '0', 'D'],
        'D': ['D', '0', 'O'],
        '8': ['8', 'B'],
        'B': ['B', '8'],
        '5': ['5', 'S'],
        'S': ['S', '1S', 'IS', '5'],
        '2': ['2', 'Z'],
        'Z': ['Z', '2'],
        '6': ['6', 'G'],
        'G': ['G', '6'],
        '7': ['7', 'T'],
        'T': ['T', '7'],
        'U': ['U', 'V'],
        'V': ['V', 'U'],
        'A': ['A', '4'],
        '4': ['4', 'A']
    }
    
    # Limit to at most 6 variable positions to keep product size small (max 4^6 = 4096)
    variable_indices = [i for i, char in enumerate(code) if char in char_variations]
    allowed_indices = set(variable_indices[:6])
    
    # Build choices for each character, along with change cost (0 for original, 1 for variation)
    choices = []
    for idx, char in enumerate(code):
        if char in char_variations and idx in allowed_indices:
            options = [(char, 0)]
            for alt in char_variations[char]:
                if alt != char:
                    options.append((alt, 1))
            choices.append(options)
        else:
            choices.append([(char, 0)])
            
    # Generate all combinations using itertools.product
    import itertools
    all_combos = list(itertools.product(*choices))
    
    # Map each combo to (string, total_cost)
    scored_variations = []
    for combo in all_combos:
        s = "".join(item[0] for item in combo)
        cost = sum(item[1] for item in combo)
        scored_variations.append((s, cost))
        
    # Sort by cost (lower cost = fewer changes = tried first)
    scored_variations.sort(key=lambda x: x[1])
    
    # Extract unique strings preserving the sorted order
    seen = set()
    unique_variations = []
    for s, cost in scored_variations:
        if s not in seen:
            seen.add(s)
            unique_variations.append(s)
            if len(unique_variations) >= max_variations:
                break
                
    return unique_variations

def clear_log_files():
    """Clear all files ending with .log and reset ocr_history.json in the current directory"""
    try:
        # Clear ocr_history.json
        if os.path.exists("ocr_history.json"):
            try:
                with open("ocr_history.json", "w") as f:
                    f.write("[]")
                print("[+] เคลียร์ประวัติ ocr_history.json สำเร็จ")
            except Exception as e:
                print(f"[-] ไม่สามารถเคลียร์ ocr_history.json ได้: {e}")

        # Clear .log files
        for filename in os.listdir("."):
            if filename.endswith(".log") and filename != "notified_codes.log":
                try:
                    with open(filename, "w") as f:
                        f.truncate(0)
                    print(f"[+] เคลียร์ไฟล์ล็อก {filename} สำเร็จ")
                except Exception as e:
                    print(f"[-] ไม่สามารถเคลียร์ไฟล์ล็อก {filename} ได้: {e}")
    except Exception as e:
        print(f"[-] เกิดข้อผิดพลาดในการอ่านโฟลเดอร์เพื่อเคลียร์ล็อก: {e}")

class HofRedeemer:
    def __init__(self):
        clear_log_files()
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'th,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
        })
        self.access_token = None
        self.game_id = DEFAULT_GAME_ID
        self.username = ""
        self.password = ""
        self.current_logged_in_user = None
        self.load_session()

    def save_session(self):
        """Save access token, game_id, and credentials to local config file"""
        config = {
            "access_token": self.access_token,
            "game_id": self.game_id,
            "username": self.username,
            "password": self.password
        }
        try:
            with open(SESSION_FILE, 'w') as f:
                json.dump(config, f, indent=4)
            print(f"[+] บันทึก Session ลงใน {SESSION_FILE} เรียบร้อยแล้ว")
        except Exception as e:
            print(f"[-] ไม่สามารถบันทึก config ได้: {e}")

    def log_token_expiration(self, token: str):
        if not token:
            return
        try:
            parts = token.split('.')
            if len(parts) == 3:
                # Add padding if needed for base64 decoding
                payload_b64 = parts[1]
                padding = len(payload_b64) % 4
                if padding:
                    payload_b64 += '=' * (4 - padding)
                payload_str = base64.b64decode(payload_b64).decode('utf-8')
                payload = json.loads(payload_str)
                exp = payload.get("exp")
                if isinstance(exp, (int, float)):
                    exp_time = float(exp)
                    remaining_sec = exp_time - time.time()
                    remaining_mins = round(remaining_sec / 60)
                    from datetime import datetime
                    exp_dt = datetime.fromtimestamp(exp_time).strftime('%d/%m/%Y, %H:%M:%S')
                    if remaining_mins > 0:
                        print(f"[*] Token จะหมดอายุในอีก {remaining_mins} นาที ({exp_dt})")
                    else:
                        print(f"[!] Token หมดอายุแล้วเมื่อ {abs(remaining_mins)} นาทีที่แล้ว ({exp_dt})")
                    return
        except Exception as e:
            print(f"[-] ไม่สามารถตรวจสอบวันหมดอายุของ Token ได้: {e}")

    def load_session(self):
        """Load access token, game_id, and credentials from local config file"""
        if os.path.exists(SESSION_FILE):
            try:
                with open(SESSION_FILE, 'r') as f:
                    config = json.load(f)
                    self.access_token = config.get("access_token")
                    self.game_id = config.get("game_id", DEFAULT_GAME_ID)
                    self.username = config.get("username") or ""
                    self.password = config.get("password") or ""
                if self.access_token:
                    print(f"[+] โหลด Access Token จาก Session เก่าสำเร็จ: {self.access_token[:15]}...")
                    self.log_token_expiration(self.access_token)
            except Exception as e:
                print(f"[-] ไม่สามารถโหลด session config ได้: {e}")

    def set_bearer_token(self, token: str):
        """Directly set the bearer token"""
        token = token.replace("Bearer ", "").strip()
        self.access_token = token
        self.log_token_expiration(token)
        self.save_session()

    def login_with_credentials(self, username: str, password: str) -> bool:
        """Log in with Username/Password and perform token exchange"""
        print(f"[*] กำลังเริ่มต้นกระบวนการล็อกอินผ่าน OAuth PKCE สำหรับผู้ใช้: {username}...")
        self.username = username
        self.password = password
        try:
            # 1. Generate PKCE values
            code_verifier = secrets.token_urlsafe(64)
            sha256_hash = hashlib.sha256(code_verifier.encode('utf-8')).digest()
            code_challenge = base64.urlsafe_b64encode(sha256_hash).decode('utf-8').replace('=', '')
            state = secrets.token_urlsafe(16)

            # 2. Build authorize request to initiate OAuth session context on passport server
            auth_url = (
                f"{PASSPORT_BASE_URL}/oauth/authorize"
                f"?client_id={CLIENT_ID}"
                f"&redirect_uri={REDIRECT_URI}"
                f"&response_type=code"
                f"&scope="
                f"&state={state}"
                f"&code_challenge={code_challenge}"
                f"&code_challenge_method=S256"
            )

            print(f"[*] กำลังขอสิทธิ์เชื่อมต่อ OAuth Session จาก Server...")
            resp = self.session.get(auth_url)
            html = resp.text
            
            # 3. Extract CSRF token value of name="_token"
            csrf_token = None
            csrf_match = re.search(r'name=\"_token\"\s+value=\"([^\"]+)\"', html)
            if csrf_match:
                csrf_token = csrf_match.group(1)
                print(f"[*] ตรวจพบ CSRF Token ของระบบ")
            
            # Fallback search if standard pattern fails
            if not csrf_token:
                csrf_input_matches = re.findall(
                    r'<input[^>]*(?:name=["\']([^"\']*)["\'][^>]*value=["\']([^"\']*)["\']|name=["\']([^"\']*)["\'][^>]*value=["\']([^"\']*)["\'])/?>',
                    html, re.IGNORECASE
                )
                for match in csrf_input_matches[:10]:
                    token_val = match[0] if match[0] else match[2]
                    value_val = match[1] if match[0] else match[3]
                    if token_val and value_val and 'csrf' in token_val.lower():
                        csrf_token = value_val
                        print(f"[*] ตรวจพบ CSRF Token (Fallback)")
                        break

            # 4. Find form action
            form_match = re.search(r'<form[^>]*action=["\']([^"\']+)["\']', html, re.IGNORECASE)
            login_action = form_match.group(1) if form_match else f"{PASSPORT_BASE_URL}/hall-of-fame-web/login"
            
            # Build login payload
            login_data = {
                'username': username,
                'password': password,
            }
            if csrf_token:
                login_data['_token'] = csrf_token
            
            print("[*] กำลังส่งข้อมูลล็อกอิน...")
            resp_login = self.session.post(login_action, data=login_data, allow_redirects=True)
            
            final_url = resp_login.url
            print(f"[*] ล็อกอินเสร็จสิ้น. URL ปัจจุบัน: {final_url}")
            
            # 5. Extract authorization code from the redirected callback URL
            parsed_url = urlparse(final_url)
            query_params = parse_qs(parsed_url.query)
            code = query_params.get('code')
            
            if code:
                auth_code = code[0]
                print(f"[+] เข้าสู่ระบบสำเร็จ! ตรวจพบ Auth Code: {auth_code[:15]}...")
                ok = self.exchange_code_with_verifier(auth_code, code_verifier)
                if ok:
                    self.current_logged_in_user = username
                return ok
            else:
                print("[-] ล็อกอินไม่สำเร็จ หรือไม่พบ Auth Code ใน URL เปลี่ยนเส้นทาง")
                if "login" in final_url.lower():
                    print("    ↳ บัญชีผู้ใช้หรือรหัสผ่านอาจจะไม่ถูกต้อง")
                return False
                
        except Exception as e:
            print(f"[-] เกิดข้อผิดพลาดระหว่างล็อกอิน: {e}")
            return False

    def exchange_code_with_verifier(self, auth_code: str, code_verifier: str) -> bool:
        """Exchange authorization code with code_verifier for an Access Token"""
        token_url = f"{PASSPORT_BASE_URL}/oauth/token"
        
        # Prepare the multipart form-data request
        files = {
            'grant_type': (None, 'authorization_code'),
            'client_id': (None, CLIENT_ID),
            'redirect_uri': (None, REDIRECT_URI),
            'code_verifier': (None, code_verifier.strip()),
            'code': (None, auth_code.strip())
        }
        
        headers = {
            'Accept': '*/*',
            'Origin': f'https://{MEMBER_DOMAIN}',
        }

        try:
            print("[*] กำลังแลกเปลี่ยนรหัสเพื่อรับ Access Token...")
            response = self.session.post(token_url, files=files, headers=headers)
            
            if response.status_code == 200:
                res_data = response.json()
                self.access_token = res_data.get("access_token")
                if self.access_token:
                    print("[+] ได้รับ Access Token เรียบร้อย!")
                    self.log_token_expiration(self.access_token)
                    self.save_session()
                    return True
                else:
                    print("[-] การแลกเปลี่ยนสำเร็จแต่ไม่มี access_token ในระบบ")
            else:
                print(f"[-] ล้มเหลว (HTTP {response.status_code}): {response.text}")
        except Exception as e:
            print(f"[-] เกิดข้อผิดพลาดตอนแลก Token: {e}")
        return False

    def redeem_code(self, serial: str, username: str = None, password: str = None, rate_limit_callback=None) -> dict:
        """Submit the item code to the API with rate-limit retries (wait 1 minute)"""
        max_rate_limit_attempts = 3
        for rate_attempt in range(1, max_rate_limit_attempts + 1):
            res = self._redeem_code_inner(serial, username, password)
            
            # Check if it failed with the "please wait 1 minute" rate limit error
            is_rate_limited = False
            data = res.get("data", {})
            msg = ""
            if isinstance(data, dict):
                msg = data.get("message") or data.get("error") or ""
            if not msg and "message" in res:
                msg = res["message"]
                
            msg_str = str(msg).lower()
            if "please wait" in msg_str:
                is_rate_limited = True
                
            if is_rate_limited:
                if rate_attempt == 1 and rate_limit_callback:
                    try:
                        rate_limit_callback(res)
                    except Exception as callback_err:
                        print(f"[-] เกิดข้อผิดพลาดใน Callback แจ้งเตือน: {callback_err}")
                return res
            
            return res

    def _redeem_code_inner(self, serial: str, username: str = None, password: str = None) -> dict:
        """Submit the item code to the API using the 3-step sequence"""
        target_username = username or self.username or ""
        target_password = password or self.password or ""

        if not self.access_token or self.current_logged_in_user != target_username:
            print(f"[!] Token ปัจจุบันไม่ได้เป็นของ {target_username} หรือไม่มี Token, กำลังเข้าสู่ระบบใหม่...")
            if not self.login_with_credentials(target_username, target_password):
                return {"success": False, "check_success": False, "message": "กรุณาใส่ Access Token หรือเข้าสู่ระบบก่อน"}

        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'Authorization': f'Bearer {self.access_token}',
            'Origin': f'https://{MEMBER_DOMAIN}',
            'Referer': f'https://{MEMBER_DOMAIN}/talesrunner/itemcode'
        }

        # Step 1: GET orders/pending
        pending_url = f"{API_BASE_URL}/me/topup/games/{self.game_id}/orders/pending"
        try:
            self.session.get(pending_url, headers=headers)
        except Exception as e:
            print(f"[-] Step 1 (orders/pending) error: {e}")

        # Step 2: POST check-serial
        check_url = f"{API_BASE_URL}/me/games/{self.game_id}/itemcodes/check-serial"
        payload_check = {
            "serial": serial.strip().upper(),
            "game_id": self.game_id
        }
        
        try:
            response_check = self.session.post(check_url, json=payload_check, headers=headers)
            
            # Check for Unauthorized (HTTP 401) and try automatic re-authentication
            if response_check.status_code == 401:
                print("[!] พบสถานะ 401 (Unauthorized) จาก API. กำลังทำการเข้าสู่ระบบใหม่โดยอัตโนมัติ...")
                if self.login_with_credentials(target_username, target_password):
                    print("[+] ออโต้ล็อกอินสำเร็จ! กำลังทดลองส่งโค้ดใหม่อีกครั้ง...")
                    headers['Authorization'] = f'Bearer {self.access_token}'
                    # Retry Step 1
                    try:
                        self.session.get(pending_url, headers=headers)
                    except:
                        pass
                    # Retry Step 2
                    response_check = self.session.post(check_url, json=payload_check, headers=headers)
                else:
                    print("[-] พยายามออโต้ล็อกอินแต่ล้มเหลว")
                    return {"success": False, "check_success": False, "message": "Unauthorized"}
            
            if response_check.status_code not in [200, 201]:
                return {
                    "success": False,
                    "check_success": False,
                    "status_code": response_check.status_code,
                    "data": response_check.json() if response_check.text else {},
                    "message": "Check serial failed"
                }
        except Exception as e:
            return {"success": False, "check_success": False, "message": f"เกิดข้อผิดพลาดในการตรวจสอบโค้ด: {str(e)}"}

        # Step 3: POST redeem
        redeem_url = f"{API_BASE_URL}/me/games/{self.game_id}/itemcodes/redeem"
        payload_redeem = {
            "game_id": self.game_id,
            "serial": serial.strip().upper(),
            "captcha_type": "CF_TURNSTILE",
            "captcha_token": "" # Empty token for API/headless claim
        }
        
        try:
            response_redeem = self.session.post(redeem_url, json=payload_redeem, headers=headers)
            status_code = response_redeem.status_code
            data = response_redeem.json() if response_redeem.text else {}
            
            return {
                "success": status_code in [200, 201],
                "check_success": True,
                "check_data": response_check.json() if response_check.text else {},
                "status_code": status_code,
                "data": data
            }
        except Exception as e:
            return {
                "success": False,
                "check_success": True,
                "check_data": response_check.json() if response_check.text else {},
                "message": f"เกิดข้อผิดพลาดในการเคลมโค้ด: {str(e)}"
            }

    def logout(self):
        """Clear session token and stored credentials"""
        self.access_token = None
        self.current_logged_in_user = None
        self.username = ""
        self.password = ""
        self.save_session()

def check_and_clear_log_if_new_day():
    log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'notified_codes.log')
    if os.path.exists(log_path) and os.path.getsize(log_path) > 0:
        today_str = time.strftime("%Y-%m-%d")
        try:
            with open(log_path, 'r', encoding='utf-8') as f:
                first_line = f.readline()
            if first_line and first_line.startswith("["):
                end_bracket = first_line.find("]")
                if end_bracket != -1:
                    date_part = first_line[1:end_bracket].split()[0]
                    import datetime
                    now = datetime.datetime.now()
                    be_year = now.year + 543
                    be_date_str = f"{now.day}/{now.month}/{be_year}"
                    
                    if date_part != today_str and date_part != be_date_str:
                        with open(log_path, 'w', encoding='utf-8') as f:
                            f.truncate(0)
                        print("[+] เคลียร์ข้อมูลประวัติ notified_codes.log (ขึ้นวันใหม่)")
        except Exception as e:
            print(f"[-] ไม่สามารถตรวจสอบวันที่ในไฟล์ล็อกได้: {e}")

def check_prefix_and_handle_duplicate(code, history, save_history_callback, sleep_callback):
    """
    Check if code's first 5 characters match any entry in notified_codes.log.
    If so, add the code and all its variations to history, save history, sleep for 5 minutes, and return True.
    """
    log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'notified_codes.log')
    
    check_and_clear_log_if_new_day()
    
    if not os.path.exists(log_path):
        return False
        
    notified_list = []
    try:
        with open(log_path, 'r', encoding='utf-8') as f:
            for line in f:
                match = re.search(r'Code:\s*([A-Z0-9]+)', line, re.IGNORECASE)
                if match:
                    notified_list.append(match.group(1).upper())
    except Exception as e:
        print(f"[-] Error reading notified_codes.log: {e}")
        return False
        
    scanned_prefix = code[:5].upper()
    duplicate_found = False
    for notified_code in notified_list:
        if len(notified_code) >= 5 and notified_code[:5].upper() == scanned_prefix:
            duplicate_found = True
            break
            
    if duplicate_found:
        print(f"[!] ตรวจพบรหัส {scanned_prefix} ซ้ำกับประวัติการแจ้งเตือน (ข้ามการทำงานและหยุดสแกน 5 นาที)")
        variations = generate_code_variations(code)
        
        # Add to history
        history.add(code)
        for v in variations:
            history.add(v)
            
        try:
            save_history_callback(history)
        except TypeError:
            save_history_callback()
            
        sleep_callback(5)
        return True
        
    return False

def main():
    redeemer = HofRedeemer()
    
    while True:
        print("\n" + "="*50)
        print("    TalesRunner/Hof Item Code Redeemer Tool")
        print("="*50)
        if redeemer.access_token:
            print(f" สถานะ: เข้าสู่ระบบแล้ว (Token: {redeemer.access_token[:15]}...)")
        else:
            print(" สถานะ: ยังไม่ได้ระบุ Access Token / ยังไม่ได้ Login")
        print(f" Game ID ปัจจุบัน: {redeemer.game_id}")
        print("="*50)
        print("1. เข้าสู่ระบบด้วย Username & Password")
        print("2. ใส่ Bearer Token โดยตรง (ได้จาก Header: Authorization)")
        print("3. แลก Access Token ด้วย OAuth Callback URL / Code")
        print("4. ตั้งค่า Game ID ใหม่ (ปัจจุบันสำหรับ Talesrunner)")
        print("5. ส่ง Item Code (เดี่ยว)")
        print("6. ส่ง Item Code (หลายรายการ / ทีละบรรทัด หรือคั่นด้วยจุลภาค)")
        print("7. ออกจากโปรแกรม")
        print("-"*50)
        
        choice = input("กรุณาเลือกเมนู (1-7): ").strip()
        
        if choice == '1':
            username = input("Username: ").strip()
            password = input("Password: ").strip()
            if username and password:
                success = redeemer.login_with_credentials(username, password)
                if success:
                    print("[+] เข้าสู่ระบบและอัปเดต Token สำเร็จ!")
                else:
                    print("[-] เข้าสู่ระบบล้มเหลว")
            else:
                print("[-] กรุณากรอกทั้ง Username และ Password")

        elif choice == '2':
            token = input("วาง Bearer Token ที่นี่: ").strip()
            if token:
                redeemer.set_bearer_token(token)
                print("[+] อัปเดต Bearer Token เรียบร้อย!")
            else:
                print("[-] Token ว่างเปล่า")
                
        elif choice == '3':
            print("\n--- วิธีรับ OAuth Callback URL และ Code Verifier ---")
            print("1. เปิด Browser Network Tab (F12) ก่อนเข้าหน้า Callback หรือกด Login")
            print("2. คัดลอก URL ของหน้า callback (เช่น https://member.thehof.gg/oauth/callback?code=...)")
            print("3. คัดลอกค่า `code_verifier` จาก Payload ของ request 'oauth/token'")
            print("-" * 50)
            callback_url = input("วาง Callback URL หรือ Code ที่นี่: ").strip()
            code_verifier = input("วาง code_verifier ที่นี่: ").strip()
            
            if callback_url and code_verifier:
                success = redeemer.exchange_code_with_verifier(callback_url, code_verifier)
                if success:
                    print("[+] ยืนยันตัวตนสำเร็จ! พร้อมส่งไอเทมโค้ด")
                else:
                    print("[-] ยืนยันตัวตนล้มเหลว")
            else:
                print("[-] กรุณากรอกข้อมูลให้ครบถ้วน")
                
        elif choice == '4':
            new_id = input(f"ระบุ Game ID ใหม่ (กด Enter เพื่อใช้ค่าเดิม {DEFAULT_GAME_ID}): ").strip()
            if new_id:
                redeemer.game_id = new_id
                redeemer.save_session()
                print(f"[+] อัปเดต Game ID เป็น: {redeemer.game_id}")
            else:
                redeemer.game_id = DEFAULT_GAME_ID
                redeemer.save_session()
                print(f"[+] ใช้ Game ID เริ่มต้น: {redeemer.game_id}")
                
        elif choice == '5':
            if not redeemer.access_token:
                print("[-] กรุณาตั้งค่า Access Token ก่อนในเมนูข้อ 1, 2 หรือ 3")
                continue
            serial = input("กรอก Item Code: ").strip()
            if serial:
                print(f"[*] กำลังส่ง Item Code: {serial}...")
                res = redeemer.redeem_code(serial)
                if res.get("success"):
                    print(f"[+] สำเร็จ! (HTTP {res.get('status_code')})")
                    print(json.dumps(res.get("data"), indent=4, ensure_ascii=False))
                else:
                    print(f"[-] ล้มเหลว! (HTTP {res.get('status_code') if 'status_code' in res else 'Error'})")
                    print(json.dumps(res.get("data") or res.get("message"), indent=4, ensure_ascii=False))
            else:
                print("[-] รหัสไอเทมโค้ดว่างเปล่า")
                
        elif choice == '6':
            if not redeemer.access_token:
                print("[-] กรุณาตั้งค่า Access Token ก่อนในเมนูข้อ 1, 2 หรือ 3")
                continue
            print("ป้อน Item Codes (สามารถคั่นด้วยเครื่องหมายจุลภาค ',' หรือกด Enter ทีละโค้ด เมื่อเสร็จแล้วให้พิมพ์ 'done' หรือเว้นว่างแล้วกด Enter):")
            raw_codes = []
            while True:
                line = input("> ").strip()
                if not line or line.lower() == 'done':
                    break
                for part in line.split(','):
                    part_cleaned = part.strip()
                    if part_cleaned:
                        raw_codes.append(part_cleaned)
            
            if not raw_codes:
                print("[-] ไม่มี Item Code ที่ต้องการส่ง")
                continue
                
            print(f"[*] ตรวจพบรหัสทั้งหมด {len(raw_codes)} รายการ")
            confirm = input("เริ่มทำรายการส่งโค้ดทั้งหมดใช่หรือไม่ (y/n): ").strip().lower()
            if confirm == 'y':
                success_count = 0
                fail_count = 0
                for idx, code in enumerate(raw_codes, 1):
                    print(f"[{idx}/{len(raw_codes)}] ส่ง {code} ... ", end="", flush=True)
                    res = redeemer.redeem_code(code)
                    if res.get("success"):
                        print("สำเร็จ [OK]")
                        success_count += 1
                    else:
                        print("ล้มเหลว [FAIL]")
                        data = res.get("data", {})
                        msg = data.get("message") or data.get("error") or "Unknown error"
                        print(f"    ↳ เหตุผล: {msg}")
                        fail_count += 1
                print(f"\n[+] ส่งโค้ดเสร็จสิ้น: สำเร็จ {success_count} รายการ, ล้มเหลว {fail_count} รายการ")
                
        elif choice == '7':
            print("ขอบคุณที่ใช้บริการ! สวัสดีครับ")
            break
        else:
            print("[-] ตัวเลือกไม่ถูกต้อง กรุณาเลือก 1-7")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[-] ออกจากโปรแกรมเนื่องจากปุ่ม Ctrl+C")
        sys.exit(0)
