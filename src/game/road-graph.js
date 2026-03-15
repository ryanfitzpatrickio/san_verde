import * as THREE from 'three';

const METERS_PER_DEGREE_LAT = 111320;
const ROAD_WIDTH_BY_HIGHWAY = {
  motorway: 26,
  trunk: 22,
  primary: 18,
  secondary: 15,
  tertiary: 13,
  residential: 11,
  service: 9,
  unclassified: 10,
  local: 10
};

const GRAPH_CLASSIFICATION_BY_HIGHWAY = {
  motorway: 'primary',
  trunk: 'primary',
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'secondary',
  residential: 'local',
  service: 'local',
  unclassified: 'local',
  local: 'local'
};

export function createRoadGraphFromGeoJSON(geojson, options = {}) {
  const features = extractLineFeatures(geojson);
  const projection = resolveProjection(features, geojson, options);
  const roads = [];
  const nodeMap = new Map();
  const bounds = createEmptyBounds();

  for (const feature of features) {
    const featureProps = feature.properties && typeof feature.properties === 'object' ? feature.properties : {};
    const parts = explodeLineGeometry(feature.geometry);

    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const rawPoints = parts[partIndex]
        .map((coordinate) => projectCoordinateToLocal(coordinate, projection))
        .filter(Boolean);
      const points = dedupeSequentialPoints(rawPoints);
      if (points.length < 2) {
        continue;
      }

      expandBounds(bounds, points);
      const highway = normalizeHighwayClass(featureProps.highway);
      const classification = GRAPH_CLASSIFICATION_BY_HIGHWAY[highway] || 'local';
      const width = inferRoadWidthMeters(featureProps, highway);
      const roadId = buildRoadId(featureProps, roads.length, partIndex);
      const road = {
        id: roadId,
        name: typeof featureProps.name === 'string' && featureProps.name.trim() ? featureProps.name.trim() : roadId,
        classification,
        highway,
        lanes: inferLaneCount(featureProps, classification),
        width,
        oneway: inferOneWay(featureProps),
        points,
        curve: new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.15)
      };
      roads.push(road);
      registerRoadNodes(nodeMap, road);
    }
  }

  const graph = {
    roads,
    nodes: [],
    bounds: normalizeBounds(bounds),
    projection,
    metadata: {
      source: geojson?.properties?.source || 'unknown',
      preset: geojson?.properties?.preset || '',
      coordinateSystem: projection.mode
    }
  };

  graph.nodes = Array.from(nodeMap.values())
    .map((node) => finalizeGraphNode(graph, node))
    .filter(Boolean);

  return graph;
}

export function collectNodeConnections(graph, node) {
  const connections = [];

  for (const road of graph.roads) {
    for (let index = 0; index < road.points.length; index += 1) {
      const point = road.points[index];
      if (point.distanceToSquared(node.point) > 0.0001) {
        continue;
      }

      if (index > 0) {
        pushUniqueConnection(
          connections,
          point.clone().sub(road.points[index - 1]).setY(0),
          road
        );
      }

      if (index < road.points.length - 1) {
        pushUniqueConnection(
          connections,
          road.points[index + 1].clone().sub(point).setY(0),
          road
        );
      }
    }
  }

  return connections.sort((left, right) => {
    const leftAngle = Math.atan2(left.direction.z, left.direction.x);
    const rightAngle = Math.atan2(right.direction.z, right.direction.x);
    return leftAngle - rightAngle;
  });
}

export function deriveRoadGraphSpawn(graph) {
  const roads = [...graph.roads].sort((left, right) => getPolylineLength(right.points) - getPolylineLength(left.points));
  const preferredRoad =
    roads.find((road) => road.classification === 'primary') ||
    roads.find((road) => road.classification === 'secondary') ||
    roads[0];

  if (!preferredRoad) {
    return {
      position: new THREE.Vector3(),
      yaw: 0,
      tangent: new THREE.Vector3(0, 0, 1)
    };
  }

  const point = preferredRoad.curve.getPointAt(0.14);
  const tangent = preferredRoad.curve.getTangentAt(0.14).setY(0).normalize();
  return {
    position: point.clone().setY(0),
    yaw: Math.atan2(tangent.x, tangent.z),
    tangent
  };
}

function extractLineFeatures(geojson) {
  if (!geojson || typeof geojson !== 'object') {
    return [];
  }

  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    return geojson.features.filter((feature) => isLineGeometry(feature?.geometry));
  }

  if (geojson.type === 'Feature' && isLineGeometry(geojson.geometry)) {
    return [geojson];
  }

  return [];
}

function explodeLineGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') {
    return [];
  }

  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    return [geometry.coordinates];
  }

  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.filter((part) => Array.isArray(part));
  }

  return [];
}

function isLineGeometry(geometry) {
  return geometry?.type === 'LineString' || geometry?.type === 'MultiLineString';
}

function resolveProjection(features, geojson, options) {
  const explicitMode =
    options.coordinateSystem ||
    geojson?.properties?.coordinateSystem ||
    geojson?.coordinateSystem ||
    '';
  const mode = String(explicitMode || '').toLowerCase() === 'local'
    ? 'local'
    : inferCoordinateMode(features);

  if (mode === 'local') {
    return { mode: 'local', originLngLat: null };
  }

  const allCoords = [];
  for (const feature of features) {
    const parts = explodeLineGeometry(feature.geometry);
    for (const part of parts) {
      for (const coordinate of part) {
        if (Array.isArray(coordinate) && coordinate.length >= 2) {
          allCoords.push(coordinate);
        }
      }
    }
  }

  if (!allCoords.length) {
    return { mode: 'local', originLngLat: null };
  }

  const originLng =
    allCoords.reduce((sum, coordinate) => sum + Number(coordinate[0] || 0), 0) / allCoords.length;
  const originLat =
    allCoords.reduce((sum, coordinate) => sum + Number(coordinate[1] || 0), 0) / allCoords.length;

  return {
    mode: 'geographic',
    originLngLat: {
      lng: originLng,
      lat: originLat
    }
  };
}

function inferCoordinateMode(features) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let allLookGeographic = true;

  for (const feature of features) {
    const parts = explodeLineGeometry(feature.geometry);
    for (const part of parts) {
      for (const coordinate of part) {
        const x = Number(coordinate?.[0]);
        const y = Number(coordinate?.[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          continue;
        }
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        if (Math.abs(x) > 180 || Math.abs(y) > 90) {
          allLookGeographic = false;
        }
      }
    }
  }

  if (!allLookGeographic) {
    return 'local';
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX > 1.2 || spanY > 1.2) {
    return 'local';
  }

  return 'geographic';
}

function projectCoordinateToLocal(coordinate, projection) {
  const x = Number(coordinate?.[0]);
  const y = Number(coordinate?.[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  if (projection.mode === 'local' || !projection.originLngLat) {
    return new THREE.Vector3(x, 0, y);
  }

  const deltaLng = x - projection.originLngLat.lng;
  const deltaLat = y - projection.originLngLat.lat;
  const metersPerDegreeLng =
    METERS_PER_DEGREE_LAT * Math.cos(THREE.MathUtils.degToRad(projection.originLngLat.lat));

  return new THREE.Vector3(deltaLng * metersPerDegreeLng, 0, deltaLat * METERS_PER_DEGREE_LAT);
}

function dedupeSequentialPoints(points) {
  const deduped = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.distanceToSquared(point) < 0.01) {
      continue;
    }
    deduped.push(point);
  }
  return deduped;
}

function createEmptyBounds() {
  return {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY
  };
}

function expandBounds(bounds, points) {
  for (const point of points) {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.minZ = Math.min(bounds.minZ, point.z);
    bounds.maxZ = Math.max(bounds.maxZ, point.z);
  }
}

function normalizeBounds(bounds) {
  if (!Number.isFinite(bounds.minX)) {
    return {
      minX: -120,
      maxX: 120,
      minZ: -120,
      maxZ: 120
    };
  }
  return bounds;
}

function normalizeHighwayClass(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) {
    return 'residential';
  }

  if (text in ROAD_WIDTH_BY_HIGHWAY) {
    return text;
  }

  if (text === 'living_street') {
    return 'residential';
  }

  return 'unclassified';
}

function inferRoadWidthMeters(properties, highway) {
  const explicitWidth = Number(properties?.width);
  if (Number.isFinite(explicitWidth) && explicitWidth > 2) {
    return explicitWidth;
  }

  const lanes = inferLaneCount(properties, GRAPH_CLASSIFICATION_BY_HIGHWAY[highway] || 'local');
  const base = ROAD_WIDTH_BY_HIGHWAY[highway] || ROAD_WIDTH_BY_HIGHWAY.unclassified;
  return Math.max(base, lanes * 3.35 + 3.2);
}

function inferLaneCount(properties, classification) {
  const explicit = Number(properties?.lanes);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.round(explicit);
  }

  if (classification === 'primary') {
    return 4;
  }
  if (classification === 'secondary') {
    return 2;
  }
  return 2;
}

function inferOneWay(properties) {
  const value = String(properties?.oneway || '').trim().toLowerCase();
  return value === 'yes' || value === 'true' || value === '1';
}

function buildRoadId(properties, roadIndex, partIndex) {
  const seed =
    typeof properties?.id === 'string' && properties.id.trim()
      ? properties.id.trim()
      : typeof properties?.name === 'string' && properties.name.trim()
        ? properties.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
        : `road_${roadIndex}`;
  return partIndex > 0 ? `${seed}_${partIndex}` : seed;
}

function registerRoadNodes(nodeMap, road) {
  for (let index = 0; index < road.points.length; index += 1) {
    const point = road.points[index];
    const key = snapNodeKey(point);
    const node = nodeMap.get(key) || {
      key,
      point: point.clone(),
      roads: new Set(),
      count: 0,
      isInteriorVertex: false
    };
    node.count += 1;
    node.roads.add(road.id);
    node.isInteriorVertex = node.isInteriorVertex || (index > 0 && index < road.points.length - 1);
    nodeMap.set(key, node);
  }
}

function finalizeGraphNode(graph, node) {
  const connections = collectNodeConnections(graph, node);
  if (connections.length < 2) {
    return null;
  }

  const opposingScore =
    connections.length === 2 ? connections[0].direction.dot(connections[1].direction) : -1;
  const isSharedRoadNode = node.roads.size > 1 || node.count > 1;
  const isCorner = !isSharedRoadNode && node.isInteriorVertex && opposingScore > -0.965;
  const kind = isSharedRoadNode || connections.length > 2 ? 'junction' : isCorner ? 'corner' : null;

  if (!kind) {
    return null;
  }

  return {
    ...node,
    kind,
    degree: connections.length,
    connections
  };
}

function pushUniqueConnection(connections, direction, road) {
  if (direction.lengthSq() < 0.0001) {
    return;
  }

  direction.normalize();
  for (const existing of connections) {
    if (existing.direction.dot(direction) > 0.96) {
      existing.width = Math.max(existing.width, road.width);
      existing.classification = pickWiderClassification(existing.classification, road.classification);
      existing.roadIds.add(road.id);
      return;
    }
  }

  connections.push({
    direction,
    width: road.width,
    classification: road.classification,
    roadIds: new Set([road.id])
  });
}

function pickWiderClassification(left, right) {
  const score = { primary: 3, secondary: 2, local: 1 };
  return (score[right] || 0) > (score[left] || 0) ? right : left;
}

function snapNodeKey(point) {
  return `${Math.round(point.x * 2) / 2}:${Math.round(point.z * 2) / 2}`;
}

function getPolylineLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += points[index].distanceTo(points[index - 1]);
  }
  return total;
}
