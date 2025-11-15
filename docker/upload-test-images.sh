#!/bin/bash

# Upload test images to R2 dev bucket and generate URLs

set -e

BUCKET_NAME="splat-app-storage-dev"
R2_PATH="test-images"

echo "=========================================="
echo "Upload Test Images to R2 Dev Bucket"
echo "=========================================="
echo ""

# Check if images directory exists
if [ ! -d "test-images" ]; then
    echo "Creating test-images/ directory..."
    mkdir -p test-images
    echo ""
    echo "⚠️  Please add your test images (JPG/PNG) to the test-images/ directory"
    echo "    You need at least 5-10 images taken from different angles around an object/scene"
    echo ""
    echo "Then run this script again."
    exit 1
fi

# Count images
IMAGE_COUNT=$(ls test-images/*.{jpg,jpeg,png,JPG,JPEG,PNG} 2>/dev/null | wc -l)

if [ "$IMAGE_COUNT" -eq 0 ]; then
    echo "❌ No images found in test-images/"
    echo ""
    echo "Please add JPG or PNG images to test-images/ directory"
    exit 1
fi

echo "Found $IMAGE_COUNT images"
echo ""

# Check if bucket exists
echo "Checking if R2 bucket exists..."
if ! wrangler r2 bucket list 2>/dev/null | grep -q "$BUCKET_NAME"; then
    echo "❌ Bucket '$BUCKET_NAME' not found"
    echo ""
    echo "Create it first with:"
    echo "  cd ../worker"
    echo "  wrangler r2 bucket create $BUCKET_NAME"
    exit 1
fi

echo "✓ Bucket exists"
echo ""

# Upload images
echo "Uploading images to R2..."
echo ""

IMAGE_URLS=()

for img in test-images/*.{jpg,jpeg,png,JPG,JPEG,PNG} 2>/dev/null; do
    [ -f "$img" ] || continue

    FILENAME=$(basename "$img")
    R2_KEY="${R2_PATH}/${FILENAME}"

    echo "Uploading $FILENAME..."

    # Upload to R2
    cd ../worker
    wrangler r2 object put "${BUCKET_NAME}/${R2_KEY}" --file="../docker/$img"
    cd ../docker

    # Generate public URL (requires public bucket or presigned URL)
    # For now, we'll use the R2.dev subdomain format
    # You'll need to enable public access or use presigned URLs
    URL="https://pub-YOUR_ACCOUNT_ID.r2.dev/${R2_KEY}"
    IMAGE_URLS+=("\"$URL\"")
done

echo ""
echo "✓ Upload complete!"
echo ""

# Generate test_input.json
echo "Generating test_input.json..."

cat > test_input.json <<EOF
{
  "image_urls": [
$(IFS=,; echo "    ${IMAGE_URLS[*]}")
  ],
  "upload_url": "https://httpbin.org/put",
  "project_id": "test-docker-$(date +%s)",
  "params": {
    "iterations": 1000,
    "position_lr_init": 0.00016,
    "position_lr_final": 0.0000016,
    "feature_lr": 0.0025,
    "opacity_lr": 0.05,
    "scaling_lr": 0.005,
    "rotation_lr": 0.001
  }
}
EOF

echo "✓ Created test_input.json"
echo ""
echo "=========================================="
echo "⚠️  IMPORTANT: Configure Public Access"
echo "=========================================="
echo ""
echo "Your images are uploaded but need public access. Choose one option:"
echo ""
echo "Option 1: Enable Public Access (for testing only!)"
echo "  1. Go to Cloudflare Dashboard > R2"
echo "  2. Click on '$BUCKET_NAME'"
echo "  3. Go to Settings > Public Access"
echo "  4. Click 'Allow Access' and copy your R2.dev subdomain"
echo "  5. Edit test_input.json and replace 'YOUR_ACCOUNT_ID' with the subdomain"
echo ""
echo "Option 2: Use Presigned URLs (more secure)"
echo "  Run: ./generate-presigned-urls.sh"
echo ""
echo "After configuring access, you can run:"
echo "  ./test-local.sh"
echo ""
