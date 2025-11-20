#!/usr/bin/env python3
"""
fix_tileset_georeference.py

Updates a 3D Tiles tileset.json to include proper ECEF transform for georeferencing.

Usage:
  python fix_tileset_georeference.py \
    --tileset /workspace/outputs/cesium_test/tiles/tileset.json \
    --lat 37.7694 \
    --lon -122.4862 \
    --height 10 \
    --scale 10
"""

import argparse
import json
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
    """
    Create a 4x4 transform matrix that:
    1. Scales the model
    2. Rotates from local ENU to ECEF
    3. Translates to the correct ECEF position
    """
    # Get ECEF position
    t_ecef = geodetic_to_ecef(lat_deg, lon_deg, h)
    
    # Get rotation from ENU to ECEF
    R = enu_to_ecef_rotation(lat_deg, lon_deg)
    
    # Build 4x4 transform matrix (column-major for glTF/3D Tiles)
    # T = [R*s | t]
    #     [0   | 1]
    transform = np.eye(4)
    transform[:3, :3] = R * scale
    transform[:3, 3] = t_ecef
    
    # Return as column-major flat array (glTF/3D Tiles format)
    return transform.T.flatten().tolist()


def update_tileset_transform(tileset_path, lat, lon, height, scale):
    """Update tileset.json with proper ECEF transform and extension declarations."""
    # Read existing tileset
    with open(tileset_path, 'r') as f:
        tileset = json.load(f)
    
    # Create transform matrix
    transform = create_transform_matrix(lat, lon, height, scale)
    
    # Add transform to root tile
    tileset['root']['transform'] = transform
    
    # Add extension declarations at tileset level (required for CesiumJS to recognize Gaussian splats)
    # Check if the glTF content uses KHR_gaussian_splatting
    if 'extensionsUsed' not in tileset:
        tileset['extensionsUsed'] = []
    
    # Add 3D Tiles extension for glTF content
    if '3DTILES_content_gltf' not in tileset['extensionsUsed']:
        tileset['extensionsUsed'].append('3DTILES_content_gltf')
    
    # Note: The glTF files themselves declare KHR_gaussian_splatting,
    # but we need to ensure the tileset knows about glTF content
    
    # Update bounding volume to region (optional, but more accurate)
    # For now, keep the existing box but add a note
    if 'boundingVolume' not in tileset['root']:
        tileset['root']['boundingVolume'] = {}
    
    # Write updated tileset
    with open(tileset_path, 'w') as f:
        json.dump(tileset, f, indent=2)
    
    print(f"✓ Updated tileset transform and extensions")
    print(f"  Location: ({lat}, {lon}) at {height}m")
    print(f"  Scale: {scale}x")
    print(f"  Extensions: {tileset.get('extensionsUsed', [])}")
    print(f"  Transform matrix (column-major):")
    for i in range(4):
        row = transform[i*4:(i+1)*4]
        print(f"    [{row[0]:12.6f}, {row[1]:12.6f}, {row[2]:12.6f}, {row[3]:12.6f}]")


def main():
    parser = argparse.ArgumentParser(
        description="Fix tileset.json georeferencing with proper ECEF transform"
    )
    parser.add_argument(
        "--tileset",
        required=True,
        help="Path to tileset.json"
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
        default=0.0,
        help="Height above ellipsoid in meters (default: 0)"
    )
    parser.add_argument(
        "--scale",
        type=float,
        default=1.0,
        help="Scale factor for the model (default: 1.0, try 10-100 for small models)"
    )
    
    args = parser.parse_args()
    
    update_tileset_transform(args.tileset, args.lat, args.lon, args.height, args.scale)


if __name__ == "__main__":
    main()

