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
PORT=4000
```

## Local Development

```bash
# Install dependencies
npm install
pip install -r requirements.txt

# Start development server
npm run dev
```

## Usage

1. Create a transcription job by POSTing a YouTube URL
2. Poll the job status endpoint to check progress
3. Retrieve the final transcription with word-level timestamps

## License

MIT License
 