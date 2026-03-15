# Vehicle Intake

Put raw source assets here before they are promoted into the game runtime.

Recommended layout:

```text
assets-src/vehicles/<vehicle-id>/
  body.glb
  front-tire.glb
  rear-tire.glb
  notes.md
```

Runtime-ready vehicle manifests live in `src/assets/built-in-vehicles/*.json`.

Current workflow:

1. Copy raw files into `assets-src/vehicles/<vehicle-id>/`
2. Copy or export the cleaned runtime GLBs into `public/models/`
3. Create a manifest with:
   `npm run assets:vehicles:new -- --id <vehicle-id> --label "<Label>" --body /models/<file>.glb`
4. Rebuild the public registry with:
   `npm run assets:vehicles:build-registry`

The future asset manager UI should treat `src/assets/built-in-vehicles` as the editable source of truth and `public/data/vehicle-registry.json` as the browser-readable output.
