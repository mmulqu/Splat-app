#!/usr/bin/env python3
"""
georef_splats.py

Usage:

  # Option A: known transform (scale s, rotation R, translation t)
  python georef_splats.py \
      --input point_cloud.ply \
      --output point_cloud_geo.ply \
      --transform-json transform.json

  # transform.json example:
  # {
  #   "scale": 1.0,
  #   "R": [[1,0,0],[0,1,0],[0,0,1]],
  #   "t": [0,0,0]
  # }

  # Option B: estimate similarity transform from correspondences
  python georef_splats.py \
      --input point_cloud.ply \
      --output point_cloud_geo.ply \
      --correspondences correspondences.json

  # correspondences.json example:
  # {
  #   "nerf": [[x1,y1,z1],[x2,y2,z2],...],
  #   "world": [[X1,Y1,Z1],[X2,Y2,Z2],...]
  # }
  # where "world" points are already in your ENU/world frame.
"""

import argparse
import json
import numpy as np
from plyfile import PlyData, PlyElement


def estimate_similarity_transform(P: np.ndarray, Q: np.ndarray):
    """
    Estimate similarity transform (scale s, rotation R, translation t)
    that maps P -> Q in least-squares sense, i.e. Q ≈ s * R * P + t.

    P, Q: (N,3) arrays
    Returns: s (float), R (3x3), t (3,)
    """
    if P.shape != Q.shape or P.shape[1] != 3:
        raise ValueError("P and Q must both be (N, 3) arrays")

    # Subtract centroids
    Pc = P - P.mean(axis=0)
    Qc = Q - Q.mean(axis=0)

    # Cross-covariance
    H = Pc.T @ Qc

    # SVD
    U, Svals, Vt = np.linalg.svd(H)
    R = Vt.T @ U.T

    # Fix improper rotation (reflection) if needed
    if np.linalg.det(R) < 0:
        Vt[-1, :] *= -1
        R = Vt.T @ U.T

    # Scale
    varP = (Pc ** 2).sum()
    s = Svals.sum() / varP

    # Translation
    t = Q.mean(axis=0) - s * (R @ P.mean(axis=0))

    return float(s), R, t


def load_transform_from_json(path: str):
    with open(path, "r") as f:
        data = json.load(f)

    s = float(data["scale"])
    R = np.array(data["R"], dtype=np.float64)
    t = np.array(data["t"], dtype=np.float64)

    if R.shape != (3, 3):
        raise ValueError("R in transform.json must be a 3x3 matrix")
    if t.shape != (3,):
        raise ValueError("t in transform.json must be length-3")

    return s, R, t


def load_transform_from_correspondences(path: str):
    """
    Expects JSON with:
      {
        "nerf":  [[x,y,z], ...],
        "world": [[X,Y,Z], ...]
      }
    where "world" points are already in your ENU/world frame.
    """
    with open(path, "r") as f:
        data = json.load(f)

    P = np.array(data["nerf"], dtype=np.float64)
    Q = np.array(data["world"], dtype=np.float64)

    if P.shape[0] < 3:
        raise ValueError("Need at least 3 point correspondences")

    return estimate_similarity_transform(P, Q)


def apply_similarity_to_ply(input_ply: str, output_ply: str, s: float, R: np.ndarray, t: np.ndarray):
    """
    Reads a Nerfstudio Gaussian PLY, applies:
        x' = s * R * x + t
    and scales any radius/scale fields by s as well.

    Writes out a new PLY.
    """
    ply = PlyData.read(input_ply)
    if "vertex" not in ply:
        raise ValueError("PLY has no 'vertex' element")

    vertex = ply["vertex"].data
    names = vertex.dtype.names

    # Positions
    if not all(n in names for n in ("x", "y", "z")):
        raise ValueError("PLY vertex must have x, y, z fields")

    pts = np.vstack([vertex["x"], vertex["y"], vertex["z"]]).T  # (N,3)
    pts_trans = (R @ pts.T).T * s + t  # (N,3)

    vertex["x"] = pts_trans[:, 0]
    vertex["y"] = pts_trans[:, 1]
    vertex["z"] = pts_trans[:, 2]

    # Scale Gaussian radii if present (field names vary, so we heuristically match)
    scale_like_fields = [
        name
        for name in names
        if name.lower().startswith("scale")
        or name.lower().startswith("radius")
    ]

    for name in scale_like_fields:
        vertex[name] = vertex[name] * s

    # Re-wrap into PlyElement and write
    new_vertex_el = PlyElement.describe(vertex, "vertex")
    new_ply = PlyData([new_vertex_el], text=ply.text)
    new_ply.write(output_ply)

    print(f"Written georeferenced PLY to: {output_ply}")
    print(f"Used scale={s}, R=\n{R}, t={t}")


def main():
    parser = argparse.ArgumentParser(description="Apply similarity transform to Nerfstudio Gaussian PLY.")
    parser.add_argument("--input", required=True, help="Input PLY (Nerfstudio Gaussian splats)")
    parser.add_argument("--output", required=True, help="Output PLY (georeferenced)")
    parser.add_argument(
        "--transform-json",
        help="JSON file with fields: scale (float), R (3x3), t (3,)",
    )
    parser.add_argument(
        "--correspondences",
        help="JSON file with fields: nerf [[x,y,z],...], world [[X,Y,Z],...]",
    )

    args = parser.parse_args()

    if args.correspondences:
        s, R, t = load_transform_from_correspondences(args.correspondences)
    elif args.transform_json:
        s, R, t = load_transform_from_json(args.transform_json)
    else:
        raise SystemExit("Provide either --transform-json or --correspondences")

    apply_similarity_to_ply(args.input, args.output, s, R, t)


if __name__ == "__main__":
    main()

