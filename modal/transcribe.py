import modal
import os
import json
import tempfile
import subprocess
import shutil
from pathlib import Path
from typing import Dict, Any, Optional, Callable, List
import requests

# Define the optimized Modal image for A10G GPU utilization
image = modal.Image.debian_slim(python_version="3.11").pip_install([
    # Core ML and audio processing - optimized versions
    "torch>=2.1.0",
    "torchaudio>=2.1.0", 
    "transformers>=4.30.0",
    "librosa>=0.10.0",
    "soundfile>=0.12.0",
    "scipy>=1.10.0",
    "numpy>=1.24.0",
    
    # Optimized transcription libraries
    "faster-whisper>=1.0.0",  # GPU-optimized Whisper
    "whisperx>=3.1.1",        # For alignment and batching
    "ctranslate2>=4.0.0",     # CTranslate2 backend for faster-whisper
    
    # YouTube download and processing
    "yt-dlp>=2024.12.13",
    "demucs>=4.0.1",
    
    # VAD for silence removal
    "silero-vad>=4.0.0",
    
    # OpenAI API (fallback)
    "openai>=1.0.0",
    
    # Cloud storage
    "cloudinary>=1.36.0",
    # Required for web endpoints via @modal.fastapi_endpoint
    "fastapi[standard]>=0.115.0",
    
    # Utilities
    "requests>=2.31.0",
    "python-dotenv>=1.0.0"
]).apt_install([
    # System dependencies for audio processing
    "ffmpeg",
    "libsndfile1-dev", 
    "gcc",
    "g++",
    "wget",
    "git",  # Required for installing from GitHub
    "libcurl4-openssl-dev",
    "libffi-dev",
    "libssl-dev"
]).run_commands([
    # Install latest yt-dlp from GitHub for best YouTube compatibility
    "pip install --upgrade --force-reinstall git+https://github.com/yt-dlp/yt-dlp.git || pip install --upgrade --force-reinstall yt-dlp"
])

app = modal.App("youtube-transcription")

# Global model containers for warm starts
model_cache = {}

@app.function(
    image=image,
    gpu="A10G",
    timeout=1800,  # 30 minutes
    memory=16384,  # Increased to 16GB RAM for better A10G utilization
    cpu=4.0,       # 4 CPU cores
    secrets=[
        modal.Secret.from_name("openai-api-key"),
        modal.Secret.from_name("cloudinary-config"),
        modal.Secret.from_name("youtube-cookies")  # Add YouTube cookies secret
    ]
)
# Expose as POST endpoint: expects JSON { "youtube_url": "..." }
@modal.fastapi_endpoint(method="POST")
def transcribe_youtube(
    data: Dict[str, Any]
) -> Dict[str, Any]:

    youtube_url = data.get("youtube_url")
    auto_terminate = data.get("auto_terminate", True)
    use_vad = data.get("use_vad", True)  # Enable VAD by default
    batch_size = data.get("batch_size", 16)  # Configurable batch size
    progress_callback: Optional[Callable[[int, str], None]] = None
    
    def update_progress(pct: int, message: str):
        """Update progress with callback if provided"""
        if progress_callback:
            progress_callback(pct, message)
        print(f"[{pct}%] {message}")
    
    try:
        # Create temporary working directory
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            # ------------------------------------------------------------------
            # Step 1: Cloudinary cache check → download → optional cache upload
            # ------------------------------------------------------------------

            update_progress(5, "Preparing audio (cache check)...")

            video_id = extract_video_id(youtube_url)
            audio_path: Path

            if video_id:
                cached = try_fetch_cached_audio(video_id, temp_path)
                if cached:
                    update_progress(10, "Using cached audio from Cloudinary…")
                    audio_path = cached
                else:
                    update_progress(10, "Downloading YouTube audio…")
                    audio_path = download_youtube_audio(youtube_url, temp_path)
                    # Upload to cache in background
                    if video_id:
                        import threading
                        threading.Thread(target=upload_audio_to_cache, args=(video_id, audio_path), daemon=True).start()
            else:
                # Could not parse video ID; just download normally
                update_progress(10, "Downloading YouTube audio…")
                audio_path = download_youtube_audio(youtube_url, temp_path)
            
            update_progress(20, "Audio download completed")
            
            # Stage 2: Vocal separation with optimized Demucs (35%)
            update_progress(25, "Separating vocals with Demucs (GPU-optimized)…")
            vocals_path = separate_vocals_optimized(audio_path, temp_path)
            update_progress(35, "Vocal separation completed")
            
            # Stage 3: Transcription with Faster-Whisper (65%)
            update_progress(40, "Transcribing audio with Faster-Whisper (GPU-batched)...")
            transcript_data = transcribe_with_faster_whisper(
                vocals_path or audio_path, 
                use_vad=use_vad,
                batch_size=batch_size
            )
            update_progress(65, "Transcription completed")
            
            # Stage 4: Word alignment with WhisperX (85%)
            update_progress(70, "Aligning word timestamps with WhisperX (batched)...")
            aligned_data = align_with_whisperx_optimized(
                vocals_path or audio_path, 
                transcript_data,
                batch_size=batch_size
            )
            update_progress(85, "Word alignment completed")
            
            # Stage 5: Generate final results (100%)
            update_progress(90, "Generating final results...")
            results = generate_final_results(aligned_data, youtube_url)
            update_progress(100, "Transcription completed successfully")
            
            # Clean up GPU memory
            cleanup_gpu_memory()
            
            return results
            
    except Exception as e:
        error_msg = f"Transcription failed: {str(e)}"
        update_progress(0, error_msg)
        return {"error": error_msg}
    
    finally:
        # Auto-terminate worker if requested
        if auto_terminate:
            print("Auto-terminating Modal worker...")
            os._exit(0)

# ---------------------------------------------------------------------------
# Cloudinary audio caching helpers
# ---------------------------------------------------------------------------

def extract_video_id(youtube_url: str) -> Optional[str]:
    """Extract the canonical 11-character video ID from various YouTube URL forms."""
    try:
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(youtube_url)

        # Standard watch?v=ID
        if parsed.hostname and 'youtube' in parsed.hostname and parsed.path == '/watch':
            qs = parse_qs(parsed.query)
            return qs.get('v', [None])[0]

        # Short youtu.be/ID
        if parsed.hostname == 'youtu.be':
            return parsed.path.lstrip('/')

        # Shorts
        if parsed.path.startswith('/shorts/'):
            return parsed.path.split('/')[2]
    except Exception:
        pass
    return None


def cloudinary_configured() -> bool:
    return all(k in os.environ for k in (
        "CLOUDINARY_CLOUD_NAME",
        "CLOUDINARY_API_KEY",
        "CLOUDINARY_API_SECRET",
    ))


def cloudinary_init():
    import cloudinary
    cloudinary.config(
        cloud_name=os.environ["CLOUDINARY_CLOUD_NAME"],
        api_key=os.environ["CLOUDINARY_API_KEY"],
        api_secret=os.environ["CLOUDINARY_API_SECRET"],
        secure=True,
    )


def try_fetch_cached_audio(video_id: str, temp_dir: Path) -> Optional[Path]:
    """Attempt to fetch previously-cached audio from Cloudinary; returns local Path or None."""
    if not cloudinary_configured():
        return None
    try:
        cloudinary_init()
        import cloudinary.api  # type: ignore

        public_id = f"audio/{video_id}/bestaudio_mp3"
        resource = cloudinary.api.resource(public_id, resource_type="video")
        secure_url = resource.get("secure_url")
        if not secure_url:
            return None

        response = requests.get(secure_url, timeout=30)
        if response.status_code != 200:
            print(f"[Cache] Failed to download cached file: HTTP {response.status_code}")
            return None

        local_path = temp_dir / f"{video_id}.mp3"
        with open(local_path, "wb") as f:
            f.write(response.content)
        print(f"[Cache] Retrieved cached audio for {video_id} from Cloudinary")
        return local_path
    except Exception as err:
        if "Resource not found" not in str(err):
            print(f"[Cache] Error fetching cache for {video_id}: {err}")
        return None


def upload_audio_to_cache(video_id: str, local_file: Path):
    """Upload freshly downloaded audio to Cloudinary asynchronously."""
    if not cloudinary_configured():
        return
    try:
        cloudinary_init()
        import cloudinary.uploader  # type: ignore
        cloudinary.uploader.upload(
            str(local_file),
            resource_type="video",
            public_id=f"audio/{video_id}/bestaudio_mp3",
            overwrite=True,
            tags=["yt_audio_cache", f"video:{video_id}"],
        )
        print(f"[Cache] Uploaded audio for {video_id} to Cloudinary cache")
    except Exception as err:
        print(f"[Cache] Failed to upload cache for {video_id}: {err}")

def download_youtube_audio(youtube_url: str, temp_path: Path) -> Path:
    """Download YouTube audio using comprehensive multi-strategy fallback"""
    
    # Check for YouTube cookies from environment variable
    youtube_cookies = os.environ.get("YOUTUBE_COOKIES_CONTENT")
    cookies_file = None
    
    if youtube_cookies:
        # Create temporary cookies file from environment variable
        cookies_file = temp_path / "cookies.txt"
        with open(cookies_file, 'w') as f:
            f.write(youtube_cookies)
        print(f"[Download] Created cookies file with {len(youtube_cookies)} characters")
    else:
        print("[Download] No YouTube cookies available - using unauthenticated methods only")
    
    # Define player clients for different strategies
    player_clients = ["tv", "ios", "web"]
    
    # Define authenticated download methods (require cookies)
    authenticated_methods = []
    if cookies_file:  # Only add authenticated methods if we have cookies
        for client in player_clients:
            authenticated_methods.append({
                "name": f"authenticated-{client}",
                "description": f"Authenticated download using explicit {client} player client",
                "args": [
                    youtube_url,
                    "--cookies", str(cookies_file),  # Use cookies file instead of browser extraction
                    "-f", "bestaudio[ext=m4a]/bestaudio",
                    "--no-playlist",
                    "-x",
                    "--audio-format", "wav",
                    "--audio-quality", "0",
                    "-o", str(temp_path / "audio.%(ext)s"),
                    "--no-check-certificate",
                    "--ignore-errors", 
                    "--socket-timeout", "30",
                    "--retries", "3",
                    "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "--referer", "https://www.youtube.com/",
                    "--add-header", "Accept-Language:en-US,en;q=0.9",
                    "--force-ipv4",
                    "--extractor-args", f"youtube:player_client={client}"
                ]
            })
    
    # Define unauthenticated download methods
    unauthenticated_methods = []
    for client in player_clients:
        unauthenticated_methods.append({
            "name": f"unauth-{client}",
            "description": f"Unauthenticated download using explicit {client} player client",
            "args": [
                youtube_url,
                "-f", "bestaudio[ext=m4a]/bestaudio",
                "--no-playlist",
                "-x",
                "--audio-format", "wav", 
                "--audio-quality", "0",
                "-o", str(temp_path / "audio.%(ext)s"),
                "--no-check-certificate",
                "--ignore-errors",
                "--socket-timeout", "30",
                "--retries", "3",
                "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "--referer", "https://www.youtube.com/",
                "--add-header", "Accept-Language:en-US,en;q=0.9",
                "--force-ipv4",
                "--extractor-args", f"youtube:player_client={client}"
            ]
        })
    
    # Combine all methods: authenticated first (if available), then unauthenticated
    all_methods = authenticated_methods + unauthenticated_methods
    
    last_error = None
    
    # Try each method in sequence
    for method in all_methods:
        try:
            print(f"[Download] Attempting method: {method['name']} ({method['description']})")
            
            result = subprocess.run(
                ["yt-dlp"] + method["args"], 
                capture_output=True, 
                text=True,
                timeout=120  # 2 minute timeout per attempt
            )
            
            if result.returncode == 0:
                # Check if file was downloaded successfully
                audio_files = list(temp_path.glob("audio.*"))
                if audio_files:
                    print(f"[Download] ✅ Successfully downloaded using method: {method['name']}")
                    return audio_files[0]
            
            # Log detailed error for this method
            print(f"[Download] ❌ Method {method['name']} failed:")
            print(f"   Return code: {result.returncode}")
            print(f"   stdout: {result.stdout[:500]}...")  # Truncate long output
            print(f"   stderr: {result.stderr[:500]}...")
            
            last_error = result.stderr
            
        except subprocess.TimeoutExpired:
            print(f"[Download] ❌ Method {method['name']} timed out after 2 minutes")
            last_error = f"Method {method['name']} timed out"
            continue
        except Exception as e:
            print(f"[Download] ❌ Method {method['name']} failed with exception: {str(e)}")
            last_error = str(e)
            continue
    
    # All methods failed
    error_message = f"All download methods failed. Last error: {last_error}"
    print(f"[Download] ❌ {error_message}")
    raise Exception(f"YouTube download failed: {error_message}")

# ---------------------------------------------------------------------------
# Optimized processing functions for A10G GPU
# ---------------------------------------------------------------------------

def get_or_load_faster_whisper_model(model_size: str = "large-v3") -> Any:
    """Get or load Faster-Whisper model with warm caching"""
    global model_cache
    
    cache_key = f"faster_whisper_{model_size}"
    if cache_key not in model_cache:
        print(f"Loading Faster-Whisper model: {model_size}")
        from faster_whisper import WhisperModel
        
        # Optimized for A10G GPU with fp16 precision
        model = WhisperModel(
            model_size,
            device="cuda",
            compute_type="float16",  # fp16 for A10G optimization
            cpu_threads=4,           # Match our CPU allocation
            num_workers=1            # Single worker for GPU
        )
        model_cache[cache_key] = model
        print(f"Faster-Whisper model {model_size} loaded and cached")
    
    return model_cache[cache_key]

def get_or_load_whisperx_models(language_code: str = "en") -> tuple:
    """Get or load WhisperX alignment models with warm caching"""
    global model_cache
    
    cache_key = f"whisperx_align_{language_code}"
    if cache_key not in model_cache:
        print(f"Loading WhisperX alignment model for: {language_code}")
        import whisperx
        
        # Load alignment model with GPU optimization
        model_a, metadata = whisperx.load_align_model(
            language_code=language_code,
            device="cuda"
        )
        model_cache[cache_key] = (model_a, metadata)
        print(f"WhisperX alignment model for {language_code} loaded and cached")
    
    return model_cache[cache_key]

def separate_vocals_optimized(audio_path: Path, temp_path: Path) -> Optional[Path]:
    """Optimized vocal separation using Demucs with A10G GPU settings"""
    try:
        output_dir = temp_path / "demucs_output"
        
        # Optimized Demucs command for A10G GPU
        cmd = [
            "demucs",
            "--two-stems", "vocals",
            "-n", "htdemucs",              # High-quality model
            "--segment", "6",              # Optimized segment size for A10G memory
            "-d", "cuda",                  # GPU device
            "--mp3",                       # Use MP3 for faster I/O
            "--mp3-bitrate", "320",        # High quality MP3
            "-j", "4",                     # Parallel jobs matching CPU count
            "--float32",                   # Use float32 for better A10G performance
            "-o", str(output_dir),         # Output directory
            str(audio_path)                # Input file
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"Demucs failed, using original audio: {result.stderr}")
            return None
        
        # Find the vocals file (now MP3)
        vocals_files = list(output_dir.glob("**/vocals.mp3"))
        if not vocals_files:
            # Fallback to WAV if MP3 not found
            vocals_files = list(output_dir.glob("**/vocals.wav"))
        
        if vocals_files:
            return vocals_files[0]
        
        return None
        
    except Exception as e:
        print(f"Vocal separation failed, using original audio: {e}")
        return None

def get_or_load_batched_whisper_model(model_size: str = "large-v3") -> Any:
    """Get or load Batched Faster-Whisper model for maximum A10G GPU utilization"""
    global model_cache
    
    cache_key = f"batched_whisper_{model_size}"
    if cache_key not in model_cache:
        print(f"Loading Batched Faster-Whisper model: {model_size}")
        from faster_whisper import WhisperModel, BatchedInferencePipeline
        
        # Load base model optimized for A10G
        base_model = WhisperModel(
            model_size,
            device="cuda",
            compute_type="float16",  # fp16 for A10G optimization
            cpu_threads=4,
            num_workers=1
        )
        
        # Create batched pipeline for maximum GPU utilization
        batched_model = BatchedInferencePipeline(
            model=base_model,
            use_vad_model=True,      # Built-in VAD for efficiency
            chunk_length=30,         # Optimal chunk size for A10G
            batch_size=16            # Default batch size
        )
        
        model_cache[cache_key] = batched_model
        print(f"Batched Faster-Whisper model {model_size} loaded and cached")
    
    return model_cache[cache_key]

def transcribe_with_faster_whisper(
    audio_path: Path, 
    use_vad: bool = True,
    batch_size: int = 16,
    model_size: str = "large-v3",
    use_batched: bool = True
) -> Dict[str, Any]:
    """Optimized transcription using Faster-Whisper with VAD and batching"""
    try:
        # Choose between batched and standard model based on audio length
        audio_duration = get_audio_duration(audio_path)
        
        if use_batched and audio_duration > 60:  # Use batched for longer audio
            return transcribe_with_batched_pipeline(audio_path, batch_size, model_size)
        else:
            return transcribe_with_standard_pipeline(audio_path, use_vad, batch_size, model_size)
        
    except Exception as e:
        print(f"Faster-Whisper transcription failed: {e}")
        # Fallback to OpenAI API
        return transcribe_with_openai_fallback(audio_path)

def transcribe_with_batched_pipeline(
    audio_path: Path,
    batch_size: int,
    model_size: str
) -> Dict[str, Any]:
    """Use BatchedInferencePipeline for maximum A10G GPU utilization"""
    print(f"Using BatchedInferencePipeline for maximum GPU utilization (batch_size={batch_size})")
    
    # Get cached batched model
    batched_model = get_or_load_batched_whisper_model(model_size)
    
    # Transcribe with batched pipeline
    segments, info = batched_model.transcribe(
        str(audio_path),
        batch_size=batch_size,
        language="en",  # Can be made configurable
        task="transcribe"
    )
    
    # Convert generator to list
    segments_list = list(segments)
    
    # Format output to match expected structure
    result = {
        "segments": [],
        "language": info.language,
        "language_probability": info.language_probability,
    }
    
    for segment in segments_list:
        segment_dict = {
            "id": getattr(segment, 'id', 0),
            "seek": getattr(segment, 'seek', 0),
            "start": segment.start,
            "end": segment.end,
            "text": segment.text,
            "tokens": getattr(segment, 'tokens', []),
            "temperature": getattr(segment, 'temperature', 0.0),
            "avg_logprob": getattr(segment, 'avg_logprob', 0.0),
            "compression_ratio": getattr(segment, 'compression_ratio', 0.0),
            "no_speech_prob": getattr(segment, 'no_speech_prob', 0.0),
            "words": []
        }
        
        # Add word-level timestamps if available
        if hasattr(segment, 'words') and segment.words:
            for word in segment.words:
                segment_dict["words"].append({
                    "word": word.word,
                    "start": word.start,
                    "end": word.end,
                    "probability": getattr(word, 'probability', 0.0)
                })
        
        result["segments"].append(segment_dict)
    
    print(f"Batched Faster-Whisper transcription completed: {len(result['segments'])} segments")
    return result

def transcribe_with_standard_pipeline(
    audio_path: Path,
    use_vad: bool,
    batch_size: int,
    model_size: str
) -> Dict[str, Any]:
    """Use standard Faster-Whisper pipeline for shorter audio"""
    print(f"Using standard Faster-Whisper pipeline with VAD={use_vad}")
    
    # Get cached model
    model = get_or_load_faster_whisper_model(model_size)
    
    # Configure transcription parameters for A10G optimization
    transcribe_params = {
        "beam_size": 5,
        "best_of": 5,
        "temperature": [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
        "compression_ratio_threshold": 2.4,
        "log_prob_threshold": -1.0,
        "no_speech_threshold": 0.6,
        "condition_on_previous_text": False,  # Better for batching
        "word_timestamps": True,              # Enable word-level timestamps
        "vad_filter": use_vad,               # Voice Activity Detection
    }
    
    if use_vad:
        # Enhanced VAD parameters for better silence filtering
        transcribe_params["vad_parameters"] = {
            "min_silence_duration_ms": 500,
            "max_speech_duration_s": 30,
            "min_speech_duration_ms": 250,
            "window_size_samples": 1024,
        }
    
    # Transcribe with optimized settings
    segments, info = model.transcribe(str(audio_path), **transcribe_params)
    
    # Convert generator to list to force execution
    segments_list = list(segments)
    
    # Format output to match expected structure
    result = {
        "segments": [],
        "language": info.language,
        "language_probability": info.language_probability,
    }
    
    for segment in segments_list:
        segment_dict = {
            "id": segment.id,
            "seek": segment.seek,
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
        
        result["segments"].append(segment_dict)
    
    print(f"Standard Faster-Whisper transcription completed: {len(result['segments'])} segments")
    return result

def get_audio_duration(audio_path: Path) -> float:
    """Get audio duration in seconds"""
    try:
        import librosa
        duration = librosa.get_duration(path=str(audio_path))
        return duration
    except Exception as e:
        print(f"Could not get audio duration: {e}")
        return 0.0

def align_with_whisperx_optimized(
    audio_path: Path, 
    transcript_data: Dict[str, Any],
    batch_size: int = 16
) -> Dict[str, Any]:
    """Optimized WhisperX alignment with batching for A10G GPU"""
    try:
        import whisperx
        
        # Get language from transcript
        language_code = transcript_data.get("language", "en")
        
        # Get cached alignment models
        model_a, metadata = get_or_load_whisperx_models(language_code)
        
        # Load audio with optimized settings
        audio = whisperx.load_audio(str(audio_path))
        
        print(f"Starting WhisperX alignment with batch_size={batch_size}")
        
        # Perform alignment with optimized batch size
        result = whisperx.align(
            transcript_data["segments"],
            model_a,
            metadata,
            audio,
            device="cuda",
            return_char_alignments=False,  # Disable for performance
            batch_size=batch_size,         # Use configurable batch size
            interpolate_method="linear",    # Fast interpolation
        )
        
        print(f"WhisperX alignment completed successfully")
        return result
        
    except Exception as e:
        print(f"WhisperX alignment failed, using original timestamps: {e}")
        return transcript_data

def transcribe_with_openai_fallback(audio_path: Path) -> Dict[str, Any]:
    """Fallback to OpenAI Whisper API if local processing fails"""
    import openai
    
    print("Using OpenAI Whisper API as fallback")
    
    # Initialize OpenAI client
    client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    
    # Transcribe with word-level timestamps
    with open(audio_path, "rb") as audio_file:
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            response_format="verbose_json",
            timestamp_granularities=["word"]
        )
    
    return transcript.model_dump()

def cleanup_gpu_memory():
    """Clean up GPU memory after processing"""
    try:
        import torch
        import gc
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            gc.collect()
            print("GPU memory cleaned up")
    except Exception as e:
        print(f"GPU cleanup warning: {e}")

# ---------------------------------------------------------------------------
# Generate final results
# ---------------------------------------------------------------------------

def generate_final_results(aligned_data: Dict[str, Any], youtube_url: str) -> Dict[str, Any]:
    """Generate final transcription results in multiple formats"""
    
    # Extract words with timestamps
    words = []
    all_text = []
    
    segments = aligned_data.get("segments", [])
    if not segments:
        # Handle case where no segments are available
        return {
            "words": [],
            "srt": "",
            "plain": "",
            "resultUrl": None,
            "metadata": {
                "youtube_url": youtube_url,
                "word_count": 0,
                "duration": 0,
                "processed_at": "2025-01-15T12:00:00Z"
            }
        }
    
    for segment in segments:
        # Use .get() with fallback to handle None values
        segment_words = segment.get("words") or []
        for word_data in segment_words:
            words.append({
                "word": word_data.get("word", "").strip(),
                "start": word_data.get("start", 0),
                "end": word_data.get("end", 0),
                "confidence": word_data.get("score", 0.0)
            })
            all_text.append(word_data.get("word", "").strip())
    
    # Generate plain text
    plain_text = " ".join(all_text)
    
    # Generate SRT format
    srt_content = generate_srt(words)
    
    # Upload to Cloudinary (if configured)
    result_url = None
    try:
        result_url = upload_to_cloudinary({
            "words": words,
            "srt": srt_content,
            "plain": plain_text
        })
    except Exception as e:
        print(f"Cloudinary upload failed: {e}")
    
    return {
        "words": words,
        "srt": srt_content,
        "plain": plain_text,
        "resultUrl": result_url,
        "metadata": {
            "youtube_url": youtube_url,
            "word_count": len(words),
            "duration": words[-1]["end"] if words else 0,
            "processed_at": "2025-01-15T12:00:00Z"
        }
    }

def generate_srt(words: list) -> str:
    """Generate SRT subtitle format from word data"""
    if not words:
        return ""
    
    srt_lines = []
    subtitle_index = 1
    
    # Group words into subtitles (max 10 words or 5 seconds)
    current_group = []
    current_start = None
    
    for word in words:
        if not current_group:
            current_start = word["start"]
        
        current_group.append(word)
        
        # Check if we should end this subtitle
        should_end = (
            len(current_group) >= 10 or  # Max 10 words
            (word["end"] - current_start) >= 5.0  # Max 5 seconds
        )
        
        if should_end:
            # Format timestamps
            start_time = format_srt_time(current_start)
            end_time = format_srt_time(word["end"])
            
            # Create subtitle text
            subtitle_text = " ".join([w["word"] for w in current_group])
            
            # Add to SRT
            srt_lines.append(f"{subtitle_index}")
            srt_lines.append(f"{start_time} --> {end_time}")
            srt_lines.append(subtitle_text)
            srt_lines.append("")  # Empty line between subtitles
            
            subtitle_index += 1
            current_group = []
    
    # Handle remaining words
    if current_group:
        start_time = format_srt_time(current_start)
        end_time = format_srt_time(current_group[-1]["end"])
        subtitle_text = " ".join([w["word"] for w in current_group])
        
        srt_lines.append(f"{subtitle_index}")
        srt_lines.append(f"{start_time} --> {end_time}")
        srt_lines.append(subtitle_text)
        srt_lines.append("")
    
    return "\n".join(srt_lines)

def format_srt_time(seconds: float) -> str:
    """Format seconds as SRT timestamp (HH:MM:SS,mmm)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millisecs = int((seconds % 1) * 1000)
    
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millisecs:03d}"

def upload_to_cloudinary(data: Dict[str, Any]) -> Optional[str]:
    """Upload results to Cloudinary"""
    try:
        import cloudinary
        import cloudinary.uploader
        
        # Configure Cloudinary
        cloudinary.config(
            cloud_name=os.environ["CLOUDINARY_CLOUD_NAME"],
            api_key=os.environ["CLOUDINARY_API_KEY"],
            api_secret=os.environ["CLOUDINARY_API_SECRET"]
        )
        
        # Upload JSON data
        json_data = json.dumps(data)
        result = cloudinary.uploader.upload(
            json_data,
            resource_type="raw",
            public_id=f"transcriptions/{data.get('job_id', 'unknown')}/results",
            format="json"
        )
        
        return result.get("secure_url")
        
    except Exception as e:
        print(f"Cloudinary upload error: {e}")
        return None

# Export the function for external use
if __name__ == "__main__":
    # This allows the function to be called directly
    pass 