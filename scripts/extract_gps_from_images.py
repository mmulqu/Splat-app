#!/usr/bin/env python3
"""
Extract GPS coordinates from image EXIF data.

Reads GPS metadata from a directory of images and outputs:
- Individual image coordinates
- Scene centroid (average position)
- Bounding box
- Statistics

Supports JPEG images with EXIF GPS tags (common in smartphone photos).
"""

import argparse
import json
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    from PIL import Image
    from PIL.ExifTags import TAGS, GPSTAGS
except ImportError:
    print("ERROR: PIL/Pillow not installed. Install with: pip install Pillow")
    exit(1)


def convert_to_degrees(value: Tuple) -> float:
    """
    Convert GPS coordinates from degrees/minutes/seconds to decimal degrees.
    
    Args:
        value: Tuple of (degrees, minutes, seconds) as rationals
        
    Returns:
        Decimal degrees as float
    """
    d = float(value[0])
    m = float(value[1])
    s = float(value[2])
    return d + (m / 60.0) + (s / 3600.0)


def get_gps_data(image_path: str) -> Optional[Dict]:
    """
    Extract GPS data from an image's EXIF metadata.
    
    Args:
        image_path: Path to image file
        
    Returns:
        Dictionary with lat, lon, alt (if available), or None if no GPS data
    """
    try:
        image = Image.open(image_path)
        exif_data = image._getexif()
        
        if not exif_data:
            return None
            
        # Find GPS Info tag
        gps_info = None
        for tag, value in exif_data.items():
            tag_name = TAGS.get(tag, tag)
            if tag_name == 'GPSInfo':
                gps_info = value
                break
                
        if not gps_info:
            return None
            
        # Parse GPS data
        gps_data = {}
        for key in gps_info.keys():
            decode = GPSTAGS.get(key, key)
            gps_data[decode] = gps_info[key]
            
        # Extract latitude
        if 'GPSLatitude' in gps_data and 'GPSLatitudeRef' in gps_data:
            lat = convert_to_degrees(gps_data['GPSLatitude'])
            if gps_data['GPSLatitudeRef'] == 'S':
                lat = -lat
        else:
            return None
            
        # Extract longitude
        if 'GPSLongitude' in gps_data and 'GPSLongitudeRef' in gps_data:
            lon = convert_to_degrees(gps_data['GPSLongitude'])
            if gps_data['GPSLongitudeRef'] == 'W':
                lon = -lon
        else:
            return None
            
        # Extract altitude (optional)
        alt = None
        if 'GPSAltitude' in gps_data:
            alt = float(gps_data['GPSAltitude'])
            # Check altitude reference (0 = above sea level, 1 = below)
            if 'GPSAltitudeRef' in gps_data and gps_data['GPSAltitudeRef'] == 1:
                alt = -alt
                
        result = {
            'lat': lat,
            'lon': lon,
        }
        
        if alt is not None:
            result['alt'] = alt
            
        return result
        
    except Exception as e:
        print(f"Warning: Could not read GPS from {image_path}: {e}")
        return None


def extract_gps_from_directory(image_dir: str, extensions: List[str] = None) -> Dict:
    """
    Extract GPS data from all images in a directory.
    
    Args:
        image_dir: Path to directory containing images
        extensions: List of file extensions to process (default: ['.jpg', '.jpeg', '.JPG', '.JPEG'])
        
    Returns:
        Dictionary with GPS data for all images and statistics
    """
    if extensions is None:
        extensions = ['.jpg', '.jpeg', '.JPG', '.JPEG']
        
    image_dir = Path(image_dir)
    
    if not image_dir.exists():
        raise ValueError(f"Directory does not exist: {image_dir}")
        
    # Find all images
    image_files = []
    for ext in extensions:
        image_files.extend(image_dir.glob(f"*{ext}"))
        
    if not image_files:
        raise ValueError(f"No images found in {image_dir} with extensions {extensions}")
        
    print(f"Found {len(image_files)} images in {image_dir}")
    
    # Extract GPS from each image
    images_with_gps = []
    images_without_gps = []
    
    for img_path in sorted(image_files):
        gps_data = get_gps_data(str(img_path))
        
        if gps_data:
            images_with_gps.append({
                'filename': img_path.name,
                'path': str(img_path.relative_to(image_dir.parent.parent)),  # Relative to project root
                **gps_data
            })
        else:
            images_without_gps.append(img_path.name)
            
    print(f"  ✓ {len(images_with_gps)} images with GPS data")
    print(f"  ✗ {len(images_without_gps)} images without GPS data")
    
    if not images_with_gps:
        raise ValueError("No images with GPS data found!")
        
    # Calculate statistics
    lats = [img['lat'] for img in images_with_gps]
    lons = [img['lon'] for img in images_with_gps]
    alts = [img['alt'] for img in images_with_gps if 'alt' in img]
    
    centroid = {
        'lat': sum(lats) / len(lats),
        'lon': sum(lons) / len(lons),
    }
    
    if alts:
        centroid['alt'] = sum(alts) / len(alts)
    else:
        print("  ⚠ No altitude data found in images, using default: 0m")
        centroid['alt'] = 0.0
        
    bounds = {
        'min_lat': min(lats),
        'max_lat': max(lats),
        'min_lon': min(lons),
        'max_lon': max(lons),
    }
    
    if alts:
        bounds['min_alt'] = min(alts)
        bounds['max_alt'] = max(alts)
        
    # Calculate approximate scene size
    # Rough approximation: 1 degree ≈ 111 km at equator
    lat_range_m = (bounds['max_lat'] - bounds['min_lat']) * 111000
    lon_range_m = (bounds['max_lon'] - bounds['min_lon']) * 111000 * abs(centroid['lat'] / 90)
    
    if alts:
        alt_range_m = bounds['max_alt'] - bounds['min_alt']
    else:
        alt_range_m = 0
        
    scene_size = {
        'lat_range_m': lat_range_m,
        'lon_range_m': lon_range_m,
        'alt_range_m': alt_range_m,
        'max_extent_m': max(lat_range_m, lon_range_m, alt_range_m)
    }
    
    return {
        'images': images_with_gps,
        'images_without_gps': images_without_gps,
        'centroid': centroid,
        'bounds': bounds,
        'scene_size': scene_size,
        'statistics': {
            'total_images': len(image_files),
            'images_with_gps': len(images_with_gps),
            'images_without_gps': len(images_without_gps),
        }
    }


def main():
    parser = argparse.ArgumentParser(
        description='Extract GPS coordinates from image EXIF data',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Extract GPS from iPhone photos
  python extract_gps_from_images.py --images data/pole2/ --output data/pole2/gps_data.json
  
  # Include PNG files
  python extract_gps_from_images.py --images data/pole2/ --extensions .jpg .png --output gps.json
        """
    )
    
    parser.add_argument(
        '--images',
        type=str,
        required=True,
        help='Directory containing images with GPS EXIF data'
    )
    
    parser.add_argument(
        '--output',
        type=str,
        required=True,
        help='Output JSON file path'
    )
    
    parser.add_argument(
        '--extensions',
        type=str,
        nargs='+',
        default=['.jpg', '.jpeg', '.JPG', '.JPEG'],
        help='Image file extensions to process (default: .jpg .jpeg .JPG .JPEG)'
    )
    
    args = parser.parse_args()
    
    # Extract GPS data
    print(f"\n📍 Extracting GPS data from images...")
    gps_data = extract_gps_from_directory(args.images, args.extensions)
    
    # Print summary
    print(f"\n✅ GPS Extraction Complete!")
    print(f"\n📊 Statistics:")
    print(f"  Total images: {gps_data['statistics']['total_images']}")
    print(f"  With GPS: {gps_data['statistics']['images_with_gps']}")
    print(f"  Without GPS: {gps_data['statistics']['images_without_gps']}")
    
    print(f"\n📍 Scene Centroid:")
    print(f"  Latitude:  {gps_data['centroid']['lat']:.6f}°")
    print(f"  Longitude: {gps_data['centroid']['lon']:.6f}°")
    print(f"  Altitude:  {gps_data['centroid']['alt']:.2f} m")
    
    print(f"\n📏 Scene Size (approximate):")
    print(f"  Lat range: {gps_data['scene_size']['lat_range_m']:.2f} m")
    print(f"  Lon range: {gps_data['scene_size']['lon_range_m']:.2f} m")
    print(f"  Alt range: {gps_data['scene_size']['alt_range_m']:.2f} m")
    print(f"  Max extent: {gps_data['scene_size']['max_extent_m']:.2f} m")
    
    # Save to JSON
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w') as f:
        json.dump(gps_data, f, indent=2)
        
    print(f"\n💾 Saved GPS data to: {output_path}")
    print(f"\nNext steps:")
    print(f"  1. Train Gaussian splat: ns-train splatfacto --data {args.images}")
    print(f"  2. Create georef transform: python scripts/create_georef_from_gps.py --gps-data {args.output}")
    print(f"  3. Convert to 3D Tiles with real GPS coordinates!")


if __name__ == '__main__':
    main()

