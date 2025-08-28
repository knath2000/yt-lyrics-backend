import modal
import os
import json
import tempfile
import subprocess
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, Callable, List
import requests
import base64
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware# Modal app definition
app = modal.App("youtube-transcription-v3")

# Modal image with all dependencies
image = (
    modal.Image.debian_slim()
    .pip_install([
        "yt-dlp",
        "faster-whisper",
        "torch",
        "torchaudio",
        "openai",
        "groq",
        "cloudinary",
        "requests",
        "numpy",
        "librosa",
        "soundfile",
        "pydub",
        "ffmpeg-python",
        "fastapi"  # Add FastAPI for web endpoints
    ])
    .apt_install(["ffmpeg", "git"])
).pip_install([
    "yt-dlp",
    "faster-whisper",
    "torch",
    "torchaudio",
    "openai",
    "groq",
    "cloudinary",
    "requests",
    "numpy",
    "librosa",
    "soundfile",
    "pydub",
    "ffmpeg-python",
    "fastapi"  # Add FastAPI for web endpoints
])

def validate_cookies(cookie_content):
    """Validate Netscape cookie format and expiration"""
    lines = cookie_content.strip().split('\n')
    valid_cookies = []
    
    for line in lines:
        if line.strip() and not line.startswith('#'):
            parts = line.split('\t')
            if len(parts) >= 7:
                domain, flag, path, secure, expires, name, value = parts[:7]
                try:
                    expires_ts = int(expires)
                    if expires_ts > time.time():  # Not expired
                        valid_cookies.append(line)
                except ValueError:
                    continue
    
    return '\n'.join(valid_cookies) if valid_cookies else None

def create_cookie_file(cookie_content, temp_path):
    """Create secure temporary cookie file"""
    cookie_file = os.path.join(temp_path, 'youtube_cookies.txt')
    
    with open(cookie_file, 'w') as f:
        f.write(cookie_content)
    
    # Set proper permissions
    os.chmod(cookie_file, 0o600)
    
    return cookie_file

def setup_youtube_authentication(temp_path):
    """Main authentication setup function"""
    try:
        # Get base64 encoded cookies from environment
        b64_cookies = os.getenv('YOUTUBE_COOKIES_B64')
        
        if not b64_cookies:
            print("[Modal] ⚠️ No YOUTUBE_COOKIES_B64 environment variable found")
            return None
        
        # Decode cookies
        try:
            cookie_content = base64.b64decode(b64_cookies).decode('utf-8')
        except Exception as e:
            print(f"[Modal] ❌ Failed to decode cookies: {e}")
            return None
        
        # Validate cookies
        valid_cookies = validate_cookies(cookie_content)
        if not valid_cookies:
            print("[Modal] ❌ No valid cookies found")
            return None
        
        # Create cookie file
        cookie_file = create_cookie_file(valid_cookies, temp_path)
        print(f"[Modal] ✅ Created cookie file: {cookie_file}")
        
        return cookie_file
        
    except Exception as e:
        print(f"[Modal] ❌ Authentication setup failed: {e}")
        return None

def detect_cuda_availability():
    """Detect CUDA and GPU availability with fallback options"""
    try:
        import torch
        if torch.cuda.is_available():
            gpu_count = torch.cuda.device_count()
            gpu_name = torch.cuda.get_device_name(0) if gpu_count > 0 else "Unknown"
            gpu_memory = torch.cuda.get_device_properties(0).total_memory / (1024**3) if gpu_count > 0 else 0
            print(f"[GPU] ✅ CUDA available: {gpu_count} GPU(s), {gpu_name}, {gpu_memory:.1f}GB memory")
            return True, gpu_count, gpu_name
        else:
            print("[GPU] ⚠️ CUDA not available, using CPU fallback")
            return False, 0, "CPU"
    except ImportError:
        print("[GPU] ⚠️ PyTorch not available, using CPU fallback")
        return False, 0, "CPU"
    except Exception as e:
        print(f"[GPU] ⚠️ GPU detection failed: {e}, using CPU fallback")
        return False, 0, "CPU"

def check_cudnn_availability():
    """Check if cuDNN libraries are available"""
    try:
        import ctypes
        # Try to load cuDNN library
        ctypes.CDLL("libcudnn.so.8")  # Try version 8 first
        print("[cuDNN] ✅ cuDNN 8.x available")
        return True
    except OSError:
        try:
            ctypes.CDLL("libcudnn.so.7")  # Try version 7
            print("[cuDNN] ✅ cuDNN 7.x available")
            return True
        except OSError:
            print("[cuDNN] ⚠️ cuDNN not available, GPU acceleration limited")
            return False
    except Exception as e:
        print(f"[cuDNN] ⚠️ cuDNN check failed: {e}")
        return False

def get_optimal_device_and_compute_type():
    """Determine optimal device and compute type based on hardware"""
    cuda_available, gpu_count, gpu_name = detect_cuda_availability()
    cudnn_available = check_cudnn_availability() if cuda_available else False
    
    if cuda_available and cudnn_available:
        # Full GPU acceleration available
        device = "cuda"
        compute_type = "float16"  # Best for modern GPUs with cuDNN
        print(f"[GPU] 🚀 Using GPU acceleration: {gpu_name} with cuDNN")
    elif cuda_available:
        # CUDA available but no cuDNN
        device = "cuda"
        compute_type = "int8"  # Fallback for limited GPU support
        print(f"[GPU] ⚠️ Using GPU acceleration without cuDNN: {gpu_name}")
    else:
        # CPU fallback
        device = "cpu"
        compute_type = "int8"  # Best for CPU performance
        print("[GPU] 💻 Using CPU processing")
    
    return device, compute_type

def chunk_audio_for_groq(audio_path, max_size_mb=20):
    """Split large audio files into Groq-compatible chunks"""
    try:
        from pydub import AudioSegment
        import math
        
        # Get file size in MB
        file_size_mb = audio_path.stat().st_size / (1024 * 1024)
        
        if file_size_mb <= max_size_mb:
            print(f"[Groq] Audio file size ({file_size_mb:.1f}MB) is within limits, no chunking needed")
            return [audio_path]
        
        print(f"[Groq] Audio file size ({file_size_mb:.1f}MB) exceeds limit ({max_size_mb}MB), chunking required")
        
        # Load audio file
        audio = AudioSegment.from_file(str(audio_path))
        duration_ms = len(audio)
        
        # Calculate chunk size (aim for 10-15 minute chunks)
        chunk_duration_ms = 10 * 60 * 1000  # 10 minutes
        num_chunks = math.ceil(duration_ms / chunk_duration_ms)
        
        chunks = []
        temp_dir = audio_path.parent / "groq_chunks"
        temp_dir.mkdir(exist_ok=True)
        
        for i in range(num_chunks):
            start_time = i * chunk_duration_ms
            end_time = min((i + 1) * chunk_duration_ms, duration_ms)
            
            # Extract chunk with small overlap to maintain continuity
            overlap_ms = 1000  # 1 second overlap
            chunk_start = max(0, start_time - overlap_ms)
            chunk_end = min(duration_ms, end_time + overlap_ms)
            
            chunk = audio[chunk_start:chunk_end]
            
            # Export chunk
            chunk_filename = f"chunk_{i:03d}_{start_time//1000}s-{end_time//1000}s.wav"
            chunk_path = temp_dir / chunk_filename
            chunk.export(str(chunk_path), format="wav")
            
            chunks.append(chunk_path)
            print(f"[Groq] Created chunk {i+1}/{num_chunks}: {chunk_path.name} ({len(chunk)/1000:.1f}s)")
        
        return chunks
        
    except ImportError:
        print("[Groq] pydub not available for chunking, falling back to original file")
        return [audio_path]
    except Exception as e:
        print(f"[Groq] Error during chunking: {e}, falling back to original file")
        return [audio_path]

def merge_chunked_transcriptions(chunk_results, original_audio_path):
    """Merge transcription results from multiple chunks"""
    try:
        merged_segments = []
        segment_id_offset = 0
        time_offset = 0
        
        for chunk_idx, chunk_result in enumerate(chunk_results):
            if not chunk_result or 'segments' not in chunk_result:
                continue
                
            for segment in chunk_result['segments']:
                # Adjust segment timing
                adjusted_segment = segment.copy()
                adjusted_segment['id'] = segment_id_offset
                adjusted_segment['start'] += time_offset
                adjusted_segment['end'] += time_offset
                
                # Adjust word timings if available
                if 'words' in adjusted_segment:
                    for word in adjusted_segment['words']:
                        word['start'] += time_offset
                        word['end'] += time_offset
                
                merged_segments.append(adjusted_segment)
                segment_id_offset += 1
            
            # Update time offset for next chunk (with overlap adjustment)
            if chunk_result['segments']:
                last_segment = chunk_result['segments'][-1]
                # Remove overlap (assume 1 second overlap)
                time_offset += last_segment['end'] - 1.0
        
        # Calculate merged result
        merged_result = {
            'segments': merged_segments,
            'language': chunk_results[0].get('language', 'en') if chunk_results else 'en',
            'language_probability': chunk_results[0].get('language_probability', 0.95) if chunk_results else 0.95,
            'duration': sum(chunk.get('duration', 0) for chunk in chunk_results),
            'text': ' '.join(chunk.get('text', '') for chunk in chunk_results if chunk.get('text'))
        }
        
        print(f"[Groq] Merged {len(chunk_results)} chunks into {len(merged_segments)} segments")
        return merged_result
        
    except Exception as e:
        print(f"[Groq] Error merging chunks: {e}")
        # Return first chunk result as fallback
        return chunk_results[0] if chunk_results else None

def safe_gpu_memory_cleanup():
    """Safely clean up GPU memory with error handling"""
    try:
        import torch
        import gc
        
        if torch.cuda.is_available():
            # Clear CUDA cache
            torch.cuda.empty_cache()
            
            # Force garbage collection
            gc.collect()
            
            # Get memory stats
            if torch.cuda.device_count() > 0:
                memory_allocated = torch.cuda.memory_allocated(0) / (1024**2)
                memory_reserved = torch.cuda.memory_reserved(0) / (1024**3)
                print(f"[GPU] 🧹 Memory cleanup: {memory_allocated:.2f}GB allocated, {memory_reserved:.2f}GB reserved")
            else:
                print("[GPU] 🧹 Memory cleanup completed (no GPU)")
        else:
            print("[GPU] 🧹 CPU cleanup completed")
            
    except Exception as e:
        print(f"[GPU] ⚠️ Memory cleanup warning: {e}")

def setup_signal_handlers():
    """Set up signal handlers for graceful shutdown"""
    import signal
    import sys
    
    def signal_handler(signum, frame):
        """Handle termination signals gracefully"""
        signal_name = signal.Signals(signum).name
        print(f"[Signal] Received {signal_name}, initiating graceful shutdown...")
        
        try:
            # Clean up GPU memory
            safe_gpu_memory_cleanup()
            
            # Clean up temporary files
            cleanup_temp_files()
            
            print(f"[Signal] Graceful shutdown completed for {signal_name}")
            
        except Exception as e:
            print(f"[Signal] Error during shutdown: {e}")
        
        # Exit with the signal number
        sys.exit(128 + signum)
    
    # Register signal handlers
    signal.signal(signal.SIGTERM, signal_handler)  # Termination
    signal.signal(signal.SIGINT, signal_handler)   # Interrupt (Ctrl+C)
    signal.signal(signal.SIGHUP, signal_handler)   # Hangup
    
    print("[Signal] ✅ Signal handlers registered for graceful shutdown")

def cleanup_temp_files():
    """Clean up temporary files and directories"""
    try:
        import shutil
        import glob
        
        # Clean up groq_chunks directories
        for temp_dir in glob.glob("**/groq_chunks", recursive=True):
            try:
                shutil.rmtree(temp_dir)
                print(f"[Cleanup] Removed temporary directory: {temp_dir}")
            except Exception as e:
                print(f"[Cleanup] Warning: Could not remove {temp_dir}: {e}")
        
        # Clean up other temporary files
        temp_patterns = [
            "**/audio_from_railway.mp3",
            "**/cached_audio.mp3", 
            "**/downloaded_audio.*",
            "**/vocals.wav",
            "**/temp_*.wav",
            "**/temp_*.mp3"
        ]
        
        for pattern in temp_patterns:
            for temp_file in glob.glob(pattern, recursive=True):
                try:
                    Path(temp_file).unlink()
                    print(f"[Cleanup] Removed temporary file: {temp_file}")
                except Exception as e:
                    print(f"[Cleanup] Warning: Could not remove {temp_file}: {e}")
                    
    except Exception as e:
        print(f"[Cleanup] Error during temp file cleanup: {e}")

def with_error_recovery(func):
    """Decorator for functions with automatic error recovery"""
    def wrapper(*args, **kwargs):
        max_retries = 3
        retry_delay = 1.0
        
        for attempt in range(max_retries):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                if attempt < max_retries - 1:
                    print(f"[Recovery] Attempt {attempt + 1} failed: {e}, retrying in {retry_delay}s...")
                    
                    # Clean up resources before retry
                    safe_gpu_memory_cleanup()
                    
                    # Exponential backoff
                    import time
                    time.sleep(retry_delay)
                    retry_delay *= 2
                else:
                    print(f"[Recovery] All {max_retries} attempts failed: {e}")
                    raise
        
        return None
    
    return wrapper

def monitor_system_resources():
    """Monitor system resources and provide warnings"""
    try:
        import psutil
        import GPUtil
        
        # CPU usage
        cpu_percent = psutil.cpu_percent(interval=1)
        if cpu_percent > 90:
            print(f"[Monitor] ⚠️ High CPU usage: {cpu_percent}%")
        
        # Memory usage
        memory = psutil.virtual_memory()
        memory_percent = memory.percent
        if memory_percent > 90:
            print(f"[Monitor] ⚠️ High memory usage: {memory_percent}% ({memory.used/1024/1024/1024:.1f}GB used)")
        
        # GPU usage (if available)
        try:
            gpus = GPUtil.getGPUs()
            for i, gpu in enumerate(gpus):
                if gpu.memoryUtil * 100 > 90:
                    print(f"[Monitor] ⚠️ High GPU {i} memory usage: {gpu.memoryUtil*100:.1f}%")
                if gpu.load * 100 > 90:
                    print(f"[Monitor] ⚠️ High GPU {i} load: {gpu.load*100:.1f}%")
        except:
            pass  # GPU monitoring not available
            
    except ImportError:
        print("[Monitor] ⚠️ psutil not available for resource monitoring")
    except Exception as e:
        print(f"[Monitor] Resource monitoring error: {e}")

def validate_transcription_result(result):
    """Validate transcription result for completeness and quality"""
    if not result:
        return False, "Result is None or empty"
    
    # Check required fields
    required_fields = ['segments', 'language', 'duration']
    for field in required_fields:
        if field not in result:
            return False, f"Missing required field: {field}"
    
    # Check segments
    if not result['segments']:
        return False, "No segments found in transcription"
    
    # Check segment quality
    total_words = sum(len(segment.get('words', [])) for segment in result['segments'])
    if total_words == 0:
        return False, "No words found in transcription"
    
    # Check duration
    if result['duration'] <= 0:
        return False, f"Invalid duration: {result['duration']}"
    
    return True, f"Valid transcription: {len(result['segments'])} segments, {total_words} words"

def log_transcription_attempt(service, audio_size, gpu_available, success, error=None, duration=None):
    """Log detailed transcription attempt information"""
    import time
    
    log_entry = {
        "timestamp": time.time(),
        "service": service,
        "audio_size_mb": audio_size,
        "gpu_available": gpu_available,
        "success": success,
        "duration_seconds": duration,
        "error": str(error) if error else None
    }
    
    print(f"[Log] 📊 Transcription attempt: {service} | Size: {audio_size:.1f}MB | GPU: {gpu_available} | Success: {success}")
    
    if error:
        print(f"[Log] ❌ Error: {error}")
    
    if duration:
        print(f"[Log] ⏱️ Duration: {duration:.2f}s")
    
    return log_entry

def create_performance_report(start_time, end_time, service_used, audio_size_mb, gpu_available, success):
    """Create detailed performance report"""
    try:
        total_duration = end_time - start_time
        
        report = {
            "timestamp": time.time(),
            "total_duration_seconds": total_duration,
            "service_used": service_used,
            "audio_size_mb": audio_size_mb,
            "gpu_available": gpu_available,
            "success": success,
            "performance_metrics": {
                "processing_speed_mbps": audio_size_mb / total_duration if total_duration > 0 else 0,
                "efficiency_score": calculate_efficiency_score(total_duration, audio_size_mb, gpu_available)
            },
            "system_info": {
                "cpu_count": psutil.cpu_count(),
                "memory_total_gb": psutil.virtual_memory().total / (1024**3),
                "gpu_info": get_gpu_info() if gpu_available else None
            }
        }
        
        print(f"[Performance] 📊 Report: {service_used} | {total_duration:.2f}s | {audio_size_mb:.1f}MB | Success: {success}")
        return report
        
    except Exception as e:
        print(f"[Performance] Error creating report: {e}")
        return None

def calculate_efficiency_score(duration, size_mb, gpu_available):
    """Calculate processing efficiency score (0-100)"""
    try:
        # Base efficiency on processing speed
        speed_mbps = size_mb / duration if duration > 0 else 0
        
        # Expected speeds (rough estimates)
        if gpu_available:
            expected_speed = 50  # MB/s with GPU
        else:
            expected_speed = 10  # MB/s with CPU
        
        # Calculate efficiency as percentage of expected speed
        efficiency = min(100, (speed_mbps / expected_speed) * 100)
        
        return round(efficiency, 1)
        
    except Exception:
        return 0.0

def get_gpu_info():
    """Get detailed GPU information"""
    try:
        import GPUtil
        gpus = GPUtil.getGPUs()
        if gpus:
            gpu = gpus[0]
            return {
                "name": gpu.name,
                "memory_total_mb": gpu.memoryTotal,
                "memory_used_mb": gpu.memoryUsed,
                "memory_free_mb": gpu.memoryFree,
                "memory_utilization_percent": gpu.memoryUtil * 100,
                "gpu_utilization_percent": gpu.load * 100,
                "temperature_celsius": gpu.temperature
            }
    except Exception as e:
        print(f"[GPU] Info collection error: {e}")
    
    return None

def log_system_health():
    """Log comprehensive system health information"""
    try:
        import psutil
        
        health_info = {
            "timestamp": time.time(),
            "cpu": {
                "usage_percent": psutil.cpu_percent(interval=1),
                "count": psutil.cpu_count(),
                "frequency_mhz": psutil.cpu_freq().current if psutil.cpu_freq() else None
            },
            "memory": {
                "total_gb": psutil.virtual_memory().total / (1024**3),
                "available_gb": psutil.virtual_memory().available / (1024**3),
                "used_percent": psutil.virtual_memory().percent
            },
            "disk": {
                "total_gb": psutil.disk_usage('/').total / (1024**3),
                "free_gb": psutil.disk_usage('/').free / (1024**3),
                "used_percent": psutil.disk_usage('/').percent
            },
            "network": {
                "bytes_sent": psutil.net_io_counters().bytes_sent,
                "bytes_recv": psutil.net_io_counters().bytes_recv
            }
        }
        
        # Add GPU info if available
        gpu_info = get_gpu_info()
        if gpu_info:
            health_info["gpu"] = gpu_info
        
        print(f"[Health] 💚 System Status - CPU: {health_info['cpu']['usage_percent']}% | Memory: {health_info['memory']['used_percent']}% | GPU: {'Available' if gpu_info else 'Not available'}")
        
        return health_info
        
    except Exception as e:
        print(f"[Health] Error collecting system health: {e}")
        return None

def with_error_recovery(func):
    """Decorator for functions with automatic error recovery"""
    def wrapper(*args, **kwargs):
        max_retries = 3
        retry_delay = 1.0
        
        for attempt in range(max_retries):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                if attempt < max_retries - 1:
                    print(f"[Recovery] Attempt {attempt + 1} failed: {e}, retrying in {retry_delay}s...")
                    
                    # Clean up resources before retry
                    safe_gpu_memory_cleanup()
                    
                    # Exponential backoff
                    import time
                    time.sleep(retry_delay)
                    retry_delay *= 2
                else:
                    print(f"[Recovery] All {max_retries} attempts failed: {e}")
                    raise
        
        return None
    
    return wrapper

def enhanced_monitoring_wrapper(func):
    """Decorator that adds comprehensive monitoring to transcription functions"""
    def wrapper(*args, **kwargs):
        start_time = time.time()
        
        # Log initial system health
        initial_health = log_system_health()
        
        # Get audio size if available
        audio_size_mb = 0
        if args and hasattr(args[0], 'stat'):
            try:
                audio_size_mb = args[0].stat().st_size / (1024 * 1024)
            except:
                pass
        
        # Check GPU availability
        cuda_available, gpu_count, gpu_name = detect_cuda_availability()
        
        try:
            # Execute the function
            result = func(*args, **kwargs)
            
            end_time = time.time()
            
            # Create performance report
            performance_report = create_performance_report(
                start_time, end_time, func.__name__, 
                audio_size_mb, cuda_available, True
            )
            
            # Log final system health
            final_health = log_system_health()
            
            # Log success
            print(f"[Monitor] ✅ {func.__name__} completed successfully in {end_time - start_time:.2f}s")
            
            return result
            
        except Exception as e:
            end_time = time.time()
            
            # Log failure
            log_transcription_attempt(
                func.__name__, audio_size_mb, cuda_available, 
                False, str(e), end_time - start_time
            )
            
            print(f"[Monitor] ❌ {func.__name__} failed after {end_time - start_time:.2f}s: {e}")
            raise
    
    return wrapper

def setup_youtube_authentication(temp_path):
    """Main authentication setup function with enhanced error recovery"""
    try:
        # Get base64 encoded cookies from environment
        b64_cookies = os.getenv('YOUTUBE_COOKIES_B64')
        
        if not b64_cookies:
            print("[Modal] ⚠️ No YOUTUBE_COOKIES_B64 environment variable found")
            return None
        
        # Decode cookies
        try:
            cookie_content = base64.b64decode(b64_cookies).decode('utf-8')
        except Exception as e:
            print(f"[Modal] ❌ Failed to decode cookies: {e}")
            return None
        
        # Validate cookies
        valid_cookies = validate_cookies(cookie_content)
        if not valid_cookies:
            print("[Modal] ❌ No valid cookies found")
            return None
        
        # Create cookie file
        cookie_file = create_cookie_file(valid_cookies, temp_path)
        print(f"[Modal] ✅ Created cookie file: {cookie_file}")
        
        return cookie_file
        
    except Exception as e:
        print(f"[Modal] ❌ Authentication setup failed: {e}")
        return None

def validate_cookies(cookie_content: str) -> bool:
    """Validate cookie format and content"""
    if not cookie_content or len(cookie_content.strip()) == 0:
        print("[Modal] ERROR: Empty or None cookie content")
        return False
    
    # Check if it's a valid Netscape cookie format
    lines = cookie_content.strip().split('\n')
    valid_lines = 0
    
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        
        # Netscape format: domain, flag, path, secure, expiration, name, value
        parts = line.split('\t')
        if len(parts) >= 7:
            try:
                # Check if expiration is a valid timestamp
                expiration = int(parts[4])
                if expiration > 0:  # Not expired
                    valid_lines += 1
            except ValueError:
                continue
    
    if valid_lines == 0:
        print("[Modal] ERROR: No valid cookies found in content")
        return False
    
    print(f"[Modal] Cookie validation successful: {valid_lines} valid cookie(s) found")
    return True

def decode_cookie_content(cookie_content: str) -> str:
    """Decode cookie content, handling both plain text and base64"""
    if not cookie_content:
        return ""
    
    # Try base64 decoding first
    try:
        decoded = base64.b64decode(cookie_content).decode('utf-8')
        print(f"[Modal] Successfully decoded base64 cookies, length: {len(decoded)}")
        return decoded
    except Exception as e:
        print(f"[Modal] Base64 decode failed ({e}), treating as plain text")
        return cookie_content

def create_cookie_file(cookie_content: str, temp_path: Path) -> Optional[str]:
    """Create cookie file with comprehensive error handling"""
    try:
        # Validate input
        if not cookie_content:
            print("[Modal] ERROR: No cookie content provided")
            return None
        
        # Decode cookies
        decoded_cookies = decode_cookie_content(cookie_content)
        
        # Validate cookie format
        if not validate_cookies(decoded_cookies):
            print("[Modal] ERROR: Cookie validation failed")
            return None
        
        # Create unique cookie file name to avoid conflicts
        cookie_file = temp_path / f"youtube_cookies_{os.getpid()}_{int(time.time())}.txt"
        
        # Write cookie file
        with open(cookie_file, 'w', encoding='utf-8') as f:
            f.write(decoded_cookies)
        
        # Verify file was created and is readable
        if not cookie_file.exists():
            print("[Modal] ERROR: Cookie file was not created")
            return None
        
        file_size = cookie_file.stat().st_size
        if file_size == 0:
            print("[Modal] ERROR: Cookie file is empty")
            return None
        
        # Set proper permissions (readable by owner only)
        cookie_file.chmod(0o600)
        
        print(f"[Modal] ✅ Cookie file created successfully: {cookie_file} ({file_size} bytes)")
        
        # Test file readability
        try:
            with open(cookie_file, 'r', encoding='utf-8') as f:
                first_line = f.readline().strip()
                if first_line:
                    print(f"[Modal] First cookie line: {first_line[:50]}...")
        except Exception as e:
            print(f"[Modal] ERROR: Cannot read cookie file: {e}")
            return None
        
        return str(cookie_file)
        
    except Exception as e:
        print(f"[Modal] ERROR: Failed to create cookie file: {e}")
        import traceback
        traceback.print_exc()
        return None

def cleanup_cookie_file(cookie_file_path: Optional[str]):
    """Safely cleanup cookie file"""
    if cookie_file_path and os.path.exists(cookie_file_path):
        try:
            os.unlink(cookie_file_path)
            print(f"[Modal] ✅ Cookie file cleaned up: {cookie_file_path}")
        except Exception as e:
            print(f"[Modal] WARNING: Failed to cleanup cookie file {cookie_file_path}: {e}")

def setup_cookie_authentication(temp_path: Path) -> Optional[str]:
    """Enhanced YouTube authentication setup with multiple methods"""
    
    print("[Modal] 🔐 Setting up YouTube authentication...")
    
    # Method 1: Environment variable cookies
    cookie_content = os.environ.get("YOUTUBE_COOKIES_CONTENT")
    if cookie_content:
        print("[Modal] 📋 Found YOUTUBE_COOKIES_CONTENT environment variable")
        cookie_file = create_cookie_file(cookie_content, temp_path)
        if cookie_file:
            print("[Modal] ✅ Cookie authentication setup successful")
            return cookie_file
        else:
            print("[Modal] ❌ Cookie file creation failed")
    
    # Method 2: Check for existing cookie file (fallback)
    existing_cookie_files = list(temp_path.glob("youtube_cookies*.txt"))
    if existing_cookie_files:
        cookie_file = str(existing_cookie_files[0])
        print(f"[Modal] 📋 Using existing cookie file: {cookie_file}")
        return cookie_file
    
    print("[Modal] ⚠️ No authentication method available")
    return None

def setup_oauth_authentication(credentials) -> Optional[str]:
    """Set up OAuth-based authentication for YouTube"""
    print("[Modal] Setting up OAuth authentication...")
    
    try:
        # This is a placeholder for OAuth implementation
        # In a real implementation, you would:
        # 1. Use the Google API client to authenticate
        # 2. Get access tokens
        # 3. Use authenticated requests for downloads
        
        print("[Modal] ⚠️ OAuth implementation not yet available")
        print("[Modal] This would require Google API credentials and YouTube Data API setup")
        return None
        
    except Exception as e:
        print(f"[Modal] OAuth setup error: {e}")
        return None

def download_with_authenticated_request(video_url: str, credentials) -> Optional[Path]:
    """Download video using authenticated HTTP requests"""
    print("[Modal] Attempting authenticated download...")
    
    try:
        # This is a placeholder for authenticated download
        # In a real implementation, you would:
        # 1. Use OAuth credentials to get access tokens
        # 2. Make authenticated requests to YouTube
        # 3. Handle streaming downloads
        
        print("[Modal] ⚠️ Authenticated download not yet implemented")
        return None
        
    except Exception as e:
        print(f"[Modal] Authenticated download error: {e}")
        return None

def setup_browser_automation_authentication() -> Optional[str]:
    """Set up browser automation for authentication"""
    print("[Modal] Setting up browser automation authentication...")
    
    try:
        # This would require Selenium or Playwright in Modal
        # For now, this is a placeholder
        
        print("[Modal] ⚠️ Browser automation not available in Modal environment")
        print("[Modal] This would require additional dependencies and browser setup")
        return None
        
    except Exception as e:
        print(f"[Modal] Browser automation setup error: {e}")
        return None

def select_optimal_transcription_service(audio_path):
    """Intelligently select the best transcription service based on audio characteristics"""
    try:
        # Get audio file size
        file_size_mb = audio_path.stat().st_size / (1024 * 1024)
        
        # Check GPU availability
        cuda_available, gpu_count, gpu_name = detect_cuda_availability()
        
        # Check API keys availability
        groq_key = os.environ.get("GROQ_API_KEY")
        openai_key = os.environ.get("OPENAI_API_KEY")
        
        # Decision matrix
        services = []
        
        # Groq (fastest, but size limited)
        if groq_key and file_size_mb <= 20:
            services.append({
                "name": "groq",
                "priority": 1,
                "reason": f"Fastest option, file size ({file_size_mb:.1f}MB) within limits"
            })
        
        # Faster-Whisper GPU (fast with GPU)
        if cuda_available:
            services.append({
                "name": "faster_whisper_gpu",
                "priority": 2,
                "reason": f"GPU acceleration available ({gpu_name})"
            })
        
        # OpenAI Whisper (reliable, size limited)
        if openai_key and file_size_mb <= 25:
            services.append({
                "name": "openai_whisper",
                "priority": 3,
                "reason": "Reliable cloud service"
            })
        
        # Faster-Whisper CPU (always available)
        services.append({
            "name": "faster_whisper_cpu",
            "priority": 4,
            "reason": "CPU fallback, always available"
        })
        
        # Sort by priority
        services.sort(key=lambda x: x['priority'])
        
        selected_service = services[0]
        print(f"[Selection] 🎯 Selected {selected_service['name']} - {selected_service['reason']}")
        
        return selected_service['name'], services
        
    except Exception as e:
        print(f"[Selection] Error in service selection: {e}, using CPU fallback")
        return "faster_whisper_cpu", []

def transcribe_with_openai_whisper(audio_path: Path, api_key: str) -> Dict[str, Any]:
    """Fallback transcription using OpenAI Whisper API"""
    try:
        from openai import OpenAI
        
        client = OpenAI(api_key=api_key)
        
        print(f"Transcribing with OpenAI Whisper: {audio_path}")
        
        # Read audio file
        with open(audio_path, "rb") as file:
            transcription = client.audio.transcriptions.create(
                file=(audio_path.name, file.read()),
                model="whisper-1",
                response_format="verbose_json",
                timestamp_granularities=["word"]
            )
        
        # Convert OpenAI response to our expected format
        segments = []
        words = getattr(transcription, 'words', [])
        
        if words:
            current_segment = []
            segment_start = None
            segment_id = 0
            
            for i, word_data in enumerate(words):
                if isinstance(word_data, dict):
                    word_text = word_data.get('word', '')
                    word_start = word_data.get('start', 0)
                    word_end = word_data.get('end', 0)
                else:
                    word_text = getattr(word_data, 'word', '')
                    word_start = getattr(word_data, 'start', 0)
                    word_end = getattr(word_data, 'end', 0)
                
                if segment_start is None:
                    segment_start = word_start
                
                current_segment.append({
                    'word': word_text,
                    'start': word_start,
                    'end': word_end
                })
                
                if len(current_segment) >= 10 or i == len(words) - 1:
                    segment_text = " ".join([w['word'] for w in current_segment])
                    segment_end = current_segment[-1]['end']
                    
                    segments.append({
                        "id": segment_id,
                        "start": segment_start,
                        "end": segment_end,
                        "text": segment_text,
                        "words": [
                            {
                                "word": w['word'],
                                "start": w['start'],
                                "end": w['end'],
                                "probability": 0.9
                            } for w in current_segment
                        ]
                    })
                    
                    current_segment = []
                    segment_start = None
                    segment_id += 1
        
        duration = words[-1]['end'] if words else 0
        
        result = {
            "segments": segments,
            "language": getattr(transcription, 'language', 'en'),
            "language_probability": 0.95,
            "duration": duration,
            "text": getattr(transcription, 'text', '')
        }
        
        print(f"OpenAI Whisper transcription completed: {len(segments)} segments")
        return result
        
    except Exception as e:
        print(f"OpenAI Whisper transcription error: {e}")
        raise

def transcribe_with_fallback_chain(audio_path: Path) -> Dict[str, Any]:
    """Multi-tier transcription with automatic fallback"""
    import time
    
    start_time = time.time()
    
    # Get audio file size for logging
    file_size_mb = audio_path.stat().st_size / (1024 * 1024)
    
    # Check GPU availability
    cuda_available, gpu_count, gpu_name = detect_cuda_availability()
    
    # Select optimal service
    selected_service, available_services = select_optimal_transcription_service(audio_path)
    
    # Define fallback chain
    fallback_chain = [
        ("groq", lambda: transcribe_with_groq(audio_path, os.environ.get("GROQ_API_KEY"))),
        ("faster_whisper_gpu", lambda: transcribe_with_faster_whisper(audio_path)),
        ("openai_whisper", lambda: transcribe_with_openai_whisper(audio_path, os.environ.get("OPENAI_API_KEY"))),
        ("faster_whisper_cpu", lambda: transcribe_with_faster_whisper(audio_path, "large-v3"))  # Force CPU
    ]
    
    # Try services in order
    transcription_result = None
    used_service = None
    
    for service_name, service_func in fallback_chain:
        if service_name == selected_service or transcription_result is None:
            try:
                print(f"[Fallback] 🔄 Attempt Attempt {service_name}...")
                
                attempt_start = time.time()
                transcription_result = service_func()
                attempt_duration = time.time() - attempt_start
                
                # Validate result
                is_valid, validation_msg = validate_transcription_result(transcription_result)
                
                if is_valid:
                    used_service = service_name
                    print(f"[Fallback] ✅ {service_name} succeeded in {attempt_duration:.2f}s")
                    
                    # Log successful attempt
                    log_transcription_attempt(
                        service_name, file_size_mb, cuda_available, 
                        True, None, attempt_duration
                    )
                    
                    break
                else:
                    print(f"[Fallback] ⚠️ {service_name} produced invalid result: {validation_msg}")
                    
                    # Log failed attempt
                    log_transcription_attempt(
                        service_name, file_size_mb, cuda_available, 
                        False, validation_msg, attempt_duration
                    )
                    
            except Exception as e:
                attempt_duration = time.time() - attempt_start
                error_msg = str(e)
                print(f"[Fallback] ❌ {service_name} failed: {error_msg}")
                
                # Log failed attempt
                log_transcription_attempt(
                    service_name, file_size_mb, cuda_available, 
                    False, error_msg, attempt_duration
                )
                
                # Clean up on failure
                safe_gpu_memory_cleanup()
                continue
    
    if transcription_result and used_service:
        total_duration = time.time() - start_time
        print(f"[Fallback] 🎉 Transcription completed with {used_service} in {total_duration:.2f}s")
        return transcription_result
    else:
        raise Exception("All transcription services failed")

def enhanced_transcription_orchestrator(audio_path: Path) -> Dict[str, Any]:
    """Enhanced transcription orchestrator with comprehensive error handling"""
    try:
        # Setup signal handlers for graceful shutdown
        setup_signal_handlers()
        
        # Monitor system resources
        monitor_system_resources()
        
        # Use the fallback chain for transcription
        result = transcribe_with_fallback_chain(audio_path)
        
        # Validate final result
        is_valid, validation_msg = validate_transcription_result(result)
        if not is_valid:
            raise Exception(f"Final transcription result validation failed: {validation_msg}")
        
        # Clean up resources
        safe_gpu_memory_cleanup()
        cleanup_temp_files()
        
        return result
        
    except Exception as e:
        print(f"[Orchestrator] ❌ Transcription orchestrator failed: {e}")
        
        # Final cleanup
        safe_gpu_memory_cleanup()
        cleanup_temp_files()
        
        raise


# Web endpoint function for Modal
@app.function(
    image=image,
    timeout=1800,
    memory=4096,
    gpu="A10G"
)
@modal.fastapi_endpoint()
def web_endpoint():
    """Web endpoint function that exposes the FastAPI app"""
    return web_app
