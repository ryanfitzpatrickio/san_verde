import * as THREE from 'three';
import {
  loadHumanoidActor,
  resetHumanoidRootMotionSample,
  stabilizeHumanoidRootMotion,
  setHumanoidActorAction,
  setHumanoidActorVisible,
  updateHumanoidActor
} from './game/humanoid-actor.js';

const CHARACTER_DEBUG = false;
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const CAMERA_FORWARD = new THREE.Vector3();
const CAMERA_SIDE = new THREE.Vector3();
const MOVE_DIRECTION = new THREE.Vector3();
const FOLLOW_FORWARD = new THREE.Vector3();
const FOLLOW_SIDE = new THREE.Vector3();
const FOLLOW_TARGET = new THREE.Vector3();
const DESIRED_TARGET = new THREE.Vector3();
const DESIRED_POSITION = new THREE.Vector3();
const CAMERA_OFFSET = new THREE.Vector3();
const CHARACTER_BOX = new THREE.Box3();
const CHARACTER_SIZE = new THREE.Vector3();
const ROOT_MOTION_WORLD = new THREE.Vector3();
const DESIRED_MOVE = new THREE.Vector3();
const COLLISION_DIRECTION = new THREE.Vector3();
const COLLISION_ORIGIN = new THREE.Vector3();
const COLLISION_OFFSET = new THREE.Vector3();
const COLLISION_RIGHT = new THREE.Vector3();
const COLLISION_FORWARD = new THREE.Vector3();
const SLIDE_MOVE = new THREE.Vector3();
const GROUND_PROBE_ORIGIN = new THREE.Vector3();
const GROUND_OFFSET = new THREE.Vector3();
const PROBE_HEIGHTS = [0.35, 0.95, 1.55];

function logCharacter(event, payload) {
  if (!CHARACTER_DEBUG) {
    return;
  }
  console.log('[character]', event, payload);
}

export async function loadCharacterController({ fbxLoader, modelUrl, animationUrls, config }) {
  const actor = await loadHumanoidActor({
    fbxLoader,
    modelUrl,
    animationUrls,
    config
  });
  const metrics = actor.metrics;
  console.log('[character] metrics', {
    modelUrl,
    height: metrics.height,
    hipHeight: metrics.hipHeight
  });

  const controller = {
    ...actor,
    position: new THREE.Vector3(),
    yaw: Math.PI,
    moveSpeed: 0,
    verticalVelocity: 0,
    onGround: false,
    jumpHeld: false,
    debugFrame: 0,
    metrics
  };

  logCharacter('load:actions', {
    actions: Array.from(controller.actions.keys()),
    rootMotionNode: controller.rootMotion?.node?.name || null,
    rootMotionNeutralY: controller.rootMotion?.neutralLocalPosition?.y ?? null
  });

  syncCharacterTransform(controller);
  stabilizeHumanoidRootMotion(controller, { stabilizeVertical: true });
  logControllerState(controller, 'load:post-init');
  return controller;
}

export function updateCharacterController(controller, options) {
  const {
    deltaSeconds,
    config,
    camera,
    input,
    driveBounds,
    sampleGround,
    sampleCollision,
    resolveLocomotionState
  } = options;

  if (!controller) {
    return;
  }

  let moving = false;
  MOVE_DIRECTION.set(0, 0, 0);
  camera.getWorldDirection(CAMERA_FORWARD);
  CAMERA_FORWARD.y = 0;
  if (CAMERA_FORWARD.lengthSq() < 1e-6) {
    CAMERA_FORWARD.set(0, 0, 1);
  } else {
    CAMERA_FORWARD.normalize();
  }
  CAMERA_SIDE.set(-CAMERA_FORWARD.z, 0, CAMERA_FORWARD.x);

  const inputX = Number(input.right) - Number(input.left);
  const inputZ = Number(input.forward) - Number(input.backward);
  if (inputX !== 0 || inputZ !== 0) {
    MOVE_DIRECTION
      .addScaledVector(CAMERA_FORWARD, inputZ)
      .addScaledVector(CAMERA_SIDE, inputX);
    if (MOVE_DIRECTION.lengthSq() > 1e-6) {
      MOVE_DIRECTION.normalize();
      moving = true;
    }
  }

  const targetSpeed = moving ? (input.run ? config.runSpeed : config.walkSpeed) : 0;
  controller.moveSpeed = dampTowards(
    controller.moveSpeed,
    targetSpeed,
    moving ? config.acceleration : config.deceleration,
    deltaSeconds
  );

  const locomotionState = resolveLocomotionState
    ? resolveLocomotionState({
      controller,
      input,
      moving,
      inputX,
      inputZ,
      moveDirection: MOVE_DIRECTION,
      cameraForward: CAMERA_FORWARD,
      cameraSide: CAMERA_SIDE
    })
    : null;
  const targetYaw = Number.isFinite(locomotionState?.targetYaw)
    ? locomotionState.targetYaw
    : (moving && controller.moveSpeed > 0.01 ? Math.atan2(MOVE_DIRECTION.x, MOVE_DIRECTION.z) : null);

  if ((moving && controller.moveSpeed > 0.01) || locomotionState?.forceFacing) {
    controller.yaw = dampAngle(
      controller.yaw,
      Number.isFinite(targetYaw) ? targetYaw : controller.yaw,
      config.turnRate,
      deltaSeconds
    );
  }

  setCharacterAction(
    controller,
    locomotionState?.actionName || (
      moving && controller.moveSpeed > config.walkSpeed * 0.82
      ? input.run && controller.actions.has('run')
        ? 'run'
        : 'walk'
      : moving && controller.actions.has('walk')
        ? 'walk'
        : 'idle'
    )
  );

  const jumpPressed = Boolean(input.jump);
  if (jumpPressed && !controller.jumpHeld && controller.onGround) {
    controller.verticalVelocity = config.jumpSpeed;
    controller.onGround = false;
  }
  controller.jumpHeld = jumpPressed;

  if (Number.isFinite(driveBounds)) {
    controller.position.x = THREE.MathUtils.clamp(controller.position.x, -driveBounds, driveBounds);
    controller.position.z = THREE.MathUtils.clamp(controller.position.z, -driveBounds, driveBounds);
  }

  syncCharacterTransform(controller);
  updateHumanoidActor(controller, deltaSeconds);
  stabilizeHumanoidRootMotion(controller, { stabilizeVertical: true });
  if (moving && controller.moveSpeed > 0.01) {
    DESIRED_MOVE.copy(MOVE_DIRECTION).multiplyScalar(controller.moveSpeed * deltaSeconds);
    moveCharacterWithCollision(controller, DESIRED_MOVE, sampleCollision, config);
  }
  updateCharacterVerticalMotion(controller, deltaSeconds, sampleGround, config);
  if (Number.isFinite(driveBounds)) {
    controller.position.x = THREE.MathUtils.clamp(controller.position.x, -driveBounds, driveBounds);
    controller.position.z = THREE.MathUtils.clamp(controller.position.z, -driveBounds, driveBounds);
  }
  syncCharacterTransform(controller);
  controller.debugFrame += 1;
  if (controller.debugFrame <= 5 || controller.debugFrame % 60 === 0) {
    logControllerState(controller, 'update:on-foot', {
      moving,
      moveSpeed: controller.moveSpeed,
      inputX,
      inputZ
    });
  }
}

export function snapCharacterCamera(camera, controls, controller, config, stageId) {
  const position = getCharacterFocusPosition(controller, FOLLOW_TARGET);
  const forward = FOLLOW_FORWARD.set(Math.sin(controller.yaw), 0, Math.cos(controller.yaw));
  const side = FOLLOW_SIDE.set(-forward.z, 0, forward.x);
  const chasePosition = DESIRED_POSITION.copy(position)
    .addScaledVector(forward, -config.cameraDistance)
    .addScaledVector(side, config.cameraSideBias);
  chasePosition.y += config.cameraHeight;
  const target = DESIRED_TARGET.copy(position).addScaledVector(forward, config.cameraLookAhead);
  target.y += config.targetHeight;

  camera.far = stageId === 'city' ? 2500 : 12000;
  camera.updateProjectionMatrix();
  controls.minDistance = 2.6;
  controls.maxDistance = 18;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.target.copy(target);
  camera.position.copy(chasePosition);
  controls.update();
}

export function updateCharacterCamera(camera, controls, controller, config, deltaSeconds, overrideActive, stageId) {
  const position = getCharacterFocusPosition(controller, FOLLOW_TARGET);
  const forward = FOLLOW_FORWARD.set(Math.sin(controller.yaw), 0, Math.cos(controller.yaw));
  const side = FOLLOW_SIDE.set(-forward.z, 0, forward.x);

  camera.far = stageId === 'city' ? 2500 : 12000;
  camera.updateProjectionMatrix();
  controls.minDistance = 2.6;
  controls.maxDistance = 18;
  controls.maxPolarAngle = Math.PI * 0.48;

  if (overrideActive) {
    const followTarget = DESIRED_TARGET.copy(position);
    followTarget.y += config.targetHeight;
    const offset = CAMERA_OFFSET.subVectors(camera.position, controls.target);
    controls.target.copy(followTarget);
    camera.position.copy(followTarget).add(offset);
    controls.update();
    return;
  }

  const desiredTarget = DESIRED_TARGET.copy(position)
    .addScaledVector(forward, config.cameraLookAhead);
  desiredTarget.y += config.targetHeight;
  const desiredPosition = DESIRED_POSITION.copy(position)
    .addScaledVector(forward, -config.cameraDistance)
    .addScaledVector(side, config.cameraSideBias);
  desiredPosition.y += config.cameraHeight;

  const positionAlpha = 1 - Math.exp(-config.cameraPositionLerp * Math.max(deltaSeconds, 1 / 60));
  const targetAlpha = 1 - Math.exp(-config.cameraTargetLerp * Math.max(deltaSeconds, 1 / 60));
  camera.position.lerp(desiredPosition, positionAlpha);
  controls.target.lerp(desiredTarget, targetAlpha);
  controls.update();
}

export function placeCharacterNearVehicle(
  controller,
  vehiclePosition,
  vehicleYaw,
  config,
  sideSign = -1,
  offsets = null
) {
  const forward = FOLLOW_FORWARD.set(Math.sin(vehicleYaw), 0, Math.cos(vehicleYaw));
  const side = FOLLOW_SIDE.set(-forward.z, 0, forward.x);
  const sideOffset = offsets?.sideOffset ?? config.spawnSideOffset;
  const forwardOffset = offsets?.forwardOffset ?? config.spawnForwardOffset;
  controller.position
    .copy(vehiclePosition)
    .addScaledVector(side, sideOffset * sideSign)
    .addScaledVector(forward, forwardOffset);
  controller.yaw = Math.atan2(-side.x * sideSign, -side.z * sideSign);
  controller.moveSpeed = 0;
  controller.verticalVelocity = 0;
  controller.onGround = false;
  controller.jumpHeld = false;
  resetRootMotionSample(controller);
  syncCharacterTransform(controller);
  controller.mixer.update(0);
  stabilizeHumanoidRootMotion(controller, { stabilizeVertical: true });
  logControllerState(controller, 'place:near-vehicle', {
    sideOffset,
    forwardOffset,
    sideSign
  });
}

export function setCharacterVisible(controller, visible) {
  setHumanoidActorVisible(controller, visible);
}

export function getCharacterDistanceToVehicle(controller, vehiclePosition) {
  return controller.position.distanceTo(vehiclePosition);
}

export function setCharacterPlacement(controller, position, yaw) {
  if (!controller) {
    return;
  }

  controller.position.copy(position);
  if (Number.isFinite(yaw)) {
    controller.yaw = yaw;
  }
  controller.moveSpeed = 0;
  controller.verticalVelocity = 0;
  controller.onGround = false;
  controller.jumpHeld = false;
  resetRootMotionSample(controller);
  syncCharacterTransform(controller);
  controller.mixer.update(0);
  stabilizeHumanoidRootMotion(controller, { stabilizeVertical: true });
  logControllerState(controller, 'place:set-placement');
}

export function playCharacterAction(controller, actionName) {
  setCharacterAction(controller, actionName);
}

export function advanceCharacterAnimation(controller, deltaSeconds, options = {}) {
  if (!controller) {
    return false;
  }

  updateHumanoidActor(controller, deltaSeconds);
  if (options.consumeRootMotion) {
    const moved = applyRootMotion(controller, {
      moving: Boolean(options.moving),
      travelDistance: Number(options.travelDistance) || 0,
      useRawDelta: Boolean(options.useRawDelta),
      stabilizeVertical: Boolean(options.stabilizeVertical)
    });
    syncCharacterTransform(controller);
    return moved;
  }

  stabilizeHumanoidRootMotion(controller, {
    stabilizeVertical: Boolean(options.stabilizeVertical)
  });
  return false;
}

function setCharacterAction(controller, actionName) {
  const previous = controller?.actions?.get(controller?.currentAction);
  setHumanoidActorAction(controller, actionName);
  if (controller?.currentAction === actionName) {
    logCharacter('action:change', {
      actionName,
      previous: previous ? previous.getClip().name : null
    });
  }
}

function syncCharacterTransform(controller) {
  controller.root.position.copy(controller.position);
  controller.root.quaternion.setFromAxisAngle(UP_AXIS, controller.yaw);
}

function getCharacterFocusPosition(controller, target) {
  return target.copy(controller.position).setY(controller.position.y + 0.9);
}

function moveCharacterWithCollision(controller, moveDelta, sampleCollision, config) {
  if (!sampleCollision || moveDelta.lengthSq() <= 1e-8) {
    controller.position.add(moveDelta);
    return;
  }

  const radius = Math.max(0.05, config.capsuleRadius || 0.34);
  const padding = Math.max(0.01, config.collisionPadding || 0.04);
  COLLISION_DIRECTION.copy(moveDelta).setY(0);
  const travelDistance = COLLISION_DIRECTION.length();
  if (travelDistance <= 1e-6) {
    controller.position.add(moveDelta);
    return;
  }
  COLLISION_DIRECTION.divideScalar(travelDistance);
  COLLISION_RIGHT.set(-COLLISION_DIRECTION.z, 0, COLLISION_DIRECTION.x);
  COLLISION_FORWARD.copy(COLLISION_DIRECTION).multiplyScalar(radius * 0.6);

  let allowedDistance = travelDistance;
  for (const hit of probeCharacterCapsule(controller, sampleCollision, COLLISION_DIRECTION, travelDistance, radius, padding, config)) {
    if (!hit) {
      continue;
    }
    allowedDistance = Math.min(allowedDistance, Math.max(0, hit.distance - radius - padding));
  }

  controller.position.addScaledVector(COLLISION_DIRECTION, allowedDistance);

  const remainingDistance = travelDistance - allowedDistance;
  if (remainingDistance <= 1e-4) {
    return;
  }

  const blockingHit = probeCharacterCapsule(controller, sampleCollision, COLLISION_DIRECTION, travelDistance, radius, padding, config)
    .find(Boolean);
  const hitNormal = blockingHit?.normal;
  if (!hitNormal) {
    return;
  }

  SLIDE_MOVE.copy(moveDelta).setY(0);
  const projected = SLIDE_MOVE.dot(hitNormal);
  SLIDE_MOVE.addScaledVector(hitNormal, -projected).setY(0);
  const slideLength = SLIDE_MOVE.length();
  if (slideLength <= 1e-4) {
    return;
  }
  SLIDE_MOVE.setLength(Math.min(slideLength, remainingDistance));
  COLLISION_DIRECTION.copy(SLIDE_MOVE).normalize();
  let slideAllowed = SLIDE_MOVE.length();
  for (const hit of probeCharacterCapsule(controller, sampleCollision, COLLISION_DIRECTION, slideAllowed, radius, padding, config)) {
    if (!hit) {
      continue;
    }
    slideAllowed = Math.min(slideAllowed, Math.max(0, hit.distance - radius - padding));
  }
  controller.position.addScaledVector(COLLISION_DIRECTION, slideAllowed);
}

function probeCharacterCapsule(controller, sampleCollision, direction, travelDistance, radius, padding, config) {
  const height = Math.max(config.height || 1.9, radius * 2 + 0.2);
  const upperHeight = Math.max(radius, height - radius);
  const heights = [
    radius,
    Math.min(height * 0.5, upperHeight),
    upperHeight
  ];
  const lateralOffsets = [0, radius * 0.7, -radius * 0.7];
  const hits = [];

  for (const probeHeight of heights) {
    for (const sideOffset of lateralOffsets) {
      COLLISION_OFFSET.set(-direction.z, 0, direction.x).multiplyScalar(sideOffset);
      COLLISION_ORIGIN.set(
        controller.position.x + COLLISION_OFFSET.x,
        controller.position.y + probeHeight,
        controller.position.z + COLLISION_OFFSET.z
      );
      hits.push(sampleCollision(COLLISION_ORIGIN, direction, travelDistance + radius + padding));
    }
  }

  return hits;
}

function updateCharacterVerticalMotion(controller, deltaSeconds, sampleGround, config) {
  const gravity = Math.max(0, config.gravity ?? 28);
  const groundSnap = Math.max(0, config.groundSnapDistance ?? 0.18);
  const capsuleRadius = Math.max(0.05, config.capsuleRadius || 0.34);
  const footProbeHeight = Math.max(0.2, config.footProbeHeight ?? 1.2);
  const minGroundProbeHeight = Math.max(footProbeHeight, config.minGroundProbeHeight ?? 6);

  controller.verticalVelocity -= gravity * deltaSeconds;
  controller.position.y += controller.verticalVelocity * deltaSeconds;
  controller.onGround = false;

  if (!sampleGround) {
    return;
  }

  let bestHit = null;
  const offsets = [
    [0, 0],
    [capsuleRadius * 0.6, 0],
    [-capsuleRadius * 0.6, 0],
    [0, capsuleRadius * 0.6],
    [0, -capsuleRadius * 0.6]
  ];

  for (const [offsetX, offsetZ] of offsets) {
    const hit = sampleGround(
      controller.position.x + offsetX,
      controller.position.z + offsetZ,
      Math.max(controller.position.y + footProbeHeight, minGroundProbeHeight)
    );
    if (!hit) {
      continue;
    }
    if (!bestHit || hit.height > bestHit.height) {
      bestHit = hit;
    }
  }

  if (!bestHit) {
    return;
  }

  const groundHeight = bestHit.height;
  const distanceToGround = controller.position.y - groundHeight;
  if (distanceToGround <= groundSnap || (controller.verticalVelocity <= 0 && distanceToGround <= config.stepOffset)) {
    controller.position.y = groundHeight;
    controller.verticalVelocity = 0;
    controller.onGround = true;
  }
}

function applyRootMotion(controller, options) {
  const rootMotion = controller.rootMotion;
  if (!rootMotion?.node) {
    return false;
  }

  const localPosition = rootMotion.node.position;
  if (!rootMotion.sampled || rootMotion.resetPending) {
    rootMotion.previousLocalPosition.copy(localPosition);
    rootMotion.sampled = true;
    rootMotion.resetPending = false;
    localPosition.x = rootMotion.neutralLocalPosition.x;
    localPosition.z = rootMotion.neutralLocalPosition.z;
    if (options.stabilizeVertical) {
      localPosition.y = rootMotion.neutralLocalPosition.y;
    }
    return false;
  }

  let deltaX = localPosition.x - rootMotion.previousLocalPosition.x;
  let deltaZ = localPosition.z - rootMotion.previousLocalPosition.z;
  rootMotion.previousLocalPosition.copy(localPosition);

  const localDistance = Math.hypot(deltaX, deltaZ);
  if (!options.useRawDelta && (!options.moving || options.travelDistance <= 1e-5)) {
    deltaX = 0;
    deltaZ = 0;
  } else if (!options.useRawDelta && localDistance > 1e-5) {
    const scale = options.travelDistance / localDistance;
    deltaX *= scale;
    deltaZ *= scale;
  }

  localPosition.x = rootMotion.neutralLocalPosition.x;
  localPosition.z = rootMotion.neutralLocalPosition.z;
  if (options.stabilizeVertical) {
    localPosition.y = rootMotion.neutralLocalPosition.y;
  }

  if (Math.abs(deltaX) <= 1e-5 && Math.abs(deltaZ) <= 1e-5) {
    return false;
  }

  ROOT_MOTION_WORLD.set(deltaX, 0, deltaZ).applyAxisAngle(UP_AXIS, controller.yaw);
  controller.position.add(ROOT_MOTION_WORLD);
  return true;
}

function resetRootMotionSample(controller) {
  resetHumanoidRootMotionSample(controller);
}

function logControllerState(controller, event, extra = null) {
  if (!CHARACTER_DEBUG || !controller?.model || !controller?.root) {
    return;
  }

  controller.root.updateMatrixWorld(true);
  CHARACTER_BOX.setFromObject(controller.model);
  const payload = {
    positionY: controller.position.y,
    rootWorldY: controller.root.position.y,
    modelLocalY: controller.model.position.y,
    boxMinY: CHARACTER_BOX.isEmpty() ? null : CHARACTER_BOX.min.y,
    boxMaxY: CHARACTER_BOX.isEmpty() ? null : CHARACTER_BOX.max.y,
    currentAction: controller.currentAction,
    rootMotionNodeY: controller.rootMotion?.node?.position?.y ?? null,
    rootMotionNeutralY: controller.rootMotion?.neutralLocalPosition?.y ?? null
  };

  if (extra) {
    Object.assign(payload, extra);
  }

  logCharacter(event, payload);
}

function dampTowards(current, target, rate, deltaSeconds) {
  const step = rate * deltaSeconds;
  if (current < target) {
    return Math.min(current + step, target);
  }
  return Math.max(current - step, target);
}

function dampAngle(current, target, rate, deltaSeconds) {
  const delta = normalizeAngle(target - current);
  const step = rate * deltaSeconds;
  if (Math.abs(delta) <= step) {
    return target;
  }
  return current + Math.sign(delta) * step;
}

function normalizeAngle(angle) {
  let normalized = angle;
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  while (normalized < -Math.PI) {
    normalized += Math.PI * 2;
  }
  return normalized;
}
