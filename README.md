# San Verde

A WebGPU-powered open-world driving game built with Three.js. Cruise through procedurally generated cities, an OpenStreetMap-based urban environment, and an infinite highway — all running in the browser.

**Live demo:** https://ryanfitzpatrickio.github.io/san_verde/

> Requires Chrome or Edge (WebGPU). Firefox and Safari not supported.

---

## Features

- **WebGPU rendering** via Three.js 0.183.2 with TSL node materials
- **Realistic vehicle physics** — suspension, traction, RWD dynamics, torque curves
- **Multi-layer engine audio** — 6 sampled layers mixed dynamically by RPM and load
- **AI traffic** — autonomous vehicles and pedestrians with road graph pathfinding
- **Character system** — exit the car and explore on foot
- **Vehicle garage** — swap cars, tires, and tuning presets at runtime
- **Skid marks**, dust effects, and screen-space global illumination

---

## Worlds

| Stage | Description |
|---|---|
| **San Verde** | Large city built from 2d level editor using road data with procedural buildings |
| **Test Course** | Sandbox arena with ramps, cones, and suspension test features |

---

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173

Production builds default to the GitHub Pages base path `/san_verde/`. Override that with `VITE_BASE_PATH=/your-base/ npm run build` when deploying elsewhere.

### Drop in your own models

Drag any `.glb` file into the viewport to swap the car or tires at runtime. Built-in vehicles live in `src/assets/built-in-vehicles/` as JSON manifests pointing to models in `public/models/`.

---

## Scripts

```bash
npm run dev                          # Dev server
npm run build                        # Full production build
npm run build:game                   # Game-only build (no editor pages)
npm run preview                      # Preview production build

npm run assets:vehicles:new          # Create a new vehicle manifest
npm run assets:vehicles:build-registry  # Rebuild vehicle registry JSON
```

---

## Project Structure

```
src/
├── app-shell.js          # Config, UI markup, initial state
├── engine-system.js      # Engine audio, torque curves, transmission
├── player-system.js      # Player/character integration
├── game/
│   ├── runtime.js        # Game loop, physics, camera
│   ├── stages.js         # Stage definitions and factory
│   ├── san-verde-stage.js
│   ├── bloomville-stage.js
│   ├── agent-system.js   # AI traffic and pedestrians
│   ├── autopilot.js      # Autonomous driving / pathfinding
│   └── bounce-physics.js # Vehicle physics integration
├── vehicles/
│   ├── car-vehicle.js
│   ├── bike-vehicle.js
│   └── vehicle-manager.js
└── assets/
    ├── vehicle-registry.js
    └── asset-base-url.js # Resolves public vs bucket URLs
```

---

## Asset Pipeline

Bucket-backed production assets are resolved through `VITE_ASSETS_BASE_URL` for `public/models/`, `public/textures/`, and `public/full textures/`. Other committed public assets, including `public/animations/`, continue to load from the app's own public base.

```bash
# Vehicle manifests
src/assets/built-in-vehicles/*.json

# Models (gitignored, serve from public/models/ locally)
public/models/*.glb
public/models/*.fbx

# Textures (committed)
public/textures/
public/full textures/
```

### Adding a vehicle

```bash
npm run assets:vehicles:new
```

Follow the prompts, then drop the `.glb` into `public/models/` and rebuild the registry:

```bash
npm run assets:vehicles:build-registry
```

---

## Quick Deploy
Git Push
```
npm run assets:optimize
gsutil -m cp -r web-assets/models gs://sanverde_assets/public/
gsutil -m cp -r web-assets/textures gs://sanverde_assets/public/
gsutil -m cp -r "web-assets/full textures" gs://sanverde_assets/public/
gsutil -m cp -r web-assets/models/buildings gs://sanverde_assets/public/models/
```

Targeted San Verde building upload:
```bash
npm run assets:optimize:buildings
gsutil -m cp web-assets/models/buildings/bungalow_urban.glb gs://sanverde_assets/public/models/buildings/
gsutil -m cp web-assets/models/buildings/townhouse_single.glb gs://sanverde_assets/public/models/buildings/
```

---

## Tech Stack

- [Three.js](https://threejs.org/) 0.183.2 (WebGPU renderer)
- [Vite](https://vitejs.dev/) 7
- [Solid.js](https://www.solidjs.com/) — UI
- [@perplexdotgg/bounce](https://www.npmjs.com/package/@perplexdotgg/bounce) — physics
- [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) — CSG operations
