# Multi-stage build for YouTube Lyrics Backend
# Handles both Python (PyTorch/Demucs) and Node.js (Express API) dependencies

FROM python:3.10-slim as python-base

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV DEBIAN_FRONTEND=noninteractive
ENV PIP_NO_CACHE_DIR=1

# Install system dependencies required for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    curl \
    build-essential \
    libgomp1 \
    libopenblas-dev \
    pkg-config \
    rustc \
    cargo \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 (Railway compatible)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Set working directory
WORKDIR /app

# Copy Python requirements first for better caching
COPY requirements.txt .

# Install Python dependencies WITHOUT pip upgrade (Railway issue fix)
# Use PyTorch CPU-only with correct index URL including /simple suffix
RUN pip3 install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu/simple \
    && pip3 install --no-cache-dir demucs \
    && pip3 install --no-cache-dir -r requirements.txt

# Copy package.json for Node.js dependencies
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Build the application if build script exists
RUN npm run build || echo "No build script found, continuing..."

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"] 