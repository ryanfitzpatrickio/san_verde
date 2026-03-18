# San Verde Bake Pipeline

## Goal

Bring the default `san_verde` runtime under 100 draw calls in dense downtown views by replacing per-building runtime assembly with baked chunk assets.

## Runtime Modes

- `san_verde`: performance-first mode. Uses baked chunk assets when available and procedural fallback otherwise.
- `san_verde_glb`: showcase mode. Keeps the expensive authoring-grade building path for visual comparison and validation.

## Source Of Truth

The source of truth for bake layout is `src/game/san-verde-map.json`.

The map must carry a `bake` block:

```json
{
  "bake": {
    "version": 1,
    "chunkSize": 800,
    "detailRadius": 900,
    "massRadius": 2200,
    "defaultStageMode": "procedural_only",
    "detailAssetMode": "chunk_baked",
    "midAssetMode": "chunk_baked",
    "farAssetMode": "skyline_merged"
  }
}
```

These values are edited in `san-verde-editor.html` and consumed by the stage loader.

## Chunk Contract

- Chunk coordinates use `Math.floor(world / chunkSize)` for both `x` and `z`.
- A chunk key is `"<cx>,<cz>"`.
- Every baked runtime asset must align to this chunk grid.
- Changing `chunkSize` invalidates all baked outputs.

## Asset Tiers

### Detail Tier

- Scope: active downtown / near-player chunks.
- Input: resolved plot placements from the editor map.
- Output: one baked chunk asset per chunk, merged by material.
- Budget target: `<= 40` draw calls per visible detail chunk.

### Mid Tier

- Scope: visible non-detail chunks inside `massRadius`.
- Output: one simplified baked chunk asset per chunk, merged by material.
- Budget target: `<= 4` draw calls per visible mid chunk.

### Far Tier

- Scope: always-on distant city silhouette.
- Output: merged skyline or district proxy assets.
- Budget target: `<= 3` draw calls total.

## Dynamic Systems Excluded From Bake

- navmesh generation and debug
- NPC traffic
- trees
- clouds
- player vehicle and characters
- runtime atmosphere / lighting

## Performance Budgets

- Dense downtown camera: `< 100` total draw calls.
- Default `san_verde` hot detail chunk: `< 40` draws.
- Two visible detail chunks plus supporting systems should still fit under total budget.

## Recommended Bake Outputs

Under a future directory such as `public/data/san-verde-baked/`:

- `manifest.json`
- `chunks/detail/<cx>,<cz>.glb`
- `chunks/mid/<cx>,<cz>.glb`
- `skyline.glb`

Optional metadata:

- per-chunk bounds
- source plot ids
- bake version
- source map hash

## Script Sequence

1. Resolve deterministic plot/building assignments from `san-verde-map.json`.
2. Build per-plot authoring meshes offline.
3. Merge plot meshes into per-chunk detail assets by material.
4. Generate simplified mid-tier chunk assets.
5. Generate skyline/far asset.
6. Emit a manifest keyed by chunk coordinate and bake version.

## Validation

- Runtime chunk coordinates must match editor/exported chunk coordinates.
- Chunk asset bounds must stay inside their owning chunk.
- Visual parity is validated against `san_verde_glb`.
- Performance validation is done with the existing `SV:` perf overlay categories.
