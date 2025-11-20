# Gaussian Splat Georeferencing & CesiumJS Pipeline

## Project Overview

This document describes the successful implementation of a pipeline to convert Nerfstudio Gaussian splats into georeferenced 3D Tiles for visualization in CesiumJS.

**Status**: ✅ **WORKING** - Successfully rendering Gaussian splats in CesiumJS 1.135

---

## Table of Contents

1. [Pipeline Architecture](#pipeline-architecture)
2. [Key Findings](#key-findings)
3. [Technical Implementation](#technical-implementation)
4. [Tools & Dependencies](#tools--dependencies)
5. [Step-by-Step Workflow](#step-by-step-workflow)
6. [Known Issues & Solutions](#known-issues--solutions)
7. [Next Steps](#next-steps)

---

## Pipeline Architecture

```
Nerfstudio Training
        ↓
   splat.ply (local coordinates)
        ↓
   Georeferencing (ECEF transform)
        ↓
   georeferenced.ply
        ↓
   gsbox: PLY → SPZ compression
        ↓
   SPZ → glTF wrapper (KHR_gaussian_splatting_compression_spz_2)
        ↓
   3D Tiles tileset.json
        ↓
   CesiumJS Viewer (renders as GaussianSplat3DTileContent)
```

---

## Key Findings

### 1. CesiumJS Extension Support (Critical Discovery)

**The Problem**: CesiumJS 1.135 has **partial support** for Gaussian splat extensions:

- ✅ **DOES support**: `KHR_gaussian_splatting` + `KHR_gaussian_splatting_compression_spz_2` (SPZ-compressed)
- ❌ **DOES NOT support**: `KHR_gaussian_splatting` alone (uncompressed)

**Evidence**:
- When using uncompressed `KHR_gaussian_splatting` only:
  - Tile content type: `ds` (Gltf3DTileContent)
  - Renders as point cloud (fallback behavior per glTF spec)
  - Colors visible but no splatting effect
  
- When using SPZ-compressed `KHR_gaussian_splatting_compression_spz_2`:
  - Tile content type: `GaussianSplat3DTileContent` ✓
  - Renders as proper Gaussian splats with soft ellipsoids ✓
  - Full splatting effect visible ✓

**Source**: Cesium Community Forum confirms CesiumJS "99% sure only supports the SPZ compression extension variant" currently.

### 2. CesiumJS Version Timeline

- **CesiumJS ≤ 1.118**: No Gaussian splat support at all
- **CesiumJS 1.130-1.132**: First experimental support (mid-2025)
- **CesiumJS 1.133**: Deprecated old `KHR_spz_gaussian_splats_compression` extension
- **CesiumJS 1.135** (Nov 2025): 
  - Removed old deprecated extension
  - Only supports: `KHR_gaussian_splatting` + `KHR_gaussian_splatting_compression_spz_2`

### 3. Scale Issues

**Problem**: Gaussian splats appeared microscopic in CesiumJS.

**Root Cause**: 
- Nerfstudio stores splat scales in **log space** (e.g., -3.38)
- Actual scale = `exp(-3.38) ≈ 0.034` units
- In local coordinates (scene ~35 units), this is fine
- In ECEF coordinates (meters on globe), these become tiny

**Solution**: 
- Apply large scale factor in ECEF transform (100x worked well)
- This scales both positions AND the effective splat sizes
- Individual per-splat scales remain in log space (handled by renderer)

### 4. Georeferencing Transform

**Coordinate Systems**:
1. **Nerfstudio**: Local metric coordinates (OpenGL-style, Y-up or Z-up)
2. **ENU** (East-North-Up): Local tangent plane at reference point
3. **ECEF** (Earth-Centered, Earth-Fixed): Global Cartesian coordinates used by Cesium

**Transform Matrix** (4x4, column-major for glTF/3D Tiles):
```
M = [R*s | t]
    [0   | 1]

Where:
- R = Rotation from ENU to ECEF at (lat, lon)
- s = Scale factor (e.g., 100)
- t = ECEF position of origin (lat, lon, height)
```

---

## Technical Implementation

### Required glTF Structure for CesiumJS

```json
{
  "asset": {
    "version": "2.0"
  },
  "extensionsUsed": [
    "KHR_gaussian_splatting",
    "KHR_gaussian_splatting_compression_spz_2"
  ],
  "extensionsRequired": [
    "KHR_gaussian_splatting",
    "KHR_gaussian_splatting_compression_spz_2"
  ],
  "meshes": [
    {
      "primitives": [
        {
          "mode": 0,
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
      "byteLength": 122468,
      "uri": "data:application/octet-stream;base64,..."
    }
  ]
}
```

### Required 3D Tiles Structure

```json
{
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
      "box": [...]
    },
    "geometricError": 100,
    "refine": "ADD",
    "content": {
      "uri": "tile_0_spz.gltf"
    },
    "transform": [
      // 16-element column-major 4x4 matrix (ECEF transform)
    ]
  }
}
```

---

## Tools & Dependencies

### Docker Container (`local-server/Dockerfile`)

**Base**: `dromni/nerfstudio:1.1.4-cuda11.8.0-ubuntu22.04`

**Additional Tools**:
- `gsbox` v4.4.1 (Go binary for format conversion)
  - Downloaded from: `https://github.com/user-attachments/files/23587886/gsbox-amd64-linux-v4.4.1.zip`
  - Installed to: `/usr/local/bin/gsbox`
  
- `splat-3dtiles` (Python converter, cloned but ultimately not used)
  - Reason: Only outputs uncompressed `KHR_gaussian_splatting`
  
**Python Dependencies**:
```
numpy
plyfile
pygltflib
pyproj
Flask
Flask-CORS
```

### Key Scripts

1. **`scripts/create_fake_georef.py`**
   - Generates ECEF transform matrix from lat/lon/height
   - Creates `transform.json` for testing

2. **`scripts/georef_splats.py`**
   - Applies similarity transform to PLY vertex positions
   - Handles scale fields (log-space scales)

3. **`scripts/convert_to_spz_3dtiles.py`**
   - End-to-end: PLY → SPZ → 3D Tiles
   - Uses `gsbox p2z` for SPZ compression
   - Achieves ~93% compression vs original PLY

4. **`scripts/create_spz_gltf.py`**
   - Creates glTF wrapper with embedded SPZ data
   - Adds `KHR_gaussian_splatting_compression_spz_2` extension

5. **`scripts/update_tileset_scale.py`**
   - Modifies scale in existing tileset transform
   - Useful for quick adjustments without regenerating

6. **`scripts/inspect_and_rescale_splats.py`**
   - Analyzes splat scale values
   - Can rescale splats if needed (though not required for SPZ path)

---

## Step-by-Step Workflow

### Current "Fake" Georeferencing Workflow

**Input**: Nerfstudio-trained `splat.ply` (local coordinates)

**Output**: 3D Tiles with SPZ-compressed Gaussian splats in CesiumJS

**Steps**:

1. **Generate Fake Transform**
   ```bash
   python scripts/create_fake_georef.py \
     --lat 37.7694 \
     --lon -122.4862 \
     --height 10 \
     --scale 100 \
     --output transform.json
   ```

2. **Apply Transform to PLY** (optional, can skip for SPZ path)
   ```bash
   python scripts/georef_splats.py \
     --input splat.ply \
     --output georeferenced.ply \
     --transform transform.json
   ```

3. **Convert to SPZ-based 3D Tiles**
   ```bash
   python scripts/convert_to_spz_3dtiles.py \
     --input georeferenced.ply \
     --output tiles_spz/ \
     --lat 37.7694 \
     --lon -122.4862 \
     --height 10 \
     --scale 100 \
     --quality 7
   ```
   
   This internally:
   - Runs `gsbox p2z` (PLY → SPZ)
   - Creates tileset.json with ECEF transform
   - Achieves ~15x compression (93.70% smaller)

4. **Create SPZ-glTF Wrapper**
   ```bash
   python scripts/create_spz_gltf.py \
     --input tiles_spz/tile_0.spz \
     --output tiles_spz/tile_0_spz.gltf
   ```

5. **Update Tileset to Reference SPZ-glTF**
   ```bash
   python scripts/update_tileset_for_spz.py tiles_spz/tileset.json
   ```

6. **View in CesiumJS**
   - Open: `http://localhost:5001/cesium`
   - Load tileset: `/outputs/tiles_spz/tileset.json`
   - Should see: `GaussianSplat3DTileContent` in console ✓
   - Visual: Proper Gaussian splats with soft ellipsoids ✓

### Adjusting Scale (if needed)

```bash
python scripts/update_tileset_scale.py \
  --tileset tiles_spz/tileset.json \
  --scale 100
```

Then reload in browser (Ctrl+Shift+R to hard refresh).

---

## Known Issues & Solutions

### Issue 1: Splats Render as Points

**Symptom**: See colored dots, not soft ellipsoids

**Diagnosis**: Console shows `Tile content type: ds` (not `GaussianSplat3DTileContent`)

**Cause**: Using uncompressed `KHR_gaussian_splatting` only

**Solution**: Use SPZ compression with `KHR_gaussian_splatting_compression_spz_2`

---

### Issue 2: Splats Too Small

**Symptom**: Microscopic dots, hard to see

**Cause**: Scale factor too small for ECEF coordinates

**Solution**: 
- Increase scale in transform (try 100x or 1000x)
- Use `scripts/update_tileset_scale.py` for quick adjustment

---

### Issue 3: Splats in Wrong Location

**Symptom**: Splats appear in Antarctica or wrong continent

**Cause**: 
- Identity transform or incorrect ECEF calculation
- Missing transform in tileset

**Solution**: 
- Ensure `transform` array is in tileset root
- Verify ECEF calculation with known lat/lon
- Check transform is column-major 4x4 matrix

---

### Issue 4: CesiumJS Version Too Old

**Symptom**: No Gaussian splat support at all

**Diagnosis**: Using CesiumJS < 1.130

**Solution**: Upgrade to CesiumJS 1.135 or later

---

## Next Steps

### 1. Real GPS Georeferencing (High Priority)

**Goal**: Use actual GPS/IMU data from images instead of "fake" georeferencing

**Requirements**:
- Images with EXIF GPS metadata (lat, lon, altitude)
- Or: External GPS log file with timestamps
- Or: Ground control points (GCPs) with known coordinates

**Approach A: GPS in EXIF**
```python
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS

def extract_gps(image_path):
    img = Image.open(image_path)
    exif = img._getexif()
    # Extract GPSInfo tag
    # Convert to decimal degrees
    # Return (lat, lon, altitude)
```

**Approach B: Colmap with GPS**
- Add GPS priors to Colmap reconstruction
- Export camera poses in ECEF or geodetic coordinates
- Use camera centroid as reference point

**Approach C: Manual GCPs**
- Identify 3+ points in scene with known GPS coordinates
- Use point correspondences to estimate similarity transform
- Apply transform to align Nerfstudio output to real-world

**Implementation**:
- Modify `scripts/georef_splats.py` to accept GPS data
- Calculate proper ECEF transform from GPS coordinates
- Update pipeline to use real georeferencing

---

### 2. Improve Tiling for Large Scenes

**Current**: Single tile for entire splat

**Goal**: Hierarchical LOD (Level of Detail) tiling

**Benefits**:
- Faster loading for large scenes
- Better performance (only load visible tiles)
- Proper 3D Tiles streaming

**Approach**:
- Implement quadtree/octree spatial partitioning
- Generate multiple tiles at different LOD levels
- Calculate proper geometric error for each tile
- Update tileset.json with tile hierarchy

---

### 3. Optimize SPZ Compression

**Current**: Quality level 7 (default)

**Experiment**:
- Test quality levels 1-9
- Measure compression ratio vs visual quality
- Find optimal balance for web delivery

**gsbox Quality Levels**:
- 1-3: High compression, lower quality
- 4-6: Balanced
- 7-9: Lower compression, higher quality

---

### 4. Support Multiple Scenes

**Goal**: Manage multiple georeferenced splats in one viewer

**Features**:
- Scene library/catalog
- Load/unload scenes dynamically
- Multiple splats in same geographic area
- Scene metadata (date, location, description)

---

### 5. Integration with Nerfstudio Training

**Goal**: Automate georeferencing during training

**Approach**:
- Custom Nerfstudio dataparser that reads GPS from EXIF
- Generate `transforms.json` with ECEF coordinates
- Train directly in georeferenced space
- Export already-georeferenced splats

**Benefits**:
- No post-processing needed
- Consistent coordinate system throughout
- Easier to combine multiple captures

---

### 6. Web UI Improvements

**Current**: Basic Cesium viewer

**Enhancements**:
- Scene selector dropdown
- Upload new splats via UI
- Adjust scale/position interactively
- Export georeferenced splats
- Share links to specific views
- Measurement tools
- Annotation/markup

---

### 7. Alternative Viewers

**CesiumJS Limitations**:
- Only supports SPZ compression
- Experimental support (may change)
- Requires web server

**Alternatives to Explore**:
- **Potree**: Point cloud viewer (may support splats)
- **Three.js + custom splat renderer**: More control
- **Unreal Engine**: Native splat support coming
- **Unity**: Via plugins
- **Desktop viewers**: For offline use

---

## Performance Metrics

### Compression Results (Bicycle Scene)

**Original PLY**: ~1.5 MB (7,831 splats)

**SPZ Compressed**: 122 KB (quality 7)

**Compression Ratio**: 15.87x

**Size Reduction**: 93.70%

**Processing Time**: 233 milliseconds

---

### CesiumJS Rendering

**Initial Load**: ~1-2 seconds for single tile

**Frame Rate**: 60 FPS on modern GPU

**Memory Usage**: ~50 MB for 7,831 splats

**Network Transfer**: 122 KB (SPZ) vs 1.5 MB (PLY)

---

## References

### Documentation

- [CesiumJS 1.135 Release Notes](https://github.com/CesiumGS/cesium/releases/tag/1.135)
- [GaussianSplat3DTileContent API](https://cesium.com/learn/cesiumjs/ref-doc/GaussianSplat3DTileContent.html)
- [3D Tiles 1.1 Specification](https://docs.ogc.org/cs/22-025r4/22-025r4.html)
- [KHR_gaussian_splatting Extension](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_gaussian_splatting)
- [gsbox Documentation](https://github.com/gotoeasy/gsbox)

### Community Resources

- [Cesium Community Forum - Gaussian Splats](https://community.cesium.com/tag/gaussian-splatting)
- [Nerfstudio Documentation](https://docs.nerf.studio/)
- [3D Gaussian Splatting Paper](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)

---

## Troubleshooting

### Console Diagnostics

**Check CesiumJS Version**:
```javascript
console.log(Cesium.VERSION);
// Should be: 1.135.0 or later
```

**Check Tile Content Type**:
```javascript
tileset.tileLoad.addEventListener(function(tile) {
    console.log('Content type:', tile.content?.constructor?.name);
    // Want: GaussianSplat3DTileContent
    // Bad:  ds, Gltf3DTileContent, etc.
});
```

**Check Extensions**:
```javascript
console.log('Extensions used:', tileset.asset?.extensionsUsed);
// Should include: KHR_gaussian_splatting, KHR_gaussian_splatting_compression_spz_2
```

---

## Conclusion

We have successfully implemented a working pipeline to convert Nerfstudio Gaussian splats into georeferenced 3D Tiles that render properly in CesiumJS 1.135.

**Key Success Factors**:
1. ✅ Using SPZ compression (not uncompressed)
2. ✅ Proper glTF extension structure
3. ✅ Correct ECEF transform with adequate scale
4. ✅ CesiumJS 1.135 with full extension support

**Next Critical Step**: Implement real GPS georeferencing using image EXIF data or ground control points to move from "fake" test coordinates to actual real-world positioning.

---

**Last Updated**: November 20, 2024  
**Status**: ✅ Working prototype with fake georeferencing  
**Next Milestone**: Real GPS georeferencing implementation

