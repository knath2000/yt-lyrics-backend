# Active Context - Backend

_Last updated: 2025-01-15_

## Current Focus
- **✅ CORRECT ARCHITECTURE**: Fly.io handles YouTube downloads, Modal handles all transcription processing
- **✅ DOWNLOAD HIERARCHY**: Fly.io attempts YouTube download first, Modal fallback if Fly.io fails
- **✅ PROCESSING SEPARATION**: Fly.io focuses on orchestration and downloads, Modal handles GPU transcription
- **✅ YOUTUBE COOKIES**: QueueWorker initializes cookie jar from `YOUTUBE_COOKIES_CONTENT` Fly secret enabling authenticated yt-dlp strategies
- **✅ DATABASE INTEGRATION**: Fly backend uses PostgreSQL database for job persistence and status tracking

## Current Deployment Status

### Fly.io Deployment (Primary)
- **URL**: `https://yt-lyrics-backend.fly.dev`
- **Status**: 🟢 Active – Optimized Modal GPU-first processing
- **Database**: Uses PostgreSQL database via `DATABASE_URL` Fly secret
- **Scaling**: Auto-start/stop machines; 0-1 shared CPU (optimized for orchestration only)
- **Health**: `/health` endpoint checks every 30 s
- **GPU Processing**: Primary path via Modal when `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` are configured

## Recent Session Work (2025-01-15)

### ✅ ARCHITECTURAL CORRECTION: Proper Fly.io + Modal Separation
- **ACHIEVEMENT**: Implemented correct architecture with Fly.io handling downloads, Modal handling processing
- **DOWNLOAD STRATEGY**: Fly.io attempts YouTube download first, Modal provides fallback download capability
- **PROCESSING SEPARATION**: Clear separation of concerns between download orchestration and GPU processing
- **RELIABILITY**: Dual download paths ensure high success rates even with YouTube blocking

#### Technical Implementation:
1. **Download Hierarchy**:
   - Fly.io attempts YouTube download using authenticated yt-dlp strategies
   - If successful, audio uploaded to Cloudinary for Modal access
   - If failed, Modal attempts download as fallback using its own yt-dlp

2. **Processing Pipeline**:
   - Modal receives either pre-downloaded audio URL or YouTube URL for fallback
   - All transcription processing (Demucs, Whisper, alignment) handled by Modal GPU
   - Results uploaded to Cloudinary and returned to Fly.io for database updates

3. **Resource Optimization**:
   - Fly.io focused on API orchestration, database management, and YouTube downloads
   - Modal GPU handles all compute-intensive transcription tasks
   - Clear separation eliminates redundant processing logic

### ✅ AUTHENTICATION: YouTube Cookie Support
- **IMPLEMENTATION**: QueueWorker initializes cookie jar from `YOUTUBE_COOKIES_CONTENT` Fly secret
- **BENEFIT**: Enables authenticated yt-dlp download strategies
- **IMPACT**: Significantly improved success rates for YouTube downloads
- **CONFIGURATION**: Requires Fly secret with browser cookies in Netscape format

## Technical Stack Details (Current State)

### Audio Processing Pipeline - Correct Architecture
- **Stage 1: Download Orchestration (Fly.io)** 
  - **YouTube Download**: Fly.io attempts authenticated yt-dlp download first
  - **Audio Upload**: Successful downloads uploaded to Cloudinary for Modal access
  - **Fallback Coordination**: Failed downloads trigger Modal fallback processing

- **Stage 2: GPU Processing (Modal)**
  - **Audio Acquisition**: Receives either Cloudinary audio URL or YouTube URL for fallback download
  - **Faster-Whisper**: GPU-optimized transcription with local models
  - **Demucs**: GPU-accelerated vocal separation
  - **WhisperX**: Enhanced word-level timestamp alignment
  - **Result Upload**: Direct upload to Cloudinary from Modal

- **Stage 3: Result Coordination (Fly.io)**
  - **Database Update**: Fly backend updates job status and result URLs
  - **Frontend Access**: Same API endpoints provide results
  - **Progress Tracking**: Real-time updates through efficient polling

### Database Integration
- **PostgreSQL**: Persistent job storage with status tracking
- **Connection Pooling**: Efficient database connection management
- **Result Storage**: Cloudinary URLs stored in `results_url` field
- **Error Handling**: Comprehensive error logging in `error_message` field