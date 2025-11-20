#!/usr/bin/env python3
"""
inspect_and_rescale_splats.py

Inspects Gaussian splat scale values and optionally rescales them.
This is crucial for visualization - if scales are too small, splats appear as points.

Usage:
  # Inspect only
  python inspect_and_rescale_splats.py --input splat.ply
  
  # Rescale
  python inspect_and_rescale_splats.py --input splat.ply --output rescaled.ply --scale-multiplier 100
"""

import argparse
import numpy as np
from plyfile import PlyData, PlyElement
from pathlib import Path


def inspect_splat_scales(ply_path):
    """Inspect the scale values in a Gaussian splat PLY."""
    print(f"\n{'='*60}")
    print(f"Inspecting: {ply_path}")
    print(f"{'='*60}\n")
    
    ply = PlyData.read(ply_path)
    vertex = ply['vertex']
    
    # Find scale properties (usually scale_0, scale_1, scale_2)
    scale_props = [p for p in vertex.data.dtype.names if 'scale' in p.lower()]
    
    if not scale_props:
        print("❌ No scale properties found in PLY!")
        return None
    
    print(f"Scale properties found: {scale_props}")
    print()
    
    # Get scale statistics
    for prop in scale_props:
        values = vertex[prop]
        print(f"{prop}:")
        print(f"  Min:    {np.min(values):.6f}")
        print(f"  Max:    {np.max(values):.6f}")
        print(f"  Mean:   {np.mean(values):.6f}")
        print(f"  Median: {np.median(values):.6f}")
        print(f"  Std:    {np.std(values):.6f}")
        print()
    
    # Get position statistics for context
    if 'x' in vertex.data.dtype.names:
        positions = np.column_stack([vertex['x'], vertex['y'], vertex['z']])
        pos_extent = np.max(positions, axis=0) - np.min(positions, axis=0)
        print(f"Position extent (scene size):")
        print(f"  X: {pos_extent[0]:.3f}")
        print(f"  Y: {pos_extent[1]:.3f}")
        print(f"  Z: {pos_extent[2]:.3f}")
        print(f"  Max dimension: {np.max(pos_extent):.3f}")
        print()
        
        # Calculate what scale would be visible
        avg_scale = np.mean([np.mean(vertex[p]) for p in scale_props])
        scene_size = np.max(pos_extent)
        relative_scale = avg_scale / scene_size
        print(f"Average scale relative to scene size: {relative_scale:.6f}")
        print(f"  (Typical visible range: 0.001 - 0.1)")
        print()
    
    return scale_props


def rescale_splats(input_ply, output_ply, scale_multiplier):
    """Rescale the Gaussian splat scale values."""
    print(f"\n{'='*60}")
    print(f"Rescaling splats by {scale_multiplier}x")
    print(f"{'='*60}\n")
    
    ply = PlyData.read(input_ply)
    vertex_data = ply['vertex'].data.copy()
    
    # Find and rescale scale properties
    scale_props = [p for p in vertex_data.dtype.names if 'scale' in p.lower()]
    
    if not scale_props:
        print("❌ No scale properties found!")
        return False
    
    print(f"Rescaling properties: {scale_props}")
    
    for prop in scale_props:
        old_values = vertex_data[prop].copy()
        vertex_data[prop] = vertex_data[prop] * scale_multiplier
        
        print(f"\n{prop}:")
        print(f"  Before - Mean: {np.mean(old_values):.6f}, Range: [{np.min(old_values):.6f}, {np.max(old_values):.6f}]")
        print(f"  After  - Mean: {np.mean(vertex_data[prop]):.6f}, Range: [{np.min(vertex_data[prop]):.6f}, {np.max(vertex_data[prop]):.6f}]")
    
    # Create new PLY with rescaled data
    new_vertex = PlyElement.describe(vertex_data, 'vertex')
    new_ply = PlyData([new_vertex], text=ply.text)
    
    # Write output
    output_path = Path(output_ply)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    new_ply.write(output_path)
    
    print(f"\n✓ Rescaled PLY written to: {output_path}")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Inspect and optionally rescale Gaussian splat scales"
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Input PLY file"
    )
    parser.add_argument(
        "--output",
        help="Output PLY file (required if rescaling)"
    )
    parser.add_argument(
        "--scale-multiplier",
        type=float,
        help="Multiply all scale values by this factor (e.g., 100 to make splats 100x larger)"
    )
    
    args = parser.parse_args()
    
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"❌ ERROR: Input file not found: {input_path}")
        return 1
    
    # Always inspect first
    scale_props = inspect_splat_scales(input_path)
    
    if scale_props is None:
        return 1
    
    # Rescale if requested
    if args.scale_multiplier is not None:
        if args.output is None:
            print("\n❌ ERROR: --output is required when using --scale-multiplier")
            return 1
        
        if not rescale_splats(input_path, args.output, args.scale_multiplier):
            return 1
        
        print("\n" + "="*60)
        print("RECOMMENDATION:")
        print("="*60)
        print("Now regenerate your 3D Tiles with the rescaled PLY:")
        print(f"  python test_pipeline.py --input {args.output} --lat 37.7694 --lon -122.4862")
    else:
        print("\n" + "="*60)
        print("RECOMMENDATION:")
        print("="*60)
        print("If scales are too small (< 0.001 relative to scene), rescale with:")
        print(f"  python {Path(__file__).name} --input {args.input} --output rescaled.ply --scale-multiplier 100")
    
    return 0


if __name__ == "__main__":
    exit(main())

