---
title: YouTube Lyrics Backend
emoji: 🎵
colorFrom: blue
colorTo: purple
sdk: docker
pinned: false
app_port: 7860
---

# YouTube Lyrics Backend 🎵

A powerful backend service for extracting lyrics from YouTube videos using advanced audio processing and transcription technologies.

## Features

- **YouTube Audio Extraction**: Download and process audio from YouTube videos
- **Source Separation**: Use Demucs to isolate vocal tracks from music
- **Speech-to-Text**: Leverage OpenAI's Whisper for accurate transcription
- **Word-Level Alignment**: Precise timestamp alignment for karaoke-style lyrics
- **RESTful API**: Clean HTTP endpoints for easy integration

## Tech Stack

- **Backend**: Node.js + Express.js + TypeScript
- **ML Processing**: Python + PyTorch + Demucs + Whisper
- **Audio Processing**: ffmpeg, librosa, soundfile
- **Deployment**: Hugging Face Spaces (Docker)

## API Endpoints

### Health Check
```
GET /health
```

### Job Management
```
POST /api/jobs/create     # Create new transcription job
GET /api/jobs/:id/status  # Check job status
GET /api/jobs/:id/result  # Get transcription result
```

## Environment Variables

```bash
OPENAI_API_KEY=your_openai_api_key_here
PORT=7860
```

## Local Development

```bash
# Install dependencies
npm install
pip install -r requirements.txt

# Start development server
npm run dev
```

## Deployment

This application is configured for deployment on Hugging Face Spaces using Docker. The space will automatically build and deploy when pushed to the Hugging Face repository.

### Required Environment Variables in Hugging Face Spaces:
- `OPENAI_API_KEY`: Your OpenAI API key for Whisper transcription

## Usage

1. Create a transcription job by POSTing a YouTube URL
2. Poll the job status endpoint to check progress
3. Retrieve the final transcription with word-level timestamps

## License

MIT License
