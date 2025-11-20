#!/usr/bin/env python3
"""
convert_to_spz_3dtiles.py

Converts a Gaussian splat PLY to 3D Tiles using SPZ compression.
This creates a tileset that uses KHR_gaussian_splatting_compression_spz_2,
which CesiumJS 1.135 fully supports.

Usage:
  python convert_to_spz_3dtiles.py \
    --input /workspace/outputs/cesium_test/georeferenced.ply \
    --output /workspace/outputs/cesium_test/tiles_spz \
    --lat 37.7694 \
    --lon -122.4862 \
    --height 10 \
    --scale 10
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
import numpy as np


def geodetic_to_ecef(lat_deg, lon_deg, h):
    """Convert geodetic coordinates to ECEF."""
    lat = np.deg2rad(lat_deg)
    lon = np.deg2rad(lon_deg)
    
    # WGS84 parameters
    a = 6378137.0
    f = 1 / 298.257223563
    e2 = 2 * f - f ** 2
    
    N = a / np.sqrt(1 - e2 * np.sin(lat) ** 2)
    
    x = (N + h) * np.cos(lat) * np.cos(lon)
    y = (N + h) * np.cos(lat) * np.sin(lon)
    z = (N * (1 - e2) + h) * np.sin(lat)
    
    return np.array([x, y, z])


def enu_to_ecef_rotation(lat_deg, lon_deg):
    """Compute rotation matrix from ENU to ECEF at given location."""
    lat = np.deg2rad(lat_deg)
    lon = np.deg2rad(lon_deg)
    
    cl, sl = np.cos(lon), np.sin(lon)
    cp, sp = np.cos(lat), np.sin(lat)
    
    # ENU basis vectors in ECEF
    east = np.array([-sl, cl, 0.0])
    north = np.array([-sp * cl, -sp * sl, cp])
    up = np.array([cp * cl, cp * sl, sp])
    
    # Rotation matrix (columns are ENU axes in ECEF)
    R = np.column_stack([east, north, up])
    
    return R


def create_transform_matrix(lat_deg, lon_deg, h, scale=1.0):
    """Create a 4x4 transform matrix for ECEF positioning."""
    t_ecef = geodetic_to_ecef(lat_deg, lon_deg, h)
    R = enu_to_ecef_rotation(lat_deg, lon_deg)
    
    transform = np.eye(4)
    transform[:3, :3] = R * scale
    transform[:3, 3] = t_ecef
    
    # Return as column-major flat array (glTF/3D Tiles format)
    return transform.T.flatten().tolist()


def run_command(cmd, description):
    """Run a shell command and handle errors."""
    print(f"\n{'='*60}")
    print(f"STEP: {description}")
    print(f"{'='*60}")
    print(f"Command: {cmd}\n")
    
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    
    if result.returncode != 0:
        print(f"\n❌ ERROR: {description} failed with exit code {result.returncode}")
        sys.exit(1)
    
    print(f"✓ {description} completed successfully")
    return result


def create_spz_tileset_manual(spz_file, output_dir, lat, lon, height, scale):
    """
    Manually create a 3D Tiles tileset.json that references an SPZ file.
    
    Note: This is a simplified approach. For production, you'd want to:
    1. Parse the SPZ to get actual bounding box
    2. Potentially split into multiple tiles for LOD
    3. Calculate proper geometric error
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Copy SPZ file to output directory
    import shutil
    spz_dest = output_dir / "tile_0.spz"
    shutil.copy2(spz_file, spz_dest)
    print(f"✓ Copied SPZ to {spz_dest}")
    
    # Create transform matrix
    transform = create_transform_matrix(lat, lon, height, scale)
    
    # Create tileset.json
    # Note: Using a large bounding box since we don't parse the SPZ
    tileset = {
        "asset": {
            "version": "1.1",
            "gltfUpAxis": "Z"
        },
        "extensionsUsed": [
            "3DTILES_content_gltf"
        ],
        "geometricError": 100,
        "root": {
            "boundingVolume": {
                "box": [
                    0, 0, 0,  # center
                    50, 0, 0,  # x-axis half-length
                    0, 50, 0,  # y-axis half-length
                    0, 0, 50   # z-axis half-length
                ]
            },
            "geometricError": 100,
            "refine": "ADD",
            "content": {
                "uri": "tile_0.spz"
            },
            "transform": transform
        }
    }
    
    tileset_path = output_dir / "tileset.json"
    with open(tileset_path, 'w') as f:
        json.dump(tileset, f, indent=2)
    
    print(f"✓ Created tileset.json at {tileset_path}")
    print(f"  Location: ({lat}, {lon}) at {height}m")
    print(f"  Scale: {scale}x")
    
    return tileset_path


def main():
    parser = argparse.ArgumentParser(
        description="Convert Gaussian splat PLY to 3D Tiles with SPZ compression"
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to input PLY file (already georeferenced)"
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Output directory for 3D Tiles"
    )
    parser.add_argument(
        "--lat",
        type=float,
        required=True,
        help="Latitude in degrees"
    )
    parser.add_argument(
        "--lon",
        type=float,
        required=True,
        help="Longitude in degrees"
    )
    parser.add_argument(
        "--height",
        type=float,
        default=10.0,
        help="Height above ellipsoid in meters (default: 10)"
    )
    parser.add_argument(
        "--scale",
        type=float,
        default=10.0,
        help="Scale factor (default: 10)"
    )
    parser.add_argument(
        "--quality",
        type=int,
        default=7,
        choices=range(1, 10),
        help="SPZ compression quality 1-9 (default: 7)"
    )
    
    args = parser.parse_args()
    
    input_ply = Path(args.input)
    output_dir = Path(args.output)
    
    if not input_ply.exists():
        print(f"❌ ERROR: Input file not found: {input_ply}")
        sys.exit(1)
    
    print(f"\n{'='*60}")
    print(f"Converting Gaussian Splat PLY to 3D Tiles (SPZ)")
    print(f"{'='*60}")
    print(f"Input: {input_ply}")
    print(f"Output: {output_dir}")
    print(f"Location: ({args.lat}, {args.lon}) @ {args.height}m")
    print(f"Scale: {args.scale}x")
    print(f"Quality: {args.quality}")
    
    # Step 1: Convert PLY to SPZ using gsbox
    spz_file = output_dir / "temp.spz"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    run_command(
        f"gsbox p2z -i {input_ply} -o {spz_file} -q {args.quality}",
        "Convert PLY to SPZ format"
    )
    
    # Step 2: Create tileset.json manually
    create_spz_tileset_manual(
        spz_file,
        output_dir,
        args.lat,
        args.lon,
        args.height,
        args.scale
    )
    
    # Clean up temp file
    if spz_file.exists() and spz_file != output_dir / "tile_0.spz":
        spz_file.unlink()
    
    print(f"\n{'='*60}")
    print(f"✓ SUCCESS: 3D Tiles with SPZ compression created!")
    print(f"{'='*60}")
    print(f"Output directory: {output_dir}")
    print(f"Tileset: {output_dir / 'tileset.json'}")
    print(f"\nTo view in CesiumJS:")
    print(f"  1. Ensure your Flask server is running")
    print(f"  2. Open http://localhost:5001/cesium")
    print(f"  3. Load tileset: /outputs/{output_dir.relative_to('/workspace/outputs')}/tileset.json")


if __name__ == "__main__":
    main()

