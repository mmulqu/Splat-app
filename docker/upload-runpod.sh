#!/bin/bash

# Upload Docker image to Docker Hub for RunPod

set -e

echo "=========================================="
echo "Upload to Docker Hub for RunPod"
echo "=========================================="
echo ""

# Check if Docker is logged in
if ! docker info | grep -q Username; then
    echo "You need to login to Docker Hub first:"
    echo "  docker login"
    exit 1
fi

# Get Docker Hub username
DOCKER_USERNAME=$(docker info | grep Username | awk '{print $2}')
echo "Docker Hub username: $DOCKER_USERNAME"
echo ""

# Ask for image name
read -p "Enter image name (default: gaussian-splatting): " IMAGE_NAME
IMAGE_NAME=${IMAGE_NAME:-gaussian-splatting}

# Ask for version tag
read -p "Enter version tag (default: latest): " VERSION
VERSION=${VERSION:-latest}

# Full image name
FULL_IMAGE="${DOCKER_USERNAME}/${IMAGE_NAME}:${VERSION}"

echo ""
echo "Will upload as: $FULL_IMAGE"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Step 1: Tagging image..."
docker tag gaussian-splatting:latest $FULL_IMAGE

echo "Step 2: Pushing to Docker Hub..."
docker push $FULL_IMAGE

echo ""
echo "=========================================="
echo "✓ Upload complete!"
echo "=========================================="
echo ""
echo "Your image: $FULL_IMAGE"
echo ""
echo "Next steps:"
echo ""
echo "1. Go to RunPod: https://runpod.io/console/serverless"
echo ""
echo "2. Click 'New Template'"
echo ""
echo "3. Configure:"
echo "   - Template Name: Gaussian Splatting"
echo "   - Container Image: $FULL_IMAGE"
echo "   - Container Disk: 20 GB"
echo "   - Volume Disk: 10 GB (optional)"
echo "   - Volume Mount Path: /workspace (optional)"
echo "   - Environment Variables: (none needed)"
echo "   - Expose HTTP Ports: (none needed)"
echo "   - Expose TCP Ports: (none needed)"
echo ""
echo "4. Click 'Save Template'"
echo ""
echo "5. Create a new Serverless Endpoint:"
echo "   - Select your template"
echo "   - Choose GPU type (RTX 3090 or 4090 recommended)"
echo "   - Set workers: 0-3 (autoscale)"
echo "   - Set Max Workers: 3"
echo "   - Set Idle Timeout: 60 seconds"
echo "   - Click 'Deploy'"
echo ""
echo "6. Copy the Endpoint ID from the endpoint page"
echo ""
echo "7. Copy your API Key from RunPod settings"
echo ""
echo "8. Update your Cloudflare Worker secrets:"
echo "   wrangler secret put RUNPOD_API_KEY"
echo "   wrangler secret put RUNPOD_ENDPOINT_ID"
echo ""
