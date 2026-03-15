# Cruise Vehicle Lab

WebGPU-first Three.js car viewer scaffold built with Vite and `three@0.183.2`.

## Quick start

```bash
npm install
npm run dev
```

## Default asset slots

- `public/models/car.glb`
- `public/models/car2.glb`
- `public/models/tire.glb`

The UI also lets you switch between the built-in car models or load local `.glb` files directly without moving them into `public/`.

## Tuning points

- Wheel placement, tire scale, and tire rotation live near the top of [src/main.js](/Users/personal/source/cruise/src/main.js).
- Draco and Basis transcoders are copied into `public/vendor/` during `npm install`.

## OSM roads

To replace the city road graph with downtown Toronto roads from OpenStreetMap:

```bash
npm run roads:toronto
```

That fetches drivable `highway` ways from Overpass and rewrites [src/game/city-road-graph.json](/Users/personal/source/cruise/src/game/city-road-graph.json) in the local meter-space format the city stage uses.
