import * as THREE from 'three';

import { computeAutopilotInputs, createAutopilotState } from './autopilot.js';
import { addComponent, createEntity, createWorld, getComponent, queryEntities } from '../ecs/world.js';
import { configureBounceVehicle, resetBounceVehicle, settleBounceVehicle, stepBounceVehicle } from './bounce-physics.js';
import { emitSkidMark } from './skid-mark-system.js';
import { resolveDriveCommandInputs, updateVehicleEngineSnapshot } from '../vehicles/car-drive-controller.js';
import { updateSteerAngleFromInput } from '../vehicles/car-steering-controller.js';
import {
  applyCarRenderRigRuntimeState,
  applyCarRenderRigWheelState
} from '../vehicles/car-runtime.js';

const COMPONENTS = {
  cameraRig: 'cameraRig',
  driveInput: 'driveInput',
  engine: 'engine',
  physics: 'physics',
  renderRig: 'renderRig',
  stageBounds: 'stageBounds',
  suspension: 'suspension',
  transform: 'transform',
  vehicleController: 'vehicleController'
};

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const ROOT_POSITION = new THREE.Vector3();
const DRIVE_FORWARD = new THREE.Vector3();
const DRIVE_UP = new THREE.Vector3();
const PROBE_SIDE = new THREE.Vector3();
const TRAVEL_DELTA = new THREE.Vector3();
const PROBE_ORIGIN = new THREE.Vector3();
const PROBE_LOCAL = new THREE.Vector3();
const WHEEL_SAMPLE = new THREE.Vector3();
const WHEEL_LOCAL = new THREE.Vector3();
const REST_WORLD = new THREE.Vector3();
const CAMERA_OFFSET = new THREE.Vector3();
const CHASE_FORWARD = new THREE.Vector3();
const CHASE_SIDE = new THREE.Vector3();
const FOLLOW_TARGET = new THREE.Vector3();
const DESIRED_TARGET = new THREE.Vector3();
const DESIRED_POSITION = new THREE.Vector3();
const STEER_QUATERNION = new THREE.Quaternion();
const YAW_QUATERNION = new THREE.Quaternion();
const BODY_QUATERNION = new THREE.Quaternion();
const PHYSICS_FORWARD = new THREE.Vector3();
const FEEDBACK_FORWARD = new THREE.Vector3();
const SKID_WORLD = new THREE.Vector3();
const SKID_FORWARD = new THREE.Vector3();
const SKID_MARK_POSITION = new THREE.Vector3();
const SKID_LAST = new THREE.Vector3();
const KINEMATIC_PRE_STEP_POSITION = new THREE.Vector3();
const MOUNTED_BODY_BOX = new THREE.Box3();
const MOUNTED_BODY_SIZE = new THREE.Vector3();
const MOUNTED_BODY_CENTER = new THREE.Vector3();

function getSuspensionConfig(runtime, vehicleKind) {
  const baseConfig = runtime.config.suspension;
  const vehicleConfig = baseConfig.vehicleKinds?.[vehicleKind];
  const suspension = getVehicleComponent(runtime, COMPONENTS.suspension);
  const overrides =
    vehicleKind === 'car' && suspension?.overrides
      ? suspension.overrides
      : null;

  if (!vehicleConfig && !overrides) {
    return baseConfig;
  }

  return {
    ...baseConfig,
    ...(vehicleConfig || {}),
    ...(overrides || {})
  };
}

function getVehicleFeedbackConfig(runtime, vehicleKind) {
  const baseConfig = runtime.config.vehicleFeedback || {};
  const vehicleConfig = baseConfig.vehicleKinds?.[vehicleKind];
  return vehicleConfig ? { ...baseConfig, ...vehicleConfig } : baseConfig;
}

function getDrivingStyleConfig(runtime, styleId) {
  return runtime.config.drivingStyles?.[styleId] || runtime.config.drivingStyles?.sim || {
    id: 'sim',
    label: 'Sim',
    description: 'Manual transmission',
    transmissionMode: 'manual'
  };
}

function getWheelLayoutMetrics(wheelMount) {
  const wheels = wheelMount?.children?.filter((wheel) => wheel?.isObject3D) || [];
  if (!wheels.length) {
    return null;
  }

  const entries = wheels.map((wheel) => {
    const anchorName = String(wheel.userData.anchorName || '');
    const restPosition = wheel.userData.restPosition || wheel.position;
    return {
      anchorName,
      canSteer: Boolean(wheel.userData.canSteer || anchorName.includes('front')),
      position: restPosition,
      radius: Number(wheel.userData.wheelRadius || 0)
    };
  });

  let frontWheel = entries.find((entry) => entry.canSteer || entry.anchorName.includes('front')) || null;
  let rearWheel = entries.find((entry) => entry !== frontWheel && (!entry.canSteer || entry.anchorName.includes('rear'))) || null;

  if (!frontWheel) {
    frontWheel = entries.reduce((best, entry) => (!best || entry.position.z > best.position.z ? entry : best), null);
  }
  if (!rearWheel) {
    rearWheel = entries.reduce((best, entry) => (!best || entry.position.z < best.position.z ? entry : best), null);
  }

  const radii = entries
    .map((entry) => entry.radius)
    .filter((radius) => Number.isFinite(radius) && radius > 0.08);
  const averageRadius = radii.length
    ? radii.reduce((sum, radius) => sum + radius, 0) / radii.length
    : 0;

  return {
    averageRadius: averageRadius > 0 ? averageRadius : null,
    wheelbaseM:
      frontWheel && rearWheel
        ? Math.max(Math.abs(frontWheel.position.z - rearWheel.position.z), 0.9)
        : null
  };
}

function getMountedBodyMetrics(carMount) {
  if (!carMount) {
    return null;
  }

  carMount.updateMatrixWorld(true);
  MOUNTED_BODY_BOX.setFromObject(carMount);
  if (MOUNTED_BODY_BOX.isEmpty()) {
    return null;
  }

  return {
    size: MOUNTED_BODY_BOX.getSize(MOUNTED_BODY_SIZE).clone(),
    center: MOUNTED_BODY_BOX.getCenter(MOUNTED_BODY_CENTER).clone()
  };
}

function getVehiclePhysicsProfile(vehicleKind, enginePhysics, bundle, wheelMount) {
  if (vehicleKind !== 'bike') {
    return enginePhysics;
  }

  const wheelMetrics = getWheelLayoutMetrics(wheelMount);
  const bikeSpec = bundle?.vehicleKind === 'bike' ? bundle.vehicleSpec || {} : {};

  return {
    ...enginePhysics,
    massKg: 260,
    wheelbaseM: wheelMetrics?.wheelbaseM || Math.max(Number(bikeSpec.wheelHalfBase || 0.72) * 2, 1.2),
    dragCoefficient: 0.58,
    frontalAreaM2: 0.62,
    rollingResistanceCoeff: 0.019,
    tractionCoefficient: 1.02,
    steeringResponse: 7.2,
    steeringReturnRate: 8.8,
    highSpeedSteerFactor: 0.74,
    rwdYawGain: 0,
    rwdGripLoss: 0,
    corneringDragStrength: 0.035,
    maxVehicleSpeedMps: 58,
    reverseSpeedLimitMps: 6
  };
}

function getBikeCasterSteering(controller, vehicleSpec, vehiclePhysics, drivingStyle, runtime, maxSteerAngle, currentSpeed) {
  const speedAbs = Math.abs(currentSpeed);
  const casterBlend = THREE.MathUtils.smoothstep(
    speedAbs,
    Number(vehicleSpec.casterSpeedStartMps ?? 4),
    Number(vehicleSpec.casterSpeedEndMps ?? 18)
  );
  const deadzone = THREE.MathUtils.lerp(
    Number(vehicleSpec.casterDeadzoneLow ?? 0.015),
    Number(vehicleSpec.casterDeadzoneHigh ?? 0.12),
    casterBlend
  );
  const rawInput = Number(controller.steerInput || 0);
  const steerSign = Math.sign(rawInput);
  const absInput = Math.abs(rawInput);
  const filteredInput = absInput <= deadzone
    ? 0
    : steerSign * ((absInput - deadzone) / Math.max(1 - deadzone, 0.001));

  const baseResponse =
    (vehiclePhysics?.steeringResponse ?? runtime.config.steeringRate) *
    (drivingStyle.steeringResponseMultiplier ?? 1) *
    Number(vehicleSpec.steerResponseMultiplier ?? 1);
  const baseReturn =
    (vehiclePhysics?.steeringReturnRate ?? runtime.config.steerReturnRate) *
    (drivingStyle.steeringReturnMultiplier ?? 1);

  return {
    targetSteer: filteredInput * maxSteerAngle,
    responseRate: baseResponse * THREE.MathUtils.lerp(1, Number(vehicleSpec.casterResponseScaleHigh ?? 0.42), casterBlend),
    returnRate: baseReturn * THREE.MathUtils.lerp(1, Number(vehicleSpec.casterReturnScaleHigh ?? 2.2), casterBlend)
  };
}

function syncTransformFromBounceBody(transform, bundle) {
  if (!bundle?.chassisBody) {
    return;
  }

  transform.position.set(
    bundle.chassisBody.position.x,
    bundle.chassisBody.position.y - bundle.rootOffsetY,
    bundle.chassisBody.position.z
  );
  transform.bodyQuaternion.set(
    bundle.chassisBody.orientation.x,
    bundle.chassisBody.orientation.y,
    bundle.chassisBody.orientation.z,
    bundle.chassisBody.orientation.w
  );
  transform.useBodyQuaternion = true;
}

export function createGarageRuntime(options) {
  const world = createWorld();
  const vehicle = createEntity(world);

  addComponent(world, vehicle, COMPONENTS.transform, {
    position: options.initialState.vehiclePosition.clone(),
    yaw: options.initialState.vehicleYaw,
    chassisHeight: options.initialState.chassisHeight,
    bodyQuaternion: new THREE.Quaternion().setFromAxisAngle(UP_AXIS, options.initialState.vehicleYaw),
    useBodyQuaternion: false
  });

  addComponent(world, vehicle, COMPONENTS.vehicleController, {
    driveMode: options.initialState.driveMode,
    drivingStyle: options.initialState.drivingStyle || options.config.defaultDrivingStyle || 'sim',
    autopilotEnabled: options.initialState.autopilotEnabled || false,
    autopilotTime: 0,
    autopilotState: createAutopilotState(),
    automaticDirection: 1,
    speed: options.initialState.driveSpeed,
    steerAngle: options.initialState.steerAngle,
    steerInput: 0,
    wheelSpin: options.initialState.wheelSpin,
    wheelRadius: options.initialState.wheelRadius,
    bikeLeanAngle: options.initialState.bikeLeanAngle || 0,
    longitudinalAccel: 0,
    lateralAccel: 0,
    yawRate: 0
  });

  addComponent(world, vehicle, COMPONENTS.driveInput, {
    forward: false,
    reverse: false,
    left: false,
    right: false
  });

  addComponent(world, vehicle, COMPONENTS.cameraRig, {
    camera: options.camera,
    controls: options.controls,
    override: options.initialState.cameraOverride,
    detached: options.initialState.cameraDetached,
    cinematicEnabled: options.initialState.cinematicCameraEnabled || false,
    cinematicTime: 0
  });

  addComponent(world, vehicle, COMPONENTS.renderRig, {
    vehicleRoot: options.vehicleRoot,
    carMount: options.carMount,
    wheelMount: options.wheelMount
  });

  addComponent(world, vehicle, COMPONENTS.stageBounds, {
    startPosition: options.stage.startPosition.clone(),
    startYaw: options.stage.startYaw,
    driveBounds: options.stage.driveBounds,
    navigation: options.stage.navigation || null,
    sampleGround: options.sampleGround || options.stage.sampleGround || null,
    sampleCollision: options.sampleCollision || options.stage.sampleCollision || null,
    dynamicSampleCollision: options.dynamicSampleCollision || options.stage.dynamicSampleCollision || null,
    physics: options.physics || options.stage.physics || null,
    skidMarks: options.stage.skidMarks || null
  });

  addComponent(world, vehicle, COMPONENTS.physics, {
    bundle: options.physics || options.stage.physics || null,
    vehicleKind: options.initialState.activeVehicleKind || 'car'
  });

  addComponent(world, vehicle, COMPONENTS.suspension, {
    supportY: options.initialState.vehiclePosition.y,
    supportVelocity: 0,
    heave: 0,
    heaveVelocity: 0,
    pitch: 0,
    pitchVelocity: 0,
    roll: 0,
    rollVelocity: 0,
    grounded: true,
    overrides: options.initialState.suspensionOverrides
      ? { ...options.initialState.suspensionOverrides }
      : null
  });

  addComponent(world, vehicle, COMPONENTS.engine, {
    audio: options.engineAudio,
    snapshot: options.engineAudio.getSnapshot()
  });

  const runtime = {
    world,
    config: options.config,
    vehicleEntity: vehicle
  };

  resetGarageRuntime(runtime);
  return runtime;
}

export function resetGarageRuntime(runtime) {
  const transform = getVehicleComponent(runtime, COMPONENTS.transform);
  const controller = getVehicleComponent(runtime, COMPONENTS.vehicleController);
  const cameraRig = getVehicleComponent(runtime, COMPONENTS.cameraRig);
  const stage = getVehicleComponent(runtime, COMPONENTS.stageBounds);
  const engine = getVehicleComponent(runtime, COMPONENTS.engine);
  const physics = getVehicleComponent(runtime, COMPONENTS.physics);

  transform.position.copy(stage.startPosition);
  transform.yaw = stage.startYaw;
  transform.bodyQuaternion.setFromAxisAngle(UP_AXIS, stage.startYaw);
  transform.useBodyQuaternion = false;
  controller.speed = 0;
  controller.steerAngle = 0;
  controller.steerInput = 0;
  controller.autopilotState = createAutopilotState();
  controller.automaticDirection = 1;
  controller.wheelSpin = 0;
  controller.longitudinalAccel = 0;
  controller.lateralAccel = 0;
  controller.yawRate = 0;
  cameraRig.detached = false;
  engine.snapshot = engine.audio.reset();
  const suspension = getVehicleComponent(runtime, COMPONENTS.suspension);
  suspension.heave = 0;
  suspension.heaveVelocity = 0;
  suspension.supportY = stage.startPosition.y;
  suspension.supportVelocity = 0;
  suspension.pitch = 0;
  suspension.pitchVelocity = 0;
  suspension.roll = 0;
  suspension.rollVelocity = 0;
  suspension.grounded = true;

  if (physics.bundle) {
    resetBounceVehicle(physics.bundle, stage.startPosition, stage.startYaw);
    settleBounceVehicle(physics.bundle);
    syncTransformFromBounceBody(transform, physics.bundle);
    transform.yaw = stage.startYaw;
  }

  clearWheelFeedbackState(getVehicleComponent(runtime, COMPONENTS.renderRig));
  applyVehicleTransformSystem(runtime);
  if (!physics.bundle) {
    updateSuspensionSystem(runtime, 0);
  }
  applyVehicleTransformSystem(runtime);
  return getGarageSnapshot(runtime);
}

export function updateGarageRuntime(runtime, deltaSeconds) {
  updateEngineSystem(runtime, deltaSeconds);
  updateDriveSystem(runtime, deltaSeconds);
  updateSuspensionSystem(runtime, deltaSeconds);
  applyVehicleTransformSystem(runtime);
  updateWheelAnimationSystem(runtime);
  updateVehicleFeedbackSystem(runtime, deltaSeconds);
  updateChaseCameraSystem(runtime, deltaSeconds);
  return getGarageSnapshot(runtime);
}

export function setDriveInput(runtime, key, active) {
  const driveInput = getVehicleComponent(runtime, COMPONENTS.driveInput);
  if (key in driveInput) {
    driveInput[key] = active;
  }

  return getGarageSnapshot(runtime);
}

export function setDriveMode(runtime, enabled) {
  const controller = getVehicleComponent(runtime, COMPONENTS.vehicleController);
  const transform = getVehicleComponent(runtime, COMPONENTS.transform);
  const physics = getVehicleComponent(runtime, COMPONENTS.physics);
  const wasDriveMode = controller.driveMode;
  controller.driveMode = enabled;
  controller.steerAngle = 0;
  controller.steerInput = 0;
  controller.automaticDirection = controller.speed < -0.5 ? -1 : 1;

  if (enabled && physics.bundle && !wasDriveMode) {
    physics.bundle.chassisBody.linearVelocity.zero();
    physics.bundle.chassisBody.angularVelocity.zero();
    physics.bundle.chassisBody.clearForces();
    physics.bundle.chassisBody.commitChanges();
    syncTransformFromBounceBody(transform, physics.bundle);
  }

  if (!enabled) {
    controller.speed = 0;
    if (physics.bundle?.chassisBody) {
      physics.bundle.chassisBody.linearVelocity.zero();
      physics.bundle.chassisBody.angularVelocity.zero();
      physics.bundle.chassisBody.clearForces();
      physics.bundle.chassisBody.commitChanges();
    }
    if (physics.bundle?.kinematicState) {
      physics.bundle.kinematicState.speed = 0;
      physics.bundle.kinematicState.lean = 0;
    }
  }
  controller.longitudinalAccel = 0;
  controller.lateralAccel = 0;
  controller.yawRate = 0;
  if (!enabled) {
    clearWheelFeedbackState(getVehicleComponent(runtime, COMPONENTS.renderRig));
  }

  return updateEngineSystem(runtime, 0);
}

export function setAutopilotEnabled(runtime, enabled) {
  const controller = getVehicleComponent(runtime, COMPONENTS.vehicleController);
  controller.autopilotEnabled = enabled;
  controller.autopilotTime = 0;
  controller.autopilotState = createAutopilotState();
  return getGarageSnapshot(runtime);
}

export function setDrivingStyle(runtime, drivingStyle) {
  const controller = getVehicleComponent(runtime, COMPONENTS.vehicleController);
  const nextStyle = getDrivingStyleConfig(runtime, drivingStyle);
  controller.drivingStyle = nextStyle.id;
  controller.automaticDirection = controller.speed < -0.5 ? -1 : 1;
  return updateEngineSystem(runtime, 0);
}

export function setCinematicCameraEnabled(runtime, enabled) {
  const cameraRig = getVehicleComponent(runtime, COMPONENTS.cameraRig);
  const controller = getVehicleComponent(runtime, COMPONENTS.vehicleController);
  const transform = getVehicleComponent(runtime, COMPONENTS.transform);
  const renderRig = getVehicleComponent(runtime, COMPONENTS.renderRig);
  cameraRig.cinematicEnabled = enabled;
  cameraRig.cinematicTime = 0;
  if (controller.driveMode && !cameraRig.override && !cameraRig.detached) {
    snapCameraToVehicle(runtime.config, transform, renderRig, controller, cameraRig);
  }
  return getGarageSnapshot(runtime);
}

export function setCameraOverride(runtime, active) {
  const cameraRig = getVehicleComponent(runtime, COMPONENTS.cameraRig);
  cameraRig.override = active;

  if (active) {
    cameraRig.detached = true;
  }

  return getGarageSnapshot(runtime);
}

export function setChassisHeight(runtime, chassisHeight) {
  const transform = getVehicleComponent(runtime, COMPONENTS.transform);
  transform.chassisHeight = chassisHeight;
  applyVehicleTransformSystem(runtime);
  return getGarageSnapshot(runtime);
}

export function setSuspensionOverrides(runtime, overrides) {
  const suspension = getVehicleComponent(runtime, COMPONENTS.suspension);
  suspension.overrides = overrides ? { ...overrides } : null;
  updateSuspensionSystem(runtime, 0);
  applyVehicleTransformSystem(runtime);
  updateWheelAnimationSystem(runtime);
  return getGarageSnapshot(runtime);
}

export function setGarageStage(runtime, stageDefinition) {
  const stage = getVehicleComponent(runtime, COMPONENTS.stageBounds);
  const physics = getVehicleComponent(runtime, COMPONENTS.physics);
  stage.startPosition.copy(stageDefinition.startPosition);
  stage.startYaw = stageDefinition.startYaw;
  stage.driveBounds = stageDefinition.driveBounds;
  stage.navigation = stageDefinition.navigation || null;
  stage.sampleGround = stageDefinition.sampleGround || null;
  stage.sampleCollision = stageDefinition.driveSampleCollision || stageDefinition.sampleCollision || null;
  stage.dynamicSampleCollision = stageDefinition.dynamicDriveSampleCollision || null;
  stage.physics = stageDefinition.physics || null;
  stage.skidMarks = stageDefinition.skidMarks || null;
  physics.bundle = stage.physics;
  return resetGarageRuntime(runtime);
}

export function refreshGarageStagePhysics(runtime, stageDefinition) {
  const transform = getVehicleComponent(runtime, COMPONENTS.transform);
  const controller = getVehicleComponent(runtime, COMPONENTS.vehicleController);
  const stage = getVehicleComponent(runtime, COMPONENTS.stageBounds);
  const physics = getVehicleComponent(runtime, COMPONENTS.physics);
  const renderRig = getVehicleComponent(runtime, COMPONENTS.renderRig);
  const engine = getVehicleComponent(runtime, COMPONENTS.engine);

  stage.sampleGround = stageDefinition.sampleGround || null;
  stage.sampleCollision = stageDefinition.driveSampleCollision || stageDefinition.sampleCollision || null;
  stage.dynamicSampleCollision = stageDefinition.dynamicDriveSampleCollision || null;
  stage.navigation = stageDefinition.navigation || null;
  stage.physics = stageDefinition.physics || null;
  stage.skidMarks = stageDefinition.skidMarks || null;
  physics.bundle = stage.physics;

  if (physics.bundle?.chassisBody) {
    const vehiclePhysics = getVehiclePhysicsProfile(
      physics.vehicleKind,
      engine.audio.getDefinition().physics,
      physics.bundle,
      renderRig?.wheelMount
    );
    configureBounceVehicle(
      physics.bundle,
      runtime.config,
      physics.vehicleKind,
      vehiclePhysics.massKg,
      transform.position,
      transform.yaw,
      renderRig?.wheelMount,
      getMountedBodyMetrics(renderRig?.carMount)
    );
    if (physics.vehicleKind === 'bike' && physics.bundle?.vehicleSpec?.wheelRadius) {
      controller.wheelRadius = physics.bundle.vehicleSpec.wheelRadius;
    }
    resetBounceVehicle(physics.bundle, transform.position, transform.yaw);

    if (controller.driveMode) {
      PHYSICS_FORWARD.set(0, 0, 1).applyAxisAngle(UP_AXIS, transform.yaw).normalize();
      physics.bundle.chassisBody.linearVelocity.set([
        PHYSICS_FORWARD.x * controller.speed,
        0,
        PHYSICS_FORWARD.z * controller.speed
      ]);
      physics.bundle.chassisBody.angularVelocity.set([0, controller.yawRate, 0]);
      physics.bundle.chassisBody.clearForces();
      physics.bundle.chassisBody.commitChanges();
    } else {
      settleBounceVehicle(physics.bundle, 12);
    }

    syncTransformFromBounceBody(transform, physics.bundle);
  }

  applyVehicleTransformSystem(runtime);
  updateWheelAnimationSystem(runtime);
  return getGarageSnapshot(runtime);
}

export function setGarageVehicleKind(runtime, vehicleKind) {
  const transform = getVehicleComponent(runtime, COMPONENTS.transform);
  const physics = getVehicleComponent(runtime, COMPONENTS.physics);
  const stage = getVehicleComponent(runtime, COMPONENTS.stageBounds);
  const engine = getVehicleComponent(runtime, COMPONENTS.engine);
  const controller = getVehicleComponent(runtime, COMPONENTS.vehicleController);
  const renderRig = getVehicleComponent(runtime, COMPONENTS.renderRig);
  physics.vehicleKind = vehicleKind;

  if (!physics.bundle && stage.physics) {
    physics.bundle = stage.physics;
  }

  if (physics.bundle) {
    const vehiclePhysics = getVehiclePhysicsProfile(
      vehicleKind,
      engine.audio.getDefinition().physics,
      physics.bundle,
      renderRig?.wheelMount
    );
    configureBounceVehicle(
      physics.bundle,
      runtime.config,
      vehicleKind,
      vehiclePhysics.massKg,
      transform.position,
      transform.yaw,
      renderRig?.wheelMount,
      getMountedBodyMetrics(renderRig?.carMount)
    );
    if (vehicleKind === 'bike' && physics.bundle?.vehicleSpec?.wheelRadius) {
      controller.wheelRadius = physics.bundle.vehicleSpec.wheelRadius;
    }
    resetBounceVehicle(physics.bundle, transform.position, transform.yaw);
    settleBounceVehicle(physics.bundle);
    syncTransformFromBounceBody(transform, physics.bundle);
  }

  clearWheelFeedbackState(getVehicleComponent(runtime, COMPONENTS.renderRig));
  return getGarageSnapshot(runtime);
}

export function setWheelRadius(runtime, wheelRadius) {
  const controller = getVehicleComponent(runtime, COMPONENTS.vehicleController);
  controller.wheelRadius = wheelRadius;
  return getGarageSnapshot(runtime);
}

export function teleportGarageVehicle(runtime, position, yaw) {
  const transform = getVehicleComponent(runtime, COMPONENTS.transform);
  const controller = getVehicleComponent(runtime, COMPONENTS.vehicleController);
  const cameraRig = getVehicleComponent(runtime, COMPONENTS.cameraRig);
  const physics = getVehicleComponent(runtime, COMPONENTS.physics);

  transform.position.copy(position);
  transform.yaw = yaw;
  transform.bodyQuaternion.setFromAxisAngle(UP_AXIS, yaw);
  transform.useBodyQuaternion = false;
  controller.speed = 0;
  controller.steerAngle = 0;
  controller.steerInput = 0;
  controller.autopilotState = createAutopilotState();
  controller.automaticDirection = 1;
  controller.wheelSpin = 0;
  controller.longitudinalAccel = 0;
  controller.lateralAccel = 0;
  controller.yawRate = 0;
  cameraRig.detached = false;

  if (physics.bundle) {
    resetBounceVehicle(physics.bundle, position, yaw);
    settleBounceVehicle(physics.bundle);
    syncTransformFromBounceBody(transform, physics.bundle);
  }

  clearWheelFeedbackState(getVehicleComponent(runtime, COMPONENTS.renderRig));
  applyVehicleTransformSystem(runtime);
  updateWheelAnimationSystem(runtime);
  return getGarageSnapshot(runtime);
}

export function setEngineType(runtime, engineTypeId) {
  const engine = getVehicleComponent(runtime, COMPONENTS.engine);
  engine.snapshot = engine.audio.setEngine(engineTypeId);
  return getGarageSnapshot(runtime);
}

export function shiftEngineUp(runtime) {
  const engine = getVehicleComponent(runtime, COMPONENTS.engine);
  engine.snapshot = engine.audio.shiftUp();
  return getGarageSnapshot(runtime);
}

export function shiftEngineDown(runtime) {
  const engine = getVehicleComponent(runtime, COMPONENTS.engine);
  engine.snapshot = engine.audio.shiftDown();
  return getGarageSnapshot(runtime);
}

export function shiftEngineNeutral(runtime) {
  const engine = getVehicleComponent(runtime, COMPONENTS.engine);
  engine.snapshot = engine.audio.shiftToNeutral();
  return getGarageSnapshot(runtime);
}

export async function ensureGarageAudioReady(runtime) {
  const engine = getVehicleComponent(runtime, COMPONENTS.engine);
  const ready = await engine.audio.ensureAudioReady();
  if (ready) {
    engine.snapshot = engine.audio.getSnapshot();
  }
  return getGarageSnapshot(runtime);
}

export function snapGarageCamera(runtime) {
  const transform = getVehicleComponent(runtime, COMPONENTS.transform);
  const controller = getVehicleComponent(runtime, COMPONENTS.vehicleController);
  const cameraRig = getVehicleComponent(runtime, COMPONENTS.cameraRig);
  const renderRig = getVehicleComponent(runtime, COMPONENTS.renderRig);
  cameraRig.override = false;
  cameraRig.detached = false;
  snapCameraToVehicle(runtime.config, transform, renderRig, controller, cameraRig);
  return getGarageSnapshot(runtime);
}

export function syncGarageScene(runtime) {
  applyVehicleTransformSystem(runtime);
  updateWheelAnimationSystem(runtime);
  return getGarageSnapshot(runtime);
}

export function getGarageSnapshot(runtime) {
  const transform = getVehicleComponent(runtime, COMPONENTS.transform);
  const controller = getVehicleComponent(runtime, COMPONENTS.vehicleController);
  const cameraRig = getVehicleComponent(runtime, COMPONENTS.cameraRig);
  const engine = getVehicleComponent(runtime, COMPONENTS.engine);

  return {
    driveMode: controller.driveMode,
    drivingStyle: controller.drivingStyle,
    autopilotEnabled: controller.autopilotEnabled,
    driveSpeed: controller.speed,
    steerAngle: controller.steerAngle,
    bikeLeanAngle: controller.bikeLeanAngle,
    vehicleYaw: transform.yaw,
    vehiclePosition: transform.position.clone(),
    cameraOverride: cameraRig.override,
    cameraDetached: cameraRig.detached,
    cinematicCameraEnabled: cameraRig.cinematicEnabled,
    wheelSpin: controller.wheelSpin,
    wheelRadius: controller.wheelRadius,
    chassisHeight: transform.chassisHeight,
    suspensionHeave: getVehicleComponent(runtime, COMPONENTS.suspension).heave,
    suspensionPitch: getVehicleComponent(runtime, COMPONENTS.suspension).pitch,
    suspensionRoll: getVehicleComponent(runtime, COMPONENTS.suspension).roll,
    engine: engine.snapshot,
    bikeWipeoutTrigger: controller.bikeWipeoutTrigger || null
  };
}

function updateDriveSystem(runtime, deltaSeconds) {
  for (const entity of queryEntities(runtime.world, [
    COMPONENTS.transform,
    COMPONENTS.vehicleController,
    COMPONENTS.driveInput,
    COMPONENTS.engine,
    COMPONENTS.cameraRig,
    COMPONENTS.stageBounds,
    COMPONENTS.physics,
    COMPONENTS.renderRig
  ])) {
    const transform = getComponent(runtime.world, entity, COMPONENTS.transform);
    const controller = getComponent(runtime.world, entity, COMPONENTS.vehicleController);
    const driveInput = getComponent(runtime.world, entity, COMPONENTS.driveInput);
    const engine = getComponent(runtime.world, entity, COMPONENTS.engine);
    const cameraRig = getComponent(runtime.world, entity, COMPONENTS.cameraRig);
    const stage = getComponent(runtime.world, entity, COMPONENTS.stageBounds);
    const physics = getComponent(runtime.world, entity, COMPONENTS.physics);
    const renderRig = getComponent(runtime.world, entity, COMPONENTS.renderRig);
    const previousSpeed = controller.speed;
    const vehiclePhysics = getVehiclePhysicsProfile(
      physics.vehicleKind,
      engine.audio.getDefinition().physics,
      physics.bundle,
      renderRig?.wheelMount
    );
    const drivingStyle = getDrivingStyleConfig(runtime, controller.drivingStyle);
    const suspensionConfig = getSuspensionConfig(runtime, physics.vehicleKind);
    cameraRig.cinematicTime += deltaSeconds;
    if (controller.autopilotEnabled) {
      controller.autopilotTime += deltaSeconds;
    }

    if (physics.bundle?.chassisBody && deltaSeconds > 0) {
      const maxSteerAngle =
        runtime.config.maxSteerAngle * (drivingStyle.maxSteerAngleMultiplier ?? 1);
      const bikeSteerResponseMultiplier =
        physics.vehicleKind === 'bike'
          ? Number(physics.bundle?.vehicleSpec?.steerResponseMultiplier ?? 1)
          : 1;
      if (physics.vehicleKind === 'bike') {
        const caster = getBikeCasterSteering(
          controller,
          physics.bundle?.vehicleSpec || {},
          vehiclePhysics,
          drivingStyle,
          runtime,
          maxSteerAngle,
          controller.speed
        );
        controller.steerAngle = dampTowards(
          controller.steerAngle,
          caster.targetSteer,
          controller.steerInput === 0 ? caster.returnRate : caster.responseRate,
          deltaSeconds
        );
      } else {
        controller.steerAngle = updateSteerAngleFromInput({
          currentSteerAngle: controller.steerAngle,
          steerInput: controller.steerInput,
          maxSteerAngle,
          steerResponse:
            (vehiclePhysics.steeringResponse ?? runtime.config.steeringRate) *
            (drivingStyle.steeringResponseMultiplier ?? 1) *
            bikeSteerResponseMultiplier,
          steerReturn:
            (vehiclePhysics.steeringReturnRate ?? runtime.config.steerReturnRate) *
            (drivingStyle.steeringReturnMultiplier ?? 1),
          deltaSeconds
        });
      }

      if (controller.driveMode) {
        KINEMATIC_PRE_STEP_POSITION.copy(transform.position);
        const tractionCoefficient =
          vehiclePhysics.tractionCoefficient * (drivingStyle.tractionCoefficientMultiplier ?? 1);
        const hasDriveIntent =
          Number(driveInput?.forward || 0) > 0.02 ||
          Number(driveInput?.reverse || 0) > 0.02 ||
          Number(engine.snapshot?.engineThrottle || 0) > 0.02;
        const stopHoldSpeed = drivingStyle.stopHoldSpeedMps ?? 0.32;
        const stopHoldBrakeForce = vehiclePhysics.massKg * 9.81 * (drivingStyle.stopHoldForceCoeff ?? 0.22);
        const lowSpeedBlend = THREE.MathUtils.clamp(
          1 - Math.abs(controller.speed) / Math.max(drivingStyle.lowSpeedDriveForceBlendSpeedMps ?? 10, 0.001),
          0,
          1
        );
        const driveForceMultiplier = THREE.MathUtils.lerp(
          drivingStyle.driveForceMultiplier ?? 1,
          drivingStyle.lowSpeedDriveForceMultiplier ?? (drivingStyle.driveForceMultiplier ?? 1),
          lowSpeedBlend
        ) * (physics.vehicleKind === 'bike' ? Number(physics.bundle?.vehicleSpec?.driveForceMultiplier ?? 1) : 1);
        let wheelForce = clamp(
          engine.snapshot.engineWheelForceN * driveForceMultiplier,
          -vehiclePhysics.massKg * 9.81 * tractionCoefficient,
          vehiclePhysics.massKg * 9.81 * tractionCoefficient
        );
        const tractionForceLimit = vehiclePhysics.massKg * 9.81 * tractionCoefficient;
        let brakeForce =
          Math.max(engine.snapshot.engineBrakeForceN, 0) * (drivingStyle.brakeForceMultiplier ?? 1);
        if (!hasDriveIntent && Math.abs(controller.speed) < stopHoldSpeed) {
          wheelForce = 0;
          brakeForce = Math.max(brakeForce, stopHoldBrakeForce);
        }
        const stepped = stepBounceVehicle(physics.bundle, {
          deltaSeconds,
          wheelForce,
          brakeForce,
          throttle: engine.snapshot.engineThrottle,
          tractionForceLimit,
          steerAngle: controller.steerAngle,
          steerInput: controller.steerInput,
          maxSteerAngle,
          wheelbaseM: vehiclePhysics.wheelbaseM,
          highSpeedSteerFactor: THREE.MathUtils.clamp(
            (vehiclePhysics.highSpeedSteerFactor ?? 1) * (drivingStyle.highSpeedSteerFactorMultiplier ?? 1),
            0,
            1
          ),
          rwdYawGain: (vehiclePhysics.rwdYawGain ?? 0) + (drivingStyle.rwdYawGainBoost ?? 0),
          rwdGripLoss: THREE.MathUtils.clamp(
            (vehiclePhysics.rwdGripLoss ?? 0) + (drivingStyle.rwdGripLossBoost ?? 0),
            0,
            0.92
          ),
          reverseSpeedLimitMps: vehiclePhysics.reverseSpeedLimitMps,
          maxVehicleSpeedMps: vehiclePhysics.maxVehicleSpeedMps,
          sampleGround: stage.sampleGround || null,
          wheelMount: renderRig.wheelMount,
          suspensionConfig
        });

        if (stepped) {
          let nextSteppedSpeed = (!hasDriveIntent && Math.abs(stepped.speed) < 0.06) ? 0 : stepped.speed;
          if (physics.vehicleKind === 'bike' && (stage.dynamicSampleCollision || stage.sampleCollision)) {
            TRAVEL_DELTA.copy(stepped.position).sub(KINEMATIC_PRE_STEP_POSITION);
            transform.position.copy(KINEMATIC_PRE_STEP_POSITION);
            controller.speed = nextSteppedSpeed;
            resolveForwardCollision(runtime, transform, controller, stage, TRAVEL_DELTA, {
              sampleCollision: stage.dynamicSampleCollision || stage.sampleCollision
            });
            // resolveForwardCollision may reduce controller.speed on collision
            nextSteppedSpeed = controller.speed;
            transform.position.add(TRAVEL_DELTA);
            if (physics.bundle?.chassisBody) {
              physics.bundle.chassisBody.position.set([
                transform.position.x,
                transform.position.y + physics.bundle.rootOffsetY,
                transform.position.z
              ]);
              physics.bundle.chassisBody.orientation.set([
                stepped.quaternion.x,
                stepped.quaternion.y,
                stepped.quaternion.z,
                stepped.quaternion.w
              ]);
              physics.bundle.chassisBody.commitChanges();
              if (physics.bundle.kinematicState) {
                physics.bundle.kinematicState.speed = nextSteppedSpeed;
                physics.bundle.kinematicState.yaw = stepped.yaw;
              }
            }
          } else {
            transform.position.copy(stepped.position);
          }
          if (
            physics.vehicleKind === 'bike' &&
            !hasDriveIntent &&
            Math.abs(stepped.speed) < 0.18 &&
            physics.bundle?.chassisBody
          ) {
            physics.bundle.chassisBody.linearVelocity.x = 0;
            physics.bundle.chassisBody.linearVelocity.z = 0;
            physics.bundle.chassisBody.angularVelocity.y *= 0.35;
            physics.bundle.chassisBody.commitChanges();
          }
          transform.bodyQuaternion.copy(stepped.quaternion);
          transform.yaw = stepped.yaw;
          transform.useBodyQuaternion = true;
          controller.speed = nextSteppedSpeed;
          controller.yawRate = stepped.yawRate;
          controller.wheelSpin += (controller.speed * deltaSeconds) / Math.max(controller.wheelRadius, 0.12);
        }

        controller.longitudinalAccel = deltaSeconds > 0 ? (controller.speed - previousSpeed) / deltaSeconds : 0;
        controller.lateralAccel = controller.speed * controller.yawRate;

        // Detect bike wipeout: abrupt collision stop
        if (
          physics.vehicleKind === 'bike' &&
          Math.abs(previousSpeed) > 5 &&
          Math.abs(controller.speed) < Math.abs(previousSpeed) * 0.5
        ) {
          controller.bikeWipeoutTrigger = {
            impactSpeed: previousSpeed,
            yaw: transform.yaw,
            position: transform.position.clone()
          };
        } else {
          controller.bikeWipeoutTrigger = null;
        }
      } else {
        const body = physics.bundle?.chassisBody;
        if (!body) {
          transform.useBodyQuaternion = false;
          controller.speed = 0;
          controller.longitudinalAccel = 0;
          controller.lateralAccel = 0;
          controller.yawRate = 0;
          continue;
        }
        body.linearVelocity.zero();
        body.angularVelocity.zero();
        body.clearForces();
        body.commitChanges();
        transform.position.set(
          body.position.x,
          body.position.y - physics.bundle.rootOffsetY,
          body.position.z
        );
        transform.bodyQuaternion.set(
          body.orientation.x,
          body.orientation.y,
          body.orientation.z,
          body.orientation.w
        );
        PHYSICS_FORWARD.set(0, 0, 1).applyQuaternion(transform.bodyQuaternion).setY(0).normalize();
        transform.yaw = Math.atan2(PHYSICS_FORWARD.x, PHYSICS_FORWARD.z);
        transform.useBodyQuaternion = true;
        controller.speed = 0;
        controller.longitudinalAccel = 0;
        controller.lateralAccel = 0;
        controller.yawRate = 0;
      }
    } else if (deltaSeconds > 0 && controller.driveMode) {
      const speed = controller.speed;
      const speedAbs = Math.abs(speed);
      const speedSign = Math.sign(speed) || 1;
      const hasDriveIntent =
        Number(driveInput?.forward || 0) > 0.02 ||
        Number(driveInput?.reverse || 0) > 0.02 ||
        Number(engine.snapshot?.engineThrottle || 0) > 0.02;
      const stopHoldSpeed = drivingStyle.stopHoldSpeedMps ?? 0.32;
      const stopHoldForce = vehiclePhysics.massKg * 9.81 * (drivingStyle.stopHoldForceCoeff ?? 0.22);
      const airDensity = 1.225;
      const aeroDragForce =
        0.5 * airDensity * vehiclePhysics.dragCoefficient * vehiclePhysics.frontalAreaM2 * speedAbs * speedAbs * speedSign;
      const rollingResistanceForce =
        speedAbs > 0.02 ? vehiclePhysics.massKg * 9.81 * vehiclePhysics.rollingResistanceCoeff * speedSign : 0;
      const brakeForce =
        controller.speed !== 0
          ? engine.snapshot.engineBrakeForceN *
            (drivingStyle.brakeForceMultiplier ?? 1) *
            Math.sign(controller.speed)
          : 0;
      const tractionCoefficient =
        vehiclePhysics.tractionCoefficient * (drivingStyle.tractionCoefficientMultiplier ?? 1);
      const lowSpeedBlend = THREE.MathUtils.clamp(
        1 - Math.abs(controller.speed) / Math.max(drivingStyle.lowSpeedDriveForceBlendSpeedMps ?? 10, 0.001),
        0,
        1
      );
      const driveForceMultiplier = THREE.MathUtils.lerp(
        drivingStyle.driveForceMultiplier ?? 1,
        drivingStyle.lowSpeedDriveForceMultiplier ?? (drivingStyle.driveForceMultiplier ?? 1),
        lowSpeedBlend
      );
      const wheelForce = clamp(
        engine.snapshot.engineWheelForceN * driveForceMultiplier,
        -vehiclePhysics.massKg * 9.81 * tractionCoefficient,
        vehiclePhysics.massKg * 9.81 * tractionCoefficient
      );
      let netForce = wheelForce - aeroDragForce - rollingResistanceForce - brakeForce;
      if (!hasDriveIntent && speedAbs < stopHoldSpeed) {
        const holdForce = speedAbs > 0.001
          ? -Math.sign(controller.speed) * stopHoldForce
          : 0;
        if (Math.abs(netForce) < stopHoldForce * 1.15) {
          netForce = holdForce;
        }
      }
      const acceleration = netForce / vehiclePhysics.massKg;
      controller.speed += acceleration * deltaSeconds;

      if (
        Math.abs(controller.speed) < 0.05 &&
        (
          (!hasDriveIntent && Math.abs(wheelForce) < 220) ||
          (engine.snapshot.engineBrakeForceN > 0 && Math.abs(wheelForce) < 160)
        )
      ) {
        controller.speed = 0;
      }

      controller.speed = THREE.MathUtils.clamp(
        controller.speed,
        -vehiclePhysics.reverseSpeedLimitMps,
        vehiclePhysics.maxVehicleSpeedMps
      );

      const maxSteerAngle =
        runtime.config.maxSteerAngle * (drivingStyle.maxSteerAngleMultiplier ?? 1);
      if (physics.vehicleKind === 'bike') {
        const caster = getBikeCasterSteering(
          controller,
          physics.bundle?.vehicleSpec || {},
          vehiclePhysics,
          drivingStyle,
          runtime,
          maxSteerAngle,
          controller.speed
        );
        controller.steerAngle = dampTowards(
          controller.steerAngle,
          caster.targetSteer,
          controller.steerInput === 0 ? caster.returnRate : caster.responseRate,
          deltaSeconds
        );
      } else {
        controller.steerAngle = updateSteerAngleFromInput({
          currentSteerAngle: controller.steerAngle,
          steerInput: controller.steerInput,
          maxSteerAngle,
          steerResponse:
            (vehiclePhysics.steeringResponse ?? runtime.config.steeringRate) *
            (drivingStyle.steeringResponseMultiplier ?? 1),
          steerReturn:
            (vehiclePhysics.steeringReturnRate ?? runtime.config.steerReturnRate) *
            (drivingStyle.steeringReturnMultiplier ?? 1),
          deltaSeconds
        });
      }

      const steerSpeedFactor = clamp(Math.abs(controller.speed) / 28, 0, 1);
      const steeringAuthority = lerp(
        1,
        THREE.MathUtils.clamp(
          (vehiclePhysics.highSpeedSteerFactor ?? 1) * (drivingStyle.highSpeedSteerFactorMultiplier ?? 1),
          0,
          1
        ),
        steerSpeedFactor
      );
      const effectiveSteer = controller.steerAngle * steeringAuthority;
      let yawRate = 0;
      if (Math.abs(controller.speed) > 0.01 && Math.abs(effectiveSteer) > 0.0001) {
        yawRate = (controller.speed / vehiclePhysics.wheelbaseM) * Math.tan(effectiveSteer);
        transform.yaw -= yawRate * deltaSeconds;
        controller.speed *= Math.max(
          0.84,
          1 -
            Math.abs(effectiveSteer) *
              Math.abs(controller.speed) *
              vehiclePhysics.corneringDragStrength *
              (drivingStyle.corneringDragMultiplier ?? 1) *
              0.01
        );
      }

      const forward = DRIVE_FORWARD.set(Math.sin(transform.yaw), 0, Math.cos(transform.yaw));
      const travelDistance = controller.speed * deltaSeconds;
      TRAVEL_DELTA.copy(forward).multiplyScalar(travelDistance);
      resolveForwardCollision(runtime, transform, controller, stage, TRAVEL_DELTA);
      transform.position.add(TRAVEL_DELTA);

      if (Number.isFinite(stage.driveBounds)) {
        transform.position.x = THREE.MathUtils.clamp(transform.position.x, -stage.driveBounds, stage.driveBounds);
        transform.position.z = THREE.MathUtils.clamp(transform.position.z, -stage.driveBounds, stage.driveBounds);

        if (
          Math.abs(transform.position.x) === stage.driveBounds ||
          Math.abs(transform.position.z) === stage.driveBounds
        ) {
          controller.speed *= 0.18;
        }
      }

      controller.wheelSpin += travelDistance / Math.max(controller.wheelRadius, 0.12);
      controller.longitudinalAccel = (controller.speed - previousSpeed) / deltaSeconds;
      controller.yawRate = yawRate;
      controller.lateralAccel = controller.speed * yawRate;
    } else {
      controller.longitudinalAccel = 0;
      controller.lateralAccel = 0;
      controller.yawRate = 0;
    }

    const movementStart = Math.abs(previousSpeed) < 0.15 && Math.abs(controller.speed) >= 0.15;
    if (movementStart && cameraRig.detached && !cameraRig.override) {
      cameraRig.detached = false;
      snapCameraToVehicle(runtime.config, transform, renderRig, controller, cameraRig);
    }
  }
}

function resolveForwardCollision(runtime, transform, controller, stage, travelDelta, options = {}) {
  const sampleCollision = options.sampleCollision || stage.sampleCollision;
  if (!sampleCollision) {
    return;
  }

  const travelDistance = travelDelta.length();
  if (travelDistance <= 0.0001) {
    return;
  }

  const direction = travelDelta.clone().normalize();
  PROBE_SIDE.set(-direction.z, 0, direction.x);
  const forwardReach = Math.max(controller.wheelRadius * 1.6, 0.9);
  const probeHeight = transform.position.y + controller.wheelRadius * 0.9 + 0.35;
  const probeOffsets = [
    { forward: forwardReach, side: 0 },
    { forward: forwardReach * 0.85, side: controller.wheelRadius * 0.9 },
    { forward: forwardReach * 0.85, side: -controller.wheelRadius * 0.9 }
  ];
  let blockedDistance = null;

  for (const local of probeOffsets) {
    PROBE_LOCAL.copy(direction)
      .multiplyScalar(local.forward)
      .addScaledVector(PROBE_SIDE, local.side);
    PROBE_ORIGIN.set(
      transform.position.x + PROBE_LOCAL.x,
      probeHeight,
      transform.position.z + PROBE_LOCAL.z
    );

    const hit = sampleCollision(PROBE_ORIGIN, direction, travelDistance + 0.8);
    if (!hit?.normal || hit.normal.y > 0.45) {
      continue;
    }

    const safeDistance = Math.max(0, hit.distance - 0.35);
    blockedDistance = blockedDistance === null ? safeDistance : Math.min(blockedDistance, safeDistance);
  }

  if (blockedDistance === null) {
    return;
  }

  if (blockedDistance <= 0.001) {
    travelDelta.set(0, 0, 0);
    controller.speed *= 0.08;
    return;
  }

  travelDelta.setLength(Math.min(travelDistance, blockedDistance));
  controller.speed *= 0.42;
}

function updateSuspensionSystem(runtime, deltaSeconds) {
  for (const entity of queryEntities(runtime.world, [
    COMPONENTS.transform,
    COMPONENTS.vehicleController,
    COMPONENTS.renderRig,
    COMPONENTS.stageBounds,
    COMPONENTS.suspension,
    COMPONENTS.physics
  ])) {
    const transform = getComponent(runtime.world, entity, COMPONENTS.transform);
    const controller = getComponent(runtime.world, entity, COMPONENTS.vehicleController);
    const renderRig = getComponent(runtime.world, entity, COMPONENTS.renderRig);
    const stage = getComponent(runtime.world, entity, COMPONENTS.stageBounds);
    const suspension = getComponent(runtime.world, entity, COMPONENTS.suspension);
    const physics = getComponent(runtime.world, entity, COMPONENTS.physics);
    const suspensionConfig = getSuspensionConfig(runtime, physics.vehicleKind);
    const sampleGround = stage.sampleGround;
    const wheels = renderRig.wheelMount.children.filter((wheel) => wheel?.isObject3D);
    const dt = Math.max(deltaSeconds, 1 / 120);

    if (!wheels.length) {
      continue;
    }

    if (physics.bundle) {
      const wheelMountBasePosition =
        renderRig.wheelMount.userData.baseLocalPosition || renderRig.wheelMount.position.clone();
      renderRig.wheelMount.userData.baseLocalPosition = wheelMountBasePosition;
      BODY_QUATERNION.copy(transform.useBodyQuaternion ? transform.bodyQuaternion : YAW_QUATERNION.setFromAxisAngle(UP_AXIS, transform.yaw));
      DRIVE_UP.set(0, 1, 0).applyQuaternion(BODY_QUATERNION).normalize();
      const physicsWheelStates = physics.bundle.wheelStates || [];

      let compressionSum = 0;
      let compressionCount = 0;
      let wheelVelocitySum = 0;
      let frontCompression = 0;
      let rearCompression = 0;
      let leftCompression = 0;
      let rightCompression = 0;
      let frontCount = 0;
      let rearCount = 0;
      let leftCount = 0;
      let rightCount = 0;
      const feedbackConfig = getVehicleFeedbackConfig(runtime, physics.vehicleKind);

      for (const wheel of wheels) {
        const restPosition = wheel.userData.restPosition || wheel.position.clone();
        wheel.userData.restPosition = restPosition;
        const wheelState = physicsWheelStates.find((state) => state?.anchorName === wheel.userData.anchorName);
        let targetOffset = Number(wheelState?.targetOffset ?? 0);
        if (!wheelState) {
          const wheelRadius = Number(wheel.userData.wheelRadius || controller.wheelRadius || 0.42);

          WHEEL_LOCAL.copy(wheelMountBasePosition).add(restPosition);
          REST_WORLD.copy(WHEEL_LOCAL).applyQuaternion(BODY_QUATERNION);
          WHEEL_SAMPLE.set(
            transform.position.x + REST_WORLD.x,
            transform.position.y + REST_WORLD.y,
            transform.position.z + REST_WORLD.z
          );

          if (sampleGround) {
            const hit = sampleGround(WHEEL_SAMPLE.x, WHEEL_SAMPLE.z, WHEEL_SAMPLE.y);
            if (hit) {
              const desiredCenterY = hit.height + wheelRadius;
              const verticalDelta = desiredCenterY - WHEEL_SAMPLE.y;
              const localTravel = DRIVE_UP.y > 1e-4 ? verticalDelta / DRIVE_UP.y : 0;
              targetOffset = clamp(
                localTravel - suspensionConfig.supportContactBuffer,
                -suspensionConfig.droopTravel,
                suspensionConfig.bumpTravel + suspensionConfig.rideCompression
              );
              if (Math.abs(targetOffset - suspensionConfig.rideCompression) < suspensionConfig.supportDeadzone) {
                targetOffset = suspensionConfig.rideCompression;
              }
            }
          }
        }

        const shouldSnapToNeutral =
          Math.abs(targetOffset - suspensionConfig.rideCompression) < 0.025 &&
          Math.abs(controller.longitudinalAccel) < 1.25 &&
          Math.abs(controller.lateralAccel) < 1.25 &&
          Math.abs(controller.yawRate) < 0.3;

        const currentOffset = Number(wheel.userData.suspensionOffset || 0);
        const currentVelocity = Number(wheel.userData.suspensionVelocity || 0);
        const nextState = springTowards(
          currentOffset,
          shouldSnapToNeutral ? suspensionConfig.rideCompression : targetOffset,
          currentVelocity,
          shouldSnapToNeutral ? suspensionConfig.neutralWheelSpring : suspensionConfig.wheelSpring,
          shouldSnapToNeutral ? suspensionConfig.neutralWheelDamping : suspensionConfig.wheelDamping,
          dt
        );
        const nextOffset = nextState.value;

        wheel.userData.suspensionOffset = nextOffset;
        wheel.userData.suspensionVelocity = nextState.velocity;
        wheel.position.set(restPosition.x, restPosition.y + nextOffset, restPosition.z);
        compressionSum += nextOffset;
        compressionCount += 1;
        wheelVelocitySum += wheelState?.springVelocity ?? nextState.velocity;

        const anchorName = String(wheel.userData.anchorName || '');
        const isFront = anchorName.includes('front') || restPosition.z > 0;
        const isLeft = anchorName.includes('left') || restPosition.x > 0;

        if (isFront) {
          frontCompression += nextOffset;
          frontCount += 1;
        } else {
          rearCompression += nextOffset;
          rearCount += 1;
        }

        if (isLeft) {
          leftCompression += nextOffset;
          leftCount += 1;
        } else {
          rightCompression += nextOffset;
          rightCount += 1;
        }
      }

      const averageCompression = compressionCount ? compressionSum / compressionCount : 0;
      const averageWheelVelocity = compressionCount ? wheelVelocitySum / compressionCount : 0;
      const normalizedCompression = averageCompression;
      const frontAverage = frontCount ? frontCompression / frontCount : 0;
      const rearAverage = rearCount ? rearCompression / rearCount : 0;
      const leftAverage = leftCount ? leftCompression / leftCount : 0;
      const rightAverage = rightCount ? rightCompression / rightCount : 0;
      const targetHeave = clamp(
        -(normalizedCompression - suspensionConfig.rideCompression) * 0.18 +
          averageWheelVelocity * suspensionConfig.heaveWheelVelocityFactor,
        -suspensionConfig.bumpTravel * 0.45,
        suspensionConfig.droopTravel * 0.28
      );
      suspension.heaveVelocity +=
        (targetHeave - suspension.heave) * suspensionConfig.heaveSpring * dt;
      suspension.heaveVelocity *= Math.exp(-suspensionConfig.heaveDamping * dt);
      suspension.heave += suspension.heaveVelocity * dt;

      const pitchScale = feedbackConfig.bodyPitchScale ?? 0.24;
      const rollScale = feedbackConfig.bodyRollScale ?? 0.24;
      const targetPitch = clamp(
        ((frontAverage - rearAverage) * suspensionConfig.contactPitchFactor -
          controller.longitudinalAccel * suspensionConfig.pitchAccelFactor) *
          pitchScale,
        -suspensionConfig.maxPitch * pitchScale,
        suspensionConfig.maxPitch * pitchScale
      );
      const targetRoll = clamp(
        ((leftAverage - rightAverage) * suspensionConfig.contactRollFactor -
          controller.lateralAccel * suspensionConfig.rollAccelFactor) *
          rollScale,
        -suspensionConfig.maxRoll * rollScale,
        suspensionConfig.maxRoll * rollScale
      );

      suspension.pitchVelocity += (targetPitch - suspension.pitch) * suspensionConfig.pitchSpring * dt;
      suspension.pitchVelocity *= Math.exp(-suspensionConfig.pitchDamping * dt);
      suspension.pitch += suspension.pitchVelocity * dt;

      suspension.rollVelocity += (targetRoll - suspension.roll) * suspensionConfig.rollSpring * dt;
      suspension.rollVelocity *= Math.exp(-suspensionConfig.rollDamping * dt);
      suspension.roll += suspension.rollVelocity * dt;
      continue;
    }

    const wheelMountBasePosition =
      renderRig.wheelMount.userData.baseLocalPosition || renderRig.wheelMount.position.clone();
    renderRig.wheelMount.userData.baseLocalPosition = wheelMountBasePosition;
    const rootY = transform.position.y + wheelMountBasePosition.y;
    const yawQuaternion = YAW_QUATERNION.setFromAxisAngle(UP_AXIS, transform.yaw);
    let contactCount = 0;
    let averageDelta = 0;
    let maxDelta = -Infinity;
    let frontDelta = 0;
    let rearDelta = 0;
    let leftDelta = 0;
    let rightDelta = 0;
    let frontCount = 0;
    let rearCount = 0;
    let leftCount = 0;
    let rightCount = 0;

    for (const wheel of wheels) {
      const restPosition = wheel.userData.restPosition || wheel.position.clone();
      wheel.userData.restPosition = restPosition;
      const wheelRadius = Number(wheel.userData.wheelRadius || controller.wheelRadius || 0.42);

      REST_WORLD.copy(restPosition).applyQuaternion(yawQuaternion);
      WHEEL_SAMPLE.set(
        transform.position.x + REST_WORLD.x,
        rootY + restPosition.y,
        transform.position.z + REST_WORLD.z
      );

      let groundDelta = 0;
      if (sampleGround) {
        const hit = sampleGround(WHEEL_SAMPLE.x, WHEEL_SAMPLE.z, WHEEL_SAMPLE.y);
        if (hit) {
          if (wheel.userData.restContactHeight === undefined) {
            wheel.userData.restContactHeight = hit.height;
          }
          groundDelta = hit.height - wheel.userData.restContactHeight;
          contactCount += 1;
          averageDelta += groundDelta;
          maxDelta = Math.max(maxDelta, groundDelta);

          const anchorName = String(wheel.userData.anchorName || '');
          const localX = restPosition.x;
          const localZ = restPosition.z;
          const isFront = anchorName.includes('front') || localZ > 0;
          const isLeft = anchorName.includes('left') || localX > 0;

          if (isFront) {
            frontDelta += groundDelta;
            frontCount += 1;
          } else {
            rearDelta += groundDelta;
            rearCount += 1;
          }

          if (isLeft) {
            leftDelta += groundDelta;
            leftCount += 1;
          } else {
            rightDelta += groundDelta;
            rightCount += 1;
          }
        }
      }
      if (wheel.userData.restContactHeight === undefined) {
        wheel.userData.restContactHeight = WHEEL_SAMPLE.y - wheelRadius;
      }

      wheel.userData.targetGroundDelta = groundDelta;
    }

    if (contactCount > 0) {
      const targetSupportY = maxDelta;
      suspension.supportVelocity += (targetSupportY - suspension.supportY) * suspensionConfig.heaveSpring * dt;
      suspension.supportVelocity *= Math.exp(-suspensionConfig.heaveDamping * dt);
      suspension.grounded = true;
    } else {
      suspension.supportVelocity -= suspensionConfig.airborneGravity * dt;
      suspension.grounded = false;
    }

    suspension.supportY += suspension.supportVelocity * dt;
    suspension.supportY = clamp(
      suspension.supportY,
      -suspensionConfig.droopTravel,
      suspensionConfig.bumpTravel
    );
    transform.position.y = suspension.supportY;

    frontDelta = 0;
    rearDelta = 0;
    leftDelta = 0;
    rightDelta = 0;
    frontCount = 0;
    rearCount = 0;
    leftCount = 0;
    rightCount = 0;

    for (const wheel of wheels) {
      const restPosition = wheel.userData.restPosition || wheel.position;
      const targetOffset = clamp(
        Number(wheel.userData.targetGroundDelta || 0) - suspension.supportY + suspensionConfig.rideCompression,
        -suspensionConfig.droopTravel,
        suspensionConfig.bumpTravel + suspensionConfig.rideCompression
      );
      const filteredTargetOffset =
        Math.abs(targetOffset - suspensionConfig.rideCompression) < suspensionConfig.supportDeadzone
          ? suspensionConfig.rideCompression
          : targetOffset;
      wheel.userData.targetSuspensionOffset = filteredTargetOffset;

      const anchorName = String(wheel.userData.anchorName || '');
      const localX = restPosition.x;
      const localZ = restPosition.z;
      const isFront = anchorName.includes('front') || localZ > 0;
      const isLeft = anchorName.includes('left') || localX > 0;

      if (isFront) {
        frontDelta += filteredTargetOffset;
        frontCount += 1;
      } else {
        rearDelta += filteredTargetOffset;
        rearCount += 1;
      }

      if (isLeft) {
        leftDelta += filteredTargetOffset;
        leftCount += 1;
      } else {
        rightDelta += filteredTargetOffset;
        rightCount += 1;
      }
    }

    const baseCompressionTarget = clamp(
      -suspension.supportVelocity * 0.035,
      -suspensionConfig.droopTravel * 0.45,
      suspensionConfig.bumpTravel * 0.65
    );
    suspension.heaveVelocity += (baseCompressionTarget - suspension.heave) * suspensionConfig.heaveSpring * dt;
    suspension.heaveVelocity *= Math.exp(-suspensionConfig.heaveDamping * dt);
    suspension.heave += suspension.heaveVelocity * dt;
    suspension.heave = clamp(
      suspension.heave,
      -suspensionConfig.droopTravel * 0.6,
      suspensionConfig.bumpTravel * 0.75
    );

    const frontAverage = frontCount ? frontDelta / frontCount : 0;
    const rearAverage = rearCount ? rearDelta / rearCount : 0;
    const leftAverage = leftCount ? leftDelta / leftCount : 0;
    const rightAverage = rightCount ? rightDelta / rightCount : 0;
    const targetPitch = clamp(
      (frontAverage - rearAverage) * suspensionConfig.contactPitchFactor -
        controller.longitudinalAccel * suspensionConfig.pitchAccelFactor,
      -suspensionConfig.maxPitch,
      suspensionConfig.maxPitch
    );
    const targetRoll = clamp(
      (leftAverage - rightAverage) * suspensionConfig.contactRollFactor -
        controller.lateralAccel * suspensionConfig.rollAccelFactor,
      -suspensionConfig.maxRoll,
      suspensionConfig.maxRoll
    );

    suspension.pitchVelocity += (targetPitch - suspension.pitch) * suspensionConfig.pitchSpring * dt;
    suspension.pitchVelocity *= Math.exp(-suspensionConfig.pitchDamping * dt);
    suspension.pitch += suspension.pitchVelocity * dt;

    suspension.rollVelocity += (targetRoll - suspension.roll) * suspensionConfig.rollSpring * dt;
    suspension.rollVelocity *= Math.exp(-suspensionConfig.rollDamping * dt);
    suspension.roll += suspension.rollVelocity * dt;

    for (const wheel of wheels) {
      const restPosition = wheel.userData.restPosition || wheel.position;
      const targetOffset = clamp(
        Number(wheel.userData.targetSuspensionOffset || 0),
        -suspensionConfig.droopTravel,
        suspensionConfig.bumpTravel + suspensionConfig.rideCompression
      );
      const shouldSnapToNeutral =
        Math.abs(targetOffset - suspensionConfig.rideCompression) < 0.02 &&
        Math.abs(controller.longitudinalAccel) < 1 &&
        Math.abs(controller.lateralAccel) < 1 &&
        Math.abs(controller.yawRate) < 0.25;
      const currentOffset = Number(wheel.userData.suspensionOffset || 0);
      const currentVelocity = Number(wheel.userData.suspensionVelocity || 0);
      const nextState = springTowards(
        currentOffset,
        shouldSnapToNeutral ? suspensionConfig.rideCompression : targetOffset,
        currentVelocity,
        shouldSnapToNeutral ? suspensionConfig.neutralWheelSpring : suspensionConfig.wheelSpring,
        shouldSnapToNeutral ? suspensionConfig.neutralWheelDamping : suspensionConfig.wheelDamping,
        dt
      );
      const nextOffset = nextState.value;

      wheel.userData.suspensionOffset = nextOffset;
      wheel.userData.suspensionVelocity = nextState.velocity;
      wheel.position.set(restPosition.x, restPosition.y + nextOffset, restPosition.z);
    }
  }
}

function updateEngineSystem(runtime, deltaSeconds) {
  for (const entity of queryEntities(runtime.world, [
    COMPONENTS.transform,
    COMPONENTS.vehicleController,
    COMPONENTS.driveInput,
    COMPONENTS.engine,
    COMPONENTS.physics,
    COMPONENTS.stageBounds
  ])) {
    const transform = getComponent(runtime.world, entity, COMPONENTS.transform);
    const controller = getComponent(runtime.world, entity, COMPONENTS.vehicleController);
    const driveInput = getComponent(runtime.world, entity, COMPONENTS.driveInput);
    const engine = getComponent(runtime.world, entity, COMPONENTS.engine);
    const physics = getComponent(runtime.world, entity, COMPONENTS.physics);
    const stage = getComponent(runtime.world, entity, COMPONENTS.stageBounds);
    const drivingStyle = getDrivingStyleConfig(runtime, controller.drivingStyle);
    const gear = engine.audio.getCurrentGear();
    let forwardInput = Number(driveInput.forward);
    let reverseInput = Number(driveInput.reverse);
    let steerInput = Number(driveInput.right) - Number(driveInput.left);

    if (controller.autopilotEnabled && controller.driveMode) {
      const autopilotInput = computeAutopilotInputs({
        config: runtime.config,
        controller,
        transform,
        stageNavigation: stage.navigation || null
      });
      if (autopilotInput) {
        steerInput = autopilotInput.steerInput;
        forwardInput = autopilotInput.forwardInput;
        reverseInput = autopilotInput.reverseInput;
      }
    }

    const {
      throttleInput,
      brakeInput,
      desiredDirection
    } = resolveDriveCommandInputs({
      controller,
      drivingStyle,
      gearRatio: gear.ratio,
      forwardInput,
      reverseInput
    });

    controller.steerInput = steerInput;

    engine.snapshot = updateVehicleEngineSnapshot({
      engineAudio: engine.audio,
      controller,
      drivingStyle,
      deltaSeconds,
      throttleInput,
      brakeInput,
      desiredDirection
    });

    if (physics.vehicleKind === 'bike') {
      const feedbackConfig = getVehicleFeedbackConfig(runtime, 'bike');
      const maxSteerAngle = runtime.config.maxSteerAngle || 0.5;
      const normalizedSteer = maxSteerAngle > 1e-6 ? clamp(controller.steerAngle / maxSteerAngle, -1, 1) : 0;
      const speedFactor = clamp(Math.abs(controller.speed) / (feedbackConfig.leanSpeedMps || 8.5), 0, 1);
      const steerLean =
        normalizedSteer *
        (feedbackConfig.leanMax || 0.34) *
        (feedbackConfig.leanSteerFactor || 0.9) *
        speedFactor;
      const lateralLean =
        controller.lateralAccel *
        (feedbackConfig.leanLateralFactor || 0.018) *
        0.35 *
        speedFactor;
      const targetLean = clamp(
        steerLean + lateralLean,
        -((feedbackConfig.leanMax || 0.34) * 0.72),
        (feedbackConfig.leanMax || 0.34) * 0.72
      );
      controller.bikeLeanAngle = dampTowards(
        controller.bikeLeanAngle,
        targetLean,
        (feedbackConfig.leanResponse || 6.5) * 0.82,
        deltaSeconds
      );
    } else {
      controller.bikeLeanAngle = dampTowards(controller.bikeLeanAngle, 0, 8, deltaSeconds);
    }
  }

  return getGarageSnapshot(runtime);
}

function applyVehicleTransformSystem(runtime) {
  for (const entity of queryEntities(runtime.world, [
    COMPONENTS.transform,
    COMPONENTS.renderRig,
    COMPONENTS.suspension,
    COMPONENTS.vehicleController
  ])) {
    const transform = getComponent(runtime.world, entity, COMPONENTS.transform);
    const renderRig = getComponent(runtime.world, entity, COMPONENTS.renderRig);
    const suspension = getComponent(runtime.world, entity, COMPONENTS.suspension);
    const controller = getComponent(runtime.world, entity, COMPONENTS.vehicleController);
    const chassisHeightMode = renderRig.carMount.userData.chassisHeightMode || 'body';
    const rootVisualOffsetY = Number(renderRig.carMount.userData.rootVisualOffsetY || 0);
    const rootChassisHeight = chassisHeightMode === 'root' ? transform.chassisHeight + rootVisualOffsetY : rootVisualOffsetY;
    const bodyChassisHeight = chassisHeightMode === 'body' ? transform.chassisHeight : 0;
    const isBike = renderRig.carMount.userData.vehicleKind === 'bike';
    applyCarRenderRigRuntimeState({
      renderRig,
      runtimeState: controller,
      transformPosition: transform.position,
      transformYaw: transform.yaw,
      transformQuaternion: transform.bodyQuaternion,
      useBodyQuaternion: transform.useBodyQuaternion,
      rootChassisHeight,
      bodyChassisHeight,
      suspensionPitch: suspension.pitch,
      suspensionRoll: suspension.roll,
      upAxis: UP_AXIS
    });
  }
}

function updateWheelAnimationSystem(runtime) {
  for (const entity of queryEntities(runtime.world, [COMPONENTS.vehicleController, COMPONENTS.renderRig])) {
    const controller = getComponent(runtime.world, entity, COMPONENTS.vehicleController);
    const renderRig = getComponent(runtime.world, entity, COMPONENTS.renderRig);
    applyCarRenderRigWheelState({
      renderRig,
      runtimeState: controller,
      upAxis: UP_AXIS
    });
  }
}

function updateVehicleFeedbackSystem(runtime, deltaSeconds) {
  for (const entity of queryEntities(runtime.world, [
    COMPONENTS.transform,
    COMPONENTS.vehicleController,
    COMPONENTS.renderRig,
    COMPONENTS.stageBounds,
    COMPONENTS.engine,
    COMPONENTS.physics
  ])) {
    const transform = getComponent(runtime.world, entity, COMPONENTS.transform);
    const controller = getComponent(runtime.world, entity, COMPONENTS.vehicleController);
    const renderRig = getComponent(runtime.world, entity, COMPONENTS.renderRig);
    const stage = getComponent(runtime.world, entity, COMPONENTS.stageBounds);
    const engine = getComponent(runtime.world, entity, COMPONENTS.engine);
    const physics = getComponent(runtime.world, entity, COMPONENTS.physics);
    const feedbackConfig = getVehicleFeedbackConfig(runtime, physics.vehicleKind);

    if (!stage.skidMarks || !controller.driveMode || Math.abs(controller.speed) < (feedbackConfig.skidMinSpeed ?? 0)) {
      continue;
    }

    SKID_FORWARD.set(
      Math.sin(transform.yaw),
      0,
      Math.cos(transform.yaw)
    );
    if (transform.useBodyQuaternion) {
      SKID_FORWARD.set(0, 0, 1).applyQuaternion(transform.bodyQuaternion).setY(0);
    }
    if (SKID_FORWARD.lengthSq() < 1e-6) {
      continue;
    }
    SKID_FORWARD.normalize().multiplyScalar(Math.sign(controller.speed) || 1);

    const hardBrake = engine.snapshot.engineBrakeForceN > (feedbackConfig.skidBrakeForceN ?? Infinity);
    const lateralSlip = Math.abs(controller.lateralAccel) > (feedbackConfig.skidLateralAccel ?? Infinity);
    const powerSlide =
      engine.snapshot.engineThrottle > (feedbackConfig.skidThrottle ?? Infinity) &&
      Math.abs(controller.steerAngle) > runtime.config.maxSteerAngle * 0.16;

    if (!hardBrake && !lateralSlip && !powerSlide) {
      for (const wheel of renderRig.wheelMount.children) {
        if (wheel?.userData?.lastSkidPosition) {
          wheel.userData.lastSkidPosition = null;
        }
      }
      continue;
    }

    for (const wheel of renderRig.wheelMount.children) {
      if (!wheel?.isObject3D) {
        continue;
      }
      if (wheel.userData?.skipSkid) {
        wheel.userData.lastSkidPosition = null;
        continue;
      }

      const anchorName = String(wheel.userData.anchorName || '');
      const isRear = anchorName.includes('rear') || anchorName.includes('back');
      const shouldMark = hardBrake || lateralSlip || (powerSlide && isRear);
      if (!shouldMark) {
        wheel.userData.lastSkidPosition = null;
        continue;
      }

      wheel.getWorldPosition(SKID_WORLD);
      const hit = stage.sampleGround?.(SKID_WORLD.x, SKID_WORLD.z, SKID_WORLD.y + 0.6);
      if (!hit?.normal) {
        wheel.userData.lastSkidPosition = null;
        continue;
      }

      SKID_MARK_POSITION.set(SKID_WORLD.x, hit.height, SKID_WORLD.z);
      if (wheel.userData.lastSkidPosition) {
        SKID_LAST.copy(wheel.userData.lastSkidPosition);
        if (SKID_LAST.distanceTo(SKID_MARK_POSITION) < (feedbackConfig.skidMinDistance ?? 0.3)) {
          continue;
        }
      }

      emitSkidMark(stage.skidMarks, {
        position: SKID_MARK_POSITION,
        normal: hit.normal,
        forward: SKID_FORWARD,
        width: Math.max(
          (wheel.userData.wheelRadius || controller.wheelRadius || 0.3) *
            (feedbackConfig.skidTrackWidthScale ?? 0.6),
          0.18
        ),
        length: Math.max(feedbackConfig.skidTrackLength ?? 0.55, Math.abs(controller.speed) * 0.02)
      });
      wheel.userData.lastSkidPosition = SKID_MARK_POSITION.clone();
    }
  }
}

function updateChaseCameraSystem(runtime, deltaSeconds) {
  for (const entity of queryEntities(runtime.world, [
    COMPONENTS.transform,
    COMPONENTS.vehicleController,
    COMPONENTS.cameraRig,
    COMPONENTS.renderRig
  ])) {
    const transform = getComponent(runtime.world, entity, COMPONENTS.transform);
    const controller = getComponent(runtime.world, entity, COMPONENTS.vehicleController);
    const cameraRig = getComponent(runtime.world, entity, COMPONENTS.cameraRig);
    const renderRig = getComponent(runtime.world, entity, COMPONENTS.renderRig);

    if (!controller.driveMode) {
      cameraRig.controls.update();
      continue;
    }

    const vehiclePosition = getVehicleRootPosition(transform, renderRig, ROOT_POSITION);

    if (cameraRig.override || cameraRig.detached) {
      const followTarget = FOLLOW_TARGET.copy(vehiclePosition);
      followTarget.y += 1.15;
      const offset = CAMERA_OFFSET.subVectors(cameraRig.camera.position, cameraRig.controls.target);
      cameraRig.controls.target.copy(followTarget);
      cameraRig.camera.position.copy(followTarget).add(offset);
      cameraRig.controls.update();
      continue;
    }

    const forward = CHASE_FORWARD.set(Math.sin(transform.yaw), 0, Math.cos(transform.yaw));
    const side = CHASE_SIDE.set(-forward.z, 0, forward.x);
    const speedFactor = Math.min(Math.abs(controller.speed) / runtime.config.maxForwardSpeed, 1);
    const cameraSideBias = cameraRig.cinematicEnabled
      ? runtime.config.cinematicChaseCameraSideBias *
          Math.sin(cameraRig.cinematicTime * runtime.config.cinematicChaseCameraOrbitRate * Math.PI * 2)
      : runtime.config.chaseCameraSideBias +
          (controller.steerAngle / runtime.config.maxSteerAngle) * runtime.config.chaseCameraTurnSideBias;
    const lookAhead = cameraRig.cinematicEnabled
      ? runtime.config.cinematicChaseCameraLookAhead
      : runtime.config.chaseCameraLookAhead;
    const cameraDistance = cameraRig.cinematicEnabled
      ? runtime.config.cinematicChaseCameraDistance
      : runtime.config.chaseCameraDistance;
    const cameraHeight = cameraRig.cinematicEnabled
      ? runtime.config.cinematicChaseCameraHeight
      : runtime.config.chaseCameraHeight;
    const positionLerp = cameraRig.cinematicEnabled
      ? runtime.config.cinematicChaseCameraPositionLerp
      : runtime.config.chaseCameraPositionLerp;
    const targetLerp = cameraRig.cinematicEnabled
      ? runtime.config.cinematicChaseCameraTargetLerp
      : runtime.config.chaseCameraTargetLerp;
    const desiredTarget = DESIRED_TARGET.copy(vehiclePosition)
      .addScaledVector(forward, lookAhead * (0.45 + speedFactor * 0.55));
    desiredTarget.y += 1.15;
    const desiredPosition = DESIRED_POSITION.copy(vehiclePosition)
      .addScaledVector(forward, -cameraDistance - speedFactor * (cameraRig.cinematicEnabled ? 2.8 : 1.2))
      .addScaledVector(side, cameraSideBias);
    desiredPosition.y += cameraHeight;
    const positionAlpha = 1 - Math.exp(-positionLerp * Math.max(deltaSeconds, 1 / 60));
    const targetAlpha = 1 - Math.exp(-targetLerp * Math.max(deltaSeconds, 1 / 60));

    cameraRig.camera.position.lerp(desiredPosition, positionAlpha);
    cameraRig.controls.target.lerp(desiredTarget, targetAlpha);
    cameraRig.controls.update();
  }
}

function snapCameraToVehicle(config, transform, renderRig, controller, cameraRig) {
  const forward = CHASE_FORWARD.set(Math.sin(transform.yaw), 0, Math.cos(transform.yaw));
  const side = CHASE_SIDE.set(-forward.z, 0, forward.x);
  const vehiclePosition = getVehicleRootPosition(transform, renderRig, ROOT_POSITION);
  const followTarget = FOLLOW_TARGET.copy(vehiclePosition).addScaledVector(
    forward,
    (cameraRig.cinematicEnabled ? config.cinematicChaseCameraLookAhead : config.chaseCameraLookAhead) * 0.45
  );
  followTarget.y += 1.15;
  const sideBias = cameraRig.cinematicEnabled ? config.cinematicChaseCameraSideBias : config.chaseCameraSideBias;
  const distance = cameraRig.cinematicEnabled ? config.cinematicChaseCameraDistance : config.chaseCameraDistance;
  const chasePosition = DESIRED_POSITION.copy(vehiclePosition)
    .addScaledVector(forward, -distance)
    .addScaledVector(side, sideBias);
  chasePosition.y += cameraRig.cinematicEnabled ? config.cinematicChaseCameraHeight : config.chaseCameraHeight;

  cameraRig.camera.far = config.driveCameraFar;
  cameraRig.camera.updateProjectionMatrix();
  cameraRig.controls.minDistance = config.driveCameraMinDistance;
  cameraRig.controls.maxDistance = config.driveCameraMaxDistance;
  cameraRig.controls.maxPolarAngle = Math.PI * 0.48;
  cameraRig.controls.target.copy(followTarget);
  cameraRig.camera.position.copy(chasePosition);
  cameraRig.controls.update();
}

function getVehicleRootPosition(transform, renderRig, target = new THREE.Vector3()) {
  const chassisHeightMode = renderRig?.carMount?.userData?.chassisHeightMode || 'body';
  const rootVisualOffsetY = Number(renderRig?.carMount?.userData?.rootVisualOffsetY || 0);
  const rootChassisHeight = chassisHeightMode === 'root' ? transform.chassisHeight + rootVisualOffsetY : rootVisualOffsetY;
  return target.copy(transform.position).setY(transform.position.y + rootChassisHeight);
}

function getVehicleComponent(runtime, componentType) {
  return getComponent(runtime.world, runtime.vehicleEntity, componentType);
}

function clearWheelFeedbackState(renderRig) {
  for (const wheel of renderRig?.wheelMount?.children || []) {
    wheel.userData.lastSkidPosition = null;
  }
}

function dampTowards(current, target, rate, deltaSeconds) {
  const step = rate * deltaSeconds;
  if (current < target) {
    return Math.min(current + step, target);
  }

  return Math.max(current - step, target);
}

function springTowards(current, target, velocity, spring, damping, deltaSeconds) {
  const nextVelocity = (velocity + (target - current) * spring * deltaSeconds) * Math.exp(-damping * deltaSeconds);
  return {
    value: current + nextVelocity * deltaSeconds,
    velocity: nextVelocity
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
