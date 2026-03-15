import * as THREE from 'three';

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const PROJECT_VECTOR = new THREE.Vector3();
const PROJECT_VECTOR_B = new THREE.Vector3();
const TANGENT_VECTOR = new THREE.Vector3();
const RIGHT_VECTOR = new THREE.Vector3();
const OFFSET_VECTOR = new THREE.Vector3();
const SAMPLE_VECTOR = new THREE.Vector3();
const SAMPLE_TANGENT = new THREE.Vector3();

export function createNavigationNetwork(id, metadata = {}) {
  return {
    id,
    metadata,
    layers: {
      vehicle: createNavigationLayer('vehicle'),
      pedestrian: createNavigationLayer('pedestrian')
    }
  };
}

export function getNavigationLayer(network, layerName) {
  return network?.layers?.[layerName] || null;
}

export function buildRoadGraphAgentNavigation(graph, options = {}) {
  const network = createNavigationNetwork('roadGraph', {
    source: 'roadGraph',
    bounds: graph?.bounds || null
  });

  if (!graph?.roads?.length) {
    finalizeNavigationNetwork(network);
    return network;
  }

  const nodeIds = new Map();

  for (const road of graph.roads) {
    const startPoint = road.points[0];
    const endPoint = road.points[road.points.length - 1];
    const startNodeId = ensureAbstractNode(network, 'vehicle', nodeIds, startPoint, {
      roadIds: [road.id],
      endpoint: true
    });
    const endNodeId = ensureAbstractNode(network, 'vehicle', nodeIds, endPoint, {
      roadIds: [road.id],
      endpoint: true
    });
    ensureAbstractNode(network, 'pedestrian', nodeIds, startPoint, {
      roadIds: [road.id],
      endpoint: true
    });
    ensureAbstractNode(network, 'pedestrian', nodeIds, endPoint, {
      roadIds: [road.id],
      endpoint: true
    });

    const vehicleLaneOffset = clamp(options.vehicleLaneOffsetFactor ? road.width * options.vehicleLaneOffsetFactor : road.width * 0.22, 2.2, 5.4);
    const sidewalkOffset = Math.max(road.width * 0.5 + (options.sidewalkInset ?? 3.4), vehicleLaneOffset + 2.2);

    if (!road.oneway) {
      addLanePair(network, {
        layerName: 'vehicle',
        baseId: `${road.id}:veh`,
        forwardNodeId: startNodeId,
        reverseNodeId: endNodeId,
        forwardNodePosition: startPoint,
        reverseNodePosition: endPoint,
        forwardPoints: road.points,
        laneOffset: vehicleLaneOffset,
        tags: {
          roadId: road.id,
          classification: road.classification,
          highway: road.highway
        }
      });
    } else {
      addDirectedLane(network, {
        layerName: 'vehicle',
        id: `${road.id}:veh:fwd`,
        fromNodeId: startNodeId,
        toNodeId: endNodeId,
        points: createLanePolyline(road.points, vehicleLaneOffset, startPoint, endPoint),
        tags: {
          roadId: road.id,
          classification: road.classification,
          highway: road.highway,
          oneway: true
        }
      });
    }

    addPedestrianSidewalkPair(network, road, startPoint, endPoint, sidewalkOffset, nodeIds);
  }

  finalizeNavigationNetwork(network);
  populateDefaultSpawns(network, options);
  return network;
}

export function buildBloomvilleGridAgentNavigation({
  chunkSize,
  centerChunkX,
  centerChunkZ,
  radius = 2,
  horizontalKindAt,
  verticalKindAt,
  roadStyles
}) {
  const network = createNavigationNetwork('bloomvilleGrid', {
    source: 'bloomvilleGrid',
    centerChunkX,
    centerChunkZ,
    radius
  });

  const nodeIds = new Map();
  const minChunkX = centerChunkX - radius;
  const maxChunkX = centerChunkX + radius;
  const minChunkZ = centerChunkZ - radius;
  const maxChunkZ = centerChunkZ + radius;

  for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) {
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
      const nodePoint = new THREE.Vector3(chunkX * chunkSize, 0, chunkZ * chunkSize);
      ensureAbstractNode(network, 'vehicle', nodeIds, nodePoint, { chunkX, chunkZ, junction: true });
      ensureAbstractNode(network, 'pedestrian', nodeIds, nodePoint, { chunkX, chunkZ, junction: true });
    }
  }

  for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) {
    for (let chunkX = minChunkX; chunkX < maxChunkX; chunkX += 1) {
      const kind = horizontalKindAt(chunkZ);
      const style = roadStyles[kind];
      if (!style) {
        continue;
      }
      const startPoint = new THREE.Vector3(chunkX * chunkSize, 0, chunkZ * chunkSize);
      const endPoint = new THREE.Vector3((chunkX + 1) * chunkSize, 0, chunkZ * chunkSize);
      const startNodeId = ensureAbstractNode(network, 'vehicle', nodeIds, startPoint, { chunkX, chunkZ });
      const endNodeId = ensureAbstractNode(network, 'vehicle', nodeIds, endPoint, { chunkX: chunkX + 1, chunkZ });
      ensureAbstractNode(network, 'pedestrian', nodeIds, startPoint, { chunkX, chunkZ });
      ensureAbstractNode(network, 'pedestrian', nodeIds, endPoint, { chunkX: chunkX + 1, chunkZ });

      const vehicleOffset = getBloomvilleVehicleOffset(style);
      const sidewalkOffset = style.roadWidth * 0.5 + style.sidewalkWidth * 0.5 - 0.75;
      const forwardPoints = [startPoint, endPoint];

      addLanePair(network, {
        layerName: 'vehicle',
        baseId: `bloomville:h:${chunkX}:${chunkZ}`,
        forwardNodeId: startNodeId,
        reverseNodeId: endNodeId,
        forwardNodePosition: startPoint,
        reverseNodePosition: endPoint,
        forwardPoints,
        laneOffset: vehicleOffset,
        tags: {
          kind,
          axis: 'horizontal',
          chunkX,
          chunkZ
        }
      });

      addPedestrianAxisPair(network, {
        baseId: `bloomville:h:${chunkX}:${chunkZ}:ped`,
        axis: 'horizontal',
        startPoint,
        endPoint,
        offset: sidewalkOffset,
        nodeIds,
        tags: {
          kind,
          axis: 'horizontal',
          chunkX,
          chunkZ
        }
      });
    }
  }

  for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
    for (let chunkZ = minChunkZ; chunkZ < maxChunkZ; chunkZ += 1) {
      const kind = verticalKindAt(chunkX);
      const style = roadStyles[kind];
      if (!style) {
        continue;
      }
      const startPoint = new THREE.Vector3(chunkX * chunkSize, 0, chunkZ * chunkSize);
      const endPoint = new THREE.Vector3(chunkX * chunkSize, 0, (chunkZ + 1) * chunkSize);
      const startNodeId = ensureAbstractNode(network, 'vehicle', nodeIds, startPoint, { chunkX, chunkZ });
      const endNodeId = ensureAbstractNode(network, 'vehicle', nodeIds, endPoint, { chunkX, chunkZ: chunkZ + 1 });
      ensureAbstractNode(network, 'pedestrian', nodeIds, startPoint, { chunkX, chunkZ });
      ensureAbstractNode(network, 'pedestrian', nodeIds, endPoint, { chunkX, chunkZ: chunkZ + 1 });

      const vehicleOffset = getBloomvilleVehicleOffset(style);
      const sidewalkOffset = style.roadWidth * 0.5 + style.sidewalkWidth * 0.5 - 0.75;
      const forwardPoints = [startPoint, endPoint];

      addLanePair(network, {
        layerName: 'vehicle',
        baseId: `bloomville:v:${chunkX}:${chunkZ}`,
        forwardNodeId: startNodeId,
        reverseNodeId: endNodeId,
        forwardNodePosition: startPoint,
        reverseNodePosition: endPoint,
        forwardPoints,
        laneOffset: vehicleOffset,
        tags: {
          kind,
          axis: 'vertical',
          chunkX,
          chunkZ
        }
      });

      addPedestrianAxisPair(network, {
        baseId: `bloomville:v:${chunkX}:${chunkZ}:ped`,
        axis: 'vertical',
        startPoint,
        endPoint,
        offset: sidewalkOffset,
        nodeIds,
        tags: {
          kind,
          axis: 'vertical',
          chunkX,
          chunkZ
        }
      });
    }
  }

  finalizeNavigationNetwork(network);
  populateDefaultSpawns(network);
  return network;
}

export function findNavigationPath(network, layerName, start, goal) {
  const layer = getNavigationLayer(network, layerName);
  if (!layer) {
    return null;
  }

  const startNode = resolvePathNode(layer, start);
  const goalNode = resolvePathNode(layer, goal);
  if (!startNode || !goalNode) {
    return null;
  }

  if (startNode.id === goalNode.id) {
    return {
      layer: layer.kind,
      nodeIds: [startNode.id],
      edgeIds: [],
      edges: [],
      totalLength: 0,
      startNode,
      goalNode
    };
  }

  return runAStar(layer, startNode, goalNode);
}

export function findRandomNavigationPath(network, layerName, origin = null, rng = Math.random) {
  const layer = getNavigationLayer(network, layerName);
  if (!layer?.nodes.size) {
    return null;
  }

  const nodes = layer.nodeList;
  const startNode = origin ? findNearestNavigationNode(layer, origin) : nodes[Math.floor(rng() * nodes.length)];
  if (!startNode) {
    return null;
  }

  let goalNode = startNode;
  let guard = 0;
  while (goalNode.id === startNode.id && guard < 12) {
    goalNode = nodes[Math.floor(rng() * nodes.length)];
    guard += 1;
  }

  return findNavigationPath(network, layerName, startNode.id, goalNode.id);
}

export function findNearestNavigationNode(networkOrLayer, layerNameOrPosition, maybePosition) {
  const layer = typeof layerNameOrPosition === 'string'
    ? getNavigationLayer(networkOrLayer, layerNameOrPosition)
    : networkOrLayer;
  const position = typeof layerNameOrPosition === 'string' ? maybePosition : layerNameOrPosition;
  if (!layer?.nodeList?.length || !position) {
    return null;
  }

  let nearest = null;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;
  for (const node of layer.nodeList) {
    const distanceSq = node.position.distanceToSquared(position);
    if (distanceSq < nearestDistanceSq) {
      nearest = node;
      nearestDistanceSq = distanceSq;
    }
  }

  return nearest;
}

export function sampleNavigationRoute(route, distance) {
  if (!route?.edges?.length) {
    const position = route?.startNode?.position?.clone?.() || new THREE.Vector3();
    return {
      position,
      tangent: new THREE.Vector3(0, 0, 1),
      edgeIndex: -1
    };
  }

  let remaining = THREE.MathUtils.clamp(distance, 0, route.totalLength);
  for (let index = 0; index < route.edges.length; index += 1) {
    const edge = route.edges[index];
    if (remaining <= edge.length || index === route.edges.length - 1) {
      return samplePolyline(edge.points, remaining, index);
    }
    remaining -= edge.length;
  }

  const lastEdge = route.edges[route.edges.length - 1];
  return samplePolyline(lastEdge.points, lastEdge.length, route.edges.length - 1);
}

function createNavigationLayer(kind) {
  return {
    kind,
    nodes: new Map(),
    edges: new Map(),
    adjacency: new Map(),
    nodeList: [],
    edgeList: [],
    spawnPoints: []
  };
}

function ensureAbstractNode(network, layerName, nodeIds, position, metadata = {}) {
  const layer = getNavigationLayer(network, layerName);
  const nodeKey = `${layerName}:${snapPointKey(position)}`;
  if (!nodeIds.has(nodeKey)) {
    const node = {
      id: nodeKey,
      position: position.clone(),
      metadata: { ...metadata }
    };
    layer.nodes.set(node.id, node);
    layer.adjacency.set(node.id, []);
    nodeIds.set(nodeKey, node.id);
  } else if (metadata && Object.keys(metadata).length) {
    const node = layer.nodes.get(nodeIds.get(nodeKey));
    Object.assign(node.metadata, metadata);
  }
  return nodeIds.get(nodeKey);
}

function addLanePair(network, {
  layerName,
  baseId,
  forwardNodeId,
  reverseNodeId,
  forwardNodePosition,
  reverseNodePosition,
  forwardPoints,
  laneOffset,
  tags
}) {
  addDirectedLane(network, {
    layerName,
    id: `${baseId}:fwd`,
    fromNodeId: forwardNodeId,
    toNodeId: reverseNodeId,
    points: createLanePolyline(forwardPoints, laneOffset, forwardNodePosition, reverseNodePosition),
    tags: { ...tags, direction: 'forward' }
  });

  const reversePoints = [...forwardPoints].reverse();
  addDirectedLane(network, {
    layerName,
    id: `${baseId}:rev`,
    fromNodeId: reverseNodeId,
    toNodeId: forwardNodeId,
    points: createLanePolyline(reversePoints, laneOffset, reverseNodePosition, forwardNodePosition),
    tags: { ...tags, direction: 'reverse' }
  });
}

function addPedestrianSidewalkPair(network, road, startPoint, endPoint, sidewalkOffset, nodeIds) {
  const startNodeId = ensureAbstractNode(network, 'pedestrian', nodeIds, startPoint, {
    roadId: road.id,
    classification: road.classification,
    highway: road.highway
  });
  const endNodeId = ensureAbstractNode(network, 'pedestrian', nodeIds, endPoint, {
    roadId: road.id,
    classification: road.classification,
    highway: road.highway
  });

  for (const [index, sideOffset] of [sidewalkOffset, -sidewalkOffset].entries()) {
    const sideLabel = index === 0 ? 'a' : 'b';
    const forwardPoints = createLanePolyline(road.points, sideOffset, startPoint, endPoint);
    const reversePoints = createLanePolyline([...road.points].reverse(), sideOffset, endPoint, startPoint);

    addDirectedLane(network, {
      layerName: 'pedestrian',
      id: `${road.id}:ped:${sideLabel}:fwd`,
      fromNodeId: startNodeId,
      toNodeId: endNodeId,
      points: forwardPoints,
      tags: {
        roadId: road.id,
        classification: road.classification,
        highway: road.highway,
        side: sideLabel,
        direction: 'forward'
      }
    });

    addDirectedLane(network, {
      layerName: 'pedestrian',
      id: `${road.id}:ped:${sideLabel}:rev`,
      fromNodeId: endNodeId,
      toNodeId: startNodeId,
      points: reversePoints,
      tags: {
        roadId: road.id,
        classification: road.classification,
        highway: road.highway,
        side: sideLabel,
        direction: 'reverse'
      }
    });
  }
}

function addPedestrianAxisPair(network, { baseId, axis, startPoint, endPoint, offset, nodeIds, tags }) {
  const pedestrianLayer = getNavigationLayer(network, 'pedestrian');
  const startNodeId = ensureAbstractNode(network, 'pedestrian', nodeIds, startPoint, tags);
  const endNodeId = ensureAbstractNode(network, 'pedestrian', nodeIds, endPoint, tags);

  for (const [index, sideOffset] of [offset, -offset].entries()) {
    const forwardPoints = createAxisLanePolyline(axis, startPoint, endPoint, sideOffset);
    const reversePoints = [...forwardPoints].reverse();
    const sideLabel = index === 0 ? 'a' : 'b';

    addDirectedLane(network, {
      layerName: 'pedestrian',
      id: `${baseId}:${sideLabel}:fwd`,
      fromNodeId: startNodeId,
      toNodeId: endNodeId,
      points: [startPoint.clone(), ...forwardPoints, endPoint.clone()],
      tags: { ...tags, side: sideLabel, direction: 'forward' }
    });

    addDirectedLane(network, {
      layerName: 'pedestrian',
      id: `${baseId}:${sideLabel}:rev`,
      fromNodeId: endNodeId,
      toNodeId: startNodeId,
      points: [endPoint.clone(), ...reversePoints, startPoint.clone()],
      tags: { ...tags, side: sideLabel, direction: 'reverse' }
    });

    pedestrianLayer.spawnPoints.push(createSpawnPoint(`${baseId}:${sideLabel}:mid`, forwardPoints, startNodeId, tags));
  }
}

function addDirectedLane(network, { layerName, id, fromNodeId, toNodeId, points, tags }) {
  const layer = getNavigationLayer(network, layerName);
  if (!layer || !layer.nodes.has(fromNodeId) || !layer.nodes.has(toNodeId)) {
    return;
  }

  const edge = {
    id,
    fromNodeId,
    toNodeId,
    points: clonePoints(points),
    length: getPolylineLength(points),
    tags: { ...tags }
  };
  layer.edges.set(edge.id, edge);
  layer.adjacency.get(fromNodeId).push(edge.id);
}

function finalizeNavigationNetwork(network) {
  for (const layer of Object.values(network.layers)) {
    layer.nodeList = Array.from(layer.nodes.values());
    layer.edgeList = Array.from(layer.edges.values());
  }
}

function populateDefaultSpawns(network, options = {}) {
  for (const layer of Object.values(network.layers)) {
    for (const edge of layer.edgeList) {
      if (edge.length < (options.minSpawnEdgeLength ?? 18)) {
        continue;
      }
      layer.spawnPoints.push(createSpawnPoint(edge.id, edge.points, edge.fromNodeId, edge.tags));
    }
  }
}

function createSpawnPoint(id, points, nodeId, tags) {
  const sample = samplePolyline(points, getPolylineLength(points) * 0.5, 0);
  return {
    id: `${id}:spawn`,
    nodeId,
    position: sample.position,
    tangent: sample.tangent,
    yaw: Math.atan2(sample.tangent.x, sample.tangent.z),
    tags: { ...tags }
  };
}

function resolvePathNode(layer, target) {
  if (typeof target === 'string') {
    return layer.nodes.get(target) || null;
  }
  if (target?.isVector3) {
    return findNearestNavigationNode(layer, target);
  }
  return null;
}

function runAStar(layer, startNode, goalNode) {
  const openSet = new Set([startNode.id]);
  const cameFromNode = new Map();
  const cameFromEdge = new Map();
  const gScore = new Map([[startNode.id, 0]]);
  const fScore = new Map([[startNode.id, startNode.position.distanceTo(goalNode.position)]]);

  while (openSet.size) {
    let currentId = null;
    let currentScore = Number.POSITIVE_INFINITY;
    for (const nodeId of openSet) {
      const score = fScore.get(nodeId) ?? Number.POSITIVE_INFINITY;
      if (score < currentScore) {
        currentId = nodeId;
        currentScore = score;
      }
    }

    if (currentId === goalNode.id) {
      return reconstructRoute(layer, cameFromNode, cameFromEdge, startNode.id, goalNode.id);
    }

    openSet.delete(currentId);
    const outgoingEdges = layer.adjacency.get(currentId) || [];
    for (const edgeId of outgoingEdges) {
      const edge = layer.edges.get(edgeId);
      if (!edge) {
        continue;
      }
      const tentativeScore = (gScore.get(currentId) ?? Number.POSITIVE_INFINITY) + edge.length;
      const neighborScore = gScore.get(edge.toNodeId) ?? Number.POSITIVE_INFINITY;
      if (tentativeScore >= neighborScore) {
        continue;
      }

      cameFromNode.set(edge.toNodeId, currentId);
      cameFromEdge.set(edge.toNodeId, edgeId);
      gScore.set(edge.toNodeId, tentativeScore);

      const neighborNode = layer.nodes.get(edge.toNodeId);
      fScore.set(
        edge.toNodeId,
        tentativeScore + neighborNode.position.distanceTo(goalNode.position)
      );
      openSet.add(edge.toNodeId);
    }
  }

  return null;
}

function reconstructRoute(layer, cameFromNode, cameFromEdge, startNodeId, goalNodeId) {
  const nodeIds = [goalNodeId];
  const edgeIds = [];
  let currentId = goalNodeId;

  while (currentId !== startNodeId) {
    const previousNodeId = cameFromNode.get(currentId);
    const edgeId = cameFromEdge.get(currentId);
    if (!previousNodeId || !edgeId) {
      return null;
    }
    edgeIds.push(edgeId);
    nodeIds.push(previousNodeId);
    currentId = previousNodeId;
  }

  nodeIds.reverse();
  edgeIds.reverse();
  const edges = edgeIds.map((edgeId) => layer.edges.get(edgeId)).filter(Boolean);

  return {
    layer: layer.kind,
    nodeIds,
    edgeIds,
    edges,
    totalLength: edges.reduce((sum, edge) => sum + edge.length, 0),
    startNode: layer.nodes.get(startNodeId),
    goalNode: layer.nodes.get(goalNodeId)
  };
}

function createLanePolyline(points, offset, startNodePoint, endNodePoint) {
  const offsetPoints = buildOffsetPolyline(points, offset);
  return [startNodePoint.clone(), ...offsetPoints, endNodePoint.clone()];
}

function createAxisLanePolyline(axis, startPoint, endPoint, offset) {
  if (axis === 'horizontal') {
    return [
      new THREE.Vector3(startPoint.x, 0, startPoint.z + offset),
      new THREE.Vector3(endPoint.x, 0, endPoint.z + offset)
    ];
  }

  return [
    new THREE.Vector3(startPoint.x + offset, 0, startPoint.z),
    new THREE.Vector3(endPoint.x + offset, 0, endPoint.z)
  ];
}

function buildOffsetPolyline(points, offset) {
  const result = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const tangent = getPolylineTangent(points, index);
    RIGHT_VECTOR.crossVectors(tangent, UP_AXIS).normalize();
    OFFSET_VECTOR.copy(RIGHT_VECTOR).multiplyScalar(offset);
    result.push(point.clone().add(OFFSET_VECTOR));
  }
  return result;
}

function getPolylineTangent(points, index) {
  PROJECT_VECTOR.set(0, 0, 0);
  if (index > 0) {
    PROJECT_VECTOR.add(PROJECT_VECTOR_B.copy(points[index]).sub(points[index - 1]).normalize());
  }
  if (index < points.length - 1) {
    PROJECT_VECTOR.add(PROJECT_VECTOR_B.copy(points[index + 1]).sub(points[index]).normalize());
  }
  if (PROJECT_VECTOR.lengthSq() < 1e-6) {
    return TANGENT_VECTOR.set(0, 0, 1);
  }
  return TANGENT_VECTOR.copy(PROJECT_VECTOR).normalize();
}

function samplePolyline(points, distance, edgeIndex) {
  let remaining = Math.max(0, distance);
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = start.distanceTo(end);
    if (segmentLength < 1e-6) {
      continue;
    }
    if (remaining <= segmentLength || index === points.length - 1) {
      const alpha = segmentLength <= 1e-6 ? 0 : remaining / segmentLength;
      SAMPLE_VECTOR.copy(start).lerp(end, alpha);
      SAMPLE_TANGENT.copy(end).sub(start).setY(0).normalize();
      return {
        position: SAMPLE_VECTOR.clone(),
        tangent: SAMPLE_TANGENT.clone(),
        edgeIndex
      };
    }
    remaining -= segmentLength;
  }

  const fallbackStart = points[Math.max(0, points.length - 2)] || new THREE.Vector3();
  const fallbackEnd = points[points.length - 1] || fallbackStart;
  return {
    position: fallbackEnd.clone(),
    tangent: fallbackEnd.clone().sub(fallbackStart).setY(0).normalize(),
    edgeIndex
  };
}

function getPolylineLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += points[index - 1].distanceTo(points[index]);
  }
  return total;
}

function getBloomvilleVehicleOffset(style) {
  if (Array.isArray(style.laneOffsets) && style.laneOffsets.length > 1) {
    return Math.max(...style.laneOffsets.map((value) => Math.abs(value)));
  }
  return clamp(style.roadWidth * 0.22, 3, 6.8);
}

function snapPointKey(point) {
  return `${Math.round(point.x)}:${Math.round(point.z)}`;
}

function clonePoints(points) {
  return points.map((point) => point.clone());
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
