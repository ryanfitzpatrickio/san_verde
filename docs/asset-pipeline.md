# Asset Pipeline

## Vehicles

Vehicle assets now use a file-backed manifest pipeline.

Source of truth:

- Raw intake: `assets-src/vehicles/`
- Runtime manifests: `src/assets/built-in-vehicles/*.json`
- Browser-readable registry: `public/data/vehicle-registry.json`
- Runtime loader: `src/assets/vehicle-registry.js`

Manifest shape:

```json
{
  "id": "mustang",
  "order": 10,
  "label": "Mustang",
  "kind": "car",
  "body": {
    "url": "/models/mustang.glb",
    "sourceLabel": "public/models/mustang.glb"
  },
  "tires": {
    "front": {
      "url": "/models/fronttire.glb",
      "sourceLabel": "public/models/fronttire.glb"
    },
    "rear": {
      "url": "/models/widetire.glb",
      "sourceLabel": "public/models/widetire.glb"
    }
  },
  "preset": {
    "exposure": 1.15,
    "environmentIntensity": 1.2,
    "tireScale": 0.93,
    "frontAxleRatio": 0.18,
    "rearAxleRatio": 0.245,
    "rideHeight": 0.105,
    "chassisHeight": 0.11,
    "sideInset": 0.07,
    "tireRotation": [0, 3.141592653589793, 0]
  }
}
```

## Scripts

- `npm run assets:vehicles:new -- --id <id> --label "<Label>" --body /models/<body>.glb`
  Creates a new vehicle manifest scaffold.
- `npm run assets:vehicles:build-registry`
  Validates manifests and writes `public/data/vehicle-registry.json`.

## Why this exists

- Runtime no longer depends on a hardcoded vehicle list in app shell state.
- A future Solid.js asset manager can edit manifest files and preview the generated public registry.
- The browser can fetch one stable registry file instead of crawling the filesystem.
