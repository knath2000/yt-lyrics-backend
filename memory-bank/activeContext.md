# Active Context - Backend

_Last updated: 2025-07-03_

## Current Focus
- **CRITICAL ISSUE**: Resolving `yt-dlp` download failures due to `HTTP Error 403: Forbidden`. This is the primary blocker.
- The transcription pipeline fails at the first step, preventing any further processing.

## Recent Changes & Investigations
- **Forced Alignment Implementation**:
  - Integrated `whisperx` to provide word-level timestamps, as `gpt-4o-mini-transcribe` does not support `verbose_json`.
  - Added `whisperx` and `pydub` to `requirements.txt`.
  - Created `youtube-lyrics-backend/src/utils/whisperXProcessor.ts` to handle `whisperx` CLI execution.
  - Modified `youtube-lyrics-backend/src/worker.ts` to use `WhisperXProcessor` for alignment.
  - Updated `youtube-lyrics-backend/nixpacks.toml` to install `whisperx` and its dependencies.
- **`yt-dlp` Hardening Attempt**:
  - Modified `youtube-lyrics-backend/nixpacks.toml` to install the latest `yt-dlp` from `pip` instead of Nix packages.
  - Added `--referer "https://www.youtube.com/"` to `yt-dlp` commands in `download.ts`.
  - Removed the `ytdl-core` fallback to simplify the download logic and focus on the more robust `yt-dlp`.

## Next Steps
1. **Resolve `yt-dlp` 403 Forbidden Error**: This is the top priority.
   - Investigate more advanced `yt-dlp` flags or alternative downloaders that are more resilient to YouTube's anti-bot measures.
   - Consider strategies such as rotating user-agents, using different authentication methods, or exploring different `yt-dlp` forks if necessary.
2. **Verify End-to-End Transcription**: Once the download is fixed, re-run the entire pipeline to ensure `whisperx` alignment and all subsequent steps are working correctly.
3. **Continue with original plan**:
   - Implement job persistence (SQLite/Redis).
   - Implement S3 upload for processed audio files.
   - Add comprehensive logging, monitoring, and timeout handling.

## Known Issues
- **`yt-dlp` downloads are consistently blocked by YouTube with a 403 Forbidden error.**

## Timeline
| Date       | Milestone                               |
|------------|-----------------------------------------|
| 2025-07-03 | Paused debugging of `yt-dlp` 403 error. |
| 2025-07-03 | Attempted to fix `yt-dlp` with `--referer` and latest version. |
| 2025-07-03 | Implemented `whisperx` for forced alignment. |
| 2025-07-02 | Demucs PATH Fix & 403 Error Handling    |
| 2025-07-02 | OpenAI API Key Confirmed                |
| 2025-07-02 | YouTube Auth & Dependency Fixes         |
| 2025-01-30 | Enhanced audio processing pipeline      |
| 2025-01-30 | Demucs integration with backend compatibility |