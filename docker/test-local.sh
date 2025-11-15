#!/bin/bash

# Test the Gaussian Splatting Docker image locally

set -e

echo "========================================"
echo "Testing Gaussian Splatting Docker Locally"
echo "========================================"
echo ""
echo "This will:"
echo "  1. Run the Docker container"
echo "  2. Process test images"
echo "  3. Generate a 3D model"
echo ""
echo "NOTE: This requires NVIDIA GPU with CUDA support"
echo ""

# Check if GPU is available
if ! docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi &>/dev/null; then
    echo "❌ NVIDIA GPU not detected or docker GPU support not enabled"
    echo ""
    echo "Please ensure:"
    echo "  1. NVIDIA GPU is available"
    echo "  2. NVIDIA drivers are installed"
    echo "  3. nvidia-docker2 is installed"
    echo "  4. Docker has GPU support enabled"
    exit 1
fi

echo "✓ GPU detected"
echo ""

# Check if test input exists
if [ ! -f "test_input.json" ]; then
    echo "❌ test_input.json not found"
    echo "Creating a default test_input.json..."
    cat > test_input.json <<'EOF'
{
  "image_urls": [
    "https://example.com/image1.jpg",
    "https://example.com/image2.jpg"
  ],
  "upload_url": "https://httpbin.org/put",
  "project_id": "test-local-123",
  "params": {
    "iterations": 1000
  }
}
EOF
    echo "✓ Created test_input.json"
    echo ""
    echo "⚠️  You need to edit test_input.json with real image URLs!"
    echo ""
fi

echo "Starting Docker container..."
echo ""

# Run the Docker container
docker run --rm \
    --gpus all \
    -v $(pwd)/test_input.json:/workspace/test_input.json \
    -v $(pwd)/output:/workspace/output \
    gaussian-splatting:latest \
    python3 handler.py test_input.json

echo ""
echo "========================================"
echo "✓ Test complete!"
echo "========================================"
echo ""
echo "Output should be in ./output/"
echo ""
