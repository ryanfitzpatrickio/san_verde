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
import { createAutopilotState, resolveRoadGraphRouteTarget } from './autopilot.js';
import { createNpcActor } from './npc-actor.js';
import {
  beginTrafficLaneFrame,
  createTrafficLaneRuntime,
  evaluateTrafficLaneBehavior,
  summarizeTrafficLaneRuntime
} from './traffic-lane-runtime.js';
import {
  createNpcColliderRuntime,
  createNpcCollider,
  destroyNpcCollider,
  destroyNpcColliderRuntime,
  isNpcColliderTouchingDynamic,
  sampleNpcColliderCollision,
  updateNpcCollider
} from './npc-collider-runtime.js';

const NEAREST_RESULT = createFindNearestPolyResult();
const DEFAULT_SEARCH_HALF_EXTENTS = [18, 6, 18];
const TEMP_AGENT_POS = new THREE.Vector3();
const TEMP_AGENT_FORWARD = new THREE.Vector3();
const TEMP_LANE_TARGET = new THREE.Vector3();
const TEMP_PLAYER_BLOCK_OFFSET = new THREE.Vector3();
const TEMP_PLAYER_BLOCK_FORWARD = new THREE.Vector3();
const TEMP_PLAYER_BLOCK_RIGHT = new THREE.Vector3();
const PLAYER_BLOCK_STATE_NONE = Object.freeze({
  active: false,
  desiredSpeed: null,
  distanceAhead: Number.POSITIVE_INFINITY
});

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

  let gltfLoader = null;
  let activeStage = null;
  let activeRevision = -1;
  let vehicleRuntime = null;
  let pedestrianRuntime = null;
  let colliderRuntime = null;

  const prevFocusPos = new THREE.Vector3();
  const playerVelocity = new THREE.Vector3();
  let velocityInitialized = false;
  const fleeingNpcs = [];

  function teardown() {
    for (const npc of fleeingNpcs) {
      npc.root.removeFromParent();
    }
    fleeingNpcs.length = 0;
    disposeRuntime(vehicleRuntime);
    disposeRuntime(pedestrianRuntime);
    vehicleRuntime = null;
    pedestrianRuntime = null;
    destroyNpcColliderRuntime(colliderRuntime);
    colliderRuntime = null;

    while (agentRoot.children.length) agentRoot.remove(agentRoot.children[0]);
    while (debugRoot.children.length) debugRoot.remove(debugRoot.children[0]);
  }

  return {
    agentRoot,
    debugRoot,
    setAssetLoaders(loaders = {}) {
      gltfLoader = loaders.gltfLoader || null;
    },

    syncStage(stage, focusPosition) {
      if (
        stage === activeStage &&
        (stage?.agentNavigationRevision ?? 0) === activeRevision
      ) return;

      activeStage = stage || null;
      activeRevision = stage?.agentNavigationRevision ?? 0;
      teardown();
      colliderRuntime = createNpcColliderRuntime(stage?.physics);

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
          debugRoot,
          colliderRuntime,
          stageNavigation: stage?.navigation,
          sharedState: state,
          gltfLoader
        });
        mountRuntime(vehicleRuntime);
      }

      if (nav.pedestrianNavMesh) {
        pedestrianRuntime = createCrowdRuntime('pedestrian', settings.pedestrianCount, nav.pedestrianNavMesh, focusPosition, config, {
          agentRoot,
          debugRoot,
          colliderRuntime,
          stageNavigation: stage?.navigation,
          sharedState: state,
          gltfLoader
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
      state.trafficTakeoverBlockGraceSeconds = Math.max(
        0,
        Number(state.trafficTakeoverBlockGraceSeconds || 0) - dt
      );
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

      // Update fleeing NPCs
      for (let i = fleeingNpcs.length - 1; i >= 0; i--) {
        const npc = fleeingNpcs[i];
        npc.elapsed += dt;
        if (npc.elapsed > npc.lifetime) {
          npc.root.removeFromParent();
          fleeingNpcs.splice(i, 1);
          continue;
        }
        // Run in flee direction
        const speed = npc.elapsed < 0.3 ? npc.speed * (npc.elapsed / 0.3) : npc.speed;
        npc.root.position.x += npc.direction.x * speed * dt;
        npc.root.position.z += npc.direction.z * speed * dt;
        // Bob animation
        const bob = Math.sin(npc.elapsed * 10) * 0.03;
        npc.root.position.y = npc.baseY + bob;
      }
    },

    spawnFleeingNpc(position, fleeDirection) {
      const group = new THREE.Group();
      group.name = 'fleeing-npc';

      const bodyGeo = new THREE.CapsuleGeometry(0.18, 0.72, 4, 8);
      const bodyMat = new THREE.MeshStandardMaterial({ color: '#8B7355', roughness: 0.9, metalness: 0.02 });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 0.58;
      body.castShadow = true;
      group.add(body);

      const headGeo = new THREE.SphereGeometry(0.16, 10, 8);
      const headMat = new THREE.MeshStandardMaterial({ color: '#f0c39b', roughness: 0.9, metalness: 0.01 });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.y = 1.16;
      head.castShadow = true;
      group.add(head);

      const dirX = fleeDirection.x || 0;
      const dirZ = fleeDirection.z || 0;
      const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;

      group.position.copy(position);
      group.quaternion.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.atan2(dirX, dirZ)
      );
      agentRoot.add(group);

      fleeingNpcs.push({
        root: group,
        direction: new THREE.Vector3(dirX / dirLen, 0, dirZ / dirLen),
        speed: 4.5,
        elapsed: 0,
        lifetime: 5,
        baseY: position.y
      });
    },

    sampleCollision(origin, direction, far) {
      return sampleNpcColliderCollision(colliderRuntime, origin, direction, far);
    },

    getDebugSummary() {
      return vehicleRuntime?.laneRuntime
        ? summarizeTrafficLaneRuntime(vehicleRuntime.laneRuntime)
        : 'Traffic: n/a';
    },

    findNearbyStoppedTrafficVehicle(position, maxDistance = 6) {
      if (!vehicleRuntime || !position?.isVector3) return null;

      let closest = null;
      let closestDist = Infinity;

      for (const agent of vehicleRuntime.agents) {
        const crowdAgent = vehicleRuntime.crowd.agents[agent.agentId];
        if (!crowdAgent) continue;

        const speed = Math.hypot(
          crowdAgent.velocity[0] || 0,
          crowdAgent.velocity[1] || 0,
          crowdAgent.velocity[2] || 0
        );
        if (speed > 0.5) continue;

        const pos = crowdAgent.position;
        const dx = (pos[0] || 0) - position.x;
        const dy = (pos[1] || 0) - position.y;
        const dz = (pos[2] || 0) - position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < maxDistance && dist < closestDist) {
          closest = agent;
          closestDist = dist;
        }
      }

      return closest;
    },

    clearNearbyTrafficVehicles(position, radius = 5.5, maxCount = 5) {
      if (!vehicleRuntime || !position?.isVector3) {
        return 0;
      }

      const radiusSq = radius * radius;
      const candidates = [];
      for (const agent of vehicleRuntime.agents) {
        const dx = (agent.lastPosition?.x || 0) - position.x;
        const dz = (agent.lastPosition?.z || 0) - position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > radiusSq) {
          continue;
        }
        candidates.push({ agent, distSq });
      }

      candidates.sort((left, right) => left.distSq - right.distSq);
      let removed = 0;
      for (const candidate of candidates) {
        if (removed >= maxCount) {
          break;
        }
        this.removeTrafficAgent(candidate.agent);
        removed += 1;
      }
      return removed;
    },

    detachTrafficAgent(agent) {
      if (!vehicleRuntime) return;

      const index = vehicleRuntime.agents.indexOf(agent);
      if (index === -1) return null;

      if (colliderRuntime) {
        destroyNpcCollider(colliderRuntime, agent);
      }

      crowd.removeAgent(vehicleRuntime.crowd, agent.agentId);
      if (agent.actor?.root?.parent) {
        agent.actor.root.parent.remove(agent.actor.root);
      }
      vehicleRuntime.agents.splice(index, 1);
      return agent;
    },

    removeTrafficAgent(agent) {
      const detachedAgent = this.detachTrafficAgent(agent);
      detachedAgent?.actor?.dispose?.();
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
      index: i,
      gltfLoader: roots.gltfLoader || null
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
      baseMaxSpeed: maxSpeed,
      idleFrames: 0,
      yaw: 0,
      laneTargetRefresh: 0,
      navState: kind === 'vehicle' && roots.stageNavigation?.mode === 'roadGraph'
        ? createAutopilotState()
        : null,
      lastLaneRoute: null,
      lastLaneTarget: new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN),
      playerBlockSeconds: 0,
      laneChangeCooldown: 0,
      blockedSeconds: 0,
      stuckSeconds: 0,
      lastPosition: new THREE.Vector3(spawn.position[0] || 0, spawn.position[1] || 0, spawn.position[2] || 0)
    });
    if (roots.colliderRuntime) {
      createNpcCollider(roots.colliderRuntime, agents[agents.length - 1]);
    }

    if (!(kind === 'vehicle' && roots.stageNavigation?.mode === 'roadGraph')) {
      assignRandomTarget(crowdState, navMesh, queryFilter, agentId);
    }
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
    colliderRuntime: roots.colliderRuntime || null,
    stageNavigation: roots.stageNavigation || null,
    sharedState: roots.sharedState || null,
    laneRuntime: kind === 'vehicle' ? createTrafficLaneRuntime(roots.stageNavigation) : null,
    debugHelper
  };
}

function updateCrowdRuntime(runtime, focusPos, playerVelocity, despawnDist, deltaSeconds) {
  runtime.elapsedTime += deltaSeconds;
  crowd.update(runtime.crowd, runtime.navMesh, deltaSeconds);

  if (runtime.laneRuntime) {
    beginTrafficLaneFrame(runtime.laneRuntime, runtime.agents, runtime.crowd, deltaSeconds);
  }

  for (const agent of runtime.agents) {
    tickAgent(runtime, agent, focusPos, playerVelocity, despawnDist, deltaSeconds);
  }
}

function tickAgent(runtime, agent, focusPos, playerVelocity, despawnDist, deltaSeconds) {
  const crowdAgent = runtime.crowd.agents[agent.agentId];
  if (!crowdAgent) return;

  const pos = crowdAgent.position;
  const vel = crowdAgent.velocity;
  const desiredVel = crowdAgent.desiredVelocity;
  const corners = crowdAgent.corners || [];
  const horizSpeed = Math.hypot(vel[0], vel[2]);
  const laneRoute = resolveVehicleLaneRoute(runtime, agent, pos, horizSpeed, deltaSeconds);
  agent.lastLaneRoute = laneRoute || null;
  const laneBehavior = evaluateTrafficLaneBehavior(runtime.laneRuntime, agent, laneRoute);
  if (
    laneBehavior &&
    Number.isInteger(laneBehavior.preferredLaneIndex) &&
    laneBehavior.preferredLaneIndex !== laneRoute?.laneIndex &&
    agent.laneChangeCooldown <= 0
  ) {
    if (tryMoveVehicleTowardLane(runtime, agent, laneRoute, laneBehavior.preferredLaneIndex)) {
      agent.laneChangeCooldown = 0.9;
    }
  }
  const playerBlock = resolvePlayerTrafficBlock(runtime, agent, pos, focusPos, playerVelocity, laneRoute, deltaSeconds);
  const laneLimitedSpeed = Number.isFinite(laneBehavior?.desiredSpeed)
    ? laneBehavior.desiredSpeed
    : agent.baseMaxSpeed;
  const playerLimitedSpeed = playerBlock.active
    ? Math.max(0.01, Math.min(agent.baseMaxSpeed, playerBlock.desiredSpeed ?? agent.baseMaxSpeed))
    : agent.baseMaxSpeed;
  crowdAgent.maxSpeed = Math.max(0.01, Math.min(agent.baseMaxSpeed, laneLimitedSpeed, playerLimitedSpeed));
  if (horizSpeed > 0.1) {
    agent.yaw = Math.atan2(vel[0], vel[2]);
  } else if (laneRoute?.targetTangent) {
    agent.yaw = Math.atan2(laneRoute.targetTangent.x, laneRoute.targetTangent.z);
  } else if (corners.length) {
    const nextCorner = corners[0]?.position;
    if (Array.isArray(nextCorner)) {
      const dx = nextCorner[0] - pos[0];
      const dz = nextCorner[2] - pos[2];
      if (Math.hypot(dx, dz) > 0.25) {
        agent.yaw = Math.atan2(dx, dz);
      }
    }
  }
  if (runtime.colliderRuntime) {
    updateNpcCollider(runtime.colliderRuntime, agent, pos, agent.yaw);
  }
  const collisionBlocked = runtime.colliderRuntime
    ? isNpcColliderTouchingDynamic(runtime.colliderRuntime, agent)
    : false;
  if (agent.kind === 'vehicle' && playerBlock.active) {
    crowdAgent.position[0] = agent.lastPosition.x;
    crowdAgent.position[1] = agent.lastPosition.y;
    crowdAgent.position[2] = agent.lastPosition.z;
    crowdAgent.velocity[0] = 0;
    crowdAgent.velocity[1] = 0;
    crowdAgent.velocity[2] = 0;
    crowdAgent.desiredVelocity[0] = 0;
    crowdAgent.desiredVelocity[1] = 0;
    crowdAgent.desiredVelocity[2] = 0;
    if (runtime.colliderRuntime) {
      updateNpcCollider(runtime.colliderRuntime, agent, crowdAgent.position, agent.yaw);
    }
  }
  agent.actor.updatePresentation({
    position: crowdAgent.position,
    yaw: agent.yaw,
    speed: collisionBlocked && agent.kind === 'vehicle' ? 0 : horizSpeed,
    velocity: crowdAgent.velocity,
    desiredVelocity: crowdAgent.desiredVelocity,
    corners,
    laneTargetPoint: laneRoute?.targetPoint || null,
    laneTargetTangent: laneRoute?.targetTangent || null,
    laneDesiredSpeed: Math.min(
      laneRoute?.desiredSpeed ?? agent.baseMaxSpeed,
      laneLimitedSpeed,
      playerBlock.active
        ? (playerBlock.desiredSpeed ?? agent.baseMaxSpeed)
        : agent.baseMaxSpeed
    ),
    targetPosition: crowdAgent.targetPosition,
    targetState: crowdAgent.targetState,
    timeSeconds: runtime.elapsedTime,
    deltaSeconds
  });

  const dx = crowdAgent.position[0] - focusPos.x;
  const dz = crowdAgent.position[2] - focusPos.z;
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
    if (agent.navState && runtime.stageNavigation?.mode === 'roadGraph') {
      agent.laneTargetRefresh = 0;
      agent.lastLaneTarget.set(Number.NaN, Number.NaN, Number.NaN);
    } else {
      assignRandomTarget(runtime.crowd, runtime.navMesh, runtime.queryFilter, agent.agentId);
    }
    agent.idleFrames = 0;
    agent.stuckSeconds = 0;
    agent.lastPosition.set(pos[0] || 0, pos[1] || 0, pos[2] || 0);
    return;
  }

  const speed = Math.hypot(vel[0], vel[1], vel[2]);
  if (speed < 0.15) {
    agent.idleFrames++;
    if (agent.idleFrames > 60) {
      if (agent.navState && runtime.stageNavigation?.mode === 'roadGraph') {
        agent.laneTargetRefresh = 0;
        agent.lastLaneTarget.set(Number.NaN, Number.NaN, Number.NaN);
      } else {
        assignRandomTarget(runtime.crowd, runtime.navMesh, runtime.queryFilter, agent.agentId);
      }
      agent.idleFrames = 0;
    }
  } else {
    agent.idleFrames = 0;
  }

  updateAgentStuckState(runtime, agent, crowdAgent, deltaSeconds, focusPos, playerVelocity, despawnDist, collisionBlocked);
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
  agent.stuckSeconds = 0;
  agent.blockedSeconds = 0;
  agent.laneTargetRefresh = 0;
  agent.lastLaneRoute = null;
  agent.lastLaneTarget.set(Number.NaN, Number.NaN, Number.NaN);
  agent.lastPosition.set(spawn.position[0] || 0, spawn.position[1] || 0, spawn.position[2] || 0);
  if (runtime.colliderRuntime) {
    updateNpcCollider(runtime.colliderRuntime, agent, spawn.position, agent.yaw);
  }
  if (!(agent.navState && runtime.stageNavigation?.mode === 'roadGraph')) {
    assignRandomTarget(runtime.crowd, runtime.navMesh, runtime.queryFilter, agent.agentId);
  }
}

function updateAgentStuckState(runtime, agent, crowdAgent, deltaSeconds, focusPos, playerVelocity, despawnDist, collisionBlocked) {
  if (agent.kind !== 'vehicle') {
    agent.lastPosition.set(crowdAgent.position[0] || 0, crowdAgent.position[1] || 0, crowdAgent.position[2] || 0);
    return;
  }

  const desiredSpeed = Math.hypot(
    crowdAgent.desiredVelocity?.[0] || 0,
    crowdAgent.desiredVelocity?.[1] || 0,
    crowdAgent.desiredVelocity?.[2] || 0
  );
  const actualSpeed = Math.hypot(
    crowdAgent.velocity?.[0] || 0,
    crowdAgent.velocity?.[1] || 0,
    crowdAgent.velocity?.[2] || 0
  );
  const movedDistance = agent.lastPosition.distanceToSquared(
    TEMP_AGENT_POS.set(crowdAgent.position[0] || 0, crowdAgent.position[1] || 0, crowdAgent.position[2] || 0)
  );
  const hasValidTarget = crowdAgent.targetState === crowd.AgentTargetState.VALID
    || crowdAgent.targetState === crowd.AgentTargetState.WAITING_FOR_PATH
    || crowdAgent.targetState === crowd.AgentTargetState.WAITING_FOR_QUEUE;
  const blockedByTraffic =
    collisionBlocked &&
    hasValidTarget &&
    desiredSpeed > 0.75 &&
    actualSpeed < 0.15 &&
    movedDistance < 0.01;

  if (blockedByTraffic) {
    agent.blockedSeconds = (agent.blockedSeconds || 0) + deltaSeconds;
  } else {
    agent.blockedSeconds = Math.max(0, (agent.blockedSeconds || 0) - deltaSeconds * 2);
  }

  if (hasValidTarget && desiredSpeed > 0.75 && actualSpeed < 0.15 && movedDistance < 0.01 && !collisionBlocked) {
    agent.stuckSeconds += deltaSeconds;
  } else {
    agent.stuckSeconds = Math.max(0, agent.stuckSeconds - deltaSeconds * 2);
  }

  if (
    blockedByTraffic &&
    agent.blockedSeconds > 1.35 &&
    agent.lastLaneRoute &&
    agent.lastLaneRoute.approachingIntersection &&
    agent.laneChangeCooldown <= 0 &&
    tryShiftVehicleLane(runtime, agent, agent.lastLaneRoute)
  ) {
    agent.blockedSeconds = 0.4;
    agent.laneChangeCooldown = 1.4;
  }

  if (blockedByTraffic && agent.blockedSeconds > 3.25) {
    if (agent.navState && runtime.stageNavigation?.mode === 'roadGraph') {
      agent.navState.lastDecisionKey = null;
      agent.laneTargetRefresh = 0;
      agent.lastLaneTarget.set(Number.NaN, Number.NaN, Number.NaN);
    } else {
      assignRandomTarget(runtime.crowd, runtime.navMesh, runtime.queryFilter, agent.agentId);
    }
    agent.blockedSeconds = 0;
  }

  if (agent.stuckSeconds > 4) {
    const spawn = findForwardSpawnPoint(runtime.navMesh, runtime.queryFilter, focusPos, playerVelocity, despawnDist * 0.6);
    if (spawn) {
      respawnAgent(runtime, agent, spawn);
      return;
    }
  } else if (agent.stuckSeconds > 2.2) {
    if (agent.navState && runtime.stageNavigation?.mode === 'roadGraph') {
      agent.laneTargetRefresh = 0;
      agent.lastLaneTarget.set(Number.NaN, Number.NaN, Number.NaN);
    } else {
      assignRandomTarget(runtime.crowd, runtime.navMesh, runtime.queryFilter, agent.agentId);
    }
    agent.stuckSeconds = 0;
  }

  agent.lastPosition.set(crowdAgent.position[0] || 0, crowdAgent.position[1] || 0, crowdAgent.position[2] || 0);
}

function assignRandomTarget(crowdState, navMesh, queryFilter, agentId) {
  const target = getRandomPoint(navMesh, queryFilter);
  if (!target) return false;
  return crowd.requestMoveTarget(crowdState, agentId, target.nodeRef, target.position);
}

function resolveVehicleLaneRoute(runtime, agent, position, speed, deltaSeconds) {
  if (agent.kind !== 'vehicle' || runtime.stageNavigation?.mode !== 'roadGraph' || !agent.navState) {
    return null;
  }

  TEMP_AGENT_POS.set(position[0] || 0, position[1] || 0, position[2] || 0);
  TEMP_AGENT_FORWARD.set(Math.sin(agent.yaw || 0), 0, Math.cos(agent.yaw || 0));
  const route = resolveRoadGraphRouteTarget(
    runtime.stageNavigation,
    agent.navState,
    TEMP_AGENT_POS,
    TEMP_AGENT_FORWARD,
    speed
  );
  if (!route?.targetPoint) {
    return null;
  }

  agent.laneTargetRefresh = Math.max(0, (agent.laneTargetRefresh || 0) - Math.max(deltaSeconds || 0, 0));
  const shouldRefreshTarget = agent.laneTargetRefresh <= 0
    || !Number.isFinite(agent.lastLaneTarget.x)
    || agent.lastLaneTarget.distanceToSquared(route.targetPoint) > 9;
  if (shouldRefreshTarget && requestMoveTargetAtPosition(runtime, agent.agentId, route.targetPoint)) {
    agent.lastLaneTarget.copy(route.targetPoint);
    agent.laneTargetRefresh = 0.35;
  }

  return route;
}

function resolvePlayerTrafficBlock(runtime, agent, position, focusPos, playerVelocity, laneRoute, deltaSeconds) {
  if (
    agent.kind !== 'vehicle' ||
    Number(runtime.sharedState?.trafficTakeoverBlockGraceSeconds || 0) > 0 ||
    !focusPos?.isVector3 ||
    runtime.stageNavigation?.mode !== 'roadGraph' ||
    !laneRoute?.targetTangent
  ) {
    agent.playerBlockSeconds = 0;
    agent.laneChangeCooldown = Math.max(0, (agent.laneChangeCooldown || 0) - Math.max(deltaSeconds || 0, 0));
    return PLAYER_BLOCK_STATE_NONE;
  }

  TEMP_AGENT_POS.set(position[0] || 0, position[1] || 0, position[2] || 0);
  TEMP_PLAYER_BLOCK_FORWARD.copy(laneRoute.targetTangent).setY(0);
  if (TEMP_PLAYER_BLOCK_FORWARD.lengthSq() < 1e-6) {
    TEMP_PLAYER_BLOCK_FORWARD.set(Math.sin(agent.yaw || 0), 0, Math.cos(agent.yaw || 0));
  } else {
    TEMP_PLAYER_BLOCK_FORWARD.normalize();
  }
  TEMP_PLAYER_BLOCK_RIGHT.set(TEMP_PLAYER_BLOCK_FORWARD.z, 0, -TEMP_PLAYER_BLOCK_FORWARD.x).normalize();
  TEMP_PLAYER_BLOCK_OFFSET.copy(focusPos).sub(TEMP_AGENT_POS).setY(0);

  const distanceAhead = TEMP_PLAYER_BLOCK_OFFSET.dot(TEMP_PLAYER_BLOCK_FORWARD);
  const lateralOffset = Math.abs(TEMP_PLAYER_BLOCK_OFFSET.dot(TEMP_PLAYER_BLOCK_RIGHT));
  const playerSpeed = Math.hypot(playerVelocity.x || 0, playerVelocity.z || 0);
  const forwardWindow = THREE.MathUtils.clamp(5.5 + playerSpeed * 0.7, 5.5, 10.5);
  const laneHalfWidth = runtime.stageNavigation?.roadsById
    ?.get(laneRoute.roadId)
    ?.road?.laneWidth
    ? runtime.stageNavigation.roadsById.get(laneRoute.roadId).road.laneWidth * 0.65
    : 1.8;
  const sameLevel = Math.abs((focusPos.y || 0) - (TEMP_AGENT_POS.y || 0)) < 2.4;
  const active =
    sameLevel &&
    distanceAhead > 0.4 &&
    distanceAhead < forwardWindow &&
    lateralOffset < Math.max(1.2, laneHalfWidth);

  agent.laneChangeCooldown = Math.max(0, (agent.laneChangeCooldown || 0) - Math.max(deltaSeconds || 0, 0));
  if (!active) {
    agent.playerBlockSeconds = 0;
    return PLAYER_BLOCK_STATE_NONE;
  }

  agent.playerBlockSeconds = (agent.playerBlockSeconds || 0) + Math.max(deltaSeconds || 0, 0);
  if (agent.playerBlockSeconds > 1.1 && agent.laneChangeCooldown <= 0) {
    if (tryShiftVehicleLane(runtime, agent, laneRoute)) {
      agent.playerBlockSeconds = 0;
      agent.laneChangeCooldown = 1.25;
    }
  }

  const desiredSpeed = THREE.MathUtils.clamp(
    ((distanceAhead - 1.6) / Math.max(forwardWindow - 1.6, 0.001)) * agent.baseMaxSpeed,
    0,
    agent.baseMaxSpeed
  );

  return {
    active: true,
    desiredSpeed,
    distanceAhead
  };
}

function tryShiftVehicleLane(runtime, agent, laneRoute) {
  if (!agent.navState || !runtime.stageNavigation?.roadsById) {
    return false;
  }

  const roadRecord = runtime.stageNavigation.roadsById.get(laneRoute.roadId);
  const lanes = roadRecord?.lanesByDirection?.[laneRoute.direction];
  if (!lanes || lanes.length <= 1) {
    return false;
  }

  const currentIndex = THREE.MathUtils.clamp(Number(laneRoute.laneIndex) || 0, 0, lanes.length - 1);
  const candidates = [];
  for (let offset = 1; offset < lanes.length; offset += 1) {
    const lower = currentIndex - offset;
    const upper = currentIndex + offset;
    if (lower >= 0) {
      candidates.push(lower);
    }
    if (upper < lanes.length) {
      candidates.push(upper);
    }
  }

  const nextLaneIndex = candidates.find((index) => index !== currentIndex);
  if (!Number.isInteger(nextLaneIndex)) {
    return false;
  }

  agent.navState.laneIndex = nextLaneIndex;
  agent.laneTargetRefresh = 0;
  agent.lastLaneTarget.set(Number.NaN, Number.NaN, Number.NaN);
  return true;
}

function tryMoveVehicleTowardLane(runtime, agent, laneRoute, targetLaneIndex) {
  if (!agent.navState || !runtime.stageNavigation?.roadsById || !Number.isInteger(targetLaneIndex)) {
    return false;
  }

  const roadRecord = runtime.stageNavigation.roadsById.get(laneRoute?.roadId);
  const lanes = roadRecord?.lanesByDirection?.[laneRoute?.direction];
  if (!lanes?.length) {
    return false;
  }

  const currentIndex = THREE.MathUtils.clamp(Number(laneRoute.laneIndex) || 0, 0, lanes.length - 1);
  const clampedTargetIndex = THREE.MathUtils.clamp(targetLaneIndex, 0, lanes.length - 1);
  if (clampedTargetIndex === currentIndex) {
    return false;
  }

  agent.navState.laneIndex = currentIndex + Math.sign(clampedTargetIndex - currentIndex);
  agent.laneTargetRefresh = 0;
  agent.lastLaneTarget.set(Number.NaN, Number.NaN, Number.NaN);
  return true;
}

function requestMoveTargetAtPosition(runtime, agentId, point) {
  TEMP_LANE_TARGET.copy(point);
  const nearest = findNearestPoly(
    NEAREST_RESULT,
    runtime.navMesh,
    [TEMP_LANE_TARGET.x, TEMP_LANE_TARGET.y, TEMP_LANE_TARGET.z],
    DEFAULT_SEARCH_HALF_EXTENTS,
    runtime.queryFilter
  );
  if (!nearest.success) {
    return false;
  }
  return crowd.requestMoveTarget(runtime.crowd, agentId, nearest.nodeRef, nearest.position);
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
