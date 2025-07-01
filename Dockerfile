# Multi-stage build for YouTube Lyrics Backend
# Handles both Python (PyTorch/Demucs) and Node.js (Express API) dependencies

FROM python:3.11-slim as python-base

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies required for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 (Railway compatible)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Install yt-dlp system package
RUN pip3 install --upgrade pip yt-dlp

WORKDIR /app

# Copy Python requirements first for better caching
COPY requirements.txt ./

# Install Python dependencies with PyTorch CPU-only
RUN pip3 install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu/simple torch
RUN pip3 install --no-cache-dir demucs

# Copy Node.js package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy application source code
COPY . ./

# Build the application
RUN npm run build

# Create temp directory for audio processing
RUN mkdir -p /app/temp

# Expose port (Railway will set PORT env var)
EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:$PORT/health || exit 1

# Start the application
CMD ["npm", "start"] 