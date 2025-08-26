# Technical Context - Backend

_Last updated: 2025-08-25_

This document is reconciled to the current codebase and deployment state.

## Deployment Architecture

- **Railway (primary for frontend usage)**: `https://web-production-5905c.up.railway.app`
- **Modal GPU Endpoint**: `https://knath2000--youtube-transcription-transcribe-youtube.modal.run`
<!-- Fly.io deployment deprecated; fully migrated to Railway/Modal -->

Both expose the same API surface. The frontend defaults to the Railway host and can override via env.

## Technology Stack

- **Node.js (TypeScript)** with Express.js
- **Python toolchain** for `yt-dlp`, `demucs`, and `whisperx`
- **PostgreSQL** for job persistence
- **Cloudinary** for result storage (JSON/SRT)
- **TypeScript** for build-time type checking and compilation
- **Modal** for GPU-accelerated transcription processing

## Audio Processing Pipeline

1. **YouTube Download (yt-dlp)**
   - Explicit player-client strategies are attempted in sequence:
     - `authenticated-tv`, `authenticated-ios`, `authenticated-web` (when cookies available)
     - `unauth-tv`, `unauth-ios`, `unauth-web`
   - Cookie support via temporary file hydrated from `YOUTUBE_COOKIES_CONTENT` or startup cookie jar
   - Cache-first lookup in Cloudinary under `audio/{videoId}/bestaudio_mp3`
2. **Vocal Separation (Demucs)**
   - Default model `htdemucs_ft`, memory-safe mode optional for constrained environments
3. **Transcription (OpenAI)**
   - Presets map to model IDs:
     - `regular` → `gpt-4o-mini-transcribe`
     - `high` → `gpt-4o-transcribe`
     - `low` → `whisper-large-v3-transcribe`
4. **Word Alignment (WhisperX)**
   - Used when needed to produce word-level timestamps (SRT + JSON)

GPU offload to Modal is performed via a public web endpoint from the queue worker; local fallback remains possible if GPU path is unavailable.

## API Endpoints

- `GET /health` – Health check (includes DB setup status)
- `GET /metrics` – Basic runtime metrics
- `POST /api/jobs` – Create a job (`{ youtubeUrl, preset? }`)
- `GET /api/jobs/:id` – Get job status (DB or in-memory)
- `GET /api/jobs/:id/progress` – Real-time progress metadata
- `GET /api/jobs/:id/steps` – Detailed step tracking
- `GET /api/jobs/:id/result` – Returns/redirects to Cloudinary JSON results
- `POST /api/corrections` – Submit transcript corrections (auxiliary)

## Environment Variables

```bash
# Required
OPENAI_API_KEY=...               # Transcription
DATABASE_URL=...                 # PostgreSQL
CLOUDINARY_URL=cloudinary://...  # Cloudinary
PORT=4000

# Optional
NODE_ENV=production
RAILWAY_ENVIRONMENT=true
DEMUCS_MEMORY_SAFE=true          # Enable memory-safe mode
YOUTUBE_COOKIES_CONTENT="..."     # Netscape cookie file content for authenticated methods
FRONTEND_ORIGIN="https://your-frontend.vercel.app"  # Additional CORS allowlist entry
```

## CORS

Regex/string allowlist with optional `FRONTEND_ORIGIN`; `OPTIONS` handled. Current configuration includes:
- Localhost development
- Vercel deployments (*.vercel.app)
- Render deployments (*.onrender.com)
- Custom frontend origin via FRONTEND_ORIGIN environment variable

## Performance & Reliability

- Cache-first audio lookup in Cloudinary
- In-memory progress bridge + DB persistence
- Graceful shutdown and cleanup of worker resources
- TypeScript compilation for build-time error checking

## Development & Deployment

- `npm run build` then container deploy (Railway)
- Health checks validate DB connectivity and table setup
- Multi-stage Docker build with Python and Node.js stages
- Production deployment uses `node dist/index.js` as entrypoint
