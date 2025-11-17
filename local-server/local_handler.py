#!/usr/bin/env python3
"""
Local Handler for Gaussian Splatting
Processes local images into 3D Gaussian Splat models
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path
import traceback
import argparse


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
        print(f"STDOUT: {result.stdout}")
        print(f"STDERR: {result.stderr}")
        raise Exception("Feature extraction failed")
    print("  ✓ Features extracted")

    # Feature matching
    print("2. Matching features...")
    cmd = [
        "colmap", "exhaustive_matcher",
        "--database_path", str(database_path),
        "--SiftMatching.use_gpu", "1"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"STDOUT: {result.stdout}")
        print(f"STDERR: {result.stderr}")
        raise Exception("Feature matching failed")
    print("  ✓ Features matched")

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
        print(f"STDOUT: {result.stdout}")
        print(f"STDERR: {result.stderr}")
        raise Exception("Sparse reconstruction failed")
    print("  ✓ Sparse reconstruction complete")

    # Find the reconstruction directory (usually '0')
    recon_dirs = list(sparse_dir.glob('*'))
    if not recon_dirs:
        raise Exception("No reconstruction found")

    recon_dir = recon_dirs[0]
    print(f"  Reconstruction saved to: {recon_dir}")

    return recon_dir


def run_gaussian_splatting(colmap_dir, image_dir, output_dir, iterations=7000):
    """Run Gaussian Splatting training"""
    print("\n=== Running Gaussian Splatting Training ===")
    print(f"Iterations: {iterations}")

    # The training script expects the COLMAP output in a specific structure
    # We need to create a source directory that contains both images and sparse folder
    source_dir = colmap_dir.parent.parent
    print(f"Source directory: {source_dir}")

    cmd = [
        "python3", "/workspace/gaussian-splatting/train.py",
        "-s", str(source_dir),                 # Project directory with images/ and sparse/
        "-m", str(output_dir),                  # Output model directory
        "--iterations", str(iterations),
        "--save_iterations", str(iterations),
        "--test_iterations", str(iterations),
    ]

    print(f"Training command: {' '.join(cmd)}")

    # Run training
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    # Print output in real-time
    for line in process.stdout:
        print(line, end='')

    process.wait()

    if process.returncode != 0:
        raise Exception("Gaussian Splatting training failed")

    # Find the output PLY file
    ply_file = output_dir / f"point_cloud/iteration_{iterations}/point_cloud.ply"

    if not ply_file.exists():
        raise Exception(f"Output PLY file not found: {ply_file}")

    print(f"\n✓ Training complete! Output: {ply_file}")
    return ply_file


def process_local(input_dir, output_dir, iterations=7000):
    """
    Process local images into Gaussian Splat model

    Args:
        input_dir: Directory containing input images
        output_dir: Directory where output will be saved
        iterations: Number of training iterations
    """
    try:
        input_dir = Path(input_dir)
        output_dir = Path(output_dir)

        print(f"\n{'='*60}")
        print(f"Processing images from: {input_dir}")
        print(f"Output will be saved to: {output_dir}")
        print(f"Iterations: {iterations}")
        print(f"{'='*60}\n")

        # Validate input
        if not input_dir.exists():
            raise ValueError(f"Input directory does not exist: {input_dir}")

        images = list(input_dir.glob('*.jpg')) + list(input_dir.glob('*.png')) + \
                 list(input_dir.glob('*.jpeg')) + list(input_dir.glob('*.JPG'))

        if len(images) < 5:
            raise ValueError(f"Need at least 5 images, found {len(images)}")

        print(f"Found {len(images)} images")

        # Create working directory structure
        work_dir = output_dir.parent / f"work_{output_dir.name}"
        work_dir.mkdir(parents=True, exist_ok=True)

        # Create images directory (COLMAP expects this)
        images_dir = work_dir / "images"
        images_dir.mkdir(exist_ok=True)

        # Copy images to working directory
        print("\nCopying images...")
        for img in images:
            shutil.copy2(img, images_dir / img.name)

        colmap_dir = work_dir / "colmap"
        model_output_dir = output_dir / "model"
        model_output_dir.mkdir(parents=True, exist_ok=True)

        # Step 1: Run COLMAP
        print("\nStep 1/2: Running COLMAP...")
        sparse_dir = run_colmap(images_dir, colmap_dir)

        # Move sparse dir to expected location for Gaussian Splatting
        target_sparse = work_dir / "sparse"
        if target_sparse.exists():
            shutil.rmtree(target_sparse)
        shutil.move(str(sparse_dir.parent), str(target_sparse))

        # Step 2: Run Gaussian Splatting
        print("\nStep 2/2: Training Gaussian Splatting...")
        ply_file = run_gaussian_splatting(
            target_sparse / sparse_dir.name,
            images_dir,
            model_output_dir,
            iterations
        )

        # Copy final output to main output directory
        final_output = output_dir / "point_cloud.ply"
        shutil.copy2(ply_file, final_output)

        # Get file size
        file_size = final_output.stat().st_size

        print("\n" + "="*60)
        print("✓ PROCESSING COMPLETE!")
        print(f"Output file: {final_output}")
        print(f"File size: {file_size / 1024 / 1024:.2f} MB")
        print("="*60 + "\n")

        return {
            'status': 'success',
            'output_file': str(final_output),
            'file_size': file_size,
            'message': 'Gaussian Splatting completed successfully'
        }

    except Exception as e:
        error_msg = f"Error processing: {str(e)}\n{traceback.format_exc()}"
        print(error_msg)

        return {
            'status': 'error',
            'error': str(e),
            'traceback': traceback.format_exc()
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Process images into Gaussian Splat model')
    parser.add_argument('--input_dir', required=True, help='Input directory with images')
    parser.add_argument('--output_dir', required=True, help='Output directory for model')
    parser.add_argument('--iterations', type=int, default=7000, help='Number of training iterations')

    args = parser.parse_args()

    result = process_local(args.input_dir, args.output_dir, args.iterations)

    if result['status'] == 'error':
        sys.exit(1)
