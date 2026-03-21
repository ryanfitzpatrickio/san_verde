import * as THREE from 'three';

const EPSILON = 1e-5;
const PROJECT_VECTOR = new THREE.Vector3();
const SEGMENT_VECTOR = new THREE.Vector3();
const CLOSEST_POINT = new THREE.Vector3();
const RIGHT_VECTOR = new THREE.Vector3();
const FORWARD_VECTOR = new THREE.Vector3();

export function createAutopilotState() {
  return {
    mode: null,
    waypointIndex: 0,
    roadId: null,
    direction: 1,
    laneIndex: 0,
    plannedTransition: null,
    lastDecisionKey: null,
    travelAxis: 'z',
    lineCoord: 0,
    chunkIndex: null
  };
}

export function buildPolylineNavigationData(points, curve = null) {
  const segmentLengths = [];
  const cumulativeLengths = [0];
  let totalLength = 0;

  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = points[index].distanceTo(points[index - 1]);
    segmentLengths.push(segmentLength);
    totalLength += segmentLength;
    cumulativeLengths.push(totalLength);
  }

  return {
    points,
    curve,
    segmentLengths,
    cumulativeLengths,
    totalLength
  };
}

export function createWaypointLoopNavigation(waypoints, options = {}) {
  return {
    mode: 'waypointLoop',
    waypoints: waypoints.map((waypoint) => waypoint.clone()),
    arrivalRadius: options.arrivalRadius ?? 6.5,
    lookAhead: options.lookAhead ?? 12,
    cruiseSpeed: options.cruiseSpeed ?? 8.5,
    turnSpeed: options.turnSpeed ?? 6
  };
}

export function createBloomvilleGridNavigation(chunkSize, options = {}) {
  return {
    mode: 'grid',
    chunkSize,
    resnapDistance: options.resnapDistance ?? 9,
    lookAheadMin: options.lookAheadMin ?? 10,
    lookAheadMax: options.lookAheadMax ?? 24,
    cruiseSpeed: options.cruiseSpeed ?? 10,
    turnSpeed: options.turnSpeed ?? 7.2,
    intersectionDecisionDistance: options.intersectionDecisionDistance ?? 11,
    turnProbability: options.turnProbability ?? 0.34
  };
}

export function createHighwayNavigation(highway, options = {}) {
  return {
    mode: 'highway',
    highway,
    resnapDistance: options.resnapDistance ?? 16,
    lookAheadMin: options.lookAheadMin ?? 16,
    lookAheadMax: options.lookAheadMax ?? 34,
    cruiseSpeed: options.cruiseSpeed ?? 17,
    turnSpeed: options.turnSpeed ?? 11.5
  };
}

export function createRoadGraphNavigation(graph, options = {}) {
  const nodesByKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const roadsById = new Map();
  const nodeRoads = new Map();
  const roadRecords = [];

  for (const road of graph.roads) {
    const path = buildPolylineNavigationData(road.points, road.curve);
    const record = {
      id: road.id,
      road,
      path,
      totalLength: path.totalLength,
      lanesByDirection: buildRoadLaneRecords(road),
      junctions: [],
      junctionsByKey: new Map()
    };

    roadsById.set(record.id, record);
    roadRecords.push(record);
  }

  for (const node of graph.nodes) {
    const connectedRoadIds = Array.from(node.roads || []);
    nodeRoads.set(node.key, connectedRoadIds);

    for (const roadId of connectedRoadIds) {
      const record = roadsById.get(roadId);
      if (!record) {
        continue;
      }

      const sample = projectPointToPath(record.path, node.point);
      if (!sample || sample.distanceSq > 1) {
        continue;
      }

      const junction = {
        nodeKey: node.key,
        point: node.point.clone(),
        distanceAlong: sample.distanceAlong
      };
      record.junctions.push(junction);
      record.junctionsByKey.set(node.key, junction);
    }
  }

  for (const record of roadRecords) {
    record.junctions.sort((left, right) => left.distanceAlong - right.distanceAlong);
  }

  return {
    mode: 'roadGraph',
    graph,
    nodesByKey,
    nodeRoads,
    roadsById,
    roadRecords,
    resnapDistance: options.resnapDistance ?? 16,
    lookAheadMin: options.lookAheadMin ?? 10,
    lookAheadMax: options.lookAheadMax ?? 24,
    intersectionDecisionDistance: options.intersectionDecisionDistance ?? 12,
    baseSpeedByClass: {
      primary: options.primarySpeed ?? 13.5,
      secondary: options.secondarySpeed ?? 10.8,
      local: options.localSpeed ?? 8.6
    },
    turnSpeed: options.turnSpeed ?? 6.8,
    laneChangeResnapDistance: options.laneChangeResnapDistance ?? 8
  };
}

export function computeAutopilotInputs({ config, controller, transform, stageNavigation }) {
  if (!stageNavigation) {
    return null;
  }

  const state = controller.autopilotState || (controller.autopilotState = createAutopilotState());
  const currentForward = getForwardVector(transform);
  let routeTarget = null;

  switch (stageNavigation.mode) {
    case 'waypointLoop':
      routeTarget = resolveWaypointLoopTarget(stageNavigation, state, transform.position);
      break;
    case 'grid':
      routeTarget = resolveGridTarget(stageNavigation, state, transform.position, currentForward, controller.speed);
      break;
    case 'highway':
      routeTarget = resolveHighwayTarget(stageNavigation, state, transform.position, currentForward, controller.speed);
      break;
    case 'roadGraph':
      routeTarget = resolveRoadGraphRouteTarget(stageNavigation, state, transform.position, currentForward, controller.speed);
      break;
    default:
      return null;
  }

  if (!routeTarget) {
    return null;
  }

  return buildAutopilotControls(config, controller, transform, routeTarget);
}

function resolveWaypointLoopTarget(navigation, state, position) {
  resetStateForMode(state, 'waypointLoop');
  if (!navigation.waypoints.length) {
    return null;
  }

  if (!Number.isInteger(state.waypointIndex) || state.waypointIndex < 0 || state.waypointIndex >= navigation.waypoints.length) {
    state.waypointIndex = findNearestWaypointIndex(navigation.waypoints, position);
  }

  let waypoint = navigation.waypoints[state.waypointIndex];
  if (position.distanceToSquared(waypoint) <= navigation.arrivalRadius * navigation.arrivalRadius) {
    state.waypointIndex = (state.waypointIndex + 1) % navigation.waypoints.length;
    waypoint = navigation.waypoints[state.waypointIndex];
  }

  const nextWaypoint = navigation.waypoints[(state.waypointIndex + 1) % navigation.waypoints.length];
  const tangent = nextWaypoint.clone().sub(waypoint).setY(0).normalize();
  const turnAngle = Math.abs(signedAngleBetweenVectors(
    waypoint.clone().sub(position).setY(0).normalize(),
    tangent
  ));

  return {
    targetPoint: waypoint.clone(),
    targetTangent: tangent.lengthSq() > EPSILON ? tangent : new THREE.Vector3(0, 0, 1),
    desiredSpeed: THREE.MathUtils.lerp(
      navigation.cruiseSpeed,
      navigation.turnSpeed,
      THREE.MathUtils.clamp(turnAngle / 1.1, 0, 1)
    )
  };
}

function resolveGridTarget(navigation, state, position, currentForward, speed) {
  resetStateForMode(state, 'grid');
  ensureGridSnap(navigation, state, position, currentForward);

  const lineError = getGridLineError(state, position);
  if (Math.abs(lineError) > navigation.resnapDistance) {
    ensureGridSnap(navigation, state, position, currentForward);
  }

  let along = state.travelAxis === 'z' ? position.z : position.x;
  let nextIntersection = getNextGridIntersection(along, state.direction, navigation.chunkSize);
  let distanceToIntersection = Math.abs(nextIntersection - along);

  if (distanceToIntersection < navigation.intersectionDecisionDistance) {
    const intersectionKey = getGridIntersectionKey(state, nextIntersection);
    if (state.lastDecisionKey !== intersectionKey) {
      chooseGridDirection(navigation, state);
      state.lastDecisionKey = intersectionKey;
      along = state.travelAxis === 'z' ? position.z : position.x;
      nextIntersection = getNextGridIntersection(along, state.direction, navigation.chunkSize);
      distanceToIntersection = Math.abs(nextIntersection - along);
    }
  }

  const lookAhead = THREE.MathUtils.clamp(
    Math.abs(speed) * 1.5 + navigation.lookAheadMin,
    navigation.lookAheadMin,
    navigation.lookAheadMax
  );
  const targetAlong = along + state.direction * lookAhead;
  const targetPoint = state.travelAxis === 'z'
    ? new THREE.Vector3(state.lineCoord, position.y, targetAlong)
    : new THREE.Vector3(targetAlong, position.y, state.lineCoord);
  const targetTangent = state.travelAxis === 'z'
    ? new THREE.Vector3(0, 0, state.direction)
    : new THREE.Vector3(state.direction, 0, 0);

  return {
    targetPoint,
    targetTangent,
    desiredSpeed: distanceToIntersection < 18 ? navigation.turnSpeed : navigation.cruiseSpeed
  };
}

function resolveHighwayTarget(navigation, state, position, currentForward, speed) {
  resetStateForMode(state, 'highway');
  const currentChunk = getChunkByIndex(navigation.highway, state.chunkIndex);
  let currentSample = currentChunk ? projectPointToPath(ensureChunkPath(currentChunk), position) : null;

  if (!currentChunk || !currentSample || Math.sqrt(currentSample.distanceSq) > navigation.resnapDistance) {
    const nearest = findNearestHighwayPath(navigation.highway, position, currentForward);
    if (!nearest) {
      return null;
    }
    state.chunkIndex = nearest.chunk.meta.index;
    state.direction = nearest.direction;
    currentSample = nearest.sample;
  }

  const lookAhead = THREE.MathUtils.clamp(
    Math.abs(speed) * 1.6 + navigation.lookAheadMin,
    navigation.lookAheadMin,
    navigation.lookAheadMax
  );
  const sample = sampleHighwayAhead(navigation.highway, state.chunkIndex, state.direction, currentSample.distanceAlong, lookAhead);
  if (!sample) {
    return null;
  }

  state.chunkIndex = sample.chunkIndex;
  const currentTravelTangent = state.direction > 0 ? currentSample.tangent : currentSample.tangent.clone().negate();
  const targetTravelTangent = state.direction > 0 ? sample.tangent : sample.tangent.clone().negate();
  const turnAngle = Math.abs(signedAngleBetweenVectors(currentTravelTangent, targetTravelTangent));
  const targetPoint = currentSample.point.clone().lerp(sample.point, 0.74);

  return {
    targetPoint,
    targetTangent: targetTravelTangent,
    desiredSpeed: THREE.MathUtils.lerp(
      navigation.cruiseSpeed,
      navigation.turnSpeed,
      THREE.MathUtils.clamp(turnAngle / 0.55, 0, 1)
    )
  };
}

export function resolveRoadGraphRouteTarget(navigation, state, position, currentForward, speed) {
  resetStateForMode(state, 'roadGraph');
  let roadRecord = state.roadId ? navigation.roadsById.get(state.roadId) : null;
  let laneRecord = roadRecord ? getRoadLaneRecord(roadRecord, state.direction, state.laneIndex) : null;
  let currentSample = laneRecord ? projectPointToPath(laneRecord.path, position) : null;
  const currentRoadLimit = roadRecord ? Math.max(navigation.resnapDistance, roadRecord.road.width * 0.85) : navigation.resnapDistance;

  if (!roadRecord || !currentSample || Math.sqrt(currentSample.distanceSq) > currentRoadLimit) {
    const nearest = findNearestGraphRoad(navigation, position, currentForward);
    if (!nearest) {
      return null;
    }
    roadRecord = nearest.roadRecord;
    laneRecord = nearest.laneRecord;
    currentSample = nearest.sample;
    state.roadId = roadRecord.id;
    state.direction = nearest.direction;
    state.laneIndex = laneRecord?.index ?? 0;
  } else if (!laneRecord || Math.sqrt(currentSample.distanceSq) > navigation.laneChangeResnapDistance) {
    laneRecord = selectNearestLaneRecord(roadRecord, state.direction, position);
    state.laneIndex = laneRecord?.index ?? 0;
    currentSample = laneRecord ? projectPointToPath(laneRecord.path, position) : currentSample;
  }

  const upcomingJunction = getUpcomingRoadJunction(roadRecord, state.direction, currentSample.distanceAlong);
  const distanceToNode = upcomingJunction
    ? Math.abs(upcomingJunction.distanceAlong - currentSample.distanceAlong)
    : Number.POSITIVE_INFINITY;
  const currentTravelTangent = state.direction > 0 ? currentSample.tangent : currentSample.tangent.clone().negate();
  let plannedTransition = null;

  if (upcomingJunction) {
    if (state.plannedTransition?.nodeKey !== upcomingJunction.nodeKey) {
      const previewChoice = chooseGraphTransition(
        navigation,
        roadRecord,
        state.direction,
        upcomingJunction.nodeKey,
        currentTravelTangent
      );
      state.plannedTransition = previewChoice
        ? {
            nodeKey: upcomingJunction.nodeKey,
            roadId: previewChoice.roadRecord.id,
            direction: previewChoice.direction,
            turnType: previewChoice.turnType
          }
        : null;
    }
    plannedTransition = state.plannedTransition;
  } else {
    state.plannedTransition = null;
  }

  if (
    upcomingJunction &&
    distanceToNode < navigation.intersectionDecisionDistance &&
    state.lastDecisionKey !== upcomingJunction.nodeKey
  ) {
    const nextChoice = plannedTransition
      ? {
          roadRecord: navigation.roadsById.get(plannedTransition.roadId),
          direction: plannedTransition.direction,
          turnType: plannedTransition.turnType
        }
      : chooseGraphTransition(
          navigation,
          roadRecord,
          state.direction,
          upcomingJunction.nodeKey,
          currentTravelTangent
        );
    state.lastDecisionKey = upcomingJunction.nodeKey;
    state.plannedTransition = null;

    if (nextChoice?.roadRecord) {
      roadRecord = nextChoice.roadRecord;
      state.roadId = roadRecord.id;
      state.direction = nextChoice.direction;
      state.laneIndex = clampLaneIndex(roadRecord, state.direction, state.laneIndex);
      laneRecord = getRoadLaneRecord(roadRecord, state.direction, state.laneIndex);
      const turnJunction = roadRecord.junctionsByKey.get(upcomingJunction.nodeKey);
      const turnSampleDistance = turnJunction
        ? THREE.MathUtils.clamp(
            turnJunction.distanceAlong + state.direction * 0.8,
            0,
            laneRecord?.path?.totalLength ?? roadRecord.totalLength
          )
        : state.direction > 0
          ? 0.6
          : Math.max((laneRecord?.path?.totalLength ?? roadRecord.totalLength) - 0.6, 0);
      currentSample = samplePathAtDistance(laneRecord?.path || roadRecord.path, turnSampleDistance);
    }
  }

  const lookAhead = THREE.MathUtils.clamp(
    Math.abs(speed) * 1.45 + navigation.lookAheadMin,
    navigation.lookAheadMin,
    navigation.lookAheadMax
  );
  const targetDistanceAlong = currentSample.distanceAlong + state.direction * lookAhead;
  const targetSample = samplePathAtDistance(laneRecord?.path || roadRecord.path, targetDistanceAlong);
  const targetTravelTangent = state.direction > 0 ? targetSample.tangent : targetSample.tangent.clone().negate();
  const targetPoint = currentSample.point.clone().lerp(targetSample.point, 0.78);
  const turnAngle = Math.abs(signedAngleBetweenVectors(currentTravelTangent, targetTravelTangent));
  const classSpeed = navigation.baseSpeedByClass[roadRecord.road.classification] ?? navigation.baseSpeedByClass.local;
  let desiredSpeed = THREE.MathUtils.lerp(
    classSpeed,
    navigation.turnSpeed,
    THREE.MathUtils.clamp(turnAngle / 0.85, 0, 1)
  );
  if (distanceToNode < navigation.intersectionDecisionDistance * 1.8) {
    desiredSpeed = Math.min(desiredSpeed, navigation.turnSpeed + 1.1);
  }

  return {
    targetPoint,
    targetTangent: targetTravelTangent,
    desiredSpeed,
    roadId: roadRecord.id,
    direction: state.direction,
    laneIndex: laneRecord?.index ?? 0,
    currentDistanceAlong: currentSample.distanceAlong,
    distanceToNode,
    approachingIntersection: distanceToNode < navigation.intersectionDecisionDistance * 1.8,
    nodeKey: upcomingJunction?.nodeKey ?? null,
    plannedRoadId: plannedTransition?.roadId ?? null,
    plannedDirection: plannedTransition?.direction ?? null,
    plannedTurnType: plannedTransition?.turnType ?? 'straight'
  };
}

function buildAutopilotControls(config, controller, transform, routeTarget) {
  const speedAbs = Math.abs(controller.speed);
  const forwardAxis = getForwardVector(transform);
  const rightAxis = new THREE.Vector3(forwardAxis.z, 0, -forwardAxis.x).normalize();
  const targetTangent = routeTarget.targetTangent.clone().setY(0).normalize();
  const targetVector = routeTarget.targetPoint.clone().sub(transform.position).setY(0);
  const tangentLookAhead = Math.max(4.5, speedAbs * 0.8 + 4.5);
  const tangentVector = targetTangent.clone().multiplyScalar(tangentLookAhead);
  const tangentProjection = targetVector.dot(targetTangent);

  if (targetVector.lengthSq() < EPSILON || tangentProjection < 2.25) {
    targetVector.copy(tangentVector);
  } else {
    targetVector.lerp(tangentVector, 0.28);
  }

  const targetYaw = Math.atan2(targetVector.x, targetVector.z);
  const tangentYaw = Math.atan2(targetTangent.x, targetTangent.z);
  const headingError = normalizeAngle(targetYaw - transform.yaw);
  const tangentError = normalizeAngle(tangentYaw - transform.yaw);
  const lateralError = targetVector.dot(rightAxis);
  const forwardError = Math.max(targetVector.dot(forwardAxis), 0.75);
  const steerStrength = config.autopilotSteerStrength ?? 0.85;
  const steerLookAhead = config.autopilotSteerLookAhead ?? 18;
  const crossTrackSteer = THREE.MathUtils.clamp(
    lateralError / Math.max(forwardError + steerLookAhead * 0.2, 3.5),
    -1,
    1
  );
  const steerInput = THREE.MathUtils.clamp(
    tangentError * (1.15 + steerStrength * 0.9) +
      headingError * 0.28 +
      crossTrackSteer * (0.55 + steerStrength * 0.45) -
      controller.yawRate * 0.26,
    -1,
    1
  );

  const headingMagnitude = Math.abs(headingError);
  const baseDesiredSpeed = Math.max(routeTarget.desiredSpeed, 2.8);
  const headingSpeedFactor = THREE.MathUtils.clamp(
    1 - THREE.MathUtils.clamp((headingMagnitude - 0.2) / 1.15, 0, 0.82),
    0.18,
    1
  );
  const desiredSpeed = Math.max(1.4, baseDesiredSpeed * headingSpeedFactor);
  let forwardInput = 0;
  let reverseInput = 0;

  if (speedAbs > desiredSpeed + 0.9) {
    reverseInput = THREE.MathUtils.clamp(
      (speedAbs - desiredSpeed) * 0.26,
      0,
      1
    );
  } else {
    forwardInput = THREE.MathUtils.clamp(
      0.24 + (desiredSpeed - speedAbs) * 0.16,
      0.18,
      config.autopilotCruiseThrottle ?? 0.82
    );
    if (headingMagnitude > 0.7) {
      forwardInput = Math.max(
        forwardInput * THREE.MathUtils.lerp(0.62, 0.4, THREE.MathUtils.clamp((headingMagnitude - 0.7) / 0.9, 0, 1)),
        0.22
      );
    }
    if (speedAbs > desiredSpeed - 0.35) {
      forwardInput *= 0.58;
    }
  }

  return {
    steerInput,
    forwardInput,
    reverseInput
  };
}

function ensureGridSnap(navigation, state, position, currentForward) {
  const nearestVertical = Math.round(position.x / navigation.chunkSize) * navigation.chunkSize;
  const nearestHorizontal = Math.round(position.z / navigation.chunkSize) * navigation.chunkSize;
  const verticalError = Math.abs(position.x - nearestVertical);
  const horizontalError = Math.abs(position.z - nearestHorizontal);

  let travelAxis = state.travelAxis;
  if (verticalError + 1.5 < horizontalError) {
    travelAxis = 'z';
  } else if (horizontalError + 1.5 < verticalError) {
    travelAxis = 'x';
  } else {
    travelAxis = Math.abs(currentForward.z) >= Math.abs(currentForward.x) ? 'z' : 'x';
  }

  state.travelAxis = travelAxis;
  state.lineCoord = travelAxis === 'z' ? nearestVertical : nearestHorizontal;
  state.direction = resolveAxisDirection(travelAxis, currentForward, state.direction);
}

function chooseGridDirection(navigation, state) {
  const chooseTurn = Math.random() < navigation.turnProbability;
  if (!chooseTurn) {
    return;
  }

  const turnRight = Math.random() >= 0.5;
  if (state.travelAxis === 'z') {
    state.travelAxis = 'x';
    state.direction = turnRight ? state.direction : -state.direction;
    return;
  }

  state.travelAxis = 'z';
  state.direction = turnRight ? -state.direction : state.direction;
}

function getGridLineError(state, position) {
  return state.travelAxis === 'z' ? position.x - state.lineCoord : position.z - state.lineCoord;
}

function getNextGridIntersection(value, direction, chunkSize) {
  const snapped = Math.round(value / chunkSize) * chunkSize;
  if (direction > 0) {
    return value <= snapped ? snapped : snapped + chunkSize;
  }
  return value >= snapped ? snapped : snapped - chunkSize;
}

function getGridIntersectionKey(state, intersectionCoord) {
  const x = state.travelAxis === 'z' ? state.lineCoord : intersectionCoord;
  const z = state.travelAxis === 'z' ? intersectionCoord : state.lineCoord;
  return `${Math.round(x)}:${Math.round(z)}`;
}

function resolveAxisDirection(axis, currentForward, fallbackDirection) {
  const component = axis === 'z' ? currentForward.z : currentForward.x;
  if (Math.abs(component) > 0.12) {
    return component >= 0 ? 1 : -1;
  }
  return fallbackDirection || 1;
}

function findNearestWaypointIndex(waypoints, position) {
  let bestIndex = 0;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (let index = 0; index < waypoints.length; index += 1) {
    const distanceSq = waypoints[index].distanceToSquared(position);
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function findNearestGraphRoad(navigation, position, currentForward) {
  let bestMatch = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const roadRecord of navigation.roadRecords) {
    for (const direction of [1, -1]) {
      const laneRecord = selectNearestLaneRecord(roadRecord, direction, position);
      const sample = laneRecord ? projectPointToPath(laneRecord.path, position) : projectPointToPath(roadRecord.path, position);
      const travelTangent = direction > 0 ? sample.tangent : sample.tangent.clone().negate();
      const alignment = Math.abs(travelTangent.dot(currentForward));
      const score = sample.distanceSq - alignment * 6;
      if (score < bestScore) {
        bestScore = score;
        bestMatch = {
          roadRecord,
          laneRecord,
          sample,
          direction
        };
      }
    }
  }

  return bestMatch;
}

function chooseGraphTransition(navigation, roadRecord, currentDirection, nodeKey, currentTravelTangent) {
  const node = navigation.nodesByKey.get(nodeKey);
  if (!node) {
    return null;
  }

  const leftTurns = [];
  const rightTurns = [];
  const straightPaths = [];

  for (const connection of node.connections) {
    const direction = connection.direction.clone().setY(0).normalize();
    const angle = signedAngleBetweenVectors(currentTravelTangent, direction);
    const turnChoice = resolveGraphConnectionChoice(
      navigation,
      roadRecord,
      currentDirection,
      nodeKey,
      direction,
      connection
    );
    if (!turnChoice) {
      continue;
    }

    if (Math.abs(angle) < 0.42) {
      straightPaths.push({ ...turnChoice, turnType: 'straight' });
    } else if (angle < 0) {
      leftTurns.push({ ...turnChoice, turnType: 'left' });
    } else {
      rightTurns.push({ ...turnChoice, turnType: 'right' });
    }
  }

  if (straightPaths.length && Math.random() < 0.6) {
    return pickRandom(straightPaths);
  }

  const sideBuckets = [];
  if (leftTurns.length) {
    sideBuckets.push(leftTurns);
  }
  if (rightTurns.length) {
    sideBuckets.push(rightTurns);
  }
  if (sideBuckets.length) {
    return pickRandom(sideBuckets[Math.floor(Math.random() * sideBuckets.length)]);
  }

  return straightPaths.length ? pickRandom(straightPaths) : null;
}

function resolveGraphConnectionChoice(navigation, currentRoad, currentDirection, nodeKey, connectionDirection, connection) {
  const currentRoadJunction = currentRoad.junctionsByKey.get(nodeKey);
  if (!currentRoadJunction) {
    return null;
  }

  if (connection.roadIds?.has(currentRoad.id)) {
    const sameRoadDirection = getRoadDirectionFromConnection(
      currentRoad,
      currentRoadJunction,
      connectionDirection,
      false
    );
    if (sameRoadDirection === currentDirection) {
      return { roadRecord: currentRoad, direction: currentDirection };
    }
  }

  let bestChoice = null;
  let bestAlignment = -Infinity;
  for (const roadId of connection.roadIds || []) {
    const candidateRoad = navigation.roadsById.get(roadId);
    if (!candidateRoad || candidateRoad.id === currentRoad.id) {
      continue;
    }

    const junction = candidateRoad.junctionsByKey.get(nodeKey);
    if (!junction) {
      continue;
    }

    const direction = getRoadDirectionFromConnection(candidateRoad, junction, connectionDirection, false);
    if (!direction) {
      continue;
    }

    const tangent = getRoadTravelTangent(candidateRoad, junction.distanceAlong, direction);
    const alignment = tangent.dot(connectionDirection);
    if (alignment > bestAlignment) {
      bestAlignment = alignment;
      bestChoice = { roadRecord: candidateRoad, direction };
    }
  }

  return bestChoice;
}

function findNearestHighwayPath(highway, position, currentForward) {
  let bestMatch = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const chunk of highway.chunks) {
    const sample = projectPointToPath(ensureChunkPath(chunk), position);
    const alignment = Math.abs(sample.tangent.dot(currentForward));
    const score = sample.distanceSq - alignment * 8;
    if (score < bestScore) {
      bestScore = score;
      bestMatch = {
        chunk,
        sample,
        direction: sample.tangent.dot(currentForward) >= 0 ? 1 : -1
      };
    }
  }

  return bestMatch;
}

function sampleHighwayAhead(highway, startChunkIndex, direction, startDistanceAlong, offsetDistance) {
  let chunk = getChunkByIndex(highway, startChunkIndex);
  if (!chunk) {
    return null;
  }

  let remaining = offsetDistance;
  let distanceAlong = startDistanceAlong;
  let path = ensureChunkPath(chunk);

  while (remaining > EPSILON) {
    if (direction > 0) {
      const available = Math.max(path.totalLength - distanceAlong, 0);
      if (remaining <= available || !getChunkByIndex(highway, chunk.meta.index + 1)) {
        const sample = samplePathAtDistance(path, distanceAlong + Math.min(remaining, available));
        return { ...sample, chunkIndex: chunk.meta.index };
      }
      remaining -= available;
      chunk = getChunkByIndex(highway, chunk.meta.index + 1);
      path = ensureChunkPath(chunk);
      distanceAlong = 0;
    } else {
      const available = Math.max(distanceAlong, 0);
      if (remaining <= available || !getChunkByIndex(highway, chunk.meta.index - 1)) {
        const sample = samplePathAtDistance(path, distanceAlong - Math.min(remaining, available));
        return { ...sample, chunkIndex: chunk.meta.index };
      }
      remaining -= available;
      chunk = getChunkByIndex(highway, chunk.meta.index - 1);
      path = ensureChunkPath(chunk);
      distanceAlong = path.totalLength;
    }
  }

  const sample = samplePathAtDistance(path, distanceAlong);
  return { ...sample, chunkIndex: chunk.meta.index };
}

function ensureChunkPath(chunk) {
  if (!chunk?.meta) {
    return null;
  }
  if (!chunk.meta.navigationPath && Array.isArray(chunk.meta.points)) {
    chunk.meta.navigationPath = buildPolylineNavigationData(chunk.meta.points, chunk.meta.curve || null);
  }
  return chunk.meta.navigationPath;
}

function getChunkByIndex(highway, chunkIndex) {
  if (!Number.isFinite(chunkIndex)) {
    return null;
  }
  return highway.chunks.find((chunk) => chunk.meta.index === chunkIndex) || null;
}

export function projectPointToPath(pathData, position) {
  if (!pathData?.points?.length) {
    return null;
  }

  if (pathData.points.length === 1 || pathData.totalLength < EPSILON) {
    return {
      point: pathData.points[0].clone(),
      tangent: new THREE.Vector3(0, 0, 1),
      distanceAlong: 0,
      distanceSq: position.distanceToSquared(pathData.points[0])
    };
  }

  let bestDistanceSq = Number.POSITIVE_INFINITY;
  let bestPoint = null;
  let bestTangent = null;
  let bestDistanceAlong = 0;

  for (let index = 0; index < pathData.segmentLengths.length; index += 1) {
    const start = pathData.points[index];
    const end = pathData.points[index + 1];
    SEGMENT_VECTOR.subVectors(end, start);
    const segmentLengthSq = SEGMENT_VECTOR.lengthSq();
    if (segmentLengthSq < EPSILON) {
      continue;
    }

    PROJECT_VECTOR.subVectors(position, start);
    const t = THREE.MathUtils.clamp(PROJECT_VECTOR.dot(SEGMENT_VECTOR) / segmentLengthSq, 0, 1);
    CLOSEST_POINT.copy(start).addScaledVector(SEGMENT_VECTOR, t);
    const distanceSq = CLOSEST_POINT.distanceToSquared(position);

    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestPoint = CLOSEST_POINT.clone();
      bestTangent = SEGMENT_VECTOR.clone().setY(0).normalize();
      bestDistanceAlong = pathData.cumulativeLengths[index] + pathData.segmentLengths[index] * t;
    }
  }

  return {
    point: bestPoint || pathData.points[0].clone(),
    tangent: bestTangent || new THREE.Vector3(0, 0, 1),
    distanceAlong: bestDistanceAlong,
    distanceSq: bestDistanceSq
  };
}

function samplePathAtDistance(pathData, distanceAlong) {
  if (!pathData?.points?.length) {
    return {
      point: new THREE.Vector3(),
      tangent: new THREE.Vector3(0, 0, 1),
      distanceAlong: 0
    };
  }

  const clampedDistance = THREE.MathUtils.clamp(distanceAlong, 0, pathData.totalLength);
  if (pathData.curve && pathData.totalLength > EPSILON) {
    const t = clampedDistance / pathData.totalLength;
    const point = pathData.curve.getPointAt(t);
    const tangent = pathData.curve.getTangentAt(t).setY(0);
    if (tangent.lengthSq() > EPSILON) {
      tangent.normalize();
      return { point, tangent, distanceAlong: clampedDistance };
    }
  }

  if (pathData.totalLength < EPSILON || pathData.points.length === 1) {
    return {
      point: pathData.points[0].clone(),
      tangent: new THREE.Vector3(0, 0, 1),
      distanceAlong: 0
    };
  }

  for (let index = 0; index < pathData.segmentLengths.length; index += 1) {
    const segmentStart = pathData.cumulativeLengths[index];
    const segmentEnd = pathData.cumulativeLengths[index + 1];
    if (clampedDistance > segmentEnd && index < pathData.segmentLengths.length - 1) {
      continue;
    }

    const segmentLength = Math.max(pathData.segmentLengths[index], EPSILON);
    const localT = THREE.MathUtils.clamp((clampedDistance - segmentStart) / segmentLength, 0, 1);
    const start = pathData.points[index];
    const end = pathData.points[index + 1];
    const point = start.clone().lerp(end, localT);
    const tangent = end.clone().sub(start).setY(0).normalize();
    return { point, tangent, distanceAlong: clampedDistance };
  }

  const lastPoint = pathData.points[pathData.points.length - 1].clone();
  const previousPoint = pathData.points[pathData.points.length - 2];
  return {
    point: lastPoint,
    tangent: lastPoint.clone().sub(previousPoint).setY(0).normalize(),
    distanceAlong: clampedDistance
  };
}

function getUpcomingRoadJunction(roadRecord, direction, distanceAlong) {
  if (!roadRecord.junctions.length) {
    return null;
  }

  if (direction > 0) {
    return roadRecord.junctions.find((junction) => junction.distanceAlong > distanceAlong + 0.8) || null;
  }

  for (let index = roadRecord.junctions.length - 1; index >= 0; index -= 1) {
    if (roadRecord.junctions[index].distanceAlong < distanceAlong - 0.8) {
      return roadRecord.junctions[index];
    }
  }

  return null;
}

function getRoadDirectionFromConnection(roadRecord, junction, connectionDirection, allowEndpointFallback) {
  const candidates = [];

  if (junction.distanceAlong < roadRecord.totalLength - 0.6 || allowEndpointFallback) {
    const tangent = getRoadTravelTangent(roadRecord, junction.distanceAlong, 1);
    candidates.push({ direction: 1, alignment: tangent.dot(connectionDirection) });
  }
  if (junction.distanceAlong > 0.6 || allowEndpointFallback) {
    const tangent = getRoadTravelTangent(roadRecord, junction.distanceAlong, -1);
    candidates.push({ direction: -1, alignment: tangent.dot(connectionDirection) });
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) => right.alignment - left.alignment);
  return candidates[0].alignment > 0.45 ? candidates[0].direction : null;
}

function getRoadTravelTangent(roadRecord, distanceAlong, direction) {
  const sampleDistance = THREE.MathUtils.clamp(
    distanceAlong + direction * 1.2,
    0,
    roadRecord.totalLength
  );
  const tangent = samplePathAtDistance(roadRecord.path, sampleDistance).tangent;
  return direction > 0 ? tangent : tangent.clone().negate();
}

function getForwardVector(transform) {
  if (transform.useBodyQuaternion && transform.bodyQuaternion) {
    return FORWARD_VECTOR.set(0, 0, 1).applyQuaternion(transform.bodyQuaternion).setY(0).normalize();
  }
  return FORWARD_VECTOR.set(Math.sin(transform.yaw), 0, Math.cos(transform.yaw)).normalize();
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function signedAngleBetweenVectors(left, right) {
  const dot = THREE.MathUtils.clamp(left.dot(right), -1, 1);
  const crossY = left.z * right.x - left.x * right.z;
  return Math.atan2(crossY, dot);
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function resetStateForMode(state, mode) {
  if (state.mode === mode) {
    return;
  }

  const nextState = createAutopilotState();
  Object.assign(state, nextState, { mode });
}

function buildRoadLaneRecords(road) {
  const lanesPerDirection = Math.max(1, Number(road?.lanesPerDirection || inferLanesPerDirection(road)));
  const records = {
    1: [],
    [-1]: []
  };

  for (const direction of [1, -1]) {
    for (let laneIndex = 0; laneIndex < lanesPerDirection; laneIndex += 1) {
      const offset = computeLaneOffset(road, laneIndex, direction, lanesPerDirection);
      const points = offsetRoadPoints(road.points, offset);
      const curve = points.length >= 2
        ? new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.35)
        : null;
      records[direction].push({
        id: `${road.id}:${direction > 0 ? 'fwd' : 'rev'}:${laneIndex}`,
        roadId: road.id,
        direction,
        index: laneIndex,
        offset,
        path: buildPolylineNavigationData(points, curve)
      });
    }
  }

  return records;
}

function inferLanesPerDirection(road) {
  if (road?.classification === 'primary') return 3;
  if (road?.classification === 'secondary') return 2;
  return 1;
}

function computeLaneOffset(road, laneIndex, direction, lanesPerDirection) {
  const roadWidth = Number(road?.width || 18);
  const medianWidth = Number(road?.medianWidth || 0);
  const carriageWidth = medianWidth > 0
    ? Math.max((roadWidth - medianWidth) * 0.5, 3.2)
    : Math.max(roadWidth * 0.5, 3.2);
  const laneWidth = carriageWidth / lanesPerDirection;
  const medianHalf = medianWidth * 0.5;
  const centerDistance = medianHalf + laneWidth * (laneIndex + 0.5);
  return direction > 0 ? -centerDistance : centerDistance;
}

function offsetRoadPoints(points, offset) {
  return points.map((point, index) => {
    const tangent = getPointTangent(points, index);
    const rightNormal = RIGHT_VECTOR.set(tangent.z, 0, -tangent.x).normalize();
    return point.clone().addScaledVector(rightNormal, offset);
  });
}

function getPointTangent(points, index) {
  const current = points[index];
  const previous = points[index - 1] || current;
  const next = points[index + 1] || current;
  const tangent = next.clone().sub(previous).setY(0);
  if (tangent.lengthSq() < EPSILON) {
    return new THREE.Vector3(0, 0, 1);
  }
  return tangent.normalize();
}

export function getRoadLaneRecord(roadRecord, direction, laneIndex) {
  const lanes = roadRecord?.lanesByDirection?.[direction];
  if (!lanes?.length) {
    return null;
  }
  const clampedIndex = THREE.MathUtils.clamp(Number(laneIndex) || 0, 0, lanes.length - 1);
  return lanes[clampedIndex] || lanes[0] || null;
}

function clampLaneIndex(roadRecord, direction, laneIndex) {
  const lanes = roadRecord?.lanesByDirection?.[direction];
  if (!lanes?.length) {
    return 0;
  }
  return THREE.MathUtils.clamp(Number(laneIndex) || 0, 0, lanes.length - 1);
}

function selectNearestLaneRecord(roadRecord, direction, position) {
  const lanes = roadRecord?.lanesByDirection?.[direction];
  if (!lanes?.length) {
    return null;
  }

  let best = lanes[0];
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (const lane of lanes) {
    const sample = projectPointToPath(lane.path, position);
    if (sample.distanceSq < bestDistanceSq) {
      best = lane;
      bestDistanceSq = sample.distanceSq;
    }
  }
  return best;
}
