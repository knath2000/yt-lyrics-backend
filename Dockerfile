# Use Debian-based Python image for better PyPI wheel compatibility
FROM python:3.11-slim as base

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    NODE_ENV=production

# Install system dependencies including Node.js
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    ffmpeg \
    libsndfile1 \
    libopenblas-dev \
    libgomp1 \
    pkg-config \
    git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency files
COPY package*.json ./
COPY requirements.txt ./

# Install Node.js dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Install Python dependencies with CPU-only PyTorch
RUN pip install torch==2.2.0+cpu --extra-index-url https://download.pytorch.org/whl/cpu
RUN pip install demucs==4.0.1
RUN pip install -r requirements.txt

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:7860/health || exit 1

# Expose port 7860 (Hugging Face Spaces standard)
EXPOSE 7860

# Set PORT environment variable for Hugging Face Spaces
ENV PORT=7860

# Start the application
CMD ["node", "dist/index.js"] 