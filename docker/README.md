# Gaussian Splatting Docker for RunPod

This Docker image processes photos into 3D Gaussian Splat models using COLMAP and the official Gaussian Splatting implementation.

## 🎯 What This Does

1. **Downloads images** from URLs
2. **Runs COLMAP** for camera pose estimation (Structure from Motion)
3. **Trains Gaussian Splatting** to create a 3D model
4. **Uploads result** PLY file to provided URL
5. **Notifies webhook** when complete

## 📋 Requirements

### For Local Testing
- Docker with GPU support (nvidia-docker2)
- NVIDIA GPU with CUDA 11.8+
- 16GB+ VRAM (RTX 3090/4090 recommended)
- 50GB+ disk space

### For RunPod Deployment
- Docker Hub account
- RunPod account
- GPU credits on RunPod

## 🚀 Quick Start

### 1. Build the Docker Image

```bash
chmod +x build.sh
./build.sh
```

This will take 20-30 minutes as it:
- Installs CUDA and system dependencies
- Compiles COLMAP from source
- Installs Gaussian Splatting and dependencies

### 2. Test Locally

First, create test images or get URLs to real images:

```bash
# Edit test_input.json with real image URLs
nano test_input.json
```

Then run the test:

```bash
chmod +x test-local.sh
./test-local.sh
```

### 3. Upload to Docker Hub

```bash
# Login to Docker Hub
docker login

# Upload image
chmod +x upload-runpod.sh
./upload-runpod.sh
```

### 4. Deploy to RunPod

Follow the instructions printed by `upload-runpod.sh` to create a RunPod serverless endpoint.

---

## 📝 Input Format

The handler expects JSON input with this structure:

```json
{
  "image_urls": [
    "https://your-bucket.com/image1.jpg",
    "https://your-bucket.com/image2.jpg",
    "https://your-bucket.com/image3.jpg"
  ],
  "upload_url": "https://your-bucket.com/output.ply?presigned-params",
  "webhook_url": "https://your-api.com/webhook/job123",
  "project_id": "unique-project-id",
  "params": {
    "iterations": 7000,
    "position_lr_init": 0.00016,
    "position_lr_final": 0.0000016,
    "feature_lr": 0.0025,
    "opacity_lr": 0.05,
    "scaling_lr": 0.005,
    "rotation_lr": 0.001,
    "sh_degree": 3,
    "densify_grad_threshold": 0.0002
  }
}
```

### Parameters Explained

| Parameter | Default | Description |
|-----------|---------|-------------|
| `iterations` | 7000 | Number of training iterations |
| `position_lr_init` | 0.00016 | Initial learning rate for positions |
| `position_lr_final` | 0.0000016 | Final learning rate for positions |
| `feature_lr` | 0.0025 | Learning rate for features |
| `opacity_lr` | 0.05 | Learning rate for opacity |
| `scaling_lr` | 0.005 | Learning rate for scaling |
| `rotation_lr` | 0.001 | Learning rate for rotation |
| `sh_degree` | 3 | Spherical harmonics degree (0-3) |
| `densify_grad_threshold` | 0.0002 | Threshold for densification |

---

## 📤 Output Format

### Success Response

```json
{
  "status": "success",
  "project_id": "unique-project-id",
  "file_size": 52428800,
  "message": "Gaussian Splatting completed successfully"
}
```

### Error Response

```json
{
  "status": "error",
  "error": "Error message here",
  "traceback": "Full stack trace..."
}
```

### Webhook Payload (Success)

```json
{
  "status": "completed",
  "project_id": "unique-project-id",
  "model_url": "https://your-bucket.com/output.ply",
  "file_size": 52428800
}
```

### Webhook Payload (Failure)

```json
{
  "status": "failed",
  "project_id": "unique-project-id",
  "error": "Error message"
}
```

---

## 🔧 Manual Docker Commands

### Build

```bash
docker build -t gaussian-splatting:latest .
```

### Test Locally

```bash
docker run --rm \
  --gpus all \
  -v $(pwd)/test_input.json:/workspace/test_input.json \
  -v $(pwd)/output:/workspace/output \
  gaussian-splatting:latest \
  python3 handler.py test_input.json
```

### Tag for Docker Hub

```bash
docker tag gaussian-splatting:latest YOUR_USERNAME/gaussian-splatting:latest
```

### Push to Docker Hub

```bash
docker push YOUR_USERNAME/gaussian-splatting:latest
```

---

## 🎮 RunPod Configuration

### Create Template

1. Go to https://runpod.io/console/serverless
2. Click "Templates" → "New Template"
3. Configure:
   - **Name**: Gaussian Splatting
   - **Container Image**: `YOUR_USERNAME/gaussian-splatting:latest`
   - **Container Disk**: 20 GB
   - **Volume Disk**: 10 GB (optional)

### Create Endpoint

1. Click "Endpoints" → "New Endpoint"
2. Select your template
3. Configure:
   - **GPU Type**: RTX 3090 or RTX 4090
   - **Min Workers**: 0 (autoscale)
   - **Max Workers**: 3
   - **Idle Timeout**: 60 seconds
   - **Execution Timeout**: 3600 seconds (1 hour)

4. Deploy and copy the **Endpoint ID**

### Get API Key

1. Go to Settings → API Keys
2. Copy your API key

### Update Cloudflare Worker

```bash
cd ../worker
wrangler secret put RUNPOD_API_KEY
# Paste your API key

wrangler secret put RUNPOD_ENDPOINT_ID
# Paste your endpoint ID
```

---

## 💰 Cost Estimation

Processing costs on RunPod (approximate):

| GPU | Cost/hour | 20 images | 50 images |
|-----|-----------|-----------|-----------|
| RTX 3090 | $0.20 | $0.03 | $0.08 |
| RTX 4090 | $0.35 | $0.06 | $0.14 |
| A100 40GB | $1.89 | $0.31 | $0.78 |

Typical processing time:
- **20 images**: ~10 minutes
- **50 images**: ~25 minutes
- **100 images**: ~45 minutes

You charge users credits, so this is your cost - you set your own markup!

---

## 🐛 Troubleshooting

### GPU Not Detected

```bash
# Check if GPU is available
nvidia-smi

# Check if Docker has GPU support
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

If not working, install nvidia-docker2:

```bash
# Ubuntu/Debian
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list

sudo apt-get update
sudo apt-get install -y nvidia-docker2
sudo systemctl restart docker
```

### Build Fails

**COLMAP compilation error**: Make sure you have enough RAM (16GB+) and disk space (50GB+)

**CUDA version mismatch**: Edit Dockerfile to match your GPU's CUDA version

### Runtime Errors

**Out of memory**: Reduce image count or use a GPU with more VRAM

**COLMAP fails**: Images might be too similar or too few. Need at least 5 diverse angles.

**Training fails**: Check that COLMAP succeeded and sparse reconstruction exists.

---

## 📁 Directory Structure

```
docker/
├── Dockerfile              # Docker build configuration
├── handler.py             # Main RunPod handler
├── test_input.json        # Test input data
├── build.sh               # Build Docker image
├── test-local.sh          # Test locally with GPU
├── upload-runpod.sh       # Upload to Docker Hub
├── .dockerignore          # Files to exclude from build
└── README.md              # This file
```

---

## 🔬 Advanced Usage

### Custom COLMAP Parameters

Edit `handler.py` in the `run_colmap()` function to customize COLMAP parameters:

```python
# Change camera model
"--ImageReader.camera_model", "PINHOLE",  # or SIMPLE_RADIAL, RADIAL, OPENCV

# Change feature detector
"--SiftExtraction.max_num_features", "8192",
```

### Custom Training Parameters

All Gaussian Splatting parameters can be passed via the `params` object in the input JSON.

See [Gaussian Splatting docs](https://github.com/graphdeco-inria/gaussian-splatting) for full parameter list.

### Running Without RunPod

The handler works standalone! Just run:

```bash
python3 handler.py test_input.json
```

---

## 📚 References

- [Gaussian Splatting](https://github.com/graphdeco-inria/gaussian-splatting)
- [COLMAP](https://colmap.github.io/)
- [RunPod Docs](https://docs.runpod.io/)

---

## 📄 License

This Docker configuration is provided as-is. The underlying software (COLMAP, Gaussian Splatting) has its own licenses.
