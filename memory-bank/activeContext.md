# Active Context - Backend

_Last updated: 2025-01-15_

## Current Focus
- **✅ FIXED**: RunPod integration result propagation and worker termination
- **RUNPOD INTEGRATION**: Backend now properly handles RunPod job completion and uploads results to Cloudinary
- **WORKER TERMINATION**: Added auto_terminate signal to prevent credit drain from idle RunPod workers
- **DATABASE SYNC**: RunPod results now properly update Railway database for frontend access
- **SESSION STATUS**: Ready for testing RunPod → Railway → Frontend flow
- **✅ FLY BACKEND CRASH FIX**: Added `jade` dependency to resolve Modal SDK runtime error; Fly backend now stable.
- **✅ YOUTUBE COOKIES**: QueueWorker now initializes cookie jar from `YOUTUBE_COOKIES_CONTENT` Fly secret enabling authenticated yt-dlp strategies on Fly backend.

## Current Deployment Status

### Railway Deployment
- **URL**: `https://yt-lyrics-backend-production.up.railway.app`
- **Status**: 🟡 ENHANCED - RunPod integration fixes implemented
- **Configuration**: Uses Railway's container platform with automatic scaling
- **Signal Handling**: Fixed with direct Node.js execution (`node dist/index.js`)

### Deployment Platforms – Railway + Fly.io
We have sunset the Fly.io deployment. The backend is **exclusively** hosted on Railway now.
 - **URL**: `https://yt-lyrics-backend-production.up.railway.app`
 - **Scaling**: Automatic container scaling via Railway settings
 - **Health**: `/health` endpoint used for readiness & liveness probes
 - **Notes**: Any Fly.io references are deprecated and should be ignored.

### Fly.io Deployment
- **URL**: `https://yt-lyrics-backend.fly.dev`
- **Status**: 🟢 Active – Modal GPU integration operational
- **Database**: Uses Railway Postgres via `DATABASE_URL` Fly secret (`fly secrets set DATABASE_URL=...`)
- **Scaling**: Auto-start/stop machines; 0-1 shared CPU
- **Health**: `/health` endpoint checks every 30 s
- **Notes**: Fly deployment re-enabled 2025-07-10 after adding DB env var; resolves previous `ECONNREFUSED 127.0.0.1:5432` crash loop.

## Recent Session Work (2025-01-15)

### ✅ FIXED: RunPod Result Propagation and Worker Termination
- **PROBLEM**: RunPod jobs completed successfully but results weren't saved to Railway database
- **PROBLEM**: RunPod workers continued running after completion, draining credits unnecessarily
- **SOLUTION**: Enhanced `queue-worker.ts` with proper result handling and worker termination

#### Code Changes Made:
1. **Added `uploadRunPodResultsToCloudinary()` helper function**:
   - Uploads JSON results to `transcriptions/{jobId}/results`
   - Uploads SRT subtitles to `transcriptions/{jobId}/subtitles`
   - Returns secure Cloudinary URL for database storage

2. **Enhanced RunPod job completion flow**:
   - Checks if RunPod already provided `resultUrl` (direct Cloudinary upload)
   - Falls back to uploading results ourselves if needed
   - **CRITICAL**: Updates database with `status = 'completed'` and `results_url`
   - Maintains in-memory progress tracking for real-time API access

3. **Added worker termination signal**:
   - `auto_terminate: true` flag sent to RunPod worker
   - Enhanced logging for job status tracking
   - Better error handling and validation

#### Impact:
- **Frontend Integration**: RunPod jobs now appear as completed in frontend
- **Cost Optimization**: Workers terminate after completion, preventing credit drain
- **Reliability**: Proper error handling and result validation
- **Consistency**: Same result format whether processed locally or via RunPod

### 🎯 RunPod Worker Requirements (for completion)
The RunPod worker Python/Node.js code should:
1. **Accept `auto_terminate` input parameter** and call `os._exit(0)` or `process.exit(0)` when done
2. **Alternative**: Enable "Auto-stop after X min idle" in RunPod dashboard settings
3. **Return proper result format**:
   ```json
   {
     "words": [...],
     "srt": "subtitle content",
     "plain": "plain text",
     "resultUrl": "optional_cloudinary_url"
   }
   ```

### ❌ PREVIOUS ISSUE: YouTube Bot Detection (Background Issue)
- **STATUS**: Secondary priority - RunPod may bypass some YouTube restrictions
- **FALLBACK**: Local processing still available as backup
- **MONITORING**: Track success rates for both RunPod and local processing

## Technical Stack Details (Current State)

### Audio Processing Pipeline - RunPod Integration
- **Stage 1: Job Routing** 
  - **QueueWorker**: Checks for RunPod config, routes accordingly
  - **RunPod Path**: Offloads to serverless endpoint via API
  - **Local Path**: Uses TranscriptionWorker as before

- **Stage 2: Result Handling**
  - **RunPod Results**: Upload to Cloudinary → Update database
  - **Local Results**: Direct database update (existing flow)
  - **Frontend Access**: Same API endpoints work for both paths

### Database Integration
- **Jobs Table**: Stores job metadata, status, and result URLs
- **Status Tracking**: In-memory progress for real-time updates
- **Result Storage**: Cloudinary URLs in `results_url` field
- **Error Handling**: Proper error messages in `error_message` field

## Next Steps Required

### Immediate Testing
1. **Test RunPod → Railway Flow**:
   - Submit job via frontend
   - Verify RunPod processing
   - Confirm results appear in frontend
   - Check worker termination in RunPod dashboard

2. **Monitor Credit Usage**:
   - Verify workers stop after completion
   - Track processing times vs costs
   - Compare local vs RunPod performance

### Future Enhancements
1. **Intelligent Routing**: Route based on job complexity or current load
2. **Performance Metrics**: Track success rates and processing times
3. **Cost Optimization**: Dynamic endpoint selection based on credit balance

## Timeline Update
| Date       | Milestone                               |
|------------|-----------------------------------------|
| 2025-01-15 | **CURRENT**: RunPod integration fixes implemented - ready for testing |
| 2025-01-15 | Fixed result propagation and worker termination issues |
| 2025-01-15 | Enhanced queue worker with Cloudinary upload helper |
| 2025-12-08 | Cloudinary cache restoration and downloader bug fixes |
| 2025-12-07 | Major rollback to commit 34e90b3 completed |

## Known Issues
- **TESTING REQUIRED**: RunPod → Railway → Frontend flow needs validation
- **WORKER TERMINATION**: RunPod worker code needs auto_terminate implementation
- **MONITORING**: Need to track credit usage and worker lifecycle

- **✅ MODAL DEPLOYMENT**: Fixed container build by adding `git` to apt packages and fallback yt-dlp install; GPU transcription function now deploys successfully.