# Splat App - Claude Documentation

## Project Overview
Splat App is a 3D Gaussian Splatting reconstruction application that converts 2D images into 3D models. It supports both cloud-based (Cloudflare Workers) and local GPU processing.

## Current Branch
**Branch:** `claude/revert-to-working-version-01Nt7F6rggXcSmweX6xR6T2f`

This branch contains the working local development setup with logging and progress UI features merged from the `reverting-to-working-version` branch.

## Key Features

### Local GPU Processing
- Docker-based local server with GPU acceleration
- Real-time progress tracking and logging
- Nerfstudio integration for high-quality Gaussian Splatting
- Web-based UI for local processing

### Progress & Logging System
The logging/progress UI provides:
- **Real-time progress updates**: Visual progress bar (0-100%)
- **Console logging**: Detailed server-side logs for debugging
- **Iteration tracking**: Parses nerfstudio output to show training progress
- **Status messages**: User-friendly status updates
- **GPU detection**: Checks and displays GPU availability
- **Error handling**: Comprehensive error messages and logging

## Architecture

### Frontend
- **Main App**: `index.html` + `src/main.js` - Cloud-based processing UI
- **Local UI**: `local-server/index.html` - Local GPU processing interface

### Backend

#### Cloud (Cloudflare Workers)
- `worker/src/index.ts` - Main worker entry point
- `worker/src/auth.ts` - Authentication handling
- `worker/src/billing.ts` - Credit system and billing
- `worker/src/quality-presets.ts` - Processing quality configurations

#### Local Server
- `local-server/app.py` - Flask API server with progress tracking
- `local-server/nerfstudio_handler.py` - Nerfstudio integration
- `local-server/local_handler.py` - Alternative COLMAP-based processing
- `local-server/index.html` - Local processing UI
- `local-server/Dockerfile` - GPU-enabled container setup

## Progress Tracking Flow

### 1. Backend Progress Parsing (`app.py`)
```python
# Lines 276-291: Parses nerfstudio stdout
for line in process.stdout:
    print(f"[{job_id}] {line.rstrip()}")
    if 'Iteration' in line:
        # Extract iteration number
        current = int(parts[i + 1].strip(':'))
        progress = 20 + int((current / iterations) * 70)
        job['progress'] = min(progress, 90)
```

### 2. Progress Storage
- Stored in `jobs[job_id]['progress']` (in-memory)
- Exposed via `/api/status/<job_id>` endpoint

### 3. Frontend Polling (`index.html`)
```javascript
// Polls every 2 seconds
setInterval(checkStatus, 2000);

async function checkStatus() {
    const job = await fetch(`/api/status/${jobId}`).then(r => r.json());
    updateProgress(job.progress);
    updateStatus(getStatusMessage(job));
}
```

### 4. Progress Stages
- 0-10%: Project creation and setup
- 10-20%: Image upload
- 20-90%: Nerfstudio training (parsed from iterations)
- 90-100%: Model export and finalization

## Local Development Setup

### Quick Start
```bash
# Start local GPU processing server
./start-local.sh

# Access at http://localhost:5000
```

### Manual Docker Setup
```bash
# Build and run with docker-compose
docker-compose up --build

# Or manually
docker build -t splat-local local-server/
docker run --gpus all -p 5000:5000 -v $(pwd)/uploads:/workspace/uploads splat-local
```

### Requirements
- NVIDIA GPU with CUDA support
- Docker with nvidia-container-toolkit
- At least 8GB GPU memory recommended

See `LOCAL_SETUP.md` for detailed setup instructions.

## API Endpoints

### Local Server (`localhost:5000`)
- `GET /` - Local processing UI
- `GET /api/health` - Health check and GPU status
- `POST /api/projects` - Create new project
- `POST /api/projects/<id>/upload` - Upload images
- `POST /api/process` - Start processing job
- `GET /api/status/<job_id>` - Get job status and progress
- `GET /api/models/<project_id>/<filename>` - Download model
- `GET /api/quality-presets` - Get available quality presets

### Cloud Worker (`splat-worker.matthew-mulqueeny.workers.dev`)
- `POST /api/process` - Cloud-based processing
- `GET /api/status/:jobId` - Job status
- `POST /api/auth/login` - User authentication
- `GET /api/billing/balance` - Credit balance

## File Structure

```
Splat-app/
├── index.html                 # Main cloud UI
├── src/
│   ├── main.js               # Main application logic
│   └── image-utils.js        # Image processing utilities
├── worker/
│   └── src/
│       ├── index.ts          # Cloudflare Worker entry
│       ├── auth.ts           # Authentication
│       ├── billing.ts        # Billing logic
│       └── quality-presets.ts
├── local-server/             # Local GPU processing
│   ├── app.py               # Flask server (progress tracking here!)
│   ├── index.html           # Local UI (progress display here!)
│   ├── nerfstudio_handler.py # Nerfstudio integration
│   ├── local_handler.py     # COLMAP integration
│   ├── Dockerfile           # GPU container
│   └── requirements.txt
├── docker-compose.yml        # Docker orchestration
├── start-local.sh           # Quick start script
├── LOCAL_SETUP.md           # Detailed local setup guide
└── Claude.md                # This file

```

## Quality Presets

### Preview
- Iterations: 7,000
- Time: ~10 minutes
- Use case: Quick previews

### Standard (Recommended)
- Iterations: 15,000
- Time: ~20 minutes
- Use case: General use

### High
- Iterations: 30,000
- Time: ~30-40 minutes
- Use case: High quality models

### Ultra
- Iterations: 50,000
- Time: ~60-90 minutes
- Use case: Maximum quality

## Logging Configuration

### Server Logs
Console output shows:
- Job creation and status
- Upload progress
- Processing stages
- Iteration progress (parsed from nerfstudio)
- Errors and exceptions

### Client Logs
Browser console shows:
- API requests/responses
- Status updates
- Error messages

## Development Workflow

### Adding New Features
1. Update backend logic in `local-server/app.py` or `worker/src/`
2. Add UI components in respective HTML/JS files
3. Test locally with `./start-local.sh`
4. Commit changes to feature branch
5. Create PR to main branch

### Debugging Progress Issues
1. Check server console for nerfstudio output
2. Verify iteration parsing in `app.py` lines 276-291
3. Check browser network tab for `/api/status` calls
4. Review job object in `/api/status/<job_id>` response

## Environment Variables

### Local Development
```bash
# Set in docker-compose.yml or .env
FLASK_ENV=development
UPLOAD_FOLDER=/workspace/uploads
OUTPUT_FOLDER=/workspace/outputs
```

### Production (Cloudflare)
```bash
# Set in wrangler.toml
API_ENDPOINT=https://splat-worker.matthew-mulqueeny.workers.dev/api
```

## Testing

### Local Testing
```bash
# Start server
./start-local.sh

# Upload test images
curl -X POST http://localhost:5000/api/projects

# Check GPU availability
curl http://localhost:5000/api/health
```

### Cloud Testing
Access main UI at GitHub Pages deployment or local dev server with Vite.

## Common Issues

### GPU Not Detected
- Verify nvidia-docker is installed: `docker run --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi`
- Check GPU in container: `docker exec -it <container> nvidia-smi`

### Progress Stuck at 20%
- Check server logs for nerfstudio errors
- Verify iteration parsing is working (should see "Iteration X" in logs)
- Ensure sufficient GPU memory

### Model Export Fails
- Check output directory permissions
- Verify training completed successfully
- Look for `.ply` file in training output directory

## Resources

- [Nerfstudio Documentation](https://docs.nerf.studio/)
- [Gaussian Splatting Paper](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)

## Contributing

This is a working branch with active development. Key areas of the codebase:

- **Progress tracking**: `local-server/app.py` and `local-server/index.html`
- **Cloud processing**: `worker/src/index.ts`
- **UI/UX**: `index.html` and `src/main.js`
- **GPU integration**: `local-server/nerfstudio_handler.py`

## Notes for Future Claude Sessions

### What's Working
- Local GPU processing with real-time progress
- Cloud-based processing via Cloudflare Workers
- Authentication and billing system
- Quality preset selection
- Model download and sharing

### Known Limitations
- In-memory job storage (resets on server restart)
- No persistent database for local server
- Progress parsing relies on nerfstudio output format

### Next Steps (Potential)
- Add persistent job storage (SQLite/PostgreSQL)
- Implement WebSocket for real-time progress
- Add authentication to local server
- Support for more input formats
- Batch processing support

## Quick Reference Commands

```bash
# Start local server
./start-local.sh

# Stop local server
docker-compose down

# View logs
docker-compose logs -f

# Rebuild after changes
docker-compose up --build

# Access container shell
docker exec -it splat-app-local-1 /bin/bash

# Check GPU
nvidia-smi

# Test API
curl http://localhost:5000/api/health
```
