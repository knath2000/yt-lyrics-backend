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

# Define the simplified Modal image with stable dependencies
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
]).apt_install([
    "git",           # Required for yt-dlp GitHub install
    "ffmpeg",        # Audio processing
    "curl",          # Downloads
]).run_commands([
    # Install latest yt-dlp with fallback - PRESERVE EXACT IMPLEMENTATION
    "pip install --upgrade --force-reinstall git+https://github.com/yt-dlp/yt-dlp.git || pip install --upgrade --force-reinstall yt-dlp",
])

app = modal.App("youtube-transcription")

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

def get_or_load_faster_whisper_model(model_size: str = "large-v3"):
    """Load Faster-Whisper model with caching"""
    try:
        from faster_whisper import WhisperModel
        
        print(f"Loading Faster-Whisper model: {model_size}")
        
        # Use conservative settings for stability
        model = WhisperModel(
            model_size,
            device="cuda",
            compute_type="float16",  # Good balance of speed and memory
            download_root="/models"
        )
        
        print(f"Model {model_size} loaded successfully")
        return model
        
    except Exception as e:
        print(f"Model loading error: {e}")
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
    """Ultra-fast transcription using Groq Whisper Large-v3 Turbo"""
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
        
        # Convert Groq response to our expected format
        segments = []
        if hasattr(transcription, 'words') and transcription.words:
            # Group words into segments (similar to Whisper segments)
            current_segment = []
            segment_start = None
            segment_id = 0
            
            for i, word in enumerate(transcription.words):
                if segment_start is None:
                    segment_start = word.start
                
                current_segment.append(word)
                
                # Create segment every 10 words or at end
                if len(current_segment) >= 10 or i == len(transcription.words) - 1:
                    segment_text = " ".join([w.word for w in current_segment])
                    segment_end = current_segment[-1].end
                    
                    segments.append({
                        "id": segment_id,
                        "start": segment_start,
                        "end": segment_end,
                        "text": segment_text,
                        "words": [
                            {
                                "word": w.word,
                                "start": w.start,
                                "end": w.end,
                                "probability": 0.9  # Groq doesn't provide probability
                            } for w in current_segment
                        ]
                    })
                    
                    current_segment = []
                    segment_start = None
                    segment_id += 1
        
        result = {
            "segments": segments,
            "language": getattr(transcription, 'language', 'en'),
            "language_probability": 0.95,  # Groq doesn't provide this
            "duration": transcription.words[-1].end if transcription.words else 0,
            "text": transcription.text
        }
        
        print(f"Groq transcription completed: {len(segments)} segments")
        return result
        
    except Exception as e:
        print(f"Groq transcription error: {e}")
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
            log_prob_threshold=-1.0,
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

@app.function(
    image=image,
    gpu="A10G",
    memory=16384,  # 16GB RAM
    timeout=1800,  # 30 minute timeout
    secrets=[
        modal.Secret.from_name("cloudinary-config"),
        modal.Secret.from_name("openai-api-key"),
        modal.Secret.from_name("groq-api-key")
    ]
)
@modal.fastapi_endpoint(method="POST")
def transcribe_youtube(request_data: dict) -> Dict[str, Any]:
    """
    CORRECT ARCHITECTURE: Fly.io downloads first, Modal processes
    - If audio_url provided: Fly.io successfully downloaded, use that audio
    - If audio_url is None: Fly.io download failed, Modal attempts download as fallback
    """
    
    # Extract parameters from request data
    youtube_url = request_data.get("youtube_url")
    job_id = request_data.get("job_id")
    audio_url = request_data.get("audio_url")
    fly_download_error = request_data.get("fly_download_error")
    
    if not youtube_url:
        return {
            "success": False,
            "error": "youtube_url is required"
        }
    
    # Enhanced progress tracking with detailed logging
    start_time = time.time()
    progress_log = []
    
    def update_progress(percentage: int, message: str, stage: str = "processing"):
        """Enhanced progress tracking with detailed logging"""
        current_time = time.time()
        timestamp = datetime.now().isoformat()
        duration = current_time - start_time
        
        progress_entry = {
            "status": "in_progress",
            "percentage": percentage,
            "message": message,
            "timestamp": timestamp,
            "duration": round(duration, 2),
            "stage": stage
        }
        
        progress_log.append(progress_entry)
        print(f"[{percentage}%] {stage}: {message} (t={duration:.1f}s)")
        
        # Note: For future enhancement, could send progress updates via webhooks
    
    try:
        # Extract video ID for caching and results
        video_id = None
        if "youtu.be/" in youtube_url:
            video_id = youtube_url.split("youtu.be/")[1].split("?")[0]
        elif "watch?v=" in youtube_url:
            video_id = youtube_url.split("watch?v=")[1].split("&")[0]
        elif "shorts/" in youtube_url:
            video_id = youtube_url.split("shorts/")[1].split("?")[0]
        
        if not video_id or len(video_id) != 11:
            raise Exception(f"Could not extract valid video ID from URL: {youtube_url}")
        
        print(f"Processing video ID: {video_id}")
        
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            # STEP 1: Get audio (either from Fly.io or download as fallback)
            if audio_url:
                # Fly.io successfully downloaded and uploaded audio
                update_progress(10, "[Modal] Using audio from Fly.io download...")
                print(f"[Modal] Using pre-downloaded audio from Fly.io: {audio_url}")
                
                # Download the audio from Cloudinary
                response = requests.get(audio_url)
                if response.status_code == 200:
                    audio_path = temp_path / "audio_from_flyio.mp3"
                    with open(audio_path, 'wb') as f:
                        f.write(response.content)
                    print(f"[Modal] Downloaded audio from Cloudinary: {audio_path}")
                else:
                    raise Exception(f"Failed to download audio from Cloudinary: {response.status_code}")
                    
                update_progress(20, "[Modal] Audio received from Fly.io")
                
            else:
                # Fly.io download failed, Modal attempts download as fallback
                update_progress(10, "[Modal] Fly.io download failed, attempting fallback download...")
                print(f"[Modal] Fly.io download failed ({fly_download_error}), attempting fallback download...")
                
                # Check Cloudinary cache first
                cache_public_id = f"audio/{video_id}/bestaudio_mp3"
                cached_audio_url = None
                
                try:
                    import cloudinary.api
                    cloudinary.config(
                        cloud_name=os.environ.get("CLOUDINARY_CLOUD_NAME"),
                        api_key=os.environ.get("CLOUDINARY_API_KEY"),
                        api_secret=os.environ.get("CLOUDINARY_API_SECRET")
                    )
                    
                    # Check if cached audio exists
                    cloudinary.api.resource(cache_public_id, resource_type="video")
                    cached_audio_url = f"https://res.cloudinary.com/{os.environ.get('CLOUDINARY_CLOUD_NAME')}/video/upload/{cache_public_id}.mp3"
                    print(f"[Modal Cache] Retrieved cached audio for {video_id} from Cloudinary")
                    
                    # Download cached audio
                    response = requests.get(cached_audio_url)
                    if response.status_code == 200:
                        audio_path = temp_path / "cached_audio.mp3"
                        with open(audio_path, 'wb') as f:
                            f.write(response.content)
                        print(f"[Modal Cache] Downloaded cached audio: {audio_path}")
                        update_progress(20, "[Modal] Using cached audio from Cloudinary")
                    else:
                        raise Exception(f"Failed to download cached audio: {response.status_code}")
                        
                except Exception as cache_error:
                    print(f"[Modal Cache] No cached audio found: {cache_error}")
                    
                    # Download audio if not cached - FALLBACK DOWNLOAD
                    update_progress(15, "[Modal] Downloading audio from YouTube as fallback...")
                    
                    # PRESERVE EXACT YT-DLP IMPLEMENTATION AS FALLBACK
                    output_path = temp_path / "downloaded_audio.%(ext)s"
                    cmd = [
                        "yt-dlp",
                        "--extract-audio",
                        "--audio-format", "mp3",
                        "--audio-quality", "0",  # Best quality
                        "--no-playlist",
                        "--no-warnings",
                        "--quiet",
                        "--output", str(output_path),
                        youtube_url
                    ]
                    
                    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
                    
                    if result.returncode != 0:
                        raise Exception(f"Modal fallback yt-dlp failed: {result.stderr}")
                    
                    # Find downloaded file
                    downloaded_files = list(temp_path.glob("downloaded_audio.*"))
                    if not downloaded_files:
                        raise Exception("Modal fallback: No audio file downloaded")
                    
                    audio_path = downloaded_files[0]
                    print(f"[Modal] Fallback download successful: {audio_path}")
                    
                    # Upload to cache for future use
                    try:
                        upload_to_cloudinary(audio_path, cache_public_id, "video")
                        print(f"[Modal] Audio uploaded to Cloudinary cache")
                    except Exception as upload_error:
                        print(f"[Modal] Cache upload warning: {upload_error}")
                        
                    update_progress(20, "[Modal] Fallback download completed")
            
            # STEP 2: Vocal separation with Demucs (conservative settings)
            update_progress(25, "[Modal] Separating vocals with Demucs...")
            vocals_path = separate_vocals_conservative(audio_path, temp_path)
            
            if vocals_path and vocals_path.exists():
                print("[Modal] Using separated vocals for transcription")
                transcription_audio = vocals_path
                update_progress(40, "[Modal] Vocal separation completed")
            else:
                print("[Modal] Demucs failed, using original audio")
                transcription_audio = audio_path
                update_progress(40, "[Modal] Using original audio")
            
            # STEP 3: Enhanced Transcription with Groq (if available) or Faster-Whisper fallback
            update_progress(45, "[Modal] Starting transcription...", "transcription")
            
            # Try Groq first for ultra-fast transcription
            groq_api_key = os.environ.get("GROQ_API_KEY")
            transcription_result = None
            processing_method = "faster_whisper"  # Default fallback
            
            if groq_api_key:
                try:
                    update_progress(50, "[Modal] Attempting Groq Whisper Large-v3 Turbo...", "transcription")
                    transcription_result = transcribe_with_groq(transcription_audio, groq_api_key)
                    processing_method = "groq_whisper"
                    update_progress(65, "[Modal] Groq transcription completed", "transcription")
                except Exception as groq_error:
                    print(f"Groq transcription failed: {groq_error}, falling back to Faster-Whisper")
                    update_progress(50, "[Modal] Groq failed, using Faster-Whisper fallback...", "transcription")
            
            # Fallback to Faster-Whisper if Groq failed or unavailable
            if not transcription_result:
                transcription_result = transcribe_with_faster_whisper(transcription_audio)
                update_progress(65, "[Modal] Faster-Whisper transcription completed", "transcription")
            
            # STEP 4: Word alignment with WhisperX
            update_progress(70, "[Modal] Aligning word timestamps with WhisperX...", "alignment")
            aligned_result = align_with_whisperx(transcription_audio, transcription_result, temp_path)
            update_progress(85, "[Modal] Word alignment completed", "alignment")
            
            # STEP 5: Generate final results
            update_progress(90, "[Modal] Generating final results...", "finalization")
            final_results = generate_final_results(aligned_result, youtube_url)
            
            # STEP 6: Upload results to Cloudinary
            results_file = temp_path / "results.json"
            with open(results_file, 'w', encoding='utf-8') as f:
                json.dump(final_results, f, ensure_ascii=False, indent=2)
            
            results_public_id = f"transcriptions/{video_id}/results"
            results_url = upload_to_cloudinary(results_file, results_public_id, "raw")
            
            if not results_url:
                raise Exception("Failed to upload results to Cloudinary")
            
            # Clean up GPU memory
            cleanup_gpu_memory()
            
            # Calculate total processing time
            total_processing_time = time.time() - start_time
            
            # Add completion entry to progress log
            progress_log.append({
                "status": "completed",
                "percentage": 100,
                "message": "Transcription completed successfully",
                "timestamp": datetime.now().isoformat(),
                "duration": round(total_processing_time, 2),
                "stage": "finalization"
            })
            
            update_progress(100, "[Modal] Transcription completed successfully", "finalization")
            
            return {
                "success": True,
                "result_url": results_url,  # Match the expected field name
                "results_url": results_url,  # Keep for compatibility
                "video_id": video_id,
                "processing_method": processing_method,
                "processing_time_seconds": round(total_processing_time, 2),
                "progress_log": progress_log,
                "metadata": final_results["metadata"]
            }
            
    except Exception as e:
        # Add error entry to progress log
        error_time = time.time() - start_time if 'start_time' in locals() else 0
        if 'progress_log' in locals():
            progress_log.append({
                "status": "error",
                "percentage": 0,
                "message": f"Transcription failed: {str(e)}",
                "timestamp": datetime.now().isoformat(),
                "duration": round(error_time, 2),
                "stage": "error"
            })
        
        update_progress(0, f"[Modal] Transcription failed: {str(e)}", "error")
        print(f"[Modal] Transcription error: {e}")
        import traceback
        traceback.print_exc()
        
        # Clean up GPU memory even on error
        cleanup_gpu_memory()
        
        return {
            "success": False,
            "error": str(e),
            "video_id": video_id if 'video_id' in locals() else None,
            "processing_time_seconds": round(error_time, 2),
            "progress_log": progress_log if 'progress_log' in locals() else []
        }

# Test function for local development
@app.local_entrypoint()
def test_transcription():
    """Test the transcription function locally"""
    def test_callback(pct, msg):
        print(f"Progress: {pct}% - {msg}")
    
    result = transcribe_youtube.remote("https://www.youtube.com/watch?v=dQw4w9WgXcQ", test_callback)
    print("Final result:", result) 