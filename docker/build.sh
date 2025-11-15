#!/bin/bash

# Build script for Gaussian Splatting Docker image

set -e

echo "=================================="
echo "Building Gaussian Splatting Docker"
echo "=================================="

# Build the Docker image
docker build -t gaussian-splatting:latest .

echo ""
echo "✓ Build complete!"
echo ""
echo "Next steps:"
echo "  1. Test locally: ./test-local.sh"
echo "  2. Upload to RunPod: ./upload-runpod.sh"
echo ""
