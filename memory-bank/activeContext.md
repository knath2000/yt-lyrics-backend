# Active Context - Backend

_Last updated: 2025-01-15_

## Current Focus
- **CRITICAL ISSUE**: YouTube sign-in bot detection affecting all presets
- **YT-DLP LOGIC RESTORATION**: Attempted to restore previous successful yt-dlp multi-strategy fallback chain
- **DOWNLOAD PIPELINE FAILURES**: All download methods failing with "Sign in to confirm you're not a bot" errors
- **SESSION STATUS**: Paused - requires cookie authentication or alternative approach

## Current Deployment Status

### Railway Deployment
- **URL**: `https://yt-lyrics-backend-production.up.railway.app`
- **Status**: 🔴 FAILING - YouTube bot detection blocking all downloads
- **Configuration**: Uses Railway's container platform with automatic scaling
- **Signal Handling**: Fixed with direct Node.js execution (`node dist/index.js`)

### Deployment Platform – Railway **only**
We have sunset the Fly.io deployment. The backend is **exclusively** hosted on Railway now.
 - **URL**: `https://yt-lyrics-backend-production.up.railway.app`
 - **Scaling**: Automatic container scaling via Railway settings
 - **Health**: `/health` endpoint used for readiness & liveness probes
 - **Notes**: Any Fly.io references are deprecated and should be ignored.

## Recent Session Work (2025-01-15)

### ❌ ISSUE: YouTube Bot Detection Across All Presets
- **Problem**: User reported sign-in messages returned regardless of preset chosen
- **Error Pattern**: "Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication"
- **Affected**: All quality presets (low, regular, high) failing with same error
- **Status**: CRITICAL - No downloads working

### ⚠️ ATTEMPTED: Multi-Strategy yt-dlp Restoration
- **Action**: Restored previous four-step fallback chain in `ytDlpDownloader.ts`
- **Strategies Restored**:
  1. `authenticated-m4a` (requires cookies)
  2. `unauthenticated-m4a` (no cookies)  
  3. `authenticated-generic` (requires cookies)
  4. `unauthenticated-generic` (no cookies)
- **Result**: All strategies failing with YouTube bot detection
- **Issue**: Even unauthenticated methods being blocked by YouTube

### 📋 Error Analysis
- **Command Failing**: `yt-dlp https://youtu.be/MGVvaHEY27Y -f best --no-playlist -x --audio-format mp3 --audio-quality 0 -o temp/973e7e5c-32bf-4480-a041-44f56185a5a2/video_1731984244610.%(ext)s --no-check-certificate --ignore-errors --socket-timeout 30 --retries 3 --user-agent Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 --referer https://www.youtube.com/ --add-header Accept-Language:en-US,en;q=0.9`
- **YouTube Response**: "Sign in to confirm you're not a bot"
- **Scope**: Affecting all download methods, not just authenticated ones
- **Impact**: Complete service failure

## Technical Stack Details (Current State)

### Audio Processing Pipeline (Broken at Stage 1)
- **Stage 1: YouTube Download** ❌ FAILING
  - **Tool**: yt-dlp (Python CLI) via ytDlpDownloader.ts
  - **Issue**: YouTube bot detection blocking all attempts
  - **Status**: Complete failure across all strategies

- **Stage 2-5**: Vocal Separation, Transcription, Alignment, Output Generation
  - **Status**: Cannot reach due to Stage 1 failure

## Next Steps Required (Tomorrow's Session)

### Immediate Priorities
1. **Cookie Authentication**: Implement proper YouTube cookie handling
   - Research `--cookies-from-browser` option
   - Set up cookie extraction from Chrome/Firefox
   - Test authenticated downloads with real cookies

2. **Alternative Approaches**: 
   - Investigate newer yt-dlp versions with better bot evasion
   - Research alternative YouTube download libraries
   - Consider YouTube Data API v3 for metadata (though no audio)

3. **Bot Evasion Enhancement**:
   - Update user agents to latest Chrome versions
   - Implement IP rotation if possible
   - Research proxy integration options

### Investigation Required
1. **yt-dlp Version**: Check if newer versions handle bot detection better
2. **Cookie Integration**: Full implementation of browser cookie extraction
3. **Alternative Libraries**: Research `pytube`, `youtube-dl` alternatives
4. **Rate Limiting**: Implement delays between requests

## Timeline Update
| Date       | Milestone                               |
|------------|-----------------------------------------|
| 2025-01-15 | **CURRENT**: Session paused due to YouTube bot detection blocking all downloads |
| 2025-01-15 | Attempted yt-dlp multi-strategy restoration - unsuccessful |
| 2025-01-15 | Identified critical issue affecting all presets |
| 2025-12-08 | Cloudinary cache restoration and downloader bug fixes |
| 2025-12-07 | Major rollback to commit 34e90b3 completed |

## Known Issues
- **CRITICAL**: YouTube bot detection blocking all download attempts
- **SCOPE**: Affects all presets and download strategies  
- **URGENCY**: High - service completely non-functional
- **NEXT SESSION**: Focus on cookie authentication and bot evasion