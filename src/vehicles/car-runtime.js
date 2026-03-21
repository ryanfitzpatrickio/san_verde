import * as THREE from 'three';

import { updateKinematicCarState } from './kinematic-car-controller.js';
import {
  applyMountedCarRuntimeTransform,
  applyMountedCarRuntimeWheelAnimation,
  createMountedCarController,
  ensureMountedCarRuntimeBase
} from './mounted-car-controller.js';

const DEFAULT_UP_AXIS = new THREE.Vector3(0, 1, 0);
const RIGHT_AXIS = new THREE.Vector3(1, 0, 0);
const FORWARD_AXIS = new THREE.Vector3(0, 0, 1);
const BASE_RIGHT_AXIS = new THREE.Vector3();
const BASE_FORWARD_AXIS = new THREE.Vector3();
const PITCH_QUATERNION = new THREE.Quaternion();
const ROLL_QUATERNION = new THREE.Quaternion();
const TILT_QUATERNION = new THREE.Quaternion();

export function createCarRuntimeState({
  position = null,
  yaw = 0,
  speed = 0,
  wheelRadius = 0.42,
  bodyPitch = 0,
  bodyRoll = 0,
  steerAngle = 0,
  wheelSpin = 0,
  suspensionOffset = 0,
  driveMode = true,
  automaticDirection = 1,
  longitudinalAccel = 0,
  lateralAccel = 0,
  yawRate = 0,
  bikeLeanAngle = 0
} = {}) {
  return {
    initialized: false,
    position: position?.clone?.() || new THREE.Vector3(),
    yaw,
    speed,
    wheelRadius,
    bodyPitch,
    bodyRoll,
    steerAngle,
    wheelSpin,
    suspensionOffset,
    driveMode,
    automaticDirection,
    longitudinalAccel,
    lateralAccel,
    yawRate,
    bikeLeanAngle
  };
}

export function resetCarRuntimeState(state, overrides = {}) {
  const next = createCarRuntimeState({
    position: state?.position,
    yaw: state?.yaw,
    speed: state?.speed,
    wheelRadius: state?.wheelRadius,
    bodyPitch: state?.bodyPitch,
    bodyRoll: state?.bodyRoll,
    steerAngle: state?.steerAngle,
    wheelSpin: state?.wheelSpin,
    suspensionOffset: state?.suspensionOffset,
    driveMode: state?.driveMode,
    automaticDirection: state?.automaticDirection,
    longitudinalAccel: state?.longitudinalAccel,
    lateralAccel: state?.lateralAccel,
    yawRate: state?.yawRate,
    bikeLeanAngle: state?.bikeLeanAngle,
    ...overrides
  });
  Object.assign(state, next);
  return state;
}

export function createMountedCarRuntime({
  root = null,
  bodyMount = null,
  wheelMount = null,
  steeringWheelRig = null,
  steeringWheelTurnRatio = -6.2,
  upAxis = DEFAULT_UP_AXIS,
  initialState = {}
} = {}) {
  const controller = createMountedCarController({
    root,
    bodyMount,
    wheelMount,
    steeringWheelRig,
    steeringWheelTurnRatio,
    upAxis
  });
  const state = createCarRuntimeState(initialState);

  function applyState(overrides = {}) {
    controller.applyPose({
      position: overrides.position || state.position,
      yaw: Number.isFinite(overrides.yaw) ? overrides.yaw : state.yaw,
      bodyPitch: Number.isFinite(overrides.bodyPitch) ? overrides.bodyPitch : state.bodyPitch,
      bodyRoll: Number.isFinite(overrides.bodyRoll) ? overrides.bodyRoll : state.bodyRoll,
      steerAngle: Number.isFinite(overrides.steerAngle) ? overrides.steerAngle : state.steerAngle,
      wheelSpin: Number.isFinite(overrides.wheelSpin) ? overrides.wheelSpin : state.wheelSpin,
      suspensionOffset: Number.isFinite(overrides.suspensionOffset)
        ? overrides.suspensionOffset
        : state.suspensionOffset
    });
    return state;
  }

  return {
    state,
    controller,
    applyState,
    setState(overrides = {}) {
      if (overrides.position) {
        state.position.copy(overrides.position);
      }
      for (const key of [
        'yaw',
        'speed',
        'wheelRadius',
        'bodyPitch',
        'bodyRoll',
        'steerAngle',
        'wheelSpin',
        'suspensionOffset',
        'driveMode',
        'automaticDirection',
        'longitudinalAccel',
        'lateralAccel',
        'yawRate',
        'bikeLeanAngle'
      ]) {
        if (key in overrides && overrides[key] !== undefined) {
          state[key] = overrides[key];
        }
      }
      return applyState();
    },
    updateKinematic({
      targetPosition,
      targetYaw = 0,
      targetSpeed = 0,
      deltaSeconds = 0,
      style,
      onDrivetrainStep = null
    } = {}) {
      updateKinematicCarState(state, {
        targetPosition,
        targetYaw,
        targetSpeed,
        deltaSeconds,
        style,
        onDrivetrainStep
      });
      return applyState();
    }
  };
}

function inferBaseAxisSign(baseQuaternion, axis, scratch) {
  const projection = scratch.copy(axis).applyQuaternion(baseQuaternion).dot(axis);
  return projection < 0 ? -1 : 1;
}

export function applyCarRenderRigRuntimeState({
  renderRig,
  runtimeState,
  transformPosition,
  transformYaw,
  transformQuaternion = null,
  useBodyQuaternion = false,
  rootChassisHeight = 0,
  bodyChassisHeight = 0,
  suspensionPitch = 0,
  suspensionRoll = 0,
  upAxis = DEFAULT_UP_AXIS
} = {}) {
  if (!renderRig?.vehicleRoot || !renderRig?.carMount || !renderRig?.wheelMount || !runtimeState) {
    return;
  }

  renderRig.vehicleRoot.position.copy(transformPosition);
  renderRig.vehicleRoot.position.y += rootChassisHeight;
  if (useBodyQuaternion && transformQuaternion) {
    renderRig.vehicleRoot.quaternion.copy(transformQuaternion);
  } else {
    renderRig.vehicleRoot.quaternion.setFromAxisAngle(upAxis, transformYaw);
  }

  const base = ensureMountedCarRuntimeBase(renderRig);
  const carMountBaseQuaternion = base?.carMountBaseQuaternion || renderRig.carMount.quaternion;
  const pitchAxisSign = inferBaseAxisSign(carMountBaseQuaternion, RIGHT_AXIS, BASE_RIGHT_AXIS);
  const rollAxisSign = inferBaseAxisSign(carMountBaseQuaternion, FORWARD_AXIS, BASE_FORWARD_AXIS);
  const isBike = renderRig.carMount.userData.vehicleKind === 'bike';
  const totalRoll = suspensionRoll + (isBike ? runtimeState.bikeLeanAngle || 0 : 0);

  PITCH_QUATERNION.setFromAxisAngle(RIGHT_AXIS, suspensionPitch * pitchAxisSign);
  ROLL_QUATERNION.setFromAxisAngle(FORWARD_AXIS, totalRoll * rollAxisSign);
  TILT_QUATERNION.copy(PITCH_QUATERNION).multiply(ROLL_QUATERNION);

  applyMountedCarRuntimeTransform({
    renderRig,
    vehiclePosition: renderRig.vehicleRoot.position,
    vehicleQuaternion: renderRig.vehicleRoot.quaternion,
    bodyChassisHeight,
    bodyTiltQuaternion: TILT_QUATERNION,
    wheelTiltQuaternion: isBike ? ROLL_QUATERNION : null
  });
}

export function applyCarRenderRigWheelState({
  renderRig,
  runtimeState,
  upAxis = DEFAULT_UP_AXIS
} = {}) {
  if (!renderRig?.wheelMount || !runtimeState) {
    return;
  }

  const wheelSpinDirection = Number(renderRig.carMount.userData.wheelSpinDirection ?? 1);
  const steerDirection = Number(
    renderRig.carMount.userData.steerDirection ??
      (renderRig.carMount.userData.vehicleKind === 'bike' ? 1 : -1)
  );

  applyMountedCarRuntimeWheelAnimation({
    renderRig,
    steerAngle: runtimeState.steerAngle,
    wheelSpin: runtimeState.wheelSpin,
    wheelSpinDirection,
    steerDirection,
    upAxis
  });
}
