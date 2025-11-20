#!/usr/bin/env python3
"""
create_fake_georef.py

Generate a fake georeference transform to place a Nerfstudio splat at a specific location on Earth.

Usage:
  python create_fake_georef.py --lat 37.7694 --lon -122.4862 --output transform.json
  
This creates a transform.json that you can use with georef_splats.py to place your model
at the specified latitude/longitude (default: Golden Gate Park, San Francisco).
"""

import argparse
import json
import numpy as np


def geodetic_to_ecef(lat_deg, lon_deg, h):
    """
    Convert geodetic coordinates (lat, lon, height) to ECEF (Earth-Centered, Earth-Fixed).
    
    Uses WGS84 ellipsoid parameters.
    """
    lat = np.deg2rad(lat_deg)
    lon = np.deg2rad(lon_deg)
    
    # WGS84 parameters
    a = 6378137.0  # semi-major axis (meters)
    f = 1 / 298.257223563  # flattening
    e2 = 2 * f - f ** 2  # eccentricity squared
    
    N = a / np.sqrt(1 - e2 * np.sin(lat) ** 2)
    
    x = (N + h) * np.cos(lat) * np.cos(lon)
    y = (N + h) * np.cos(lat) * np.sin(lon)
    z = (N * (1 - e2) + h) * np.sin(lat)
    
    return np.array([x, y, z])


def enu_basis(lat_deg, lon_deg):
    """
    Compute the East-North-Up basis vectors at a given lat/lon.
    Returns rotation matrix from ECEF to ENU.
    """
    lat = np.deg2rad(lat_deg)
    lon = np.deg2rad(lon_deg)
    
    cl, sl = np.cos(lon), np.sin(lon)
    cp, sp = np.cos(lat), np.sin(lat)
    
    east = np.array([-sl, cl, 0.0])
    north = np.array([-sp * cl, -sp * sl, cp])
    up = np.array([cp * cl, cp * sl, sp])
    
    # Stack as rows to get ECEF -> ENU rotation
    R_ecef_to_enu = np.vstack([east, north, up])
    
    return R_ecef_to_enu


def create_identity_transform():
    """
    Create an identity similarity transform (no change).
    Useful if your Nerfstudio model is already in a local metric frame.
    """
    return {
        "scale": 1.0,
        "R": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        "t": [0, 0, 0]
    }


def create_enu_transform(lat_deg, lon_deg, h=0.0, scale=1.0):
    """
    Create a transform that places a Nerfstudio model (assumed to be in a local metric frame)
    into an ENU frame centered at (lat, lon, h).
    
    This assumes your Nerfstudio model is roughly centered at the origin and in meters.
    The scale parameter can be used to adjust the size if needed.
    """
    # Compute ECEF position for the reference point
    ecef_origin = geodetic_to_ecef(lat_deg, lon_deg, h)
    
    # Get ENU basis at this location
    R_ecef_to_enu = enu_basis(lat_deg, lon_deg)
    
    # The transform from Nerfstudio local coords to ECEF:
    # 1. Scale the model
    # 2. Rotate from ENU to ECEF (transpose of R_ecef_to_enu)
    # 3. Translate to the ECEF origin
    
    # For the PLY transform (local → ENU), we just scale and translate
    # The actual ECEF transform will be in the 3D Tiles tileset.json
    
    return {
        "scale": scale,
        "R": [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        "t": [0, 0, h],  # Offset by height
        "reference_point": {
            "lat": lat_deg,
            "lon": lon_deg,
            "height": h,
            "ecef": ecef_origin.tolist(),
            "note": "This is the ENU origin for the transformed model"
        }
    }


def create_correspondences_example(lat_deg, lon_deg, h=0.0):
    """
    Create an example correspondences.json file.
    
    This assumes your Nerfstudio model has some known points that you can identify
    in real-world coordinates.
    """
    # Example: 4 points forming a square in Nerfstudio space
    nerf_points = [
        [0.0, 0.0, 0.0],    # Origin
        [10.0, 0.0, 0.0],   # 10m east
        [0.0, 10.0, 0.0],   # 10m north
        [0.0, 0.0, 5.0]     # 5m up
    ]
    
    # Corresponding world points (in ENU meters relative to reference point)
    # In a real scenario, you'd have actual GPS measurements
    world_points = [
        [0.0, 0.0, h],
        [10.0, 0.0, h],
        [0.0, 10.0, h],
        [0.0, 0.0, h + 5.0]
    ]
    
    return {
        "nerf": nerf_points,
        "world": world_points,
        "reference_point": {
            "lat": lat_deg,
            "lon": lon_deg,
            "height": h,
            "note": "World points are in ENU meters relative to this reference"
        }
    }


def main():
    parser = argparse.ArgumentParser(
        description="Generate fake georeference transform for testing Cesium pipeline"
    )
    parser.add_argument(
        "--lat",
        type=float,
        default=37.7694,
        help="Latitude in degrees (default: 37.7694, Golden Gate Park SF)"
    )
    parser.add_argument(
        "--lon",
        type=float,
        default=-122.4862,
        help="Longitude in degrees (default: -122.4862, Golden Gate Park SF)"
    )
    parser.add_argument(
        "--height",
        type=float,
        default=0.0,
        help="Height above ellipsoid in meters (default: 0.0)"
    )
    parser.add_argument(
        "--scale",
        type=float,
        default=1.0,
        help="Scale factor for the model (default: 1.0)"
    )
    parser.add_argument(
        "--output",
        default="scripts/fake_transform.json",
        help="Output transform JSON file (default: scripts/fake_transform.json)"
    )
    parser.add_argument(
        "--correspondences",
        action="store_true",
        help="Also generate an example correspondences.json file"
    )
    
    args = parser.parse_args()
    
    # Generate transform
    transform = create_enu_transform(args.lat, args.lon, args.height, args.scale)
    
    with open(args.output, "w") as f:
        json.dump(transform, f, indent=2)
    
    print(f"✓ Created fake transform at: {args.output}")
    print(f"  Location: ({args.lat}, {args.lon}) at {args.height}m")
    print(f"  Scale: {args.scale}")
    
    # Optionally generate correspondences
    if args.correspondences:
        corr_path = args.output.replace("transform.json", "correspondences.json")
        correspondences = create_correspondences_example(args.lat, args.lon, args.height)
        
        with open(corr_path, "w") as f:
            json.dump(correspondences, f, indent=2)
        
        print(f"✓ Created example correspondences at: {corr_path}")
    
    print("\nNext steps:")
    print(f"  1. Run: python scripts/georef_splats.py --input <your.ply> --output <geo.ply> --transform-json {args.output}")
    print(f"  2. Convert to 3D Tiles using gsbox and splat-3dtiles")
    print(f"  3. Load in CesiumJS viewer")


if __name__ == "__main__":
    main()

