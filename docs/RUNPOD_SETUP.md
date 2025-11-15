# RunPod Setup Guide

Complete guide to deploying and configuring RunPod for Gaussian Splatting processing.

## Prerequisites

- Docker installed locally
- RunPod account (sign up at [runpod.io](https://www.runpod.io))
- Docker Hub account (or other container registry)

## Step 1: Build Docker Image

Navigate to the `runpod-worker` directory:

```bash
cd runpod-worker
```

Build the Docker image:

```bash
docker build -t splat-app-worker:latest .
```

This build process will:
- Install CUDA 12.1 and PyTorch
- Clone the Gaussian Splatting repository
- Install all dependencies
- Set up the RunPod handler

**Note**: The build takes ~15-20 minutes due to CUDA and PyTorch installation.

## Step 2: Test Locally (Optional)

Test the image locally with GPU:

```bash
# Test with GPU (requires NVIDIA Docker runtime)
docker run --gpus all -it splat-app-worker:latest python3 -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"
```

Test the handler:

```bash
docker run --gpus all -v $(pwd):/app splat-app-worker:latest python3 rp_handler.py
```

## Step 3: Push to Container Registry

### Option A: Docker Hub

Tag and push to Docker Hub:

```bash
# Replace 'yourusername' with your Docker Hub username
docker tag splat-app-worker:latest yourusername/splat-app-worker:latest
docker push yourusername/splat-app-worker:latest
```

### Option B: GitHub Container Registry

```bash
# Login to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Tag and push
docker tag splat-app-worker:latest ghcr.io/yourusername/splat-app-worker:latest
docker push ghcr.io/yourusername/splat-app-worker:latest
```

### Option C: RunPod Container Registry

Follow [RunPod's container registry guide](https://docs.runpod.io/tutorials/introduction/containers).

## Step 4: Create RunPod Serverless Endpoint

### Via Web UI

1. Go to [RunPod Console](https://www.runpod.io/console/serverless)

2. Click **"+ New Endpoint"**

3. Fill in the configuration:

   **Basic Settings:**
   - **Endpoint Name**: `splat-app-worker`
   - **Container Image**: `yourusername/splat-app-worker:latest`
   - **Container Disk**: 20 GB (minimum)

   **GPU Configuration:**
   - **Select GPU**: RTX 4090 (recommended) or A100
   - **Min Workers**: 0 (scale to zero when idle)
   - **Max Workers**: 5 (adjust based on expected load)
   - **GPUs Per Worker**: 1

   **Advanced Settings:**
   - **Idle Timeout**: 30 seconds
   - **Execution Timeout**: 3600 seconds (1 hour)
   - **Max Concurrent Requests**: 1 per worker

4. Click **"Deploy"**

5. Wait for deployment (2-5 minutes)

6. Once deployed, note your:
   - **Endpoint ID**: (e.g., `abc123def456`)
   - **API Key**: (shown once - save it securely!)

### Via API

```bash
curl -X POST https://api.runpod.ai/v2/endpoints \
  -H "Authorization: Bearer YOUR_RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "splat-app-worker",
    "image": "yourusername/splat-app-worker:latest",
    "gpu_type_id": "NVIDIA RTX 4090",
    "workers": {
      "min": 0,
      "max": 5
    },
    "config": {
      "timeout": 3600,
      "idle_timeout": 30,
      "container_disk_size_gb": 20
    }
  }'
```

## Step 5: Configure Cloudflare Worker

Set the RunPod credentials in your Cloudflare Worker:

```bash
cd ../worker

# Set RunPod API key
wrangler secret put RUNPOD_API_KEY
# Paste your RunPod API key when prompted

# Set RunPod Endpoint ID
wrangler secret put RUNPOD_ENDPOINT_ID
# Paste your Endpoint ID (e.g., abc123def456)

# Set Worker URL for webhooks
wrangler secret put WORKER_URL
# Enter your worker URL (e.g., https://splat-app.your-subdomain.workers.dev)
```

## Step 6: Test End-to-End

### Test RunPod Endpoint Directly

```bash
curl -X POST https://api.runpod.ai/v2/YOUR_ENDPOINT_ID/run \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "project_id": "test-123",
      "image_urls": [
        "https://example.com/photo1.jpg",
        "https://example.com/photo2.jpg",
        "https://example.com/photo3.jpg",
        "https://example.com/photo4.jpg",
        "https://example.com/photo5.jpg"
      ],
      "iterations": 3000,
      "upload_url": "https://your-r2-bucket.com/models/test.ply",
      "webhook_url": "https://your-worker.workers.dev/api/webhook/test-job"
    }
  }'
```

Response:
```json
{
  "id": "job-uuid-here",
  "status": "IN_QUEUE"
}
```

### Check Job Status

```bash
curl https://api.runpod.ai/v2/YOUR_ENDPOINT_ID/status/JOB_ID \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Test via PWA

1. Open your PWA
2. Upload 5+ photos
3. Click "Process Reconstruction"
4. Watch the status updates
5. View the 3D model when complete

## Monitoring

### View Logs

Real-time logs:
```bash
curl https://api.runpod.ai/v2/YOUR_ENDPOINT_ID/stream/JOB_ID \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### RunPod Dashboard

Monitor your endpoint at:
https://www.runpod.io/console/serverless/user/endpoints/YOUR_ENDPOINT_ID

Metrics include:
- Active workers
- Queue depth
- Jobs processed
- Success/failure rate
- Total cost

## Costs

### GPU Pricing (as of 2025)

| GPU | Cost/Hour | Best For |
|-----|-----------|----------|
| RTX 4090 | $0.35 | Production (recommended) |
| RTX 3090 | $0.20 | Budget option |
| A100 80GB | $2.17 | High quality/fastest |
| A100 40GB | $1.89 | Good balance |
| T4 | $0.40 | Development/testing |

### Estimated Cost Per Reconstruction

**RTX 4090 (Recommended)**:
- 20 photos, 7K iterations: $0.12
- 30 photos, 15K iterations: $0.25

**A100 80GB** (Fastest):
- 20 photos, 7K iterations: $0.54
- 30 photos, 15K iterations: $1.10

**Cost Optimization Tips**:
1. Set min workers to 0 (scale to zero)
2. Use RTX 4090 instead of A100 for most use cases
3. Reduce iterations for preview quality
4. Lower idle timeout (30 seconds)
5. Monitor and adjust max workers based on usage

## Scaling

### Vertical Scaling (Better GPU)

Switch to A100 for:
- Faster processing (2-3x speedup)
- Higher quality results
- Larger scenes (100+ photos)

### Horizontal Scaling (More Workers)

Increase max workers for:
- Higher concurrent processing
- Peak traffic handling
- Better availability

**Recommended Settings**:
- Small app: min=0, max=2
- Medium app: min=0, max=5
- Large app: min=1, max=10

## Troubleshooting

### Build Issues

**Error**: CUDA not found
```bash
# Ensure you're using the correct base image
FROM nvidia/cuda:12.1.0-devel-ubuntu22.04
```

**Error**: Out of memory during build
```bash
# Increase Docker memory limit in Docker Desktop settings
# Or build with --memory flag
docker build --memory=8g -t splat-app-worker .
```

### Deployment Issues

**Error**: Container failed to start
- Check logs in RunPod dashboard
- Verify container image is publicly accessible
- Ensure container disk size is sufficient (min 20GB)

**Error**: Timeout during startup
- Increase idle timeout in endpoint settings
- Check if handler is starting correctly
- Review handler logs

### Runtime Issues

**Error**: CUDA out of memory
- Use GPU with more VRAM (A100 80GB)
- Reduce batch size in training
- Lower image resolution

**Error**: Job timeout
- Increase execution timeout (default 1 hour)
- Reduce training iterations
- Use faster GPU (A100)

**Error**: Webhook not received
- Verify WORKER_URL is set correctly
- Check webhook URL in job payload
- Ensure worker endpoint is accessible

### Performance Issues

**Slow COLMAP**:
```python
# In rp_handler.py, add skip_matching flag
--skip_matching  # Uses faster feature matching
```

**Slow Training**:
- Use A100 instead of RTX 4090
- Reduce iterations (7K instead of 30K)
- Lower image count

## Updates

### Update Container Image

1. Make changes to Dockerfile or handler
2. Rebuild image:
   ```bash
   docker build -t splat-app-worker:latest .
   ```
3. Push to registry:
   ```bash
   docker push yourusername/splat-app-worker:latest
   ```
4. Update endpoint in RunPod dashboard:
   - Go to endpoint settings
   - Update container image
   - Save changes
5. Existing workers will update automatically

### Update Environment Variables

Update secrets in Cloudflare Worker:
```bash
wrangler secret put RUNPOD_API_KEY
wrangler secret put RUNPOD_ENDPOINT_ID
```

## Security

### API Keys

- **Never commit API keys** to version control
- Store in Cloudflare Worker secrets
- Rotate keys periodically
- Use scoped keys when possible

### Container Security

- Use official base images only
- Scan for vulnerabilities:
  ```bash
  docker scan splat-app-worker:latest
  ```
- Keep dependencies updated
- Don't expose unnecessary ports

### Network Security

- Use HTTPS for all API calls
- Validate webhook signatures
- Use pre-signed URLs for R2 access
- Rate limit API endpoints

## Support

- **RunPod Docs**: https://docs.runpod.io/
- **RunPod Discord**: https://discord.gg/runpod
- **Gaussian Splatting Issues**: https://github.com/graphdeco-inria/gaussian-splatting/issues
- **Project Issues**: Open issue in main repo

## Next Steps

1. ✅ RunPod endpoint deployed
2. ✅ Cloudflare Worker configured
3. Test with real photos
4. Monitor costs and performance
5. Optimize based on usage patterns
6. Scale as needed

Congratulations! Your RunPod Gaussian Splatting worker is now live! 🎉
