# Tech Context - Backend

## Languages & Frameworks
- Node.js 20
- TypeScript 5
- Express 4

## Key Dependencies
- `openai@4` for audio transcription (default `gpt-4o-mini-transcribe`, change via `OPENAI_AUDIO_MODEL`).
- `ytdl-core` & system `yt-dlp` for downloads.
- `fluent-ffmpeg` wrapper – requires FFmpeg installed.
- `dotenv` for env variable loading.

## Environment Setup
```bash
pnpm install
pnpm dev # starts tsx watch on :4000
```
Requires:
- `OPENAI_API_KEY` in `.env` or shell.
- FFmpeg & Python3; install Demucs with `pip install demucs` to enable vocal separation. 