# Cesium 3D Tiles Pipeline for Gaussian Splats

This directory contains scripts for converting Nerfstudio Gaussian splats to georeferenced 3D Tiles for visualization in CesiumJS.

## Pipeline Overview

```
Nerfstudio PLY → Georeferenced PLY → SPZ → 3D Tiles → CesiumJS
```

## Scripts

### 1. `create_fake_georef.py`
Generates a fake georeference transform to place a model at a specific lat/lon.

```bash
python scripts/create_fake_georef.py \
  --lat 37.7694 \
  --lon -122.4862 \
  --output scripts/fake_transform.json
```

### 2. `georef_splats.py`
Applies a similarity transform to a PLY file to georeference it.

```bash
python scripts/georef_splats.py \
  --input point_cloud.ply \
  --output point_cloud_geo.ply \
  --transform-json scripts/fake_transform.json
```

### 3. `test_pipeline.py`
End-to-end test script that runs the full pipeline.

```bash
# Inside Docker container
docker-compose run --rm splat-local python3 /app/scripts/test_pipeline.py \
  --input /workspace/outputs/b25f1978-fefa-4a00-846b-d00f57ec9fa0/splat.ply \
  --lat 37.7694 \
  --lon -122.4862 \
  --output-dir /workspace/outputs/cesium_test
```

## Tools Used

- **gsbox** (v4.4.1): Format conversion for Gaussian splats (PLY ↔ SPZ ↔ SPLAT ↔ SPX)
- **splat-3dtiles**: Converts splat formats to OGC 3D Tiles 1.1
- **numpy, plyfile**: Python libraries for PLY manipulation

## Example Workflow

### Option A: Using the Test Script (Easiest)

```bash
docker-compose run --rm splat-local python3 /app/scripts/test_pipeline.py \
  --input /workspace/outputs/YOUR_PLY_FILE.ply \
  --lat YOUR_LATITUDE \
  --lon YOUR_LONGITUDE
```

### Option B: Manual Step-by-Step

1. **Generate a fake transform** (if you don't have GPS data):
   ```bash
   docker-compose run --rm splat-local python3 /app/scripts/create_fake_georef.py \
     --lat 37.7694 --lon -122.4862 \
     --output /workspace/outputs/transform.json
   ```

2. **Apply the transform to your PLY**:
   ```bash
   docker-compose run --rm splat-local python3 /app/scripts/georef_splats.py \
     --input /workspace/outputs/YOUR_FILE/splat.ply \
     --output /workspace/outputs/georef.ply \
     --transform-json /workspace/outputs/transform.json
   ```

3. **Convert to SPZ format**:
   ```bash
   docker-compose run --rm splat-local gsbox p2z \
     -i /workspace/outputs/georef.ply \
     -o /workspace/outputs/splat.spz \
     -q 7
   ```

4. **Convert to 3D Tiles**:
   ```bash
   docker-compose run --rm splat-local python3 /app/splat-3dtiles/splat_to_3dtiles_optimized.py \
     /workspace/outputs/splat.spz \
     /workspace/outputs/tiles
   ```

5. **Load in CesiumJS**:
   ```javascript
   const tileset = await Cesium.Cesium3DTileset.fromUrl('./tiles/tileset.json');
   viewer.scene.primitives.add(tileset);
   viewer.zoomTo(tileset);
   ```

## File Formats

- **PLY**: Standard 3D Gaussian Splatting format from Nerfstudio
- **SPZ**: Compressed splat format (Niantic's format)
- **SPX**: Advanced format with block compression and progressive loading
- **3D Tiles**: OGC standard for streaming 3D content

## Coordinate Systems

- **Nerfstudio**: Local metric frame (OpenGL convention: X right, Y up, Z back)
- **ENU**: East-North-Up local tangent plane
- **ECEF**: Earth-Centered, Earth-Fixed (used by Cesium)
- **Geodetic**: Latitude, Longitude, Height (WGS84)

## Notes

- The fake georeference places models at a specified lat/lon with identity transform
- For real georeferencing, you need GPS-tagged images or ground control points
- The `correspondences.json` approach allows you to specify point pairs for similarity transform estimation

## Requirements

All dependencies are installed in the Docker container. See `local-server/Dockerfile` for details.

