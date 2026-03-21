import * as THREE from 'three';
import {
  createDefaultQueryFilter,
  createFindNearestPolyResult,
  findNearestPoly,
  findRandomPoint,
  findRandomPointAroundCircle
} from 'navcat';
import { crowd } from 'navcat/blocks';
import { createNavMeshHelper } from 'navcat/three';
import { getBuiltInNpcArchetypesForCrowdKind } from '../assets/npc-registry.js';
import { createNpcActor } from './npc-actor.js';

const NEAREST_RESULT = createFindNearestPolyResult();
const DEFAULT_SEARCH_HALF_EXTENTS = [18, 6, 18];

const VEHICLE_AGENT_PARAMS = {
  radius: 2.2,
  height: 2.0,
  maxAcceleration: 6.0,
  maxSpeed: 10.0,
  collisionQueryRange: 8.0,
  pathOptimizationRange: 24.0,
  separationWeight: 0.5,
  updateFlags:
    crowd.CrowdUpdateFlags.ANTICIPATE_TURNS |
    crowd.CrowdUpdateFlags.OBSTACLE_AVOIDANCE |
    crowd.CrowdUpdateFlags.SEPARATION
};

const PEDESTRIAN_AGENT_PARAMS = {
  radius: 0.35,
  height: 1.8,
  maxAcceleration: 8.0,
  maxSpeed: 1.5,
  collisionQueryRange: 2.0,
  pathOptimizationRange: 8.0,
  separationWeight: 1.2,
  updateFlags:
    crowd.CrowdUpdateFlags.ANTICIPATE_TURNS |
    crowd.CrowdUpdateFlags.OBSTACLE_AVOIDANCE |
    crowd.CrowdUpdateFlags.SEPARATION
};

export function createNpcCrowdSystem({ config, state }) {
  const agentRoot = new THREE.Group();
  const debugRoot = new THREE.Group();
  agentRoot.visible = false;
  debugRoot.visible = false;

  let activeStage = null;
  let activeRevision = -1;
  let vehicleRuntime = null;
  let pedestrianRuntime = null;

  const prevFocusPos = new THREE.Vector3();
  const playerVelocity = new THREE.Vector3();
  let velocityInitialized = false;

  function teardown() {
    disposeRuntime(vehicleRuntime);
    disposeRuntime(pedestrianRuntime);
    vehicleRuntime = null;
    pedestrianRuntime = null;

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
      if (!config.agentTraffic.enabled || (!nav?.vehicleNavMesh && !nav?.pedestrianNavMesh)) {
        agentRoot.visible = false;
        debugRoot.visible = false;
        return;
      }

      const settings = getStageTrafficSettings(config.agentTraffic, stage?.id);

      if (nav.vehicleNavMesh) {
        vehicleRuntime = createCrowdRuntime('vehicle', settings.vehicleCount, nav.vehicleNavMesh, focusPosition, config, {
          agentRoot,
          debugRoot
        });
        mountRuntime(vehicleRuntime);
      }

      if (nav.pedestrianNavMesh) {
        pedestrianRuntime = createCrowdRuntime('pedestrian', settings.pedestrianCount, nav.pedestrianNavMesh, focusPosition, config, {
          agentRoot,
          debugRoot
        });
        mountRuntime(pedestrianRuntime);
      }

      const enabled = Boolean(vehicleRuntime || pedestrianRuntime);
      agentRoot.visible = enabled;
      debugRoot.visible = enabled && Boolean(state.navDebugVisible);
    },

    update(stage, followPosition, deltaSeconds) {
      if (
        stage !== activeStage ||
        (stage?.agentNavigationRevision ?? 0) !== activeRevision
      ) {
        this.syncStage(stage, followPosition);
      }

      const enabled = Boolean(vehicleRuntime || pedestrianRuntime);
      agentRoot.visible = enabled;
      debugRoot.visible = enabled && Boolean(state.navDebugVisible);
      if (!enabled) return;

      const dt = Math.min(deltaSeconds, 0.1);
      const focusPos = followPosition || new THREE.Vector3();
      const despawnDist = config.agentTraffic.despawnDistance;

      if (!velocityInitialized) {
        prevFocusPos.copy(focusPos);
        velocityInitialized = true;
      }
      const rawVelocity = new THREE.Vector3().subVectors(focusPos, prevFocusPos).divideScalar(Math.max(dt, 0.001));
      playerVelocity.lerp(rawVelocity, 0.12);
      prevFocusPos.copy(focusPos);

      if (vehicleRuntime) updateCrowdRuntime(vehicleRuntime, focusPos, playerVelocity, despawnDist, dt);
      if (pedestrianRuntime) updateCrowdRuntime(pedestrianRuntime, focusPos, playerVelocity, despawnDist, dt);
    },

    dispose() {
      teardown();
      agentRoot.visible = false;
      debugRoot.visible = false;
    }
  };
}

function mountRuntime(runtime) {
  if (!runtime) return;
  for (const agent of runtime.agents) {
    runtime.agentRoot.add(agent.actor.root);
  }
  if (runtime.debugHelper) {
    runtime.debugRoot.add(runtime.debugHelper.object);
  }
}

function disposeRuntime(runtime) {
  if (!runtime) return;
  for (const agent of runtime.agents || []) {
    agent.actor?.dispose?.();
  }
  runtime.debugHelper?.dispose();
}

function createCrowdRuntime(kind, count, navMesh, focusPosition, config, roots) {
  const queryFilter = createDefaultQueryFilter();
  const speedRange = config.agentTraffic.speedRange[kind];
  const baseParams = kind === 'vehicle' ? VEHICLE_AGENT_PARAMS : PEDESTRIAN_AGENT_PARAMS;
  const crowdState = crowd.create(baseParams.radius);
  const agents = [];
  const archetypes = getBuiltInNpcArchetypesForCrowdKind(kind);

  for (let i = 0; i < count; i++) {
    const spawn = findSpawnPoint(navMesh, queryFilter, focusPosition, config.agentTraffic.spawnRadius);
    if (!spawn) continue;

    const maxSpeed = randomRange(speedRange[0], speedRange[1]);
    const agentParams = {
      ...baseParams,
      maxSpeed,
      queryFilter
    };
    const agentId = crowd.addAgent(crowdState, navMesh, spawn.position, agentParams);
    const archetype = archetypes.length ? archetypes[i % archetypes.length] : null;
    const actor = createNpcActor({
      archetype,
      crowdKind: kind,
      index: i
    });
    actor.updatePresentation({
      position: spawn.position,
      yaw: 0,
      speed: 0,
      timeSeconds: 0
    });

    agents.push({
      kind,
      agentId,
      actor,
      agentParams,
      idleFrames: 0,
      yaw: 0
    });

    assignRandomTarget(crowdState, navMesh, queryFilter, agentId);
  }

  const debugHelper = createNavMeshHelper(navMesh);
  debugHelper.object.position.y += 0.08;

  return {
    kind,
    navMesh,
    crowd: crowdState,
    queryFilter,
    agents,
    elapsedTime: 0,
    agentRoot: roots.agentRoot,
    debugRoot: roots.debugRoot,
    debugHelper
  };
}

function updateCrowdRuntime(runtime, focusPos, playerVelocity, despawnDist, deltaSeconds) {
  runtime.elapsedTime += deltaSeconds;
  crowd.update(runtime.crowd, runtime.navMesh, deltaSeconds);

  for (const agent of runtime.agents) {
    tickAgent(runtime, agent, focusPos, playerVelocity, despawnDist, deltaSeconds);
  }
}

function tickAgent(runtime, agent, focusPos, playerVelocity, despawnDist, deltaSeconds) {
  const crowdAgent = runtime.crowd.agents[agent.agentId];
  if (!crowdAgent) return;

  const pos = crowdAgent.position;
  const vel = crowdAgent.velocity;
  const horizSpeed = Math.hypot(vel[0], vel[2]);
  if (horizSpeed > 0.1) {
    agent.yaw = Math.atan2(vel[0], vel[2]);
  }
  agent.actor.updatePresentation({
    position: pos,
    yaw: agent.yaw,
    speed: horizSpeed,
    velocity: vel,
    timeSeconds: runtime.elapsedTime,
    deltaSeconds
  });

  const dx = pos[0] - focusPos.x;
  const dz = pos[2] - focusPos.z;
  const distSq = dx * dx + dz * dz;
  const speed2D = Math.hypot(playerVelocity.x, playerVelocity.z);
  let effectiveDespawn = despawnDist;
  if (speed2D > 0.5) {
    const fwdX = playerVelocity.x / speed2D;
    const fwdZ = playerVelocity.z / speed2D;
    const dot = (dx / Math.sqrt(distSq + 0.001)) * fwdX + (dz / Math.sqrt(distSq + 0.001)) * fwdZ;
    effectiveDespawn = despawnDist * (dot < 0 ? 0.55 : 1.0);
  }

  if (distSq > effectiveDespawn * effectiveDespawn) {
    const spawn = findForwardSpawnPoint(runtime.navMesh, runtime.queryFilter, focusPos, playerVelocity, despawnDist * 0.8);
    if (spawn) {
      respawnAgent(runtime, agent, spawn);
    }
    return;
  }

  if (crowd.isAgentAtTarget(runtime.crowd, agent.agentId, agent.kind === 'vehicle' ? 5 : 1.25)) {
    assignRandomTarget(runtime.crowd, runtime.navMesh, runtime.queryFilter, agent.agentId);
    agent.idleFrames = 0;
    return;
  }

  const speed = Math.hypot(vel[0], vel[1], vel[2]);
  if (speed < 0.15) {
    agent.idleFrames++;
    if (agent.idleFrames > 60) {
      assignRandomTarget(runtime.crowd, runtime.navMesh, runtime.queryFilter, agent.agentId);
      agent.idleFrames = 0;
    }
  } else {
    agent.idleFrames = 0;
  }
}

function respawnAgent(runtime, agent, spawn) {
  crowd.removeAgent(runtime.crowd, agent.agentId);
  agent.agentId = crowd.addAgent(runtime.crowd, runtime.navMesh, spawn.position, agent.agentParams);
  agent.actor.updatePresentation({
    position: spawn.position,
    yaw: agent.yaw,
    speed: 0,
    timeSeconds: runtime.elapsedTime,
    deltaSeconds: 0
  });
  agent.idleFrames = 0;
  assignRandomTarget(runtime.crowd, runtime.navMesh, runtime.queryFilter, agent.agentId);
}

function assignRandomTarget(crowdState, navMesh, queryFilter, agentId) {
  const target = getRandomPoint(navMesh, queryFilter);
  if (!target) return false;
  return crowd.requestMoveTarget(crowdState, agentId, target.nodeRef, target.position);
}

function findSpawnPoint(navMesh, queryFilter, focusPos, radius) {
  if (focusPos?.isVector3) {
    const center = [focusPos.x, focusPos.y, focusPos.z];
    const nearest = findNearestPoly(NEAREST_RESULT, navMesh, center, DEFAULT_SEARCH_HALF_EXTENTS, queryFilter);
    if (nearest.success) {
      const around = findRandomPointAroundCircle(navMesh, nearest.nodeRef, nearest.position, radius, queryFilter, Math.random);
      if (around.success) return around;
    }
  }

  return getRandomPoint(navMesh, queryFilter);
}

function findForwardSpawnPoint(navMesh, queryFilter, focusPos, playerVelocity, radius) {
  const speed2D = Math.hypot(playerVelocity.x, playerVelocity.z);
  if (speed2D < 0.5 || !focusPos?.isVector3) {
    return findSpawnPoint(navMesh, queryFilter, focusPos, radius);
  }

  const center = [focusPos.x, focusPos.y, focusPos.z];
  const nearest = findNearestPoly(NEAREST_RESULT, navMesh, center, DEFAULT_SEARCH_HALF_EXTENTS, queryFilter);
  if (!nearest.success) {
    return getRandomPoint(navMesh, queryFilter);
  }

  const fwdX = playerVelocity.x / speed2D;
  const fwdZ = playerVelocity.z / speed2D;

  let bestPoint = null;
  let bestScore = -Infinity;

  for (let i = 0; i < 8; i++) {
    const candidate = findRandomPointAroundCircle(navMesh, nearest.nodeRef, nearest.position, radius, queryFilter, Math.random);
    if (!candidate.success) continue;

    const dx = candidate.position[0] - focusPos.x;
    const dz = candidate.position[2] - focusPos.z;
    const len = Math.hypot(dx, dz) + 0.001;
    const forwardDot = (dx / len) * fwdX + (dz / len) * fwdZ;
    const distBonus = len > 40 ? 0.3 : 0;
    const score = forwardDot + distBonus;
    if (score > bestScore) {
      bestScore = score;
      bestPoint = candidate;
    }
  }

  return bestPoint || findSpawnPoint(navMesh, queryFilter, focusPos, radius);
}

function getRandomPoint(navMesh, queryFilter) {
  const result = findRandomPoint(navMesh, queryFilter, Math.random);
  return result.success ? result : null;
}

function getStageTrafficSettings(agentTraffic, stageId) {
  const override = agentTraffic.stageOverrides?.[stageId] || {};
  return {
    vehicleCount: override.vehicleCount ?? agentTraffic.defaultVehicleCount,
    pedestrianCount: override.pedestrianCount ?? agentTraffic.defaultPedestrianCount
  };
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}
