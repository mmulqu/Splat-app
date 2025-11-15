# Deployment Guide - Test vs Production

This guide shows you how to set up separate test and production environments for your Splat App.

## 🏗️ Architecture Overview

You'll have **two completely separate environments**:

1. **DEV/TEST** - For testing, development, free tier
2. **PRODUCTION** - For real customers, paid tier

Each environment has its own:
- Cloudflare Worker
- R2 Bucket (separate storage)
- D1 Database (separate data)
- Queue (separate jobs)
- Secrets (different API keys)

---

## 📦 Cloudflare Free Tier Limits

### R2 Storage
- **Free tier:** 10 GB storage, 1 million Class A operations/month
- **After free tier:** $0.015/GB per month (very cheap!)
- **Each PLY model:** ~5-50 MB (average 20 MB)
- **Can store:** 200-2000 models on free tier

### When to upgrade:
- **Hundreds of customers:** You'll need paid R2 (~$1.50/month per 100 GB)
- **R2 is cheap:** Much cheaper than S3 or other storage

### D1 Database
- **Free tier:** 5 GB storage, 5 million rows read/day
- **Plenty for testing and small production**

### Workers
- **Free tier:** 100,000 requests/day
- **Paid tier:** $5/month for 10 million requests

---

## 🚀 Step-by-Step Setup

### Step 1: Install Wrangler CLI

```bash
npm install -g wrangler

# Login to Cloudflare
wrangler login
```

### Step 2: Create DEV Environment Resources

```bash
# Create DEV R2 bucket
wrangler r2 bucket create splat-app-storage-dev

# Create DEV D1 database
wrangler d1 create splat-app-db-dev
# Copy the database_id from output and update wrangler.toml line 16

# Create DEV Queue
wrangler queues create splat-processing-queue-dev

# Run database migrations for DEV
wrangler d1 execute splat-app-db-dev --file=worker/schema.sql
wrangler d1 execute splat-app-db-dev --file=worker/seed.sql
```

### Step 3: Set DEV Secrets

```bash
cd worker

# RunPod API (for GPU processing)
wrangler secret put RUNPOD_API_KEY
# Paste your RunPod API key

wrangler secret put RUNPOD_ENDPOINT_ID
# Paste your RunPod endpoint ID

# Worker URL (after first deployment, update this)
wrangler secret put WORKER_URL
# Example: https://splat-app-worker.your-subdomain.workers.dev

# OAuth (Google) - Create at https://console.cloud.google.com
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# OAuth (GitHub) - Create at https://github.com/settings/developers
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET

# Stripe TEST keys (get from https://dashboard.stripe.com/test/apikeys)
wrangler secret put STRIPE_SECRET_KEY
# Use sk_test_... key

wrangler secret put STRIPE_PUBLISHABLE_KEY
# Use pk_test_... key

wrangler secret put STRIPE_WEBHOOK_SECRET
# Create webhook endpoint at https://dashboard.stripe.com/test/webhooks
```

### Step 4: Deploy DEV Environment

```bash
cd worker

# Deploy to DEV (default environment)
wrangler deploy

# Your worker will be at:
# https://splat-app-worker.your-subdomain.workers.dev
```

### Step 5: Update Frontend for DEV

```bash
# In src/main.js, update API_ENDPOINT
# const API_ENDPOINT = 'https://splat-app-worker.your-subdomain.workers.dev/api';
```

### Step 6: Test Your DEV Environment

```bash
# Serve frontend locally
npx serve .

# Or use any web server
python -m http.server 8000

# Open http://localhost:8000
# Upload test photos
# Process a test model
# Verify everything works
```

---

## 🏭 Production Environment Setup

Only set up production **after** you've tested everything in DEV!

### Step 1: Create PROD Resources

```bash
# Create PROD R2 bucket
wrangler r2 bucket create splat-app-storage-prod

# Create PROD D1 database
wrangler d1 create splat-app-db-prod
# Copy the database_id and update wrangler.toml line 56

# Create PROD Queue
wrangler queues create splat-processing-queue-prod

# Run database migrations for PROD
wrangler d1 execute splat-app-db-prod --file=worker/schema.sql --env production
wrangler d1 execute splat-app-db-prod --file=worker/seed.sql --env production
```

### Step 2: Set PROD Secrets

```bash
cd worker

# Use --env production flag for all secrets

# RunPod API
wrangler secret put RUNPOD_API_KEY --env production
wrangler secret put RUNPOD_ENDPOINT_ID --env production

# Worker URL
wrangler secret put WORKER_URL --env production
# Example: https://splat-app-worker-production.your-subdomain.workers.dev

# OAuth - Use PRODUCTION credentials
wrangler secret put GOOGLE_CLIENT_ID --env production
wrangler secret put GOOGLE_CLIENT_SECRET --env production
wrangler secret put GITHUB_CLIENT_ID --env production
wrangler secret put GITHUB_CLIENT_SECRET --env production

# Stripe LIVE keys (get from https://dashboard.stripe.com/apikeys)
wrangler secret put STRIPE_SECRET_KEY --env production
# Use sk_live_... key (NOT sk_test_!)

wrangler secret put STRIPE_PUBLISHABLE_KEY --env production
# Use pk_live_... key

wrangler secret put STRIPE_WEBHOOK_SECRET --env production
# Create LIVE webhook at https://dashboard.stripe.com/webhooks
```

### Step 3: Deploy to Production

```bash
cd worker

# Deploy to PRODUCTION environment
wrangler deploy --env production

# Your production worker will be at:
# https://splat-app-worker-production.your-subdomain.workers.dev
```

### Step 4: Deploy Frontend to Production

Option 1: **Cloudflare Pages** (Recommended)

```bash
# Push code to GitHub
git push origin main

# Go to Cloudflare Dashboard > Pages
# Connect your GitHub repo
# Set build command: (leave empty)
# Set build output directory: /
# Deploy!

# Your site will be at:
# https://your-project.pages.dev
```

Option 2: **Manual Hosting**

```bash
# Update src/main.js API_ENDPOINT to production URL
# Upload index.html, src/, icons/, manifest.json to your host
```

---

## 💰 Cost Breakdown

### Free Tier (Testing)
- **R2:** 10 GB free (~500 test models)
- **D1:** 5 GB free
- **Workers:** 100k requests/day free
- **Queue:** Included
- **Total:** $0/month for testing!

### Paid Tier (Production with 100+ customers)

**Scenario:** 200 customers, 1000 models total (20 GB)

| Service | Usage | Cost |
|---------|-------|------|
| R2 Storage | 20 GB | $0.30/month |
| R2 Operations | 1M reads | $0 (included) |
| Workers | 1M requests/month | $5/month |
| D1 Database | 5 GB | $0 (free tier) |
| Queue | Included | $0 |
| **Total** | | **$5.30/month** |

**RunPod GPU costs are separate** - charged per job based on processing time.

### Scaling to 1000+ Customers

**Scenario:** 1000 customers, 5000 models (100 GB)

| Service | Usage | Cost |
|---------|-------|------|
| R2 Storage | 100 GB | $1.50/month |
| Workers | 10M requests/month | $5/month |
| D1 Database | 20 GB | $0 (plenty of free tier) |
| **Total** | | **$6.50/month** |

**Cloudflare is incredibly cheap for static assets!**

---

## 🧪 Testing Strategy

### 1. Local Development
```bash
# Run wrangler dev for local testing
cd worker
wrangler dev

# Frontend points to local:
# const API_ENDPOINT = 'http://localhost:8787/api';
```

### 2. DEV Environment
- Use for all feature testing
- Stripe test mode
- Limited test data
- Free tier is fine

### 3. Production Environment
- Only for real customers
- Stripe live mode
- Real payment processing
- Monitor costs via Cloudflare dashboard

---

## 🔄 Common Workflows

### Testing a New Feature
```bash
# 1. Develop locally
wrangler dev

# 2. Deploy to DEV
wrangler deploy

# 3. Test on DEV URL
# 4. If good, deploy to production
wrangler deploy --env production
```

### Checking Storage Usage
```bash
# List files in DEV bucket
wrangler r2 object list splat-app-storage-dev

# List files in PROD bucket
wrangler r2 object list splat-app-storage-prod

# Get bucket size
wrangler r2 bucket info splat-app-storage-dev
```

### Database Queries
```bash
# Query DEV database
wrangler d1 execute splat-app-db-dev --command="SELECT COUNT(*) FROM projects"

# Query PROD database
wrangler d1 execute splat-app-db-prod --command="SELECT COUNT(*) FROM projects" --env production
```

### Monitoring Costs
```bash
# Go to Cloudflare Dashboard > Analytics
# Check R2 usage: Dashboard > R2
# Check Workers usage: Dashboard > Workers & Pages
```

---

## 🚨 Important Notes

### DO NOT Mix Environments
- DEV uses Stripe **test** keys (`sk_test_...`)
- PROD uses Stripe **live** keys (`sk_live_...`)
- Never use live keys in DEV!

### Backup Production Data
```bash
# Backup PROD database
wrangler d1 export splat-app-db-prod --output=backup.sql --env production

# Backup R2 files (use rclone or custom script)
```

### Clear DEV Data Regularly
```bash
# Delete all test projects
wrangler d1 execute splat-app-db-dev --command="DELETE FROM projects"

# Or just recreate the database
wrangler d1 delete splat-app-db-dev
wrangler d1 create splat-app-db-dev
wrangler d1 execute splat-app-db-dev --file=worker/schema.sql
```

---

## 📊 When to Upgrade Cloudflare Plan

### Stay on Free Tier if:
- Testing only
- Less than 100 models
- Less than 100k requests/day

### Upgrade to Paid ($5/month Workers) if:
- 100+ active customers
- 100k+ requests/day
- Need more than 100k requests/day

### Upgrade R2 (Pay as you go) when:
- Storage exceeds 10 GB
- **Cost is only $0.015/GB/month** (super cheap!)
- For 100 GB: $1.50/month
- For 1 TB: $15/month

---

## 🎯 Quick Start for Testing

Just want to test quickly? Here's the minimal setup:

```bash
# 1. Create DEV resources
wrangler r2 bucket create splat-app-storage-dev
wrangler d1 create splat-app-db-dev
# Update database_id in wrangler.toml

# 2. Run migrations
wrangler d1 execute splat-app-db-dev --file=worker/schema.sql
wrangler d1 execute splat-app-db-dev --file=worker/seed.sql

# 3. Set minimal secrets
wrangler secret put RUNPOD_API_KEY
wrangler secret put RUNPOD_ENDPOINT_ID
wrangler secret put WORKER_URL
wrangler secret put STRIPE_SECRET_KEY  # Use test key

# 4. Deploy
wrangler deploy

# 5. Update src/main.js with your worker URL
# 6. Open index.html in browser
# 7. Test!
```

You can skip OAuth (Google/GitHub) for initial testing - just test the core functionality.

---

## 📚 Resources

- [Cloudflare R2 Docs](https://developers.cloudflare.com/r2/)
- [Cloudflare D1 Docs](https://developers.cloudflare.com/d1/)
- [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)

---

**Questions?** Check the Cloudflare dashboard for real-time usage stats and costs!
