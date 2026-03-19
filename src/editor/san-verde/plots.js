import { ROAD_STYLES, ZONE_PLOT_STYLE } from './config.js';

export function normalizePlotData(plot) {
  if (!plot || typeof plot !== 'object') return null;
  return {
    x: Number(plot.x) || 0,
    z: Number(plot.z) || 0,
    width: Number(plot.width) || 0,
    depth: Number(plot.depth) || 0,
    angle: Number(plot.angle) || 0,
    entryId: typeof plot.entryId === 'string' && plot.entryId.trim() ? plot.entryId.trim() : undefined
  };
}

export function regenerateZonePlotsWithAssignments(zone, roads) {
  const previousPlots = Array.isArray(zone?.plots) ? zone.plots.map(normalizePlotData).filter(Boolean) : [];
  const nextPlots = generateZonePlotsForEditor(zone, roads);
  transferPlotAssignments(previousPlots, nextPlots);
  return nextPlots;
}

export function generateZonePlotsForEditor(zone, roads) {
  const style = ZONE_PLOT_STYLE[zone.type];
  const points = (zone.points || []).map(normalizePoint).filter(Boolean);
  if (!style || points.length < 3) return [];

  const bounds = getPolygonBounds(points);
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const adaptiveSetback = Math.min(style.setback, width * 0.18, depth * 0.18);
  if (width < style.footprintMin + adaptiveSetback * 2 || depth < style.depthMin + adaptiveSetback * 2) {
    return [];
  }

  const roadSegments = buildRoadSegments(roads);
  const minEdgeDistance = adaptiveSetback * 0.55;
  const plots = createFrontagePlots(points, style, roadSegments, minEdgeDistance);

  if (!plots.length) {
    const fallback = findFallbackPlot(points, style, roadSegments, minEdgeDistance);
    if (fallback) plots.push(fallback);
  }
  return plots;
}

export function getPlotCornersForEditor(plot) {
  const halfWidth = plot.width * 0.5;
  const halfDepth = plot.depth * 0.5;
  const sin = Math.sin(plot.angle || 0);
  const cos = Math.cos(plot.angle || 0);
  const tangent = { x: sin, z: cos };
  const normal = { x: -cos, z: sin };
  return createPlacementCorners(plot.x, plot.z, halfWidth, halfDepth, tangent, normal);
}

function transferPlotAssignments(previousPlots, nextPlots) {
  const available = previousPlots
    .filter((plot) => plot.entryId)
    .map((plot) => ({ ...plot, claimed: false }));

  for (const plot of nextPlots) {
    let best = null;
    let bestScore = Infinity;

    for (const candidate of available) {
      if (candidate.claimed) continue;
      const centerDistance = Math.hypot(plot.x - candidate.x, plot.z - candidate.z);
      const widthDelta = Math.abs(plot.width - candidate.width);
      const depthDelta = Math.abs(plot.depth - candidate.depth);
      const score = centerDistance + widthDelta * 1.5 + depthDelta * 1.5;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    if (best && bestScore < 90) {
      plot.entryId = best.entryId;
      best.claimed = true;
    }
  }
}

function createFrontagePlots(points, style, roadSegments, minEdgeDistance) {
  const plots = [];
  for (const segment of roadSegments) {
    const sampleStep = Math.max(style.footprintMin + 4, Math.min(style.spacing, style.footprintMax + 8));
    for (let d = sampleStep * 0.6; d <= segment.length - sampleStep * 0.6; d += sampleStep) {
      const roadX = segment.a.x + segment.tangent.x * d;
      const roadZ = segment.a.z + segment.tangent.z * d;
      const plotWidth = randomRange(style.footprintMin, style.footprintMax);
      const plotDepth = randomRange(style.depthMin, style.depthMax);
      const halfWidth = plotWidth * 0.5;
      const halfDepth = plotDepth * 0.5;

      for (const sideSign of [1, -1]) {
        const normal = { x: segment.normal.x * sideSign, z: segment.normal.z * sideSign };
        const centerX = roadX + normal.x * (segment.clearance + halfDepth + 2.5);
        const centerZ = roadZ + normal.z * (segment.clearance + halfDepth + 2.5);
        const corners = createPlacementCorners(centerX, centerZ, halfWidth, halfDepth, segment.tangent, normal);
        if (!corners.every((corner) => pointInPolygon(corner.x, corner.z, points))) continue;
        if (distanceToPolygonEdges(centerX, centerZ, points) < minEdgeDistance * 0.75) continue;
        if (!footprintClearsRoads(centerX, centerZ, corners, roadSegments)) continue;
        if (placementCollides(plots, centerX, centerZ, plotWidth, plotDepth, 12)) continue;
        plots.push({
          x: centerX,
          z: centerZ,
          width: plotWidth,
          depth: plotDepth,
          angle: Math.atan2(segment.tangent.x, segment.tangent.z)
        });
        break;
      }
    }
  }
  return plots;
}

function buildRoadSegments(roads) {
  const segments = [];
  for (const road of roads || []) {
    const style = ROAD_STYLES[road.type] || ROAD_STYLES.street;
    const points = (road.points || []).map(normalizePoint).filter(Boolean);
    for (let i = 0; i < points.length - 1; i += 1) {
      const start = points[i];
      const end = points[i + 1];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-3) continue;
      const tangent = { x: dx / length, z: dz / length };
      const normal = { x: -tangent.z, z: tangent.x };
      segments.push({
        a: start,
        b: end,
        length,
        tangent,
        normal,
        clearance: style.width * 0.5 + 6 + 4
      });
    }
  }
  return segments;
}

function createPlacementCorners(x, z, halfWidth, halfDepth, tangent, normal) {
  return [
    { x: x + tangent.x * halfWidth + normal.x * halfDepth, z: z + tangent.z * halfWidth + normal.z * halfDepth },
    { x: x - tangent.x * halfWidth + normal.x * halfDepth, z: z - tangent.z * halfWidth + normal.z * halfDepth },
    { x: x - tangent.x * halfWidth - normal.x * halfDepth, z: z - tangent.z * halfWidth - normal.z * halfDepth },
    { x: x + tangent.x * halfWidth - normal.x * halfDepth, z: z + tangent.z * halfWidth - normal.z * halfDepth }
  ];
}

function footprintClearsRoads(x, z, corners, roadSegments) {
  for (const segment of roadSegments) {
    if (pointToSegmentDist(x, z, segment.a, segment.b) < segment.clearance) return false;
    for (const corner of corners) {
      if (pointToSegmentDist(corner.x, corner.z, segment.a, segment.b) < segment.clearance) return false;
    }
  }
  return true;
}

function placementCollides(plots, x, z, width, depth, padding = 0) {
  const radius = Math.max(width, depth) * 0.5 + padding;
  for (const plot of plots) {
    const otherRadius = Math.max(plot.width, plot.depth) * 0.5 + padding;
    if (Math.hypot(x - plot.x, z - plot.z) < radius + otherRadius) return true;
  }
  return false;
}

function findFallbackPlot(points, style, roadSegments, minEdgeDistance) {
  const bounds = getPolygonBounds(points);
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const step = Math.max(10, Math.min(18, Math.min(width, depth) * 0.18));
  let best = null;
  for (let x = bounds.minX + step; x <= bounds.maxX - step; x += step) {
    for (let z = bounds.minZ + step; z <= bounds.maxZ - step; z += step) {
      if (!pointInPolygon(x, z, points)) continue;
      const edgeDistance = distanceToPolygonEdges(x, z, points);
      if (edgeDistance < minEdgeDistance * 0.9) continue;
      const orientation = getPlacementOrientation(x, z, roadSegments);
      const plotWidth = clampValue(Math.min(style.footprintMax, edgeDistance * 1.4, width * 0.2), style.footprintMin, style.footprintMax);
      const plotDepth = clampValue(Math.min(style.depthMax, edgeDistance * 1.4, depth * 0.2), style.depthMin, style.depthMax);
      const corners = createPlacementCorners(x, z, plotWidth * 0.5, plotDepth * 0.5, orientation.tangent, orientation.normal);
      if (!corners.every((corner) => pointInPolygon(corner.x, corner.z, points))) continue;
      if (!footprintClearsRoads(x, z, corners, roadSegments)) continue;

      let roadDistance = Infinity;
      for (const segment of roadSegments) {
        roadDistance = Math.min(roadDistance, pointToSegmentDist(x, z, segment.a, segment.b) - segment.clearance);
      }
      const score = edgeDistance + roadDistance * 1.5;
      if (!best || score > best.score) {
        best = { x, z, width: plotWidth, depth: plotDepth, angle: Math.atan2(orientation.tangent.x, orientation.tangent.z), score };
      }
    }
  }
  return best;
}

function getPlacementOrientation(x, z, roadSegments) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const segment of roadSegments) {
    const distance = pointToSegmentDist(x, z, segment.a, segment.b);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = segment;
    }
  }
  if (!nearest) {
    return { tangent: { x: 1, z: 0 }, normal: { x: 0, z: 1 } };
  }
  const midX = (nearest.a.x + nearest.b.x) * 0.5;
  const midZ = (nearest.a.z + nearest.b.z) * 0.5;
  const sign = (x - midX) * nearest.normal.x + (z - midZ) * nearest.normal.z >= 0 ? 1 : -1;
  return {
    tangent: nearest.tangent,
    normal: { x: nearest.normal.x * sign, z: nearest.normal.z * sign }
  };
}

function distanceToPolygonEdges(x, z, points) {
  let minDistance = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    minDistance = Math.min(minDistance, pointToSegmentDist(x, z, points[i], next));
  }
  return minDistance;
}

function pointInPolygon(px, pz, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, zi = points[i].z;
    const xj = points[j].x, zj = points[j].z;
    const intersect = ((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / ((zj - zi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointToSegmentDist(px, pz, a, b) {
  const projected = projectPointToSegment(px, pz, a, b);
  return Math.hypot(px - projected.x, pz - projected.z);
}

function projectPointToSegment(px, pz, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lenSq = abx * abx + abz * abz;
  if (lenSq === 0) return { x: a.x, z: a.z };
  const t = clampValue(((px - a.x) * abx + (pz - a.z) * abz) / lenSq, 0, 1);
  return { x: a.x + abx * t, z: a.z + abz * t };
}

function getPolygonBounds(points) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.z < minZ) minZ = point.z;
    if (point.z > maxZ) maxZ = point.z;
  }
  return { minX, maxX, minZ, maxZ };
}

function normalizePoint(point) {
  if (Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) {
    return { x: Number(point[0]), z: Number(point[1]) };
  }
  if (point && typeof point === 'object') {
    return { x: Number(point.x) || 0, z: Number(point.z) || 0 };
  }
  return null;
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
