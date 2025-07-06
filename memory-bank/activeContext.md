# Active Context - Backend

_Last updated: 2025-12-07_

## Current Focus
- **MAJOR ROLLBACK COMPLETED**: Successfully rolled back to commit 34e90b3 to remove problematic features
- **CODEBASE CLEANUP**: Removed Cloudinary audio caching system and download.ts utility that were causing issues
- **STABLE FOUNDATION**: Restored to a known working state before recent problematic implementations

## Current Deployment Status

### Railway Deployment
- **URL**: `https://yt-lyrics-backend-production.up.railway.app`
- **Status**: 🔄 NEEDS REDEPLOYMENT (after rollback to commit 34e90b3)
- **Configuration**: Uses Railway's container platform with automatic scaling
- **Signal Handling**: Fixed with direct Node.js execution (`node dist/index.js`)

### Deployment Platform – Railway **only**
We have sunset the Fly.io deployment. The backend is **exclusively** hosted on Railway now.
 - **URL**: `https://yt-lyrics-backend-production.up.railway.app`
 - **Scaling**: Automatic container scaling via Railway settings
 - **Health**: `/health` endpoint used for readiness & liveness probes
 - **Notes**: Any Fly.io references are deprecated and should be ignored.

## Recent Major Changes

### ✅ CRITICAL: Major Rollback to Commit 34e90b3 (2025-12-07)
- **Issue**: Recent implementations (Cloudinary caching, download.ts utility) were causing system instability
- **Solution**: Performed hard reset to commit 34e90b3 to restore stable foundation
- **Process**:
  - `git reset --hard 34e90b3`
  - `git clean -fd` to remove untracked files
  - Removed problematic files: `download.ts`, `playDlDownloader.ts`, `hybridDownloader.ts`
- **Result**: Restored to known working state before problematic implementations
- **Impact**: System now back to stable foundation, ready for careful incremental improvements

### ❌ REMOVED: Cloudinary Audio Caching System (2025-12-07)
- **Reason**: System was causing complications and instability
- **Removed Features**:
  - Cloud-based audio caching
  - Complex videoId extraction logic
  - Cache-first download approach
- **Impact**: Simplified system architecture, removed potential failure points
- **Status**: Completely removed in rollback

### ❌ REMOVED: Complex Download Utilities (2025-12-07)
- **Reason**: Multiple download strategies were adding complexity without solving core issues
- **Removed Files**:
  - `src/utils/download.ts` - Complex download orchestration
  - `src/utils/playDlDownloader.ts` - Alternative download strategy
  - `src/utils/hybridDownloader.ts` - Hybrid approach
- **Impact**: Simplified to core yt-dlp functionality only
- **Status**: Reverted to simpler, more reliable approach

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

### Audio Processing Pipeline (Post-Rollback)
- **Stage 1: YouTube Download**
  - **Tool**: yt-dlp (Python CLI) via ytDlpDownloader.ts
  - **Configuration**: Basic yt-dlp implementation without complex fallback chains
  - **Status**: Simplified to core functionality only

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
  - **Organization**: Structured folders (`transcriptions/{jobId}/results`, `transcriptions/{jobId}/subtitles`)
  - **Access**: Secure URL generation for frontend consumption
  - **Permanence**: Results stored permanently in cloud
  - **Status**: Audio caching removed in rollback

## Next Steps

### Immediate Priorities
1. **Redeploy Services**: Update Railway and Fly.io deployments with rollback code
2. **Test Core Functionality**: Verify basic transcription pipeline works after rollback
3. **Monitor Stability**: Ensure rollback resolves previous issues

### Future Enhancements (Careful Incremental Approach)
1. **Gradual Feature Re-introduction**: Carefully add back beneficial features one at a time
2. **Improved Testing**: Implement comprehensive testing before adding new features
3. **Monitoring Enhancement**: Add better observability to catch issues early

## Known Issues
- **DEPLOYMENT**: Both Railway and Fly.io need redeployment with rollback code
- **TESTING NEEDED**: Core functionality needs verification after rollback
- **FEATURE LOSS**: Some beneficial features removed in rollback (to be carefully re-added)

## Timeline
| Date       | Milestone                               |
|------------|-----------------------------------------|
| 2025-12-07 | **CURRENT**: Major rollback to commit 34e90b3 completed |
| 2025-12-07 | Removed Cloudinary caching and complex download utilities |
| 2025-12-07 | Codebase cleanup and stabilization |
| 2025-07-06 | Cloudinary audio caching implementation (now removed) |
| 2025-07-06 | YouTube signature extraction failures encountered |
| 2025-07-05 | Database & Cloud Storage Integration |
| 2025-07-04 | Previous rollback to stable commit 669856c |
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