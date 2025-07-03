# Active Context - Backend

_Last updated: 2025-03-07_

## Current Focus
- **DEPLOYMENT SWITCH**: Moved from Hugging Face Spaces to Railway due to yt-dlp impersonation issues
- **NEW CRITICAL ISSUE**: WhisperX alignment failing on Railway with argument parsing error
- **Error**: `whisperx: error: unrecognized arguments: --audio ... --transcript ...`
- The transcription pipeline now fails at the WhisperX alignment step (step 4) instead of download step

## Recent Changes & Investigations
- **Platform Migration**: Switched from Hugging Face Spaces to Railway deployment due to unresolvable yt-dlp impersonation issues
- **NEW WhisperX Command Line Error**: Railway logs show WhisperX CLI argument parsing failure:
  ```
  whisperx: error: unrecognized arguments: --audio temp/4f21b0b7-f417-496b-a7ea-80d763e2c2af/Nightcrawler.mp3 --transcript temp/4f21b0b7-f417-496b-a7ea-80d763e2c2af/Nightcrawler.mp3.txt
  ```
- **Previous Failed `yt-dlp` Dependency Fixes** (resolved by platform switch):
  - Attempted to install `yt-dlp[default,curl-cffi]` via `nixpacks.toml`.
  - Attempted to add `curl` and `libcurl` to `nixPkgs` in `nixpacks.toml`.
  - Both attempts resulted in the same `Impersonate target "chrome" is not available` error.

## Next Steps
1. **IMMEDIATE**: Fix WhisperX CLI argument parsing issue on Railway
   - Research current WhisperX CLI interface and correct argument syntax
   - Update `whisperXProcessor.ts` to use proper CLI arguments
   - Test on Railway deployment environment
2. **Future Investigation** (resolved via platform switch):
   - ~~Research how to correctly provide C-bindings for Python packages in a Nix/Nixpacks environment~~
   - ~~Explore alternative impersonation methods or `yt-dlp` forks that may not have the same dependencies~~
   - ~~Consider removing the `--impersonate` flag temporarily~~

## Known Issues
- **WhisperX CLI argument parsing error on Railway**: The command line interface for WhisperX is rejecting `--audio` and `--transcript` arguments with "unrecognized arguments" error
- **RESOLVED**: `yt-dlp` impersonation fails in HF Spaces - resolved by migrating to Railway platform

## Timeline
| Date       | Milestone                               |
|------------|-----------------------------------------|
| 2025-03-07 | **NEW ISSUE**: WhisperX CLI argument parsing failure on Railway deployment |
| 2025-03-07 | **PLATFORM SWITCH**: Migrated from Hugging Face Spaces to Railway |
| 2025-07-03 | Paused debugging of `yt-dlp` impersonation issue (HF Spaces). |
| 2025-07-03 | Attempted to fix impersonation issue by adding `curl` and `libcurl` to `nixPkgs` (HF Spaces). |
| 2025-07-03 | Attempted to fix impersonation issue by installing `yt-dlp[default,curl-cffi]` (HF Spaces). |
| 2025-07-03 | Implemented `--impersonate chrome` and consistent headers for `yt-dlp`. |
| 2025-07-03 | Implemented `whisperx` for forced alignment. |
| 2025-07-02 | Demucs PATH Fix & 403 Error Handling    |
| 2025-07-02 | OpenAI API Key Confirmed                |
| 2025-07-02 | YouTube Auth & Dependency Fixes         |
| 2025-01-30 | Enhanced audio processing pipeline      |
| 2025-01-30 | Demucs integration with backend compatibility |