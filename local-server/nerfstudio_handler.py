#!/usr/bin/env python3
"""
Nerfstudio Handler for Gaussian Splatting (Splatfacto)
Processes local images into 3D Gaussian Splat models using nerfstudio
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path
import traceback
import argparse
import json
import glob


def run_nerfstudio_process_data(input_dir, output_dir):
    """
    Run nerfstudio data processing
    Converts images into nerfstudio format with camera poses
    """
    input_dir = Path(input_dir)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print("\n=== Running Nerfstudio Data Processing ===")
    print(f"Input: {input_dir}")
    print(f"Output: {output_dir}")

    # Use nerfstudio's process-data with COLMAP
    cmd = [
        "ns-process-data", "images",
        "--data", str(input_dir),
        "--output-dir", str(output_dir),
        "--matching-method", "exhaustive",
        "--sfm-tool", "colmap",
        "--gpu",
    ]

    print(f"Processing command: {' '.join(cmd)}")

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        universal_newlines=True
    )

    # Print output in real-time
    for line in process.stdout:
        print(line, end='')

    process.wait()

    if process.returncode != 0:
        raise Exception("Nerfstudio data processing failed")

    print("✓ Data processing complete")
    return output_dir


def run_splatfacto_training(data_dir, output_dir, iterations=30000, max_num_iterations=None):
    """
    Run Splatfacto (Gaussian Splatting) training using nerfstudio

    Args:
        data_dir: Directory with processed nerfstudio data
        output_dir: Directory where model will be saved
        iterations: Number of training iterations (nerfstudio default is 30000)
        max_num_iterations: Override for max iterations
    """
    print("\n=== Running Splatfacto Training ===")
    print(f"Data: {data_dir}")
    print(f"Output: {output_dir}")
    print(f"Iterations: {iterations}")

    data_dir = Path(data_dir)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Build nerfstudio training command
    cmd = [
        "ns-train", "splatfacto",
        "--data", str(data_dir),
        "--output-dir", str(output_dir),
        "--max-num-iterations", str(max_num_iterations or iterations),
        "--viewer.quit-on-train-completion", "False",  # Keep viewer running after training
        "--vis", "viewer+tensorboard",
    ]

    print(f"Training command: {' '.join(cmd)}")

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        universal_newlines=True
    )

    # Print output in real-time and track progress
    for line in process.stdout:
        print(line, end='')
        # You can parse progress from the output here if needed
        # Nerfstudio outputs progress information in the logs

    process.wait()

    if process.returncode != 0:
        raise Exception("Splatfacto training failed")

    print("\n✓ Splatfacto training complete")
    return output_dir


def export_splat_model(nerfstudio_output_dir, export_dir):
    """
    Export the trained splatfacto model to .ply format

    Args:
        nerfstudio_output_dir: Directory containing the trained model
        export_dir: Directory where exported model will be saved
    """
    print("\n=== Exporting Splat Model ===")

    export_dir = Path(export_dir)
    export_dir.mkdir(parents=True, exist_ok=True)

    # Find the latest config file
    config_files = list(Path(nerfstudio_output_dir).rglob("config.yml"))
    if not config_files:
        raise Exception("No config.yml found in output directory")

    # Use the most recent config
    config_file = sorted(config_files, key=lambda x: x.stat().st_mtime)[-1]
    print(f"Using config: {config_file}")

    # Export to PLY format
    output_ply = export_dir / "point_cloud.ply"

    cmd = [
        "ns-export", "gaussian-splat",
        "--load-config", str(config_file),
        "--output-dir", str(export_dir),
    ]

    print(f"Export command: {' '.join(cmd)}")

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        universal_newlines=True
    )

    for line in process.stdout:
        print(line, end='')

    process.wait()

    if process.returncode != 0:
        raise Exception("Model export failed")

    # Find the exported PLY file
    ply_files = list(export_dir.glob("*.ply"))
    if not ply_files:
        # Try finding in subdirectories
        ply_files = list(export_dir.rglob("*.ply"))

    if ply_files:
        # Move/rename to standard location
        exported_ply = ply_files[0]
        if exported_ply != output_ply:
            shutil.copy2(exported_ply, output_ply)
        print(f"✓ Model exported to: {output_ply}")
        return output_ply
    else:
        raise Exception("No PLY file found after export")


def process_with_nerfstudio(input_dir, output_dir, iterations=30000):
    """
    Complete processing pipeline using nerfstudio

    Args:
        input_dir: Directory containing input images
        output_dir: Directory where output will be saved
        iterations: Number of training iterations
    """
    try:
        input_dir = Path(input_dir)
        output_dir = Path(output_dir)

        print(f"\n{'='*60}")
        print(f"Processing images with Nerfstudio Splatfacto")
        print(f"Input: {input_dir}")
        print(f"Output: {output_dir}")
        print(f"Iterations: {iterations}")
        print(f"{'='*60}\n")

        # Validate input
        if not input_dir.exists():
            raise ValueError(f"Input directory does not exist: {input_dir}")

        images = list(input_dir.glob('*.jpg')) + list(input_dir.glob('*.png')) + \
                 list(input_dir.glob('*.jpeg')) + list(input_dir.glob('*.JPG'))

        if len(images) < 3:
            raise ValueError(f"Need at least 3 images, found {len(images)}")

        print(f"Found {len(images)} images")

        # Create working directories
        work_dir = output_dir.parent / f"work_{output_dir.name}"
        work_dir.mkdir(parents=True, exist_ok=True)

        processed_data_dir = work_dir / "processed"
        training_output_dir = work_dir / "training"
        export_dir = output_dir

        # Step 1: Process data with nerfstudio
        print("\nStep 1/3: Processing images with nerfstudio...")
        run_nerfstudio_process_data(input_dir, processed_data_dir)

        # Step 2: Train splatfacto model
        print("\nStep 2/3: Training Splatfacto (Gaussian Splatting)...")
        run_splatfacto_training(processed_data_dir, training_output_dir, iterations)

        # Step 3: Export model to PLY
        print("\nStep 3/3: Exporting model to PLY format...")
        output_file = export_splat_model(training_output_dir, export_dir)

        # Get file size
        file_size = output_file.stat().st_size

        print("\n" + "="*60)
        print("✓ PROCESSING COMPLETE!")
        print(f"Output file: {output_file}")
        print(f"File size: {file_size / 1024 / 1024:.2f} MB")
        print("="*60 + "\n")

        return {
            'status': 'success',
            'output_file': str(output_file),
            'file_size': file_size,
            'message': 'Splatfacto training completed successfully'
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
    parser = argparse.ArgumentParser(description='Process images with Nerfstudio Splatfacto')
    parser.add_argument('--input_dir', required=True, help='Input directory with images')
    parser.add_argument('--output_dir', required=True, help='Output directory for model')
    parser.add_argument('--iterations', type=int, default=30000, help='Number of training iterations')

    args = parser.parse_args()

    result = process_with_nerfstudio(args.input_dir, args.output_dir, args.iterations)

    if result['status'] == 'error':
        sys.exit(1)
