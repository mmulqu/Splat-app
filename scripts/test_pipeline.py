#!/usr/bin/env python3
"""
test_pipeline.py

End-to-end test of the Nerfstudio → Cesium 3D Tiles pipeline.

This script:
1. Generates a fake georeference transform
2. Applies it to a PLY file
3. Converts PLY → SPZ using gsbox
4. Converts SPZ → 3D Tiles using splat-3dtiles
5. Outputs a tileset ready for Cesium

Usage (inside Docker container):
  python3 /app/test_pipeline.py --input /workspace/outputs/b25f1978-fefa-4a00-846b-d00f57ec9fa0/splat.ply
"""

import argparse
import json
import os
import subprocess
import sys


def run_command(cmd, description):
    """Run a shell command and handle errors."""
    print(f"\n{'='*60}")
    print(f"STEP: {description}")
    print(f"{'='*60}")
    print(f"Command: {' '.join(cmd)}")
    print()
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.stdout:
        print(result.stdout)
    
    if result.returncode != 0:
        print(f"ERROR: {description} failed!")
        if result.stderr:
            print(result.stderr)
        sys.exit(1)
    
    print(f"✓ {description} completed successfully")
    return result


def main():
    parser = argparse.ArgumentParser(description="Test the full Nerfstudio → Cesium pipeline")
    parser.add_argument(
        "--input",
        required=True,
        help="Input PLY file (Nerfstudio Gaussian splat)"
    )
    parser.add_argument(
        "--lat",
        type=float,
        default=37.7694,
        help="Target latitude (default: Golden Gate Park)"
    )
    parser.add_argument(
        "--lon",
        type=float,
        default=-122.4862,
        help="Target longitude (default: Golden Gate Park)"
    )
    parser.add_argument(
        "--output-dir",
        default="/workspace/outputs/cesium_test",
        help="Output directory for 3D Tiles"
    )
    
    args = parser.parse_args()
    
    # Verify input file exists
    if not os.path.exists(args.input):
        print(f"ERROR: Input file not found: {args.input}")
        sys.exit(1)
    
    # Create output directory
    os.makedirs(args.output_dir, exist_ok=True)
    
    # Define intermediate file paths
    transform_json = os.path.join(args.output_dir, "transform.json")
    georef_ply = os.path.join(args.output_dir, "georeferenced.ply")
    splat_file = os.path.join(args.output_dir, "splat.splat")
    tiles_dir = os.path.join(args.output_dir, "tiles")
    
    print(f"\n{'#'*60}")
    print(f"# Nerfstudio → Cesium 3D Tiles Pipeline Test")
    print(f"{'#'*60}")
    print(f"Input PLY: {args.input}")
    print(f"Target location: ({args.lat}, {args.lon})")
    print(f"Output directory: {args.output_dir}")
    
    # Step 1: Generate fake georeference transform
    run_command(
        [
            "python3", "/app/scripts/create_fake_georef.py",
            "--lat", str(args.lat),
            "--lon", str(args.lon),
            "--output", transform_json
        ],
        "Generate fake georeference transform"
    )
    
    # Step 2: Apply transform to PLY
    run_command(
        [
            "python3", "/app/scripts/georef_splats.py",
            "--input", args.input,
            "--output", georef_ply,
            "--transform-json", transform_json
        ],
        "Apply georeference transform to PLY"
    )
    
    # Step 3: Convert PLY → SPLAT using gsbox
    run_command(
        ["gsbox", "p2s", "-i", georef_ply, "-o", splat_file, "-q", "7"],
        "Convert PLY to SPLAT format"
    )
    
    # Step 4: Convert SPLAT → 3D Tiles
    # Note: splat-3dtiles expects .splat format
    splat_3dtiles_script = "/app/splat-3dtiles/splat_to_3dtiles_optimized.py"
    
    if os.path.exists(splat_3dtiles_script):
        # Create tiles directory
        os.makedirs(tiles_dir, exist_ok=True)
        run_command(
            ["python3", splat_3dtiles_script, splat_file, tiles_dir],
            "Convert SPLAT to 3D Tiles"
        )
    else:
        print(f"\nWARNING: splat-3dtiles script not found at {splat_3dtiles_script}")
        print("Skipping 3D Tiles conversion step.")
        print("You can manually convert using gsbox or other tools.")
    
    # Summary
    print(f"\n{'#'*60}")
    print(f"# Pipeline Complete!")
    print(f"{'#'*60}")
    print(f"\nGenerated files:")
    print(f"  Transform JSON: {transform_json}")
    print(f"  Georeferenced PLY: {georef_ply}")
    print(f"  SPLAT file: {splat_file}")
    if os.path.exists(tiles_dir):
        print(f"  3D Tiles: {tiles_dir}/")
        tileset_json = os.path.join(tiles_dir, "tileset.json")
        if os.path.exists(tileset_json):
            print(f"\n✓ Tileset ready: {tileset_json}")
            print(f"\nNext steps:")
            print(f"  1. Copy {tiles_dir}/ to your web server")
            print(f"  2. Load in CesiumJS with:")
            print(f"     const tileset = await Cesium.Cesium3DTileset.fromUrl('{tileset_json}');")
    
    print(f"\nAll outputs saved to: {args.output_dir}")


if __name__ == "__main__":
    main()

