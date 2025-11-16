#!/bin/bash
# Quick start script for local Gaussian Splatting

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║    Local Gaussian Splatting with Nerfstudio               ║"
echo "║    Quick Start                                             ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

echo "✓ Docker is installed"

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "   Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✓ Docker Compose is installed"

# Check if NVIDIA GPU is available
if ! command -v nvidia-smi &> /dev/null; then
    echo "⚠️  nvidia-smi not found. GPU support may not be available."
    echo "   If you have an NVIDIA GPU, please install NVIDIA drivers."
else
    echo "✓ NVIDIA GPU detected:"
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1
fi

# Check if NVIDIA Container Toolkit is installed
if ! docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi &> /dev/null; then
    echo ""
    echo "⚠️  NVIDIA Container Toolkit may not be properly configured."
    echo "   GPU acceleration might not work in Docker."
    echo ""
    echo "   To install (Ubuntu/Debian):"
    echo "   1. distribution=\$(. /etc/os-release;echo \$ID\$VERSION_ID)"
    echo "   2. curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -"
    echo "   3. curl -s -L https://nvidia.github.io/nvidia-docker/\$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list"
    echo "   4. sudo apt-get update && sudo apt-get install -y nvidia-docker2"
    echo "   5. sudo systemctl restart docker"
    echo ""
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "✓ NVIDIA Container Toolkit is configured"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo ""

# Create data directories
echo "Creating data directories..."
mkdir -p ./local-data/uploads
mkdir -p ./local-data/outputs
echo "✓ Data directories created"

echo ""
echo "Pulling Nerfstudio Docker image (pre-built, optimized for your GPU)..."
echo "This is much faster than building from scratch! ⚡"
echo ""

docker-compose pull

echo ""
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Starting services..."
docker-compose up -d

echo ""
echo "Waiting for server to start..."
sleep 5

# Check if server is running
if curl -s http://localhost:5000/api/health > /dev/null; then
    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║                    🎉 SUCCESS! 🎉                         ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""
    echo "  Local Gaussian Splatting with Nerfstudio is now running!"
    echo ""
    echo "  🌐 Web Interface:      http://localhost:5000"
    echo "  👁️  Nerfstudio Viewer:  http://localhost:7007"
    echo "  📊 API Health:         http://localhost:5000/api/health"
    echo ""
    echo "  📁 Data Location:"
    echo "     - Uploads:  ./local-data/uploads/"
    echo "     - Outputs:  ./local-data/outputs/"
    echo "     - Cache:    ./local-data/cache/"
    echo ""
    echo "  📝 View Logs:      docker-compose logs -f"
    echo "  🛑 Stop Service:   docker-compose down"
    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo ""
    echo "Next steps:"
    echo "  1. Open http://localhost:5000 in your browser"
    echo "  2. Upload at least 5 images of your scene"
    echo "  3. Choose a quality preset"
    echo "  4. Click 'Start Processing'"
    echo "  5. Wait for your 3D model to be generated!"
    echo ""
    echo "For detailed documentation, see LOCAL_SETUP.md"
    echo ""
else
    echo ""
    echo "⚠️  Server may not be ready yet. Check logs:"
    echo "   docker-compose logs -f"
    echo ""
    echo "Once ready, visit: http://localhost:5000"
    echo ""
fi
