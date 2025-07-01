# syntax=docker/dockerfile:1

# ===== BUILD STAGE =====
FROM python:3.10-alpine AS builder

# Set environment variables for build
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

# Install build dependencies in a single layer
RUN apk add --no-cache --virtual .build-deps \
    build-base \
    musl-dev \
    linux-headers \
    gcc \
    g++ \
    rust \
    cargo \
    pkgconfig \
    curl \
    nodejs \
    npm \
    && apk add --no-cache \
    ffmpeg-dev \
    libsndfile-dev \
    openblas-dev

WORKDIR /app

# Copy dependency files first for better caching
COPY requirements.txt package*.json ./

# Install Python dependencies with CPU-only PyTorch
RUN pip install --user --no-cache-dir \
    torch==2.0.1+cpu \
    --extra-index-url https://download.pytorch.org/whl/cpu

# Install Python dependencies (including Demucs pinned to working version)
RUN pip install --user --no-cache-dir -r requirements.txt

# Install Node.js dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Build the application if build script exists
RUN npm run build || echo "No build script found, continuing..."

# Clean up build dependencies
RUN apk del .build-deps

# ===== RUNTIME STAGE =====
FROM python:3.10-alpine AS runtime

# Set production environment variables
ENV PYTHONUNBUFFERED=1
ENV NODE_ENV=production
ENV PATH=/root/.local/bin:$PATH

# Install only runtime dependencies
RUN apk add --no-cache \
    ffmpeg \
    libsndfile \
    openblas \
    libgomp \
    nodejs \
    curl \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy Python packages from builder
COPY --from=builder /root/.local /root/.local

# Copy Node.js dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy built application
COPY --from=builder /app .

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"] 