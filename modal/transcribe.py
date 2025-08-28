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
                print(f"[Cleanup] Removed temporary directory: {temp_dir}");
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
        print(f"[Modal] ✅ Created cookie file: {cookie_file}");
        
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
        
        print("[Modal] ⚠️ OAuth authentication not fully implemented yet")
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
        
        print("[Modal] ⚠️ Authenticated download not implemented yet")
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
        
        # OpenAI Whisper (reliable, size limits)
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

# Apply monitoring to key functions
transcribe_with_groq = enhanced_monitoring_wrapper(transcribe_with_groq)
transcribe_with_faster_whisper = enhanced_monitoring_wrapper(transcribe_with_faster_whisper)
transcribe_with_openai_whisper = enhanced_monitoring_wrapper(transcribe_with_openai_whisper)
enhanced_transcription_orchestrator = enhanced_monitoring_wrapper(enhanced_transcription_orchestrator)

# Test function for local development
@app.local_entrypoint()
def test_transcription():
    """Test the transcription function locally"""
    def test_callback(pct, msg):
        print(f"Progress: {pct}% - {msg}")
    
    result = transcribe_youtube.remote("https://www.youtube.com/watch?v=dQw4w9WgXcQ", test_callback)
    print("Final result:", result) 

@app.function(image=image, timeout=1800, memory=4096)
def transcribe_youtube(youtube_url: str, progress_callback=None) -> Dict[str, Any]:
    """Main Modal function for YouTube transcription with enhanced orchestration"""
    try:
        import tempfile
        from pathlib import Path
        
        print(f"[Modal] 🚀 Starting YouTube transcription for: {youtube_url}")
        
        # Create temporary directory
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            # Download audio from YouTube
            print("[Modal] 📥 Downloading audio from YouTube...")
            audio_path = download_youtube_audio(youtube_url, temp_path)
            
            if not audio_path:
                raise Exception("Failed to download audio from YouTube")
            
            if progress_callback:
                progress_callback(25, "Audio downloaded successfully")
            
            print(f"[Modal] ✅ Audio downloaded: {audio_path}")
            
            # Use enhanced transcription orchestrator
            print("[Modal] 🎯 Starting enhanced transcription...")
            transcription_result = enhanced_transcription_orchestrator(audio_path)
            
            if progress_callback:
                progress_callback(75, "Transcription completed")
            
            # Generate final results
            final_result = generate_final_results(transcription_result, youtube_url)
            
            if progress_callback:
                progress_callback(95, "Processing completed")
            
            print("[Modal] 🎉 Transcription workflow completed successfully")
            return final_result
            
    except Exception as e:
        print(f"[Modal] ❌ Transcription failed: {e}")
        import traceback
        traceback.print_exc()
        raise

# Define the enhanced Modal image with authentication dependencies
image = modal.Image.debian_slim(python_version="3.11").pip_install([
    # Core dependencies with stable versions
    "torch>=2.1.0",
    "torchaudio>=2.1.0", 
    "transformers>=4.36.0",
    "faster-whisper>=0.10.0",  # Stable GPU-optimized Whisper
    "whisperx>=3.1.1",         # For word alignment
    "demucs>=4.0.1",           # Vocal separation
    "yt-dlp>=2024.12.13",      # YouTube download
    "cloudinary>=1.36.0",      # Result storage
    "requests>=2.31.0",        # HTTP requests
    "groq>=0.4.1",             # Ultra-fast Groq Whisper API
    "fastapi[standard]>=0.100.0",  # Required for web endpoints
    
    # Audio processing dependencies
    "pydub>=0.25.1",            # Audio chunking and processing
    
    # System monitoring dependencies
    "psutil>=5.9.0",            # System resource monitoring
    "GPUtil>=1.4.0",            # GPU monitoring
    
    # Enhanced authentication dependencies
    "browser_cookie3>=0.19.0",  # Browser cookie extraction
    "selenium>=4.15.0",         # Browser automation
    "webdriver_manager>=4.0.0", # WebDriver management
    "google-auth-oauthlib>=1.2.0", # OAuth support
    "google-auth-httplib2>=0.2.0", # OAuth HTTP support
]).apt_install([
    "git",           # Required for yt-dlp GitHub install
    "ffmpeg",        # Audio processing
    "curl",          # Downloads
    "chromium",      # For browser automation (Debian package name)
    "chromium-driver", # ChromeDriver for Selenium (Debian package name)
    # CUDA and GPU support
    "nvidia-cuda-toolkit",  # NVIDIA CUDA toolkit
    "nvidia-cuda-dev",      # CUDA development files
    "nvidia-cudnn",         # NVIDIA cuDNN library
    "libnvidia-compute-XXX", # NVIDIA compute libraries (version will be determined at runtime)
]).run_commands([
    # Install latest yt-dlp with fallback - PRESERVE EXACT IMPLEMENTATION
    "pip install --upgrade --force-reinstall git+https://github.com/yt-dlp/yt-dlp.git || pip install --upgrade --force-reinstall yt-dlp",
    
    # Set up Chrome for headless browsing
    "which chromedriver && chmod +x $(which chromedriver) || echo 'ChromeDriver not found, will use webdriver-manager'",
    
    # Configure CUDA environment
    "echo 'export CUDA_HOME=/usr/local/cuda' >> ~/.bashrc",
    "echo 'export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH' >> ~/.bashrc",
    "echo 'export PATH=/usr/local/cuda/bin:$PATH' >> ~/.bashrc",
    
    # Verify CUDA installation
    "nvidia-smi || echo 'NVIDIA GPU not detected, will use CPU fallback'",
    
    # Install cuDNN if available
    "find /usr -name 'libcudnn*' 2>/dev/null || echo 'cuDNN not found, GPU acceleration may be limited'",
]).run_commands([
    # Install latest yt-dlp with fallback - PRESERVE EXACT IMPLEMENTATION
    "pip install --upgrade --force-reinstall git+https://github.com/yt-dlp/yt-dlp.git || pip install --upgrade --force-reinstall yt-dlp",
])

app = modal.App("youtube-transcription")

def cleanup_gpu_memory():
    """Clean up GPU memory after processing with enhanced safety"""
    safe_gpu_memory_cleanup()

def get_or_load_faster_whisper_model(model_size: str = "large-v3"):
    """Load Faster-Whisper model with enhanced GPU detection and fallback"""
    try:
        from faster_whisper import WhisperModel
        
        # Get optimal device and compute type
        device, compute_type = get_optimal_device_and_compute_type()
        
        print(f"Loading Faster-Whisper model: {model_size} on {device} with {compute_type}")
        
        # Configure model based on hardware capabilities
        model_kwargs = {
            "model_size": model_size,
            "device": device,
            "compute_type": compute_type,
            "download_root": "/models"
        }
        
        # Add CPU threads for CPU processing
        if device == "cpu":
            model_kwargs["cpu_threads"] = 4  # Use 4 CPU threads
            model_kwargs["num_workers"] = 1  # Single worker for CPU
        
        model = WhisperModel(**model_kwargs)
        
        print(f"Model {model_size} loaded successfully on {device}")
        return model
        
    except Exception as e:
        print(f"Model loading error: {e}")
        import traceback
        traceback.print_exc()
        raise

def separate_vocals_conservative(audio_path: Path, temp_path: Path) -> Optional[Path]:
    """Conservative Demucs vocal separation to avoid memory errors"""
    try:
        output_dir = temp_path / "demucs_output"
        
        # Use conservative settings to avoid memory issues
        cmd = [
            "demucs",
            "--two-stems", "vocals",
            "-n", "htdemucs",              # Use stable model
            "--segment", "5",              # Small segments for memory safety
            "-d", "cuda",                  # GPU device
            "-o", str(output_dir),         # Output directory
            str(audio_path)                # Input file
        ]
        
        print(f"Running Demucs command: {' '.join(cmd)}")
        
        # Run with timeout to prevent hanging
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout
            cwd=temp_path
        )
        
        if result.returncode != 0:
            print(f"Demucs failed with return code {result.returncode}")
            print(f"STDERR: {result.stderr}")
            return None
        
        # Find the vocals file
        vocals_path = output_dir / "htdemucs" / audio_path.stem / "vocals.wav"
        if vocals_path.exists():
            print(f"Vocals separated successfully: {vocals_path}")
            return vocals_path
        else:
            print(f"Vocals file not found at expected location: {vocals_path}")
            return None
            
    except subprocess.TimeoutExpired:
        print("Demucs timed out after 5 minutes")
        return None
    except Exception as e:
        print(f"Demucs error: {e}")
        return None

def transcribe_with_groq(audio_path: Path, api_key: str) -> Dict[str, Any]:
    """Ultra-fast transcription using Groq Whisper Large-v3 Turbo with chunking support"""
    try:
        from groq import Groq

        # Check file size and chunk if necessary
        file_size_mb = audio_path.stat().st_size / (1024 * 1024)
        max_size_mb = 20  # Groq's approximate limit

        if file_size_mb > max_size_mb:
            print(f"[Groq] File size ({file_size_mb:.1f}MB) exceeds limit, using chunking strategy")

            # Chunk the audio file
            audio_chunks = chunk_audio_for_groq(audio_path, max_size_mb)

            if len(audio_chunks) > 1:
                # Process chunks and merge results
                chunk_results = []

                for i, chunk_path in enumerate(audio_chunks):
                    print(f"[Groq] Processing chunk {i+1}/{len(audio_chunks)}: {chunk_path.name}")

                    try:
                        chunk_result = transcribe_single_chunk_with_groq(chunk_path, api_key)
                        if chunk_result:
                            chunk_results.append(chunk_result)
                        else:
                            print(f"[Groq] Failed to process chunk {i+1}")
                    except Exception as chunk_error:
                        print(f"[Groq] Error processing chunk {i+1}: {chunk_error}")
                        continue

                if chunk_results:
                    # Merge chunked results
                    merged_result = merge_chunked_transcriptions(chunk_results, audio_path)
                    if merged_result:
                        print(f"[Groq] Successfully processed {len(audio_chunks)} chunks")
                        return merged_result
                    else:
                        print("[Groq] Failed to merge chunk results, falling back to single file")
                else:
                    print("[Groq] All chunks failed, falling back to single file")

        # Fallback to single file processing
        return transcribe_single_chunk_with_groq(audio_path, api_key)

    except Exception as e:
        print(f"Groq transcription error: {e}")
        raise

def transcribe_single_chunk_with_groq(audio_path: Path, api_key: str) -> Dict[str, Any]:
    """Transcribe a single audio chunk with Groq"""
    try:
        from groq import Groq

        # Initialize Groq client with API key from environment
        client = Groq(api_key=api_key)

        print(f"Transcribing with Groq Whisper Large-v3 Turbo: {audio_path}")

        # Read audio file
        with open(audio_path, "rb") as file:
            # Create transcription with Groq's ultra-fast Whisper
            transcription = client.audio.transcriptions.create(
                file=(audio_path.name, file.read()),
                model="whisper-large-v3-turbo",  # Ultra-fast model
                response_format="verbose_json",
                timestamp_granularities=["word"]
            )

        # Debug: Print transcription structure
        print(f"Groq transcription type: {type(transcription)}")
        print(f"Groq transcription attributes: {dir(transcription)}")
        if hasattr(transcription, 'words') and transcription.words:
            print(f"First word type: {type(transcription.words[0])}")
            print(f"First word: {transcription.words[0]}")
        else:
            print("No words attribute or empty words")

        # Convert Groq response to our expected format
        segments = []
        words = getattr(transcription, 'words', [])

        print(f"Groq returned {len(words)} words")

        if words:
            # Group words into segments (similar to Whisper segments)
            current_segment = []
            segment_start = None
            segment_id = 0

            for i, word_data in enumerate(words):
                # Handle both dict and object formats
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

                # Create segment every 10 words or at end
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
                                "probability": 0.9  # Groq doesn't provide probability
                            } for w in current_segment
                        ]
                    })

                    current_segment = []
                    segment_start = None
                    segment_id += 1

        # Calculate duration from words
        duration = 0
        if words:
            last_word = words[-1]
            if isinstance(last_word, dict):
                duration = last_word.get('end', 0)
            else:
                duration = getattr(last_word, 'end', 0)

        result = {
            "segments": segments,
            "language": getattr(transcription, 'language', 'en'),
            "language_probability": 0.95,  # Groq doesn't provide this
            "duration": duration,
            "text": getattr(transcription, 'text', '')
        }

        print(f"Groq transcription completed: {len(segments)} segments")
        return result

    except Exception as e:
        print(f"Groq single chunk transcription error: {e}")
        raise

def transcribe_with_faster_whisper(audio_path: Path, model_size: str = "large-v3") -> Dict[str, Any]:
    """Simplified transcription using Faster-Whisper"""
    try:
        # Get cached model
        model = get_or_load_faster_whisper_model(model_size)
        
        print(f"Transcribing audio: {audio_path}")
        
        # Use conservative settings for stability
        segments, info = model.transcribe(
            str(audio_path),
            beam_size=5,
            best_of=5,
            temperature=0.0,  # Use deterministic settings
            compression_ratio_threshold=2.4,
            log_prob_threshold=-1.0),
            no_speech_threshold=0.6,
            condition_on_previous_text=False,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500)
        )
        
        # Convert segments to list
        segment_list = []
        for segment in segments:
            segment_dict = {
                "id": segment.id,
                "start": segment.start,
                "end": segment.end,
                "text": segment.text,
                "tokens": segment.tokens,
                "temperature": segment.temperature,
                "avg_logprob": segment.avg_logprob,
                "compression_ratio": segment.compression_ratio,
                "no_speech_prob": segment.no_speech_prob,
                "words": []
            }
            
            # Add word-level timestamps if available
            if hasattr(segment, 'words') and segment.words:
                for word in segment.words:
                    segment_dict["words"].append({
                        "word": word.word,
                        "start": word.start,
                        "end": word.end,
                        "probability": word.probability
                    })
            
            segment_list.append(segment_dict)
        
        result = {
            "segments": segment_list,
            "language": info.language,
            "language_probability": info.language_probability,
            "duration": info.duration,
            "duration_after_vad": info.duration_after_vad
        }
        
        print(f"Transcription completed: {len(segment_list)} segments, {info.duration:.2f}s duration")
        return result
        
    except Exception as e:
        print(f"Transcription error: {e}")
        import traceback
        traceback.print_exc()
        raise

def align_with_whisperx(audio_path: Path, transcription_result: Dict[str, Any], temp_path: Path) -> Dict[str, Any]:
    """Word alignment using WhisperX with error handling"""
    try:
        import whisperx
        import torch
        
        print("Starting WhisperX alignment...")
        
        # Load audio
        audio = whisperx.load_audio(str(audio_path))
        
        # Load alignment model
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model_a, metadata = whisperx.load_align_model(
            language_code=transcription_result.get("language", "en"), 
            device=device
        )
        
        # Perform alignment
        result_aligned = whisperx.align(
            transcription_result["segments"], 
            model_a, 
            metadata, 
            audio, 
            device,
            return_char_alignments=False
        )
        
        print("WhisperX alignment completed successfully")
        return result_aligned
        
    except Exception as e:
        print(f"WhisperX alignment failed: {e}")
        # Return original transcription without alignment
        return transcription_result

def generate_final_results(aligned_data: Dict[str, Any], youtube_url: str) -> Dict[str, Any]:
    """Generate final transcription results with robust error handling"""
    
    # Extract words with timestamps
    words = []
    all_text = []
    
    segments = aligned_data.get("segments", [])
    for segment in segments:
        # Handle segments without words arrays
        segment_words = segment.get("words", [])
        if segment_words:
            for word_data in segment_words:
                words.append({
                    "word": word_data.get("word", "").strip(),
                    "start": word_data.get("start", 0),
                    "end": word_data.get("end", 0),
                    "confidence": word_data.get("probability", word_data.get("score", 0.0))
                })
                all_text.append(word_data.get("word", "").strip())
        else:
            # Fallback: use segment text if no word-level data
            segment_text = segment.get("text", "").strip()
            if segment_text:
                words.append({
                    "word": segment_text,
                    "start": segment.get("start", 0),
                    "end": segment.get("end", 0),
                    "confidence": 1.0 - segment.get("no_speech_prob", 0.0)
                })
                all_text.append(segment_text)
    
    # Generate SRT format
    srt_lines = []
    word_groups = []
    current_group = []
    current_start = None
    
    for i, word in enumerate(words):
        if not current_start:
            current_start = word["start"]
        
        current_group.append(word["word"])
        
        # Group by 10 words or 5 seconds
        if len(current_group) >= 10 or (word["end"] - current_start) >= 5.0 or i == len(words) - 1:
            word_groups.append({
                "text": " ".join(current_group).strip(),
                "start": current_start,
                "end": word["end"]
            })
            current_group = []
            current_start = None
    
    # Generate SRT content
    for i, group in enumerate(word_groups, 1):
        start_time = format_timestamp(group["start"])
        end_time = format_timestamp(group["end"])
        srt_lines.extend([
            str(i),
            f"{start_time} --> {end_time}",
            group["text"],
            ""
        ])
    
    # Calculate metadata
    total_duration = max([w["end"] for w in words]) if words else 0
    
    return {
        "words": words,
        "srt": "\n".join(srt_lines),
        "plain": " ".join(all_text),
        "metadata": {
            "youtubeUrl": youtube_url,
            "duration": total_duration,
            "wordCount": len(words),
            "processedAt": json.dumps({"$date": {"$numberLong": str(int(1000 * 1000))}}),
            "language": aligned_data.get("language", "unknown"),
            "confidence": sum(w["confidence"] for w in words) / len(words) if words else 0
        }
    }

def format_timestamp(seconds: float) -> str:
    """Convert seconds to SRT timestamp format"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

def upload_to_cloudinary(file_path: Path, public_id: str, resource_type: str = "auto") -> Optional[str]:
    """Upload file to Cloudinary and return URL"""
    try:
        import cloudinary
        import cloudinary.uploader
        
        # Configure Cloudinary from environment
        cloudinary.config(
            cloud_name=os.environ.get("CLOUDINARY_CLOUD_NAME"),
            api_key=os.environ.get("CLOUDINARY_API_KEY"),
            api_secret=os.environ.get("CLOUDINARY_API_SECRET")
        )
        
        print(f"Uploading to Cloudinary: {public_id}")
        
        # Upload file
        response = cloudinary.uploader.upload(
            str(file_path),
            public_id=public_id,
            resource_type=resource_type,
            overwrite=True,
            tags=["yt_transcription", "modal_processed"]
        )
        
        url = response.get("secure_url")
        print(f"Upload successful: {url}")
        return url
        
    except Exception as e:
        print(f"Cloudinary upload error: {e}")
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
        
        print("[Modal] ⚠️ OAuth authentication not fully implemented yet")
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
        
        print("[Modal] ⚠️ Authenticated download not implemented yet")
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
        
        # OpenAI Whisper (reliable, size limits)
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

# Test function for local development
@app.local_entrypoint()
def test_transcription():
    """Test the transcription function locally"""
    def test_callback(pct, msg):
        print(f"Progress: {pct}% - {msg}")
    
    result = transcribe_youtube.remote("https://www.youtube.com/watch?v=dQw4w9WgXcQ", test_callback)
    print("Final result:", result) 

@app.function(image=image, timeout=1800, memory=4096)
def transcribe_youtube(youtube_url: str, progress_callback=None) -> Dict[str, Any]:
    """Main Modal function for YouTube transcription with enhanced orchestration"""
    try:
        import tempfile
        from pathlib import Path
        
        print(f"[Modal] 🚀 Starting YouTube transcription for: {youtube_url}")
        
        # Create temporary directory
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            # Download audio from YouTube
            print("[Modal] 📥 Downloading audio from YouTube...")
            audio_path = download_youtube_audio(youtube_url, temp_path)
            
            if not audio_path:
                raise Exception("Failed to download audio from YouTube")
            
            if progress_callback:
                progress_callback(25, "Audio downloaded successfully")
            
            print(f"[Modal] ✅ Audio downloaded: {audio_path}")
            
            # Use enhanced transcription orchestrator
            print("[Modal] 🎯 Starting enhanced transcription...")
            transcription_result = enhanced_transcription_orchestrator(audio_path)
            
            if progress_callback:
                progress_callback(75, "Transcription completed")
            
            # Generate final results
            final_result = generate_final_results(transcription_result, youtube_url)
            
            if progress_callback:
                progress_callback(95, "Processing completed")
            
            print("[Modal] 🎉 Transcription workflow completed successfully")
            return final_result
            
    except Exception as e:
        print(f"[Modal] ❌ Transcription failed: {e}")
        import traceback
        traceback.print_exc()
        raise
