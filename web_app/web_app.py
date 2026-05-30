#!/usr/bin/env python3
import os
import sys
import time
import subprocess
import json
import threading
import requests
import re
from flask import Flask, render_template, jsonify, request

app = Flask(__name__)

# Configuration files
CONFIG_FILE = "web_config.json"
HISTORY_FILE = "ocr_history.json"
TEMP_VIDEO = "web_scan.mp4"
TEMP_FRAME = "web_frame.png"
SWIFT_BINARY = "./ocr_helper"

# Global application state
app_state = {
    "scanning": False,
    "current_url": "",
    "logs": [],
    "redeemed_count": 0,
    "last_ocr_results": [],
    "error_message": "",
    "current_time": 0.0,
    "is_live": False,
    "ocr_sleep_until": 0.0,
    "last_periodic_sleep_time": 0.0
}

# Thread management
scan_thread = None
scan_stop_event = threading.Event()
state_lock = threading.Lock()

# Load HOF Redeemer
from redeem_tool import HofRedeemer, generate_code_variations
redeemer = HofRedeemer()

def load_config():
    """Load config from web_config.json and merge service_config.json fields"""
    default_config = {
        "telegram_token": "",
        "telegram_chat_id": "",
        "telegram_enabled": False,
        "discord_webhook_url": "",
        "discord_enabled": False,
        "regex_pattern": r"\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{8,24}\b",
        "scan_interval": 10.0,
        "game_id": redeemer.game_id,
        "username": "",
        "password": ""
    }
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                loaded = json.load(f)
                default_config.update(loaded)
        except Exception as e:
            add_log(f"[-] ไม่สามารถโหลดตั้งค่าได้: {str(e)}")
    # Also merge fields from service_config.json (username, password)
    service_config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "service_config.json")
    if os.path.exists(service_config_path):
        try:
            with open(service_config_path, "r") as f:
                service_cfg = json.load(f)
                for key in ("username", "password"):
                    if key in service_cfg:
                        default_config[key] = service_cfg[key]
        except Exception:
            pass
    return default_config

def save_config(config):
    """Save config to web_config.json"""
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=4)
        # Update redeemer game_id
        if "game_id" in config:
            redeemer.game_id = config["game_id"]
            redeemer.save_session()
        return True
    except Exception as e:
        add_log(f"[-] ไม่สามารถบันทึกตั้งค่าได้: {str(e)}")
        return False

def add_log(message):
    """Add a timestamped log to global state"""
    timestamp = time.strftime("[%Y-%m-%d %H:%M:%S]")
    log_line = f"{timestamp} {message}"
    with state_lock:
        app_state["logs"].append(log_line)
        # Keep only the last 100 logs
        if len(app_state["logs"]) > 100:
            app_state["logs"].pop(0)
    print(log_line)

def get_history():
    """Load history of redeemed codes to avoid duplicates"""
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r") as f:
                return set(json.load(f))
        except:
            pass
    return set()

def save_history(history):
    """Save history of redeemed codes"""
    try:
        with open(HISTORY_FILE, "w") as f:
            json.dump(list(history), f, indent=4)
        with state_lock:
            app_state["redeemed_count"] = len(history)
    except Exception as e:
        add_log(f"[-] ไม่สามารถบันทึกประวัติการเคลมได้: {e}")

def parse_wait_time(msg):
    if not msg:
        return 60
    lowercase_msg = str(msg).lower()
    
    # Check minutes
    minute_match = re.search(r'(\d+)\s*(minute|minutes|min|mins|นาที|m\b)', lowercase_msg)
    if minute_match:
        return int(minute_match.group(1)) * 60
        
    # Check seconds
    second_match = re.search(r'(\d+)\s*(second|seconds|sec|secs|วินาที|s\b)', lowercase_msg)
    if second_match:
        return int(second_match.group(1))
        
    # Generic number
    generic_match = re.search(r'(\d+)', lowercase_msg)
    if generic_match:
        val = int(generic_match.group(1))
        if val <= 10:
            return val * 60
        else:
            return val
            
    return 60

def send_telegram(message, force=False):
    """Send a message to Telegram channel/bot"""
    config = load_config()
    if not config.get("telegram_enabled", False) and not force:
        return False
        
    token = config.get("telegram_token")
    chat_id = config.get("telegram_chat_id")
    
    if not token or not chat_id:
        add_log("[!] ข้ามการส่ง Telegram: ยังไม่ได้ตั้งค่า Token หรือ Chat ID")
        return False
        
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "Markdown"
    }
    
    try:
        r = requests.post(url, json=payload, timeout=10)
        if r.status_code == 200:
            add_log("[+] ส่งข้อความแจ้งเตือนเข้า Telegram สำเร็จ!")
            return True
        else:
            add_log(f"[-] Telegram API ตอบกลับล้มเหลว (HTTP {r.status_code}): {r.text}")
    except Exception as e:
        add_log(f"[-] ไม่สามารถเชื่อมต่อกับ Telegram API ได้: {str(e)}")
    return False

def send_discord(message, force=False):
    """Send a message to Discord Webhook"""
    config = load_config()
    if not config.get("discord_enabled", False) and not force:
        return False
        
    url = config.get("discord_webhook_url")
    
    if not url:
        add_log("[!] ข้ามการส่ง Discord: ยังไม่ได้ตั้งค่า Discord Webhook")
        return False
        
    payload = {
        "username": "TalesRunner Bot",
        "content": message
    }
        
    try:
        r = requests.post(url, json=payload, timeout=10)
        if r.status_code in [200, 204]:
            add_log("[+] ส่งข้อความแจ้งเตือนเข้า Discord สำเร็จ!")
            return True
        else:
            add_log(f"[-] Discord Webhook ตอบกลับล้มเหลว (HTTP {r.status_code}): {r.text}")
    except Exception as e:
        add_log(f"[-] ไม่สามารถเชื่อมต่อกับ Discord Webhook ได้: {str(e)}")
    return False

def log_notified_code(code):
    """Log pushed codes to notified_codes.log"""
    log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'notified_codes.log')
    timestamp = time.strftime("[%Y-%m-%d %H:%M:%S]")
    try:
        with open(log_path, 'a', encoding='utf-8') as f:
            f.write(f"{timestamp} Code: {code}\n")
    except Exception as e:
        print(f"[-] ไม่สามารถบันทึกประวัติการส่งแจ้งเตือนใน log: {e}")

def sleep_ocr_python(minutes, reason='notification'):
    """Pause OCR scanning loop for specified minutes while livestream plays"""
    with state_lock:
        app_state["ocr_sleep_until"] = time.time() + (minutes * 60)
        
    if reason == 'periodic':
        add_log(f"[*] ทำงานสแกนครบ 5 นาที: กำลังหยุดพักการสแกน OCR เป็นเวลา {minutes} นาทีชั่วคราว... (สตรีมสดจะยังคงเล่นต่อไป)")
    else:
        add_log(f"[*] ตรวจพบการส่งแจ้งเตือน: กำลังหยุดพักการสแกน OCR เป็นเวลา {minutes} นาที... (สตรีมสดจะยังคงเล่นต่อไป)")
    
    sleep_end = time.time() + (minutes * 60)
    while time.time() < sleep_end and not scan_stop_event.is_set():
        time.sleep(0.5)
        
    with state_lock:
        app_state["ocr_sleep_until"] = 0.0
        app_state["last_periodic_sleep_time"] = time.time()
        
    if not scan_stop_event.is_set():
        add_log(f"[*] ครบ {minutes} นาทีแล้ว เริ่มทำงานสแกน OCR ต่อ...")

def ocr_and_redeem_logic(image_path, config):
    """Perform OCR on the image and attempt redemption"""
    if not os.path.exists(SWIFT_BINARY):
        add_log("[-] ไม่พบตัวคอมไพล์ OCR Helper! กรุณารันเพื่อสร้างระบบคอมไพล์ก่อน")
        return
        
    try:
        # Run Swift OCR Helper
        res = subprocess.run([SWIFT_BINARY, image_path], capture_output=True, text=True)
        if res.returncode != 0:
            add_log(f"[-] OCR Helper Error: {res.stderr}")
            return
            
        lines = [line.strip() for line in res.stdout.split("\n") if line.strip()]
        
        # Log detected OCR lines for debugging
        if lines:
            preview = ", ".join(lines[:3]) + ("..." if len(lines) > 3 else "")
            add_log(f"[*] OCR อ่านตัวหนังสือได้: {preview}")
        else:
            add_log("[*] OCR สแกนภาพแล้วไม่พบตัวหนังสือใดๆ")
        
        # Extract codes using the config Regex
        regex_pattern = config.get("regex_pattern", r"\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{8,24}\b")
        compiled_regex = re.compile(regex_pattern)
        
        codes = []
        for line in lines:
            target_text = line
            # Heuristic filters for usernames / chat log noise
            if ":" in line:
                parts = line.split(":", 1)
                before_colon = parts[0].strip()
                if not before_colon.lower().startswith("code") and not before_colon.isdigit():
                    target_text = parts[1]
                    
            target_text = re.sub(r'@\w+', '', target_text)
            
            matches = compiled_regex.findall(target_text.upper())
            for match in matches:
                cleaned = match.replace(" ", "").replace(".", "").strip()
                if cleaned and cleaned not in codes:
                    codes.append(cleaned)
                    
        if codes:
            with state_lock:
                app_state["last_ocr_results"] = codes
                
            history = get_history()
            for code in codes:
                if code in history:
                    continue
                
                from redeem_tool import check_prefix_and_handle_duplicate
                if check_prefix_and_handle_duplicate(code, history, save_history, sleep_ocr_python):
                    break
                
                variations = generate_code_variations(code)
                add_log(f"[⭐] ตรวจพบโค้ดใหม่จากวิดีโอ: {code}")
                add_log(f"[*] สร้างโค้ดใกล้เคียงเพื่อทดสอบ: {', '.join(variations)}")
                
                success = False
                for var in variations:
                    if var in history:
                        continue
                    
                    add_log(f"[*] กำลังตรวจสอบโค้ดเพื่อเช็คของรางวัล (Check Serial): {var} (Note: ไม่สามารถเคลมอัตโนมัติได้แล้วเนื่องจากติด Captcha)...")
                    notified = False
                    api_res = redeemer.redeem_code(var)
                    history.add(var)
                    save_history(history)
                    
                    check_success = api_res.get("check_success", False)
                    success = api_res.get("success", False)
                    data = api_res.get("data", {})
                    msg = data.get("message") or data.get("error") or api_res.get("message") or "Unknown error"
                    msg_str = str(msg).lower()
                    
                    is_wait_error = "please wait" in msg_str
                    should_notify = check_success or is_wait_error
                    
                    if success:
                        add_log(f"[🎉] เคลมโค้ด {var} สำเร็จ!")
                    else:
                        add_log(f"[❌] เคลมโค้ด {var} ล้มเหลว: {msg} (Note: ระบบไม่สามารถเคลมอัตโนมัติได้เนื่องจากติด Captcha - ใช้สำหรับ Check Serial เพื่อดูของรางวัลเท่านั้น)")
                        
                    is_wait_only = "please wait" in msg_str or "captcha token field is required" in msg_str or "captcha type is present" in msg_str
                    if is_wait_only:
                        add_log(f"[!] ตรวจพบ Captcha หรือระบบต้องการการตรวจสอบ (เช็คข้อมูลสำเร็จแล้ว): \"{msg}\". ส่งแจ้งเตือนโค้ดด่วนเข้ากลุ่มทันที...")
                        sent_tele = send_telegram(var)
                        sent_disc = send_discord(var)
                        if sent_tele or sent_disc:
                            log_notified_code(var)
                        notified = True
                        
                        wait_seconds = 10
                        if "please wait" in msg_str:
                            wait_seconds = parse_wait_time(msg)
                        add_log(f"[*] ตรวจพบให้รอตามระบบ: {wait_seconds} วินาที...")
                        
                        retry_success = False
                        wait_fail_count = 1
                        
                        for attempt in range(1, 4):
                            add_log(f"[*] กำลังนอนรอ {wait_seconds} วินาทีก่อนลองใหม่ (Attempt ${attempt}/3)...")
                            time.sleep(wait_seconds)
                            
                            add_log(f"[*] กำลังเข้าสู่ระบบใหม่เพื่อรีเฟรช Token (Attempt {attempt}/3)...")
                            redeemer.login_with_credentials(config.get("username", ""), config.get("password", ""))
                            
                            add_log(f"[*] กำลังลองส่งใหม่รอบที่ {attempt}/3 (Check Serial): {var}...")
                            retry_res = redeemer.redeem_code(var)
                            retry_check_success = retry_res.get("check_success", False)
                            retry_data = retry_res.get("data", {})
                            retry_msg = retry_data.get("message") or retry_data.get("error") or retry_res.get("message") or "Unknown error"
                            retry_msg_str = str(retry_msg).lower()
                            
                            if retry_check_success:
                                add_log(f"[🎉] ลองใหม่สำเร็จในรอบที่ {attempt}!")
                                api_res = retry_res
                                retry_success = True
                                break
                                
                            if "please wait" in retry_msg_str or "captcha token field is required" in retry_msg_str or "captcha type is present" in retry_msg_str:
                                wait_fail_count += 1
                                if wait_fail_count > 3:
                                    add_log("[❌] เกิดข้อผิดพลาด Please wait/Captcha เกิน 3 ครั้งแล้ว (สะสม). ข้ามโค้ดนี้เลย...")
                                    break
                                if "please wait" in retry_msg_str:
                                    wait_seconds = parse_wait_time(retry_msg)
                                else:
                                    wait_seconds = 10
                            else:
                                add_log(f"[❌] ลองใหม่ล้มเหลวด้วยข้อผิดพลาดอื่น: {retry_msg}. หยุดลองใหม่...")
                                break
                                
                        if retry_success:
                            retry_message_to_send = "ไม่ทราบรางวัล"
                            if api_res.get("check_data"):
                                check_json = api_res.get("check_data", {})
                                reward = check_json.get("data", {}).get("reward", {})
                                if reward and reward.get("bundle"):
                                    bundle = reward.get("bundle", {})
                                    bundle_name = bundle.get("name", "ไม่ทราบรางวัล")
                                    items = bundle.get("items", [])
                                    item_names = [it.get("item", {}).get("name") or it.get("name") for it in items]
                                    item_names = [name for name in item_names if name]
                                    item_details = ",".join(item_names)
                                    if item_details:
                                        retry_message_to_send = f"{item_details}"
                                    else:
                                        retry_message_to_send = f"{bundle_name}"
                            send_telegram(retry_message_to_send)
                            send_discord(retry_message_to_send)

                        for v in variations:
                            history.add(v)
                        history.add(code)
                        save_history(history)
                        
                        if notified:
                            sleep_ocr_python(10)
                            
                        success = True
                        break

                    if should_notify:
                        if not notified:
                            if check_success:
                                add_log(f"[⭐] ตรวจพบโค้ดผ่าน Check Serial (200 OK): {var}. ส่งแจ้งเตือนไปยัง Discord และ Telegram...")
                            else:
                                add_log(f"[!] ตรวจพบข้อความ Please wait. ส่งแจ้งเตือนไปยัง Discord และ Telegram...")
                            # Build formatted message
                            message_to_send = f"{var}\nไม่ทราบรางวัล"
                            if check_success and api_res.get("check_data"):
                                check_json = api_res.get("check_data", {})
                                reward = check_json.get("data", {}).get("reward", {})
                                if reward and reward.get("bundle"):
                                    bundle = reward.get("bundle", {})
                                    bundle_name = bundle.get("name", "ไม่ทราบรางวัล")
                                    items = bundle.get("items", [])
                                    item_names = [it.get("item", {}).get("name") or it.get("name") for it in items]
                                    item_names = [name for name in item_names if name]
                                    item_details = ",".join(item_names)
                                    if item_details:
                                        message_to_send = f"{var}\n{item_details}"
                                    else:
                                        message_to_send = f"{var}\n{bundle_name}"

                            sent_tele = send_telegram(message_to_send)
                            sent_disc = send_discord(message_to_send)
                            if sent_tele or sent_disc:
                                log_notified_code(var)
                            notified = True

                        # Add all variations to history to prevent duplicates
                        for v in variations:
                            history.add(v)
                        history.add(code)
                        save_history(history)
                        
                        # Sleep OCR Python if notified
                        if notified:
                            sleep_ocr_python(10)
                        
                        success = True
                        break

                
                if not success:
                    # Also add the original code to history if none succeeded to prevent reprocessing
                    history.add(code)
                    save_history(history)
    except Exception as e:
        add_log(f"[-] เกิดข้อผิดพลาดในขั้นตอนวิเคราะห์โค้ด: {str(e)}")

def is_youtube_channel(url):
    """Detect if the URL points to a YouTube channel instead of a video"""
    url_lower = url.lower()
    has_channel_marker = any(marker in url_lower for marker in ['/@', '/channel/', '/c/', '/user/'])
    has_video_marker = any(marker in url_lower for marker in ['watch?v=', 'youtu.be/', '/shorts/', '/embed/'])
    return has_channel_marker and not has_video_marker

def get_channel_live_url(url):
    """Ensure the channel URL ends with /live for checking"""
    url_stripped = url.strip().rstrip('/')
    if not url_stripped.lower().endswith('/live'):
        return f"{url_stripped}/live"
    return url_stripped

def is_video_live_python(video_url):
    """Check if the YouTube video is still live using yt-dlp"""
    ytdl_path = "/opt/homebrew/bin/yt-dlp"
    if not os.path.exists(ytdl_path):
        ytdl_path = "yt-dlp"
    try:
        res = subprocess.run([
            ytdl_path,
            '--print', 'is_live',
            video_url
        ], capture_output=True, text=True, timeout=15)
        if res.returncode == 0:
            return res.stdout.strip().lower() == 'true'
    except Exception as e:
        pass
    return True

def channel_watcher_loop(channel_url, stop_event):
    """Background loop to check if a YouTube channel is live, and trigger scanning if so"""
    config = load_config()
    add_log(f"[*] เริ่มตรวจจับช่อง YouTube: {channel_url}")
    
    ytdl_path = "/opt/homebrew/bin/yt-dlp"
    if not os.path.exists(ytdl_path):
        ytdl_path = "yt-dlp"

    live_url = get_channel_live_url(channel_url)
    active_scan_thread = None
    active_scan_stop_event = threading.Event()
    
    while not stop_event.is_set():
        if active_scan_thread and active_scan_thread.is_alive():
            # Already scanning the live stream, sleep and wait
            time.sleep(5.0)
            continue
            
        if active_scan_thread:
            active_scan_thread = None
            active_scan_stop_event.clear()
            # Set current_url back to the channel URL so the frontend knows we are waiting again
            with state_lock:
                app_state["current_url"] = channel_url
                app_state["last_ocr_results"] = []
            add_log(f"[*] ไลฟ์สตรีมสิ้นสุดลงแล้ว กลับมารอช่องไปไลฟ์ต่อ...")

        # Channel is not currently scanning. Check if it is live!
        try:
            res = subprocess.run([
                ytdl_path,
                '--get-id',
                live_url
            ], capture_output=True, text=True, timeout=15)
            
            if res.returncode == 0 and res.stdout.strip():
                video_id = res.stdout.strip()
                video_url = f"https://www.youtube.com/watch?v={video_id}"
                add_log(f"[⭐] ตรวจพบการสตรีมสด! รหัสสตรีม: {video_id}")
                
                # Start scanning thread for this video
                with state_lock:
                    app_state["current_url"] = video_url
                    app_state["last_ocr_results"] = []
                    
                active_scan_stop_event.clear()
                active_scan_thread = threading.Thread(
                    target=youtube_scan_loop, 
                    args=(video_url, active_scan_stop_event), 
                    daemon=True
                )
                active_scan_thread.start()
            else:
                add_log(f"[*] ยังไม่พบการสตรีมสดของช่อง จะตรวจสอบใหม่ในอีก 60 วินาที...")
        except subprocess.TimeoutExpired:
            add_log("[-] ตรวจสอบสถานะไลฟ์ช่องหมดเวลา (Timeout)")
        except Exception as e:
            add_log(f"[-] เกิดข้อผิดพลาดในการเช็คไลฟ์สตรีมช่อง: {str(e)}")

        # Sleep for 60 seconds, checking stop_event periodically
        sleep_elapsed = 0.0
        while sleep_elapsed < 60.0 and not stop_event.is_set():
            if not app_state["scanning"]:
                stop_event.set()
                break
            time.sleep(0.5)
            sleep_elapsed += 0.5

    # Clean up child thread if watcher is stopped
    if active_scan_thread and active_scan_thread.is_alive():
        active_scan_stop_event.set()
        active_scan_thread.join()
        
    add_log("[*] ปิดระบบตรวจจับช่อง YouTube เรียบร้อยแล้ว")

def youtube_scan_loop(url, stop_event):
    """Background loop to fetch YouTube stream direct URL and seek frame using ffmpeg"""
    config = load_config()
    interval = float(config.get("scan_interval", 10.0))
    add_log(f"[*] เริ่มทำงานสแกน YouTube: {url}")
    
    # We will use /opt/homebrew/bin/yt-dlp for extraction
    ytdl_path = "/opt/homebrew/bin/yt-dlp"
    ffmpeg_path = "/opt/homebrew/bin/ffmpeg"
    
    if not os.path.exists(ytdl_path):
        add_log("[-] ไม่พบ yt-dlp ที่ตำแหน่ง /opt/homebrew/bin/yt-dlp! พยายามใช้ตัวสำรอง...")
        ytdl_path = "yt-dlp"
        
    if not os.path.exists(ffmpeg_path):
        ffmpeg_path = "ffmpeg"

    cached_direct_url = None
    cached_url = None
    failure_count = 0
    max_failures = 6

    with state_lock:
        app_state["last_periodic_sleep_time"] = time.time()
    last_live_check = time.time()

    while not stop_event.is_set():
        # Periodic sleep: 2 minutes sleep every 5 minutes
        with state_lock:
            elapsed = time.time() - app_state.get("last_periodic_sleep_time", time.time())
            ocr_sleeping = app_state.get("ocr_sleep_until", 0.0) > time.time()
            
        if elapsed >= 5 * 60 and not ocr_sleeping:
            sleep_ocr_python(2, 'periodic')
            continue

        # Get the latest state
        with state_lock:
            current_url = app_state.get("current_url")
            current_time = app_state.get("current_time", 0.0)
            is_live = app_state.get("is_live", False)
            
        if not current_url:
            current_url = url

        # If url changed, reset cached direct url and failure count
        if current_url != cached_url:
            cached_direct_url = None
            cached_url = current_url
            failure_count = 0

        # Check if the stream has ended every 2 minutes
        if time.time() - last_live_check >= 120.0:
            last_live_check = time.time()
            if not is_video_live_python(current_url):
                add_log("[*] ตรวจพบว่าสตรีมสดสิ้นสุดการแพร่ภาพแล้ว หยุดการสแกน...")
                break

        # Step 1: Resolve direct URL if not cached
        if not cached_direct_url:
            add_log("[*] กำลังวิเคราะห์ข้อมูลวิดีโอเพื่อค้นหาลิงก์ตรงด้วย yt-dlp...")
            try:
                res = subprocess.run([
                    ytdl_path,
                    '-g',
                    '-f', '134/bestvideo[height<=360]/best',
                    current_url
                ], capture_output=True, text=True, timeout=15)
                
                if res.returncode == 0 and res.stdout.strip():
                    cached_direct_url = res.stdout.strip()
                    add_log("[+] วิเคราะห์ลิงก์ตรงของวิดีโอสำเร็จ!")
                else:
                    add_log(f"[-] yt-dlp วิเคราะห์ล้มเหลว: {res.stderr.strip()}")
                    failure_count += 1
                    if failure_count >= max_failures:
                        add_log("[-] หยุดสแกนสตรีมนี้ เนื่องจากวิเคราะห์ลิงก์ล้มเหลวติดต่อกันครบกำหนด")
                        break
                    # Sleep short time and retry
                    time.sleep(5.0)
                    continue
            except Exception as e:
                add_log(f"[-] เกิดข้อผิดพลาดในการเรียก yt-dlp: {str(e)}")
                failure_count += 1
                if failure_count >= max_failures:
                    add_log("[-] หยุดสแกนสตรีมนี้ เนื่องจากเกิดข้อผิดพลาดในการเรียก yt-dlp ติดต่อกันครบกำหนด")
                    break
                time.sleep(5.0)
                continue

        # Step 2: Extract frame from the direct URL using FFmpeg
        add_log(f"[*] กำลังดึงเฟรมภาพที่เวลา {current_time:.1f} วินาที (สถานะ Live: {is_live})...")
        try:
            # Build ffmpeg command
            # Put -ss BEFORE -i for input seeking (much faster and uses keyframes)
            ffmpeg_cmd = [ffmpeg_path, '-y']
            
            if not is_live and current_time > 0.0:
                ffmpeg_cmd.extend(['-ss', str(current_time)])
                
            ffmpeg_cmd.extend([
                '-i', cached_direct_url,
                '-vframes', '1',
                '-f', 'image2',
                TEMP_FRAME
            ])
            
            f_res = subprocess.run(ffmpeg_cmd, capture_output=True, text=True, timeout=10)
            
            if f_res.returncode == 0 and os.path.exists(TEMP_FRAME):
                failure_count = 0  # Reset failure count on successful frame capture and OCR
                # Step 3: Run OCR analysis on the frame
                ocr_and_redeem_logic(TEMP_FRAME, config)
            else:
                add_log("[-] ดึงเฟรมล้มเหลว ดึงข้อมูลลิงก์ตรงใหม่ในรอบถัดไป...")
                cached_direct_url = None
                failure_count += 1
                if failure_count >= max_failures:
                    add_log("[-] หยุดสแกนสตรีมนี้ เนื่องจากดึงเฟรมล้มเหลวติดต่อกันครบกำหนด")
                    break
                
        except subprocess.TimeoutExpired:
            add_log("[-] FFmpeg ใช้เวลานานเกินไป (Timeout) รีเซ็ตลิงก์ตรง...")
            cached_direct_url = None
            failure_count += 1
            if failure_count >= max_failures:
                add_log("[-] หยุดสแกนสตรีมนี้ เนื่องจากดึงเฟรมล่าช้าติดต่อกันครบกำหนด")
                break
        except Exception as e:
            add_log(f"[-] เกิดข้อผิดพลาดในขั้นตอนดึงเฟรม: {str(e)}")
            cached_direct_url = None
            failure_count += 1
            if failure_count >= max_failures:
                add_log("[-] หยุดสแกนสตรีมนี้ เนื่องจากเกิดข้อผิดพลาดในการดึงเฟรมติดต่อกันครบกำหนด")
                break
            
        # Sleep for configured interval before next capture
        # Check stop_event periodically so we can shut down quickly
        sleep_elapsed = 0.0
        while sleep_elapsed < interval and not stop_event.is_set():
            time.sleep(0.5)
            sleep_elapsed += 0.5
            
    add_log("[*] ปิดระบบสแกนเบื้องหลังเรียบร้อยแล้ว")

# --- Flask Routes ---

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/status", methods=["GET"])
def status():
    # Update current playback status from query parameters if present
    current_time_str = request.args.get("current_time")
    is_live_str = request.args.get("is_live")
    
    if current_time_str is not None:
        try:
            with state_lock:
                app_state["current_time"] = float(current_time_str)
        except:
            pass
            
    if is_live_str is not None:
        with state_lock:
            app_state["is_live"] = is_live_str.lower() in ("true", "1")

    config = load_config()
    history = get_history()
    hof_status = {
        "logged_in": redeemer.access_token is not None,
        "token_preview": f"Bearer {redeemer.access_token[:15]}..." if redeemer.access_token else "ไม่มี",
        "game_id": redeemer.game_id
    }
    
    now = time.time()
    sleep_until = app_state.get("ocr_sleep_until", 0.0)
    ocr_sleeping = sleep_until > now
    ocr_sleep_remaining = max(0, int(sleep_until - now)) if ocr_sleeping else 0

    return jsonify({
        "scanning": app_state["scanning"],
        "current_url": app_state["current_url"],
        "logs": app_state["logs"],
        "redeemed_count": len(history),
        "last_ocr_results": app_state["last_ocr_results"],
        "hof_status": hof_status,
        "ocr_sleeping": ocr_sleeping,
        "ocr_sleep_remaining": ocr_sleep_remaining,
        "config": {
            "telegram_token": config.get("telegram_token", ""),
            "telegram_chat_id": config.get("telegram_chat_id", ""),
            "telegram_enabled": config.get("telegram_enabled", False),
            "discord_webhook_url": config.get("discord_webhook_url", ""),
            "discord_enabled": config.get("discord_enabled", False),
            "regex_pattern": config.get("regex_pattern", ""),
            "scan_interval": config.get("scan_interval", 10.0),
            "game_id": config.get("game_id", "")
        }
    })

@app.route("/api/config", methods=["POST"])
def update_config():
    data = request.json
    config = load_config()
    
    if "telegram_token" in data: config["telegram_token"] = data["telegram_token"].strip()
    if "telegram_chat_id" in data: config["telegram_chat_id"] = data["telegram_chat_id"].strip()
    if "telegram_enabled" in data: config["telegram_enabled"] = bool(data["telegram_enabled"])
    if "discord_webhook_url" in data: config["discord_webhook_url"] = data["discord_webhook_url"].strip()
    if "discord_enabled" in data: config["discord_enabled"] = bool(data["discord_enabled"])
    if "regex_pattern" in data: 
        try:
            re.compile(data["regex_pattern"])
            config["regex_pattern"] = data["regex_pattern"].strip()
        except re.error as e:
            return jsonify({"success": False, "message": f"Regex ไม่ถูกต้อง: {str(e)}"})
    if "scan_interval" in data:
        try: config["scan_interval"] = float(data["scan_interval"])
        except: pass
    if "game_id" in data:
        config["game_id"] = data["game_id"].strip()
        
    if save_config(config):
        add_log("[+] อัปเดตและบันทึกการตั้งค่าระบบเรียบร้อย")
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "ไม่สามารถบันทึกไฟล์ได้"})

@app.route("/api/login", methods=["POST"])
def login():
    data = request.json
    login_type = data.get("type")
    
    if login_type == "credentials":
        username = data.get("username", "").strip()
        password = data.get("password", "").strip()
        if not username or not password:
            return jsonify({"success": False, "message": "กรุณากรอกทั้ง Username และ Password"})
        success = redeemer.login_with_credentials(username, password)
        if success:
            add_log(f"[+] ล็อกอินผ่านรหัสผ่านสำเร็จ (Token: {redeemer.access_token[:15]}...)")
            return jsonify({"success": True})
        return jsonify({"success": False, "message": "เข้าสู่ระบบล้มเหลว ตรวจสอบข้อมูลล็อกอินอีกครั้ง"})
        
    elif login_type == "token":
        token = data.get("token", "").strip()
        if not token:
            return jsonify({"success": False, "message": "Token ว่างเปล่า"})
        redeemer.set_bearer_token(token)
        add_log(f"[+] บันทึกการใช้งาน Bearer Token สำเร็จ ({token[:15]}...)")
        return jsonify({"success": True})
        
    return jsonify({"success": False, "message": "ประเภทการเข้าสู่ระบบไม่ถูกต้อง"})

@app.route("/api/logout", methods=["POST"])
def logout():
    redeemer.logout()
    add_log("[*] ล็อกออกจากบัญชีเกม HOF เรียบร้อยแล้ว")
    return jsonify({"success": True})

@app.route("/api/telegram-test", methods=["POST"])
def test_telegram():
    config = load_config()
    test_msg = (
        "🤖 *ทดสอบการแจ้งเตือนจากระบบดึงไอเทมโค้ดอัตโนมัติ*\n"
        "🟢 ระบบส่งสัญญาณการเชื่อมต่อ Telegram Bot สำเร็จเรียบร้อยแล้ว!"
    )
    success = send_telegram(test_msg, force=True)
    if success:
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "ส่งข้อความล้มเหลว กรุณาตรวจสอบ Token และ Chat ID อีกครั้ง"})

@app.route("/api/discord-test", methods=["POST"])
def test_discord():
    config = load_config()
    url = config.get("discord_webhook_url")
    if not url:
        return jsonify({"success": False, "message": "ยังไม่ได้ตั้งค่า Discord Webhook URL"})
    
    payload = {
        "username": "TalesRunner OCR Test Bot",
        "embeds": [
            {
                "title": "🤖 ทดสอบการแจ้งเตือนจากระบบดึงไอเทมโค้ดอัตโนมัติ",
                "description": "ระบบส่งสัญญาณการเชื่อมต่อ Discord Webhook สำเร็จเรียบร้อยแล้ว!",
                "color": 5814783,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")
            }
        ]
    }
    try:
        r = requests.post(url, json=payload, timeout=10)
        if r.status_code in [200, 204]:
            return jsonify({"success": True})
        else:
            return jsonify({"success": False, "message": f"Discord API ตอบกลับล้มเหลว (HTTP {r.status_code}): {r.text}"})
    except Exception as e:
        return jsonify({"success": False, "message": f"ไม่สามารถเชื่อมต่อกับ Discord Webhook ได้: {str(e)}"})

@app.route("/api/start", methods=["POST"])
def start_scan():
    global scan_thread
    data = request.json
    url = data.get("url", "").strip()
    
    if not url:
        return jsonify({"success": False, "message": "กรุณาระบุ URL ของ YouTube"})
        
    if app_state["scanning"]:
        return jsonify({"success": False, "message": "ระบบกำลังทำงานสแกนอยู่แล้ว"})
        
    # Clear stop event and configure thread
    scan_stop_event.clear()
    with state_lock:
        app_state["scanning"] = True
        app_state["current_url"] = url
        app_state["last_ocr_results"] = []
        
    # Check if URL is a channel or a direct video
    if is_youtube_channel(url):
        scan_thread = threading.Thread(target=channel_watcher_loop, args=(url, scan_stop_event), daemon=True)
        add_log(f"[+] สั่งตรวจจับสตรีมสดจากช่อง YouTube: {url}")
    else:
        scan_thread = threading.Thread(target=youtube_scan_loop, args=(url, scan_stop_event), daemon=True)
        add_log(f"[+] สั่งเริ่มการสแกนระบบผ่านหน้าเว็บเรียบร้อย: {url}")
        
    scan_thread.start()
    return jsonify({"success": True})

@app.route("/api/stop", methods=["POST"])
def stop_scan():
    global scan_thread
    if not app_state["scanning"]:
        return jsonify({"success": False, "message": "ระบบไม่ได้ทำงานสแกนอยู่ในขณะนี้"})
        
    scan_stop_event.set()
    with state_lock:
        app_state["scanning"] = False
        app_state["current_url"] = ""
        
    add_log("[*] สั่งหยุดการสแกนระบบเบื้องหลัง...")
    return jsonify({"success": True})

if __name__ == "__main__":
    # Ensure history state loaded
    history = get_history()
    app_state["redeemed_count"] = len(history)
    
    # Check if ocr_helper is compiled, compile it if needed
    if not os.path.exists(SWIFT_BINARY):
        print("[*] Compiling ocr_helper.swift...")
        try:
            res = subprocess.run(["swiftc", "ocr_helper.swift", "-o", "ocr_helper"])
            if res.returncode == 0:
                print("[+] ocr_helper compiled successfully!")
            else:
                print("[-] Failed to compile ocr_helper.swift")
        except Exception as e:
            print(f"[-] Compile error: {e}")
            
    print("\n" + "="*50)
    print("  TalesRunner HOF Livestream OCR Web Server running!")
    print("  เปิดหน้าต่างเบราว์เซอร์ไปที่: http://localhost:5001")
    print("="*50 + "\n")
    
    app.run(host="0.0.0.0", port=5001, debug=True, use_reloader=False)
