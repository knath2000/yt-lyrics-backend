import modal

# Define the Modal image with all transcription dependencies
image = modal.Image.debian_slim(python_version="3.11").pip_install([
    # Core ML and audio processing
    "torch>=2.0.0",
    "torchaudio>=2.0.0", 
    "transformers>=4.30.0",
    "librosa>=0.10.0",
    "soundfile>=0.12.0",
    "scipy>=1.10.0",
    "numpy>=1.24.0",
    
    # YouTube download and processing
    "yt-dlp>=2024.12.13",
    "demucs>=4.0.1",
    
    # Whisper and transcription
    "openai-whisper>=20231117",
    "whisperx>=3.1.1",
    
    # OpenAI API
    "openai>=1.0.0",
    
    # Cloud storage
    "cloudinary>=1.36.0",
    
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
    "libcurl4-openssl-dev",
    "libffi-dev",
    "libssl-dev"
]).run_commands([
    # Install latest yt-dlp from GitHub for best YouTube compatibility
    "pip install --upgrade --force-reinstall git+https://github.com/yt-dlp/yt-dlp.git"
])

# Export the image for use in other Modal functions
__all__ = ["image"] 