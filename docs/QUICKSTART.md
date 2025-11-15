# Quick Start Guide

Get Splat App running in 5 minutes!

## Prerequisites

- Node.js 18+ installed
- Cloudflare account (free)
- Git installed

## Step 1: Clone and Install (1 minute)

```bash
git clone <your-repo-url>
cd Splat-app
npm install
```

## Step 2: Set Up Cloudflare (2 minutes)

```bash
# Install and login
npm install -g wrangler
wrangler login

# Create resources
wrangler r2 bucket create splat-app-storage
wrangler d1 create splat-app-db
wrangler queues create splat-processing-queue
```

Copy the `database_id` from D1 output and paste it into `worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "SPLAT_DB"
database_name = "splat-app-db"
database_id = "paste-here"  # Replace this!
```

Initialize the database:

```bash
wrangler d1 execute splat-app-db --file=worker/schema.sql
```

## Step 3: Configure GPU Provider (1 minute)

Choose ONE option:

### Option A: RunPod (Recommended)
```bash
# Sign up at runpod.io, get API key
wrangler secret put RUNPOD_API_KEY
# Enter your API key when prompted
```

### Option B: Replicate (Easiest)
```bash
# Sign up at replicate.com, get API token
wrangler secret put REPLICATE_API_KEY
# Enter your API token when prompted
```

### Option C: Skip for now (Testing Only)
You can skip this and use mock processing for testing.

## Step 4: Run Locally (1 minute)

Create `.env` file:
```bash
echo "VITE_API_ENDPOINT=http://localhost:8787/api" > .env
```

Start both servers:

**Terminal 1:**
```bash
cd worker
wrangler dev
```

**Terminal 2:**
```bash
npm run dev
```

Open http://localhost:3000

## Step 5: Test It Out!

1. Click **Capture** tab
2. Click **Start Camera** (or use Upload tab)
3. Take 5-10 test photos
4. Click **Process Reconstruction**

If you set up a GPU provider, it will actually process! Otherwise, you'll see it queue up.

## What's Next?

### For Production:

1. **Deploy Worker:**
   ```bash
   cd worker
   wrangler deploy
   ```

2. **Deploy Frontend:**
   ```bash
   npm run build
   npx wrangler pages deploy dist
   ```

3. **Set production API endpoint:**
   Update your Pages environment variable:
   ```bash
   VITE_API_ENDPOINT=https://your-worker.workers.dev/api
   ```

### For Development:

- Read the full [README.md](../README.md)
- Check out [GPU Processing Options](./GPU_PROCESSING_OPTIONS.md)
- Customize the UI in `index.html`
- Modify worker logic in `worker/src/index.ts`

## Common Issues

### "Camera not working"
- Must use HTTPS or localhost
- Check browser permissions
- Try different browser

### "Worker won't start"
- Make sure you updated `database_id` in `worker/wrangler.toml`
- Run `wrangler login` if authentication fails
- Check you're in the `worker/` directory

### "Upload fails"
- Verify R2 bucket was created
- Check bucket name matches in `worker/wrangler.toml`
- Check worker logs with `wrangler tail`

## Testing Without GPU Provider

You can test the entire flow without GPU processing:

1. Photos upload to R2 ✅
2. Project created in D1 ✅
3. Job queued ✅
4. Status polling works ✅

Only the actual 3D reconstruction won't happen (status stays "processing").

## Need Help?

- Check [README.md](../README.md) for detailed docs
- See [GPU_PROCESSING_OPTIONS.md](./GPU_PROCESSING_OPTIONS.md) for GPU setup
- Open an issue if stuck

---

**Time Check:** You should be running locally in under 5 minutes! 🚀
