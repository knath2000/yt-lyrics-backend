# Project Brief - YouTube Lyrics Backend

## Purpose & Scope

_Describe the primary purpose of the backend (e.g., expose API endpoints that download YouTube audio, run transcription/alignment pipeline, and serve results to the frontend)._  

## Core Requirements
- Expose REST endpoints under `/api/jobs` for job creation, status polling, and result retrieval.
- Handle long-running transcription jobs via `TranscriptionWorker` pipeline.
- Store interim files in local `temp/` (future: S3).

## Success Criteria
- Jobs reliably progress from queued → processing → done.
- Error handling returns clear messages with HTTP codes.
- API usable by the Next.js frontend out-of-the-box on localhost. 