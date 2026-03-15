import * as THREE from 'three';

import {
  findRandomNavigationPath,
  getNavigationLayer,
  sampleNavigationRoute
} from './navigation-network.js';

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const TARGET_QUATERNION = new THREE.Quaternion();
const TARGET_POSITION = new THREE.Vector3();
const ROUTE_SAMPLE = new THREE.Vector3();
const VEHICLE_COLORS = ['#f25f5c', '#247ba0', '#f4d35e', '#70c1b3', '#9b5de5', '#ef476f'];
const PEDESTRIAN_COLORS = ['#f2b880', '#8ecae6', '#a7c957', '#e5989b', '#ffb703', '#cdb4db'];
const AGENT_KIND_CONFIG = {
  vehicle: {
    minRouteLength: 42,
    baseHeight: 0.02,
    lookAheadKey: 'vehicle',
    turnResponseKey: 'vehicle'
  },
  pedestrian: {
    minRouteLength: 18,
    baseHeight: 0.02,
    lookAheadKey: 'pedestrian',
    turnResponseKey: 'pedestrian'
  }
};
const SHARED_GEOMETRIES = {
  vehicleBody: new THREE.BoxGeometry(1.86, 0.56, 4.12),
  vehicleCabin: new THREE.BoxGeometry(1.28, 0.42, 1.84),
  pedestrianBody: new THREE.CapsuleGeometry(0.18, 0.72, 4, 8),
  pedestrianHead: new THREE.SphereGeometry(0.16, 10, 8)
};
const MATERIAL_CACHE = new Map();

export function createAgentSystem({ config, state }) {
  const agentRoot = new THREE.Group();
  const debugRoot = new THREE.Group();
  agentRoot.visible = false;
  debugRoot.visible = false;
  const debugNetworkRoot = new THREE.Group();
  const debugRouteRoot = new THREE.Group();
  debugRoot.add(debugNetworkRoot, debugRouteRoot);

  let activeStage = null;
  let activeRevision = -1;
  let activeNavigation = null;
  let vehicleAgents = [];
  let pedestrianAgents = [];
  let debugRoutesDirty = true;

  return {
    agentRoot,
    debugRoot,
    syncStage(stage, focusPosition) {
      if (
        stage === activeStage &&
        (stage?.agentNavigationRevision ?? 0) === activeRevision
      ) {
        return;
      }

      activeStage = stage || null;
      activeRevision = stage?.agentNavigationRevision ?? 0;
      activeNavigation = stage?.agentNavigation || null;

      if (!config.agentTraffic.enabled || !activeNavigation) {
        clearAgents(agentRoot);
        clearDebugGroup(debugNetworkRoot);
        clearDebugGroup(debugRouteRoot);
        vehicleAgents = [];
        pedestrianAgents = [];
        agentRoot.visible = false;
        debugRoot.visible = false;
        debugRoutesDirty = true;
        return;
      }

      const stageSettings = getStageTrafficSettings(config.agentTraffic, stage?.id);
      vehicleAgents = spawnAgents('vehicle', stageSettings.vehicleCount, activeNavigation, focusPosition, config);
      pedestrianAgents = spawnAgents('pedestrian', stageSettings.pedestrianCount, activeNavigation, focusPosition, config);
      clearAgents(agentRoot);
      for (const agent of [...vehicleAgents, ...pedestrianAgents]) {
        agentRoot.add(agent.mesh);
      }
      rebuildNetworkDebug(debugNetworkRoot, activeNavigation);
      debugRoutesDirty = true;
    },
    update(stage, followPosition, deltaSeconds) {
      if (
        stage !== activeStage ||
        (stage?.agentNavigationRevision ?? 0) !== activeRevision
      ) {
        this.syncStage(stage, followPosition);
      }

      const enabled = Boolean(activeNavigation);
      agentRoot.visible = enabled;
      debugRoot.visible = enabled && state.navDebugVisible;
      if (!enabled) {
        return;
      }

      const focusPosition = followPosition || new THREE.Vector3();
      for (const agent of vehicleAgents) {
        if (updateAgent(agent, activeNavigation, focusPosition, deltaSeconds, config)) {
          debugRoutesDirty = true;
        }
      }
      for (const agent of pedestrianAgents) {
        if (updateAgent(agent, activeNavigation, focusPosition, deltaSeconds, config)) {
          debugRoutesDirty = true;
        }
      }

      if (state.navDebugVisible && debugRoutesDirty) {
        rebuildRouteDebug(debugRouteRoot, vehicleAgents, pedestrianAgents);
        debugRoutesDirty = false;
      }
    },
    dispose() {
      clearAgents(agentRoot);
      clearDebugGroup(debugNetworkRoot);
      clearDebugGroup(debugRouteRoot);
    }
  };
}

function spawnAgents(kind, count, navigation, focusPosition, config) {
  const agents = [];
  for (let index = 0; index < count; index += 1) {
    const agent = createAgent(kind, index);
    assignAgentRoute(agent, navigation, focusPosition, config);
    agents.push(agent);
  }
  return agents;
}

function createAgent(kind, index) {
  const mesh = kind === 'vehicle' ? createVehicleVisual(index) : createPedestrianVisual(index);
  return {
    kind,
    mesh,
    route: null,
    routeDistance: 0,
    routeStartSample: null,
    yaw: 0,
    speed: 0,
    intro: null,
    baseHeight: AGENT_KIND_CONFIG[kind].baseHeight
  };
}

function createVehicleVisual(index) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    SHARED_GEOMETRIES.vehicleBody,
    getCachedMaterial(`vehicle-body:${index % VEHICLE_COLORS.length}`, () =>
      new THREE.MeshStandardMaterial({
        color: VEHICLE_COLORS[index % VEHICLE_COLORS.length],
        roughness: 0.68,
        metalness: 0.18
      })
    )
  );
  body.position.y = 0.38;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(
    SHARED_GEOMETRIES.vehicleCabin,
    getCachedMaterial('vehicle-cabin', () =>
      new THREE.MeshStandardMaterial({
        color: '#a9b5c4',
        roughness: 0.28,
        metalness: 0.04
      })
    )
  );
  cabin.position.y = 0.72;
  cabin.castShadow = true;
  cabin.receiveShadow = true;
  group.add(cabin);

  return group;
}

function createPedestrianVisual(index) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    SHARED_GEOMETRIES.pedestrianBody,
    getCachedMaterial(`pedestrian-body:${index % PEDESTRIAN_COLORS.length}`, () =>
      new THREE.MeshStandardMaterial({
        color: PEDESTRIAN_COLORS[index % PEDESTRIAN_COLORS.length],
        roughness: 0.92,
        metalness: 0.02
      })
    )
  );
  body.position.y = 0.58;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    SHARED_GEOMETRIES.pedestrianHead,
    getCachedMaterial('pedestrian-head', () =>
      new THREE.MeshStandardMaterial({
        color: '#f0c39b',
        roughness: 0.9,
        metalness: 0.01
      })
    )
  );
  head.position.y = 1.16;
  head.castShadow = true;
  head.receiveShadow = true;
  group.add(head);

  return group;
}

function updateAgent(agent, navigation, focusPosition, deltaSeconds, config) {
  if (!agent.route) {
    return assignAgentRoute(agent, navigation, focusPosition, config);
  }

  const trafficConfig = config.agentTraffic;
  const despawnDistanceSq = trafficConfig.despawnDistance * trafficConfig.despawnDistance;
  if (focusPosition && agent.mesh.position.distanceToSquared(focusPosition) > despawnDistanceSq) {
    return assignAgentRoute(agent, navigation, focusPosition, config);
  }

  if (agent.intro) {
    agent.intro.elapsed = Math.min(agent.intro.duration, agent.intro.elapsed + deltaSeconds);
    const alpha = agent.intro.duration <= 1e-4 ? 1 : agent.intro.elapsed / agent.intro.duration;
    const eased = 1 - Math.pow(1 - alpha, 2);
    TARGET_POSITION.copy(agent.intro.startPosition).lerp(agent.intro.endPosition, eased);
    agent.mesh.position.copy(TARGET_POSITION);
    agent.yaw = dampAngle(agent.intro.startYaw, agent.intro.endYaw, 8.5, eased);
    TARGET_QUATERNION.setFromAxisAngle(UP_AXIS, agent.yaw);
    agent.mesh.quaternion.copy(TARGET_QUATERNION);
    if (alpha >= 1) {
      agent.intro = null;
    }
    return false;
  }

  agent.routeDistance += agent.speed * deltaSeconds;
  if (agent.routeDistance >= agent.route.totalLength - 0.5) {
    return assignAgentRoute(agent, navigation, agent.mesh.position, config);
  }

  const kindConfig = AGENT_KIND_CONFIG[agent.kind];
  const lookAhead = trafficConfig.routeLookAhead[kindConfig.lookAheadKey];
  const sample = sampleNavigationRoute(agent.route, agent.routeDistance);
  const sampleAhead = sampleNavigationRoute(
    agent.route,
    Math.min(agent.route.totalLength, agent.routeDistance + lookAhead)
  );
  const targetYaw = Math.atan2(sampleAhead.tangent.x, sampleAhead.tangent.z);
  agent.yaw = dampAngle(
    agent.yaw,
    targetYaw,
    trafficConfig.turnResponse[kindConfig.turnResponseKey],
    deltaSeconds
  );
  TARGET_POSITION.copy(sample.position);
  TARGET_POSITION.y += kindConfig.baseHeight;
  agent.mesh.position.copy(TARGET_POSITION);
  TARGET_QUATERNION.setFromAxisAngle(UP_AXIS, agent.yaw);
  agent.mesh.quaternion.copy(TARGET_QUATERNION);

  if (agent.kind === 'pedestrian') {
    const bob = Math.sin(agent.routeDistance * 7.5) * 0.03;
    agent.mesh.position.y += bob;
  }

  return false;
}

function assignAgentRoute(agent, navigation, focusPosition, config) {
  const layer = getNavigationLayer(navigation, agent.kind);
  if (!layer?.nodeList?.length) {
    agent.route = null;
    return false;
  }

  const speedRange = config.agentTraffic.speedRange[agent.kind];
  const kindConfig = AGENT_KIND_CONFIG[agent.kind];
  const originCandidate =
    focusPosition?.isVector3
      ? pickNearbyOrigin(layer, focusPosition, config.agentTraffic.spawnRadius)
      : pickLayerOrigin(layer);
  const originPosition = originCandidate?.position || originCandidate;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const fallbackOrigin = pickLayerOrigin(layer);
    const route = findRandomNavigationPath(navigation, agent.kind, originPosition || fallbackOrigin?.position || fallbackOrigin);
    if (!route || route.totalLength < kindConfig.minRouteLength) {
      continue;
    }

    agent.route = route;
    agent.routeDistance = 0;
    agent.speed = randomRange(speedRange[0], speedRange[1]);

    const sample = sampleNavigationRoute(route, 0);
    agent.routeStartSample = sample;
    agent.yaw = Math.atan2(sample.tangent.x, sample.tangent.z);
    ROUTE_SAMPLE.copy(sample.position);
    ROUTE_SAMPLE.y += kindConfig.baseHeight;

    if (originCandidate?.position) {
      const startPosition = originCandidate.position.clone();
      startPosition.y = kindConfig.baseHeight;
      const startYaw = typeof originCandidate.yaw === 'number'
        ? originCandidate.yaw
        : Math.atan2((originCandidate.tangent?.x) ?? sample.tangent.x, (originCandidate.tangent?.z) ?? sample.tangent.z);
      agent.intro = {
        startPosition,
        endPosition: ROUTE_SAMPLE.clone(),
        startYaw,
        endYaw: agent.yaw,
        elapsed: 0,
        duration: THREE.MathUtils.clamp(startPosition.distanceTo(ROUTE_SAMPLE) / Math.max(agent.speed, 2.5), 0.35, 1.75)
      };
      agent.mesh.position.copy(startPosition);
      agent.mesh.quaternion.setFromAxisAngle(UP_AXIS, startYaw);
    } else {
      agent.intro = null;
      agent.mesh.position.copy(ROUTE_SAMPLE);
      agent.mesh.quaternion.setFromAxisAngle(UP_AXIS, agent.yaw);
    }
    return true;
  }

  agent.route = null;
  return false;
}

function pickNearbyOrigin(layer, focusPosition, radius) {
  const radiusSq = radius * radius;
  const spawnCandidates = layer.spawnPoints?.filter((spawnPoint) =>
    spawnPoint.position.distanceToSquared(focusPosition) <= radiusSq
  );
  if (spawnCandidates?.length) {
    return spawnCandidates[Math.floor(Math.random() * spawnCandidates.length)];
  }

  const nodeCandidates = layer.nodeList.filter((node) =>
    node.position.distanceToSquared(focusPosition) <= radiusSq
  );
  if (nodeCandidates.length) {
    return nodeCandidates[Math.floor(Math.random() * nodeCandidates.length)];
  }

  return pickLayerOrigin(layer);
}

function pickLayerOrigin(layer) {
  if (layer.spawnPoints?.length) {
    return layer.spawnPoints[Math.floor(Math.random() * layer.spawnPoints.length)];
  }

  if (layer.nodeList?.length) {
    return layer.nodeList[Math.floor(Math.random() * layer.nodeList.length)];
  }

  return null;
}

function clearAgents(root) {
  for (let index = root.children.length - 1; index >= 0; index -= 1) {
    root.remove(root.children[index]);
  }
}

function rebuildNetworkDebug(root, navigation) {
  clearDebugGroup(root);
  if (!navigation) {
    return;
  }

  const vehicleLayer = getNavigationLayer(navigation, 'vehicle');
  const pedestrianLayer = getNavigationLayer(navigation, 'pedestrian');
  const vehicleEdges = createPolylineDebugMesh(vehicleLayer?.edgeList || [], '#5cc8ff', 0.12, 0.36);
  const pedestrianEdges = createPolylineDebugMesh(pedestrianLayer?.edgeList || [], '#7bd88f', 0.09, 0.28);
  const vehicleSpawns = createPointDebugMesh(vehicleLayer?.spawnPoints || [], '#f3d06b', 0.15, 5.5);
  const pedestrianSpawns = createPointDebugMesh(pedestrianLayer?.spawnPoints || [], '#f7a072', 0.12, 4.5);

  for (const object of [vehicleEdges, pedestrianEdges, vehicleSpawns, pedestrianSpawns]) {
    if (object) {
      root.add(object);
    }
  }
}

function rebuildRouteDebug(root, vehicleAgents, pedestrianAgents) {
  clearDebugGroup(root);
  const vehicleRoutes = createRouteDebugMesh(vehicleAgents, '#bfe8ff', 0.18, 0.72);
  const pedestrianRoutes = createRouteDebugMesh(pedestrianAgents, '#d8ffd3', 0.15, 0.58);

  for (const object of [vehicleRoutes, pedestrianRoutes]) {
    if (object) {
      root.add(object);
    }
  }
}

function createPolylineDebugMesh(edges, color, yOffset, opacity) {
  const positions = [];
  for (const edge of edges) {
    for (let index = 1; index < edge.points.length; index += 1) {
      const start = edge.points[index - 1];
      const end = edge.points[index];
      positions.push(start.x, start.y + yOffset, start.z, end.x, end.y + yOffset, end.z);
    }
  }

  return positions.length ? createLineSegments(positions, color, opacity) : null;
}

function createRouteDebugMesh(agents, color, yOffset, opacity) {
  const positions = [];
  for (const agent of agents) {
    const route = agent.route;
    if (!route?.edges?.length) {
      continue;
    }
    for (const edge of route.edges) {
      for (let index = 1; index < edge.points.length; index += 1) {
        const start = edge.points[index - 1];
        const end = edge.points[index];
        positions.push(start.x, start.y + yOffset, start.z, end.x, end.y + yOffset, end.z);
      }
    }
  }

  return positions.length ? createLineSegments(positions, color, opacity) : null;
}

function createLineSegments(positions, color, opacity) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.renderOrder = 12;
  return lines;
}

function createPointDebugMesh(points, color, yOffset, size) {
  if (!points.length) {
    return null;
  }

  const positions = [];
  for (const point of points) {
    positions.push(point.position.x, point.position.y + yOffset, point.position.z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color,
    size,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    depthTest: false
  });
  const pointCloud = new THREE.Points(geometry, material);
  pointCloud.renderOrder = 13;
  return pointCloud;
}

function clearDebugGroup(root) {
  for (let index = root.children.length - 1; index >= 0; index -= 1) {
    const child = root.children[index];
    root.remove(child);
    disposeDebugObject(child);
  }
}

function disposeDebugObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        material?.dispose?.();
      }
      return;
    }
    child.material?.dispose?.();
  });
}

function getStageTrafficSettings(agentTraffic, stageId) {
  const override = agentTraffic.stageOverrides?.[stageId] || {};
  return {
    vehicleCount: override.vehicleCount ?? agentTraffic.defaultVehicleCount,
    pedestrianCount: override.pedestrianCount ?? agentTraffic.defaultPedestrianCount
  };
}

function dampAngle(current, target, lambda, deltaSeconds) {
  const delta = THREE.MathUtils.euclideanModulo(target - current + Math.PI, Math.PI * 2) - Math.PI;
  return current + delta * (1 - Math.exp(-lambda * deltaSeconds));
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function getCachedMaterial(key, factory) {
  if (!MATERIAL_CACHE.has(key)) {
    MATERIAL_CACHE.set(key, factory());
  }
  return MATERIAL_CACHE.get(key);
}
