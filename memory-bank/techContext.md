# Technical Context - Backend

_Last updated: 2025-12-08_

> **Update 2025-12-08**: The download pipeline has been simplified. The backend now uses a single unauthenticated m4a download strategy executed by yt-dlp. All play-dl, cookie-based, and multi-strategy fallback logic described later in this document are historical and no longer active.

> **Patch 2025-12-08 (same day)**: Cloudinary audio caching layer has been **reactivated and fixed**. Worker now guarantees temp directory creation before cache writes, and downloader correctly skips cookie logic unless a method name begins with `authenticated-`.

## Deployment Architecture

### Dual Platform Strategy
The backend is deployed to **two platforms simultaneously** for redundancy and performance comparison:

#### Railway Platform
- **URL**: `https://yt-lyrics-backend-production.up.railway.app`
- **Type**: Container-based hosting
- **Scaling**: Automatic vertical scaling
- **Configuration**: `Procfile` with direct Node.js execution
- **Signal Handling**: `node dist/index.js` for proper SIGTERM handling
- **Memory**: Optimized with Demucs memory-safe mode

#### Fly.io Platform  
- **URL**: `https://yt-lyrics-backend.fly.dev`
- **Type**: Global edge deployment with auto-scaling machines
- **Configuration**: `fly.toml` with health checks
- **Region**: LAX (Los Angeles) primary
- **Scaling**: Auto-start/stop machines based on demand
- **Health Monitoring**: `/health` endpoint with 30s intervals

## Technology Stack

### Runtime Environment
- **Node.js**: v18+ with TypeScript compilation
- **TypeScript**: Full type safety throughout codebase
- **Express.js**: REST API framework with CORS support
- **Docker**: Containerized deployment for consistency

### Audio Processing Pipeline
```mermaid
graph LR
    A[YouTube URL] --> B[yt-dlp Download]
    B --> C[Demucs Vocal Separation]
    C --> D[OpenAI Whisper Transcription]
    D --> E[WhisperX Word Alignment]
    E --> F[SRT/Text Output]
```

#### 1. YouTube Download (yt-dlp)
- **Tool**: `yt-dlp` (Python package)
- **Format**: Best quality audio extraction
- **Features**: Cookie support for age-restricted content
- **Output**: WAV/MP3 audio files

#### 2. Vocal Separation (Demucs)
- **Model**: `htdemucs_ft` (fine-tuned `htdemucs` variant, default; override via DEMUCS_MODEL)
- **Memory Mode**: Safe mode enabled for Railway (prevents OOM)
- **Segment Length**: 7 seconds (integer) for CLI compatibility and memory safety
- **CLI Requirement**: Demucs requires integer values for `--segment` argument
- **Skip Logic**: Long audio (>10min) skipped in memory-safe mode
- **Output**: Isolated vocal track for better transcription

#### 3. Transcription (OpenAI Whisper)
- **Model**: `gpt-4o-mini` via OpenAI API
- **Quality**: High accuracy for music and speech
- **Input**: Vocal-separated or original audio
- **Output**: Plain text transcription

#### 4. Word Alignment (WhisperX)
- **Tool**: `whisperx` CLI with modern argument format
- **Model**: `WAV2VEC2_ASR_BASE_960H` for alignment
- **Compute Type**: `int8` for CPU compatibility (Railway environment)
- **CPU Optimization**: Dynamically set to avoid float16 errors on CPU-only instances
- **Precision**: Word-level timestamps with confidence scores
- **Output**: JSON with start/end times per word

### Dependencies

#### Node.js Packages
```json
{
  "express": "^4.18.2",
  "cors": "^2.8.5", 
  "multer": "^1.4.5",
  "uuid": "^9.0.0",
  "openai": "^4.20.1"
}
```

#### Python Packages (requirements.txt)
```
yt-dlp>=2023.12.30
demucs>=4.0.1
whisperx>=3.1.1
torch>=2.0.0
torchaudio>=2.0.0
```

### File System Architecture
```
/temp/
├── {jobId}/
│   ├── audio.wav          # Downloaded audio
│   ├── vocals.wav         # Separated vocals (if Demucs used)
│   ├── results.json       # Final transcription results
│   └── subtitles.srt      # SRT subtitle file
```

## API Endpoints

### Core Endpoints
- **POST** `/api/jobs` - Create new transcription job
- **GET** `/api/jobs/{jobId}` - Get job status and progress
- **GET** `/api/jobs/{jobId}/result` - Get final transcription results
- **GET** `/health` - Health check endpoint

### Request/Response Format
```typescript
// Job Creation
POST /api/jobs
{
  "youtubeUrl": "https://youtube.com/watch?v=..."
}

// Job Status Response
{
  "status": "processing",
  "pct": 75,
  "statusMessage": "Aligning word timestamps with WhisperX...",
  "resultUrl": "/api/jobs/{jobId}/result"
}

// Final Results
{
  "words": [
    {
      "word": "hello",
      "start": 1.23,
      "end": 1.67,
      "confidence": 0.95
    }
  ],
  "srt": "1\n00:00:01,230 --> 00:00:01,670\nhello\n",
  "plain": "hello world...",
  "metadata": {
    "title": "Song Title",
    "duration": 180,
    "processedAt": "2025-04-07T12:00:00Z"
  }
}
```

## Configuration Management

### Environment Variables
```bash
# Required
OPENAI_API_KEY=sk-...           # OpenAI API key for Whisper
PORT=4000                       # Server port

# Optional
NODE_ENV=production             # Environment mode
RAILWAY_ENVIRONMENT=true        # Railway-specific optimizations
DEMUCS_MEMORY_SAFE=true        # Force memory-safe mode
```

### Platform-Specific Config

#### Railway (Procfile)
```
web: node dist/index.js
```

#### Fly.io (fly.toml)
```toml
app = "yt-lyrics-backend"
primary_region = "lax"
kill_signal = "SIGINT"
kill_timeout = "8s"

[http_service]
  internal_port = 4000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0
```

## Performance Optimizations

### Memory Management
- **Demucs Memory-Safe Mode**: Prevents OOM on Railway's limited memory
- **Automatic Cleanup**: Temp files removed after processing
- **Process Monitoring**: Active job tracking prevents resource leaks

### Processing Optimizations
- **Conditional Demucs**: Skip vocal separation for long audio in memory-safe mode
- **Streaming**: Real-time progress updates during processing
- **Error Recovery**: Graceful handling of tool failures

### Scaling Strategy
- **Railway**: Vertical scaling with container restarts
- **Fly.io**: Horizontal scaling with auto-start/stop machines
- **Load Distribution**: Frontend racing system distributes load

## Security & Reliability

### Input Validation
- **URL Validation**: YouTube URL format checking
- **File Size Limits**: Prevent excessive resource usage
- **Timeout Protection**: Process timeouts prevent hanging jobs

### Error Handling
- **Graceful Degradation**: Continue processing if optional steps fail
- **Detailed Logging**: Comprehensive error reporting for debugging
- **Signal Handling**: Proper cleanup on container termination

### Monitoring
- **Health Checks**: Both platforms monitor `/health` endpoint
- **Process Tracking**: Active job monitoring and cleanup
- **Resource Monitoring**: Memory and CPU usage tracking

## Development Workflow

### Build Process
```bash
# TypeScript compilation
npm run build

# Docker build (both platforms)
docker build -t yt-lyrics-backend .

# Local development
npm run dev
```

### Deployment Process
- **Railway**: Automatic deployment on git push
- **Fly.io**: `flyctl deploy` command
- **Both**: Docker-based builds for consistency

### Testing Strategy
- **Manual Testing**: Both platforms tested with real YouTube URLs
- **Health Monitoring**: Continuous health check validation
- **Performance Testing**: Frontend racing system provides real-world performance data