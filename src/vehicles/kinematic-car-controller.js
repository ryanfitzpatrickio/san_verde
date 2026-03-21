import * as THREE from 'three';
import { dampTowards, updateSteerAngleTowardsTarget } from './car-steering-controller.js';

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const TEMP_OFFSET = new THREE.Vector3();

export function createKinematicCarState({ position = null, yaw = 0, speed = 0, wheelRadius = 0.42 } = {}) {
  return {
    initialized: false,
    position: position?.clone?.() || new THREE.Vector3(),
    yaw,
    speed,
    steerAngle: 0,
    wheelSpin: 0,
    longitudinalAccel: 0,
    bodyPitch: 0,
    bodyRoll: 0,
    wheelRadius
  };
}

export function updateKinematicCarState(
  state,
  {
    targetPosition,
    targetYaw = 0,
    targetSpeed = 0,
    deltaSeconds = 0,
    style,
    onDrivetrainStep = null
  }
) {
  const dt = Math.min(Math.max(deltaSeconds || 0, 0), 0.1);
  const desiredSpeed = Math.max(0, Number(targetSpeed || 0));

  if (!state.initialized || dt <= 0) {
    state.initialized = true;
    state.position.copy(targetPosition);
    state.yaw = targetYaw;
    state.speed = desiredSpeed;
    return state;
  }

  const previousSpeed = state.speed;
  const speedError = desiredSpeed - state.speed;
  const throttleInput = speedError > 0 ? THREE.MathUtils.clamp(speedError / 4.2, 0, 1) : 0;
  const brakeInput = speedError < 0 ? THREE.MathUtils.clamp(-speedError / 3.2, 0, 1) : 0;

  onDrivetrainStep?.({
    deltaSeconds: dt,
    throttleInput,
    brakeInput,
    desiredDirection: 1,
    driveSpeed: state.speed,
    wheelRadius: state.wheelRadius
  });

  const responseRate = speedError >= 0
    ? THREE.MathUtils.lerp(1.8, style.accelerationRate, throttleInput)
    : THREE.MathUtils.lerp(3.2, style.brakeRate, brakeInput);
  state.speed = moveTowards(state.speed, desiredSpeed, responseRate * dt);
  state.longitudinalAccel = dampTowards(
    state.longitudinalAccel,
    (state.speed - previousSpeed) / Math.max(dt, 0.001),
    7.5,
    dt
  );

  const yawError = shortestAngleDelta(state.yaw, targetYaw);
  const distanceToTarget = TEMP_OFFSET.copy(targetPosition).sub(state.position).length();
  const lateralBias = distanceToTarget > 1e-3
    ? TEMP_OFFSET.applyAxisAngle(UP_AXIS, -state.yaw).x / Math.max(distanceToTarget, 1)
    : 0;
  const steerInput = THREE.MathUtils.clamp(
    yawError * 1.45 + lateralBias * 0.92,
    -1,
    1
  );
  const targetSteerAngle = steerInput * style.maxSteerAngle;
  const steerRate = Math.abs(targetSteerAngle) > Math.abs(state.steerAngle)
    ? style.steerResponse
    : style.steerReturn;
  state.steerAngle = updateSteerAngleTowardsTarget({
    currentSteerAngle: state.steerAngle,
    targetSteerAngle,
    steerResponse: steerRate,
    steerReturn: steerRate,
    deltaSeconds: dt
  });

  if (distanceToTarget > 18) {
    state.position.copy(targetPosition);
  } else {
    const followAlpha = 1 - Math.exp(-style.followRate * dt);
    state.position.lerp(targetPosition, followAlpha);
  }

  state.yaw = dampAngle(state.yaw, targetYaw, style.yawFollowRate, dt);
  state.wheelSpin += (state.speed * dt) / Math.max(state.wheelRadius, 0.12);

  const speedFactor = THREE.MathUtils.clamp(state.speed / 10, 0, 1);
  const targetPitch = THREE.MathUtils.clamp(
    -state.longitudinalAccel * 0.012,
    -style.maxPitch,
    style.maxPitch
  );
  const targetRoll = THREE.MathUtils.clamp(
    -state.steerAngle * speedFactor * 0.42,
    -style.maxRoll,
    style.maxRoll
  );
  state.bodyPitch = dampTowards(state.bodyPitch, targetPitch, style.pitchRate, dt);
  state.bodyRoll = dampTowards(state.bodyRoll, targetRoll, style.rollRate, dt);

  return state;
}

export function moveTowards(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) {
    return target;
  }
  return current + Math.sign(target - current) * maxDelta;
}

export function shortestAngleDelta(current, target) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function dampAngle(current, target, rate, deltaSeconds) {
  return current + shortestAngleDelta(current, target) * (1 - Math.exp(-Math.max(rate, 0) * Math.max(deltaSeconds, 0)));
}
