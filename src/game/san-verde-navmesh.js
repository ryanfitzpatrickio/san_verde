import { init } from '@recast-navigation/core';
import { generateSoloNavMesh } from '@recast-navigation/generators';

let recastInitialized = false;

async function ensureRecastInit() {
  if (!recastInitialized) {
    await init();
    recastInitialized = true;
  }
}

/**
 * Builds recast navmeshes from the san verde road graph.
 * Each graph road has: { id, width, sidewalkWidth, points: THREE.Vector3[], ... }
 * Returns { vehicleNavMesh, pedestrianNavMesh }.
 */
export async function buildSanVerdeNpcNavmesh(roadGraph) {
  await ensureRecastInit();

  const roads = roadGraph.roads;
  if (!roads?.length) {
    console.warn('[san-verde-navmesh] no roads in graph');
    return null;
  }

  console.log(`[san-verde-navmesh] building from ${roads.length} roads`);

  // --- Vehicle navmesh ---
  const vehicleGeom = buildVehicleGeometry(roads);
  console.log(`[san-verde-navmesh] vehicle geometry: ${vehicleGeom.positions.length / 3} verts, ${vehicleGeom.indices.length / 3} tris`);

  const vehicleResult = generateSoloNavMesh(vehicleGeom.positions, vehicleGeom.indices, {
    cs: 4.0,
    ch: 0.2,
    walkableHeight: 2,
    walkableClimb: 2,
    walkableRadius: 0,
    maxEdgeLen: 40,
    maxSimplificationError: 2.0,
    minRegionArea: 8,
    mergeRegionArea: 40,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1
  });

  if (vehicleResult.success) {
    console.log('[san-verde-navmesh] vehicle navmesh ok');
  } else {
    console.warn('[san-verde-navmesh] vehicle navmesh failed:', vehicleResult.error);
  }

  // --- Pedestrian navmesh ---
  // Sidewalk ribbons are trimmed so they stop before any intersecting road.
  // This prevents recast from flood-filling the enclosed city blocks formed when
  // perpendicular sidewalk strips touch at corners.
  const pedGeom = buildPedestrianGeometry(roads);
  console.log(`[san-verde-navmesh] ped geometry: ${pedGeom.positions.length / 3} verts, ${pedGeom.indices.length / 3} tris`);

  const pedResult = generateSoloNavMesh(pedGeom.positions, pedGeom.indices, {
    cs: 2.5,
    ch: 0.2,
    walkableHeight: 2,
    walkableClimb: 2,
    walkableRadius: 0,
    maxEdgeLen: 20,
    maxSimplificationError: 1.0,
    minRegionArea: 4,
    mergeRegionArea: 20,
    maxVertsPerPoly: 6,
    detailSampleDist: 4,
    detailSampleMaxError: 1
  });

  if (pedResult.success) {
    console.log('[san-verde-navmesh] pedestrian navmesh ok');
  } else {
    console.warn('[san-verde-navmesh] pedestrian navmesh failed:', pedResult.error);
  }

  return {
    vehicleNavMesh: vehicleResult.success ? vehicleResult.navMesh : null,
    pedestrianNavMesh: pedResult.success ? pedResult.navMesh : null
  };
}

function buildVehicleGeometry(roads) {
  const allPositions = [];
  const allIndices = [];
  let offset = 0;

  for (const road of roads) {
    const halfWidth = (road.width || 18) * 0.5 - 0.5;
    const ribbon = buildRibbon(road.points, halfWidth, 0.01);
    for (const v of ribbon.vertices) allPositions.push(v[0], v[1], v[2]);
    for (const i of ribbon.indices) allIndices.push(i + offset);
    offset += ribbon.vertices.length;
  }

  return {
    positions: new Float32Array(allPositions),
    indices: new Int32Array(allIndices)
  };
}

function buildPedestrianGeometry(roads) {
  const allPositions = [];
  const allIndices = [];
  let offset = 0;

  function addRibbon(ribbon) {
    for (const v of ribbon.vertices) allPositions.push(v[0], v[1], v[2]);
    for (const i of ribbon.indices) allIndices.push(i + offset);
    offset += ribbon.vertices.length;
  }

  for (const road of roads) {
    const roadWidth = road.width || 18;
    // Min 7.5 so cs=2.5 gives at least 3 cells
    const swWidth = Math.max(7.5, road.sidewalkWidth || 5.2);
    const sideCenter = roadWidth * 0.5 + swWidth * 0.5;
    const sideHalf = swWidth * 0.5;

    // Resample at 6-unit intervals so roads with sparse control points (even just
    // 2 endpoints) have enough intermediate points to survive intersection trimming
    const pts = resamplePolyline(road.points, 6);

    // Mark each resampled point as safe (not inside another road's lane area).
    // Unsafe points are in an intersection zone — excluding them prevents the
    // sidewalk strips from forming closed loops that recast would flood-fill.
    const safe = pts.map(pt =>
      !roads.some(other => {
        if (other === road) return false;
        const threshold = (other.width || 18) * 0.5;
        return distToPolyline(pt, other.points) < threshold;
      })
    );

    // Emit a separate ribbon for each contiguous run of safe points
    for (const sign of [-1, 1]) {
      let segStart = -1;
      for (let i = 0; i <= pts.length; i++) {
        const inSeg = i < pts.length && safe[i];
        if (inSeg) {
          if (segStart === -1) segStart = i;
        } else {
          if (segStart !== -1 && i - segStart >= 2) {
            addRibbon(buildRibbon(pts.slice(segStart, i), sideHalf, 0.01, sign * sideCenter));
          }
          segStart = -1;
        }
      }
    }
  }

  return {
    positions: new Float32Array(allPositions),
    indices: new Int32Array(allIndices)
  };
}

/** Resample a polyline at uniform arc-length intervals. */
function resamplePolyline(points, step) {
  if (points.length < 2) return points.slice();
  const result = [{ x: points[0].x, y: 0, z: points[0].z }];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dz = points[i].z - points[i - 1].z;
    const segLen = Math.hypot(dx, dz);
    if (segLen < 1e-6) continue;
    let t = (step - carry) / segLen;
    while (t <= 1) {
      result.push({ x: points[i - 1].x + dx * t, y: 0, z: points[i - 1].z + dz * t });
      t += step / segLen;
    }
    carry = (1 - (t - step / segLen)) * segLen;
  }
  result.push({ x: points[points.length - 1].x, y: 0, z: points[points.length - 1].z });
  return result;
}

/** Minimum distance from point p to any segment of a polyline. */
function distToPolyline(p, points) {
  let minDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = distPointToSegment(p, points[i], points[i + 1]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function distPointToSegment(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.z - a.z);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/**
 * Build a flat ribbon mesh from road centerline points (THREE.Vector3[]).
 */
function buildRibbon(points, halfWidth, y, lateralOffset = 0) {
  const vertices = [];
  const indices = [];
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const t = getPointTangent(points, i);
    const nx = -t.z;
    const nz = t.x;

    const cx = points[i].x + nx * lateralOffset;
    const cz = points[i].z + nz * lateralOffset;

    vertices.push([cx - nx * halfWidth, y, cz - nz * halfWidth]);
    vertices.push([cx + nx * halfWidth, y, cz + nz * halfWidth]);
  }

  for (let i = 0; i < n - 1; i++) {
    const b = i * 2;
    indices.push(b, b + 1, b + 2);
    indices.push(b + 1, b + 3, b + 2);
  }

  return { vertices, indices };
}

function getPointTangent(points, i) {
  let dx = 0;
  let dz = 0;
  if (i > 0) {
    dx += points[i].x - points[i - 1].x;
    dz += points[i].z - points[i - 1].z;
  }
  if (i < points.length - 1) {
    dx += points[i + 1].x - points[i].x;
    dz += points[i + 1].z - points[i].z;
  }
  const len = Math.hypot(dx, dz);
  return len > 1e-6 ? { x: dx / len, z: dz / len } : { x: 1, z: 0 };
}
