#!/bin/bash

# Splat App - PRODUCTION Environment Setup Script
# ⚠️ ONLY run this when you're ready to deploy to production!

set -e  # Exit on error

echo "🏭 Splat App - PRODUCTION Environment Setup"
echo "==========================================="
echo ""
echo "⚠️  WARNING: This will set up your PRODUCTION environment!"
echo "⚠️  Make sure you have:"
echo "   - Tested everything in DEV"
echo "   - Stripe LIVE API keys ready (sk_live_...)"
echo "   - Production OAuth credentials"
echo "   - A custom domain (optional but recommended)"
echo ""
read -p "Continue? (yes/no) " -n 3 -r
echo ""

if [[ ! $REPLY =~ ^yes$ ]]; then
    echo "Cancelled."
    exit 0
fi

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found!"
    echo "Install it with: npm install -g wrangler"
    exit 1
fi

echo "✅ Wrangler CLI found"
echo ""

# Create R2 bucket
echo "📦 Creating PRODUCTION R2 bucket..."
if wrangler r2 bucket create splat-app-storage-prod 2>/dev/null; then
    echo "✅ R2 bucket created: splat-app-storage-prod"
else
    echo "ℹ️  R2 bucket already exists"
fi
echo ""

# Create D1 database
echo "💾 Creating PRODUCTION D1 database..."
DB_OUTPUT=$(wrangler d1 create splat-app-db-prod 2>&1 || true)

if echo "$DB_OUTPUT" | grep -q "database_id"; then
    DB_ID=$(echo "$DB_OUTPUT" | grep "database_id" | awk -F'"' '{print $2}')
    echo "✅ D1 database created: splat-app-db-prod"
    echo "📝 Database ID: $DB_ID"
    echo ""
    echo "⚠️  IMPORTANT: Update worker/wrangler.toml line 56 with this database_id:"
    echo "   database_id = \"$DB_ID\""
    echo ""
    read -p "Press Enter after you've updated wrangler.toml..."
else
    echo "ℹ️  D1 database might already exist"
fi
echo ""

# Create Queue
echo "📬 Creating PRODUCTION Queue..."
if wrangler queues create splat-processing-queue-prod 2>/dev/null; then
    echo "✅ Queue created: splat-processing-queue-prod"
else
    echo "ℹ️  Queue already exists"
fi
echo ""

# Run database migrations
echo "🗄️  Running database migrations..."
cd worker

wrangler d1 execute splat-app-db-prod --file=schema.sql --env production --yes
echo "✅ Schema created"

wrangler d1 execute splat-app-db-prod --file=seed.sql --env production --yes
echo "✅ Seed data inserted"
echo ""

# Set secrets
echo "🔑 Setting up PRODUCTION secrets..."
echo ""
echo "⚠️  Use PRODUCTION keys (not test keys)!"
echo ""

echo "Setting RUNPOD_API_KEY..."
wrangler secret put RUNPOD_API_KEY --env production

echo "Setting RUNPOD_ENDPOINT_ID..."
wrangler secret put RUNPOD_ENDPOINT_ID --env production

echo "Setting STRIPE_SECRET_KEY (use sk_live_... NOT sk_test_!)..."
wrangler secret put STRIPE_SECRET_KEY --env production

echo "Setting STRIPE_PUBLISHABLE_KEY (use pk_live_...)..."
wrangler secret put STRIPE_PUBLISHABLE_KEY --env production

echo ""
echo "Optional OAuth secrets:"
read -p "Set up OAuth? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    wrangler secret put GOOGLE_CLIENT_ID --env production
    wrangler secret put GOOGLE_CLIENT_SECRET --env production
    wrangler secret put GITHUB_CLIENT_ID --env production
    wrangler secret put GITHUB_CLIENT_SECRET --env production
fi

echo ""
echo "✅ Secrets configured!"
echo ""

# Deploy to production
echo "🚀 Deploying to PRODUCTION..."
if wrangler deploy --env production; then
    echo ""
    echo "✅ PRODUCTION deployment successful!"
    echo ""

    WORKER_URL=$(wrangler deployments list --env production 2>/dev/null | grep -o 'https://[^[:space:]]*' | head -1 || echo "Check dashboard")

    echo "📍 Your PRODUCTION worker is at:"
    echo "   $WORKER_URL"
    echo ""

    echo "⚠️  IMPORTANT: Set WORKER_URL secret:"
    echo "   wrangler secret put WORKER_URL --env production"
    echo "   Then paste: $WORKER_URL"
    echo ""

    echo "📝 Next steps:"
    echo ""
    echo "1. Update your production frontend with this API URL"
    echo ""
    echo "2. Set up Stripe webhook for PRODUCTION:"
    echo "   - Go to https://dashboard.stripe.com/webhooks"
    echo "   - Add endpoint: $WORKER_URL/api/stripe/webhook"
    echo "   - Copy webhook secret and run:"
    echo "     wrangler secret put STRIPE_WEBHOOK_SECRET --env production"
    echo ""
    echo "3. Deploy frontend to Cloudflare Pages or your hosting"
    echo ""
    echo "4. Set up custom domain (optional)"
    echo ""
else
    echo "❌ Deployment failed. Check errors above."
    exit 1
fi

echo ""
echo "✨ PRODUCTION environment setup complete!"
echo ""
echo "🔒 Security checklist:"
echo "  ✓ Using Stripe LIVE keys (sk_live_...)"
echo "  ✓ Using production OAuth credentials"
echo "  ✓ Webhook secret configured"
echo "  ✓ Separate database and storage from DEV"
echo ""
echo "Monitor usage at: https://dash.cloudflare.com"
echo ""
