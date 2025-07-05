# Setup Guide

## Environment Variables

Copy `.env.example` to `.env` and configure the following variables:

### Required

- `DATABASE_URL`: PostgreSQL connection string
  - Format: `postgresql://username:password@host:port/database`
  - Example: `postgresql://user:pass@localhost:5432/transcribe_db`

- `CLOUDINARY_URL`: Cloudinary configuration URL
  - Format: `cloudinary://api_key:api_secret@cloud_name`
  - Get from your Cloudinary dashboard

- `OPENAI_API_KEY`: OpenAI API key for transcription
  - Get from OpenAI platform

### Optional

- `PORT`: Server port (default: 4000)
- `NODE_ENV`: Environment (development/production)

## Database Setup

The application will automatically:
1. Create the `jobs` table if it doesn't exist
2. Create necessary indexes for performance
3. Test the database connection on startup

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Production

```bash
npm run build
npm start
```

## Features

- PostgreSQL for persistent job storage
- Cloudinary for transcription result storage
- Real-time job progress tracking
- Graceful shutdown handling
- Health check endpoints