# LOD (Level of Detail) Plan for Building Catalogs

## Overview

This document outlines the plan for adding Level of Detail (LOD) support to the building catalog system, enabling higher quality assets at closer distances while maintaining performance.

## Current State

- Buildings are procedural from JSON (`pieces`, `roof`, `features`)
- All buildings render at single detail level
- No distance-based switching exists
- This current level becomes **LOD 0** (lowest quality, furthest distance)

## LOD Levels

| Level | Purpose | Distance | Detail |
|-------|---------|----------|--------|
| LOD 0 | Far buildings | 50m+ | Procedural boxes (current) |
| LOD 1 | Near buildings | 0-50m | GLB models or enhanced procedural |

## Catalog Schema Extension

Add optional `lod1` field to catalog entries (non-breaking, existing entries work unchanged):

```json
{
  "id": "bungalow_suburban",
  "districts": ["residential_low"],
  "weight": 4,
  "lot": { "frontage": [22, 32], "depth": [24, 36], "setback": [8, 14] },
  "palette": { "body": "#d8c5b2", "accent": "#f0e7dd", "roof": "#64473c", "glass": "#8ea4bb" },
  
  "pieces": [...],           // Existing - becomes LOD 0
  "roof": { ... },           // Existing - becomes LOD 0
  "features": { ... },       // Existing - becomes LOD 0
  
  "lod1": {
    "type": "glb",           // "glb" or "procedural"
    "model": "bungalow_detailed.glb"
  }
}
```

### LOD 1 Types

#### GLB Model
```json
"lod1": {
  "type": "glb",
  "model": "bungalow_detailed.glb"
}
```

#### Enhanced Procedural
```json
"lod1": {
  "type": "procedural",
  "pieces": [
    { "material": "body", "size": [12, 4.4, 14], "offset": [0, 2.2, 0] },
    { "material": "accent", "size": [2, 1, 2], "offset": [5, 4.5, 7] }
  ],
  "features": {
    "porch": { ... },
    "chimney": { ... },
    "window_frames": { ... }
  }
}
```

## Code Changes

### Files to Modify

| File | Change |
|------|--------|
| `src/game/bloomville-stage.js` | Wrap building meshes in `THREE.LOD`, load LOD 1 assets |
| `src/game/catalog-lod.js` (new) | LOD loading utilities, GLB caching, distance config |

### Building Generation Flow

```
loadCatalogEntry() 
  → createBuildingMesh(entry)          // LOD 0 (current procedural)
  → if entry.lod1 exists:
       if entry.lod1.type === "glb":
         loadGLBModel(entry.lod1.model) // LOD 1 (external model)
       else if entry.lod1.type === "procedural":
         createBuildingMesh(entry.lod1) // LOD 1 (enhanced procedural)
  → create THREE.LOD object
     .addLevel(lod1Mesh, 0)             // Near distance
     .addLevel(lod0Mesh, 50)            // Far distance
```

### Distance Configuration

```javascript
const LOD_CONFIG = {
  distances: {
    lod1: 0,    // Near: 0-50m
    lod0: 50    // Far: 50m+
  },
  // Adjust per-district if needed
  districts: {
    residential_low: { lod0: 60 },
    commercial_general: { lod0: 40 }
  }
};
```

## Asset Storage

```
public/
  models/
    lod1/                    # LOD 1 GLB models
      residential/
        bungalow_detailed.glb
        duplex_detailed.glb
      commercial/
        shop_detailed.glb
  textures/
    lod1/                    # LOD 1 specific textures (if needed)
```

## Migration Path

### Phase 1: Infrastructure
- [ ] Create `src/game/catalog-lod.js` with LOD utilities
- [ ] Modify `createBuildingFromEntry()` to return `THREE.LOD` objects
- [ ] Add GLB loading with caching for LOD 1
- [ ] Test with a single building

### Phase 2: Initial Content
- [ ] Create LOD 1 assets for 3-5 test buildings
- [ ] Add `lod1` field to those catalog entries
- [ ] Verify distance-based switching works

### Phase 3: Expansion
- [ ] Gradually add LOD 1 to more building types
- [ ] Tune distance thresholds based on performance
- [ ] Consider LOD 2 for hero buildings (optional future)

## Backward Compatibility

- Existing catalog entries without `lod1` field work unchanged (LOD 0 only)
- No changes required to existing catalog JSON files
- LOD 0 remains the default procedural generation

## Performance Considerations

- LOD 1 GLB models should be optimized (reasonable poly count)
- Use instancing where possible for repeated details
- Cache loaded GLB models to avoid duplicate loads
- Consider texture atlasing for LOD 1 models

## Open Questions

1. Distance threshold: Is 50m the right switch point?
2. Should LOD 1 models share textures with LOD 0 or use dedicated textures?
3. Per-district distance tuning needed?
