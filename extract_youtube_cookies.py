#!/usr/bin/env python3
"""
Enhanced YouTube Cookie Extractor for YouTube Transcription Service

This script provides multiple methods to extract YouTube cookies for authentication,
addressing the bot detection issues in yt-dlp.

Usage:
    python extract_youtube_cookies.py

Requirements:
    pip install browser-cookie3 requests selenium webdriver-manager
"""

import os
import sys
import json
import base64
import time
from pathlib import Path
from typing import Optional, Dict, List
import subprocess

def print_banner():
    """Print the script banner"""
    print("=" * 60)
    print("🎬 YouTube Cookie Extractor for Transcription Service")
    print("=" * 60)
    print("This script will help you extract YouTube cookies to bypass bot detection")
    print("")

def check_dependencies():
    """Check if required dependencies are installed"""
    required_packages = [
        'browser_cookie3',
        'requests',
        'selenium',
        'webdriver_manager'
    ]
    
    missing_packages = []
    
    for package in required_packages:
        try:
            __import__(package.replace('-', '_'))
        except ImportError:
            missing_packages.append(package)
    
    if missing_packages:
        print("❌ Missing required packages. Please install them:")
        print(f"pip install {' '.join(missing_packages)}")
        return False
    
    print("✅ All required packages are installed")
    return True

def method_1_browser_cookies():
    """Method 1: Extract cookies using browser-cookie3"""
    print("\n🔍 Method 1: Browser Cookie Extraction")
    print("-" * 40)
    
    try:
        import browser_cookie3
        
        browsers = [
            ('chrome', browser_cookie3.chrome),
            ('firefox', browser_cookie3.firefox),
            ('edge', browser_cookie3.edge),
            ('opera', browser_cookie3.opera),
        ]
        
        for browser_name, browser_func in browsers:
            try:
                print(f"📋 Trying {browser_name}...")
                cookies = browser_func(domain_name='youtube.com')
                
                youtube_cookies = []
                for cookie in cookies:
                    if 'youtube.com' in cookie.domain or 'googlevideo.com' in cookie.domain:
                        youtube_cookies.append({
                            'domain': cookie.domain,
                            'name': cookie.name,
                            'value': cookie.value,
                            'path': cookie.path,
                            'secure': cookie.secure,
                            'expires': cookie.expires
                        })
                
                if youtube_cookies:
                    print(f"✅ Found {len(youtube_cookies)} YouTube cookies in {browser_name}")
                    return youtube_cookies
                    
            except Exception as e:
                print(f"❌ {browser_name} extraction failed: {e}")
                continue
        
        print("❌ No YouTube cookies found in any browser")
        return None
        
    except Exception as e:
        print(f"❌ Browser cookie extraction failed: {e}")
        return None

def method_2_manual_cookie_input():
    """Method 2: Manual cookie input from browser dev tools"""
    print("\n🔍 Method 2: Manual Cookie Input")
    print("-" * 40)
    print("If automatic extraction failed, you can manually copy cookies from your browser:")
    print("")
    print("1. Open Chrome/Edge and go to https://www.youtube.com")
    print("2. Log in to your YouTube account")
    print("3. Press F12 to open Developer Tools")
    print("4. Go to Application/Storage > Cookies > https://www.youtube.com")
    print("5. Copy the cookies you want to use")
    print("")
    
    response = input("Do you want to enter cookies manually? (y/n): ").lower().strip()
    
    if response != 'y':
        return None
    
    print("\nEnter cookies in Netscape format (one per line):")
    print("Format: domain\\tflag\\tpath\\tsecure\\texpiration\\tname\\tvalue")
    print("Example: .youtube.com\\tTRUE\\t/\\tTRUE\\t1735689600\\tVISITOR_INFO1_LIVE\\tabcdef123456")
    print("")
    print("Enter your cookies (press Enter twice when done):")
    
    cookies_text = ""
    while True:
        line = input()
        if not line:
            break
        cookies_text += line + "\n"
    
    if cookies_text.strip():
        return cookies_text.strip()
    
    return None

def method_3_selenium_extraction():
    """Method 3: Use Selenium to extract cookies after login"""
    print("\n🔍 Method 3: Selenium Browser Automation")
    print("-" * 40)
    
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from webdriver_manager.chrome import ChromeDriverManager
        
        print("🚀 Starting Chrome browser...")
        
        options = Options()
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument('--disable-gpu')
        options.add_argument('--window-size=1920,1080')
        
        # Don't use headless mode so user can interact
        driver = webdriver.Chrome(ChromeDriverManager().install(), options=options)
        
        try:
            print("📺 Opening YouTube...")
            driver.get("https://www.youtube.com")
            
            print("\n📋 Please log in to YouTube in the browser window")
            print("Press Enter here when you're logged in and ready to extract cookies...")
            input()
            
            # Extract cookies
            selenium_cookies = driver.get_cookies()
            
            # Convert to Netscape format
            netscape_cookies = []
            for cookie in selenium_cookies:
                if 'youtube.com' in cookie.get('domain', ''):
                    expires = cookie.get('expiry', 0)
                    secure = 'TRUE' if cookie.get('secure', False) else 'FALSE'
                    http_only = 'TRUE' if cookie.get('httpOnly', False) else 'FALSE'
                    
                    netscape_cookies.append(
                        f"{cookie['domain']}\t{http_only}\t{cookie['path']}\t{secure}\t{int(expires)}\t{cookie['name']}\t{cookie['value']}"
                    )
            
            if netscape_cookies:
                print(f"✅ Extracted {len(netscape_cookies)} cookies via Selenium")
                return "\n".join(netscape_cookies)
            else:
                print("❌ No YouTube cookies found via Selenium")
                return None
                
        finally:
            driver.quit()
            
    except Exception as e:
        print(f"❌ Selenium extraction failed: {e}")
        return None

def validate_cookies(cookie_text: str) -> bool:
    """Validate cookie format and content"""
    if not cookie_text or len(cookie_text.strip()) == 0:
        return False
    
    lines = cookie_text.strip().split('\n')
    valid_cookies = 0
    
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        
        parts = line.split('\t')
        if len(parts) >= 7:
            try:
                # Check expiration timestamp
                expiration = int(parts[4])
                current_time = int(time.time())
                
                if expiration > current_time:  # Not expired
                    valid_cookies += 1
            except ValueError:
                continue
    
    print(f"📊 Cookie validation: {valid_cookies} valid, {len(lines)} total")
    return valid_cookies > 0

def save_cookies(cookies_text: str, output_dir: Path = Path(".")):
    """Save cookies in multiple formats"""
    output_dir.mkdir(exist_ok=True)
    
    # Save plain text
    plain_file = output_dir / "youtube_cookies.txt"
    with open(plain_file, 'w', encoding='utf-8') as f:
        f.write(cookies_text)
    print(f"💾 Saved plain text cookies: {plain_file}")
    
    # Save base64 encoded
    encoded_cookies = base64.b64encode(cookies_text.encode('utf-8')).decode('utf-8')
    b64_file = output_dir / "youtube_cookies_base64.txt"
    with open(b64_file, 'w', encoding='utf-8') as f:
        f.write(encoded_cookies)
    print(f"💾 Saved base64 cookies: {b64_file}")
    
    # Save environment variable format
    env_file = output_dir / "youtube_cookies_env.txt"
    with open(env_file, 'w', encoding='utf-8') as f:
        f.write(f"YOUTUBE_COOKIES_CONTENT={encoded_cookies}")
    print(f"💾 Saved environment variable: {env_file}")
    
    return {
        'plain': str(plain_file),
        'base64': str(b64_file),
        'env': str(env_file),
        'encoded': encoded_cookies
    }

def test_cookies_with_yt_dlp(cookie_file: str) -> bool:
    """Test cookies with yt-dlp"""
    print("\n🧪 Testing cookies with yt-dlp...")
    
    test_url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"  # Short test video
    
    cmd = [
        "yt-dlp",
        "--cookies", cookie_file,
        "--dump-json",
        "--no-download",
        test_url
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            print("✅ Cookie test successful!")
            return True
        else:
            print(f"❌ Cookie test failed: {result.stderr}")
            return False
            
    except subprocess.TimeoutExpired:
        print("⏰ Cookie test timed out")
        return False
    except Exception as e:
        print(f"❌ Cookie test error: {e}")
        return False

def main():
    """Main cookie extraction workflow"""
    print_banner()
    
    if not check_dependencies():
        sys.exit(1)
    
    methods = [
        ("Browser Cookie Extraction", method_1_browser_cookies),
        ("Manual Cookie Input", method_2_manual_cookie_input),
        ("Selenium Browser Automation", method_3_selenium_extraction)
    ]
    
    cookies_text = None
    
    for method_name, method_func in methods:
        print(f"\n🔄 Attempting: {method_name}")
        
        if method_name == "Selenium Browser Automation":
            response = input("This will open a browser window. Continue? (y/n): ").lower().strip()
            if response != 'y':
                continue
        
        result = method_func()
        
        if result:
            # Handle different return types
            if isinstance(result, list):  # Browser cookies
                # Convert to Netscape format
                netscape_lines = []
                for cookie in result:
                    secure = 'TRUE' if cookie.get('secure', False) else 'FALSE'
                    expires = cookie.get('expires', 0) or int(time.time()) + 31536000  # 1 year default
                    
                    netscape_lines.append(
                        f"{cookie['domain']}\tFALSE\t{cookie['path']}\t{secure}\t{expires}\t{cookie['name']}\t{cookie['value']}"
                    )
                cookies_text = "\n".join(netscape_lines)
            else:  # String cookies
                cookies_text = result
            
            print(f"✅ Successfully extracted cookies using {method_name}")
            break
        else:
            print(f"❌ {method_name} failed or was skipped")
    
    if not cookies_text:
        print("\n❌ All cookie extraction methods failed!")
        print("Please try the following:")
        print("1. Make sure you're logged into YouTube in your browser")
        print("2. Try a different browser (Chrome, Firefox, Edge)")
        print("3. Clear browser cache and try again")
        print("4. Use manual cookie input as a fallback")
        sys.exit(1)
    
    # Validate cookies
    if not validate_cookies(cookies_text):
        print("\n⚠️ Cookie validation failed!")
        response = input("Continue anyway? (y/n): ").lower().strip()
        if response != 'y':
            sys.exit(1)
    
    # Save cookies
    print("\n💾 Saving cookies...")
    saved_files = save_cookies(cookies_text)
    
    # Test cookies
    test_success = test_cookies_with_yt_dlp(saved_files['plain'])
    
    # Print results
    print("\n" + "=" * 60)
    print("🎉 COOKIE EXTRACTION COMPLETE!")
    print("=" * 60)
    
    if test_success:
        print("✅ Cookies are working correctly with yt-dlp")
    else:
        print("⚠️ Cookies extracted but yt-dlp test failed")
        print("You may need to refresh your cookies or try a different method")
    
    print(f"\n📁 Files saved in current directory:")
    for file_type, file_path in saved_files.items():
        if file_type != 'encoded':
            print(f"  • {file_type}: {file_path}")
    
    print(f"\n🔧 For Modal deployment, set this environment variable:")
    print(f"YOUTUBE_COOKIES_CONTENT={saved_files['encoded'][:50]}...")
    
    print(f"\n📋 Full environment variable value saved in: {saved_files['env']}")
    
    print("\n🚀 Next steps:")
    print("1. Update your Modal secrets with the YOUTUBE_COOKIES_CONTENT value")
    print("2. Redeploy your Modal worker")
    print("3. Test transcription with a YouTube video")

if __name__ == "__main__":
    main()