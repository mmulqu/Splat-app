# Splat App Architecture

## Overview

Splat App is a serverless, Progressive Web Application for 3D object reconstruction using Gaussian Splatting. The architecture is designed for scalability, low cost, and offline-first capabilities.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     User's Device                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              PWA (Browser)                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐         │   │
│  │  │ Camera   │  │  Upload  │  │  Viewer  │         │   │
│  │  │ Capture  │  │  Photos  │  │   3D     │         │   │
│  │  └──────────┘  └──────────┘  └──────────┘         │   │
│  │                                                     │   │
│  │  ┌─────────────────────────────────────────┐      │   │
│  │  │      IndexedDB (Local Storage)          │      │   │
│  │  │  - Projects metadata                     │      │   │
│  │  │  - Processing status                     │      │   │
│  │  │  - Offline queue                         │      │   │
│  │  └─────────────────────────────────────────┘      │   │
│  │                                                     │   │
│  │  ┌─────────────────────────────────────────┐      │   │
│  │  │      Service Worker (PWA)                │      │   │
│  │  │  - Offline support                       │      │   │
│  │  │  - Background sync                       │      │   │
│  │  │  - Push notifications                    │      │   │
│  │  └─────────────────────────────────────────┘      │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS/WebSocket
                       ↓
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Edge Network                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          Cloudflare Workers (API)                   │   │
│  │                                                      │   │
│  │  Endpoints:                                          │   │
│  │  • POST /api/upload      → Upload photos            │   │
│  │  • POST /api/process     → Start processing         │   │
│  │  • GET  /api/status/:id  → Check status             │   │
│  │  • GET  /api/model/:id   → Download model           │   │
│  │  • GET  /api/projects    → List projects            │   │
│  └─────────────────────────────────────────────────────┘   │
│                       │                                      │
│         ┌─────────────┼─────────────┬──────────────┐        │
│         ↓             ↓             ↓              ↓        │
│    ┌────────┐   ┌─────────┐   ┌────────┐    ┌─────────┐   │
│    │   R2   │   │   D1    │   │ Queue  │    │  KV     │   │
│    │Storage │   │Database │   │        │    │(future) │   │
│    └────────┘   └─────────┘   └────────┘    └─────────┘   │
│        │             │             │                         │
│     Photos &      Projects,     Processing                  │
│      Models       Jobs, Photos   Jobs Queue                 │
└─────────────────────────────────────────────────────────────┘
                       │
                       │ Queue Consumer
                       ↓
┌─────────────────────────────────────────────────────────────┐
│              GPU Cloud Processing                           │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Processing Worker (RunPod/Modal/Replicate)          │  │
│  │                                                        │  │
│  │  1. Receive job from queue                            │  │
│  │  2. Download photos from R2                           │  │
│  │  3. Run Gaussian Splatting algorithm                  │  │
│  │  4. Generate 3D model (.ply/.splat)                   │  │
│  │  5. Upload result to R2                               │  │
│  │  6. Update job status in D1                           │  │
│  │  7. Trigger webhook/notification                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  Options:                                                    │
│  • RunPod Serverless (Recommended)                          │
│  • Modal Labs                                               │
│  • Replicate                                                │
│  • Vast.ai                                                  │
└─────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Progressive Web App (Frontend)

**Technology**: Vite + Vanilla JavaScript + Three.js

**Responsibilities**:
- Photo capture via device camera
- File upload interface
- Local project management
- 3D model visualization
- Offline support
- Background synchronization

**Storage**:
- **IndexedDB**: Project metadata, photos blob references, processing status
- **Cache API**: App shell, static assets
- **Service Worker**: Request caching, background sync, push notifications

**Key Features**:
- Installable on any device
- Works offline after first load
- Auto-updates via service worker
- Push notifications for processing completion

### 2. Cloudflare Workers (Backend API)

**Technology**: TypeScript + Cloudflare Workers Runtime

**Endpoints**:

#### `POST /api/upload`
- Accepts multipart/form-data with photos
- Validates file types and sizes
- Uploads to R2 with unique keys
- Creates project record in D1
- Returns project ID

#### `POST /api/process`
- Accepts project ID
- Validates minimum photo count
- Creates processing job
- Queues job for processing
- Returns job ID

#### `GET /api/status/:jobId`
- Returns current job status
- Includes progress percentage
- Returns model URL when complete

#### `GET /api/model/:modelId`
- Streams model file from R2
- Sets appropriate headers for download

#### `GET /api/projects`
- Lists user's projects
- Sorted by creation date
- Includes status and metadata

**Features**:
- Serverless (zero server management)
- Auto-scaling
- Edge deployment (low latency worldwide)
- CORS handling
- Error logging

### 3. Cloudflare R2 (Object Storage)

**Purpose**: Store photos and generated 3D models

**Structure**:
```
splat-app-storage/
├── projects/
│   ├── {project-id}/
│   │   ├── photos/
│   │   │   ├── 0_photo1.jpg
│   │   │   ├── 1_photo2.jpg
│   │   │   └── ...
│   │   └── metadata.json
│   └── ...
└── models/
    ├── {model-id}.ply
    ├── {model-id}.splat
    └── ...
```

**Benefits**:
- S3-compatible API
- Zero egress fees
- Global replication
- Low cost ($0.015/GB/month)

### 4. Cloudflare D1 (SQL Database)

**Purpose**: Store metadata, job status, relationships

**Schema**:

```sql
-- Projects
projects {
  id: TEXT (UUID)
  status: TEXT (uploading|uploaded|processing|completed|failed)
  photo_count: INTEGER
  created_at: INTEGER (timestamp)
  completed_at: INTEGER
  model_url: TEXT
  error: TEXT
}

-- Photos
photos {
  id: INTEGER (auto)
  project_id: TEXT (FK)
  r2_key: TEXT
  filename: TEXT
  size: INTEGER
  uploaded_at: INTEGER
}

-- Jobs
jobs {
  id: TEXT (UUID)
  project_id: TEXT (FK)
  status: TEXT (queued|processing|completed|failed)
  progress: INTEGER (0-100)
  external_id: TEXT (GPU provider job ID)
  model_url: TEXT
  created_at: INTEGER
  started_at: INTEGER
  completed_at: INTEGER
  error: TEXT
}
```

### 5. Cloudflare Queues

**Purpose**: Decouple upload from processing

**Flow**:
1. User uploads photos
2. Worker creates job record
3. Worker sends message to queue
4. Queue consumer picks up job
5. Consumer triggers GPU processing
6. Consumer updates job status

**Benefits**:
- Handles traffic spikes
- Retry failed jobs
- Rate limiting
- Dead letter queue

### 6. GPU Processing Service

**Options**: RunPod, Modal, Replicate, Vast.ai

**Process**:
1. Receive job from queue
2. Download photos from R2 (pre-signed URLs)
3. Run Gaussian Splatting:
   - Structure from Motion (SfM)
   - Point cloud initialization
   - Gaussian optimization (30K iterations)
   - Rendering quality checks
4. Generate output formats (.ply, .splat)
5. Upload to R2
6. Update D1 job status
7. Optional: Trigger webhook

**Recommended Setup (RunPod)**:
```dockerfile
FROM nvidia/cuda:12.1.0-devel-ubuntu22.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    python3 python3-pip git

# Clone Gaussian Splatting
RUN git clone https://github.com/graphdeco-inria/gaussian-splatting.git
WORKDIR /gaussian-splatting

# Install Python dependencies
RUN pip install -r requirements.txt

# Install submodules
RUN git submodule update --init --recursive

# Add processing script
COPY process.py /app/process.py

CMD ["python3", "/app/process.py"]
```

## Data Flow

### Upload Flow

```
1. User captures/selects photos
   ↓
2. PWA validates files locally
   ↓
3. POST /api/upload (multipart/form-data)
   ↓
4. Worker receives files
   ↓
5. Worker uploads to R2
   ├─ projects/{id}/photos/0.jpg
   ├─ projects/{id}/photos/1.jpg
   └─ ...
   ↓
6. Worker inserts to D1
   ├─ INSERT INTO projects
   └─ INSERT INTO photos (per file)
   ↓
7. Return project ID to PWA
   ↓
8. PWA stores in IndexedDB
```

### Processing Flow

```
1. User clicks "Process"
   ↓
2. POST /api/process {projectId}
   ↓
3. Worker validates project
   ↓
4. Worker creates job record
   ├─ INSERT INTO jobs
   └─ status = 'queued'
   ↓
5. Worker sends to Queue
   ↓
6. Queue consumer receives job
   ↓
7. Consumer calls GPU provider API
   ├─ RunPod: POST /run
   ├─ Modal: trigger function
   └─ Replicate: POST /predictions
   ↓
8. GPU worker downloads photos from R2
   ↓
9. GPU worker runs Gaussian Splatting
   ├─ UPDATE jobs SET status='processing', progress=0
   ├─ ... (periodic progress updates)
   └─ UPDATE jobs SET progress=100
   ↓
10. GPU worker uploads model to R2
    └─ models/{id}.ply
    ↓
11. GPU worker updates D1
    └─ UPDATE jobs SET status='completed', model_url='...'
    ↓
12. Optional: Send push notification
    ↓
13. PWA polls /api/status/{jobId}
    ↓
14. PWA receives model_url
    ↓
15. PWA loads model in viewer
```

### Viewing Flow

```
1. User opens Projects tab
   ↓
2. PWA checks IndexedDB cache
   ↓
3. GET /api/projects
   ↓
4. Worker queries D1
   └─ SELECT * FROM projects ORDER BY created_at DESC
   ↓
5. Return project list
   ↓
6. User clicks project
   ↓
7. PWA loads model URL from project
   ↓
8. GET /api/model/{id}
   ↓
9. Worker streams from R2
   ↓
10. PWA loads in viewer (antimatter15/splat)
    ├─ Parse .ply file
    ├─ Initialize WebGL context
    ├─ Render Gaussian splats
    └─ Enable interaction (rotate, zoom)
```

## Scalability Considerations

### Frontend
- **CDN**: Served globally via Cloudflare Pages
- **Caching**: Aggressive service worker caching
- **Lazy Loading**: Load viewer only when needed
- **Code Splitting**: Vendor chunks separate from app code

### Backend (Workers)
- **Auto-scaling**: Cloudflare handles automatically
- **Edge deployment**: Runs in 200+ datacenters
- **Zero cold starts**: Workers stay warm
- **Request limits**: 100K/day free, unlimited paid

### Storage (R2)
- **No egress fees**: Free bandwidth
- **Global replication**: Automatic
- **Unlimited scale**: No practical limits
- **Cost**: $0.015/GB/month storage

### Database (D1)
- **SQLite-based**: Fast reads
- **Edge replication**: Read from nearest location
- **Limits**: 5M reads/day free
- **Scaling**: Eventual consistency model

### Queue
- **Throughput**: 100 messages/second per queue
- **Batching**: Process multiple jobs together
- **Retry**: Automatic with exponential backoff
- **DLQ**: Dead letter queue for failed jobs

### GPU Processing
- **Horizontal scaling**: Multiple workers in parallel
- **Serverless**: Pay only for processing time
- **Spot instances**: 50%+ cost savings (Vast.ai)
- **Regional**: Deploy workers near R2 regions

## Security

### Authentication (Future)
- Cloudflare Access for enterprise
- OAuth integration (Google, GitHub)
- JWT tokens for API access
- Session management in Workers KV

### Data Protection
- HTTPS everywhere (enforced by Cloudflare)
- Pre-signed R2 URLs (time-limited)
- Input validation (file types, sizes)
- Rate limiting (Cloudflare built-in)
- CORS policies (configured per endpoint)

### Privacy
- No third-party analytics (optional)
- User owns their data
- Easy export/delete
- GDPR compliant

## Monitoring & Observability

### Cloudflare Analytics
- Request counts
- Error rates
- Latency percentiles
- Bandwidth usage

### Worker Logs
```bash
wrangler tail
```
- Real-time log streaming
- Error tracking
- Performance monitoring

### Custom Metrics
```typescript
// Example: Track processing time
await env.ANALYTICS.writeDataPoint({
  blobs: ['processing_complete'],
  doubles: [processingTimeMs],
  indexes: [projectId]
});
```

### Alerts
- Queue depth monitoring
- Error rate thresholds
- Cost alerts
- GPU utilization

## Cost Optimization

### Cloudflare
- Use free tier (covers most usage)
- Enable R2 lifecycle policies (delete old data)
- Optimize worker execution time
- Cache aggressively

### GPU Processing
- Use spot/interruptible instances (50% savings)
- Optimize Gaussian Splatting iterations (quality vs time)
- Batch multiple jobs when possible
- Auto-shutdown idle workers
- Choose right GPU (RTX 4090 vs A100)

### Storage
- Compress photos before upload (client-side)
- Use efficient model formats (.splat < .ply)
- Implement retention policies
- Offer user-managed cleanup

## Future Enhancements

### Phase 2
- [ ] User authentication
- [ ] Project sharing (public URLs)
- [ ] Multiple viewer options
- [ ] Export formats (GLB, GLTF, USDZ)
- [ ] Cloudflare Durable Objects for real-time collaboration

### Phase 3
- [ ] Video input (extract frames)
- [ ] Live streaming capture
- [ ] AR preview (WebXR)
- [ ] Advanced editing tools
- [ ] Team collaboration

### Phase 4
- [ ] Marketplace for models
- [ ] AI-powered scene optimization
- [ ] NeRF support (alternative to Gaussian Splatting)
- [ ] Professional tools (lighting, materials)

## Development Workflow

```bash
# Local development
wrangler dev                    # Worker
npm run dev                     # Frontend

# Testing
npm test                        # Unit tests
npm run test:e2e               # E2E tests (Playwright)

# Deployment
npm run build                   # Build frontend
wrangler deploy                # Deploy worker
wrangler pages deploy dist     # Deploy frontend

# Monitoring
wrangler tail                  # Live logs
wrangler d1 execute ...        # Query database
```

## References

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Gaussian Splatting Paper](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)
- [PWA Best Practices](https://web.dev/progressive-web-apps/)
- [RunPod API Docs](https://docs.runpod.io/)
