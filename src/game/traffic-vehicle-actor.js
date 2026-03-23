import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { EngineAudioSystem } from '../engine-system.js';
import { getBuiltInVehicleById } from '../assets/vehicle-registry.js';
import { MODEL_CONFIG } from '../app-shell.js';
import { createSceneHelpers } from '../scene-helpers.js';
import { CarVehicle } from '../vehicles/car-vehicle.js';
import { buildMountedCarRig } from '../vehicles/car-rig.js';
import { collectEmbeddedWheelAssets } from '../vehicles/car-rig-helpers.js';
import { createMountedCarRuntime } from '../vehicles/car-runtime.js';
import { inferVehicleForwardYawDegrees } from '../vehicles/vehicle-orientation.js';

const SHARED_GLTF_LOADER = new GLTFLoader();
const VEHICLE_TEMPLATE_CACHE = new Map();
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const TEMP_POSITION = new THREE.Vector3();
const LOOKAHEAD_POINT = new THREE.Vector3();
const NEXT_POINT = new THREE.Vector3();
const TARGET_POINT = new THREE.Vector3();
const DESIRED_VECTOR = new THREE.Vector3();
const HEADING_VECTOR = new THREE.Vector3();
const TURN_VECTOR = new THREE.Vector3();

const TRAFFIC_STYLE = {
  transmissionMode: 'automatic',
  maxSteerAngle: 0.42,
  steerResponse: 4.8,
  steerReturn: 6.2,
  followRate: 7.4,
  yawFollowRate: 5.4,
  accelerationRate: 5.6,
  brakeRate: 9.8,
  pitchRate: 6.5,
  rollRate: 5.6,
  maxPitch: 0.06,
  maxRoll: 0.08,
  steeringWheelTurnRatio: -5.4,
  cornerBrakeAngleStart: 0.18,
  cornerBrakeAngleFull: 0.95,
  cornerSpeedMinFactor: 0.38,
  targetApproachRadius: 7.5,
  lookaheadDistance: 8.5
};

export async function loadTrafficVehicleActor(archetype) {
  const manifest = resolveTrafficVehicleManifest(archetype);
  const bodyUrl = manifest?.body?.url || archetype?.presentation?.modelUrl;
  if (!bodyUrl) {
    throw new Error(`Traffic vehicle archetype "${archetype?.id || 'unknown'}" is missing a vehicle body URL`);
  }

  const actorRoot = new THREE.Group();
  const bodyMount = new THREE.Group();
  const wheelMount = new THREE.Group();
  const previewState = createTrafficPreviewState(manifest, archetype);
  const carConfig = {
    ...MODEL_CONFIG,
    targetSpan: Number(archetype?.presentation?.targetSpan || MODEL_CONFIG.targetSpan || 5.4)
  };
  const helpers = createSceneHelpers({
    state: previewState,
    ui: {},
    config: MODEL_CONFIG
  });
  const carVehicle = new CarVehicle({
    config: carConfig,
    state: previewState,
    helpers: {
      clearGroup: helpers.clearGroup,
      normalizeToTargetSpan: helpers.normalizeToTargetSpan,
      prepareRenderable: helpers.prepareRenderable,
      measureObjectBounds: helpers.measureObjectBounds,
      measureTireProfile: helpers.measureTireProfile,
      collectWheelAnchors: helpers.collectWheelAnchors,
      collectEmbeddedWheelAssets,
      collectSteeringWheelRig: helpers.collectSteeringWheelRig,
      mountSteeringWheelAttachment: helpers.mountSteeringWheelAttachment,
      createDoorRig: helpers.createDoorRig,
      createWheelSpinMarker: helpers.createWheelSpinMarker,
      createFallbackMountedWheel: helpers.createFallbackMountedWheel,
      axisToRotationProperty: helpers.axisToRotationProperty
    }
  });

  const [bodyTemplate, frontTireTemplate, rearTireTemplate] = await Promise.all([
    loadVehicleTemplate(bodyUrl),
    manifest?.tires?.front?.url ? loadVehicleTemplate(manifest.tires.front.url) : Promise.resolve(null),
    manifest?.tires?.rear?.url && manifest.tires.rear.url !== manifest?.tires?.front?.url
      ? loadVehicleTemplate(manifest.tires.rear.url)
      : Promise.resolve(null)
  ]);

  const rawBodyAsset = bodyTemplate.clone(true);
  rawBodyAsset.userData.assetBodyRotationYDeg = Object.hasOwn(manifest?.body || {}, 'rotationYDeg')
    ? Number(manifest.body.rotationYDeg || 0)
    : inferVehicleForwardYawDegrees(rawBodyAsset);

  const presentation = buildMountedCarRig({
    carVehicle,
    rawAsset: rawBodyAsset,
    activeTireAssets: {
      front: frontTireTemplate,
      rear: rearTireTemplate || frontTireTemplate
    },
    stripEmbeddedWheels: Boolean(manifest?.tires?.front || manifest?.tires?.rear),
    bodyVisualOffsetY: Number(manifest?.preset?.bodyVisualOffsetY || 0)
  });

  bodyMount.add(presentation.body);
  for (const child of [...presentation.wheelMount.children]) {
    presentation.wheelMount.remove(child);
    wheelMount.add(child);
  }
  actorRoot.add(bodyMount);
  actorRoot.add(wheelMount);

  const steeringWheelRig = presentation.steeringWheelRig;
  const wheelRadius = presentation.wheelRadius || 0.42;
  const engineId = manifest?.preset?.engineId || 'mustang_390_v8_5mt';
  const engine = new EngineAudioSystem(engineId);
  const carRuntime = createMountedCarRuntime({
    root: actorRoot,
    bodyMount,
    wheelMount,
    steeringWheelRig,
    steeringWheelTurnRatio: TRAFFIC_STYLE.steeringWheelTurnRatio,
    upAxis: UP_AXIS,
    initialState: {
      wheelRadius
    }
  });
  carRuntime.state.engine = engine;
  let rigClaimed = false;

  return {
    root: actorRoot,
    claimMountedRig() {
      if (rigClaimed) {
        return null;
      }

      rigClaimed = true;
      return {
        body: presentation.body,
        wheelMount,
        doorRig: presentation.doorRig || null,
        steeringWheelRig,
        wheelSpinDirection: Number(manifest?.preset?.wheelSpinDirection || 1),
        metrics: presentation.metrics,
        anchors: presentation.anchors,
        embeddedWheels: presentation.embeddedWheels || null,
        wheelRadius,
        manifest
      };
    },
    update({
      position,
      yaw = 0,
      speed = 0,
      deltaSeconds = 0,
      desiredVelocity = null,
      corners = null,
      laneTargetPoint = null,
      laneTargetTangent = null,
      laneDesiredSpeed = null,
      targetPosition = null
    }) {
      TEMP_POSITION.copy(resolvePosition(position));
      const driveTarget = resolveTrafficDriveTarget({
        currentPosition: TEMP_POSITION,
        fallbackYaw: yaw,
        actualSpeed: speed,
        desiredVelocity,
        corners,
        laneTargetPoint,
        laneTargetTangent,
        laneDesiredSpeed,
        targetPosition,
        style: TRAFFIC_STYLE
      });
      carRuntime.updateKinematic({
        targetPosition: TEMP_POSITION,
        targetYaw: driveTarget.yaw,
        targetSpeed: driveTarget.speed,
        deltaSeconds,
        style: TRAFFIC_STYLE,
        onDrivetrainStep: ({
          deltaSeconds: dt,
          throttleInput,
          brakeInput,
          desiredDirection,
          driveSpeed,
          wheelRadius: currentWheelRadius
        }) => {
          carRuntime.state.engine.update({
            deltaSeconds: dt,
            throttleInput,
            brakeInput,
            driveSpeed,
            wheelRadius: currentWheelRadius,
            driveEnabled: true,
            transmissionMode: TRAFFIC_STYLE.transmissionMode,
            desiredDirection
          });
        }
      });
    },
    dispose() {
      rigClaimed = true;
      actorRoot.removeFromParent();
    }
  };
}

function resolveTrafficVehicleManifest(archetype) {
  const vehicleId = archetype?.presentation?.vehicleId || archetype?.vehicleId || null;
  return vehicleId ? getBuiltInVehicleById(vehicleId) : null;
}

function createTrafficPreviewState(manifest, archetype) {
  const preset = manifest?.preset || {};
  return {
    steeringWheelAsset: null,
    steerAngle: 0,
    tireScale: Number.isFinite(preset.tireScale) ? preset.tireScale : 0.93,
    frontAxleRatio: Number.isFinite(preset.frontAxleRatio) ? preset.frontAxleRatio : 0.18,
    rearAxleRatio: Number.isFinite(preset.rearAxleRatio) ? preset.rearAxleRatio : 0.245,
    rideHeight: Number.isFinite(preset.rideHeight) ? preset.rideHeight : 0.105,
    chassisHeight: Number.isFinite(preset.chassisHeight) ? preset.chassisHeight : 0.11,
    sideInset: Number.isFinite(preset.sideInset) ? preset.sideInset : 0.07,
    tireRotation: Array.isArray(preset.tireRotation) ? [...preset.tireRotation] : [0, Math.PI, 0],
    leftSideTireRotation: Array.isArray(preset.leftSideTireRotation)
      ? [...preset.leftSideTireRotation]
      : [...MODEL_CONFIG.leftSideTireRotation],
    leftSideTireMirror: Boolean(
      'leftSideTireMirror' in preset ? preset.leftSideTireMirror : MODEL_CONFIG.leftSideTireMirror
    ),
    rightSideTireRotation: Array.isArray(preset.rightSideTireRotation)
      ? [...preset.rightSideTireRotation]
      : [...MODEL_CONFIG.rightSideTireRotation],
    rightSideTireMirror: Boolean(
      'rightSideTireMirror' in preset ? preset.rightSideTireMirror : MODEL_CONFIG.rightSideTireMirror
    ),
    selectedBuiltInCarId: manifest?.id || archetype?.presentation?.vehicleId || '',
    wheelRadius: 0.42,
    environmentIntensity: Number.isFinite(preset.environmentIntensity) ? preset.environmentIntensity : 1.2
  };
}

async function loadVehicleTemplate(modelUrl) {
  if (!VEHICLE_TEMPLATE_CACHE.has(modelUrl)) {
    VEHICLE_TEMPLATE_CACHE.set(
      modelUrl,
      SHARED_GLTF_LOADER.loadAsync(modelUrl).then((gltf) => gltf.scene || gltf.scenes?.[0] || null)
    );
  }
  return VEHICLE_TEMPLATE_CACHE.get(modelUrl);
}

function resolvePosition(position) {
  if (position?.isVector3) {
    return position;
  }
  if (Array.isArray(position)) {
    TEMP_POSITION.set(position[0] || 0, position[1] || 0, position[2] || 0);
    return TEMP_POSITION;
  }
  if (position && typeof position === 'object') {
    TEMP_POSITION.set(position.x || 0, position.y || 0, position.z || 0);
    return TEMP_POSITION;
  }
  TEMP_POSITION.set(0, 0, 0);
  return TEMP_POSITION;
}

function resolveTrafficDriveTarget({
  currentPosition,
  fallbackYaw,
  actualSpeed,
  desiredVelocity,
  corners,
  laneTargetPoint,
  laneTargetTangent,
  laneDesiredSpeed,
  targetPosition,
  style
}) {
  const desiredSpeed = Number.isFinite(laneDesiredSpeed)
    ? Math.min(resolveDesiredSpeed(actualSpeed, desiredVelocity), laneDesiredSpeed)
    : resolveDesiredSpeed(actualSpeed, desiredVelocity);
  const lookahead = laneTargetPoint
    ? resolvePositionLike(laneTargetPoint)
    : selectLookaheadPoint(currentPosition, corners, targetPosition, style.lookaheadDistance);
  const resolvedYaw = laneTargetTangent
    ? computeYawFromTangent(laneTargetTangent, fallbackYaw)
    : lookahead
      ? computeYawTowards(currentPosition, lookahead, fallbackYaw)
      : fallbackYaw;
  const cornerAngle = computeCornerAngle(currentPosition, lookahead, corners, desiredVelocity, laneTargetTangent);
  const cornerFactor = computeCornerSpeedFactor(cornerAngle, style);
  const approachFactor = computeApproachSpeedFactor(currentPosition, targetPosition, style.targetApproachRadius);
  const plannedSpeed = Math.max(
    0.35,
    desiredSpeed * Math.min(cornerFactor, approachFactor)
  );

  return {
    yaw: resolvedYaw,
    speed: plannedSpeed
  };
}

function resolveDesiredSpeed(actualSpeed, desiredVelocity) {
  if (Array.isArray(desiredVelocity)) {
    return Math.max(actualSpeed, Math.hypot(desiredVelocity[0] || 0, desiredVelocity[2] || 0));
  }
  if (desiredVelocity?.isVector3) {
    return Math.max(actualSpeed, Math.hypot(desiredVelocity.x || 0, desiredVelocity.z || 0));
  }
  if (desiredVelocity && typeof desiredVelocity === 'object') {
    return Math.max(actualSpeed, Math.hypot(desiredVelocity.x || 0, desiredVelocity.z || 0));
  }
  return actualSpeed;
}

function selectLookaheadPoint(currentPosition, corners, targetPosition, lookaheadDistance) {
  if (Array.isArray(corners) && corners.length) {
    let fallback = null;
    for (const corner of corners) {
      const point = resolveCornerPosition(corner);
      if (!point) {
        continue;
      }
      const distance = point.distanceTo(currentPosition);
      if (!fallback) {
        fallback = point.clone();
      }
      if (distance >= lookaheadDistance) {
        return point.clone();
      }
    }
    if (fallback) {
      return fallback;
    }
  }

  return targetPosition ? resolvePositionLike(targetPosition) : null;
}

function resolveCornerPosition(corner) {
  if (!corner) {
    return null;
  }
  if (Array.isArray(corner.position)) {
    return LOOKAHEAD_POINT.set(corner.position[0] || 0, corner.position[1] || 0, corner.position[2] || 0);
  }
  if (corner.position?.isVector3) {
    return LOOKAHEAD_POINT.copy(corner.position);
  }
  return null;
}

function resolvePositionLike(position) {
  if (position?.isVector3) {
    return TARGET_POINT.copy(position);
  }
  if (Array.isArray(position)) {
    return TARGET_POINT.set(position[0] || 0, position[1] || 0, position[2] || 0);
  }
  if (position && typeof position === 'object') {
    return TARGET_POINT.set(position.x || 0, position.y || 0, position.z || 0);
  }
  return null;
}

function computeYawTowards(from, to, fallbackYaw) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.hypot(dx, dz) < 1e-3) {
    return fallbackYaw;
  }
  return Math.atan2(dx, dz);
}

function computeYawFromTangent(tangent, fallbackYaw) {
  const dir = resolvePositionLike(tangent);
  if (!dir) {
    return fallbackYaw;
  }
  const dx = dir.x;
  const dz = dir.z;
  if (Math.hypot(dx, dz) < 1e-3) {
    return fallbackYaw;
  }
  return Math.atan2(dx, dz);
}

function computeCornerAngle(currentPosition, lookahead, corners, desiredVelocity, laneTargetTangent) {
  if (laneTargetTangent) {
    const tangent = resolvePositionLike(laneTargetTangent);
    if (lookahead && tangent) {
      HEADING_VECTOR.subVectors(lookahead, currentPosition).setY(0);
      TURN_VECTOR.set(tangent.x || 0, 0, tangent.z || 0);
      return angleBetweenHorizontal(HEADING_VECTOR, TURN_VECTOR);
    }
  }

  if (Array.isArray(corners) && corners.length >= 2) {
    const first = resolvePositionLike(corners[0]?.position);
    const second = resolvePositionLike(corners[1]?.position) || lookahead;
    if (first && second) {
      HEADING_VECTOR.subVectors(first, currentPosition).setY(0);
      TURN_VECTOR.subVectors(second, first).setY(0);
      return angleBetweenHorizontal(HEADING_VECTOR, TURN_VECTOR);
    }
  }

  if (lookahead && desiredVelocity) {
    const velocity = resolveHorizontalVector(desiredVelocity, DESIRED_VECTOR);
    HEADING_VECTOR.subVectors(lookahead, currentPosition).setY(0);
    return angleBetweenHorizontal(velocity, HEADING_VECTOR);
  }

  return 0;
}

function resolveHorizontalVector(input, out) {
  if (Array.isArray(input)) {
    return out.set(input[0] || 0, 0, input[2] || 0);
  }
  if (input?.isVector3) {
    return out.set(input.x || 0, 0, input.z || 0);
  }
  if (input && typeof input === 'object') {
    return out.set(input.x || 0, 0, input.z || 0);
  }
  return out.set(0, 0, 0);
}

function angleBetweenHorizontal(a, b) {
  const aLen = Math.hypot(a.x, a.z);
  const bLen = Math.hypot(b.x, b.z);
  if (aLen < 1e-3 || bLen < 1e-3) {
    return 0;
  }
  const dot = THREE.MathUtils.clamp((a.x * b.x + a.z * b.z) / (aLen * bLen), -1, 1);
  return Math.acos(dot);
}

function computeCornerSpeedFactor(angle, style) {
  if (!Number.isFinite(angle) || angle <= style.cornerBrakeAngleStart) {
    return 1;
  }
  const turnT = THREE.MathUtils.clamp(
    (angle - style.cornerBrakeAngleStart) / Math.max(style.cornerBrakeAngleFull - style.cornerBrakeAngleStart, 1e-3),
    0,
    1
  );
  return THREE.MathUtils.lerp(1, style.cornerSpeedMinFactor, turnT);
}

function computeApproachSpeedFactor(currentPosition, targetPosition, approachRadius) {
  const resolvedTarget = resolvePositionLike(targetPosition);
  if (!resolvedTarget) {
    return 1;
  }
  const distance = resolvedTarget.distanceTo(currentPosition);
  if (distance >= approachRadius) {
    return 1;
  }
  return THREE.MathUtils.lerp(0.4, 1, THREE.MathUtils.clamp(distance / Math.max(approachRadius, 1e-3), 0, 1));
}
