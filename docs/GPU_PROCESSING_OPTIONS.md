# GPU Cloud Processing Options for Gaussian Splatting

This document compares various GPU cloud providers for running 3D Gaussian Splatting reconstruction workloads.

## Executive Summary

Based on research conducted in November 2025, here are the recommended GPU cloud processing options ranked by suitability:

### 🥇 Recommended: **RunPod Serverless**
- **Best for**: Variable workload, pay-per-use
- **Cost**: $0.40-2.17/hr (GPU-dependent)
- **Startup**: Fast cold starts
- **Ease**: Simple API integration

### 🥈 Alternative: **Modal Labs**
- **Best for**: Developer experience, fast iteration
- **Cost**: Usage-based pricing
- **Startup**: 2-4 second cold starts
- **Ease**: Excellent Python SDK

### 🥉 Budget Option: **Vast.ai**
- **Best for**: Lowest cost, flexible
- **Cost**: 5-6x cheaper than major clouds
- **Startup**: Variable (marketplace)
- **Ease**: Requires more setup

---

## Detailed Comparison

### 1. RunPod Serverless GPU

**Official Site**: https://www.runpod.io/product/serverless

#### Pricing (2025)
- **T4 GPU**: $0.40/hr
- **RTX 4090**: $0.35/hr
- **RTX 3090**: ~$0.20/hr
- **A100 80GB**: $2.17/hr

#### Storage Costs
- $0.000011574 per GB per 5 minutes (~$0.10/GB/month)
- Network volumes: $0.07/GB/month (first 1TB), $0.05/GB/month (additional)

#### Worker Types
1. **Flex Workers** (Recommended)
   - Scale to zero when idle
   - Pay only during processing
   - Best for variable workloads

2. **Active Workers**
   - Always-on (24/7)
   - 20-30% discount vs flex
   - Best for consistent workloads

#### Billing Phases
- **Start time**: Worker initialization + model loading
- **Execution time**: Actual processing
- **Idle time**: After completion before shutdown

#### Integration Example
```javascript
// RunPod API integration
async function processWithRunPod(imageUrls, apiKey) {
    const response = await fetch('https://api.runpod.ai/v2/your-endpoint/run', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            input: {
                images: imageUrls,
                // Gaussian splatting parameters
                iterations: 30000,
                position_lr_init: 0.00016,
                feature_lr: 0.0025,
            }
        })
    });

    return await response.json();
}
```

#### Pros
- ✅ Competitive pricing
- ✅ True serverless (scale to zero)
- ✅ Simple API
- ✅ Pay-per-second billing
- ✅ Multiple GPU options

#### Cons
- ❌ Need to containerize your workload
- ❌ Cold start overhead

---

### 2. Modal Labs

**Official Site**: https://modal.com/

#### Pricing (2025)
- Usage-based (vCPU + GPU time)
- Access to thousands of GPUs
- Scale to zero when idle
- Specific GPU pricing available on request

#### Key Features
- **Cold Start**: 2-4 seconds
- **Infrastructure**: OCI AI Infrastructure partnership
- **Developer Experience**: Engineered for fine-grained control
- **Python SDK**: Excellent developer tooling

#### Integration Example
```python
# Modal example for Gaussian Splatting
import modal

app = modal.App("gaussian-splatting")

@app.function(
    gpu="A100",
    image=modal.Image.debian_slim().pip_install("torch", "torchvision"),
    timeout=3600,
)
def process_splat(image_urls: list[str]):
    # Download images
    # Run gaussian splatting
    # Upload results
    return {"model_url": "..."}

@app.local_entrypoint()
def main():
    result = process_splat.remote(["url1", "url2", ...])
```

#### Real-World Usage
- Successfully used for GaussianObject 3D reconstruction
- Proven for computer vision workloads
- Fast GPU access for cold starts

#### Pros
- ✅ Subsecond startup times
- ✅ Excellent Python SDK
- ✅ Great developer experience
- ✅ Thousands of GPUs available
- ✅ Fast cold starts

#### Cons
- ❌ Pricing less transparent
- ❌ Python-focused (not ideal for JS-first projects)

---

### 3. Replicate

**Official Site**: https://replicate.com/

#### Pricing (2025)
- **T4 GPU**: $0.000225/second ($0.81/hr) - public models
- **T4 GPU**: $0.000550/second ($1.98/hr) - private models
- **8x A40 Large**: $0.005800/second ($20.88/hr)

#### Available Models
- DreamGaussian model available
- Runs on Nvidia A100 (80GB)

#### Integration Example
```javascript
// Replicate API integration
async function processWithReplicate(imageUrls, apiKey) {
    const response = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
            'Authorization': `Token ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            version: 'mareksagan/dreamgaussian',
            input: {
                images: imageUrls
            },
            webhook: 'https://your-worker.workers.dev/webhook'
        })
    });

    return await response.json();
}
```

#### Pros
- ✅ Pre-built models available
- ✅ Simple API
- ✅ Webhook support
- ✅ Well-documented

#### Cons
- ❌ More expensive than alternatives
- ❌ Limited control over models
- ❌ Per-second billing can add up

---

### 4. Vast.ai

**Official Site**: https://vast.ai/

#### Pricing (2025)
- **RTX 4090**: From $0.34/hr
- **RTX 3080**: From $0.30/hr
- **A100**: $1.50-5.00/hr (demand-dependent)
- **H100 PCIe**: From $1.99/hr

**5-6x cheaper than AWS/GCP/Azure**

#### Pricing Model
1. **Active rental cost**: GPU time (only when running)
2. **Storage cost**: Allocated disk (even when stopped)
3. **Bandwidth**: Data transfer

#### Marketplace Options
- **On-demand**: Instant spin-up
- **Interruptible**: Up to 50% savings
- **Auction pricing**: Best rates

#### Integration Example
```javascript
// Vast.ai SSH-based workflow
async function processWithVast(imageUrls) {
    // 1. Rent instance via API
    // 2. Upload images via SCP
    // 3. Execute gaussian splatting via SSH
    // 4. Download results
    // 5. Destroy instance
}
```

#### Pros
- ✅ Lowest cost
- ✅ Wide GPU selection (10,000+ GPUs)
- ✅ Flexible pricing (on-demand/interruptible)
- ✅ Per-second billing

#### Cons
- ❌ More complex setup
- ❌ Instance management required
- ❌ Variable availability
- ❌ Less polished than competitors

---

## Cost Estimates for Gaussian Splatting

### Typical Processing Time
- **20-30 photos**: 10-30 minutes
- **High quality (30K iterations)**: 30-60 minutes

### Cost per Reconstruction

| Provider | GPU | Time | Cost |
|----------|-----|------|------|
| RunPod | RTX 4090 | 20 min | **$0.12** |
| RunPod | A100 80GB | 15 min | **$0.54** |
| Modal | A100 | 15 min | **~$0.50** |
| Replicate | A100 80GB | 15 min | **$0.80-2.00** |
| Vast.ai | RTX 4090 | 20 min | **$0.11** |
| Vast.ai | A100 | 15 min | **$0.38-1.25** |

---

## Recommendations by Use Case

### 🎯 For Production PWA (Your Use Case)

**Primary**: **RunPod Serverless** with Flex Workers
- Best balance of cost, reliability, and ease of integration
- True serverless (no idle costs)
- Simple REST API (works well with Cloudflare Workers)
- Predictable pricing

**Backup**: **Modal Labs**
- If you need faster cold starts
- Better for Python-heavy workflows
- Excellent reliability

### 🧪 For Prototyping/Development

**Vast.ai**
- Lowest cost for experimentation
- Direct instance access for debugging

### 💼 For Enterprise/High Volume

**Modal Labs**
- Best developer experience
- Excellent reliability
- Fast scaling

---

## Implementation Strategy for Splat App

### Phase 1: MVP (Recommended)
1. **Use RunPod Serverless**
   - Create Docker container with Gaussian Splatting
   - Deploy to RunPod
   - Integrate with Cloudflare Workers

### Phase 2: Optimization
1. **Add Modal Labs as backup**
   - Better cold start times
   - Fallback if RunPod unavailable

### Phase 3: Scale
1. **Implement multi-provider**
   - Route based on availability
   - Optimize cost per region
   - Load balancing

---

## GPU Requirements for Gaussian Splatting

### Minimum
- **VRAM**: 12GB (RTX 3090/4090)
- **Training Time**: 20-30 minutes
- **Quality**: Good

### Recommended
- **VRAM**: 24GB+ (RTX 3090/4090, A100)
- **Training Time**: 10-15 minutes
- **Quality**: Excellent

### Optimal
- **VRAM**: 80GB (A100 80GB, H100)
- **Training Time**: 5-10 minutes
- **Quality**: Maximum

---

## Next Steps

1. **Set up RunPod account**
   - Create API key
   - Build Docker container
   - Deploy endpoint

2. **Configure Cloudflare Worker**
   - Add RUNPOD_API_KEY secret
   - Implement integration

3. **Test end-to-end**
   - Upload photos
   - Trigger processing
   - Download results

4. **Monitor costs**
   - Track per-reconstruction cost
   - Optimize parameters
   - Consider multi-provider setup

---

## Additional Resources

- [RunPod Documentation](https://docs.runpod.io/)
- [Modal Labs Docs](https://modal.com/docs)
- [Replicate Docs](https://replicate.com/docs)
- [Vast.ai Docs](https://docs.vast.ai/)
- [Gaussian Splatting Paper](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)
- [Nerfstudio (includes Gaussian Splatting)](https://docs.nerf.studio/)

---

## Cost Tracking Template

```javascript
// Track costs in your application
const costTracking = {
    provider: 'runpod',
    gpu: 'rtx4090',
    processingTime: 1234, // seconds
    cost: 0.12,
    photoCount: 25,
    quality: 'high',
    timestamp: Date.now()
};
```

This allows you to:
- Analyze cost per reconstruction
- Optimize GPU selection
- Choose best provider
- Forecast expenses
