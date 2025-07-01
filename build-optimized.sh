#!/bin/bash

# Build script for optimized YouTube Lyrics Backend
# This script builds the optimized Docker image and shows size comparison

echo "🚀 Building optimized YouTube Lyrics Backend Docker image..."
echo "=================================================="

# Build the optimized image
echo "Building optimized image..."
docker build -t youtube-lyrics-backend:optimized .

if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
    echo ""
    
    # Show image sizes
    echo "📊 Image size comparison:"
    echo "========================"
    docker images | grep youtube-lyrics-backend
    
    echo ""
    echo "💡 Tips:"
    echo "- The optimized image should be under 2GB (down from 8.2GB)"
    echo "- Multi-stage build separates build dependencies from runtime"
    echo "- Alpine Linux base provides smaller footprint"
    echo "- Proper layer caching improves rebuild times"
    
    echo ""
    echo "🏃‍♂️ To run the container:"
    echo "docker run -p 3000:3000 youtube-lyrics-backend:optimized"
    
    echo ""
    echo "🔍 To analyze layer sizes (if you have dive installed):"
    echo "dive youtube-lyrics-backend:optimized"
    
else
    echo "❌ Build failed!"
    exit 1
fi 