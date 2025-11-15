"""
Utility functions for RunPod Gaussian Splatting worker
"""

import requests
from pathlib import Path
import shutil


def download_images(urls, output_dir):
    """
    Download images from URLs to output directory

    Args:
        urls: List of image URLs
        output_dir: Path to save images

    Returns:
        List of downloaded file paths
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    downloaded = []

    for idx, url in enumerate(urls):
        try:
            response = requests.get(url, timeout=30, stream=True)
            response.raise_for_status()

            # Determine file extension
            content_type = response.headers.get('content-type', '')
            ext = '.jpg'
            if 'png' in content_type.lower():
                ext = '.png'

            filepath = output_dir / f'image_{idx:04d}{ext}'

            with open(filepath, 'wb') as f:
                shutil.copyfileobj(response.raw, f)

            downloaded.append(filepath)

        except Exception as e:
            print(f"Failed to download {url}: {e}")
            continue

    return downloaded


def upload_to_r2(file_path, presigned_url):
    """
    Upload file to R2 using pre-signed URL

    Args:
        file_path: Path to file to upload
        presigned_url: Pre-signed R2 URL

    Returns:
        Public URL of uploaded file
    """
    with open(file_path, 'rb') as f:
        response = requests.put(
            presigned_url,
            data=f,
            headers={'Content-Type': 'application/octet-stream'},
            timeout=300
        )
        response.raise_for_status()

    # Return the URL without query parameters
    return presigned_url.split('?')[0]


def cleanup_files(*paths):
    """
    Remove files and directories

    Args:
        *paths: Variable number of paths to remove
    """
    for path in paths:
        path = Path(path)
        try:
            if path.is_file():
                path.unlink()
            elif path.is_dir():
                shutil.rmtree(path)
        except Exception as e:
            print(f"Failed to remove {path}: {e}")


def format_bytes(bytes_size):
    """
    Format bytes to human-readable size

    Args:
        bytes_size: Size in bytes

    Returns:
        Formatted string (e.g., "1.5 MB")
    """
    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_size < 1024.0:
            return f"{bytes_size:.2f} {unit}"
        bytes_size /= 1024.0
    return f"{bytes_size:.2f} TB"


def estimate_processing_time(num_images, iterations=7000):
    """
    Estimate processing time based on images and iterations

    Args:
        num_images: Number of input images
        iterations: Training iterations

    Returns:
        Estimated time in seconds
    """
    # Rough estimates based on typical performance
    # COLMAP: ~1-2 min per 10 images
    # Training: ~0.5 sec per iteration on A100

    colmap_time = (num_images / 10) * 90  # 90 seconds per 10 images
    training_time = iterations * 0.5  # 0.5 sec per iteration
    overhead = 60  # 1 minute overhead

    total = colmap_time + training_time + overhead
    return int(total)


def calculate_cost(processing_time_seconds, gpu_type='A100_80GB'):
    """
    Calculate processing cost

    Args:
        processing_time_seconds: Processing time in seconds
        gpu_type: GPU type identifier

    Returns:
        Cost in USD
    """
    # RunPod pricing (per hour)
    gpu_prices = {
        'RTX_4090': 0.35,
        'RTX_3090': 0.20,
        'A100_80GB': 2.17,
        'A100_40GB': 1.89,
        'T4': 0.40,
    }

    price_per_hour = gpu_prices.get(gpu_type, 2.17)
    hours = processing_time_seconds / 3600
    cost = hours * price_per_hour

    return round(cost, 3)
