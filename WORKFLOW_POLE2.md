# Pole2 Dataset - Real GPS Georeferencing Workflow

## 📍 Dataset Information

**Location**: Central North Carolina, USA  
**Coordinates**: 35.780537°N, 78.656525°W  
**Altitude**: 112.98 m  
**Scene Size**: ~23 meters (max extent)  
**Images**: 81 iPhone photos with GPS EXIF data  
**Path**: `data/360_v2/Pole2/Pole2/`

---

## ✅ Step 1: GPS Extraction (COMPLETED)

```bash
docker-compose run --rm splat-local python3 /app/scripts/extract_gps_from_images.py \
  --images /workspace/data/360_v2/Pole2/Pole2/ \
  --output /workspace/outputs/pole2_gps_data.json
```

**Result**: ✓ All 81 images have GPS data  
**Output**: `local-data/outputs/pole2_gps_data.json`

---

## ✅ Step 2: Create Georeferencing Transform (COMPLETED)

```bash
docker-compose run --rm splat-local python3 /app/scripts/create_georef_from_gps.py \
  --gps-data /workspace/outputs/pole2_gps_data.json \
  --output /workspace/outputs/pole2_transform.json
```

**Result**: ✓ ECEF transform created with auto-estimated scale (11.56x)  
**Output**: `local-data/outputs/pole2_transform.json`

---

## 🎯 Step 3: Train Gaussian Splat

Now you need to train the Gaussian splat using Nerfstudio:

```bash
docker-compose run --rm splat-local ns-train splatfacto \
  --data /workspace/data/360_v2/Pole2/Pole2/ \
  --output-dir /workspace/outputs/pole2_training
```

**Expected Output**: `local-data/outputs/pole2_training/splatfacto/<timestamp>/splat.ply`

**Training Notes**:
- This will take 10-30 minutes depending on your GPU
- Nerfstudio will process images in local coordinates (no GPS needed)
- The viewer will be available at `http://localhost:7007`
- You can monitor training progress in the viewer

**Alternative**: If you want to use the Nerfstudio web UI:
1. Make sure the container is running: `docker-compose up -d`
2. Open `http://localhost:5001`
3. Upload the Pole2 images
4. Train via the web interface

---

## 🌍 Step 4: Convert to Georeferenced 3D Tiles

Once training is complete, convert the splat to georeferenced 3D Tiles:

```bash
# Replace <timestamp> with your actual training timestamp
docker-compose run --rm splat-local python3 /app/scripts/convert_to_spz_3dtiles.py \
  --input /workspace/outputs/pole2_training/splatfacto/<timestamp>/splat.ply \
  --output /workspace/outputs/pole2_geo_tiles/ \
  --transform /workspace/outputs/pole2_transform.json \
  --quality 7
```

**What this does**:
1. Reads the trained splat PLY file
2. Applies GPS-derived ECEF transform
3. Converts to SPZ format (93% compression)
4. Creates glTF with `KHR_gaussian_splatting_compression_spz_2` extension
5. Generates 3D Tiles `tileset.json`

**Output**: `local-data/outputs/pole2_geo_tiles/`
- `tileset.json` - 3D Tiles metadata
- `tile_0_spz.gltf` - Georeferenced Gaussian splat

---

## 🗺️ Step 5: View in CesiumJS

1. Make sure the server is running:
   ```bash
   docker-compose up -d
   ```

2. Open the CesiumJS viewer:
   ```
   http://localhost:5001/cesium
   ```

3. Load the tileset:
   - Tileset URL: `/outputs/pole2_geo_tiles/tileset.json`
   - Location: `35.780537, -78.656525` (auto-filled from transform)
   - Click "Load 3D Tiles"
   - Click "Zoom to Tileset"

4. **Expected Result**: 
   - Gaussian splat appears at the **real GPS location** in Central NC
   - Proper splatting effect (soft ellipsoids, not points)
   - Console shows: `Tile content type: GaussianSplat3DTileContent` ✓

---

## 🔧 Troubleshooting

### If the splat is too small or too large:

Adjust the scale factor:

```bash
docker-compose run --rm splat-local python3 /app/scripts/update_tileset_scale.py \
  --tileset /workspace/outputs/pole2_geo_tiles/tileset.json \
  --scale 50
```

Then reload the page in CesiumJS (Ctrl+Shift+R).

**Scale Guidelines**:
- Current auto-estimate: 11.56x (based on 23m scene)
- If too small: Try 50x or 100x
- If too large: Try 5x or 10x

---

### If the location is wrong:

Verify the GPS data:

```bash
docker-compose run --rm splat-local python3 -c "import json; data = json.load(open('/workspace/outputs/pole2_gps_data.json')); print('Centroid:', data['centroid']); print('Bounds:', data['bounds'])"
```

You can manually adjust the transform:

```bash
docker-compose run --rm splat-local python3 /app/scripts/create_georef_from_gps.py \
  --gps-data /workspace/outputs/pole2_gps_data.json \
  --output /workspace/outputs/pole2_transform.json \
  --scale 50 \
  --height-offset 10
```

Then re-run Step 4 to regenerate the 3D Tiles.

---

## 📊 Expected Results

**GPS Coordinates**: 35.780537°N, 78.656525°W (Central NC)  
**Scene**: ~23 meter pole/structure captured with iPhone  
**Splat Size**: ~7,000-15,000 Gaussians (estimated based on 81 images)  
**File Size**: 
- Original PLY: ~1-3 MB
- SPZ compressed: ~100-300 KB (93% reduction)
- Total 3D Tiles: ~150-350 KB

**Rendering**: Real-time Gaussian splats in CesiumJS on a 3D globe at the actual GPS location!

---

## 🎉 Success Criteria

- ✅ GPS extracted from all 81 images
- ✅ ECEF transform created with proper scale
- ⏳ Gaussian splat trained (you need to do this)
- ⏳ 3D Tiles created with SPZ compression
- ⏳ Splat renders in CesiumJS at correct GPS location
- ⏳ Proper splatting effect (not just points)

---

## 🚀 Next Steps After Success

1. **Try other datasets**: Repeat for bicycle, bonsai, etc. if they have GPS
2. **Optimize scale**: Fine-tune the scale factor for best visualization
3. **Multiple scenes**: Load multiple georeferenced splats in one viewer
4. **Share**: Export the 3D Tiles and share the link
5. **Production**: Deploy to a real server with proper hosting

---

## 📝 Notes

- **Training time**: 10-30 minutes depending on GPU and image count
- **No Nerfstudio modifications needed**: We georeference after training
- **Scale is critical**: The auto-estimate (11.56x) is a starting point, you may need to adjust
- **iPhone GPS accuracy**: ±5-10 meters typical, good enough for visualization
- **Altitude**: GPS altitude is relative to WGS84 ellipsoid, not sea level (but close enough)

---

## 🔗 Related Files

- GPS data: `local-data/outputs/pole2_gps_data.json`
- Transform: `local-data/outputs/pole2_transform.json`
- Scripts:
  - `scripts/extract_gps_from_images.py`
  - `scripts/create_georef_from_gps.py`
  - `scripts/convert_to_spz_3dtiles.py`
  - `scripts/update_tileset_scale.py`
- Documentation: `CLAUDE.md`

---

**Last Updated**: November 21, 2024  
**Status**: Ready for training! 🎯

