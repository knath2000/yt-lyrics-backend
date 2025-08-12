---
Date: 2025-08-12
TaskRef: "Align docs with code; set new Railway URL"

Learnings:
- Frontend uses `ModelPreset` and expects `/api/jobs`, `/progress`, `/steps`, `/result` endpoints.
- Default backend URL should be Railway; updated to `https://web-production-5905c.up.railway.app`.
- Backend docs had merge markers; unified to explicit yt-dlp client strategies with cookie support and Cloudinary cache-first.

Difficulties:
- Conflicting narratives across memory files (single backend vs racing); resolved minimally without large rewrites.

Successes:
- Updated frontend code and docs to new env var name and default URL; fixed header health link.
- Cleaned backend techContext and backend README endpoints.

Improvements_Identified_For_Consolidation:
- Pattern: Keep env var naming consistent across repos (`NEXT_PUBLIC_BACKEND_URL`).
- Pattern: Document `/progress` and `/steps` explicitly for clients.
---
<<<<<<< HEAD
=======
Date: 2025-08-12
TaskRef: "Reconcile memory banks across frontend and backend"

Learnings:
- Frontend currently uses a single Railway backend with a `ModelPreset` dropdown (regular/high), posting `{ youtubeUrl, preset }` and polling `/progress`.
- Backend uses explicit yt-dlp player client strategies (`authenticated/unauth` × `tv/ios/web`) with optional cookies from `YOUTUBE_COOKIES_CONTENT`.
- Cloudinary cache-first pattern is active for audio (`audio/{videoId}/bestaudio_mp3`).
- Modal GPU is invoked via public function URL (no SDK/token in code path); local fallback uses OpenAI + WhisperX.
- Env var naming on frontend is `NEXT_PUBLIC_BACKEND_URL` (not `NEXT_PUBLIC_API_BASE`).

Difficulties:
- Memory docs referenced dual-backend racing and removed quality tiers, diverging from current code using presets and single backend.
- Backend tech doc suggested simplified single unauth strategy; code implements explicit multi-strategy with cookies.

Successes:
- Updated both memory banks to reflect actual code paths, env vars, endpoints, and presets.
- Captured downloader strategy and Modal web endpoint usage clearly.

Improvements_Identified_For_Consolidation:
- Pattern: Explicit yt-dlp player-client switching with cookie-gated authenticated methods.
- Pattern: API-driven GPU offload via public function endpoint with progress mapping.
- Convention: Standardize frontend env var to `NEXT_PUBLIC_BACKEND_URL` in docs.
---
Date: 2025-08-12
TaskRef: "Front-end Liquid Glass UI, Vercel pnpm alignment, MCP integrations"

Learnings:
- Frontend overhaul requires updating page/layout/components plus global CSS; verify output contains signature classes via curl.
- Vercel can serve old builds when Production Overrides mismatch (npm vs pnpm); align to pnpm and redeploy without cache.
- For Next.js App Router, `app/layout.tsx` importing `app/globals.css` is sufficient for global styling.
- MCP servers can be connected via SSE (Glama) or Node-based stdio through `~/.cursor/mcp.json`.

Difficulties:
- Stale-looking production despite redeploy: caused by npm build commands and cached artifact.
- Local EADDRINUSE on port 3000: resolved by killing the existing process or using another port.

Successes:
- Implemented Liquid Glass tokens/utilities and upgraded UI components; verified locally.
- Standardized Vercel to pnpm with `pnpm-lock.yaml` and `vercel.json` commands.
- Added `sequentialthinking-tools` and ensured Perplexity Ask MCP entries in `~/.cursor/mcp.json`.

Improvements_Identified_For_Consolidation:
- Pattern: Keep package manager consistent across local/CI; commit lockfile and set build commands.
- Pattern: Confirm deployment by inspecting deployment Source (/_src) for new classes.
---
>>>>>>> 339124e (fix(runtime): remove 'exec' from start; Dockerfile CMD node dist/index.js; robust CORS (regex allowlist + OPTIONS))
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
---
Date: 2025-07-09
TaskRef: "Fix Modal deploy – add git to apt_install & fallback yt-dlp install"

Learnings:
- Modal images need `git` installed when `pip install git+https://...` is used.
- Adding `git` via `image.apt_install("git")` resolves `Cannot find command 'git'` errors.
- Providing a fallback `pip install yt-dlp` after the GitHub install (`command || fallback`) guards against GitHub downtime.

Difficulties:
- Modal deploy failed during image build at `pip install` step due to missing `git`.
- Logs were lengthy; required identifying the specific failure line.

Successes:
- Added `git` to apt packages and fallback install command.
- Image built successfully and Modal deploy completed.

Improvements_Identified_For_Consolidation:
- Pattern: Always include `git` in apt packages when installing Python packages directly from GitHub.
- Pattern: Use `cmd || fallback` in `run_commands` to provide resilient image builds.
---
---
Date: 2025-07-10
TaskRef: "Fix Fly.io crash – Missing jade runtime for modal JS SDK"

Learnings:
- `modal` JS SDK requires `jade/lib/runtime.js` at runtime.
- Fly container crashed with `MODULE_NOT_FOUND` causing endless restart loop.
- Adding `jade@1.11.0` to backend dependencies resolves the issue.
- `npm ci` requires package-lock to be in sync; running `npm install jade --save` locally regenerates lockfile.

Difficulties:
- Error surfaced only in Fly environment; local dev succeeded because node_modules already had jade via transitive dependency.
- Had to recall previous lockfile mismatch issues to regenerate lockfile properly.

Successes:
- Installed jade and committed updated `package.json` and `package-lock.json`.
- Fly deploy will rebuild image with jade, preventing crash.

Improvements_Identified_For_Consolidation:
- Pattern: When adding new dependency for runtime fix, always update lockfile to satisfy `npm ci`.
- Pattern: Investigate runtime stack traces to identify missing indirect dependencies.
---
---
Date: 2025-07-10
TaskRef: "Enable authenticated YouTube downloads on Fly by wiring cookies into QueueWorker"

Learnings:
- QueueWorker instantiated TranscriptionWorker without cookie file, so authenticated yt-dlp methods were skipped on Fly.
- initializeCookieJar() writes cookies.txt from YOUTUBE_COOKIES_CONTENT env secret; passing its path enables `authenticated-*` strategies.
- Added import and call to initializeCookieJar() inside QueueWorker constructor and passed cookieFilePath to TranscriptionWorker.
- Requires Fly secret `YOUTUBE_COOKIES_CONTENT` set with exported browser cookies in Netscape format.

Difficulties:
- Error surfaced as unauthenticated download failure; required code search to confirm missing cookie path.
- Must ensure secret exists in Fly environment; otherwise code still falls back.

Successes:
- Code edit allows authenticated yt-dlp methods including `unauth-ios` and `authenticated-ios` where cookies available.
- Expect significant improvement in download success rate on Fly.

Improvements_Identified_For_Consolidation:
- Pattern: Always pass cookie jar path to workers that rely on yt-dlp authentication when secrets available.
- Practice: initializeCookieJar() should be invoked in any process that performs downloads.
---
---
Date: 2025-07-10
TaskRef: "Enable Fly → Modal offload and fix function name mismatch"

Learnings:
- Fly backend now offloads transcription jobs to Modal when `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` secrets are present.
- `ModalClient` defaulted to `<app>.transcribe_audio` but deployed Modal function is `transcribe_youtube` under app `youtube-transcription`.
- Updated `ModalClient` constructor to accept optional `appName` and `functionName` with new defaults (`youtube-transcription.transcribe_youtube`).
- No API changes required; QueueWorker automatically uses Modal when credentials exist.

Difficulties:
- Modal function naming mismatch caused 404 error (`FunctionNotFound`) during runtime.
- Needed to ensure code change doesn’t break existing local processing path.

Successes:
- Jobs are successfully executed on Modal GPU backend; Fly worker waits for completion and stores Cloudinary result.
- Verified end-to-end flow: frontend → Fly API → Modal GPU → Cloudinary → DB → frontend.

Improvements_Identified_For_Consolidation:
- Pattern: Parameterize external function identifiers to avoid hard-coded names.
- Practice: Keep serverless function names consistent between code and infra.