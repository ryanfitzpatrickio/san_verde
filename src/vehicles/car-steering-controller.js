import * as THREE from 'three';

export function dampTowards(current, target, rate, deltaSeconds) {
  if (deltaSeconds <= 0 || rate <= 0) {
    return target;
  }
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-rate * deltaSeconds));
}

export function updateSteerAngleTowardsTarget({
  currentSteerAngle = 0,
  targetSteerAngle = 0,
  steerResponse = 0,
  steerReturn = 0,
  deltaSeconds = 0
} = {}) {
  return dampTowards(
    currentSteerAngle,
    targetSteerAngle,
    Math.abs(targetSteerAngle) > Math.abs(currentSteerAngle) ? steerResponse : steerReturn,
    deltaSeconds
  );
}

export function updateSteerAngleFromInput({
  currentSteerAngle = 0,
  steerInput = 0,
  maxSteerAngle = 0,
  steerResponse = 0,
  steerReturn = 0,
  deltaSeconds = 0
} = {}) {
  return updateSteerAngleTowardsTarget({
    currentSteerAngle,
    targetSteerAngle: steerInput * maxSteerAngle,
    steerResponse,
    steerReturn,
    deltaSeconds
  });
}
