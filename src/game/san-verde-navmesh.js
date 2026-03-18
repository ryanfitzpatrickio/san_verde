import { generateSoloNavMesh } from 'navcat/blocks';

/**
 * Builds navcat navmeshes from the San Verde road graph.
 * Each graph road has: { id, width, sidewalkWidth, points: THREE.Vector3[], ... }
 * Returns { vehicleNavMesh, pedestrianNavMesh }.
 */
export async function buildSanVerdeNpcNavmesh(roadGraph) {
  const roads = roadGraph.roads;
  if (!roads?.length) {
    console.warn('[san-verde-navmesh] no roads in graph');
    return null;
  }

  console.log(`[san-verde-navmesh] building from ${roads.length} roads`);

  const vehicleNavMesh = buildNavMesh(
    'vehicle',
    buildVehicleGeometry(roads),
    createSoloOptions({
      cellSize: 4.0,
      cellHeight: 0.2,
      walkableHeightWorld: 2.0,
      walkableClimbWorld: 2.0,
      walkableRadiusWorld: 0.0,
      maxEdgeLength: 40,
      maxSimplificationError: 2.0,
      minRegionArea: 8,
      mergeRegionArea: 40,
      maxVerticesPerPoly: 6,
      detailSampleDistance: 6,
      detailSampleMaxError: 1
    })
  );

  const pedestrianNavMesh = buildNavMesh(
    'pedestrian',
    buildPedestrianGeometry(roads),
    createSoloOptions({
      cellSize: 2.5,
      cellHeight: 0.2,
      walkableHeightWorld: 2.0,
      walkableClimbWorld: 2.0,
      walkableRadiusWorld: 0.0,
      maxEdgeLength: 20,
      maxSimplificationError: 1.0,
      minRegionArea: 4,
      mergeRegionArea: 20,
      maxVerticesPerPoly: 6,
      detailSampleDistance: 4,
      detailSampleMaxError: 1
    })
  );

  return {
    vehicleNavMesh,
    pedestrianNavMesh
  };
}

function buildNavMesh(label, geometry, options) {
  console.log(
    `[san-verde-navmesh] ${label} geometry: ${geometry.positions.length / 3} verts, ${geometry.indices.length / 3} tris`
  );

  if (geometry.positions.length === 0 || geometry.indices.length === 0) {
    console.warn(`[san-verde-navmesh] ${label} navmesh skipped: empty geometry`);
    return null;
  }

  try {
    const result = generateSoloNavMesh(geometry, options);
    console.log(`[san-verde-navmesh] ${label} navmesh ok`);
    return result.navMesh;
  } catch (error) {
    console.warn(`[san-verde-navmesh] ${label} navmesh failed:`, error);
    return null;
  }
}

function createSoloOptions({
  cellSize,
  cellHeight,
  walkableHeightWorld,
  walkableClimbWorld,
  walkableRadiusWorld,
  maxEdgeLength,
  maxSimplificationError,
  minRegionArea,
  mergeRegionArea,
  maxVerticesPerPoly,
  detailSampleDistance,
  detailSampleMaxError
}) {
  return {
    cellSize,
    cellHeight,
    walkableRadiusWorld,
    walkableRadiusVoxels: Math.ceil(walkableRadiusWorld / cellSize),
    walkableClimbWorld,
    walkableClimbVoxels: Math.ceil(walkableClimbWorld / cellHeight),
    walkableHeightWorld,
    walkableHeightVoxels: Math.ceil(walkableHeightWorld / cellHeight),
    walkableSlopeAngleDegrees: 45,
    borderSize: 0,
    minRegionArea,
    mergeRegionArea,
    maxSimplificationError,
    maxEdgeLength,
    maxVerticesPerPoly,
    detailSampleDistance,
    detailSampleMaxError
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
    const sidewalkWidth = Math.max(7.5, road.sidewalkWidth || 5.2);
    const sideCenter = roadWidth * 0.5 + sidewalkWidth * 0.5;
    const sideHalf = sidewalkWidth * 0.5;
    const points = resamplePolyline(road.points, 6);

    const safe = points.map((point) =>
      !roads.some((other) => {
        if (other === road) return false;
        const threshold = (other.width || 18) * 0.5;
        return distToPolyline(point, other.points) < threshold;
      })
    );

    for (const sign of [-1, 1]) {
      let segmentStart = -1;
      for (let i = 0; i <= points.length; i++) {
        const inSegment = i < points.length && safe[i];
        if (inSegment) {
          if (segmentStart === -1) segmentStart = i;
        } else {
          if (segmentStart !== -1 && i - segmentStart >= 2) {
            addRibbon(buildRibbon(points.slice(segmentStart, i), sideHalf, 0.01, sign * sideCenter));
          }
          segmentStart = -1;
        }
      }
    }
  }

  return {
    positions: new Float32Array(allPositions),
    indices: new Int32Array(allIndices)
  };
}

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

function distToPolyline(point, points) {
  let minDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const dist = distPointToSegment(point, points[i], points[i + 1]);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

function distPointToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return Math.hypot(point.x - a.x, point.z - a.z);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lenSq));
  return Math.hypot(point.x - (a.x + t * dx), point.z - (a.z + t * dz));
}

function buildRibbon(points, halfWidth, y, lateralOffset = 0) {
  const vertices = [];
  const indices = [];
  const count = points.length;

  for (let i = 0; i < count; i++) {
    const tangent = getPointTangent(points, i);
    const nx = -tangent.z;
    const nz = tangent.x;

    const cx = points[i].x + nx * lateralOffset;
    const cz = points[i].z + nz * lateralOffset;

    vertices.push([cx - nx * halfWidth, y, cz - nz * halfWidth]);
    vertices.push([cx + nx * halfWidth, y, cz + nz * halfWidth]);
  }

  for (let i = 0; i < count - 1; i++) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2);
    indices.push(base + 1, base + 3, base + 2);
  }

  return { vertices, indices };
}

function getPointTangent(points, index) {
  let dx = 0;
  let dz = 0;
  if (index > 0) {
    dx += points[index].x - points[index - 1].x;
    dz += points[index].z - points[index - 1].z;
  }
  if (index < points.length - 1) {
    dx += points[index + 1].x - points[index].x;
    dz += points[index + 1].z - points[index].z;
  }
  const len = Math.hypot(dx, dz);
  return len > 1e-6 ? { x: dx / len, z: dz / len } : { x: 1, z: 0 };
}
