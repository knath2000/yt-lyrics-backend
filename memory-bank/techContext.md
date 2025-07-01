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

## Deployment & Build

### Platform
- **Railway** service connected to the backend GitHub repository. Each push to `main` triggers an automatic build & deploy.

### Build Toolchain
- **Nixpacks** auto-generates the Dockerfile; custom settings live in `nixpacks.toml`.
  - Pinned **Python 3.11** (`python311`) and **Node 20** (`nodejs_20`) system packages.
  - Added build dependencies: `python311Packages.setuptools`, `python311Packages.wheel`, `libsndfile`, `ffmpeg`, `yt-dlp`.
  - Removed problematic `pip install --upgrade pip` step.
  - Split install commands to first fetch CPU-only PyTorch wheels (`--extra-index-url https://download.pytorch.org/whl/cpu`) then install Demucs.

### Current Build Status
- Deployment succeeds through steps 1-5 but currently fails while installing CPU-only PyTorch wheels on Railway's Nix environment.
- Next action: reproduce the build locally with `nixpacks build .` and identify missing libs or constraints. 