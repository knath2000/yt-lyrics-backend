---
title: YouTube Lyrics Backend
emoji: 🎵
colorFrom: blue
colorTo: purple
sdk: docker
pinned: false
app_port: 7860
---

# YouTube Lyrics Backend

A powerful Express.js backend that extracts lyrics from YouTube videos using Demucs for source separation and OpenAI Whisper for transcription.

## Features

- 🎵 **Audio Source Separation**: Uses Demucs to isolate vocals from music
- 🎤 **Speech-to-Text**: OpenAI Whisper for accurate transcription
- 📝 **Word-level Alignment**: Precise timestamp alignment for lyrics
- 🚀 **REST API**: Simple HTTP endpoints for easy integration
- 🐳 **Docker Ready**: Optimized for Hugging Face Spaces deployment

## API Endpoints

### POST /api/jobs
Submit a YouTube URL for lyric extraction:
```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

Returns a job ID for tracking progress.

### GET /api/jobs/:id
Check job status and retrieve results.

### GET /health
Health check endpoint for monitoring.

## Technology Stack

- **Express.js** - Web framework
- **TypeScript** - Type safety
- **Demucs** - AI-powered source separation
- **OpenAI Whisper** - Speech recognition
- **yt-dlp** - YouTube audio download
- **FFmpeg** - Audio processing

## Local Development

```bash
# Install dependencies
npm install
pip install -r requirements.txt

# Development server
npm run dev

# Build and start
npm run build
npm start
```

## Docker Deployment

```bash
# Build image
docker build -t youtube-lyrics-backend .

# Run container
docker run -p 7860:7860 youtube-lyrics-backend
```

## Hugging Face Spaces

This backend is optimized for deployment on Hugging Face Spaces with Docker SDK. The container exposes port 7860 and includes health checks for monitoring.

## Environment Variables

- `PORT` - Server port (default: 7860)
- `NODE_ENV` - Environment mode
- `OPENAI_API_KEY` - For OpenAI Whisper API (if using API instead of local model)

## License

MIT License 