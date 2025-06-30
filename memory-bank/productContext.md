# Product Context - Backend

## Why This Exists
The backend provides heavy-lifting processing that would be impossible (or cost-inefficient) directly from the browser. It encapsulates:
1. Reliable YouTube audio download (yt-dlp fallback).
2. Optional vocal separation (Demucs).
3. Whisper transcription with word-level timestamps.
4. Forced alignment to generate SRT + metadata.

## Target Users
- Next.js frontend consumers.
- Potential future CLI or 3rd-party integrations.

## User Experience Goals
- Single POST to enqueue a job.
- Polling endpoint returning percentage + human-readable status.
- Fetch final JSON + SRT when complete. 