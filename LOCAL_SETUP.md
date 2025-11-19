# Local Gaussian Splatting Setup 🎨

This guide will help you set up and run Gaussian Splatting locally on your machine with GPU support using **Nerfstudio**.

## Overview

The local version allows you to:
- Upload images directly from your PC through a web interface
- Process them locally using your GPU with **Nerfstudio's Splatfacto**
- Create 3D Gaussian Splat models without relying on cloud services
- No API keys, no cloud costs, complete local control
- Uses the official **Nerfstudio Docker image** - optimized and battle-tested

## Prerequisites

### Required Hardware
- **NVIDIA GPU** with CUDA support (minimum 8GB VRAM recommended)
  - Supported: RTX 20xx, RTX 30xx, RTX 40xx, A100, V100, T4, etc.
  - Architecture: Compute Capability 7.0 or higher

### Required Software
- **Docker** (version 20.10 or higher)
- **Docker Compose** (version 2.0 or higher)
- **NVIDIA Container Toolkit** (for GPU support in Docker)

## Installation

### 1. Install NVIDIA Container Toolkit

If you haven't already installed the NVIDIA Container Toolkit, follow these steps:

#### Ubuntu/Debian
```bash
# Add the package repositories
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list

# Install nvidia-docker2
sudo apt-get update
sudo apt-get install -y nvidia-docker2

# Restart Docker daemon
sudo systemctl restart docker
```

#### Verify GPU is accessible in Docker
```bash
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

You should see your GPU information displayed.

### 2. Clone the Repository

```bash
git clone https://github.com/mmulqu/Splat-app.git
cd Splat-app
git checkout claude/test-local-version-01GHGeaaWK36moVZmMuCuc1p
```

### 3. Build the Docker Image

```bash
# Build the image (extends Nerfstudio base image)
docker-compose build
```

**Build Time:**
- **First build**: ~5 minutes (pulls Nerfstudio + installs Flask)
- **Subsequent builds**: ~30 seconds (cached)

**Why Nerfstudio?**
- ✅ **Fast setup** - Extends pre-built nerfstudio image
- ✅ **Optimized** - Already compiled for your RTX 4060 (CUDA 89)
- ✅ **Battle-tested** - Used by thousands of researchers
- ✅ **Splatfacto** - State-of-the-art Gaussian Splatting implementation
- ✅ **CUDA 11.8** - Perfect for your GPU

The image includes:
- Nerfstudio base (CUDA 11.8, COLMAP, PyTorch, Splatfacto)
- Flask web server for image uploads
- All necessary dependencies

### 4. Start the Service

```bash
# Start the container
docker-compose up -d

# View logs
docker-compose logs -f

# To stop
docker-compose down
```

## Usage

### Web Interface

1. Once the container is running, open your browser and navigate to:
   ```
   http://localhost:5000 - Main upload interface
   http://localhost:7007 - Nerfstudio viewer (optional, for live training visualization)
   ```

2. You should see the **Local Gaussian Splatting** interface

3. **Upload Images**:
   - Drag and drop images into the upload zone, or click "Choose Files"
   - Upload at least **5 images** of your scene from different angles
   - Supported formats: JPG, PNG, WebP
   - Recommended: 10-50 images for best results

4. **Choose Quality** (Nerfstudio Splatfacto):
   - **Preview** (~10 min): 7,000 iterations - quick test
   - **Standard** (~20 min): 15,000 iterations - recommended
   - **High** (~30-40 min): 30,000 iterations - high quality
   - **Ultra** (~60-90 min): 50,000 iterations - maximum quality

5. **Start Processing**:
   - Click "Start Processing"
   - Monitor the progress bar
   - The process will:
     - Run COLMAP for Structure from Motion
     - Train the Gaussian Splatting model
     - Generate a 3D point cloud (.ply file)

6. **Download Result**:
   - Once complete, download your 3D model
   - View it using any PLY viewer or the main Splat app

### API Endpoints

The local server exposes a REST API:

- `GET /api/health` - Check server and GPU status
- `POST /api/projects` - Create a new project
- `POST /api/projects/{id}/upload` - Upload images
- `POST /api/process` - Start processing
- `GET /api/status/{job_id}` - Check processing status
- `GET /api/models/{project_id}/{filename}` - Download model
- `GET /api/quality-presets` - Get available quality presets

Example using curl:
```bash
# Create project
curl -X POST http://localhost:5000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "My Project"}'

# Upload images
curl -X POST http://localhost:5000/api/projects/{project_id}/upload \
  -F "files=@image1.jpg" \
  -F "files=@image2.jpg" \
  -F "files=@image3.jpg"

# Start processing
curl -X POST http://localhost:5000/api/process \
  -H "Content-Type: application/json" \
  -d '{"project_id": "{project_id}", "quality": "standard"}'
```

## Data Persistence

Your uploaded images and processed models are stored in:
```
./local-data/
├── uploads/     # Uploaded images organized by project
└── outputs/     # Generated 3D models
```

These directories are mounted as Docker volumes, so your data persists even if you stop/restart the container.

## Troubleshooting

### GPU Not Detected

If you see "GPU Not Available" in the web interface:

1. Check GPU is accessible:
   ```bash
   docker exec -it gaussian-splatting-local nvidia-smi
   ```

2. Verify NVIDIA Container Toolkit is installed:
   ```bash
   docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
   ```

3. Check Docker Compose GPU configuration in `docker-compose.yml`

### Out of Memory

If processing fails with CUDA out of memory:

1. **Reduce image resolution**: Resize images to 1920x1080 or lower before uploading
2. **Use fewer images**: Start with 10-20 images instead of 50+
3. **Lower quality preset**: Use "Preview" instead of "Standard"
4. **Monitor GPU memory**:
   ```bash
   docker-compose --profile monitoring up gpu-monitor
   ```

### Processing Fails

1. **Check logs**:
   ```bash
   docker-compose logs -f
   ```

2. **Verify image quality**:
   - Images should be clear (not blurry)
   - Good overlap between images
   - Varied viewing angles
   - Consistent lighting

3. **Restart container**:
   ```bash
   docker-compose restart
   ```

### Build Issues

If Docker build fails:

1. **Check disk space**: Need at least 20GB free
2. **Check internet connection**: Downloads PyTorch, COLMAP, etc.
3. **Increase Docker memory**: Settings → Resources → Memory (min 8GB)

## Performance Tips

### Image Capture Best Practices
- Take 20-50 images around your subject
- Maintain 60-80% overlap between consecutive images
- Keep consistent lighting
- Avoid motion blur
- Cover all angles (including top and bottom if possible)

### Processing Optimization
- **For testing**: Use "Preview" quality with 10-15 images
- **For good results**: Use "Standard" quality with 30-40 images
- **For best results**: Use "High" or "Ultra" with 50+ images

### GPU Recommendations
- **RTX 3060 (12GB)**: Standard quality, up to 30 images
- **RTX 3080 (10GB)**: High quality, up to 40 images
- **RTX 3090/4090 (24GB)**: Ultra quality, 50+ images
- **RTX 4060 (8GB)**: Preview/Standard, up to 25 images

## Monitoring GPU Usage

To monitor GPU usage while processing:

```bash
# Start monitoring service
docker-compose --profile monitoring up gpu-monitor

# Or manually check
watch -n 1 nvidia-smi
```

## Advanced Usage

### Using Pre-uploaded Images

If you have images on your local machine you want to process:

1. Create a directory with your images:
   ```bash
   mkdir -p ./my-images
   cp /path/to/your/photos/*.jpg ./my-images/
   ```

2. Uncomment the volume mount in `docker-compose.yml`:
   ```yaml
   volumes:
     - ./my-images:/workspace/my-images:ro
   ```

3. Restart container:
   ```bash
   docker-compose restart
   ```

4. Upload through web interface or copy to uploads directory

### Custom Processing Parameters

Edit `local-server/app.py` to modify quality presets:

```python
'custom': {
    'name': 'Custom',
    'iterations': 10000,
    'description': 'Custom quality',
    'position_lr_init': 0.00016,
    'position_lr_final': 0.0000016,
}
```

## Cleanup

### Remove processed data
```bash
# Remove all uploaded images and models
rm -rf ./local-data/uploads/*
rm -rf ./local-data/outputs/*
```

### Remove Docker containers and images
```bash
# Stop and remove containers
docker-compose down

# Remove images (saves disk space)
docker-compose down --rmi all

# Remove volumes (deletes all data)
docker-compose down -v
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Your Browser (http://localhost:5000)          │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│  Flask Web Server (app.py)                      │
│  - Upload endpoint                              │
│  - Processing coordinator                       │
│  - Status API                                   │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│  Nerfstudio Handler (nerfstudio_handler.py)    │
│  ┌──────────────────────────────────────────┐  │
│  │  1. ns-process-data (COLMAP SfM)         │  │
│  │     - Feature extraction                 │  │
│  │     - Feature matching                   │  │
│  │     - Sparse reconstruction              │  │
│  │     - Nerfstudio data format             │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │  2. ns-train splatfacto                  │  │
│  │     - Initialize Gaussian point cloud    │  │
│  │     - Train with GPU optimization        │  │
│  │     - Splatfacto-specific improvements   │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │  3. ns-export gaussian-splat             │  │
│  │     - Export to .ply format              │  │
│  │     - Generate 3D model file             │  │
│  └──────────────────────────────────────────┘  │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│  Your GPU - RTX 4060 (CUDA 11.8, Arch 89)      │
└─────────────────────────────────────────────────┘
```

## Support

- **Issues**: Open an issue on GitHub
- **Documentation**: See `/docs` directory for detailed architecture
- **Main Project**: https://github.com/mmulqu/Splat-app

## Next Steps

After successfully generating a 3D model:

1. **View it locally**: Use a PLY viewer like MeshLab or CloudCompare
2. **Use the main app**: Upload the .ply file to the main Splat app viewer
3. **Convert formats**: Convert to .splat or other formats for web viewing
4. **Experiment**: Try different quality settings and image sets

## Contributing

This is a testing branch for local GPU processing. Contributions welcome!

---

**Happy Splatting! 🎨**
