# Navigation System

## Decision

This project now uses a lane-graph navigation foundation for road-driven agents.

That is the right fit for:

- NPC cars
- sidewalk pedestrians
- stage-aware routing in `City Grid`
- streamed routing in `Bloomville`

It is a better match than a generic navmesh for the current game, because the
main movement spaces are roads, sidewalks, and intersections rather than large
free-walk environments.

## Current shape

The shared network lives in:

- `src/game/navigation-network.js`

Each stage can expose:

- `stage.agentNavigation`
- `stage.agentNavigationRevision`

Current stage adapters:

- `City Grid`: built from the imported road graph
- `Bloomville`: built from the streamed procedural street grid

The network currently supports two layers:

- `vehicle`
- `pedestrian`

And these core operations:

- nearest-node lookup
- A* routing
- random route generation
- route sampling by distance
- spawn point generation

## Why not a navmesh package first

Navmesh packages are useful when agents can move freely over arbitrary walkable
surfaces. That is not the main problem here yet.

For traffic and sidewalk pedestrians, we want:

- legal turns at intersections
- direction-aware roads
- sidewalk-specific paths
- predictable spawns
- streamed chunk-local routing

All of that is easier to control with an explicit lane graph.

## When to add a package

If we later need free-walk pedestrians in:

- plazas
- parks
- interiors
- alleys or open spaces not aligned to roads

then the package to evaluate first is a Recast-based navmesh integration for
Three.js, not as a replacement for the lane graph, but alongside it.

Recommended split:

- lane graph: cars + sidewalk routing
- navmesh: free-walk pedestrian spaces

## Next layering steps

1. Add an `agent-system` that consumes `stage.agentNavigation`.
2. Spawn parked/moving NPC cars from `vehicle` spawn points.
3. Spawn pedestrians from `pedestrian` spawn points.
4. Add simple intersection reservation / right-of-way rules.
5. Add traffic lights or stop-sign metadata per junction when needed.
