#!/usr/bin/env python3
"""
Create georeferencing transform from GPS data.

Takes GPS data extracted from images and creates a similarity transform
to map from Nerfstudio's local coordinate system to ECEF (Earth-Centered, Earth-Fixed).

The transform consists of:
- Translation: GPS centroid in ECEF coordinates
- Rotation: ENU (East-North-Up) to ECEF at the centroid location
- Scale: User-specified or estimated from scene size
"""

import argparse
import json
import math
from pathlib import Path
from typing import Dict, List


def geodetic_to_ecef(lat_deg: float, lon_deg: float, h: float) -> List[float]:
    """
    Convert geodetic coordinates (lat, lon, height) to ECEF (Earth-Centered, Earth-Fixed).
    
    Uses WGS84 ellipsoid parameters.
    
    Args:
        lat_deg: Latitude in degrees
        lon_deg: Longitude in degrees
        h: Height above ellipsoid in meters
        
    Returns:
        [X, Y, Z] in ECEF coordinates (meters)
    """
    # WGS84 ellipsoid parameters
    a = 6378137.0  # Semi-major axis (equatorial radius) in meters
    f = 1 / 298.257223563  # Flattening
    e2 = 2 * f - f * f  # First eccentricity squared
    
    # Convert to radians
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    
    # Radius of curvature in the prime vertical
    N = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    
    # ECEF coordinates
    X = (N + h) * math.cos(lat) * math.cos(lon)
    Y = (N + h) * math.cos(lat) * math.sin(lon)
    Z = (N * (1 - e2) + h) * math.sin(lat)
    
    return [X, Y, Z]


def enu_to_ecef_rotation(lat_deg: float, lon_deg: float) -> List[List[float]]:
    """
    Compute rotation matrix from ENU (East-North-Up) to ECEF.
    
    ENU is a local tangent plane coordinate system:
    - East: +X
    - North: +Y
    - Up: +Z
    
    Args:
        lat_deg: Latitude in degrees (reference point)
        lon_deg: Longitude in degrees (reference point)
        
    Returns:
        3x3 rotation matrix (row-major)
    """
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    
    sin_lat = math.sin(lat)
    cos_lat = math.cos(lat)
    sin_lon = math.sin(lon)
    cos_lon = math.cos(lon)
    
    # ENU to ECEF rotation matrix
    # Columns are: East vector, North vector, Up vector (in ECEF)
    R = [
        [-sin_lon,           -sin_lat * cos_lon,  cos_lat * cos_lon],
        [ cos_lon,           -sin_lat * sin_lon,  cos_lat * sin_lon],
        [ 0,                  cos_lat,            sin_lat          ]
    ]
    
    return R


def create_transform_matrix(lat_deg: float, lon_deg: float, h: float, scale: float) -> List[float]:
    """
    Create a 4x4 transformation matrix for georeferencing.
    
    This maps from Nerfstudio's local coordinates to ECEF:
    - Scale: Uniform scale factor
    - Rotate: ENU to ECEF
    - Translate: To GPS centroid in ECEF
    
    Args:
        lat_deg: Latitude of origin in degrees
        lon_deg: Longitude of origin in degrees
        h: Height of origin in meters
        scale: Uniform scale factor
        
    Returns:
        16-element array (column-major 4x4 matrix for glTF/3D Tiles)
    """
    # Get ECEF position of origin
    t = geodetic_to_ecef(lat_deg, lon_deg, h)
    
    # Get ENU to ECEF rotation
    R = enu_to_ecef_rotation(lat_deg, lon_deg)
    
    # Build 4x4 matrix: M = [R*s | t]
    #                       [0   | 1]
    # In column-major order for glTF/3D Tiles
    transform = [
        R[0][0] * scale, R[1][0] * scale, R[2][0] * scale, 0,  # Column 0
        R[0][1] * scale, R[1][1] * scale, R[2][1] * scale, 0,  # Column 1
        R[0][2] * scale, R[1][2] * scale, R[2][2] * scale, 0,  # Column 2
        t[0],            t[1],            t[2],            1   # Column 3
    ]
    
    return transform


def estimate_scale_from_scene_size(scene_size_m: float, target_size: float = 50.0) -> float:
    """
    Estimate a reasonable scale factor based on scene size.
    
    Nerfstudio typically normalizes scenes to ~1-2 units.
    We want to scale up to real-world size in meters.
    
    Args:
        scene_size_m: Maximum extent of scene in meters (from GPS)
        target_size: Desired size in Nerfstudio units (default: 50)
        
    Returns:
        Scale factor
    """
    if scene_size_m < 1:
        # Very small scene or no GPS variation
        print(f"  ⚠ Scene size very small ({scene_size_m:.2f}m), using default scale")
        return 10.0
        
    # Nerfstudio typically uses ~2-3 unit scenes
    # Scale up to real-world size
    estimated_scale = scene_size_m / 2.0
    
    print(f"  📏 Scene extent: {scene_size_m:.2f}m")
    print(f"  🔢 Estimated scale: {estimated_scale:.2f}x")
    
    return estimated_scale


def load_gps_data(gps_json_path: str) -> Dict:
    """Load GPS data from JSON file created by extract_gps_from_images.py"""
    with open(gps_json_path, 'r') as f:
        return json.load(f)


def main():
    parser = argparse.ArgumentParser(
        description='Create georeferencing transform from GPS data',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Auto-estimate scale from GPS data
  python create_georef_from_gps.py --gps-data data/pole2/gps_data.json --output data/pole2/transform.json
  
  # Manually specify scale
  python create_georef_from_gps.py --gps-data data/pole2/gps_data.json --scale 100 --output transform.json
  
  # Adjust height offset
  python create_georef_from_gps.py --gps-data gps.json --height-offset 2.0 --output transform.json
        """
    )
    
    parser.add_argument(
        '--gps-data',
        type=str,
        required=True,
        help='GPS data JSON file (from extract_gps_from_images.py)'
    )
    
    parser.add_argument(
        '--output',
        type=str,
        required=True,
        help='Output transform JSON file'
    )
    
    parser.add_argument(
        '--scale',
        type=float,
        default=None,
        help='Manual scale factor (default: auto-estimate from scene size)'
    )
    
    parser.add_argument(
        '--height-offset',
        type=float,
        default=0.0,
        help='Height offset to add to GPS altitude (meters, default: 0)'
    )
    
    args = parser.parse_args()
    
    # Load GPS data
    print(f"\n📍 Loading GPS data from {args.gps_data}...")
    gps_data = load_gps_data(args.gps_data)
    
    centroid = gps_data['centroid']
    scene_size = gps_data['scene_size']
    
    print(f"\n✅ GPS Data Loaded:")
    print(f"  Centroid: ({centroid['lat']:.6f}°, {centroid['lon']:.6f}°, {centroid['alt']:.2f}m)")
    print(f"  Images with GPS: {gps_data['statistics']['images_with_gps']}")
    
    # Determine scale
    if args.scale is not None:
        scale = args.scale
        print(f"\n🔢 Using manual scale: {scale}x")
    else:
        print(f"\n🔢 Auto-estimating scale from scene size...")
        scale = estimate_scale_from_scene_size(scene_size['max_extent_m'])
        
    # Apply height offset
    height = centroid['alt'] + args.height_offset
    if args.height_offset != 0:
        print(f"  ⬆️ Height offset: +{args.height_offset:.2f}m → {height:.2f}m")
        
    # Create transform matrix
    print(f"\n🌍 Creating ECEF transform...")
    transform = create_transform_matrix(
        centroid['lat'],
        centroid['lon'],
        height,
        scale
    )
    
    # Convert to ECEF for display
    ecef = geodetic_to_ecef(centroid['lat'], centroid['lon'], height)
    print(f"  ECEF position: ({ecef[0]:.2f}, {ecef[1]:.2f}, {ecef[2]:.2f})")
    
    # Create output structure
    output = {
        'metadata': {
            'source': 'GPS EXIF data from images',
            'gps_data_file': args.gps_data,
            'images_with_gps': gps_data['statistics']['images_with_gps'],
            'centroid': centroid,
            'scene_size_m': scene_size,
            'scale': scale,
            'height_offset': args.height_offset,
        },
        'transform': {
            'matrix': transform,
            'description': 'Column-major 4x4 matrix: Local → ECEF (scale + rotate + translate)'
        },
        'origin': {
            'geodetic': {
                'lat': centroid['lat'],
                'lon': centroid['lon'],
                'height': height
            },
            'ecef': {
                'x': ecef[0],
                'y': ecef[1],
                'z': ecef[2]
            }
        }
    }
    
    # Save to JSON
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2)
        
    print(f"\n💾 Saved transform to: {output_path}")
    print(f"\n✅ Georeferencing transform ready!")
    print(f"\nNext steps:")
    print(f"  1. Train your Gaussian splat (if not already done)")
    print(f"  2. Convert to georeferenced 3D Tiles:")
    print(f"     python scripts/convert_to_spz_3dtiles.py \\")
    print(f"       --input outputs/your_splat.ply \\")
    print(f"       --output outputs/your_splat_geo/ \\")
    print(f"       --transform {args.output}")


if __name__ == '__main__':
    main()

