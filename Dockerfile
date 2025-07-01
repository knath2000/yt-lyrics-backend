# Multi-stage build for YouTube Lyrics Backend
# Handles both Python (PyTorch/Demucs) and Node.js (Express API) dependencies

FROM python:3.11-slim as python-base

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV DEBIAN_FRONTEND=noninteractive
ENV PIP_NO_CACHE_DIR=1

# Increase file descriptor limits for Railway
RUN ulimit -n 8192

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

# Set working directory
WORKDIR /app

# Install Python dependencies with optimized order
# Install PyTorch first with CPU-only wheels
RUN pip3 install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu/simple

# Install yt-dlp and demucs
RUN pip3 install --no-cache-dir yt-dlp demucs

# Copy package files for Node.js dependencies
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Build the application
RUN npm run build

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3001}/health || exit 1

# Expose port
EXPOSE 3001

# Start the application
CMD ["npm", "start"] 