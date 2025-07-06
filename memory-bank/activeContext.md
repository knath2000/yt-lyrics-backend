# Active Context - Backend

_Last updated: 2025-07-06_

## Current Focus
- **YOUTUBE DOWNLOAD CHALLENGES**: Addressing YouTube's June 2025 anti-bot measures causing signature extraction failures
- **AUDIO CACHING SYSTEM**: Implemented Cloudinary-based caching but facing YouTube download issues
- **STABLE ROLLBACK**: Maintaining stable version via rollback to commit 669856c

## Current Deployment Status

### Railway Deployment
- **URL**: `https://yt-lyrics-backend-production.up.railway.app`
- **Status**: ⚠️ PARTIALLY STABLE (experiencing YouTube download issues)
- **Configuration**: Uses Railway's container platform with automatic scaling
- **Signal Handling**: Fixed with direct Node.js execution (`node dist/index.js`)

### Fly.io Deployment  
- **URL**: `https://yt-lyrics-backend.fly.dev`
- **Status**: ⚠️ PARTIALLY STABLE (experiencing YouTube download issues)
- **Configuration**: Uses Fly.io's global edge platform with auto-scaling machines
- **Region**: LAX (Los Angeles) primary region
- **Health Checks**: Configured with `/health` endpoint monitoring

## Recent Achievements

### ✅ FEATURE: Cloudinary Audio Caching System (2025-07-06)
- **Achievement**: Implemented cloud-based caching for extracted YouTube audio
- **Caching Features**:
  - Consistent naming pattern: `audio/{videoId}/bestaudio_mp3`
  - Tagging with `yt_audio_cache` and `video:<id>` for management
  - Cache-first approach to eliminate redundant downloads
  - Fetch and local storage of cached audio when available
- **Impact**: Reduces processing time and bandwidth for repeat requests
- **Status**: Implementation complete but limited by YouTube download issues

### ✅ ENHANCEMENT: Robust YouTube URL Parsing (2025-07-06)
- **Achievement**: Created comprehensive videoId extraction function
- **Supported Formats**:
  - Standard watch URLs: `youtube.com/watch?v=VIDEO_ID`
  - Short URLs: `youtu.be/VIDEO_ID`
  - Shorts: `youtube.com/shorts/VIDEO_ID`
  - URLs with additional query parameters
- **Impact**: Ensures consistent caching regardless of URL format
- **Status**: Working correctly for all URL formats

### ✅ ENHANCEMENT: Multi-Strategy Fallback Chain (2025-07-06)
- **Achievement**: Expanded download strategies with more fallback options
- **New Options**:
  - Added generic format options without specific format filters
  - Included both authenticated and unauthenticated attempts
  - Improved error handling and reporting
- **Impact**: Increased resilience against YouTube format changes
- **Status**: Implemented but not resolving current signature extraction issues

### ❌ CRITICAL ISSUE: YouTube Signature Extraction Failures (2025-07-06)
- **Issue**: YouTube's June 2025 updates causing "Signature extraction failed" errors
- **Symptoms**:
  - "Only images are available for download" messages
  - Failed downloads with all format strategies
  - yt-dlp unable to extract audio formats
- **Attempted Solutions**:
  - Updated Docker container to use latest yt-dlp binary
  - Added symlink to ensure latest binary is used
  - Implemented additional fallback strategies
- **Current Status**: Issue persists; rollback to stable commit 669856c required

### ✅ CRITICAL: Rollback to Stable Commit (2025-07-04)
- **Issue**: Quality tier system causing download failures with YouTube's anti-bot measures
- **Solution**: Rolled back to stable commit 669856c before quality tier implementation
- **Process**: Created backup branch, checked out stable commit, created new branch, pushed to main
- **Result**: Restored reliable transcription pipeline without quality tiers

### ✅ MAJOR: Database & Cloud Storage Integration (2025-07-05)
- **Achievement**: Successfully integrated PostgreSQL database and Cloudinary cloud storage
- **Database Features**:
  - PostgreSQL connection with pg pool for efficient connection management
  - Jobs table with comprehensive schema for tracking transcription jobs
  - Automatic table creation and setup via `setupDatabase()` function
  - Health checks with database connectivity verification
- **Cloud Storage Features**:
  - Cloudinary integration for storing transcription results permanently
  - JSON results uploaded to `transcriptions/{jobId}/results` folder
  - SRT files uploaded to `transcriptions/{jobId}/subtitles` folder
  - Secure URL generation for frontend access
- **Impact**: Jobs now persist across server restarts, results stored permanently in cloud
- **Result**: Complete production-ready system with persistent storage

## Technical Stack Details

### Audio Processing Pipeline
- **Stage 1: YouTube Download**
  - **Tool**: yt-dlp (Python CLI)
  - **Version**: 2024.12.13 with curl_cffi support
  - **Fallback Chain**: 8-step strategy with m4a, best, opus, and generic formats
  - **Configuration**: Cookies support, socket timeout, retry settings
  - **Caching**: Cloudinary-based audio caching with consistent naming pattern

- **Stage 2: Vocal Separation**
  - **Tool**: Demucs (Facebook AI Research)
  - **Model**: htdemucs (transformer-based)
  - **Configuration**: 7-second segments, memory-safe mode, CPU device
  - **Dependencies**: soundfile, librosa audio backends

- **Stage 3: Transcription**
  - **Tool**: OpenAI Whisper API
  - **Model**: whisper-1 or configurable via OPENAI_AUDIO_MODEL
  - **Features**: Word-level timestamps in verbose_json format

- **Stage 4: Alignment**
  - **Tool**: WhisperX (Python CLI)
  - **Model**: WAV2VEC2_ASR_BASE_960H
  - **Configuration**: int8 compute type, 30-second chunks
  - **Output**: Enhanced word-level timing accuracy

- **Stage 5: Output Generation**
  - **Tool**: Custom NodeJS code
  - **Formats**: SRT subtitles, plain text, word-by-word JSON
  - **Features**: Configurable subtitle grouping (10 words or 5 seconds)

- **Stage 6: Data Persistence**
  - **Database**: PostgreSQL with pg connection pooling
  - **Schema**: Jobs table with status tracking, timestamps, and metadata
  - **Health Checks**: Database connectivity verification
  - **Setup**: Automatic table creation and initialization

- **Stage 7: Cloud Storage**
  - **Service**: Cloudinary cloud storage
  - **Organization**: Structured folders (`transcriptions/{jobId}/results`, `transcriptions/{jobId}/subtitles`, `audio/{videoId}/bestaudio_mp3`)
  - **Access**: Secure URL generation for frontend consumption
  - **Permanence**: Results stored permanently in cloud
  - **Caching**: Audio files cached for reuse across jobs

## Next Steps

### Immediate Priorities
1. **Resolve YouTube Download Issues**: Investigate updated yt-dlp versions or alternative download approaches
2. **Enhance Caching System**: Add expiration policies and storage management for Cloudinary assets
3. **Monitor Stability**: Continue monitoring the rollback solution for reliability

### Future Enhancements
1. **Smart Routing**: Implement intelligent routing based on historical performance data
2. **Regional Optimization**: Deploy to additional Fly.io regions based on user geography
3. **Load Balancing**: Implement weighted routing based on platform performance

## Known Issues
- **CRITICAL**: YouTube signature extraction failures with June 2025 updates
- **WORKAROUND**: Rollback to commit 669856c provides temporary stability
- **LIMITATION**: Cloudinary caching system only works when YouTube download succeeds

## Timeline
| Date       | Milestone                               |
|------------|-----------------------------------------|
| 2025-07-06 | **CURRENT**: Cloudinary audio caching implementation |
| 2025-07-06 | YouTube signature extraction failures encountered |
| 2025-07-05 | Database & Cloud Storage Integration |
| 2025-07-04 | Rollback to stable commit 669856c |
| 2025-07-04 | Technical stack analysis completed |
| 2025-04-07 | All critical fixes completed - WhisperX compute type & Demucs segment fixes |
| 2025-04-07 | Demucs segment integer fix (7.8 → 7) implemented |
| 2025-04-07 | WhisperX compute type fix (float16 → int8) implemented |
| 2025-04-07 | Dual deployment architecture fully operational |
| 2025-03-07 | Railway signal handling fix implemented |
| 2025-03-07 | WhisperX CLI argument parsing resolved |
| 2025-03-07 | Migration from Hugging Face Spaces to Railway + Fly.io |
| 2025-07-03 | WhisperX forced alignment implementation |
| 2025-07-02 | Demucs PATH fix and 403 error handling |
| 2025-01-30 | Enhanced audio processing pipeline |