# Splat App - 3D Gaussian Splatting PWA

A Progressive Web App for creating 3D reconstructions from photos using Gaussian Splatting, powered by Cloudflare and GPU cloud processing.

## 🚀 Quick Start

**New to the project?** Start here:

- **[QUICK-START.md](./QUICK-START.md)** - Get running in 5 minutes
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Complete deployment guide (test + production)

```bash
# Automated setup (recommended)
./setup-dev.sh

# Or manual setup - see QUICK-START.md
```

## ✨ Features

### Core Features
- 📸 **Photo Capture**: Use device camera or upload 20-100 photos
- ⚙️ **Quality Presets**: Preview, Standard, High, Ultra quality levels
- ☁️ **Cloud Processing**: GPU-based 3D reconstruction via RunPod
- 👁️ **3D Viewer**: Interactive browser-based model viewer
- 📥 **Download & Share**: Download PLY models, share via public links, embed on websites
- 📱 **Progressive Web App**: Install on any device, works offline

### Advanced Features
- 🔐 **OAuth Login**: Google & GitHub authentication
- 💳 **Stripe Billing**: Credit-based pricing with subscriptions
- 🔔 **Push Notifications**: Get notified when models are ready
- 🎨 **Custom Parameters**: Advanced Gaussian Splatting controls
- 📊 **Project Management**: Organize, filter, and bulk delete projects
- 💰 **Credit System**: Free tier (100 credits), Pro, and Enterprise plans
- 🔄 **Auto-Refund**: Automatic credit refunds on job failures
- 🚫 **Job Cancellation**: Cancel running jobs and get credits back

## Architecture

```
Mobile/Desktop Browser (PWA)
    ↓
Cloudflare Workers (API)
    ↓
R2 Storage (Photos & Models)
    ↓
GPU Cloud Service (RunPod/Modal/etc.)
    ↓
Gaussian Splatting Processing
    ↓
3D Model (.ply/.splat)
```

## Tech Stack

### Frontend
- **Vite** - Build tool
- **Vanilla JavaScript** - No framework overhead
- **Three.js** - 3D visualization
- **IndexedDB** - Local data storage
- **Service Workers** - PWA functionality

### Backend
- **Cloudflare Workers** - Serverless API
- **R2** - Object storage
- **D1** - SQL database
- **Queues** - Job processing

### GPU Processing
- **RunPod** (Recommended) - Serverless GPU
- **Modal Labs** (Alternative) - Python-based serverless
- **Replicate** (Pre-built models)
- **Vast.ai** (Budget option)

See [GPU Processing Options](./docs/GPU_PROCESSING_OPTIONS.md) for detailed comparison.

## Prerequisites

- Node.js 18+ and npm
- Cloudflare account (free tier works)
- GPU cloud provider account (RunPod, Modal, or Replicate)
- Basic knowledge of terminal/command line

## Quick Start

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd Splat-app
npm install
```

### 2. Set Up Cloudflare

#### Create R2 Bucket
```bash
# Install Wrangler CLI
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create R2 bucket
wrangler r2 bucket create splat-app-storage
```

#### Create D1 Database
```bash
# Create database
wrangler d1 create splat-app-db

# Copy the database_id from output and update worker/wrangler.toml

# Run migrations
wrangler d1 execute splat-app-db --file=worker/schema.sql
```

#### Create Queue
```bash
wrangler queues create splat-processing-queue
```

#### Set API Keys
```bash
# Add your GPU provider API key
wrangler secret put RUNPOD_API_KEY
# Or
wrangler secret put MODAL_API_KEY
# Or
wrangler secret put REPLICATE_API_KEY
```

### 3. Configure Environment

Create `.env` file in root:
```env
VITE_API_ENDPOINT=http://localhost:8787/api
```

For production, update to your worker URL:
```env
VITE_API_ENDPOINT=https://your-worker.workers.dev/api
```

### 4. Development

```bash
# Terminal 1: Start Cloudflare Worker locally
cd worker
npm run worker:dev

# Terminal 2: Start Vite dev server
npm run dev
```

Open http://localhost:3000

### 5. Build for Production

```bash
# Build frontend
npm run build

# Deploy worker
cd worker
npm run worker:deploy

# Deploy frontend to Cloudflare Pages
npx wrangler pages deploy dist
```

## Project Structure

```
Splat-app/
├── public/                  # Static assets
│   ├── manifest.json       # PWA manifest
│   └── sw.js              # Service worker
├── src/                    # Frontend source
│   └── main.js            # Main application logic
├── worker/                 # Cloudflare Worker
│   ├── src/
│   │   └── index.ts       # Worker API endpoints
│   ├── schema.sql         # D1 database schema
│   └── wrangler.toml      # Worker configuration
├── docs/                   # Documentation
│   └── GPU_PROCESSING_OPTIONS.md
├── index.html             # Main HTML entry
├── package.json           # Dependencies
├── vite.config.js        # Vite configuration
└── tsconfig.json         # TypeScript config
```

## Usage

### Capturing Photos

1. Click **"Capture"** tab
2. Click **"Start Camera"**
3. Take 20-30 photos from different angles around your object
   - Move in a circular pattern
   - Capture from multiple heights
   - Ensure good lighting
   - Avoid motion blur
4. Click **"Process Reconstruction"**

### Uploading Photos

1. Click **"Upload"** tab
2. Drag and drop photos or click to select
3. Select 20-30 photos (minimum 5)
4. Click **"Upload & Process"**

### Viewing 3D Models

1. Click **"Viewer"** tab after processing completes
2. Use mouse to rotate model
3. Scroll to zoom in/out
4. Models are saved in **"Projects"** tab

## GPU Processing Setup

### Option 1: RunPod (Recommended)

1. Create account at [runpod.io](https://www.runpod.io)
2. Create a serverless endpoint:
   ```bash
   # Build Docker image with Gaussian Splatting
   # Deploy to RunPod
   # Get endpoint ID and API key
   ```
3. Add API key: `wrangler secret put RUNPOD_API_KEY`
4. Update `worker/src/index.ts` with your endpoint details

### Option 2: Modal Labs

1. Create account at [modal.com](https://modal.com)
2. Install Modal CLI:
   ```bash
   pip install modal
   modal token new
   ```
3. Deploy Gaussian Splatting function
4. Add API key: `wrangler secret put MODAL_API_KEY`

### Option 3: Replicate

1. Create account at [replicate.com](https://replicate.com)
2. Get API token
3. Add API key: `wrangler secret put REPLICATE_API_KEY`
4. Use existing Gaussian Splatting models (e.g., DreamGaussian)

See [detailed GPU setup guide](./docs/GPU_PROCESSING_OPTIONS.md)

## Configuration

### Cloudflare Worker (worker/wrangler.toml)

```toml
name = "splat-app-worker"

[[r2_buckets]]
binding = "SPLAT_BUCKET"
bucket_name = "splat-app-storage"

[[d1_databases]]
binding = "SPLAT_DB"
database_name = "splat-app-db"
database_id = "your-database-id"

[[queues.producers]]
binding = "PROCESSING_QUEUE"
queue = "splat-processing-queue"
```

### Vite (vite.config.js)

```javascript
export default defineConfig({
    server: {
        proxy: {
            '/api': 'http://localhost:8787'
        }
    }
});
```

## API Endpoints

### POST /api/upload
Upload photos for processing
- **Body**: FormData with 'photos' field
- **Response**: `{ success: true, projectId: "..." }`

### POST /api/process
Start GPU processing
- **Body**: `{ projectId: "..." }`
- **Response**: `{ success: true, jobId: "..." }`

### GET /api/status/:jobId
Check processing status
- **Response**:
  ```json
  {
    "status": "processing",
    "progress": 45,
    "modelUrl": "..."
  }
  ```

### GET /api/projects
List all projects
- **Response**: `{ projects: [...] }`

### GET /api/model/:modelId
Download 3D model file

## Performance Optimization

### Photo Upload
- Photos are uploaded directly to R2 using signed URLs
- Progress tracking with XHR
- Automatic retry on failure

### Processing
- Queue-based system for handling multiple jobs
- Status polling every 5 seconds
- Webhook support for immediate notifications

### Offline Support
- Service Worker caches app shell
- IndexedDB stores project metadata
- Background sync for failed uploads

## Cost Estimation

### Cloudflare (Free Tier)
- **Workers**: 100,000 requests/day
- **R2**: 10 GB storage, 10M Class A operations
- **D1**: 5 GB storage, 5M reads/day
- **Pages**: Unlimited requests

### GPU Processing (Per Reconstruction)
- **RunPod RTX 4090**: ~$0.12 (20 min)
- **Modal A100**: ~$0.50 (15 min)
- **Replicate**: $0.80-2.00
- **Vast.ai RTX 4090**: ~$0.11 (20 min)

**Monthly estimate (100 reconstructions)**:
- Cloudflare: $0 (free tier)
- GPU (RunPod): $12

See [detailed cost analysis](./docs/GPU_PROCESSING_OPTIONS.md#cost-estimates-for-gaussian-splatting)

## Deployment

### Deploy to Cloudflare Pages

```bash
# Build frontend
npm run build

# Deploy
npx wrangler pages deploy dist --project-name=splat-app

# Set environment variable
npx wrangler pages secret put VITE_API_ENDPOINT
```

### Deploy Worker

```bash
cd worker
npm run worker:deploy
```

### Custom Domain

1. Go to Cloudflare Dashboard → Pages
2. Select your project
3. Go to Custom domains
4. Add your domain

## Troubleshooting

### Camera Not Working
- Check browser permissions (Camera access)
- Use HTTPS (required for camera API)
- Try different browser

### Upload Fails
- Check file size (max 10MB per photo)
- Verify R2 bucket configuration
- Check CORS settings

### Processing Stuck
- Verify GPU provider API key is set
- Check worker logs: `wrangler tail`
- Verify queue is configured

### Model Won't Load
- Check R2 bucket public access
- Verify model URL is correct
- Try different viewer

## Development Tips

### Local Testing
```bash
# Run worker locally
wrangler dev worker/src/index.ts

# Test with local D1
wrangler d1 execute splat-app-db --local --file=worker/schema.sql
```

### Debugging
```bash
# Watch worker logs
wrangler tail

# Check D1 data
wrangler d1 execute splat-app-db --command="SELECT * FROM projects"
```

### Testing GPU Integration
```bash
# Mock GPU processing for testing
export MOCK_GPU_PROCESSING=true
npm run worker:dev
```

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## Roadmap

- [ ] Multiple viewer options (splat viewer, PlayCanvas)
- [ ] Export to different formats (GLB, GLTF)
- [ ] Adjust quality settings
- [ ] Share models via URL
- [ ] Progressive upload (stream photos)
- [ ] Background processing notifications
- [ ] Multi-language support
- [ ] Advanced editing tools
- [ ] Collaboration features

## Resources

- [Gaussian Splatting Paper](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Cloudflare R2 Docs](https://developers.cloudflare.com/r2/)
- [Vite PWA Plugin](https://vite-pwa-org.netlify.app/)
- [GPU Processing Options](./docs/GPU_PROCESSING_OPTIONS.md)

## License

MIT

## Support

- Open an issue for bugs
- Discussions for questions
- Pull requests welcome

---

Built with ❤️ using Cloudflare Workers, Gaussian Splatting, and WebGL
