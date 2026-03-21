import * as THREE from 'three';

import { applyCarWheelPose } from './car-rig-helpers.js';

const DEFAULT_UP_AXIS = new THREE.Vector3(0, 1, 0);
const TEMP_TURN = new THREE.Quaternion();
const TEMP_STEER = new THREE.Quaternion();

export function ensureMountedCarRuntimeBase(renderRig) {
  if (!renderRig?.carMount || !renderRig?.wheelMount) {
    return null;
  }

  const carMountBasePosition =
    renderRig.carMount.userData.baseLocalPosition || renderRig.carMount.position.clone();
  const wheelMountBasePosition =
    renderRig.wheelMount.userData.baseLocalPosition || renderRig.wheelMount.position.clone();
  const carMountBaseQuaternion =
    renderRig.carMount.userData.baseLocalQuaternion || renderRig.carMount.quaternion.clone();
  const wheelMountBaseQuaternion =
    renderRig.wheelMount.userData.baseLocalQuaternion || renderRig.wheelMount.quaternion.clone();

  renderRig.carMount.userData.baseLocalPosition = carMountBasePosition;
  renderRig.wheelMount.userData.baseLocalPosition = wheelMountBasePosition;
  renderRig.carMount.userData.baseLocalQuaternion = carMountBaseQuaternion;
  renderRig.wheelMount.userData.baseLocalQuaternion = wheelMountBaseQuaternion;

  return {
    carMountBasePosition,
    wheelMountBasePosition,
    carMountBaseQuaternion,
    wheelMountBaseQuaternion
  };
}

export function applyMountedCarSteeringWheelPose(rig, steerAngle, steeringWheelTurnRatio = -6.2, upAxis = DEFAULT_UP_AXIS) {
  if (!rig?.object) {
    return;
  }

  TEMP_TURN.setFromAxisAngle(
    rig.turnAxis || upAxis,
    steerAngle * steeringWheelTurnRatio
  );
  rig.object.quaternion.copy(rig.baseQuaternion).multiply(TEMP_TURN);
}

export function applyMountedCarPose({
  root = null,
  bodyMount = null,
  wheelMount = null,
  steeringWheelRig = null,
  steeringWheelTurnRatio = -6.2,
  upAxis = DEFAULT_UP_AXIS,
  position = null,
  yaw = null,
  bodyPitch = 0,
  bodyRoll = 0,
  steerAngle = 0,
  wheelSpin = 0,
  suspensionOffset = 0
} = {}) {
  if (root && position) {
    root.position.copy(position);
  }

  if (root && Number.isFinite(yaw)) {
    root.quaternion.setFromAxisAngle(upAxis, yaw);
  }

  if (bodyMount) {
    bodyMount.rotation.set(bodyPitch, 0, bodyRoll);
  }

  applyCarWheelPose(wheelMount, {
    steerAngle,
    wheelSpin,
    suspensionOffset
  });
  applyMountedCarSteeringWheelPose(steeringWheelRig, steerAngle, steeringWheelTurnRatio, upAxis);
}

export function createMountedCarController({
  root = null,
  bodyMount = null,
  wheelMount = null,
  steeringWheelRig = null,
  steeringWheelTurnRatio = -6.2,
  upAxis = DEFAULT_UP_AXIS
} = {}) {
  return {
    applyPose({
      position = null,
      yaw = null,
      bodyPitch = 0,
      bodyRoll = 0,
      steerAngle = 0,
      wheelSpin = 0,
      suspensionOffset = 0
    } = {}) {
      applyMountedCarPose({
        root,
        bodyMount,
        wheelMount,
        steeringWheelRig,
        steeringWheelTurnRatio,
        upAxis,
        position,
        yaw,
        bodyPitch,
        bodyRoll,
        steerAngle,
        wheelSpin,
        suspensionOffset
      });
    }
  };
}

export function applyMountedCarRuntimeTransform({
  renderRig,
  vehiclePosition,
  vehicleQuaternion,
  bodyChassisHeight = 0,
  bodyTiltQuaternion = null,
  wheelTiltQuaternion = null
} = {}) {
  const base = ensureMountedCarRuntimeBase(renderRig);
  if (!base || !renderRig?.vehicleRoot) {
    return null;
  }

  renderRig.vehicleRoot.position.copy(vehiclePosition);
  renderRig.vehicleRoot.quaternion.copy(vehicleQuaternion);
  renderRig.wheelMount.position.copy(base.wheelMountBasePosition);
  renderRig.wheelMount.quaternion.copy(base.wheelMountBaseQuaternion);
  if (wheelTiltQuaternion) {
    renderRig.wheelMount.quaternion.multiply(wheelTiltQuaternion);
  }

  renderRig.carMount.position.set(
    base.carMountBasePosition.x,
    base.carMountBasePosition.y + bodyChassisHeight,
    base.carMountBasePosition.z
  );
  renderRig.carMount.quaternion.copy(base.carMountBaseQuaternion);
  if (bodyTiltQuaternion) {
    renderRig.carMount.quaternion.multiply(bodyTiltQuaternion);
  }

  return base;
}

export function applyMountedCarRuntimeWheelAnimation({
  renderRig,
  steerAngle = 0,
  wheelSpin = 0,
  wheelSpinDirection = 1,
  steerDirection = -1,
  upAxis = DEFAULT_UP_AXIS
} = {}) {
  if (!renderRig?.wheelMount) {
    return;
  }

  for (const wheel of renderRig.wheelMount.children) {
    if (wheel?.userData?.physicsOnly) {
      continue;
    }

    const spinPivot = wheel.children[0];
    if (!spinPivot) {
      continue;
    }

    if (wheel.userData.baseQuaternion) {
      wheel.quaternion.copy(wheel.userData.baseQuaternion);
      if (wheel.userData.canSteer) {
        TEMP_STEER.setFromAxisAngle(
          wheel.userData.steerAxis || upAxis,
          steerAngle *
            steerDirection *
            Number(wheel.userData.steerSign || 1) *
            Number(wheel.userData.steerScale || 1)
        );
        wheel.quaternion.multiply(TEMP_STEER);
      }
    }

    spinPivot.rotation.x = 0;
    spinPivot.rotation.y = 0;
    spinPivot.rotation.z = 0;
    spinPivot.rotation[spinPivot.userData.spinAxis || 'x'] =
      wheelSpin *
      wheelSpinDirection *
      Number(spinPivot.userData.spinSign || 1);
  }

  const bikeSteeringRig = renderRig.carMount?.userData?.bikeSteeringRig;
  if (bikeSteeringRig?.targets?.length) {
    TEMP_STEER.setFromAxisAngle(
      bikeSteeringRig.steerAxis || upAxis,
      steerAngle *
        steerDirection *
        Number(bikeSteeringRig.steerSign || 1) *
        Number(bikeSteeringRig.steerScale || 1)
    );
    for (const target of bikeSteeringRig.targets) {
      if (!target?.object || !target?.baseQuaternion) {
        continue;
      }
      target.object.quaternion.copy(target.baseQuaternion);
      target.object.quaternion.multiply(TEMP_STEER);
    }
  }
}
