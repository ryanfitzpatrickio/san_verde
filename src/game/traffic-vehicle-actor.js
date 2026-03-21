import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { EngineAudioSystem } from '../engine-system.js';
import { getBuiltInVehicleById } from '../assets/vehicle-registry.js';
import { MODEL_CONFIG } from '../app-shell.js';
import { createSceneHelpers } from '../scene-helpers.js';
import { CarVehicle } from '../vehicles/car-vehicle.js';
import { buildMountedCarRig } from '../vehicles/car-rig.js';
import { collectEmbeddedWheelAssets } from '../vehicles/car-rig-helpers.js';
import { createKinematicCarState, updateKinematicCarState } from '../vehicles/kinematic-car-controller.js';
import { createMountedCarController } from '../vehicles/mounted-car-controller.js';
import { inferVehicleForwardYawDegrees } from '../vehicles/vehicle-orientation.js';

const SHARED_GLTF_LOADER = new GLTFLoader();
const VEHICLE_TEMPLATE_CACHE = new Map();
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const TEMP_POSITION = new THREE.Vector3();

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
  steeringWheelTurnRatio: -5.4
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
  const mountedCarController = createMountedCarController({
    root: actorRoot,
    bodyMount,
    wheelMount,
    steeringWheelRig,
    steeringWheelTurnRatio: TRAFFIC_STYLE.steeringWheelTurnRatio,
    upAxis: UP_AXIS
  });

  const state = {
    ...createKinematicCarState({ wheelRadius }),
    engine
  };

  return {
    root: actorRoot,
    update({ position, yaw = 0, speed = 0, deltaSeconds = 0 }) {
      TEMP_POSITION.copy(resolvePosition(position));
      updateKinematicCarState(state, {
        targetPosition: TEMP_POSITION,
        targetYaw: yaw,
        targetSpeed: speed,
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
          state.engine.update({
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

      mountedCarController.applyPose({
        position: state.position,
        yaw: state.yaw,
        bodyPitch: state.bodyPitch,
        bodyRoll: state.bodyRoll,
        steerAngle: state.steerAngle,
        wheelSpin: state.wheelSpin,
        suspensionOffset: 0
      });
    },
    dispose() {
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
