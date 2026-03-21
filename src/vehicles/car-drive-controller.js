import * as THREE from 'three';

export function resolveDriveCommandInputs({
  controller,
  drivingStyle,
  gearRatio,
  forwardInput = 0,
  reverseInput = 0
}) {
  forwardInput = THREE.MathUtils.clamp(Number(forwardInput) || 0, 0, 1);
  reverseInput = THREE.MathUtils.clamp(Number(reverseInput) || 0, 0, 1);
  const hasManualIntent = forwardInput > 0.001 || reverseInput > 0.001;
  let throttleInput = controller.driveMode ? (gearRatio < 0 ? reverseInput : forwardInput) : 0;
  let brakeInput = controller.driveMode ? (gearRatio < 0 ? forwardInput : reverseInput) : 0;
  let desiredDirection = controller.automaticDirection || 1;

  if (drivingStyle.transmissionMode === 'automatic') {
    const shiftThreshold = drivingStyle.autoDirectionShiftSpeedMps ?? 0.9;
    const directionCommitThreshold = Math.max(shiftThreshold * 2.2, 1.8);
    const throttleBlendThreshold = Math.max(shiftThreshold * 1.35, 1.2);
    const movingForward = controller.speed > shiftThreshold;
    const movingReverse = controller.speed < -shiftThreshold;
    const directionCanCommitForward = controller.speed > -directionCommitThreshold;
    const directionCanCommitReverse = controller.speed < directionCommitThreshold;
    const nearlyStoppedForward = controller.speed > -throttleBlendThreshold;
    const nearlyStoppedReverse = controller.speed < throttleBlendThreshold;

    if (controller.autopilotEnabled) {
      controller.automaticDirection = 1;
      desiredDirection = 1;
      throttleInput = forwardInput;
      brakeInput = reverseInput;
    } else if (forwardInput > 0 && reverseInput <= 0) {
      if (!movingReverse || directionCanCommitForward) {
        controller.automaticDirection = 1;
      }
      desiredDirection = 1;
      throttleInput = movingReverse && !nearlyStoppedForward ? 0 : forwardInput;
      brakeInput = movingReverse ? forwardInput : 0;
    } else if (reverseInput > 0 && forwardInput <= 0) {
      if (!movingForward || directionCanCommitReverse) {
        controller.automaticDirection = -1;
      }
      desiredDirection = controller.automaticDirection;
      throttleInput = movingForward && !nearlyStoppedReverse ? 0 : reverseInput;
      brakeInput = movingForward ? reverseInput : 0;
    } else {
      desiredDirection = controller.automaticDirection;
      throttleInput = 0;
      brakeInput = 0;
    }
  }

  if (!controller.autopilotEnabled && !hasManualIntent) {
    throttleInput = 0;
    brakeInput = 0;
  }

  const throttleCurveExponent = drivingStyle.throttleCurveExponent ?? 1;
  if (throttleInput > 0 && throttleCurveExponent !== 1) {
    throttleInput = Math.pow(THREE.MathUtils.clamp(throttleInput, 0, 1), throttleCurveExponent);
  }

  return {
    throttleInput,
    brakeInput,
    desiredDirection
  };
}

export function updateVehicleEngineSnapshot({
  engineAudio,
  controller,
  drivingStyle,
  deltaSeconds,
  throttleInput,
  brakeInput,
  desiredDirection
}) {
  return engineAudio.update({
    deltaSeconds,
    throttleInput,
    brakeInput,
    driveSpeed: controller.speed,
    wheelRadius: controller.wheelRadius,
    driveEnabled: controller.driveMode,
    transmissionMode: drivingStyle.transmissionMode,
    desiredDirection,
    automaticUpshiftRpmMultiplier: drivingStyle.autoUpshiftRpmMultiplier ?? 1,
    automaticDownshiftRpmMultiplier: drivingStyle.autoDownshiftRpmMultiplier ?? 1
  });
}
