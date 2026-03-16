import * as THREE from 'three';
import { Crowd, NavMeshQuery, getNavMeshPositionsAndIndices } from '@recast-navigation/core';

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const ORIENT_QUAT = new THREE.Quaternion();
const VEHICLE_COLORS = ['#f25f5c', '#247ba0', '#f4d35e', '#70c1b3', '#9b5de5', '#ef476f'];
const PEDESTRIAN_COLORS = ['#f2b880', '#8ecae6', '#a7c957', '#e5989b', '#ffb703', '#cdb4db'];
const SHARED_GEOMETRIES = {
  vehicleBody: new THREE.BoxGeometry(1.86, 0.56, 4.12),
  vehicleCabin: new THREE.BoxGeometry(1.28, 0.42, 1.84),
  pedestrianBody: new THREE.CapsuleGeometry(0.18, 0.72, 4, 8),
  pedestrianHead: new THREE.SphereGeometry(0.16, 10, 8)
};
const MATERIAL_CACHE = new Map();

const VEHICLE_AGENT_PARAMS = {
  radius: 2.2,
  height: 2.0,
  maxAcceleration: 6.0,
  maxSpeed: 10.0,
  collisionQueryRange: 8.0,
  pathOptimizationRange: 24.0,
  separationWeight: 0.5,
  updateFlags: 7,
  obstacleAvoidanceType: 0,
  queryFilterType: 0
};

const PEDESTRIAN_AGENT_PARAMS = {
  radius: 0.35,
  height: 1.8,
  maxAcceleration: 8.0,
  maxSpeed: 1.5,
  collisionQueryRange: 2.0,
  pathOptimizationRange: 8.0,
  separationWeight: 1.2,
  updateFlags: 7,
  obstacleAvoidanceType: 0,
  queryFilterType: 0
};

export function createNpcCrowdSystem({ config, state }) {
  const agentRoot = new THREE.Group();
  const debugRoot = new THREE.Group();
  agentRoot.visible = false;
  debugRoot.visible = false;

  let activeStage = null;
  let activeRevision = -1;
  let vehicleCrowd = null;
  let pedestrianCrowd = null;
  let vehicleQuery = null;
  let pedestrianQuery = null;
  let vehicleAgents = [];
  let pedestrianAgents = [];

  function teardown() {
    vehicleCrowd?.destroy();
    pedestrianCrowd?.destroy();
    vehicleQuery?.destroy();
    pedestrianQuery?.destroy();
    vehicleCrowd = null;
    pedestrianCrowd = null;
    vehicleQuery = null;
    pedestrianQuery = null;
    vehicleAgents = [];
    pedestrianAgents = [];
    while (agentRoot.children.length) agentRoot.remove(agentRoot.children[0]);
    while (debugRoot.children.length) debugRoot.remove(debugRoot.children[0]);
  }

  return {
    agentRoot,
    debugRoot,

    syncStage(stage, focusPosition) {
      if (
        stage === activeStage &&
        (stage?.agentNavigationRevision ?? 0) === activeRevision
      ) return;

      activeStage = stage || null;
      activeRevision = stage?.agentNavigationRevision ?? 0;
      teardown();

      const nav = stage?.agentNavigation;
      console.log('[npc-crowd] syncStage nav:', nav ? Object.keys(nav) : 'null', 'enabled:', config.agentTraffic.enabled);

      if (!config.agentTraffic.enabled || !nav?.vehicleNavMesh) {
        agentRoot.visible = false;
        return;
      }

      const settings = getStageTrafficSettings(config.agentTraffic, stage?.id);
      console.log('[npc-crowd] spawning vehicles:', settings.vehicleCount, 'peds:', settings.pedestrianCount);

      if (nav.vehicleNavMesh) {
        vehicleQuery = new NavMeshQuery(nav.vehicleNavMesh);
        vehicleCrowd = new Crowd(nav.vehicleNavMesh, {
          maxAgents: settings.vehicleCount,
          maxAgentRadius: 3
        });
        vehicleAgents = spawnAgents(
          'vehicle', settings.vehicleCount,
          vehicleCrowd, vehicleQuery, focusPosition, config
        );
        console.log('[npc-crowd] vehicle agents spawned:', vehicleAgents.length);
        for (const a of vehicleAgents) agentRoot.add(a.mesh);
      }

      if (nav.pedestrianNavMesh) {
        pedestrianQuery = new NavMeshQuery(nav.pedestrianNavMesh);
        pedestrianCrowd = new Crowd(nav.pedestrianNavMesh, {
          maxAgents: settings.pedestrianCount,
          maxAgentRadius: 1
        });
        pedestrianAgents = spawnAgents(
          'pedestrian', settings.pedestrianCount,
          pedestrianCrowd, pedestrianQuery, focusPosition, config
        );
        console.log('[npc-crowd] pedestrian agents spawned:', pedestrianAgents.length);
        for (const a of pedestrianAgents) agentRoot.add(a.mesh);
      }

      // Build navmesh debug helpers
      if (nav.vehicleNavMesh) {
        debugRoot.add(buildNavMeshDebug(nav.vehicleNavMesh, '#3ab4ff', '#7bd4ff', 0.3));
      }
      if (nav.pedestrianNavMesh) {
        debugRoot.add(buildNavMeshDebug(nav.pedestrianNavMesh, '#3fd97f', '#8ff0b0', 0.25));
      }

      agentRoot.visible = true;
    },

    update(stage, followPosition, deltaSeconds) {
      if (
        stage !== activeStage ||
        (stage?.agentNavigationRevision ?? 0) !== activeRevision
      ) {
        this.syncStage(stage, followPosition);
      }

      const enabled = Boolean(vehicleCrowd || pedestrianCrowd);
      agentRoot.visible = enabled;
      debugRoot.visible = enabled && Boolean(state.navDebugVisible);
      if (!enabled) return;

      const dt = Math.min(deltaSeconds, 0.1);
      const focusPos = followPosition || new THREE.Vector3();
      const despawnDistSq = config.agentTraffic.despawnDistance ** 2;

      if (vehicleCrowd) {
        vehicleCrowd.update(dt);
        for (const a of vehicleAgents) {
          tickAgent(a, vehicleQuery, focusPos, despawnDistSq);
        }
      }

      if (pedestrianCrowd) {
        pedestrianCrowd.update(dt);
        for (const a of pedestrianAgents) {
          tickAgent(a, pedestrianQuery, focusPos, despawnDistSq);
        }
      }
    },

    dispose() {
      teardown();
    }
  };
}

function spawnAgents(kind, count, crowd, query, focusPosition, config) {
  const agents = [];
  const speedRange = config.agentTraffic.speedRange[kind];
  const baseParams = kind === 'vehicle' ? VEHICLE_AGENT_PARAMS : PEDESTRIAN_AGENT_PARAMS;

  for (let i = 0; i < count; i++) {
    const spawnPt = findSpawnPoint(query, focusPosition, config.agentTraffic.spawnRadius);
    if (!spawnPt) continue;

    const speed = randomRange(speedRange[0], speedRange[1]);
    const crowdAgent = crowd.addAgent(spawnPt, { ...baseParams, maxSpeed: speed });
    if (!crowdAgent) continue;

    const targetPt = getRandomPoint(query);
    if (targetPt) crowdAgent.requestMoveTarget(targetPt);

    const mesh = kind === 'vehicle' ? createVehicleVisual(i) : createPedestrianVisual(i);
    mesh.position.set(spawnPt.x, spawnPt.y, spawnPt.z);

    agents.push({ kind, crowdAgent, mesh, idleFrames: 0 });
  }

  return agents;
}

function tickAgent(agent, query, focusPos, despawnDistSq) {
  if (!agent.crowdAgent) return;

  const pos = agent.crowdAgent.position();
  agent.mesh.position.set(pos.x, pos.y, pos.z);

  const vel = agent.crowdAgent.velocity();
  const horizSpeed = Math.hypot(vel.x, vel.z);
  if (horizSpeed > 0.1) {
    const yaw = Math.atan2(vel.x, vel.z);
    ORIENT_QUAT.setFromAxisAngle(UP_AXIS, yaw);
    agent.mesh.quaternion.copy(ORIENT_QUAT);
  }

  // Pedestrian walk bob
  if (agent.kind === 'pedestrian' && horizSpeed > 0.05) {
    agent.mesh.position.y += Math.sin(Date.now() * 0.01) * 0.03;
  }

  // Despawn if too far from player
  const agentPos3 = new THREE.Vector3(pos.x, pos.y, pos.z);
  if (agentPos3.distanceToSquared(focusPos) > despawnDistSq) {
    const newPt = findSpawnPoint(query, focusPos, 180);
    if (newPt) {
      agent.crowdAgent.teleport(newPt);
      const target = getRandomPoint(query);
      if (target) agent.crowdAgent.requestMoveTarget(target);
    }
    agent.idleFrames = 0;
    return;
  }

  // Reassign target if agent is stuck or idle
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  if (speed < 0.15) {
    agent.idleFrames++;
    if (agent.idleFrames > 60) {
      const target = getRandomPoint(query);
      if (target) agent.crowdAgent.requestMoveTarget(target);
      agent.idleFrames = 0;
    }
  } else {
    agent.idleFrames = 0;
  }
}

function findSpawnPoint(query, focusPos, radius) {
  if (focusPos?.isVector3) {
    const { success, randomPoint } = query.findRandomPointAroundCircle(focusPos, radius);
    if (success) return randomPoint;
  }
  return getRandomPoint(query);
}

function getRandomPoint(query) {
  const { success, randomPoint } = query.findRandomPoint();
  return success ? randomPoint : null;
}

function getStageTrafficSettings(agentTraffic, stageId) {
  const override = agentTraffic.stageOverrides?.[stageId] || {};
  return {
    vehicleCount: override.vehicleCount ?? agentTraffic.defaultVehicleCount,
    pedestrianCount: override.pedestrianCount ?? agentTraffic.defaultPedestrianCount
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
      new THREE.MeshStandardMaterial({ color: '#a9b5c4', roughness: 0.28, metalness: 0.04 })
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
      new THREE.MeshStandardMaterial({ color: '#f0c39b', roughness: 0.9, metalness: 0.01 })
    )
  );
  head.position.y = 1.16;
  head.castShadow = true;
  head.receiveShadow = true;
  group.add(head);
  return group;
}

function getCachedMaterial(key, factory) {
  if (!MATERIAL_CACHE.has(key)) MATERIAL_CACHE.set(key, factory());
  return MATERIAL_CACHE.get(key);
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Build a debug group for a navmesh: solid fill + wireframe overlay.
 * Vehicle navmesh is blue, pedestrian is green.
 */
function buildNavMeshDebug(navMesh, fillColor, wireColor, fillOpacity) {
  const [positions, indices] = getNavMeshPositionsAndIndices(navMesh);

  // Flatten Y to 0 — recast includes height-field walls that look like tall spikes in debug
  const posArray = new Float32Array(positions);
  for (let i = 1; i < posArray.length; i += 3) posArray[i] = 0;
  const idxArray = new Uint32Array(indices);

  const fillGeo = new THREE.BufferGeometry();
  fillGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
  fillGeo.setIndex(new THREE.BufferAttribute(idxArray, 1));
  fillGeo.computeVertexNormals();

  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.BufferAttribute(posArray.slice(), 3));
  wireGeo.setIndex(new THREE.BufferAttribute(idxArray.slice(), 1));

  const fillMesh = new THREE.Mesh(
    fillGeo,
    new THREE.MeshBasicMaterial({
      color: fillColor,
      transparent: true,
      opacity: fillOpacity,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    })
  );
  fillMesh.renderOrder = 10;

  const wireMesh = new THREE.Mesh(
    wireGeo,
    new THREE.MeshBasicMaterial({
      color: wireColor,
      wireframe: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      depthTest: false
    })
  );
  wireMesh.renderOrder = 11;

  const group = new THREE.Group();
  group.position.y = 0.08;
  group.add(fillMesh, wireMesh);
  return group;
}
