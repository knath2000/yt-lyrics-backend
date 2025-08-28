#!/usr/bin/env python3
"""
YouTube Authentication Test Suite

This script tests various YouTube authentication methods to ensure
they work correctly with yt-dlp and can bypass bot detection.

Usage:
    python test_youtube_auth.py

Requirements:
    pip install requests
"""

import os
import sys
import json
import base64
import time
import subprocess
from pathlib import Path
from typing import Dict, List, Optional

def print_header(title: str):
    """Print a formatted header"""
    print("\n" + "=" * 60)
    print(f"🧪 {title}")
    print("=" * 60)

def test_environment_variables():
    """Test if required environment variables are set"""
    print_header("Environment Variable Check")
    
    required_vars = [
        'YOUTUBE_COOKIES_CONTENT',
        'CLOUDINARY_CLOUD_NAME',
        'CLOUDINARY_API_KEY',
        'CLOUDINARY_API_SECRET'
    ]
    
    results = {}
    
    for var in required_vars:
        value = os.environ.get(var)
        if value:
            # Don't print the full value for security
            preview = value[:20] + "..." if len(value) > 20 else value
            print(f"✅ {var}: {preview}")
            results[var] = True
        else:
            print(f"❌ {var}: Not set")
            results[var] = False
    
    return results

def test_cookie_decoding():
    """Test cookie decoding and validation"""
    print_header("Cookie Decoding Test")
    
    cookie_content = os.environ.get("YOUTUBE_COOKIES_CONTENT")
    if not cookie_content:
        print("❌ YOUTUBE_COOKIES_CONTENT not set")
        return False
    
    try:
        # Try base64 decoding
        try:
            decoded = base64.b64decode(cookie_content).decode('utf-8')
            print("✅ Base64 decoding successful")
            cookie_text = decoded
        except:
            print("⚠️ Base64 decoding failed, treating as plain text")
            cookie_text = cookie_content
        
        # Validate cookie format
        lines = cookie_text.strip().split('\n')
        valid_cookies = 0
        
        for line in lines:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            
            parts = line.split('\t')
            if len(parts) >= 7:
                try:
                    expiration = int(parts[4])
                    current_time = int(time.time())
                    
                    if expiration > current_time:
                        valid_cookies += 1
                    else:
                        print(f"⚠️ Expired cookie: {parts[5]}")
                except ValueError:
                    print(f"⚠️ Invalid expiration format: {parts[4]}")
        
        print(f"📊 Found {valid_cookies} valid cookies out of {len(lines)} total")
        
        if valid_cookies > 0:
            print("✅ Cookie validation successful")
            return True
        else:
            print("❌ No valid cookies found")
            return False
            
    except Exception as e:
        print(f"❌ Cookie decoding error: {e}")
        return False

def test_cookie_file_creation():
    """Test creating cookie file in temporary directory"""
    print_header("Cookie File Creation Test")
    
    cookie_content = os.environ.get("YOUTUBE_COOKIES_CONTENT")
    if not cookie_content:
        print("❌ YOUTUBE_COOKIES_CONTENT not set")
        return False
    
    try:
        # Create temporary directory
        temp_dir = Path("/tmp") if os.name != 'nt' else Path(os.environ.get('TEMP', '/tmp'))
        temp_dir.mkdir(exist_ok=True)
        
        # Create unique cookie file
        cookie_file = temp_dir / f"test_youtube_cookies_{int(time.time())}.txt"
        
        # Decode and write cookies
        try:
            decoded = base64.b64decode(cookie_content).decode('utf-8')
        except:
            decoded = cookie_content
        
        with open(cookie_file, 'w', encoding='utf-8') as f:
            f.write(decoded)
        
        # Verify file
        if cookie_file.exists():
            file_size = cookie_file.stat().st_size
            print(f"✅ Cookie file created: {cookie_file} ({file_size} bytes)")
            
            # Test readability
            with open(cookie_file, 'r', encoding='utf-8') as f:
                first_line = f.readline().strip()
                if first_line:
                    print(f"✅ File is readable, first line: {first_line[:50]}...")
                else:
                    print("⚠️ File is empty")
            
            # Cleanup
            cookie_file.unlink()
            print("✅ Cookie file cleanup successful")
            return True
        else:
            print("❌ Cookie file was not created")
            return False
            
    except Exception as e:
        print(f"❌ Cookie file creation error: {e}")
        return False

def test_yt_dlp_basic():
    """Test basic yt-dlp functionality without cookies"""
    print_header("Basic yt-dlp Test")
    
    test_url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"  # Short test video
    
    cmd = [
        "yt-dlp",
        "--dump-json",
        "--no-download",
        "--quiet",
        test_url
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            print("✅ Basic yt-dlp test successful")
            return True
        else:
            print(f"❌ Basic yt-dlp test failed: {result.stderr}")
            return False
            
    except subprocess.TimeoutExpired:
        print("⏰ Basic yt-dlp test timed out")
        return False
    except Exception as e:
        print(f"❌ Basic yt-dlp test error: {e}")
        return False

def test_yt_dlp_with_cookies():
    """Test yt-dlp with cookie authentication"""
    print_header("yt-dlp Cookie Authentication Test")
    
    cookie_content = os.environ.get("YOUTUBE_COOKIES_CONTENT")
    if not cookie_content:
        print("❌ YOUTUBE_COOKIES_CONTENT not set")
        return False
    
    test_url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    
    try:
        # Create temporary cookie file
        temp_dir = Path("/tmp") if os.name != 'nt' else Path(os.environ.get('TEMP', '/tmp'))
        cookie_file = temp_dir / f"auth_test_cookies_{int(time.time())}.txt"
        
        # Decode and write cookies
        try:
            decoded = base64.b64decode(cookie_content).decode('utf-8')
        except:
            decoded = cookie_content
        
        with open(cookie_file, 'w', encoding='utf-8') as f:
            f.write(decoded)
        
        # Test with cookies
        cmd = [
            "yt-dlp",
            "--cookies", str(cookie_file),
            "--dump-json",
            "--no-download",
            "--quiet",
            test_url
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        # Cleanup
        if cookie_file.exists():
            cookie_file.unlink()
        
        if result.returncode == 0:
            print("✅ yt-dlp cookie authentication test successful")
            return True
        else:
            print(f"❌ yt-dlp cookie authentication test failed: {result.stderr}")
            
            # Check for specific error patterns
            if "Sign in to confirm" in result.stderr:
                print("🚫 Bot detection error detected - cookies may be invalid or expired")
            elif "cookies" in result.stderr.lower():
                print("🚫 Cookie-related error detected")
            
            return False
            
    except subprocess.TimeoutExpired:
        print("⏰ yt-dlp cookie test timed out")
        return False
    except Exception as e:
        print(f"❌ yt-dlp cookie test error: {e}")
        return False

def test_cloudinary_connection():
    """Test Cloudinary connection"""
    print_header("Cloudinary Connection Test")
    
    try:
        import cloudinary
        import cloudinary.api
        
        cloud_name = os.environ.get("CLOUDINARY_CLOUD_NAME")
        api_key = os.environ.get("CLOUDINARY_API_KEY")
        api_secret = os.environ.get("CLOUDINARY_API_SECRET")
        
        if not all([cloud_name, api_key, api_secret]):
            print("❌ Missing Cloudinary credentials")
            return False
        
        # Configure Cloudinary
        cloudinary.config(
            cloud_name=cloud_name,
            api_key=api_key,
            api_secret=api_secret
        )
        
        # Test connection by listing resources
        try:
            result = cloudinary.api.resources(max_results=1)
            print("✅ Cloudinary connection successful")
            return True
        except Exception as e:
            print(f"❌ Cloudinary API error: {e}")
            return False
            
    except ImportError:
        print("❌ cloudinary package not installed")
        return False
    except Exception as e:
        print(f"❌ Cloudinary test error: {e}")
        return False

def simulate_modal_environment():
    """Simulate the Modal environment for testing"""
    print_header("Modal Environment Simulation")
    
    # Test the same functions that would run in Modal
    try:
        # Simulate cookie validation
        cookie_content = os.environ.get("YOUTUBE_COOKIES_CONTENT")
        if cookie_content:
            print("📋 Testing cookie validation...")
            # This mimics the validate_cookies function from modal/transcribe.py
            try:
                decoded = base64.b64decode(cookie_content).decode('utf-8')
                lines = decoded.strip().split('\n')
                valid_cookies = sum(1 for line in lines 
                                  if line.strip() and not line.startswith('#') 
                                  and len(line.split('\t')) >= 7)
                print(f"✅ Cookie validation: {valid_cookies} valid cookies")
            except Exception as e:
                print(f"❌ Cookie validation failed: {e}")
                return False
        
        # Simulate cookie file creation
        print("📋 Testing cookie file creation...")
        temp_dir = Path("/tmp") if os.name != 'nt' else Path(os.environ.get('TEMP', '/tmp'))
        
        if cookie_content:
            try:
                cookie_file = temp_dir / f"modal_test_cookies_{int(time.time())}.txt"
                
                try:
                    decoded = base64.b64decode(cookie_content).decode('utf-8')
                except:
                    decoded = cookie_content
                
                with open(cookie_file, 'w', encoding='utf-8') as f:
                    f.write(decoded)
                
                if cookie_file.exists():
                    print(f"✅ Modal-style cookie file created: {cookie_file}")
                    cookie_file.unlink()  # Cleanup
                else:
                    print("❌ Modal-style cookie file creation failed")
                    return False
                    
            except Exception as e:
                print(f"❌ Modal cookie file creation error: {e}")
                return False
        
        print("✅ Modal environment simulation successful")
        return True
        
    except Exception as e:
        print(f"❌ Modal simulation error: {e}")
        return False

def generate_report(results: Dict[str, bool]):
    """Generate a comprehensive test report"""
    print_header("TEST RESULTS SUMMARY")
    
    passed = sum(1 for result in results.values() if result)
    total = len(results)
    success_rate = (passed / total) * 100 if total > 0 else 0
    
    print(f"📊 Overall Success Rate: {success_rate:.1f}% ({passed}/{total})")
    print()
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} {test_name}")
    
    print()
    
    if success_rate >= 80:
        print("🎉 Most tests passed! Your YouTube authentication setup looks good.")
    elif success_rate >= 60:
        print("⚠️ Some tests failed. Check the specific failures above.")
    else:
        print("❌ Most tests failed. You need to fix the authentication setup.")
    
    return success_rate >= 80

def main():
    """Main test execution"""
    print("🧪 YouTube Authentication Test Suite")
    print("=" * 60)
    print("This script will test your YouTube authentication setup")
    print("Make sure you have set the YOUTUBE_COOKIES_CONTENT environment variable")
    print()
    
    # Run all tests
    test_results = {}
    
    test_results["Environment Variables"] = all(test_environment_variables().values())
    test_results["Cookie Decoding"] = test_cookie_decoding()
    test_results["Cookie File Creation"] = test_cookie_file_creation()
    test_results["Basic yt-dlp"] = test_yt_dlp_basic()
    test_results["yt-dlp with Cookies"] = test_yt_dlp_with_cookies()
    test_results["Cloudinary Connection"] = test_cloudinary_connection()
    test_results["Modal Environment Simulation"] = simulate_modal_environment()
    
    # Generate final report
    success = generate_report(test_results)
    
    print_header("NEXT STEPS")
    
    if success:
        print("🚀 Your authentication setup is ready!")
        print("You can now deploy the updated Modal worker.")
        print()
        print("To deploy:")
        print("1. Make sure your Modal secrets are updated")
        print("2. Run: modal deploy modal/transcribe.py")
        print("3. Test with a YouTube video")
    else:
        print("🔧 You need to fix the failing tests:")
        print()
        if not test_results["Environment Variables"]:
            print("• Set the YOUTUBE_COOKIES_CONTENT environment variable")
            print("• Update your Modal secrets")
        if not test_results["Cookie Decoding"]:
            print("• Check your cookie format and encoding")
            print("• Run the cookie extraction script again")
        if not test_results["yt-dlp with Cookies"]:
            print("• Your cookies may be expired or invalid")
            print("• Try extracting fresh cookies")
        if not test_results["Cloudinary Connection"]:
            print("• Check your Cloudinary credentials")
            print("• Verify Modal secrets are properly configured")
    
    return success

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)