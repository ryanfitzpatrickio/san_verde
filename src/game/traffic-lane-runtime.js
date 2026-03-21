import * as THREE from 'three';

import { getRoadLaneRecord, projectPointToPath } from './autopilot.js';

const TEMP_POS = new THREE.Vector3();

export function createTrafficLaneRuntime(stageNavigation) {
  if (stageNavigation?.mode !== 'roadGraph') {
    return null;
  }

  return {
    navigation: stageNavigation,
    occupancyByLaneId: new Map(),
    reservationsByNodeKey: new Map(),
    activeAgentIds: new Set(),
    agentStateById: new Map(),
    nodeControllersByKey: buildNodeControllers(stageNavigation)
  };
}

export function beginTrafficLaneFrame(runtime, agents, crowdState, deltaSeconds = 0) {
  if (!runtime || !crowdState?.agents) {
    return;
  }

  runtime.activeAgentIds.clear();
  runtime.agentStateById.clear();
  for (const entries of runtime.occupancyByLaneId.values()) {
    entries.length = 0;
  }

  for (const agent of agents) {
    agent.trafficLaneFrame = null;
    if (agent.kind !== 'vehicle' || !agent.navState) {
      continue;
    }

    const crowdAgent = crowdState.agents[agent.agentId];
    if (!crowdAgent) {
      continue;
    }

    const roadRecord = runtime.navigation.roadsById.get(agent.navState.roadId);
    const laneRecord = getRoadLaneRecord(roadRecord, agent.navState.direction, agent.navState.laneIndex);
    if (!roadRecord || !laneRecord?.path) {
      continue;
    }

    TEMP_POS.set(crowdAgent.position[0] || 0, crowdAgent.position[1] || 0, crowdAgent.position[2] || 0);
    const sample = projectPointToPath(laneRecord.path, TEMP_POS);
    const entry = {
      agentId: agent.agentId,
      distanceAlong: sample.distanceAlong,
      speed: Math.hypot(crowdAgent.velocity?.[0] || 0, crowdAgent.velocity?.[2] || 0),
      roadId: roadRecord.id,
      direction: agent.navState.direction,
      laneIndex: laneRecord.index,
      laneId: laneRecord.id
    };

    agent.trafficLaneFrame = entry;
    runtime.activeAgentIds.add(agent.agentId);
    runtime.agentStateById.set(agent.agentId, {
      laneRoute: agent.lastLaneRoute || null,
      laneFrame: entry
    });

    let bucket = runtime.occupancyByLaneId.get(laneRecord.id);
    if (!bucket) {
      bucket = [];
      runtime.occupancyByLaneId.set(laneRecord.id, bucket);
    }
    bucket.push(entry);
  }

  for (const entries of runtime.occupancyByLaneId.values()) {
    entries.sort((left, right) => left.distanceAlong - right.distanceAlong);
  }

  for (const [nodeKey, reservation] of runtime.reservationsByNodeKey) {
    if (!runtime.activeAgentIds.has(reservation.agentId)) {
      runtime.reservationsByNodeKey.delete(nodeKey);
      continue;
    }

    const owner = agents.find((agent) => agent.agentId === reservation.agentId);
    const route = owner?.lastLaneRoute;
    if (!route) {
      runtime.reservationsByNodeKey.delete(nodeKey);
      continue;
    }

    const stillApproachingFromSource =
      route.roadId === reservation.sourceRoadId &&
      route.nodeKey === nodeKey &&
      route.approachingIntersection;
    const stillClearingOnTarget =
      route.roadId === reservation.plannedRoadId &&
      Number.isFinite(route.currentDistanceAlong) &&
      route.currentDistanceAlong < 18;

    reservation.heldSeconds = (reservation.heldSeconds || 0) + Math.max(deltaSeconds || 0, 0);
    if (stillApproachingFromSource && Number.isFinite(route.distanceToNode)) {
      const previousDistance = Number.isFinite(reservation.lastDistanceToNode)
        ? reservation.lastDistanceToNode
        : route.distanceToNode;
      const progressDelta = previousDistance - route.distanceToNode;
      reservation.lastDistanceToNode = route.distanceToNode;
      if (progressDelta < 0.2) {
        reservation.stalledSeconds = (reservation.stalledSeconds || 0) + Math.max(deltaSeconds || 0, 0);
      } else {
        reservation.stalledSeconds = 0;
      }
    } else {
      reservation.lastDistanceToNode = Number.NaN;
      reservation.stalledSeconds = 0;
    }

    if ((reservation.heldSeconds || 0) > 8 || (reservation.stalledSeconds || 0) > 3) {
      runtime.reservationsByNodeKey.delete(nodeKey);
      continue;
    }

    if (!stillApproachingFromSource && !stillClearingOnTarget) {
      runtime.reservationsByNodeKey.delete(nodeKey);
    }
  }

  for (const [nodeKey, controller] of runtime.nodeControllersByKey) {
    const reservation = runtime.reservationsByNodeKey.get(nodeKey) || null;
    updateNodeController(runtime, nodeKey, controller, reservation, deltaSeconds);
  }
}

export function evaluateTrafficLaneBehavior(runtime, agent, laneRoute) {
  if (!runtime || agent.kind !== 'vehicle' || !laneRoute || !agent.trafficLaneFrame) {
    return null;
  }

  const frame = agent.trafficLaneFrame;
  const occupancy = runtime.occupancyByLaneId.get(frame.laneId) || [];
  const currentIndex = occupancy.findIndex((entry) => entry.agentId === frame.agentId);
  const lead = currentIndex >= 0 ? occupancy[currentIndex + 1] || null : null;

  let desiredSpeed = Number.POSITIVE_INFINITY;
  let leadDistance = Number.POSITIVE_INFINITY;
  if (lead) {
    leadDistance = Math.max(lead.distanceAlong - frame.distanceAlong - 5.2, 0);
    const safeGap = Math.max(4.5, 3.2 + frame.speed * 0.95);
    if (leadDistance < safeGap + 12) {
      const gapSpeed = THREE.MathUtils.clamp((leadDistance - safeGap) * 0.95, 0, agent.baseMaxSpeed);
      desiredSpeed = Math.min(desiredSpeed, Math.max(0, Math.min(lead.speed + 1.4, gapSpeed)));
    }
  }

  let preferredLaneIndex = frame.laneIndex;
  const lanes = runtime.navigation.roadsById.get(laneRoute.roadId)?.lanesByDirection?.[laneRoute.direction] || [];
  if (lanes.length > 1 && laneRoute.approachingIntersection && laneRoute.plannedRoadId) {
    preferredLaneIndex = resolvePreferredLaneIndex(laneRoute.plannedTurnType, lanes.length, frame.laneIndex);
  }

  let stopDistance = Number.POSITIVE_INFINITY;
  let reservedBySelf = false;
  const leftTurnYield = evaluateLeftTurnYield(runtime, agent, laneRoute);
  if (laneRoute.nodeKey && Number.isFinite(laneRoute.distanceToNode)) {
    stopDistance = Math.max(laneRoute.distanceToNode - 4.8, 0);
    const reservation = runtime.reservationsByNodeKey.get(laneRoute.nodeKey);
    const nodeController = runtime.nodeControllersByKey.get(laneRoute.nodeKey) || null;
    const phaseAllowsEntry = !nodeController || nodeController.activeRoadIds.has(laneRoute.roadId);
    reservedBySelf = reservation?.agentId === agent.agentId;

    if (!reservedBySelf) {
      const reservationClear = !reservation;
      const closeEnoughToReserve = stopDistance < 7.5;
      const leadClear = leadDistance > 7.5 || !Number.isFinite(leadDistance);
      if (phaseAllowsEntry && reservationClear && closeEnoughToReserve && leadClear) {
        runtime.reservationsByNodeKey.set(laneRoute.nodeKey, {
          agentId: agent.agentId,
          sourceRoadId: laneRoute.roadId,
          roadId: laneRoute.roadId,
          plannedRoadId: laneRoute.plannedRoadId || null,
          heldSeconds: 0,
          stalledSeconds: 0,
          lastDistanceToNode: laneRoute.distanceToNode
        });
        reservedBySelf = true;
      }
    }

    if ((!reservedBySelf || !phaseAllowsEntry || leftTurnYield.mustYield) && laneRoute.approachingIntersection) {
      desiredSpeed = Math.min(
        desiredSpeed,
        computeStopLineSpeed(stopDistance, agent.baseMaxSpeed, leadDistance)
      );
    }
  }

  return {
    desiredSpeed: Number.isFinite(desiredSpeed) ? desiredSpeed : null,
    leadDistance,
    stopDistance,
    reservedBySelf,
    leftTurnYield,
    preferredLaneIndex
  };
}

export function summarizeTrafficLaneRuntime(runtime) {
  if (!runtime) {
    return 'Traffic: n/a';
  }

  let occupiedLanes = 0;
  let queuedVehicles = 0;
  for (const entries of runtime.occupancyByLaneId.values()) {
    if (!entries.length) {
      continue;
    }
    occupiedLanes += 1;
    if (entries.length > 1) {
      queuedVehicles += entries.length - 1;
    }
  }

  const reservations = runtime.reservationsByNodeKey.size;
  const phasedNodes = runtime.nodeControllersByKey.size;
  return `Traffic: lanes ${occupiedLanes} | queue ${queuedVehicles} | reservations ${reservations} | phased ${phasedNodes}`;
}

function resolvePreferredLaneIndex(turnType, laneCount, currentLaneIndex) {
  switch (turnType) {
    case 'left':
      return 0;
    case 'right':
      return laneCount - 1;
    default:
      return THREE.MathUtils.clamp(Number(currentLaneIndex) || 0, 0, laneCount - 1);
  }
}

function computeStopLineSpeed(stopDistance, maxSpeed, leadDistance = Number.POSITIVE_INFINITY) {
  if (stopDistance <= 0.75) {
    return 0;
  }
  if (Number.isFinite(leadDistance) && leadDistance < 6.5) {
    return 0;
  }
  if (stopDistance >= 12) {
    return maxSpeed;
  }
  return THREE.MathUtils.clamp((stopDistance - 0.75) * 0.9, 0, maxSpeed);
}

function evaluateLeftTurnYield(runtime, agent, laneRoute) {
  if (
    !runtime ||
    !laneRoute ||
    laneRoute.plannedTurnType !== 'left' ||
    !laneRoute.nodeKey ||
    !laneRoute.approachingIntersection
  ) {
    return LEFT_TURN_YIELD_NONE;
  }

  const roadRecord = runtime.navigation.roadsById.get(laneRoute.roadId);
  const opposingLanes = roadRecord?.lanesByDirection?.[-laneRoute.direction] || [];
  if (!opposingLanes.length) {
    return LEFT_TURN_YIELD_NONE;
  }

  let nearestConflictDistance = Number.POSITIVE_INFINITY;
  for (const lane of opposingLanes) {
    const entries = runtime.occupancyByLaneId.get(lane.id) || [];
    for (const entry of entries) {
      if (entry.agentId === agent.agentId) {
        continue;
      }
      const otherState = runtime.agentStateById.get(entry.agentId);
      const otherRoute = otherState?.laneRoute;
      if (!otherRoute || otherRoute.nodeKey !== laneRoute.nodeKey) {
        continue;
      }
      if (!otherRoute.approachingIntersection) {
        continue;
      }

      const otherGoingLeft = otherRoute.plannedTurnType === 'left';
      if (otherGoingLeft) {
        continue;
      }

      const otherDistance = Number.isFinite(otherRoute.distanceToNode)
        ? otherRoute.distanceToNode
        : Number.POSITIVE_INFINITY;
      nearestConflictDistance = Math.min(nearestConflictDistance, otherDistance);
    }
  }

  if (!Number.isFinite(nearestConflictDistance)) {
    return LEFT_TURN_YIELD_NONE;
  }

  return {
    mustYield: nearestConflictDistance < 14,
    distance: nearestConflictDistance
  };
}

const LEFT_TURN_YIELD_NONE = Object.freeze({
  mustYield: false,
  distance: Number.POSITIVE_INFINITY
});

function buildNodeControllers(navigation) {
  const controllers = new Map();
  for (const [nodeKey, node] of navigation.nodesByKey) {
    const controller = createNodeController(node);
    if (controller) {
      controllers.set(nodeKey, controller);
    }
  }
  return controllers;
}

function createNodeController(node) {
  const connections = Array.isArray(node?.connections) ? node.connections : [];
  if (connections.length < 3) {
    return null;
  }

  const primary = connections
    .map((connection) => connection.direction.clone().setY(0).normalize())
    .find((direction) => direction.lengthSq() > 0.0001);
  if (!primary) {
    return null;
  }
  const secondary = new THREE.Vector3(primary.z, 0, -primary.x).normalize();
  const groups = [new Set(), new Set()];

  for (const connection of connections) {
    const direction = connection.direction.clone().setY(0).normalize();
    const primaryDot = Math.abs(direction.dot(primary));
    const secondaryDot = Math.abs(direction.dot(secondary));
    const groupIndex = primaryDot >= secondaryDot ? 0 : 1;
    for (const roadId of connection.roadIds || []) {
      groups[groupIndex].add(roadId);
    }
  }

  if (!groups[0].size || !groups[1].size) {
    return null;
  }

  return {
    phaseIndex: 0,
    elapsed: 0,
    interval: 5.5,
    minGreen: 1.6,
    groupRoadIds: groups,
    activeRoadIds: groups[0]
  };
}

function advanceNodeController(controller, deltaSeconds) {
  controller.elapsed += Math.max(deltaSeconds || 0, 0);
  if (controller.elapsed < controller.interval) {
    return;
  }
  controller.elapsed = 0;
  controller.phaseIndex = (controller.phaseIndex + 1) % controller.groupRoadIds.length;
  controller.activeRoadIds = controller.groupRoadIds[controller.phaseIndex];
}

function updateNodeController(runtime, nodeKey, controller, reservation, deltaSeconds) {
  controller.elapsed += Math.max(deltaSeconds || 0, 0);
  const activeQueue = countNodeQueue(runtime, nodeKey, controller.groupRoadIds[controller.phaseIndex]);
  const nextPhaseIndex = (controller.phaseIndex + 1) % controller.groupRoadIds.length;
  const nextQueue = countNodeQueue(runtime, nodeKey, controller.groupRoadIds[nextPhaseIndex]);

  if (reservation) {
    if (controller.elapsed >= controller.interval) {
      controller.elapsed = controller.minGreen;
    }
    return;
  }

  const shouldFlipEarly =
    controller.elapsed >= controller.minGreen &&
    (
      (activeQueue === 0 && nextQueue > 0) ||
      (nextQueue > activeQueue + 1)
    );
  if (shouldFlipEarly || controller.elapsed >= controller.interval) {
    controller.elapsed = 0;
    controller.phaseIndex = nextPhaseIndex;
    controller.activeRoadIds = controller.groupRoadIds[controller.phaseIndex];
  }
}

function countNodeQueue(runtime, nodeKey, roadIds) {
  let count = 0;
  for (const state of runtime.agentStateById.values()) {
    const route = state?.laneRoute;
    if (!route || route.nodeKey !== nodeKey || !route.approachingIntersection) {
      continue;
    }
    if (!roadIds.has(route.roadId)) {
      continue;
    }
    if (Number.isFinite(route.distanceToNode) && route.distanceToNode < 26) {
      count += 1;
    }
  }
  return count;
}
