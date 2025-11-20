#!/usr/bin/env python3
"""
update_tileset_scale.py

Updates the scale in a tileset's transform matrix.
Useful for making splats larger/smaller without regenerating everything.

Usage:
  python update_tileset_scale.py --tileset /path/to/tileset.json --scale 100
"""

import argparse
import json
import numpy as np
from pathlib import Path


def update_tileset_scale(tileset_path, new_scale):
    """Update the scale factor in a tileset's transform matrix."""
    with open(tileset_path, 'r') as f:
        tileset = json.load(f)
    
    if 'transform' not in tileset['root']:
        print("❌ ERROR: No transform found in tileset root")
        return False
    
    # Transform is column-major 4x4 matrix as flat array
    transform_flat = tileset['root']['transform']
    
    # Reshape to 4x4 (column-major, so transpose after reshape)
    M = np.array(transform_flat).reshape(4, 4).T
    
    print(f"\nCurrent transform matrix:")
    print(M)
    print()
    
    # Extract current scale from the rotation part
    # The upper-left 3x3 contains R*s, so we can get the scale from the column norms
    current_scale = np.linalg.norm(M[:3, 0])
    print(f"Current scale: {current_scale:.2f}")
    print(f"New scale: {new_scale:.2f}")
    print(f"Scale multiplier: {new_scale / current_scale:.2f}x")
    print()
    
    # Update scale: multiply the upper-left 3x3 by (new_scale / current_scale)
    scale_factor = new_scale / current_scale
    M[:3, :3] *= scale_factor
    
    # Convert back to column-major flat array
    transform_flat_new = M.T.flatten().tolist()
    
    # Update tileset
    tileset['root']['transform'] = transform_flat_new
    
    # Write back
    with open(tileset_path, 'w') as f:
        json.dump(tileset, f, indent=2)
    
    print(f"✓ Updated {tileset_path}")
    print(f"  New transform matrix:")
    print(M)
    
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Update scale in tileset transform matrix"
    )
    parser.add_argument(
        "--tileset",
        required=True,
        help="Path to tileset.json"
    )
    parser.add_argument(
        "--scale",
        type=float,
        required=True,
        help="New scale factor (e.g., 100 for 100x larger)"
    )
    
    args = parser.parse_args()
    
    tileset_path = Path(args.tileset)
    if not tileset_path.exists():
        print(f"❌ ERROR: Tileset not found: {tileset_path}")
        return 1
    
    if not update_tileset_scale(tileset_path, args.scale):
        return 1
    
    print("\n✓ Done! Reload the tileset in CesiumJS to see the changes.")
    return 0


if __name__ == "__main__":
    exit(main())

