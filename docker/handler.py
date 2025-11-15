#!/usr/bin/env python3
"""
RunPod Serverless Handler for Gaussian Splatting
Processes images into 3D Gaussian Splat models
"""

import os
import sys
import json
import subprocess
import shutil
import requests
from pathlib import Path
import traceback

# RunPod serverless mode
try:
    import runpod
    RUNPOD_MODE = True
except ImportError:
    RUNPOD_MODE = False
    print("Running in local test mode (runpod package not found)")


def download_images(image_urls, output_dir):
    """Download images from URLs to output directory"""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    downloaded_files = []
    for i, url in enumerate(image_urls):
        try:
            print(f"Downloading image {i+1}/{len(image_urls)}: {url}")
            response = requests.get(url, timeout=60)
            response.raise_for_status()

            # Determine file extension
            ext = '.jpg'
            content_type = response.headers.get('content-type', '')
            if 'png' in content_type:
                ext = '.png'
            elif 'jpeg' in content_type or 'jpg' in content_type:
                ext = '.jpg'

            # Save file
            filename = output_dir / f"image_{i:04d}{ext}"
            filename.write_bytes(response.content)
            downloaded_files.append(str(filename))
            print(f"  Saved: {filename}")

        except Exception as e:
            print(f"Error downloading {url}: {e}")
            raise

    return downloaded_files


def run_colmap(image_dir, output_dir):
    """Run COLMAP structure from motion"""
    image_dir = Path(image_dir)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    database_path = output_dir / "database.db"
    sparse_dir = output_dir / "sparse"
    sparse_dir.mkdir(exist_ok=True)

    print("\n=== Running COLMAP ===")

    # Feature extraction
    print("1. Extracting features...")
    cmd = [
        "colmap", "feature_extractor",
        "--database_path", str(database_path),
        "--image_path", str(image_dir),
        "--ImageReader.single_camera", "1",
        "--ImageReader.camera_model", "SIMPLE_PINHOLE",
        "--SiftExtraction.use_gpu", "1"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"STDERR: {result.stderr}")
        raise Exception("Feature extraction failed")
    print("  Features extracted")

    # Feature matching
    print("2. Matching features...")
    cmd = [
        "colmap", "exhaustive_matcher",
        "--database_path", str(database_path),
        "--SiftMatching.use_gpu", "1"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"STDERR: {result.stderr}")
        raise Exception("Feature matching failed")
    print("  Features matched")

    # Sparse reconstruction
    print("3. Running sparse reconstruction...")
    cmd = [
        "colmap", "mapper",
        "--database_path", str(database_path),
        "--image_path", str(image_dir),
        "--output_path", str(sparse_dir)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"STDERR: {result.stderr}")
        raise Exception("Sparse reconstruction failed")
    print("  Sparse reconstruction complete")

    # Find the reconstruction directory (usually '0')
    recon_dirs = list(sparse_dir.glob('*'))
    if not recon_dirs:
        raise Exception("No reconstruction found")

    recon_dir = recon_dirs[0]
    print(f"  Reconstruction saved to: {recon_dir}")

    return recon_dir


def run_gaussian_splatting(colmap_dir, image_dir, output_dir, params):
    """Run Gaussian Splatting training"""
    print("\n=== Running Gaussian Splatting Training ===")

    # Prepare arguments
    iterations = params.get('iterations', 7000)

    cmd = [
        "python3", "/workspace/gaussian-splatting/train.py",
        "-s", str(colmap_dir.parent.parent),  # Project directory
        "-m", str(output_dir),                 # Output model directory
        "--iterations", str(iterations),
        "--save_iterations", str(iterations),
        "--test_iterations", str(iterations),
    ]

    # Add optional parameters
    optional_params = [
        ('position_lr_init', '--position_lr_init'),
        ('position_lr_final', '--position_lr_final'),
        ('feature_lr', '--feature_lr'),
        ('opacity_lr', '--opacity_lr'),
        ('scaling_lr', '--scaling_lr'),
        ('rotation_lr', '--rotation_lr'),
        ('sh_degree', '--sh_degree'),
        ('densify_grad_threshold', '--densify_grad_threshold'),
    ]

    for param_name, flag in optional_params:
        if param_name in params:
            cmd.extend([flag, str(params[param_name])])

    print(f"Training command: {' '.join(cmd)}")

    # Run training
    result = subprocess.run(cmd, capture_output=True, text=True)
    print(result.stdout)

    if result.returncode != 0:
        print(f"STDERR: {result.stderr}")
        raise Exception("Gaussian Splatting training failed")

    # Find the output PLY file
    ply_file = output_dir / f"point_cloud/iteration_{iterations}/point_cloud.ply"

    if not ply_file.exists():
        raise Exception(f"Output PLY file not found: {ply_file}")

    print(f"✓ Training complete! Output: {ply_file}")
    return ply_file


def upload_result(file_path, upload_url):
    """Upload result file to presigned URL"""
    print(f"\n=== Uploading result to {upload_url} ===")

    with open(file_path, 'rb') as f:
        response = requests.put(upload_url, data=f, timeout=300)
        response.raise_for_status()

    print("✓ Upload complete")
    return True


def process_job(job_input):
    """
    Main processing function

    Expected input:
    {
        "image_urls": ["url1", "url2", ...],
        "upload_url": "presigned_url_for_result",
        "webhook_url": "url_to_notify_completion",
        "project_id": "unique_project_id",
        "params": {
            "iterations": 7000,
            "position_lr_init": 0.00016,
            ...
        }
    }
    """
    try:
        # Validate input
        if not job_input.get('image_urls'):
            raise ValueError("No image_urls provided")

        if not job_input.get('upload_url'):
            raise ValueError("No upload_url provided")

        image_urls = job_input['image_urls']
        upload_url = job_input['upload_url']
        webhook_url = job_input.get('webhook_url')
        project_id = job_input.get('project_id', 'unknown')
        params = job_input.get('params', {})

        print(f"\n{'='*60}")
        print(f"Processing job for project: {project_id}")
        print(f"Images: {len(image_urls)}")
        print(f"Parameters: {params}")
        print(f"{'='*60}\n")

        # Create working directory
        work_dir = Path(f"/tmp/splat_{project_id}")
        work_dir.mkdir(parents=True, exist_ok=True)

        image_dir = work_dir / "images"
        colmap_dir = work_dir / "colmap"
        output_dir = work_dir / "output"

        # Step 1: Download images
        print("Step 1/3: Downloading images...")
        download_images(image_urls, image_dir)

        # Step 2: Run COLMAP
        print("\nStep 2/3: Running COLMAP...")
        sparse_dir = run_colmap(image_dir, colmap_dir)

        # Step 3: Run Gaussian Splatting
        print("\nStep 3/3: Training Gaussian Splatting...")
        ply_file = run_gaussian_splatting(sparse_dir.parent, image_dir, output_dir, params)

        # Upload result
        upload_result(ply_file, upload_url)

        # Get file size
        file_size = ply_file.stat().st_size

        # Cleanup
        print("\nCleaning up...")
        shutil.rmtree(work_dir)

        # Notify webhook if provided
        if webhook_url:
            try:
                webhook_data = {
                    'status': 'completed',
                    'project_id': project_id,
                    'model_url': upload_url.split('?')[0],  # Remove query params
                    'file_size': file_size
                }
                requests.post(webhook_url, json=webhook_data, timeout=10)
                print(f"✓ Webhook notified: {webhook_url}")
            except Exception as e:
                print(f"Warning: Webhook notification failed: {e}")

        print("\n" + "="*60)
        print("✓ JOB COMPLETE!")
        print("="*60 + "\n")

        return {
            'status': 'success',
            'project_id': project_id,
            'file_size': file_size,
            'message': 'Gaussian Splatting completed successfully'
        }

    except Exception as e:
        error_msg = f"Error processing job: {str(e)}\n{traceback.format_exc()}"
        print(error_msg)

        # Notify webhook of failure
        if job_input.get('webhook_url'):
            try:
                webhook_data = {
                    'status': 'failed',
                    'project_id': job_input.get('project_id', 'unknown'),
                    'error': str(e)
                }
                requests.post(job_input['webhook_url'], json=webhook_data, timeout=10)
            except:
                pass

        return {
            'status': 'error',
            'error': str(e),
            'traceback': traceback.format_exc()
        }


# RunPod handler
def handler(event):
    """RunPod serverless handler"""
    job_input = event.get('input', {})
    return process_job(job_input)


# Local testing mode
if __name__ == "__main__":
    if RUNPOD_MODE:
        # Start RunPod serverless worker
        print("Starting RunPod serverless worker...")
        runpod.serverless.start({"handler": handler})
    else:
        # Local test mode
        print("="*60)
        print("LOCAL TEST MODE")
        print("="*60)

        # Load test input
        if len(sys.argv) > 1:
            test_input_file = sys.argv[1]
            with open(test_input_file, 'r') as f:
                test_input = json.load(f)
        else:
            # Default test input
            test_input = {
                "image_urls": [
                    "https://example.com/image1.jpg",
                    "https://example.com/image2.jpg",
                ],
                "upload_url": "https://example.com/upload",
                "project_id": "test-project",
                "params": {
                    "iterations": 1000  # Short for testing
                }
            }
            print("No input file provided. Using default test input.")
            print("Usage: python3 handler.py test_input.json")

        print(f"\nTest input: {json.dumps(test_input, indent=2)}\n")

        # Run processing
        result = process_job(test_input)

        print("\n" + "="*60)
        print("RESULT:")
        print(json.dumps(result, indent=2))
        print("="*60)
