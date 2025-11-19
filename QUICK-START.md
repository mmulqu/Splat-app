# Quick Start Guide

Get your Splat App running in 5 minutes!

## 🎯 For Testing (Free Tier)

### Option 1: Automated Setup (Recommended)

```bash
# Make sure you have Node.js installed
npm install -g wrangler

# Run the setup script
./setup-dev.sh

# Follow the prompts - it will:
# ✓ Create R2 bucket
# ✓ Create D1 database
# ✓ Run migrations
# ✓ Deploy worker
```

### Option 2: Manual Setup

```bash
# 1. Install Wrangler
npm install -g wrangler
wrangler login

# 2. Create resources
wrangler r2 bucket create splat-app-storage-dev
wrangler d1 create splat-app-db-dev
# Copy the database_id and update worker/wrangler.toml line 16

# 3. Run database migrations
cd worker
wrangler d1 execute splat-app-db-dev --file=schema.sql
wrangler d1 execute splat-app-db-dev --file=seed.sql

# 4. Set secrets (minimum required)
wrangler secret put RUNPOD_API_KEY
wrangler secret put RUNPOD_ENDPOINT_ID
wrangler secret put STRIPE_SECRET_KEY  # Use sk_test_... from Stripe

# 5. Deploy
wrangler deploy

# 6. Update frontend
# Edit src/main.js and change API_ENDPOINT to your worker URL
```

### Test It!

```bash
# Serve the frontend
npx serve .

# Or
python -m http.server 8000

# Open http://localhost:8000
# Upload some photos and test!
```

---

## 🚀 For Production

Only do this after testing in DEV!

```bash
# Run production setup
./setup-prod.sh

# This will:
# ✓ Create separate production resources
# ✓ Deploy to production worker
# ✓ Set up with Stripe LIVE keys

# Then deploy your frontend to Cloudflare Pages:
# 1. Push code to GitHub
# 2. Go to Cloudflare Dashboard > Pages
# 3. Connect GitHub repo
# 4. Deploy!
```

---

## 📋 What You Need

### For Testing (DEV)
- [RunPod](https://runpod.io) account + API key
- [Stripe](https://stripe.com) account (test mode)
- Cloudflare account (free tier is fine)

### For Production
- Everything from DEV, plus:
- Stripe LIVE mode enabled
- Production OAuth apps (Google/GitHub)
- (Optional) Custom domain

---

## 💰 Cost Breakdown

### Testing (Free Tier)
- R2: 10 GB free (enough for ~500 models)
- D1: 5 GB free
- Workers: 100k requests/day free
- **Total: $0/month**

### Production (100 customers, 500 models)
- R2: ~$0.30/month (10 GB)
- Workers: $5/month
- D1: $0 (free tier is plenty)
- **Total: ~$5-6/month**

### RunPod GPU Costs
- Charged per job based on processing time
- ~$0.05-0.20 per model (you set the markup)
- You charge customers credits upfront

---

## 🔧 Common Issues

### "database_id not found"
Update `worker/wrangler.toml` lines 16 and 56 with your database IDs from the create commands.

### "Authentication required"
Run `wrangler login` first.

### "RUNPOD_API_KEY not set"
Set secrets with: `wrangler secret put RUNPOD_API_KEY`

### Frontend can't reach API
Update `src/main.js` line 3 with your worker URL.

---

## 📚 Full Docs

See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete documentation.

---

## 🆘 Need Help?

1. Check [DEPLOYMENT.md](./DEPLOYMENT.md)
2. View Cloudflare logs: `wrangler tail`
3. Check Cloudflare dashboard for errors
4. Make sure secrets are set: `wrangler secret list`

---

## ⚡ Super Quick Test (Skip Setup)

Just want to test the frontend without backend?

```bash
# Serve the frontend
npx serve .

# You won't be able to process models, but you can test:
# - UI layout
# - Photo upload interface
# - Viewer controls
# - Project management UI
```
