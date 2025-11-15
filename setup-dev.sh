#!/bin/bash

# Splat App - DEV Environment Setup Script
# This script sets up your development/testing environment

set -e  # Exit on error

echo "🚀 Splat App - DEV Environment Setup"
echo "===================================="
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found!"
    echo "Install it with: npm install -g wrangler"
    exit 1
fi

echo "✅ Wrangler CLI found"
echo ""

# Login check
echo "🔐 Checking Cloudflare login..."
if ! wrangler whoami &> /dev/null; then
    echo "Please login to Cloudflare:"
    wrangler login
fi

echo "✅ Logged in to Cloudflare"
echo ""

# Create R2 bucket
echo "📦 Creating DEV R2 bucket..."
if wrangler r2 bucket create splat-app-storage-dev 2>/dev/null; then
    echo "✅ R2 bucket created: splat-app-storage-dev"
else
    echo "ℹ️  R2 bucket already exists (this is fine)"
fi
echo ""

# Create D1 database
echo "💾 Creating DEV D1 database..."
DB_OUTPUT=$(wrangler d1 create splat-app-db-dev 2>&1 || true)

if echo "$DB_OUTPUT" | grep -q "database_id"; then
    # Extract database ID
    DB_ID=$(echo "$DB_OUTPUT" | grep "database_id" | awk -F'"' '{print $2}')
    echo "✅ D1 database created: splat-app-db-dev"
    echo "📝 Database ID: $DB_ID"
    echo ""
    echo "⚠️  IMPORTANT: Update worker/wrangler.toml line 16 with this database_id:"
    echo "   database_id = \"$DB_ID\""
    echo ""
    read -p "Press Enter after you've updated wrangler.toml..."
else
    echo "ℹ️  D1 database might already exist (this is fine)"
    echo "   If you need the database_id, run: wrangler d1 info splat-app-db-dev"
fi
echo ""

# Create Queue
echo "📬 Creating DEV Queue..."
if wrangler queues create splat-processing-queue-dev 2>/dev/null; then
    echo "✅ Queue created: splat-processing-queue-dev"
else
    echo "ℹ️  Queue already exists (this is fine)"
fi
echo ""

# Run database migrations
echo "🗄️  Running database migrations..."
cd worker

if wrangler d1 execute splat-app-db-dev --file=schema.sql --yes; then
    echo "✅ Schema created"
else
    echo "⚠️  Schema might already exist (this is fine)"
fi

if wrangler d1 execute splat-app-db-dev --file=seed.sql --yes; then
    echo "✅ Seed data inserted"
else
    echo "⚠️  Seed data might already exist (this is fine)"
fi
echo ""

# Set secrets
echo "🔑 Setting up secrets..."
echo ""
echo "You'll need the following:"
echo "1. RunPod API Key (get from https://runpod.io)"
echo "2. RunPod Endpoint ID"
echo "3. Stripe Test Secret Key (get from https://dashboard.stripe.com/test/apikeys)"
echo ""
read -p "Do you have these ready? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "Setting RUNPOD_API_KEY..."
    wrangler secret put RUNPOD_API_KEY

    echo "Setting RUNPOD_ENDPOINT_ID..."
    wrangler secret put RUNPOD_ENDPOINT_ID

    echo "Setting STRIPE_SECRET_KEY (use sk_test_... key)..."
    wrangler secret put STRIPE_SECRET_KEY

    echo "✅ Core secrets set!"
    echo ""
    echo "Optional: You can set OAuth secrets later with:"
    echo "  wrangler secret put GOOGLE_CLIENT_ID"
    echo "  wrangler secret put GOOGLE_CLIENT_SECRET"
    echo "  wrangler secret put GITHUB_CLIENT_ID"
    echo "  wrangler secret put GITHUB_CLIENT_SECRET"
else
    echo ""
    echo "⚠️  Skipping secrets setup. Set them manually later with:"
    echo "   wrangler secret put <SECRET_NAME>"
fi
echo ""

# Deploy
echo "🚀 Deploying to Cloudflare Workers..."
if wrangler deploy; then
    echo ""
    echo "✅ Deployment successful!"
    echo ""

    # Get the worker URL
    WORKER_URL=$(wrangler deployments list 2>/dev/null | grep -o 'https://[^[:space:]]*' | head -1 || echo "Check wrangler dashboard")

    echo "📍 Your worker is deployed at:"
    echo "   $WORKER_URL"
    echo ""
    echo "⚠️  IMPORTANT: Set the WORKER_URL secret:"
    echo "   wrangler secret put WORKER_URL"
    echo "   Then paste: $WORKER_URL"
    echo ""

    echo "📝 Next steps:"
    echo "1. Update src/main.js with your worker URL:"
    echo "   const API_ENDPOINT = '$WORKER_URL/api';"
    echo ""
    echo "2. Open index.html in your browser to test!"
    echo ""
    echo "3. When ready for production, run: ./setup-prod.sh"
else
    echo "❌ Deployment failed. Check the errors above."
    exit 1
fi

echo ""
echo "✨ DEV environment setup complete!"
echo ""
echo "Quick commands:"
echo "  wrangler dev               - Test locally"
echo "  wrangler deploy            - Deploy to DEV"
echo "  wrangler tail              - View live logs"
echo "  wrangler d1 execute ...    - Query database"
echo ""
