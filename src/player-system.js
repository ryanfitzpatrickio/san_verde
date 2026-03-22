import * as THREE from 'three';

import {
  advanceCharacterAnimation,
  getCharacterDistanceToVehicle,
  loadCharacterController,
  placeCharacterNearVehicle,
  playCharacterAction,
  setCharacterVisible,
  snapCharacterCamera,
  updateCharacterCamera,
  updateCharacterController
} from './character-controller.js';
import {
  setDriveInput,
  setDriveMode,
  snapGarageCamera,
  teleportGarageVehicle,
  updateGarageRuntime
} from './game/runtime.js';
import { setPlayerMode, setPlayerHint } from './ui/hud-store.js';

const FORWARD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const WORLD_POSITION = new THREE.Vector3();
const VEHICLE_FORWARD = new THREE.Vector3();
const BOX = new THREE.Box3();
const SIZE = new THREE.Vector3();
const CENTER = new THREE.Vector3();
const MIN = new THREE.Vector3();
const MAX = new THREE.Vector3();
const LOCAL_QUATERNION = new THREE.Quaternion();
const WORLD_QUATERNION = new THREE.Quaternion();
const TEMP_CORNER = new THREE.Vector3();
const SEAT_ROOT_POSITION = new THREE.Vector3();
const DOORWAY_POSITION = new THREE.Vector3();
const ENTRY_TARGET_POSITION = new THREE.Vector3();
const ENTRY_MOVE_DIRECTION = new THREE.Vector3();
const ENTRY_LOOK_TARGET = new THREE.Vector3();

const PLAYER_DEBUG = true;

function logPlayer(event, payload) {
  if (!PLAYER_DEBUG) {
    return;
  }
  if (event.startsWith('bike:')) {
    //console.log(`[player] ${event} ${JSON.stringify(payload)}`);
    return;
  }
  //console.log('[player]', event, payload);
}

function formatDebugVector(vector) {
  if (!vector) {
    return null;
  }

  return vector.toArray().map((value) => Number(value.toFixed(4)));
}

export function createPlayerSystem({ state, ui, config, setStatus, getStageLabel }) {
  function getCharacterActionDuration(controller, actionName) {
    const duration = controller?.actions?.get(actionName)?.getClip?.().duration;
    return Number.isFinite(duration) && duration > 0 ? duration : 0.1;
  }

  function getVehicleLocalMetrics(context) {
    if (!context?.carMount || !context?.vehicleRoot) {
      return null;
    }

    context.carMount.updateMatrixWorld(true);
    BOX.setFromObject(context.carMount);
    if (BOX.isEmpty()) {
      return null;
    }

    BOX.getSize(SIZE);
    BOX.getCenter(CENTER);
    const localCenter = context.vehicleRoot.worldToLocal(CENTER.clone());
    return {
      size: SIZE.clone(),
      center: localCenter
    };
  }

  function ensureInteraction(context) {
    if (!context.playerInteraction) {
      context.playerInteraction = {
        hingeLocalPosition: null,
        doorwayLocalPosition: null,
        doorwayLocalQuaternion: null,
        doorwayLocatorName: null,
        usesDoorwayLocator: false,
        seatLocalPosition: null,
        seatLocatorLocalPosition: null,
        steeringLocalPosition: null,
        seatBounds: null,
        usesSeatLocator: false,
        lastInteractionLogKey: null,
        enteringStartPosition: new THREE.Vector3(),
        enteringStartYaw: 0,
        exitingStartPosition: new THREE.Vector3(),
        exitingTargetPosition: new THREE.Vector3(),
        exitingTargetYaw: 0
      };
    }
    return context.playerInteraction;
  }

  function getObjectBoundsInLocalSpace(object, localRoot) {
    if (!object || !localRoot) {
      return null;
    }

    object.updateMatrixWorld(true);
    BOX.setFromObject(object);
    if (BOX.isEmpty()) {
      return null;
    }

    MIN.set(Infinity, Infinity, Infinity);
    MAX.set(-Infinity, -Infinity, -Infinity);

    for (const x of [BOX.min.x, BOX.max.x]) {
      for (const y of [BOX.min.y, BOX.max.y]) {
        for (const z of [BOX.min.z, BOX.max.z]) {
          TEMP_CORNER.set(x, y, z);
          localRoot.worldToLocal(TEMP_CORNER);
          MIN.min(TEMP_CORNER);
          MAX.max(TEMP_CORNER);
        }
      }
    }

    return {
      min: MIN.clone(),
      max: MAX.clone(),
      size: MAX.clone().sub(MIN),
      center: MIN.clone().add(MAX).multiplyScalar(0.5)
    };
  }

  function getResolvedSeatRootLocalPosition(context, options = {}) {
    if (state.activeVehicleKind === 'bike') {
      SEAT_ROOT_POSITION.set(
        config.character.bikeSeatOffsetX || 0,
        config.character.bikeSeatOffsetY || 0,
        config.character.bikeSeatOffsetZ || 0
      );
      return SEAT_ROOT_POSITION;
    }

    const interaction = ensureInteraction(context);
    if (!interaction.seatLocalPosition) {
      return null;
    }

    const driverSideSign = interaction.hingeLocalPosition
      ? Math.sign(interaction.hingeLocalPosition.x || 1)
      : 1;
    SEAT_ROOT_POSITION.copy(interaction.seatLocalPosition);
    if (interaction.usesSeatLocator) {
      SEAT_ROOT_POSITION.x += (config.character.seatLocatorOffsetX || 0) - driverSideSign * (config.character.seatLocatorSideOffset || 0);
      SEAT_ROOT_POSITION.y += getCharacterSeatLocatorOffsetY(context, options);
      SEAT_ROOT_POSITION.z += config.character.seatLocatorOffsetZ || 0;
    } else {
      SEAT_ROOT_POSITION.x += (config.character.seatRootOffsetX || 0) - driverSideSign * (config.character.seatRootSideOffset || 0);
      SEAT_ROOT_POSITION.y += getCharacterSeatBaseOffsetY(context, config.character.seatRootOffsetY || 0);
      SEAT_ROOT_POSITION.z += config.character.seatRootOffsetZ || 0;
    }
    if (options.transition) {
      SEAT_ROOT_POSITION.y += interaction.usesSeatLocator
        ? (config.character.seatLocatorTransitionOffsetY ?? config.character.seatTransitionOffsetY ?? 0)
        : (config.character.seatTransitionOffsetY || 0);
      SEAT_ROOT_POSITION.z += config.character.seatTransitionOffsetZ || 0;
    }
    if (options.exiting) {
      SEAT_ROOT_POSITION.y += interaction.usesSeatLocator
        ? (config.character.seatLocatorExitOffsetY ?? config.character.seatExitOffsetY ?? 0)
        : (config.character.seatExitOffsetY || 0);
    }
    return SEAT_ROOT_POSITION;
  }

  function getCharacterSeatLocatorOffsetY(context, options = {}) {
    const hipHeight = context?.characterController?.metrics?.hipHeight;
    if (!Number.isFinite(hipHeight) || hipHeight <= 0) {
      return config.character.seatLocatorOffsetY || 0;
    }

    const seatedHipOffset = Number.isFinite(config.character.seatLocatorHipOffsetY)
      ? config.character.seatLocatorHipOffsetY
      : -0.08;
    const transitionHipOffset = Number.isFinite(config.character.seatLocatorTransitionHipOffsetY)
      ? config.character.seatLocatorTransitionHipOffsetY
      : seatedHipOffset;
    const exitHipOffset = Number.isFinite(config.character.seatLocatorExitHipOffsetY)
      ? config.character.seatLocatorExitHipOffsetY
      : seatedHipOffset;
    const hipAboveLocatorY = options.exiting
      ? exitHipOffset
      : options.transition
        ? transitionHipOffset
        : seatedHipOffset;
    return THREE.MathUtils.clamp(hipAboveLocatorY - hipHeight, -1.6, 0.2);
  }

  function getCharacterSeatBaseOffsetY(context, referenceRootOffsetY) {
    const hipHeight = context?.characterController?.metrics?.hipHeight;
    if (!Number.isFinite(hipHeight) || hipHeight <= 0) {
      return referenceRootOffsetY;
    }

    const referenceHipHeight = Number.isFinite(config.character.seatReferenceHipHeight)
      ? config.character.seatReferenceHipHeight
      : (config.character.height || 1.9) * 0.53;
    const seatedHipTargetY = referenceRootOffsetY + referenceHipHeight;
    return THREE.MathUtils.clamp(seatedHipTargetY - hipHeight, -1.4, 0.4);
  }

  function getVehicleWorldSideVector(sign, yaw = state.vehicleYaw) {
    return new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(sign || 1).normalize();
  }

  function computeDriverDoorWorldPose(context, options = {}) {
    const interaction = computeVehicleInteractionPoints(context);
    if (
      options.preferDoorwayLocator !== false &&
      interaction.usesDoorwayLocator &&
      interaction.doorwayLocalPosition
    ) {
      const targetPosition = context.vehicleRoot.localToWorld(
        interaction.doorwayLocalPosition.clone()
      );
      targetPosition.y = state.vehiclePosition?.y ?? targetPosition.y;
      const hingeWorld = interaction.hingeLocalPosition
        ? context.vehicleRoot.localToWorld(interaction.hingeLocalPosition.clone())
        : null;
      const facingTarget = hingeWorld || context.vehicleRoot.getWorldPosition(WORLD_POSITION);
      VEHICLE_FORWARD.subVectors(facingTarget, targetPosition);
      VEHICLE_FORWARD.y = 0;
      if (VEHICLE_FORWARD.lengthSq() <= 1e-6) {
        VEHICLE_FORWARD.set(Math.sin(state.vehicleYaw), 0, Math.cos(state.vehicleYaw));
      } else {
        VEHICLE_FORWARD.normalize();
      }

      return {
        hingeWorld,
        targetPosition,
        targetYaw: Math.atan2(VEHICLE_FORWARD.x, VEHICLE_FORWARD.z),
        source: 'doorwayLocator'
      };
    }

    if (!interaction.hingeLocalPosition) {
      return null;
    }

    const hingeWorld = context.vehicleRoot.localToWorld(interaction.hingeLocalPosition.clone());
    const sideSign = Math.sign(interaction.hingeLocalPosition.x || 1);
    const outward = getVehicleWorldSideVector(sideSign);
    const forward = new THREE.Vector3(Math.sin(state.vehicleYaw), 0, Math.cos(state.vehicleYaw));
    const sideDistance = Math.abs(options.sideDistance ?? config.character.spawnSideOffset);
    const forwardDistance = options.forwardDistance ?? config.character.spawnForwardOffset;
    const targetPosition = hingeWorld.clone()
      .addScaledVector(outward, sideDistance)
      .addScaledVector(forward, forwardDistance);
    targetPosition.y = state.vehiclePosition?.y ?? hingeWorld.y;
    const targetYaw = Math.atan2(hingeWorld.x - targetPosition.x, hingeWorld.z - targetPosition.z);

    return {
      hingeWorld,
      targetPosition,
      targetYaw,
      source: 'hingeOffsets'
    };
  }

  function computeDriverDoorInteractionPose(context) {
    return computeDriverDoorWorldPose(context, {
      preferDoorwayLocator: true,
      sideDistance: config.character.interactionSideOffset,
      forwardDistance: config.character.interactionForwardOffset
    });
  }

  function isCharacterActive(context) {
    return Boolean(
      context?.characterController &&
      state.characterLoaded &&
      !state.driveMode &&
      state.characterVehicleState === 'on_foot'
    );
  }

  function getActiveStagePosition(context) {
    if (isCharacterActive(context)) {
      return context.characterController.position;
    }

    return state.vehiclePosition;
  }

  function clearCharacterInput() {
    state.characterInput.forward = false;
    state.characterInput.backward = false;
    state.characterInput.left = false;
    state.characterInput.right = false;
    state.characterInput.run = false;
    state.characterInput.jump = false;
  }

  function clearDriveInputs(context) {
    if (!context?.gameRuntime) {
      return;
    }

    setDriveInput(context.gameRuntime, 'forward', false);
    setDriveInput(context.gameRuntime, 'reverse', false);
    setDriveInput(context.gameRuntime, 'left', false);
    setDriveInput(context.gameRuntime, 'right', false);
  }

  function setOnFootTransform(controller, position, yaw, pitch = 0) {
    controller.position.copy(position);
    controller.yaw = yaw;
    controller.moveSpeed = 0;
    controller.verticalVelocity = 0;
    controller.onGround = false;
    controller.jumpHeld = false;
    controller.root.position.copy(controller.position);
    controller.root.quaternion.setFromAxisAngle(UP, controller.yaw);
    if (pitch) {
      controller.root.quaternion.multiply(
        LOCAL_QUATERNION.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch)
      );
    }
  }

  function snapCharacterToGround(context, extraHeight = 0) {
    const controller = context?.characterController;
    const sampleGround = context?.stage?.sampleGround;
    if (!controller || !sampleGround) {
      return;
    }

    const hit = sampleGround(
      controller.position.x,
      controller.position.z,
      Math.max(controller.position.y + config.character.footProbeHeight + extraHeight, config.character.minGroundProbeHeight || 6)
    );
    if (!hit) {
      return;
    }

    controller.position.y = hit.height;
    controller.verticalVelocity = 0;
    controller.onGround = true;
    controller.root.position.copy(controller.position);
  }

  function resolveCharacterVehiclePenetration(context, options = {}) {
    const controller = context?.characterController;
    const resolvePenetration = context?.resolvePlayerVehiclePenetration;
    if (!controller || typeof resolvePenetration !== 'function') {
      return false;
    }

    const moved = resolvePenetration(controller.position, {
      radius: config.character.capsuleRadius,
      padding: config.character.collisionPadding,
      maxIterations: options.maxIterations ?? 4,
      extraPush: options.extraPush ?? 0.04
    });
    if (!moved) {
      return false;
    }

    controller.root.position.copy(controller.position);
    return true;
  }

  function attachCharacterToWorld(context) {
    if (!context?.characterController) {
      return;
    }

    if (context.characterController.root.parent !== context.characterMount) {
      context.characterMount.attach(context.characterController.root);
    }
  }

  function attachCharacterToVehicleSeat(context, options = {}) {
    if (!context?.characterController) {
      return;
    }

    const resolvedSeatPosition = getResolvedSeatRootLocalPosition(context, options);
    if (!resolvedSeatPosition) {
      return;
    }

    if (context.characterController.root.parent !== context.vehicleRoot) {
      context.vehicleRoot.attach(context.characterController.root);
    }

    const bikeRiderLean =
      state.activeVehicleKind === 'bike' && !options.transition && !options.exiting
        ? (state.bikeLeanAngle || 0) * (config.vehicleFeedback?.vehicleKinds?.bike?.riderLeanScale ?? 0.9)
        : 0;

    context.characterController.root.position.copy(resolvedSeatPosition);
    context.characterController.root.quaternion.setFromEuler(
      new THREE.Euler(
        state.activeVehicleKind === 'bike'
          ? (config.character.bikeSeatTiltX || 0)
          : (config.character.seatBackTiltX || 0),
        0,
        bikeRiderLean
      )
    );
    context.characterController.position.copy(
      context.vehicleRoot.localToWorld(resolvedSeatPosition.clone())
    );
    context.characterController.yaw = state.vehicleYaw;
    context.characterController.moveSpeed = 0;
  }

  function placeCharacterAtVehicle(context, useExitOffsets = false) {
    if (!context?.characterController) {
      return;
    }

    attachCharacterToWorld(context);
    const doorwayPose = computeDriverDoorWorldPose(context, {
      preferDoorwayLocator: false,
      sideDistance: useExitOffsets ? config.character.exitSideOffset : config.character.spawnSideOffset,
      forwardDistance: useExitOffsets ? config.character.exitForwardOffset : config.character.spawnForwardOffset
    });
    if (doorwayPose) {
      setOnFootTransform(context.characterController, doorwayPose.targetPosition, doorwayPose.targetYaw);
      snapCharacterToGround(context, 2);
      logPlayer('spawn:doorway-pose', {
        useExitOffsets,
        targetPosition: doorwayPose.targetPosition.toArray(),
        targetYaw: doorwayPose.targetYaw
      });
      return;
    }

    placeCharacterNearVehicle(
      context.characterController,
      state.vehiclePosition,
      state.vehicleYaw,
      config.character,
      -1,
      useExitOffsets
        ? {
          sideOffset: config.character.exitSideOffset,
          forwardOffset: config.character.exitForwardOffset
        }
        : null
    );
    logPlayer('spawn:fallback-near-vehicle', {
      useExitOffsets,
      vehiclePosition: state.vehiclePosition.toArray(),
      vehicleYaw: state.vehicleYaw
    });
  }

  function findNamedObject(rootObject, pattern) {
    let match = null;
    rootObject?.traverse((child) => {
      if (!match && child.name && pattern.test(child.name)) {
        match = child;
      }
    });
    return match;
  }

  function computeVehicleInteractionPoints(context) {
    const interaction = ensureInteraction(context);
    interaction.hingeLocalPosition = null;
    interaction.doorwayLocalPosition = null;
    interaction.doorwayLocalQuaternion = null;
    interaction.doorwayLocatorName = null;
    interaction.usesDoorwayLocator = false;
    interaction.seatLocalPosition = null;
    interaction.seatLocatorLocalPosition = null;
    interaction.steeringLocalPosition = null;
    interaction.seatBounds = null;
    interaction.usesSeatLocator = false;

    if (!context?.vehicleRoot || !context?.carMount) {
      return interaction;
    }

    if (state.doorRig?.pivot) {
      state.doorRig.pivot.updateMatrixWorld(true);
      interaction.hingeLocalPosition = context.vehicleRoot.worldToLocal(
        state.doorRig.pivot.getWorldPosition(WORLD_POSITION).clone()
      );
    }

    context.carMount.updateMatrixWorld(true);
    const metrics = getVehicleLocalMetrics(context);
    const vehicleWidth = Math.max(metrics?.size.x || 0, 0.45);
    const vehicleLength = Math.max(metrics?.size.z || 0, 0.75);
    const vehicleHeight = Math.max(metrics?.size.y || 0, 0.35);
    const forwardSeatOffset = Math.min(
      Math.max(vehicleLength * 0.08, 0.05),
      Math.max(config.character.seatFallbackForwardOffset * 0.22, 0.1)
    );
    const inwardSeatOffset = Math.min(
      Math.max(vehicleWidth * 0.12, 0.04),
      Math.max(config.character.seatFallbackInwardOffset * 0.16, 0.08)
    );
    const seatDrop = Math.min(
      Math.max(vehicleHeight * 0.2, 0.05),
      Math.max(config.character.seatFallbackHeight * 0.18, 0.12)
    );
    const seatLocator =
      findNamedObject(context.carMount, /^locator[_ ]seat$/i) ||
      findNamedObject(context.carMount, /locator.*seat|seat.*locator/i);
    const seatMesh =
      findNamedObject(context.carMount, /driver.*seat|^seat$/i) ||
      findNamedObject(context.carMount, /seat/i);
    const doorwayLocator =
      findNamedObject(context.carMount, /^locator[_ ](door[_ ]entry|door[_ ]spot|driver[_ ]door[_ ]entry|driver[_ ]entry|interaction|entry|spot)$/i) ||
      findNamedObject(context.carMount, /locator.*(door.*entry|door.*spot|driver.*entry|interaction|entry|spot)/i);
    const steeringTarget =
      findNamedObject(context.carMount, /locator.*steering|steering.*locator|steering.*wheel|wheel.*steering/i) ||
      findNamedObject(context.carMount, /steering|dash|cockpit/i);
    const driverSideSign = interaction.hingeLocalPosition
      ? Math.sign(interaction.hingeLocalPosition.x || 1)
      : 1;

    if (seatLocator) {
      const seatWorld = seatLocator.getWorldPosition(WORLD_POSITION);
      interaction.seatLocatorLocalPosition = context.vehicleRoot.worldToLocal(seatWorld.clone());
      interaction.seatLocalPosition = interaction.seatLocatorLocalPosition.clone();
      interaction.usesSeatLocator = true;
    }

    if (doorwayLocator) {
      const doorwayWorldPosition = doorwayLocator.getWorldPosition(WORLD_POSITION);
      const doorwayWorldQuaternion = doorwayLocator.getWorldQuaternion(WORLD_QUATERNION);
      interaction.doorwayLocalPosition = context.vehicleRoot.worldToLocal(
        doorwayWorldPosition.clone()
      );
      interaction.doorwayLocalQuaternion = context.vehicleRoot
        .getWorldQuaternion(LOCAL_QUATERNION)
        .invert()
        .multiply(doorwayWorldQuaternion)
        .clone();
      interaction.doorwayLocatorName = doorwayLocator.name;
      interaction.usesDoorwayLocator = true;
    }

    if (!interaction.usesSeatLocator && seatMesh) {
      interaction.seatBounds = getObjectBoundsInLocalSpace(seatMesh, context.vehicleRoot);
      if (interaction.seatBounds) {
        interaction.seatLocalPosition = interaction.seatBounds.center.clone();
        interaction.seatLocalPosition.x = driverSideSign > 0
          ? THREE.MathUtils.lerp(interaction.seatBounds.center.x, interaction.seatBounds.max.x, 0.34)
          : THREE.MathUtils.lerp(interaction.seatBounds.center.x, interaction.seatBounds.min.x, 0.34);
        interaction.seatLocalPosition.y = interaction.seatBounds.min.y + interaction.seatBounds.size.y * 0.24;
        interaction.seatLocalPosition.z = interaction.seatBounds.center.z - interaction.seatBounds.size.z * 0.02;
      }
    }

    if (steeringTarget) {
      const steeringWorld = steeringTarget.getWorldPosition(WORLD_POSITION);
      interaction.steeringLocalPosition = context.vehicleRoot.worldToLocal(steeringWorld.clone());

      if (!interaction.seatLocalPosition) {
        interaction.seatLocalPosition = interaction.steeringLocalPosition.clone();
      } else if (!interaction.usesSeatLocator && interaction.seatBounds) {
        interaction.seatLocalPosition.x = THREE.MathUtils.lerp(
          interaction.hingeLocalPosition ? interaction.hingeLocalPosition.x : interaction.seatLocalPosition.x,
          interaction.steeringLocalPosition.x,
          0.45
        );
        interaction.seatLocalPosition.z = THREE.MathUtils.lerp(
          interaction.seatLocalPosition.z,
          interaction.steeringLocalPosition.z - forwardSeatOffset * 0.22,
          0.2
        );
        interaction.seatLocalPosition.y = Math.max(
          interaction.seatLocalPosition.y,
          interaction.seatBounds.min.y + interaction.seatBounds.size.y * 0.22
        );
      }

      if (!interaction.usesSeatLocator && !interaction.seatBounds) {
        interaction.seatLocalPosition.x = THREE.MathUtils.lerp(
          interaction.seatLocalPosition.x,
          driverSideSign * Math.max(Math.abs(interaction.steeringLocalPosition.x) - inwardSeatOffset * 0.25, inwardSeatOffset),
          0.72
        );
        interaction.seatLocalPosition.z = THREE.MathUtils.lerp(
          interaction.seatLocalPosition.z,
          interaction.steeringLocalPosition.z - forwardSeatOffset,
          0.82
        );
        interaction.seatLocalPosition.y = THREE.MathUtils.lerp(
          interaction.seatLocalPosition.y,
          Math.max(interaction.steeringLocalPosition.y - seatDrop * 1.2, 0.04),
          0.7
        );
      }
    } else if (!interaction.usesSeatLocator && interaction.hingeLocalPosition) {
      interaction.seatLocalPosition = interaction.hingeLocalPosition.clone();
      interaction.seatLocalPosition.x = driverSideSign * inwardSeatOffset;
      interaction.seatLocalPosition.z -= forwardSeatOffset;
      interaction.seatLocalPosition.y = Math.max(interaction.hingeLocalPosition.y - seatDrop * 0.5, 0.04);
    } else if (!interaction.usesSeatLocator) {
      if (metrics) {
        interaction.seatLocalPosition = metrics.center.clone();
        interaction.seatLocalPosition.x = driverSideSign * inwardSeatOffset;
        interaction.seatLocalPosition.z += vehicleLength * 0.06;
        interaction.seatLocalPosition.y = Math.max(vehicleHeight * 0.16, 0.05);
      }
    }

    if (!interaction.usesSeatLocator && interaction.seatLocalPosition && interaction.hingeLocalPosition) {
      interaction.seatLocalPosition.x = THREE.MathUtils.lerp(
        interaction.seatLocalPosition.x,
        interaction.hingeLocalPosition.x * 0.58,
        interaction.seatBounds ? 0.24 : 0.58
      );
    }

    const interactionPayload = {
      doorwayLocatorName: interaction.doorwayLocatorName,
      usesDoorwayLocator: interaction.usesDoorwayLocator,
      usesSeatLocator: interaction.usesSeatLocator,
      doorwayLocalPosition: formatDebugVector(interaction.doorwayLocalPosition),
      hingeLocalPosition: formatDebugVector(interaction.hingeLocalPosition),
      seatLocatorLocalPosition: formatDebugVector(interaction.seatLocatorLocalPosition),
      seatLocalPosition: formatDebugVector(interaction.seatLocalPosition),
      steeringLocalPosition: formatDebugVector(interaction.steeringLocalPosition)
    };
    const interactionLogKey = JSON.stringify(interactionPayload);
    if (state.activeVehicleKind !== 'bike' && interaction.lastInteractionLogKey !== interactionLogKey) {
      interaction.lastInteractionLogKey = interactionLogKey;
      logPlayer('vehicle:interaction-points', interactionPayload);
    }

    return interaction;
  }

  function getDriverHingeWorldPosition(context) {
    const interaction = computeVehicleInteractionPoints(context);
    if (!interaction.hingeLocalPosition) {
      return null;
    }

    return context.vehicleRoot.localToWorld(interaction.hingeLocalPosition.clone());
  }

  function canEnterVehicle(context) {
    if (!context?.characterController || state.characterVehicleState !== 'on_foot') {
      state.canEnterVehicle = false;
      return false;
    }

    const interactionPose = computeDriverDoorInteractionPose(context);
    if (!interactionPose) {
      state.canEnterVehicle = false;
      return false;
    }

    const vehicleMetrics = getVehicleLocalMetrics(context);
    const size = vehicleMetrics?.size || null;
    const extraDistance = size
      ? Math.min(0.6, Math.max(size.x, size.z) * 0.12)
      : 0;
    state.canEnterVehicle =
      getCharacterDistanceToVehicle(context.characterController, interactionPose.targetPosition)
        <= (config.character.interactionDistance + extraDistance);
    return state.canEnterVehicle;
  }

  function syncOverlay(context) {
    const hasCharacter = Boolean(context?.characterController) && state.characterLoaded;
    ui.toggleLap.textContent = `Drive mode: ${state.driveMode ? 'On' : 'Off'}`;
    const transmissionMode = config.drivingStyles?.[state.drivingStyle]?.transmissionMode || 'manual';
    const driveHint =
      transmissionMode === 'automatic'
        ? 'WASD drive, automatic shifting, F exit car'
        : 'WASD drive, Q/E shift, N neutral, F exit car';

    if (!hasCharacter) {
      setPlayerMode(state.driveMode ? 'Driving' : 'Vehicle');
      setPlayerHint(state.driveMode ? driveHint : 'Character asset loading or unavailable');
      return;
    }

    if (state.characterVehicleState === 'wipeout') {
      setCharacterVisible(context.characterController, true);
      setPlayerMode('Wipeout');
      setPlayerHint('');
      return;
    }

    if (state.characterVehicleState === 'entering') {
      setCharacterVisible(context.characterController, true);
      setPlayerMode('Entering car');
      setPlayerHint('Door opening, then getting in');
      return;
    }

    if (state.characterVehicleState === 'exiting') {
      setCharacterVisible(context.characterController, true);
      setPlayerMode('Exiting car');
      setPlayerHint('Getting out');
      return;
    }

    if (state.driveMode) {
      setCharacterVisible(context.characterController, state.activeVehicleKind !== 'valkyrie');
      setPlayerMode('Driving');
      setPlayerHint(driveHint);
      return;
    }

    setCharacterVisible(context.characterController, true);
    const readyToEnter = canEnterVehicle(context);
    setPlayerMode('On foot');
    setPlayerHint(readyToEnter
      ? 'Move to the driver door and press F'
      : 'WASD move, Shift run, Space jump, enter near the driver door');
  }

  function applySnapshot(context, snapshot) {
    context.applyGarageSnapshot(snapshot);
  }

  function applyDriveCamera(context) {
    if (!context?.gameRuntime) {
      return;
    }

    applySnapshot(context, snapGarageCamera(context.gameRuntime));
    applySnapshot(context, updateGarageRuntime(context.gameRuntime, 0));
  }

  function focusCurrentTarget(context, options = {}) {
    if (!context) {
      return;
    }

    if (state.driveMode) {
      if (context.gameRuntime) {
        applyDriveCamera(context);
      } else {
        options.focusVehicle?.();
      }
      return;
    }

    if (state.characterVehicleState === 'entering') {
      snapCharacterCamera(
        context.camera,
        context.controls,
        context.characterController,
        config.character,
        state.selectedStageId
      );
      return;
    }

    if (isCharacterActive(context)) {
      snapCharacterCamera(
        context.camera,
        context.controls,
        context.characterController,
        config.character,
        state.selectedStageId
      );
      if (options.syncStatus) {
        setStatus(`${getStageLabel(state.selectedStageId)} ready`);
      }
      return;
    }

    if (options.shouldUseStageOverview?.(state.selectedStageId)) {
      options.focusStage?.();
    } else {
      options.focusVehicle?.();
    }
  }

  function finishEnterVehicle(context) {
    attachCharacterToVehicleSeat(context, { transition: true });
    playCharacterAction(context.characterController, 'drive');
    advanceCharacterAnimation(context.characterController, 0, { consumeRootMotion: false });
    state.doorOpen = false;
    state.doorAngle = 0;
    if (state.doorRig?.pivot?.userData?.closedQuaternion) {
      state.doorRig.pivot.quaternion.copy(state.doorRig.pivot.userData.closedQuaternion);
    }
    ui.toggleDoor.textContent = 'Door: Closed';
    state.characterVehicleState = 'driving';
    state.characterEnterTimer = 0;
    state.autoRotate = false;
    ui.toggleRotation.textContent = 'Auto-rotate: Off';
    applySnapshot(context, setDriveMode(context.gameRuntime, true));
    applyDriveCamera(context);
    syncOverlay(context);
    setStatus(`${getStageLabel(state.selectedStageId)} ready`);
  }

  function beginEnterVehicle(context) {
    if (!context?.characterController || state.characterVehicleState !== 'on_foot') {
      return false;
    }

    if (!canEnterVehicle(context)) {
      syncOverlay(context);
      return false;
    }

    computeVehicleInteractionPoints(context);
    clearCharacterInput();
    clearDriveInputs(context);
    state.characterVehicleState = 'entering';
    state.characterEnterTimer = 0;
    state.doorOpen = false;
    ui.toggleDoor.textContent = 'Door: Closed';

    const interaction = ensureInteraction(context);
    const doorwayPose = computeDriverDoorInteractionPose(context);
    if (doorwayPose) {
      setOnFootTransform(
        context.characterController,
        doorwayPose.targetPosition,
        doorwayPose.targetYaw
      );
      snapCharacterToGround(context, 2);
      interaction.enteringStartPosition.copy(doorwayPose.targetPosition);
      interaction.enteringStartYaw = doorwayPose.targetYaw;
    } else {
      interaction.enteringStartPosition.copy(context.characterController.position);
      interaction.enteringStartYaw = context.characterController.yaw;
    }

    playCharacterAction(context.characterController, 'enterCar');
    advanceCharacterAnimation(context.characterController, 0, {
      consumeRootMotion: false,
      stabilizeVertical: true
    });
    syncOverlay(context);
    setStatus('Opening door');
    return true;
  }

  function enterVehicle(context) {
    return beginEnterVehicle(context);
  }

  function exitVehicle(context) {
    if (!context?.characterController) {
      return;
    }

    if (state.characterVehicleState !== 'driving') {
      return;
    }

    const interaction = ensureInteraction(context);
    const doorwayPose = computeDriverDoorInteractionPose(context);

    clearDriveInputs(context);
    applySnapshot(context, setDriveMode(context.gameRuntime, false));
    state.characterVehicleState = 'exiting';
    state.characterEnterTimer = 0;
    state.doorOpen = false;
    ui.toggleDoor.textContent = 'Door: Closed';
    attachCharacterToVehicleSeat(context, { transition: true, exiting: true });
    if (doorwayPose) {
      interaction.exitingTargetPosition.copy(doorwayPose.targetPosition);
      interaction.exitingTargetYaw = doorwayPose.targetYaw;
    } else {
      interaction.exitingTargetPosition.copy(context.characterController.position);
      interaction.exitingTargetYaw = context.characterController.yaw;
    }
    interaction.exitingStartPosition.copy(context.characterController.position);
    playCharacterAction(context.characterController, 'exitCar');
    advanceCharacterAnimation(context.characterController, 0, {
      consumeRootMotion: false,
      stabilizeVertical: true
    });
    syncOverlay(context);
    snapCharacterCamera(
      context.camera,
      context.controls,
      context.characterController,
      config.character,
      state.selectedStageId
    );
    setStatus('Exiting car');
  }

  function directMountVehicle(context) {
    if (!context?.characterController) {
      return;
    }

    clearCharacterInput();
    clearDriveInputs(context);
    state.characterVehicleState = 'driving';
    state.characterEnterTimer = 0;
    playCharacterAction(context.characterController, 'drive');
    attachCharacterToVehicleSeat(context);
    if (state.activeVehicleKind === 'bike') {
      const resolvedSeatPosition = getResolvedSeatRootLocalPosition(context)?.clone();
      logPlayer('bike:mount', {
        resolvedSeatPosition: resolvedSeatPosition?.toArray() || null,
        characterRootLocalPosition: context.characterController.root.position.toArray(),
        characterRootLocalQuaternion: context.characterController.root.quaternion.toArray(),
        bikeSeatOffset: [
          config.character.bikeSeatOffsetX || 0,
          config.character.bikeSeatOffsetY || 0,
          config.character.bikeSeatOffsetZ || 0
        ]
      });
    }
    advanceCharacterAnimation(context.characterController, 0, { consumeRootMotion: false });
    if (state.activeVehicleKind === 'valkyrie') {
      setCharacterVisible(context.characterController, false);
    }
    applySnapshot(context, setDriveMode(context.gameRuntime, true));
    applyDriveCamera(context);
    syncOverlay(context);
    setStatus(`${getStageLabel(state.selectedStageId)} ready`);
  }

  function directExitVehicle(context) {
    if (!context?.characterController) {
      return;
    }

    clearDriveInputs(context);
    applySnapshot(context, setDriveMode(context.gameRuntime, false));
    state.characterVehicleState = 'on_foot';
    state.characterEnterTimer = 0;
    attachCharacterToWorld(context);
    playCharacterAction(context.characterController, 'idle');
    placeCharacterAtVehicle(context, true);
    advanceCharacterAnimation(context.characterController, 0, { consumeRootMotion: false });
    syncOverlay(context);
    focusCurrentTarget(context, context.focusOptions);
    setStatus('On foot');
  }

  function tryEnterVehicle(context) {
    return beginEnterVehicle(context);
  }

  async function loadCharacterAssets(context) {
    context.clearGroup(context.characterMount, { dispose: true });
    state.characterLoaded = false;
    state.characterVehicleState = 'on_foot';
    state.characterEnterTimer = 0;
    syncOverlay(context);

    try {
      const controller = await loadCharacterController({
        fbxLoader: context.fbxLoader,
        gltfLoader: context.gltfLoader,
        modelUrl: config.character.modelUrl,
        animationUrls: config.character.animationUrls,
        config: config.character
      });
      context.characterController = controller;
      context.characterMount.add(controller.root);
      state.characterLoaded = true;
      computeVehicleInteractionPoints(context);
      placeCharacterAtVehicle(context);
      logPlayer('character:loaded', {
        position: context.characterController.position.toArray(),
        yaw: context.characterController.yaw,
        vehicleYaw: state.vehicleYaw
      });
      setCharacterVisible(controller, !state.driveMode);
      syncOverlay(context);
      setStatus('Character loaded');
      return true;
    } catch (error) {
      console.error(error);
      context.characterController = null;
      state.characterLoaded = false;
      state.characterVehicleState = 'on_foot';
      syncOverlay(context);
      setStatus('Character load failed, vehicle mode only');
      return false;
    }
  }

  function updateEnteringVehicle(context, deltaSeconds) {
    const interaction = ensureInteraction(context);
    state.characterEnterTimer += deltaSeconds;

    const duration = getCharacterActionDuration(context.characterController, 'enterCar');
    const openTime = THREE.MathUtils.clamp(
      config.character.enterDoorOpenDelaySeconds ?? Math.min(config.character.doorOpenLeadSeconds, duration * 0.6),
      0,
      Math.max(duration - 0.2, 0)
    );
    const closeTime = THREE.MathUtils.clamp(
      duration * 0.76 - (config.character.enterDoorCloseAdvanceSeconds || 0),
      openTime + 0.15,
      duration
    );
    const moveEnd = Math.max(openTime + 0.12, duration * 0.5);
    const moveProgress = THREE.MathUtils.clamp(
      (state.characterEnterTimer - openTime) / Math.max(moveEnd - openTime, 0.001),
      0,
      1
    );
    const easedMoveProgress = THREE.MathUtils.smoothstep(moveProgress, 0, 1);
    attachCharacterToWorld(context);
    ENTRY_TARGET_POSITION.copy(
      context.vehicleRoot.localToWorld(
        (getResolvedSeatRootLocalPosition(context, { transition: true }) || new THREE.Vector3()).clone()
      )
    );
    DOORWAY_POSITION.copy(interaction.enteringStartPosition).lerp(
      ENTRY_TARGET_POSITION,
      easedMoveProgress
    );
    ENTRY_MOVE_DIRECTION.subVectors(ENTRY_TARGET_POSITION, interaction.enteringStartPosition);
    ENTRY_MOVE_DIRECTION.y = 0;
    let entryTargetYaw = ENTRY_MOVE_DIRECTION.lengthSq() > 1e-6
      ? Math.atan2(ENTRY_MOVE_DIRECTION.x, ENTRY_MOVE_DIRECTION.z)
      : state.vehicleYaw;
    if (state.activeVehicleKind !== 'bike' && interaction.steeringLocalPosition) {
      ENTRY_LOOK_TARGET.copy(
        context.vehicleRoot.localToWorld(interaction.steeringLocalPosition.clone())
      );
      ENTRY_MOVE_DIRECTION.subVectors(ENTRY_LOOK_TARGET, DOORWAY_POSITION);
      ENTRY_MOVE_DIRECTION.y = 0;
      if (ENTRY_MOVE_DIRECTION.lengthSq() > 1e-6) {
        entryTargetYaw = Math.atan2(ENTRY_MOVE_DIRECTION.x, ENTRY_MOVE_DIRECTION.z) - Math.PI * 0.5;
      }
    }
    const leanBackStartTime = Math.max(0, duration - 2);
    const seatedPitchTarget = state.activeVehicleKind === 'bike'
      ? (config.character.bikeSeatTiltX || 0)
      : (config.character.seatBackTiltX || 0);
    const entryYaw = THREE.MathUtils.lerp(interaction.enteringStartYaw, entryTargetYaw, easedMoveProgress);
    const entryPitch = state.characterEnterTimer >= leanBackStartTime ? seatedPitchTarget : 0;
    setOnFootTransform(
      context.characterController,
      DOORWAY_POSITION,
      entryYaw,
      entryPitch
    );
    advanceCharacterAnimation(context.characterController, deltaSeconds, {
      consumeRootMotion: false,
      stabilizeVertical: true
    });
    if (state.characterEnterTimer >= openTime && !state.doorOpen) {
      state.doorOpen = true;
      ui.toggleDoor.textContent = 'Door: Open';
    }
    if (state.characterEnterTimer >= closeTime && state.doorOpen) {
      state.doorOpen = false;
      ui.toggleDoor.textContent = 'Door: Closed';
    }

    if (state.characterEnterTimer >= duration) {
      finishEnterVehicle(context);
    } else if (state.characterEnterTimer >= openTime) {
      setStatus('Getting in');
    }
  }

  function finishExitVehicle(context) {
    const interaction = ensureInteraction(context);
    state.characterVehicleState = 'on_foot';
    state.characterEnterTimer = 0;
    state.doorOpen = false;
    state.doorAngle = 0;
    if (state.doorRig?.pivot?.userData?.closedQuaternion) {
      state.doorRig.pivot.quaternion.copy(state.doorRig.pivot.userData.closedQuaternion);
    }
    ui.toggleDoor.textContent = 'Door: Closed';
    attachCharacterToWorld(context);
    setOnFootTransform(
      context.characterController,
      interaction.exitingTargetPosition,
      interaction.exitingTargetYaw
    );
    snapCharacterToGround(context, 2);
    if (resolveCharacterVehiclePenetration(context, { maxIterations: 5, extraPush: 0.08 })) {
      snapCharacterToGround(context, 2);
    }
    playCharacterAction(context.characterController, 'idle');
    advanceCharacterAnimation(context.characterController, 0, {
      consumeRootMotion: false,
      stabilizeVertical: true
    });
    syncOverlay(context);
    focusCurrentTarget(context, context.focusOptions);
    setStatus('On foot');
  }

  function updateExitingVehicle(context, deltaSeconds) {
    const interaction = ensureInteraction(context);
    state.characterEnterTimer += deltaSeconds;

    const duration = getCharacterActionDuration(context.characterController, 'exitCar');
    const openTime = THREE.MathUtils.clamp(
      config.character.exitDoorOpenDelaySeconds ?? Math.min(config.character.doorOpenLeadSeconds, duration * 0.35),
      0,
      Math.max(duration - 0.2, 0)
    );
    const moveEnd = Math.max(
      openTime + 0.15,
      duration - Math.max(config.character.exitMoveAdvanceSeconds || 0, 0)
    );
    const closeTime = THREE.MathUtils.clamp(
      duration - Math.max(config.character.exitDoorCloseAdvanceSeconds || 0, 0),
      openTime + 0.15,
      duration
    );

    if (state.characterEnterTimer >= openTime && state.characterEnterTimer < closeTime && !state.doorOpen) {
      state.doorOpen = true;
      ui.toggleDoor.textContent = 'Door: Open';
    }
    if (state.characterEnterTimer >= closeTime && state.doorOpen) {
      state.doorOpen = false;
      ui.toggleDoor.textContent = 'Door: Closed';
    }

    if (interaction.usesDoorwayLocator && state.characterEnterTimer >= openTime) {
      const moveProgress = THREE.MathUtils.clamp(
        (state.characterEnterTimer - openTime) / Math.max(moveEnd - openTime, 0.001),
        0,
        1
      );
      attachCharacterToWorld(context);
      DOORWAY_POSITION.copy(interaction.exitingStartPosition).lerp(
        interaction.exitingTargetPosition,
        moveProgress
      );
      setOnFootTransform(
        context.characterController,
        DOORWAY_POSITION,
        THREE.MathUtils.lerp(state.vehicleYaw, interaction.exitingTargetYaw, moveProgress)
      );
    } else {
      attachCharacterToVehicleSeat(context, { transition: true, exiting: true });
    }
    advanceCharacterAnimation(context.characterController, deltaSeconds, {
      consumeRootMotion: false,
      stabilizeVertical: true
    });

    if (state.characterEnterTimer >= duration) {
      finishExitVehicle(context);
    }
  }

  // --- Bike wipeout state ---
  const WIPEOUT_QUATERNION = new THREE.Quaternion();
  const WIPEOUT_EULER = new THREE.Euler();
  const wipeout = {
    timer: 0,
    phase: 'launch', // 'launch' | 'airborne' | 'slide' | 'getup'
    launchPosition: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    yaw: 0,
    groundY: 0,
    slideTimer: 0,
    getupTimer: 0,
    impactSpeed: 0,
    tumbleRateX: 0,
    tumbleRateY: 0,
    tumbleRateZ: 0,
    tumbleX: 0,
    tumbleY: 0,
    tumbleZ: 0
  };

  function beginBikeWipeout(context, trigger) {
    if (!context?.characterController) {
      return;
    }

    wipeout.impactSpeed = Math.abs(trigger.impactSpeed);
    wipeout.yaw = trigger.yaw;
    wipeout.timer = 0;
    wipeout.phase = 'launch';
    wipeout.slideTimer = 0;
    wipeout.getupTimer = 0;

    // Detach character from vehicle to world
    clearDriveInputs(context);
    applySnapshot(context, setDriveMode(context.gameRuntime, false));
    state.characterVehicleState = 'wipeout';
    attachCharacterToWorld(context);

    // Position character at the bike seat world position
    const seatPos = getResolvedSeatRootLocalPosition(context);
    if (seatPos) {
      const worldSeat = context.vehicleRoot.localToWorld(seatPos.clone());
      wipeout.launchPosition.copy(worldSeat);
    } else {
      wipeout.launchPosition.copy(state.vehiclePosition);
      wipeout.launchPosition.y += 1.0;
    }

    // Launch velocity: forward + upward arc (2x distance)
    const forwardX = Math.sin(wipeout.yaw);
    const forwardZ = Math.cos(wipeout.yaw);
    const launchSpeed = Math.min(wipeout.impactSpeed * 1.7, 40);
    wipeout.velocity.set(
      forwardX * launchSpeed,
      Math.min(launchSpeed * 0.55, 14),
      forwardZ * launchSpeed
    );

    // Random tumble rotation rates
    wipeout.tumbleRateX = (Math.random() - 0.3) * 8;
    wipeout.tumbleRateY = (Math.random() - 0.5) * 6;
    wipeout.tumbleRateZ = (Math.random() - 0.5) * 5;
    wipeout.tumbleX = 0;
    wipeout.tumbleY = 0;
    wipeout.tumbleZ = 0;

    // Sample ground at launch position
    const sampleGround = context.stage?.sampleGround;
    if (sampleGround) {
      const hit = sampleGround(wipeout.launchPosition.x, wipeout.launchPosition.z);
      wipeout.groundY = hit ? hit.height : 0;
    } else {
      wipeout.groundY = 0;
    }

    // Play falling animation
    playCharacterAction(context.characterController, 'fallingIdle');
    setOnFootTransform(context.characterController, wipeout.launchPosition, wipeout.yaw);
    setCharacterVisible(context.characterController, true);
    setStatus('Wipeout!');
  }

  function updateBikeWipeout(context, deltaSeconds) {
    if (!context?.characterController || state.characterVehicleState !== 'wipeout') {
      return;
    }

    const controller = context.characterController;
    const sampleGround = context.stage?.sampleGround;
    const dt = Math.min(deltaSeconds, 1 / 30);
    wipeout.timer += dt;

    if (wipeout.phase === 'launch' || wipeout.phase === 'airborne') {
      // Apply gravity
      wipeout.velocity.y -= 15 * dt;

      // Apply air drag
      wipeout.velocity.x *= (1 - 0.3 * dt);
      wipeout.velocity.z *= (1 - 0.3 * dt);

      // Integrate position
      wipeout.launchPosition.x += wipeout.velocity.x * dt;
      wipeout.launchPosition.y += wipeout.velocity.y * dt;
      wipeout.launchPosition.z += wipeout.velocity.z * dt;

      // Sample ground
      if (sampleGround) {
        const hit = sampleGround(wipeout.launchPosition.x, wipeout.launchPosition.z);
        if (hit) {
          wipeout.groundY = hit.height;
        }
      }

      // Transition from launch to airborne after a brief initial period
      if (wipeout.phase === 'launch' && wipeout.timer > 0.1) {
        wipeout.phase = 'airborne';
      }

      // Random tumble rotation
      wipeout.tumbleX += wipeout.tumbleRateX * dt;
      wipeout.tumbleY += wipeout.tumbleRateY * dt;
      wipeout.tumbleZ += wipeout.tumbleRateZ * dt;
      controller.position.copy(wipeout.launchPosition);
      WIPEOUT_EULER.set(wipeout.tumbleX, wipeout.yaw + wipeout.tumbleY, wipeout.tumbleZ, 'YXZ');
      WIPEOUT_QUATERNION.setFromEuler(WIPEOUT_EULER);
      controller.root.position.copy(wipeout.launchPosition);
      controller.root.quaternion.copy(WIPEOUT_QUATERNION);

      // Check ground contact
      if (wipeout.launchPosition.y <= wipeout.groundY && wipeout.velocity.y < 0) {
        wipeout.launchPosition.y = wipeout.groundY;
        wipeout.velocity.y = 0;
        wipeout.phase = 'slide';
        wipeout.slideTimer = 0;
        // Switch to falling idle (played on ground = sliding pose)
        playCharacterAction(context.characterController, 'fallingIdle');
      }
    }

    if (wipeout.phase === 'slide') {
      wipeout.slideTimer += dt;

      // Friction deceleration on ground
      const friction = 8;
      const hSpeed = Math.sqrt(wipeout.velocity.x ** 2 + wipeout.velocity.z ** 2);
      if (hSpeed > 0.1) {
        const decel = Math.min(friction * dt, hSpeed);
        const scale = (hSpeed - decel) / hSpeed;
        wipeout.velocity.x *= scale;
        wipeout.velocity.z *= scale;
      } else {
        wipeout.velocity.x = 0;
        wipeout.velocity.z = 0;
      }

      // Integrate position on ground
      wipeout.launchPosition.x += wipeout.velocity.x * dt;
      wipeout.launchPosition.z += wipeout.velocity.z * dt;

      // Stay on ground
      if (sampleGround) {
        const hit = sampleGround(wipeout.launchPosition.x, wipeout.launchPosition.z);
        if (hit) {
          wipeout.launchPosition.y = hit.height;
        }
      }

      // fallingIdle animation already has character face-down, just set position and yaw
      setOnFootTransform(controller, wipeout.launchPosition, wipeout.yaw);

      // After sliding stops, get up
      const slideEndTime = Math.max(0.4, hSpeed / friction);
      if (wipeout.slideTimer >= slideEndTime || hSpeed < 0.2) {
        wipeout.phase = 'getup';
        wipeout.getupTimer = 0;
        playCharacterAction(context.characterController, 'gettingUp');
        const getupAction = context.characterController.actions?.get('gettingUp');
        if (getupAction) {
          getupAction.setLoop(THREE.LoopOnce);
          getupAction.clampWhenFinished = true;
        }
        setOnFootTransform(controller, wipeout.launchPosition, wipeout.yaw);
        controller.yaw = wipeout.yaw;
      }
    }

    if (wipeout.phase === 'getup') {
      wipeout.getupTimer += dt;

      const getupDuration = getCharacterActionDuration(controller, 'gettingUp');
      if (wipeout.getupTimer >= getupDuration) {
        finishBikeWipeout(context);
        return;
      }

      // Hold position, just play the animation in place
      setOnFootTransform(controller, wipeout.launchPosition, wipeout.yaw);
    }

    advanceCharacterAnimation(controller, dt, {
      consumeRootMotion: false,
      stabilizeVertical: true
    });

    // Camera follows character during wipeout — pulled back to see the action
    const camForward = VEHICLE_FORWARD.set(Math.sin(wipeout.yaw), 0, Math.cos(wipeout.yaw));
    const camTarget = WORLD_POSITION.copy(wipeout.launchPosition);
    camTarget.y += 1.2;
    context.camera.far = 12000;
    context.camera.updateProjectionMatrix();
    context.controls.minDistance = 4;
    context.controls.maxDistance = 30;
    context.controls.maxPolarAngle = Math.PI * 0.48;
    context.controls.target.copy(camTarget);
    context.camera.position.copy(camTarget)
      .addScaledVector(camForward, -12)
      .setY(camTarget.y + 5);
    context.controls.update();
  }

  function finishBikeWipeout(context) {
    state.characterVehicleState = 'on_foot';
    wipeout.timer = 0;
    wipeout.phase = 'launch';
    playCharacterAction(context.characterController, 'idle');
    setOnFootTransform(
      context.characterController,
      wipeout.launchPosition,
      wipeout.yaw
    );
    snapCharacterToGround(context, 2);
    syncOverlay(context);
    focusCurrentTarget(context, context.focusOptions);
    setStatus('On foot');
  }

  function updateDrivingCharacter(context, deltaSeconds) {
    if (!context?.characterController || state.characterVehicleState !== 'driving') {
      return;
    }

    // Check for bike wipeout trigger
    if (state.activeVehicleKind === 'bike' && state.bikeWipeoutTrigger) {
      beginBikeWipeout(context, state.bikeWipeoutTrigger);
      state.bikeWipeoutTrigger = null;
      return;
    }

    computeVehicleInteractionPoints(context);
    attachCharacterToVehicleSeat(context);
    advanceCharacterAnimation(context.characterController, deltaSeconds, {
      consumeRootMotion: false,
      stabilizeVertical: true
    });
  }

  function updateFrame(context, deltaSeconds) {
    if (state.characterVehicleState === 'wipeout') {
      updateBikeWipeout(context, deltaSeconds);
      syncOverlay(context);
      return;
    }

    if (state.characterVehicleState === 'entering') {
      updateEnteringVehicle(context, deltaSeconds);
      syncOverlay(context);
      return;
    }

    if (state.characterVehicleState === 'exiting') {
      updateExitingVehicle(context, deltaSeconds);
      syncOverlay(context);
      return;
    }

    if (state.driveMode) {
      updateDrivingCharacter(context, deltaSeconds);
      syncOverlay(context);
      return;
    }

    if (!isCharacterActive(context)) {
      syncOverlay(context);
      return;
    }

    updateCharacterController(context.characterController, {
      deltaSeconds,
      config: config.character,
      camera: context.camera,
      input: state.characterInput,
      driveBounds: context.stage?.driveBounds,
      sampleGround: context.stage?.sampleGround,
      sampleCollision: context.playerSampleCollision || context.stage?.sampleCollision
    });
    if (resolveCharacterVehiclePenetration(context)) {
      snapCharacterToGround(context, 1);
    }
    updateCharacterCamera(
      context.camera,
      context.controls,
      context.characterController,
      config.character,
      deltaSeconds,
      state.cameraOverride || state.cameraDetached,
      state.selectedStageId
    );
    syncOverlay(context);
  }

  return {
    canEnterVehicle,
    clearCharacterInput,
    directExitVehicle,
    directMountVehicle,
    enterVehicle,
    exitVehicle,
    focusCurrentTarget,
    getActiveStagePosition,
    isCharacterActive,
    loadCharacterAssets,
    placeCharacterAtVehicle,
    syncOverlay,
    tryEnterVehicle,
    updateFrame
  };
}
