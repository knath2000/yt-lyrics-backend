# Project Brief - YouTube Lyrics Backend

## Purpose & Scope

The primary purpose of the backend is to expose API endpoints that securely download YouTube audio (handling authentication, anti-bot measures, and `demucs` integration), run a robust transcription/alignment pipeline, and serve results to the frontend.

## Core Requirements
- Expose REST endpoints under `/api/jobs` for job creation, status polling, and result retrieval.
- Securely handle YouTube audio downloads, including authenticated and age-restricted content, with `yt-dlp` cache clearing and format flexibility.
- Handle long-running transcription jobs via a `TranscriptionWorker` pipeline, ensuring `demucs` availability for vocal separation.
- Store interim files in local `temp/` (future: S3).

## Success Criteria
- Jobs reliably progress from queued → processing → done, even for challenging YouTube URLs, with accurate `demucs` processing.
- Error handling returns clear messages with HTTP codes, providing actionable feedback, including for JSON result retrieval.
- API usable by the Next.js frontend out-of-the-box on localhost and deployed environments.
- Robustness against YouTube's evolving anti-bot and authentication mechanisms.