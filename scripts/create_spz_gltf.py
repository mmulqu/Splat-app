#!/usr/bin/env python3
"""
create_spz_gltf.py

Creates a glTF file with embedded SPZ Gaussian splat data using the
KHR_gaussian_splatting_compression_spz_2 extension.

This is what CesiumJS 1.135 expects for Gaussian splat rendering.

Usage:
  python create_spz_gltf.py \
    --input /workspace/outputs/cesium_test_spz/tile_0.spz \
    --output /workspace/outputs/cesium_test_spz/tile_0.glb
"""

import argparse
import json
import struct
from pathlib import Path
import base64


def create_spz_gltf(spz_file, output_gltf):
    """
    Create a glTF file with embedded SPZ data using KHR_gaussian_splatting_compression_spz_2.
    
    Reference: https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_gaussian_splatting
    """
    # Read SPZ binary data
    with open(spz_file, 'rb') as f:
        spz_data = f.read()
    
    print(f"Read {len(spz_data)} bytes from {spz_file}")
    
    # Create glTF structure
    gltf = {
        "asset": {
            "version": "2.0",
            "generator": "custom-spz-to-gltf"
        },
        "extensionsUsed": [
            "KHR_gaussian_splatting",
            "KHR_gaussian_splatting_compression_spz_2"
        ],
        "extensionsRequired": [
            "KHR_gaussian_splatting",
            "KHR_gaussian_splatting_compression_spz_2"
        ],
        "scene": 0,
        "scenes": [
            {
                "nodes": [0]
            }
        ],
        "nodes": [
            {
                "mesh": 0
            }
        ],
        "meshes": [
            {
                "primitives": [
                    {
                        "mode": 0,  # POINTS
                        "extensions": {
                            "KHR_gaussian_splatting": {
                                "extensions": {
                                    "KHR_gaussian_splatting_compression_spz_2": {
                                        "buffer": 0
                                    }
                                }
                            }
                        }
                    }
                ]
            }
        ],
        "buffers": [
            {
                "byteLength": len(spz_data),
                "uri": f"data:application/octet-stream;base64,{base64.b64encode(spz_data).decode('ascii')}"
            }
        ]
    }
    
    # Write glTF
    output_path = Path(output_gltf)
    with open(output_path, 'w') as f:
        json.dump(gltf, f, indent=2)
    
    print(f"✓ Created glTF with embedded SPZ at {output_path}")
    print(f"  SPZ data size: {len(spz_data)} bytes")
    print(f"  Extensions: {gltf['extensionsUsed']}")
    
    return output_path


def main():
    parser = argparse.ArgumentParser(
        description="Create glTF with embedded SPZ Gaussian splat data"
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to input SPZ file"
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Path to output glTF file"
    )
    
    args = parser.parse_args()
    
    spz_file = Path(args.input)
    if not spz_file.exists():
        print(f"❌ ERROR: Input file not found: {spz_file}")
        return 1
    
    create_spz_gltf(spz_file, args.output)
    return 0


if __name__ == "__main__":
    exit(main())

