#!/bin/bash

# Generate public URLs for test images from R2 dev bucket

set -e

echo "=========================================="
echo "Configure R2 Public Access for Test Images"
echo "=========================================="
echo ""

# Check if images were uploaded
if ! ls test-images/*.{jpg,jpeg,png,JPG,JPEG,PNG} &>/dev/null; then
    echo "❌ No images found in test-images/"
    echo ""
    echo "Run ./upload-test-images.sh first"
    exit 1
fi

echo "To use your R2 images in Docker testing, you need to enable public access."
echo ""
echo "Steps:"
echo "  1. Go to: https://dash.cloudflare.com/?to=/:account/r2"
echo "  2. Click on 'splat-app-storage-dev'"
echo "  3. Go to Settings > Public Access"
echo "  4. Click 'Allow Access'"
echo "  5. Copy the R2.dev subdomain (e.g., pub-abc123.r2.dev)"
echo ""
read -p "Enter your R2.dev subdomain (without https://): " R2_SUBDOMAIN

if [ -z "$R2_SUBDOMAIN" ]; then
    echo "❌ No subdomain provided"
    exit 1
fi

echo ""
echo "Generating test_input.json with public URLs..."
echo ""

R2_PATH="test-images"
IMAGE_URLS=()

for img in test-images/*.{jpg,jpeg,png,JPG,JPEG,PNG} 2>/dev/null; do
    [ -f "$img" ] || continue

    FILENAME=$(basename "$img")
    R2_KEY="${R2_PATH}/${FILENAME}"

    URL="https://${R2_SUBDOMAIN}/${R2_KEY}"
    IMAGE_URLS+=("\"$URL\"")

    echo "  $FILENAME -> $URL"
done

echo ""

# Generate test_input.json
cat > test_input.json <<EOF
{
  "image_urls": [
$(IFS=$'\n'; for url in "${IMAGE_URLS[@]}"; do echo "    $url,"; done | sed '$ s/,$//')
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

echo "✓ test_input.json created with ${#IMAGE_URLS[@]} images!"
echo ""
echo "You can now run:"
echo "  ./test-local.sh"
echo ""
echo "NOTE: Remember to disable public access after testing!"
echo ""
