import * as THREE from 'three';
import { getBuiltInVehicleById } from '../assets/vehicle-registry.js';

export function createVehicleManager({
  config,
  state,
  ui,
  carVehicle,
  bikeVehicle,
  helpers,
  callbacks
}) {
  const {
    clearGroup,
    prepareRenderable,
    measureObjectBounds,
    collectWheelAnchors,
    createDoorRig,
    collectSteeringWheelRig,
    mountSteeringWheelAttachment,
    createFallbackCar
  } = helpers;
  const {
    remountTires,
    applySteeringWheelState,
    applySceneMaterialState,
    syncTextureEditorUi,
    applyGarageSnapshot,
    syncGarageScene,
    teleportGarageVehicle,
    setGarageVehicleKind,
    setChassisHeight,
    setSuspensionOverrides,
    setStatus,
    getPlayerSystem
  } = callbacks;
  const valkyrieManifest = getBuiltInVehicleById('valkyrie');
  const valkyriePreset = valkyrieManifest?.preset || null;
  const valkyrieSuspensionOverrides = valkyriePreset?.suspension || null;

  function cloneSuspensionOverrides(overrides) {
    return overrides ? { ...overrides } : null;
  }

  function clonePresetState() {
    return {
      tireScale: state.tireScale,
      frontAxleRatio: state.frontAxleRatio,
      rearAxleRatio: state.rearAxleRatio,
      rideHeight: state.rideHeight,
      wheelDropRatio: state.wheelDropRatio,
      chassisHeight: state.chassisHeight,
      sideInset: state.sideInset,
      tireRotation: [...state.tireRotation]
    };
  }

  function applyPresetState(preset) {
    if (!preset) {
      return;
    }
    state.tireScale = preset.tireScale;
    state.frontAxleRatio = preset.frontAxleRatio;
    state.rearAxleRatio = preset.rearAxleRatio;
    state.rideHeight = preset.rideHeight;
    state.wheelDropRatio = Number.isFinite(preset.wheelDropRatio) ? preset.wheelDropRatio : 0;
    state.chassisHeight = preset.chassisHeight;
    state.sideInset = preset.sideInset;
    state.tireRotation = [...preset.tireRotation];
  }

  function withTemporaryPreset(preset, task) {
    if (!preset) {
      return task();
    }
    const previous = clonePresetState();
    applyPresetState(preset);
    try {
      return task();
    } finally {
      applyPresetState(previous);
    }
  }

  function getProxyChassisHeight(kind) {
    if (kind === 'valkyrie' && Number.isFinite(valkyriePreset?.chassisHeight)) {
      return valkyriePreset.chassisHeight;
    }
    return state.chassisHeight;
  }

  function applyEffectiveSuspensionOverrides(runtime, overrides) {
    state.suspensionOverrides = cloneSuspensionOverrides(overrides);
    if (runtime) {
      applyGarageSnapshot(setSuspensionOverrides(runtime, state.suspensionOverrides));
    }
  }

  function mountCarAsset(carMount, wheelMount, rawAsset, options) {
    clearGroup(carMount);
    carMount.position.set(0, 0, 0);
    wheelMount.position.set(0, 0, 0);
    wheelMount.userData.physicsBaseLocalPosition = new THREE.Vector3(0, 0, 0);
    carMount.userData.vehicleKind = 'car';
    carMount.userData.chassisHeightMode = options.chassisHeightMode || 'body';
    carMount.userData.rootVisualOffsetY = Number(options.rootVisualOffsetY || 0);
    carMount.userData.wheelSpinDirection = 1;
    carMount.userData.steerDirection = -1;
    carMount.userData.bikeSteeringRig = null;
    state.doorRig = null;
    state.steeringWheelRig = null;
    state.doorOpen = false;
    state.doorAngle = 0;
    state.characterVehicleState = 'on_foot';
    state.characterEnterTimer = 0;
    ui.toggleDoor.textContent = 'Door: Closed';
    ui.toggleDoor.disabled = true;

    const display = carVehicle.mountAsset({ rawAsset });
    state.doorRig = display.doorRig;
    ui.toggleDoor.disabled = !state.doorRig;
    state.steeringWheelRig = display.steeringWheelRig;
    carMount.add(display.body);
    if (callbacks.getGameRuntime()) {
      applyGarageSnapshot(syncGarageScene(callbacks.getGameRuntime()));
    }
    state.carMetrics = display.metrics;
    state.carWheelAnchors = display.anchors;

    if (options.isFallback) {
      state.carAsset = null;
      state.carWheelAnchors = null;
      state.carTextureSlots = [];
      state.selectedCarTextureSlotId = '';
      ui.carName.textContent = state.carSource;
    } else {
      state.carAsset = rawAsset;
    }

    state.activeVehicleKind = 'car';
    if (callbacks.getGameRuntime()) {
      applyGarageSnapshot(setGarageVehicleKind(callbacks.getGameRuntime(), 'car'));
      applyGarageSnapshot(setChassisHeight(callbacks.getGameRuntime(), state.chassisHeight));
    }
    remountTires(wheelMount);
    applySteeringWheelState();
    syncTextureEditorUi();
  }

  function mountBikeAsset(carMount, wheelMount, rawAsset, rawWheelAsset) {
    clearGroup(carMount);
    clearGroup(wheelMount);
    carMount.position.set(0, config.bikeBodyOffsetY || 0, 0);
    wheelMount.position.set(0, config.bikeBodyOffsetY || 0, 0);
    // Keep the visual bike drop offset out of the physics wheel contact layout.
    wheelMount.userData.physicsBaseLocalPosition = new THREE.Vector3(0, 0, 0);
    carMount.userData.vehicleKind = 'bike';
    carMount.userData.wheelSpinDirection = 1;
    carMount.userData.steerDirection = 1;
    carMount.userData.bikeSteeringRig = null;
    state.doorRig = null;
    state.steeringWheelRig = null;
    state.doorOpen = false;
    state.doorAngle = 0;
    state.characterVehicleState = 'on_foot';
    state.characterEnterTimer = 0;
    ui.toggleDoor.textContent = 'Door: Closed';
    ui.toggleDoor.disabled = true;

    const display = bikeVehicle.mountAsset({ rawAsset, rawWheelAsset });
    const bikeWheels = [...display.wheels.children];
    for (const wheel of bikeWheels) {
      display.wheels.remove(wheel);
      const spinPivot = wheel?.children?.[0];
      if (spinPivot?.isObject3D) {
        spinPivot.userData.spinSign = 1;
      }
      wheelMount.add(wheel);
    }
    bikeVehicle.applyRuntimeWheelMetadata(wheelMount);
    carMount.add(display.body);
    carMount.userData.bikeSteeringRig = display.steeringRig || null;
    state.carMetrics = display.metrics;
    state.carWheelAnchors = display.anchors;
    state.activeVehicleKind = 'bike';
    if (callbacks.getGameRuntime()) {
      applyGarageSnapshot(setGarageVehicleKind(callbacks.getGameRuntime(), 'bike'));
    }
    applySceneMaterialState(carMount, wheelMount);
    syncTextureEditorUi();
  }

  function createBikeDisplay(rawAsset, rawWheelAsset) {
    const display = bikeVehicle.mountAsset({ rawAsset, rawWheelAsset });
    const bodyOffsetY = config.bikeBodyOffsetY || 0;
    display.body.position.y = bodyOffsetY;
    display.wheels.position.y = bodyOffsetY;
    return display;
  }

  function createVehicleProxy(kind, bodyGroup, wheelGroup, drivePosition, yaw, chassisHeight = state.chassisHeight) {
    const group = new THREE.Group();
    group.name = `${kind}-proxy`;
    const body = bodyGroup.clone(true);
    const wheels = wheelGroup.clone(true);
    group.add(body, wheels);
    group.position.copy(drivePosition).setY(drivePosition.y + chassisHeight);
    group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    group.traverse((child) => {
      if (!child.isMesh) {
        return;
      }
      child.castShadow = false;
      child.receiveShadow = false;
    });
    return { kind, group, body, wheels, yaw, drivePosition: drivePosition.clone() };
  }

  function placeOrReplaceVehicleProxy(context, kind, proxy) {
    const previous = state.parkedVehicleProxies[kind];
    if (previous?.group?.parent) {
      previous.group.parent.remove(previous.group);
    }
    state.parkedVehicleProxies[kind] = proxy;
    if (proxy) {
      context.auxVehicleMount.add(proxy.group);
    }
  }

  function createActiveVehicleProxy(context, kind) {
    return createVehicleProxy(
      kind,
      context.carMount,
      context.wheelMount,
      state.vehiclePosition.clone(),
      state.vehicleYaw,
      getProxyChassisHeight(kind)
    );
  }

  function syncParkedVehicleProxies(context) {
    clearGroup(context.auxVehicleMount);
    const existingCarProxy = state.parkedVehicleProxies.car;
    state.parkedVehicleProxies.car = existingCarProxy;
    state.parkedVehicleProxies.bike = null;
    state.parkedVehicleProxies.valkyrie = null;

    if (state.selectedStageId !== 'test_course' || !state.bikeAsset || !state.bikeWheelAsset) {
      return;
    }

    if (state.activeVehicleKind !== 'car' && existingCarProxy) {
      context.auxVehicleMount.add(existingCarProxy.group);
    }

    const bikeDisplay = createBikeDisplay(state.bikeAsset, state.bikeWheelAsset);
    const bikeProxy = createVehicleProxy(
      'bike',
      bikeDisplay.body,
      bikeDisplay.wheels,
      config.bikeSpawnPosition.clone(),
      config.bikeSpawnYaw
    );
    state.parkedVehicleProxies.bike = bikeProxy;
    if (state.activeVehicleKind !== 'bike') {
      context.auxVehicleMount.add(bikeProxy.group);
    }

    if (state.valkyrieAsset) {
      const valkyrieProxy = withTemporaryPreset(valkyriePreset, () => {
        const valkyrieDisplay = carVehicle.mountAsset({ rawAsset: state.valkyrieAsset });
        const tempWheelMount = new THREE.Group();
        carVehicle.remountWheels({
          wheelMount: tempWheelMount,
          activeTireAssets: state.valkyrieTireAsset
            ? { front: state.valkyrieTireAsset, rear: state.valkyrieTireAsset }
            : state.tireAssetsByAxle,
          carMetrics: valkyrieDisplay.metrics,
          carWheelAnchors: valkyrieDisplay.anchors
        });
        return createVehicleProxy(
          'valkyrie',
          valkyrieDisplay.body,
          tempWheelMount,
          config.valkyrieSpawnPosition.clone(),
          config.valkyrieSpawnYaw,
          getProxyChassisHeight('valkyrie')
        );
      });
      state.parkedVehicleProxies.valkyrie = valkyrieProxy;
      if (state.activeVehicleKind !== 'valkyrie') {
        context.auxVehicleMount.add(valkyrieProxy.group);
      }
    }
  }

  function getNearbyVehicleProxy(context) {
    if (!context.characterController || state.characterVehicleState !== 'on_foot') {
      return null;
    }

    let closest = null;
    let closestDistance = Infinity;
    for (const proxy of Object.values(state.parkedVehicleProxies)) {
      if (!proxy?.group?.parent) {
        continue;
      }
      const distance = context.characterController.position.distanceTo(proxy.group.position);
      if (distance < 1.5 && distance < closestDistance) {
        closest = proxy;
        closestDistance = distance;
      }
    }
    return closest;
  }

  function mountActiveVehicleFromState(context, kind) {
    if (kind === 'bike') {
      if (!state.bikeAsset || !state.bikeWheelAsset) {
        return false;
      }
      mountBikeAsset(context.carMount, context.wheelMount, state.bikeAsset, state.bikeWheelAsset);
      applyEffectiveSuspensionOverrides(callbacks.getGameRuntime(), null);
      return true;
    }

    if (kind === 'car') {
      if (state.carAsset) {
        mountCarAsset(context.carMount, context.wheelMount, state.carAsset, { isFallback: false });
      } else {
        mountCarAsset(context.carMount, context.wheelMount, createFallbackCar(), { isFallback: true });
      }
      applyEffectiveSuspensionOverrides(callbacks.getGameRuntime(), state.baseCarSuspensionOverrides);
      return true;
    }

    if (kind === 'valkyrie') {
      if (!state.valkyrieAsset) {
        return false;
      }

      const savedCarAsset = state.carAsset;
      const savedTireAssets = { ...state.tireAssetsByAxle };
      if (state.valkyrieTireAsset) {
        state.tireAssetsByAxle = { front: state.valkyrieTireAsset, rear: state.valkyrieTireAsset };
      }
      withTemporaryPreset(valkyriePreset, () => {
        mountCarAsset(context.carMount, context.wheelMount, state.valkyrieAsset, {
          isFallback: false,
          chassisHeightMode: 'root',
          rootVisualOffsetY: Number(valkyriePreset?.activeRootOffsetY || 0)
        });
      });
      state.tireAssetsByAxle = savedTireAssets;
      state.carAsset = savedCarAsset;
      state.activeVehicleKind = 'valkyrie';
      if (callbacks.getGameRuntime()) {
        applyGarageSnapshot(setGarageVehicleKind(callbacks.getGameRuntime(), 'car'));
      }
      applyEffectiveSuspensionOverrides(callbacks.getGameRuntime(), valkyrieSuspensionOverrides);
      return true;
    }

    return false;
  }

  function refreshWheelMountRuntimeState(wheelMount) {
    if (!wheelMount) {
      return;
    }

    for (const wheel of wheelMount.children) {
      if (!wheel?.isObject3D) {
        continue;
      }

      wheel.userData.baseQuaternion = wheel.quaternion.clone();
      wheel.userData.restPosition = wheel.position.clone();
      wheel.userData.restContactHeight = undefined;
      wheel.userData.suspensionOffset = 0;

      const spinPivot = wheel.children[0];
      if (spinPivot?.isObject3D) {
        const axis = spinPivot.userData.spinAxis || 'x';
        spinPivot.rotation.x = 0;
        spinPivot.rotation.y = 0;
        spinPivot.rotation.z = 0;
        spinPivot.rotation[axis] = 0;
      }
    }
  }

  function restoreActiveVehicleFromProxy(context, proxy) {
    clearGroup(context.carMount);
    clearGroup(context.wheelMount);
    state.doorRig = null;
    state.steeringWheelRig = null;
    state.doorOpen = false;
    state.doorAngle = 0;
    ui.toggleDoor.textContent = 'Door: Closed';

    const body = proxy.body.clone(true);
    const wheels = proxy.wheels.clone(true);
    context.carMount.add(body);
    context.wheelMount.add(wheels);
    prepareRenderable(body);
    prepareRenderable(wheels);
    refreshWheelMountRuntimeState(wheels);
    if (proxy.kind === 'bike') {
      bikeVehicle.applyRuntimeWheelMetadata(wheels);
    }
    state.carMetrics = measureObjectBounds(body);
    state.carWheelAnchors = proxy.kind === 'bike' ? bikeVehicle.collectWheelAnchors(body) : collectWheelAnchors(body);
    state.doorRig = proxy.kind === 'car' ? createDoorRig(body) : null;
    ui.toggleDoor.disabled = proxy.kind !== 'car' || !state.doorRig;
    state.steeringWheelRig = proxy.kind === 'car' ? collectSteeringWheelRig(body) || mountSteeringWheelAttachment(body) : null;
    state.activeVehicleKind = proxy.kind;
    context.carMount.userData.vehicleKind = proxy.kind;
    context.carMount.userData.wheelSpinDirection = 1;
    context.carMount.userData.steerDirection = proxy.kind === 'bike' ? 1 : -1;
    applySceneMaterialState(context.carMount, context.wheelMount);
    applySteeringWheelState();
  }

  function switchToVehicleProxy(context, proxy) {
    if (!proxy) {
      return false;
    }

    placeOrReplaceVehicleProxy(
      context,
      state.activeVehicleKind,
      createActiveVehicleProxy(context, state.activeVehicleKind)
    );

    if (proxy.group.parent) {
      proxy.group.parent.remove(proxy.group);
    }
    state.parkedVehicleProxies[proxy.kind] = null;

    if (!mountActiveVehicleFromState(context, proxy.kind)) {
      return false;
    }
    applyGarageSnapshot(teleportGarageVehicle(context.gameRuntime, proxy.drivePosition, proxy.yaw));
    const playerSystem = getPlayerSystem();
    if (proxy.kind === 'bike') {
      playerSystem.directMountVehicle(context);
      setStatus('Mounted motorcycle');
    } else if (proxy.kind === 'valkyrie') {
      playerSystem.directMountVehicle(context);
      setStatus('In Valkyrie');
    } else if (!playerSystem.tryEnterVehicle(context)) {
      setStatus('Move closer to the driver door to enter the car');
    }
    return true;
  }

  function canMountActiveBike(context) {
    return Boolean(
      context.characterController &&
        state.activeVehicleKind === 'bike' &&
        state.characterVehicleState === 'on_foot' &&
        context.characterController.position.distanceTo(state.vehiclePosition) < 1.5
    );
  }

  function tryMountNearbyVehicle(context) {
    const playerSystem = getPlayerSystem();
    if (canMountActiveBike(context)) {
      playerSystem.directMountVehicle(context);
      setStatus('Mounted motorcycle');
      return true;
    }

    const nearbyProxy = getNearbyVehicleProxy(context);
    if (nearbyProxy) {
      return switchToVehicleProxy(context, nearbyProxy);
    }

    return false;
  }

  function updateBikeWheelFit(context) {
    if (!state.bikeAsset || !state.bikeWheelAsset) {
      return;
    }

    const shouldRefreshActiveBike = state.activeVehicleKind === 'bike';
    if (shouldRefreshActiveBike) {
      mountBikeAsset(context.carMount, context.wheelMount, state.bikeAsset, state.bikeWheelAsset);
      if (context.gameRuntime) {
        applyGarageSnapshot(syncGarageScene(context.gameRuntime));
      }
    }

    syncParkedVehicleProxies(context);
  }

  return {
    mountCarAsset,
    mountBikeAsset,
    restoreActiveVehicleFromProxy,
    syncParkedVehicleProxies,
    tryMountNearbyVehicle,
    updateBikeWheelFit
  };
}
