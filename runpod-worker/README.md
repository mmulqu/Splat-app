# RunPod Serverless Worker for Gaussian Splatting

This directory contains the RunPod serverless worker for processing 3D Gaussian Splatting reconstructions.

## Overview

The worker:
1. Downloads photos from R2 storage
2. Runs Structure from Motion (SfM) using COLMAP
3. Trains Gaussian Splatting model
4. Exports the result as PLY file
5. Uploads to R2 storage
6. Triggers webhook for completion

## Files

- `Dockerfile` - Container image definition
- `rp_handler.py` - Main RunPod handler
- `utils.py` - Utility functions
- `requirements.txt` - Python dependencies
- `test_input.json` - Test input for local development

## Setup

### 1. Build Docker Image

```bash
cd runpod-worker
docker build -t splat-app-worker .
```

### 2. Test Locally

```bash
# Run with test input
docker run --gpus all -v $(pwd):/app splat-app-worker python3 rp_handler.py
```

### 3. Push to Container Registry

```bash
# Tag image
docker tag splat-app-worker:latest your-username/splat-app-worker:latest

# Push to Docker Hub
docker push your-username/splat-app-worker:latest

# Or push to RunPod Container Registry
# See: https://docs.runpod.io/tutorials/introduction/containers
```

## Deploy to RunPod

### Option 1: Via RunPod Web UI

1. Go to [RunPod Serverless](https://www.runpod.io/console/serverless)
2. Click **"+ New Endpoint"**
3. Configure:
   - **Name**: splat-app-worker
   - **Container Image**: your-username/splat-app-worker:latest
   - **Container Disk**: 20 GB
   - **GPU**: RTX 4090 or A100 (recommended)
   - **Min Workers**: 0 (scale to zero)
   - **Max Workers**: 5
   - **Idle Timeout**: 30 seconds
   - **Execution Timeout**: 3600 seconds (1 hour)

4. Click **"Deploy"**
5. Copy your **Endpoint ID** and **API Key**

### Option 2: Via RunPod API

```bash
curl -X POST https://api.runpod.ai/v2/endpoints \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "splat-app-worker",
    "image": "your-username/splat-app-worker:latest",
    "gpu_type": "NVIDIA RTX 4090",
    "workers": {
      "min": 0,
      "max": 5
    },
    "config": {
      "timeout": 3600,
      "idle_timeout": 30
    }
  }'
```

## Usage

### API Endpoint

Once deployed, your endpoint will be available at:
```
https://api.runpod.ai/v2/{ENDPOINT_ID}/run
```

### Input Format

```json
{
  "input": {
    "project_id": "project-uuid",
    "image_urls": [
      "https://r2-bucket.com/photos/1.jpg",
      "https://r2-bucket.com/photos/2.jpg",
      "..."
    ],
    "iterations": 7000,
    "upload_url": "https://r2-bucket.com/models/output.ply?presigned=...",
    "webhook_url": "https://your-worker.workers.dev/api/webhook/job-id"
  }
}
```

### Example Request

```bash
curl -X POST https://api.runpod.ai/v2/YOUR_ENDPOINT_ID/run \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d @test_input.json
```

### Response

```json
{
  "id": "job-uuid",
  "status": "IN_QUEUE"
}
```

### Check Status

```bash
curl https://api.runpod.ai/v2/YOUR_ENDPOINT_ID/status/JOB_ID \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Configuration

### Environment Variables

Set these in RunPod dashboard or Dockerfile:

- `ITERATIONS` - Default training iterations (default: 7000)
- `MAX_TIMEOUT` - Maximum processing timeout in seconds
- `TEMP_DIR` - Temporary working directory

### GPU Selection

Recommended GPUs by use case:

| GPU | Cost/hr | Speed | Best For |
|-----|---------|-------|----------|
| RTX 4090 | $0.35 | Fast | Production (best value) |
| RTX 3090 | $0.20 | Medium | Budget |
| A100 80GB | $2.17 | Fastest | High quality/large scenes |
| T4 | $0.40 | Slow | Development/testing |

### Training Iterations

- **Low quality** (fast): 3000 iterations (~5 min)
- **Medium quality**: 7000 iterations (~15 min)
- **High quality**: 15000 iterations (~30 min)
- **Best quality**: 30000 iterations (~1 hour)

## Cost Estimation

Average costs per reconstruction:

| GPU | Low (3K iter) | Medium (7K iter) | High (15K iter) |
|-----|--------------|------------------|-----------------|
| RTX 4090 | $0.06 | $0.12 | $0.25 |
| RTX 3090 | $0.04 | $0.08 | $0.15 |
| A100 80GB | $0.30 | $0.54 | $1.10 |

*Costs include COLMAP + training + overhead*

## Monitoring

### View Logs

```bash
# Stream logs in real-time
curl https://api.runpod.ai/v2/YOUR_ENDPOINT_ID/stream/JOB_ID \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Metrics

RunPod dashboard provides:
- Active workers
- Queue depth
- Success/failure rate
- Average processing time
- Total cost

## Troubleshooting

### Build Fails

**Issue**: Docker build fails on CUDA/PyTorch
```bash
# Try with --no-cache
docker build --no-cache -t splat-app-worker .
```

**Issue**: Out of memory during build
```bash
# Increase Docker memory limit
# Docker Desktop → Settings → Resources → Memory
```

### Runtime Errors

**Issue**: CUDA not available
```bash
# Test CUDA in container
docker run --gpus all splat-app-worker nvidia-smi
```

**Issue**: Timeout during processing
```bash
# Increase timeout in RunPod dashboard
# Or reduce iterations in input
```

**Issue**: Out of VRAM
```bash
# Use GPU with more VRAM (A100 80GB)
# Or reduce image resolution
```

### Performance Issues

**Slow COLMAP**:
- Reduce image count
- Lower image resolution
- Use `--skip_matching` flag

**Slow Training**:
- Reduce iterations
- Use better GPU (A100)
- Optimize batch size

## Development

### Local Testing

```bash
# Test handler locally (CPU only)
python3 rp_handler.py

# Test with RunPod CLI
runpod develop

# Test specific function
python3 -c "from rp_handler import process_gaussian_splatting; ..."
```

### Debugging

Add debug output:
```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

View detailed errors:
```python
import traceback
traceback.print_exc()
```

## Optimization Tips

### Reduce Costs

1. **Use cheaper GPUs**: RTX 4090 instead of A100
2. **Reduce iterations**: 7K instead of 30K
3. **Scale to zero**: Set min workers to 0
4. **Shorter timeout**: Reduce idle timeout
5. **Batch jobs**: Process multiple at once

### Improve Speed

1. **Use A100 GPU**: 2-3x faster than RTX 4090
2. **Optimize COLMAP**: Use existing camera params
3. **Reduce image resolution**: 1920x1080 instead of 4K
4. **Parallel processing**: Multiple workers
5. **Pre-warm workers**: Keep 1 worker active

### Improve Quality

1. **More iterations**: 15K-30K
2. **More photos**: 30-50 instead of 20
3. **Better photo coverage**: Full 360° coverage
4. **Higher resolution**: 4K images
5. **Better GPU**: A100 80GB

## Resources

- [RunPod Documentation](https://docs.runpod.io/)
- [Gaussian Splatting Paper](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)
- [RunPod Discord](https://discord.gg/runpod)
- [Gaussian Splatting GitHub](https://github.com/graphdeco-inria/gaussian-splatting)

## Support

Issues with:
- **RunPod**: https://discord.gg/runpod
- **Gaussian Splatting**: https://github.com/graphdeco-inria/gaussian-splatting/issues
- **This Worker**: Open issue in main repo

## License

MIT License - see main project LICENSE file
