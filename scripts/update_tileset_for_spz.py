#!/usr/bin/env python3
import json
import sys

tileset_path = sys.argv[1]

with open(tileset_path, 'r') as f:
    tileset = json.load(f)

# Update to use the SPZ-compressed glTF
tileset['root']['content']['uri'] = 'tile_0_spz.gltf'

# Add extension declarations
tileset['extensionsUsed'] = ['3DTILES_content_gltf']

with open(tileset_path, 'w') as f:
    json.dump(tileset, f, indent=2)

print(f"✓ Updated {tileset_path} to use SPZ-compressed glTF")

