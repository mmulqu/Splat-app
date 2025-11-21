# GPS-Aware Gaussian Splat Pipeline

Complete workflow for creating georeferenced 3D Gaussian splats from iPhone/smartphone photos with GPS metadata.

---

## 🎯 Overview

This pipeline converts photos with GPS EXIF data into georeferenced 3D Gaussian splats that can be visualized on a CesiumJS globe at their real-world locations.

**Pipeline**: `GPS Photos → Nerfstudio Training → Georeferencing → SPZ Compression → 3D Tiles → CesiumJS`

---

## 📋 Quick Start

### 1. Extract GPS from Images

```bash
docker-compose run --rm splat-local python3 /app/scripts/extract_gps_from_images.py \
  --images /workspace/data/YOUR_DATASET/ \
  --output /workspace/outputs/gps_data.json
```

### 2. Create Georeferencing Transform

```bash
docker-compose run --rm splat-local python3 /app/scripts/create_georef_from_gps.py \
  --gps-data /workspace/outputs/gps_data.json \
  --output /workspace/outputs/transform.json
```

### 3. Train Gaussian Splat

```bash
docker-compose run --rm splat-local ns-train splatfacto \
  --data /workspace/data/YOUR_DATASET/ \
  --output-dir /workspace/outputs/training
```

### 4. Convert to Georeferenced 3D Tiles

```bash
docker-compose run --rm splat-local python3 /app/scripts/convert_to_spz_3dtiles.py \
  --input /workspace/outputs/training/splatfacto/<timestamp>/splat.ply \
  --output /workspace/outputs/geo_tiles/ \
  --transform /workspace/outputs/transform.json
```

### 5. View in CesiumJS

Open `http://localhost:5001/cesium` and load `/outputs/geo_tiles/tileset.json`

---

## 📁 Available Scripts

### `extract_gps_from_images.py`

Extracts GPS coordinates from image EXIF data.

**Input**: Directory of images (JPEG with GPS EXIF)  
**Output**: JSON file with GPS data, centroid, bounds, scene size

**Features**:
- Supports iPhone, Android, camera GPS
- Calculates scene centroid (average position)
- Estimates scene size in meters
- Reports images with/without GPS

**Example**:
```bash
python extract_gps_from_images.py \
  --images data/pole2/ \
  --output gps_data.json
```

---

### `create_georef_from_gps.py`

Creates ECEF georeferencing transform from GPS data.

**Input**: GPS data JSON (from `extract_gps_from_images.py`)  
**Output**: Transform JSON with ECEF matrix

**Features**:
- Auto-estimates scale from scene size
- Computes ENU → ECEF rotation
- Converts geodetic → ECEF coordinates
- Supports manual scale override

**Example**:
```bash
python create_georef_from_gps.py \
  --gps-data gps_data.json \
  --output transform.json \
  --scale 50  # Optional: override auto-estimate
```

---

### `convert_to_spz_3dtiles.py`

Converts PLY to georeferenced 3D Tiles with SPZ compression.

**Input**: Nerfstudio splat PLY + transform JSON  
**Output**: 3D Tiles directory with tileset.json and SPZ-compressed glTF

**Features**:
- SPZ compression (93% size reduction)
- Proper `KHR_gaussian_splatting_compression_spz_2` extension
- ECEF transform in tileset
- Quality control (1-9)

**Example**:
```bash
python convert_to_spz_3dtiles.py \
  --input splat.ply \
  --output tiles/ \
  --transform transform.json \
  --quality 7
```

---

### `update_tileset_scale.py`

Adjusts scale factor in existing tileset.

**Input**: Existing tileset.json  
**Output**: Updated tileset.json (in-place)

**Use case**: Quick scale adjustments without regenerating tiles

**Example**:
```bash
python update_tileset_scale.py \
  --tileset tiles/tileset.json \
  --scale 100
```

---

## 🔧 Requirements

### Python Dependencies

```
numpy
plyfile
Pillow  # For EXIF GPS extraction
```

Installed in Docker container automatically.

### External Tools

- **gsbox** (v4.4.1): PLY → SPZ conversion
- **Nerfstudio** (v1.1.4): Gaussian splat training
- **CesiumJS** (v1.135+): 3D globe viewer with Gaussian splat support

All included in the Docker container.

---

## 📊 Coordinate Systems

### 1. Nerfstudio Local Coordinates

- Arbitrary origin (usually scene center)
- Metric units (meters)
- Typically 1-10 unit scenes
- Y-up or Z-up (depends on dataparser)

### 2. Geodetic Coordinates (GPS)

- Latitude (degrees, -90 to +90)
- Longitude (degrees, -180 to +180)
- Altitude (meters above WGS84 ellipsoid)

### 3. ECEF (Earth-Centered, Earth-Fixed)

- Cartesian coordinates (X, Y, Z in meters)
- Origin at Earth's center
- Used by CesiumJS and 3D Tiles
- Large values (~6 million meters)

### 4. ENU (East-North-Up)

- Local tangent plane at GPS centroid
- East: +X, North: +Y, Up: +Z
- Bridge between Nerfstudio and ECEF

---

## 🧮 Transform Mathematics

The georeferencing transform is a **similarity transform**:

```
P_ecef = s * R * P_local + t
```

Where:
- `P_local`: Point in Nerfstudio coordinates
- `P_ecef`: Point in ECEF coordinates
- `s`: Uniform scale factor
- `R`: Rotation matrix (ENU → ECEF)
- `t`: Translation vector (ECEF position of origin)

**4x4 Matrix Form** (column-major for glTF/3D Tiles):

```
M = [R*s | t]
    [0   | 1]
```

---

## 📐 Scale Estimation

The auto-scale estimation assumes:

1. **Nerfstudio normalizes scenes** to ~2-3 units
2. **GPS gives real-world size** in meters
3. **Scale factor** ≈ `real_world_size / nerfstudio_size`

**Example**:
- GPS scene extent: 23 meters
- Nerfstudio scene: ~2 units
- Estimated scale: 23 / 2 = 11.5x

**Note**: This is an estimate! You may need to adjust based on:
- Nerfstudio's actual normalization
- Desired visualization size
- CesiumJS rendering scale

---

## 🎨 SPZ Compression

**SPZ** (Splat Packed Z) is a compressed format for Gaussian splats:

- **Compression ratio**: ~15x (93% size reduction)
- **Quality levels**: 1-9 (higher = better quality)
- **Format**: Binary blob embedded in glTF
- **Extension**: `KHR_gaussian_splatting_compression_spz_2`

**Why SPZ?**
- CesiumJS 1.135 **only supports SPZ**, not uncompressed splats
- Faster loading and rendering
- Smaller file sizes for web delivery

---

## 🌍 CesiumJS Integration

### Supported Extensions

✅ `KHR_gaussian_splatting` + `KHR_gaussian_splatting_compression_spz_2`  
❌ `KHR_gaussian_splatting` alone (renders as point cloud)

### Rendering

- **Content Type**: `GaussianSplat3DTileContent` (good!)
- **Fallback**: `Gltf3DTileContent` with POINTS primitive (bad)

### Viewer Settings

```javascript
Cesium3DTileset.fromUrl(tilesetUrl, {
  pointCloudShading: {
    attenuation: true,
    geometricErrorScale: 1.0,
    maximumAttenuation: 10,
    baseResolution: 0.1
  }
});
```

---

## 🐛 Common Issues

### Issue: Splat is too small

**Solution**: Increase scale factor

```bash
python update_tileset_scale.py --tileset tileset.json --scale 100
```

---

### Issue: Splat renders as points, not splats

**Diagnosis**: Check console for `Tile content type: ds` (not `GaussianSplat3DTileContent`)

**Solution**: 
1. Ensure using SPZ compression (`convert_to_spz_3dtiles.py`)
2. Check CesiumJS version ≥ 1.135
3. Verify `extensionsUsed` in tileset.json

---

### Issue: Splat is in wrong location

**Solution**: Verify GPS data

```bash
# Check GPS centroid
cat local-data/outputs/gps_data.json | grep -A 3 "centroid"

# Regenerate transform with manual coordinates
python create_georef_from_gps.py \
  --gps-data gps_data.json \
  --output transform.json \
  --height-offset 10  # Adjust height if needed
```

---

### Issue: No GPS data in images

**Check**: Open image in photo viewer and check properties/metadata

**Solutions**:
1. Use different images with GPS
2. Use manual georeferencing (GCPs)
3. Use fake coordinates for testing

---

## 📚 Example Datasets

### Pole2 (Included)

- **Location**: Central NC, USA (35.78°N, 78.66°W)
- **Images**: 81 iPhone photos
- **Scene**: ~23 meter pole structure
- **GPS**: ✅ All images have GPS
- **Workflow**: See `WORKFLOW_POLE2.md`

### Bicycle (Included)

- **Location**: San Francisco, CA (37.77°N, 122.49°W)
- **Images**: 194 photos
- **Scene**: Toy car on bicycle
- **GPS**: ⚠ Check if available
- **Status**: Trained, used for testing

---

## 🚀 Advanced Usage

### Multiple Scenes

Load multiple georeferenced splats in one CesiumJS viewer:

```javascript
const tileset1 = await Cesium3DTileset.fromUrl('/outputs/scene1/tileset.json');
const tileset2 = await Cesium3DTileset.fromUrl('/outputs/scene2/tileset.json');
viewer.scene.primitives.add(tileset1);
viewer.scene.primitives.add(tileset2);
```

---

### Custom Scale

Override auto-estimated scale:

```bash
python create_georef_from_gps.py \
  --gps-data gps_data.json \
  --output transform.json \
  --scale 50  # Manual scale
```

---

### Height Adjustment

Adjust altitude (e.g., if GPS altitude is inaccurate):

```bash
python create_georef_from_gps.py \
  --gps-data gps_data.json \
  --output transform.json \
  --height-offset 10  # Add 10 meters to GPS altitude
```

---

### Quality Settings

Experiment with SPZ compression quality:

```bash
# Higher quality (larger file)
python convert_to_spz_3dtiles.py ... --quality 9

# Lower quality (smaller file)
python convert_to_spz_3dtiles.py ... --quality 3
```

---

## 📖 References

- **Nerfstudio**: https://docs.nerf.studio/
- **3D Gaussian Splatting**: https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/
- **CesiumJS**: https://cesium.com/learn/cesiumjs/
- **3D Tiles 1.1**: https://docs.ogc.org/cs/22-025r4/22-025r4.html
- **glTF Extensions**: https://github.com/KhronosGroup/glTF/tree/main/extensions
- **gsbox**: https://github.com/gotoeasy/gsbox

---

## 🎉 Success Story

We successfully created a complete pipeline that:

1. ✅ Extracts GPS from iPhone photos
2. ✅ Trains Gaussian splats with Nerfstudio
3. ✅ Georefences splats to real-world coordinates
4. ✅ Compresses to SPZ format (93% reduction)
5. ✅ Renders in CesiumJS with proper splatting effect

**Result**: Real-world Gaussian splats on a 3D globe! 🌍✨

---

**Last Updated**: November 21, 2024  
**Status**: Production-ready pipeline ✅

