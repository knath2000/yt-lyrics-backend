---
Date: 2025-01-07
TaskRef: "Comprehensive System Analysis - Frontend and Backend Understanding"

## System Architecture Understanding

### Overall System Flow
The YouTube Lyrics Transcription system follows a clean separation between frontend (Next.js) and backend (Express.js) with the following flow:

1. **Frontend (Next.js)**: User submits YouTube URL via JobForm component
2. **Backend API**: Creates job in database and queues it for processing
3. **Queue Worker**: Separate process polls database for queued jobs
4. **TranscriptionWorker**: Processes jobs through multi-step pipeline
5. **Results Storage**: Final results uploaded to Cloudinary and stored in database
6. **Frontend Display**: ResultsViewer fetches and displays completed transcriptions

### Backend Architecture Deep Dive

#### Core Components
- **Express Server** (`src/index.ts`): Main API server with CORS, rate limiting, health checks
- **Queue Worker** (`src/queue-worker.ts`): Separate polling process for job processing
- **TranscriptionWorker** (`src/worker.ts`): Core processing engine with cleanup capabilities
- **Database Layer** (`src/db.ts`): PostgreSQL connection with proper pool management
- **Job Routes** (`src/routes/jobs.ts`): RESTful API endpoints for job management

#### Processing Pipeline (TranscriptionWorker)
1. **Download**: YtDlpDownloader with 4-tier fallback strategy
2. **Audio Processing**: Optional Demucs vocal separation (memory-safe mode aware)
3. **Transcription**: OpenAI Whisper (configurable model, default gpt-4o-mini-transcribe)
4. **Alignment**: WhisperX for precise word-level timestamps
5. **Post-processing**: WordAligner generates SRT and plain text formats
6. **Storage**: Upload to Cloudinary, update database with results

#### Key Technical Patterns
- **Resilient Downloads**: 4-step fallback strategy (authenticated/unauthenticated × m4a/best)
- **Memory Management**: Demucs processor with memory-safe mode for long audio
- **Progress Tracking**: Real-time updates via in-memory jobProgress Map
- **Graceful Shutdown**: Proper cleanup of active jobs and temp files
- **Error Handling**: Comprehensive error capture and database logging

### Frontend Architecture Deep Dive

#### Core Components
- **JobForm** (`components/JobForm.tsx`): Main user interface with real-time progress
- **ResultsViewer** (`components/ResultsViewer.tsx`): Multi-format result display
- **API Layer** (`lib/api.ts`): Centralized backend communication
- **Layout** (`app/layout.tsx`): Global app structure and styling

#### User Experience Flow
1. **Job Submission**: URL validation and job creation
2. **Progress Monitoring**: Real-time polling with visual progress indicators
3. **Result Display**: Three view modes (SRT, Plain Text, Word-by-Word)
4. **Download Options**: SRT and TXT file downloads
5. **Session Management**: Clean reset for new transcriptions

#### Key UI Patterns
- **Progressive Enhancement**: Visual progress bar with stage markers
- **Real-time Updates**: 1-second polling during processing
- **Error Boundaries**: Comprehensive error handling and user feedback
- **Responsive Design**: Mobile-friendly interface with Tailwind CSS

### Data Flow and State Management

#### Backend State
- **Database**: Persistent job storage with status tracking
- **In-Memory**: Real-time progress via jobProgress Map
- **File System**: Temporary processing files with cleanup
- **Cloud Storage**: Final results on Cloudinary

#### Frontend State
- **Component State**: Local UI state management
- **API Communication**: RESTful endpoints for all operations
- **Polling Strategy**: Adaptive polling based on job status
- **Error Handling**: User-friendly error messages and recovery

### Integration Points

#### API Endpoints
- `POST /api/jobs`: Create new transcription job
- `GET /api/jobs/:id`: Get job status and results
- `GET /api/jobs/:id/progress`: Real-time progress updates
- `GET /api/jobs/:id/result`: Redirect to Cloudinary results

#### External Services
- **OpenAI**: Whisper transcription service
- **Cloudinary**: File storage and CDN
- **PostgreSQL**: Job persistence and metadata
- **YouTube**: Source audio via yt-dlp

### Deployment Architecture
- **Frontend**: Vercel deployment with environment-based backend URL
- **Backend**: Railway deployment with PostgreSQL and Redis
- **Processing**: CPU-optimized with memory-safe modes
- **Storage**: Cloudinary for results, local temp for processing

## Key Insights and Patterns

### Resilience Strategies
1. **Multi-tier Download Fallback**: Handles YouTube anti-scraping measures
2. **Memory-Safe Processing**: Adapts to server constraints
3. **Graceful Degradation**: Continues processing even if optional steps fail
4. **Comprehensive Error Handling**: User-friendly error messages

### Performance Optimizations
1. **Separate Queue Worker**: Prevents API blocking during processing
2. **Real-time Progress**: In-memory tracking for responsive UI
3. **Efficient Polling**: Adaptive polling frequency based on status
4. **Resource Cleanup**: Proper temp file and process management

### Scalability Considerations
1. **Stateless API**: Enables horizontal scaling
2. **External Storage**: Cloudinary for result persistence
3. **Database Pooling**: Efficient connection management
4. **Queue-based Processing**: Handles concurrent job processing

## Technical Debt and Improvement Areas

### Current Limitations
1. **Single Worker**: Only one queue worker instance
2. **CPU-bound Processing**: Limited by single-threaded operations
3. **Memory Constraints**: Demucs processing limited by available RAM
4. **Error Recovery**: Limited retry mechanisms for failed jobs

### Potential Enhancements
1. **Horizontal Scaling**: Multiple worker instances
2. **Job Prioritization**: Queue management with priorities
3. **Caching**: Result caching for duplicate URLs
4. **Monitoring**: Enhanced observability and metrics

---
Date: 2025-07-06
TaskRef: "Implement YouTube Audio Caching with Cloudinary"

Learnings:
- Successfully implemented Cloudinary-based caching system for YouTube audio extraction
- Created a robust videoId extraction function that handles all common YouTube URL formats
- Discovered that Node.js ESM imports require explicit file extensions (e.g., `.js`) in production
- Added multiple fallback download strategies to handle YouTube's evolving anti-bot measures
- Implemented a cache-first approach that checks Cloudinary before attempting YouTube downloads

Difficulties:
- YouTube's June 2025 signature extraction changes broke standard yt-dlp download approaches
- Error "Cannot find module '/home/app/dist/cloudinary'" revealed differences between TypeScript compilation and runtime module resolution
- "Signature extraction failed: Some formats may be missing" and "Only images are available" errors indicate YouTube's anti-bot measures are becoming more aggressive
- Docker container symlink approach for yt-dlp binary didn't resolve the signature extraction issues
- Rolling back to previous stable commit (669856c) was ultimately required to restore functionality

Successes:
- Cloudinary integration for audio caching works correctly when YouTube download succeeds
- Robust videoId extraction function handles all URL formats consistently
- Multi-strategy fallback chain provides improved resilience against YouTube format changes
- Proper file extension handling in imports resolved the module resolution errors

Improvements_Identified_For_Consolidation:
- Pattern: Cloud-Based Media Caching with Cloudinary
- Pattern: Multi-Strategy Fallback Chain for YouTube Downloads
- Pattern: Robust Video ID Extraction from various URL formats
- Issue: YouTube Signature Extraction Failures and mitigation strategies
- Pattern: Consistent Module Path Resolution in Node.js ESM environments
---
---
Date: 2025-07-09
TaskRef: "Stabilize RunPod Worker & Fix Railway Build Failures"

Learnings:
- Node 20 enforces JSON import assertions; `runpod-sdk` imports its own `package.json` without `assert { type: "json" }`, causing `ERR_IMPORT_ASSERTION_TYPE_MISSING` runtime errors.
- `npm ci` fails if `package.json` and `package-lock.json` diverge (validation introduced in npm v8.6.0+) [[#5125](https://github.com/npm/cli/issues/5125)].
- Hand-editing `package.json` without regenerating the lockfile triggers the above `npm ci` EUSAGE error during Railway’s Docker build layer.
- `patch-package` is an effective short-term way to monkey-patch a 3rd-party library in CI while waiting for an upstream fix.

Steps Completed:
1. **RunPod Worker Runtime Fix**
   - Added `patch-package` & dev script to backend `package.json`.
   - Created `patches/runpod-sdk+1.1.1.patch` adding JSON import assertion.
   - Verified patch applies during postinstall locally and in CI.
2. **Lockfile & Build Fix**
   - Removed obsolete `postinstall-postinstall` (which broke local `npm install`).
   - Clean-reinstalled deps (`npm install --ignore-scripts`), regenerated fresh `package-lock.json`.
   - Ensured `npm ci` now succeeds (tested locally).
3. **Git Operations**
   - Committed and pushed changes (`621cc49`).
   - Triggered new Railway deploy expected to pass `[node-builder 4/7] RUN npm ci` step.
4. **Tooling**
   - Added TODO tracking via cursor todo list for each sub-task.

Difficulties:
- The initial patch file was malformed; `patch-package` failed to parse it during CI.
- Local `npm install` failed due to `postinstall-postinstall` executing its own nested scripts.

Successes:
- Verified clean `npm ci` run including patch application.
- Patch applied at runtime fixes RunPod worker startup.
- Pushed fix to main; Railway redeploy started.

Improvements_Identified_For_Consolidation:
- Pattern: Using `patch-package` to hot-fix third-party library import issues.
- Practice: Always regenerate lockfile after `package.json` edits to satisfy npm ci validation.
- Diagnostic: Replicating Docker build steps (`npm ci`) locally catches lockfile drift early.
---