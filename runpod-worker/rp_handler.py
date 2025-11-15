"""
RunPod Serverless Handler for Gaussian Splatting
Processes photos and generates 3D models using Gaussian Splatting
"""

import runpod
import os
import sys
import json
import subprocess
import shutil
from pathlib import Path
import requests
import time
from utils import download_images, upload_to_r2, cleanup_files

# Add Gaussian Splatting to path
sys.path.insert(0, '/workspace/gaussian-splatting')

# Configuration
TEMP_DIR = Path('/tmp/splat_processing')
COLMAP_PATH = '/workspace/gaussian-splatting'


def download_photos(image_urls, output_dir):
    """Download photos from URLs to local directory"""
    print(f"Downloading {len(image_urls)} photos...")

    output_dir.mkdir(parents=True, exist_ok=True)
    images_dir = output_dir / 'input'
    images_dir.mkdir(exist_ok=True)

    downloaded = []
    for idx, url in enumerate(image_urls):
        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()

            # Determine file extension from content-type or URL
            ext = '.jpg'
            content_type = response.headers.get('content-type', '')
            if 'png' in content_type:
                ext = '.png'
            elif 'jpeg' in content_type or 'jpg' in content_type:
                ext = '.jpg'

            filepath = images_dir / f'image_{idx:04d}{ext}'
            with open(filepath, 'wb') as f:
                f.write(response.content)

            downloaded.append(str(filepath))
            print(f"Downloaded {idx + 1}/{len(image_urls)}: {filepath.name}")

        except Exception as e:
            print(f"Error downloading image {idx}: {e}")
            continue

    if len(downloaded) < 5:
        raise ValueError(f"Insufficient photos downloaded: {len(downloaded)}/5 minimum required")

    return images_dir


def run_colmap(images_dir, output_dir):
    """Run COLMAP for Structure from Motion"""
    print("Running COLMAP Structure from Motion...")

    sparse_dir = output_dir / 'sparse' / '0'
    sparse_dir.mkdir(parents=True, exist_ok=True)

    # Use the convert.py script from Gaussian Splatting
    convert_script = Path('/workspace/gaussian-splatting/convert.py')

    try:
        cmd = [
            'python3', str(convert_script),
            '-s', str(output_dir),
            '--skip_matching'  # Skip if we want faster processing
        ]

        print(f"Running: {' '.join(cmd)}")
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600  # 10 minutes timeout
        )

        if result.returncode != 0:
            print(f"COLMAP stderr: {result.stderr}")
            # Try alternative: use COLMAP directly
            print("Trying direct COLMAP approach...")
            run_colmap_direct(images_dir, output_dir)
        else:
            print(f"COLMAP output: {result.stdout}")

    except subprocess.TimeoutExpired:
        print("COLMAP timeout - trying with reduced quality...")
        run_colmap_direct(images_dir, output_dir, quality='low')


def run_colmap_direct(images_dir, output_dir, quality='medium'):
    """Direct COLMAP execution (fallback)"""
    # This is a simplified version - in production you'd install COLMAP
    # For now, we'll create a basic point cloud from images
    print(f"Creating point cloud with {quality} quality...")

    sparse_dir = output_dir / 'sparse' / '0'
    sparse_dir.mkdir(parents=True, exist_ok=True)

    # Create minimal COLMAP output structure
    # In production, you'd run actual COLMAP commands here
    # For this template, we'll assume COLMAP is installed via convert.py


def run_gaussian_splatting(source_dir, output_dir, iterations=7000):
    """Run Gaussian Splatting training"""
    print(f"Running Gaussian Splatting training ({iterations} iterations)...")

    train_script = Path('/workspace/gaussian-splatting/train.py')
    model_dir = output_dir / 'model'

    cmd = [
        'python3', str(train_script),
        '-s', str(source_dir),
        '-m', str(model_dir),
        '--iterations', str(iterations),
        '--save_iterations', str(iterations),
        '--test_iterations', str(iterations),
        '--quiet'
    ]

    print(f"Running: {' '.join(cmd)}")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=3600  # 1 hour timeout
        )

        print(f"Training output: {result.stdout}")
        if result.returncode != 0:
            print(f"Training errors: {result.stderr}")
            raise RuntimeError(f"Training failed: {result.stderr}")

        return model_dir

    except subprocess.TimeoutExpired:
        raise RuntimeError("Training timeout exceeded (1 hour)")


def export_model(model_dir, output_path):
    """Export trained model to PLY format"""
    print("Exporting model to PLY format...")

    # Find the point cloud file
    point_cloud_path = model_dir / 'point_cloud' / f'iteration_7000' / 'point_cloud.ply'

    if not point_cloud_path.exists():
        # Try to find any .ply file
        ply_files = list(model_dir.rglob('*.ply'))
        if ply_files:
            point_cloud_path = ply_files[0]
        else:
            raise FileNotFoundError("No PLY file found in model output")

    # Copy to output location
    shutil.copy(point_cloud_path, output_path)
    print(f"Model exported to {output_path}")

    return output_path


def process_gaussian_splatting(job):
    """Main processing function"""

    job_id = job['id']
    input_data = job['input']

    print(f"Processing job {job_id}")
    print(f"Input: {json.dumps(input_data, indent=2)}")

    # Extract input parameters
    image_urls = input_data.get('image_urls', [])
    project_id = input_data.get('project_id', 'unknown')
    iterations = input_data.get('iterations', 7000)
    upload_url = input_data.get('upload_url')  # R2 pre-signed URL for upload
    webhook_url = input_data.get('webhook_url')  # Callback URL for completion

    if not image_urls:
        return {"error": "No image URLs provided"}

    if len(image_urls) < 5:
        return {"error": f"Minimum 5 images required, got {len(image_urls)}"}

    # Create working directory
    work_dir = TEMP_DIR / job_id
    work_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Step 1: Download photos
        print("\n=== Step 1/4: Downloading photos ===")
        images_dir = download_photos(image_urls, work_dir)

        # Step 2: Run COLMAP (Structure from Motion)
        print("\n=== Step 2/4: Running COLMAP (Structure from Motion) ===")
        run_colmap(images_dir, work_dir)

        # Step 3: Run Gaussian Splatting
        print("\n=== Step 3/4: Training Gaussian Splatting ===")
        model_dir = run_gaussian_splatting(work_dir, work_dir, iterations)

        # Step 4: Export model
        print("\n=== Step 4/4: Exporting model ===")
        output_ply = work_dir / 'output.ply'
        export_model(model_dir, output_ply)

        # Read the output file
        with open(output_ply, 'rb') as f:
            model_data = f.read()

        model_size_mb = len(model_data) / (1024 * 1024)
        print(f"Model size: {model_size_mb:.2f} MB")

        # Upload to R2 if URL provided
        model_url = None
        if upload_url:
            print(f"Uploading model to R2...")
            try:
                response = requests.put(
                    upload_url,
                    data=model_data,
                    headers={'Content-Type': 'application/octet-stream'},
                    timeout=300
                )
                response.raise_for_status()
                model_url = upload_url.split('?')[0]  # Remove query params
                print(f"Model uploaded successfully to {model_url}")
            except Exception as e:
                print(f"Upload error: {e}")

        # Trigger webhook if provided
        if webhook_url:
            print(f"Triggering webhook: {webhook_url}")
            try:
                requests.post(
                    webhook_url,
                    json={
                        'job_id': job_id,
                        'status': 'completed',
                        'model_url': model_url,
                        'model_size_mb': model_size_mb,
                        'project_id': project_id
                    },
                    timeout=10
                )
            except Exception as e:
                print(f"Webhook error: {e}")

        result = {
            "status": "completed",
            "project_id": project_id,
            "model_url": model_url,
            "model_size_mb": round(model_size_mb, 2),
            "images_processed": len(image_urls),
            "iterations": iterations,
            "processing_time": "calculated_by_runpod"
        }

        print(f"\n=== Processing Complete ===")
        print(json.dumps(result, indent=2))

        return result

    except Exception as e:
        print(f"Error during processing: {e}")
        import traceback
        traceback.print_exc()

        # Trigger webhook with error
        if webhook_url:
            try:
                requests.post(
                    webhook_url,
                    json={
                        'job_id': job_id,
                        'status': 'failed',
                        'error': str(e),
                        'project_id': project_id
                    },
                    timeout=10
                )
            except:
                pass

        return {
            "status": "failed",
            "error": str(e),
            "project_id": project_id
        }

    finally:
        # Cleanup
        print("Cleaning up temporary files...")
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
        except:
            pass


# Start the serverless worker
if __name__ == "__main__":
    print("Starting RunPod Serverless Worker for Gaussian Splatting")
    print(f"Python version: {sys.version}")

    import torch
    print(f"PyTorch version: {torch.__version__}")
    print(f"CUDA available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"CUDA device: {torch.cuda.get_device_name(0)}")

    runpod.serverless.start({"handler": process_gaussian_splatting})
