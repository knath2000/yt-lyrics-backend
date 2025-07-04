# Multi-stage Docker build for YouTube Lyrics Backend on Render
# Optimized for Python ML dependencies + Node.js API server

# Stage 1: Python dependencies and ML models
FROM python:3.11-slim as python-builder

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1-dev \
    gcc \
    g++ \
    wget \
    libcurl4-openssl-dev \
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Set Python working directory
WORKDIR /app

# Copy Python requirements
COPY requirements.txt .

# Install PyTorch CPU-only and other Python dependencies
RUN pip install --no-cache-dir torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt --upgrade

# Install yt-dlp pre-built binary as a fallback
RUN wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp_binary && \
    chmod a+rx /usr/local/bin/yt-dlp_binary


# Stage 2: Node.js application build
FROM node:20-slim as node-builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev dependencies for TypeScript build)
RUN npm ci

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

# Stage 3: Production runtime
FROM python:3.11-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 in the Python container
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create app user
RUN useradd --create-home --shell /bin/bash app
USER app
WORKDIR /home/app
ENV PATH="/home/app/.local/bin:${PATH}"

# Copy Python environment from builder
COPY --from=python-builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=python-builder /usr/local/bin /usr/local/bin
COPY --from=python-builder /usr/local/bin/yt-dlp_binary /usr/local/bin/yt-dlp_binary

# Copy Node.js application (only production dependencies)
COPY --from=node-builder /app/package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy the built JavaScript files
COPY --from=node-builder /app/dist ./dist

# Create temp directory for audio processing
RUN mkdir -p temp

# Expose port (Render uses PORT env var)
EXPOSE $PORT

# Health check for Render (uses dynamic PORT)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT:-4000}/health || exit 1

# Start the application
CMD ["npm", "start"]