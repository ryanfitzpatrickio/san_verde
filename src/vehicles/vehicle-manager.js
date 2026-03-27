import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getBuiltInVehicleById } from '../assets/vehicle-registry.js';
import { primeCarWheelRuntimeState } from './car-rig-helpers.js';
import { attachMountedCarRig, buildMountedCarRig, resolveActiveCarTireAssets } from './car-rig.js';

const SHARED_GLTF_LOADER = new GLTFLoader();

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
    createGenericVehicleHeadlightDecor,
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
    setEngineType,
    setChassisHeight,
    setSuspensionOverrides,
    setStatus,
    getPlayerSystem
  } = callbacks;
  let deferredActiveCarProxyTimer = null;
  let deferredActiveCarProxyIdleHandle = null;
  const valkyrieManifest = getBuiltInVehicleById('valkyrie');
  const valkyriePreset = valkyrieManifest?.preset || null;
  const valkyrieSuspensionOverrides = valkyriePreset?.suspension || null;
  const sendanManifest = getBuiltInVehicleById('sendan');
  const sendanPreset = sendanManifest?.preset || null;
  const sendanSuspensionOverrides = sendanPreset?.suspension || null;
  const dominatorManifest = getBuiltInVehicleById('dominator');
  const dominatorPreset = dominatorManifest?.preset || null;
  const dominatorSuspensionOverrides = dominatorPreset?.suspension || null;

  function getBodyVisualOffsetY(preset) {
    return Number.isFinite(preset?.bodyVisualOffsetY) ? preset.bodyVisualOffsetY : 0;
  }

  function cloneSuspensionOverrides(overrides) {
    return overrides ? { ...overrides } : null;
  }

  function cancelDeferredActiveCarProxyCapture() {
    if (deferredActiveCarProxyTimer !== null) {
      clearTimeout(deferredActiveCarProxyTimer);
      deferredActiveCarProxyTimer = null;
    }
    if (
      deferredActiveCarProxyIdleHandle !== null &&
      typeof window !== 'undefined' &&
      typeof window.cancelIdleCallback === 'function'
    ) {
      window.cancelIdleCallback(deferredActiveCarProxyIdleHandle);
      deferredActiveCarProxyIdleHandle = null;
    }
  }

  function scheduleDeferredActiveCarProxyCapture(context, sourceType = state.activeVehicleSource || 'garage') {
    cancelDeferredActiveCarProxyCapture();

    const capture = () => {
      deferredActiveCarProxyTimer = null;
      deferredActiveCarProxyIdleHandle = null;
      if (!context?.carMount || state.activeVehicleKind !== 'car') {
        return;
      }
      state.activeCarProxy = createActiveVehicleProxy(context, 'car');
      if (state.activeCarProxy) {
        state.activeCarProxy.sourceType = sourceType;
      }
    };

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      deferredActiveCarProxyIdleHandle = window.requestIdleCallback(capture);
      return;
    }

    deferredActiveCarProxyTimer = window.setTimeout(capture, 400);
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
      tireRotation: [...state.tireRotation],
      leftSideTireRotation: [...state.leftSideTireRotation],
      leftSideTireMirror: Boolean(state.leftSideTireMirror),
      rightSideTireRotation: [...state.rightSideTireRotation],
      rightSideTireMirror: Boolean(state.rightSideTireMirror)
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
    state.leftSideTireRotation = Array.isArray(preset.leftSideTireRotation) && preset.leftSideTireRotation.length === 3
      ? [...preset.leftSideTireRotation]
      : [0, 0, 0];
    state.leftSideTireMirror = Boolean(preset.leftSideTireMirror);
    state.rightSideTireRotation = Array.isArray(preset.rightSideTireRotation) && preset.rightSideTireRotation.length === 3
      ? [...preset.rightSideTireRotation]
      : [Math.PI, 0, 0];
    state.rightSideTireMirror = Boolean(preset.rightSideTireMirror);
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

  function getParkedWheelOffsetY(preset) {
    return Number.isFinite(preset?.parkedWheelOffsetY) ? preset.parkedWheelOffsetY : 0;
  }

  function applyEffectiveSuspensionOverrides(runtime, overrides) {
    state.suspensionOverrides = cloneSuspensionOverrides(overrides);
    if (runtime) {
      applyGarageSnapshot(setSuspensionOverrides(runtime, state.suspensionOverrides));
    }
  }

  function applyMountedTrafficVehiclePresentation(context, presentation) {
    cancelDeferredActiveCarProxyCapture();
    clearGroup(context.carMount);
    context.carMount.position.set(0, 0, 0);
    context.wheelMount.position.set(0, 0, 0);
    context.wheelMount.userData.physicsBaseLocalPosition = new THREE.Vector3(0, 0, 0);
    context.carMount.userData.vehicleKind = 'car';
    context.carMount.userData.chassisHeightMode = 'body';
    context.carMount.userData.rootVisualOffsetY = 0;
    context.carMount.userData.wheelSpinDirection = Number.isFinite(presentation.wheelSpinDirection)
      ? presentation.wheelSpinDirection
      : 1;
    context.carMount.userData.steerDirection = -1;
    context.carMount.userData.bikeSteeringRig = null;
    state.doorRig = presentation.doorRig || null;
    state.steeringWheelRig = presentation.steeringWheelRig || null;
    state.doorOpen = false;
    state.doorAngle = 0;
    state.characterVehicleState = 'on_foot';
    state.characterEnterTimer = 0;
    ui.toggleDoor.textContent = 'Door: Closed';
    ui.toggleDoor.disabled = !state.doorRig;

    attachMountedCarRig({
      carMount: context.carMount,
      wheelMount: context.wheelMount,
      clearGroup,
      presentation
    });
    state.carMetrics = presentation.metrics || measureObjectBounds(context.carMount);
    state.carWheelAnchors = presentation.anchors || collectWheelAnchors(context.carMount);
    state.carEmbeddedWheelAssets = presentation.embeddedWheels || null;
    state.wheelRadius = Number.isFinite(presentation.wheelRadius) ? presentation.wheelRadius : state.wheelRadius;
    state.activeVehicleSource = 'traffic';
    state.activeCarProxy = null;
    state.activeVehicleKind = 'car';
    applySceneMaterialState(context.carMount, context.wheelMount);
    applySteeringWheelState();
    syncTextureEditorUi();
  }

  function mountCarAsset(carMount, wheelMount, rawAsset, options) {
    cancelDeferredActiveCarProxyCapture();
    clearGroup(carMount);
    carMount.position.set(0, 0, 0);
    wheelMount.position.set(0, 0, 0);
    wheelMount.userData.physicsBaseLocalPosition = new THREE.Vector3(0, 0, 0);
    carMount.userData.vehicleKind = 'car';
    carMount.userData.chassisHeightMode = options.chassisHeightMode || 'body';
    carMount.userData.rootVisualOffsetY = Number(options.rootVisualOffsetY || 0);
    carMount.userData.wheelSpinDirection = Number.isFinite(options.wheelSpinDirection)
      ? options.wheelSpinDirection
      : 1;
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

    const presentation = buildMountedCarRig({
      carVehicle,
      rawAsset,
      activeTireAssets: resolveActiveCarTireAssets(state),
      stripEmbeddedWheels: Boolean(options.stripEmbeddedWheels),
      bodyVisualOffsetY: Number(options.bodyVisualOffsetY || 0)
    });
    state.doorRig = presentation.doorRig;
    ui.toggleDoor.disabled = !state.doorRig;
    state.steeringWheelRig = presentation.steeringWheelRig;
    attachMountedCarRig({ carMount, wheelMount, clearGroup, presentation });
    if (callbacks.getGameRuntime()) {
      applyGarageSnapshot(syncGarageScene(callbacks.getGameRuntime()));
    }
    state.carMetrics = presentation.metrics;
    state.carWheelAnchors = presentation.anchors;
    state.carEmbeddedWheelAssets = presentation.embeddedWheels || null;
    state.wheelRadius = presentation.wheelRadius;

    if (options.isFallback) {
      state.carAsset = null;
      state.carWheelAnchors = null;
      state.carEmbeddedWheelAssets = null;
      state.carTextureSlots = [];
      state.selectedCarTextureSlotId = '';
      ui.carName.textContent = state.carSource;
    } else {
      state.carAsset = rawAsset;
    }

    state.activeCarProxy = null;
    state.activeCarSuspensionOverrides = state.baseCarSuspensionOverrides;
    state.activeVehicleSource = 'garage';
    state.activeVehicleKind = 'car';
    if (callbacks.getGameRuntime()) {
      applyGarageSnapshot(setGarageVehicleKind(callbacks.getGameRuntime(), 'car'));
      applyGarageSnapshot(setChassisHeight(callbacks.getGameRuntime(), state.chassisHeight));
    }
    applySteeringWheelState();
    syncTextureEditorUi();
  }

  function mountBikeAsset(carMount, wheelMount, rawAsset, rawWheelAsset) {
    cancelDeferredActiveCarProxyCapture();
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
    state.activeCarProxy = null;
    state.activeVehicleSource = 'garage';
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

  function createVehicleProxy(
    kind,
    bodyGroup,
    wheelGroup,
    drivePosition,
    yaw,
    chassisHeight = state.chassisHeight,
    sourceType = 'garage'
  ) {
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
    const bodyMetrics = measureObjectBounds(body);
    const headlightDecor = createGenericVehicleHeadlightDecor(bodyMetrics, kind === 'bike' ? 'bike' : 'car');
    if (headlightDecor) {
      body.add(headlightDecor);
    }
    return {
      kind,
      sourceType,
      group,
      body,
      wheels,
      yaw,
      drivePosition: drivePosition.clone(),
      bodyMetrics
    };
  }

  function createMountedCarProxy(
    kind,
    presentation,
    drivePosition,
    yaw,
    {
      chassisHeight = state.chassisHeight,
      sourceType = 'garage',
      suspensionOffset = 0
    } = {}
  ) {
    const proxy = createVehicleProxy(
      kind,
      presentation.body,
      presentation.wheelMount,
      drivePosition,
      yaw,
      chassisHeight,
      sourceType
    );

    if (Number.isFinite(suspensionOffset) && suspensionOffset !== 0) {
      offsetProxyWheelsY(proxy, suspensionOffset);
    }

    return proxy;
  }

  function offsetProxyWheelsY(proxy, offsetY) {
    if (!proxy?.wheels || !Number.isFinite(offsetY) || offsetY === 0) {
      return proxy;
    }

    if (proxy.controller) {
      proxy.controller.applyPose({
        position: new THREE.Vector3(proxy.drivePosition.x, proxy.group.position.y, proxy.drivePosition.z),
        yaw: proxy.yaw,
        suspensionOffset: offsetY
      });
      return proxy;
    }

    for (const wheel of proxy.wheels.children) {
      if (!wheel?.isObject3D) {
        continue;
      }
      wheel.position.y += offsetY;
    }

    return proxy;
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
      getProxyChassisHeight(kind),
      state.activeVehicleSource || 'garage'
    );
  }

  function syncParkedVehicleProxies(context) {
    clearGroup(context.auxVehicleMount);
    const existingCarProxy = state.parkedVehicleProxies.car;
    state.parkedVehicleProxies.car = existingCarProxy;
    state.parkedVehicleProxies.bike = null;
    state.parkedVehicleProxies.valkyrie = null;
    state.parkedVehicleProxies.sendan = null;
    state.parkedVehicleProxies.dominator = null;

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
        const presentation = buildMountedCarRig({
          carVehicle,
          rawAsset: state.valkyrieAsset,
          activeTireAssets: state.valkyrieTireAsset
            ? { front: state.valkyrieTireAsset, rear: state.valkyrieTireAsset }
            : resolveActiveCarTireAssets(state),
          bodyVisualOffsetY: getBodyVisualOffsetY(valkyriePreset)
        });
        return offsetProxyWheelsY(
          createMountedCarProxy(
            'valkyrie',
            presentation,
            config.valkyrieSpawnPosition.clone(),
            config.valkyrieSpawnYaw,
            { chassisHeight: getProxyChassisHeight('valkyrie') }
          ),
          getParkedWheelOffsetY(valkyriePreset)
        );
      });
      state.parkedVehicleProxies.valkyrie = valkyrieProxy;
      if (state.activeVehicleKind !== 'valkyrie') {
        context.auxVehicleMount.add(valkyrieProxy.group);
      }
    }

    if (state.sendanAsset) {
      const sendanProxy = withTemporaryPreset(sendanPreset, () => {
        const presentation = buildMountedCarRig({
          carVehicle,
          rawAsset: state.sendanAsset,
          activeTireAssets: state.sendanTireAssets,
          stripEmbeddedWheels: true,
          bodyVisualOffsetY: getBodyVisualOffsetY(sendanPreset)
        });
        return offsetProxyWheelsY(
          createMountedCarProxy(
            'sendan',
            presentation,
            config.sendanSpawnPosition.clone(),
            config.sendanSpawnYaw
          ),
          getParkedWheelOffsetY(sendanPreset)
        );
      });
      state.parkedVehicleProxies.sendan = sendanProxy;
      if (state.activeVehicleKind !== 'sendan') {
        context.auxVehicleMount.add(sendanProxy.group);
      }
    }

    if (state.dominatorAsset) {
      const dominatorProxy = withTemporaryPreset(dominatorPreset, () => {
        const presentation = buildMountedCarRig({
          carVehicle,
          rawAsset: state.dominatorAsset,
          activeTireAssets: resolveActiveCarTireAssets(state),
          bodyVisualOffsetY: getBodyVisualOffsetY(dominatorPreset)
        });
        return offsetProxyWheelsY(
          createMountedCarProxy(
            'dominator',
            presentation,
            config.dominatorSpawnPosition.clone(),
            config.dominatorSpawnYaw
          ),
          getParkedWheelOffsetY(dominatorPreset)
        );
      });
      state.parkedVehicleProxies.dominator = dominatorProxy;
      if (state.activeVehicleKind !== 'dominator') {
        context.auxVehicleMount.add(dominatorProxy.group);
      }
    }
  }

  function getNearbyVehicleProxy(context) {
    return getNearbyVehicleProxyCandidate(context)?.proxy || null;
  }

  function getNearbyVehicleProxyCandidate(context) {
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
      const interactionDistance = getVehicleProxyInteractionDistance(proxy);
      if (distance < interactionDistance && distance < closestDistance) {
        closest = {
          proxy,
          distance,
          interactionDistance
        };
        closestDistance = distance;
      }
    }
    return closest;
  }

  function getVehicleProxyInteractionDistance(proxy) {
    const size = proxy?.bodyMetrics?.size;
    if (!size) {
      return 1.5;
    }

    const horizontalHalfSpan = Math.max(size.x, size.z) * 0.5;
    return Math.max(1.5, horizontalHalfSpan + 0.85);
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
      if (state.activeCarProxy) {
        restoreActiveVehicleFromProxy(context, state.activeCarProxy);
        applyEffectiveSuspensionOverrides(
          callbacks.getGameRuntime(),
          state.activeCarSuspensionOverrides ?? state.baseCarSuspensionOverrides
        );
        return true;
      }

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
          stripEmbeddedWheels: true,
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

    if (kind === 'sendan') {
      if (!state.sendanAsset) {
        return false;
      }

      const savedCarAsset = state.carAsset;
      const savedTireAssets = { ...state.tireAssetsByAxle };
      state.tireAssetsByAxle = {
        front: state.sendanTireAssets.front,
        rear: state.sendanTireAssets.rear
      };
      withTemporaryPreset(sendanPreset, () => {
        mountCarAsset(context.carMount, context.wheelMount, state.sendanAsset, {
          isFallback: false,
          stripEmbeddedWheels: true,
          bodyVisualOffsetY: getBodyVisualOffsetY(sendanPreset)
        });
      });
      state.tireAssetsByAxle = savedTireAssets;
      state.carAsset = savedCarAsset;
      state.activeVehicleKind = 'sendan';
      if (callbacks.getGameRuntime()) {
        applyGarageSnapshot(setGarageVehicleKind(callbacks.getGameRuntime(), 'car'));
      }
      applyEffectiveSuspensionOverrides(callbacks.getGameRuntime(), sendanSuspensionOverrides);
      return true;
    }

    if (kind === 'dominator') {
      if (!state.dominatorAsset) {
        return false;
      }

      const savedCarAsset = state.carAsset;
      withTemporaryPreset(dominatorPreset, () => {
        mountCarAsset(context.carMount, context.wheelMount, state.dominatorAsset, {
          isFallback: false,
          bodyVisualOffsetY: getBodyVisualOffsetY(dominatorPreset)
        });
      });
      state.carAsset = savedCarAsset;
      state.activeVehicleKind = 'dominator';
      if (callbacks.getGameRuntime()) {
        applyGarageSnapshot(setGarageVehicleKind(callbacks.getGameRuntime(), 'car'));
      }
      applyEffectiveSuspensionOverrides(callbacks.getGameRuntime(), dominatorSuspensionOverrides);
      return true;
    }

    return false;
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
    primeCarWheelRuntimeState(wheels);
    if (proxy.kind === 'bike') {
      bikeVehicle.applyRuntimeWheelMetadata(wheels);
    }
    state.carMetrics = measureObjectBounds(body);
    state.carWheelAnchors = proxy.kind === 'bike' ? bikeVehicle.collectWheelAnchors(body) : collectWheelAnchors(body);
    const isCarLikeProxy = proxy.kind === 'car' || proxy.kind === 'valkyrie' || proxy.kind === 'sendan' || proxy.kind === 'dominator';
    state.doorRig = isCarLikeProxy ? createDoorRig(body) : null;
    ui.toggleDoor.disabled = !isCarLikeProxy || !state.doorRig;
    state.steeringWheelRig = isCarLikeProxy ? collectSteeringWheelRig(body) || mountSteeringWheelAttachment(body) : null;
    state.activeVehicleKind = proxy.kind;
    state.activeVehicleSource = proxy.sourceType || 'garage';
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
    } else if (proxy.sourceType === 'traffic') {
      playerSystem.directMountVehicle(context);
      setStatus('Entered traffic vehicle');
    } else if (proxy.kind === 'valkyrie') {
      playerSystem.directMountVehicle(context);
      setStatus('In Valkyrie');
    } else if (proxy.kind === 'sendan') {
      if (!playerSystem.tryEnterVehicle(context)) {
        setStatus('Move closer to the driver door to enter the Sendan');
      }
    } else if (proxy.kind === 'dominator') {
      if (!playerSystem.tryEnterVehicle(context)) {
        setStatus('Move closer to the driver door to enter the Dominator');
      }
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

  function mountActiveBike(context) {
    if (!canMountActiveBike(context)) {
      return false;
    }

    const playerSystem = getPlayerSystem();
    playerSystem.directMountVehicle(context);
    setStatus('Mounted motorcycle');
    return true;
  }

  function findNearbyVehicleInteractionCandidate(context) {
    if (canMountActiveBike(context)) {
      return {
        type: 'bike',
        kind: 'bike',
        distance: context.characterController.position.distanceTo(state.vehiclePosition),
        execute: () => mountActiveBike(context)
      };
    }

    const proxyCandidate = getNearbyVehicleProxyCandidate(context);
    if (!proxyCandidate) {
      return null;
    }

    return {
      type: 'proxy',
      kind: proxyCandidate.proxy.kind,
      sourceType: proxyCandidate.proxy.sourceType || 'garage',
      distance: proxyCandidate.distance,
      interactionDistance: proxyCandidate.interactionDistance,
      execute: () => switchToVehicleProxy(context, proxyCandidate.proxy)
    };
  }

  function tryMountNearbyVehicle(context) {
    const candidate = findNearbyVehicleInteractionCandidate(context);
    return candidate ? candidate.execute() : false;
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

  async function mountStolenTrafficVehicle(context, trafficAgent) {
    if (!trafficAgent?.actor?.root) return null;

    // Resolve the vehicle manifest from the traffic agent's archetype
    const vehicleId = trafficAgent.actor.archetype?.presentation?.vehicleId
      || trafficAgent.actor.archetype?.vehicleId;
    const manifest = vehicleId ? getBuiltInVehicleById(vehicleId) : null;
    // Get position/yaw before removing the agent
    const pos = trafficAgent.lastPosition.clone();
    const yaw = trafficAgent.yaw || 0;

    // Park the current active vehicle as a proxy
    placeOrReplaceVehicleProxy(
      context,
      state.activeVehicleKind,
      createActiveVehicleProxy(context, state.activeVehicleKind)
    );

    const preset = manifest?.preset || {};
    const transferredPresentation = trafficAgent.actor.claimMountedRig?.();
    if (transferredPresentation?.body) {
      applyMountedTrafficVehiclePresentation(context, transferredPresentation);
    } else {
      const bodyUrl = manifest?.body?.url
        || trafficAgent.actor.archetype?.presentation?.modelUrl;
      if (!bodyUrl) return null;

      const gltf = await SHARED_GLTF_LOADER.loadAsync(bodyUrl);
      const rawAsset = gltf.scene || gltf.scenes?.[0];
      if (!rawAsset) return null;

      const frontTireUrl = manifest?.tires?.front?.url;
      const rearTireUrl = manifest?.tires?.rear?.url;
      let frontTire = null;
      let rearTire = null;
      if (frontTireUrl) {
        const tireGltf = await SHARED_GLTF_LOADER.loadAsync(frontTireUrl);
        frontTire = tireGltf.scene || tireGltf.scenes?.[0] || null;
      }
      if (rearTireUrl && rearTireUrl !== frontTireUrl) {
        const tireGltf = await SHARED_GLTF_LOADER.loadAsync(rearTireUrl);
        rearTire = tireGltf.scene || tireGltf.scenes?.[0] || null;
      }

      const savedPreset = clonePresetState();
      const savedTireAssets = { ...state.tireAssetsByAxle };
      if (frontTire || rearTire) {
        state.tireAssetsByAxle = {
          front: frontTire || state.tireAssetsByAxle.front,
          rear: rearTire || frontTire || state.tireAssetsByAxle.rear
        };
      }
      const savedCarAsset = state.carAsset;
      applyPresetState({
        ...savedPreset,
        ...preset,
        tireRotation: Array.isArray(preset.tireRotation) ? preset.tireRotation : savedPreset.tireRotation,
        leftSideTireRotation: Array.isArray(preset.leftSideTireRotation)
          ? preset.leftSideTireRotation
          : savedPreset.leftSideTireRotation,
        rightSideTireRotation: Array.isArray(preset.rightSideTireRotation)
          ? preset.rightSideTireRotation
          : savedPreset.rightSideTireRotation
      });

      mountCarAsset(context.carMount, context.wheelMount, rawAsset, {
        isFallback: false,
        stripEmbeddedWheels: Boolean(frontTire || rearTire),
        bodyVisualOffsetY: Number(preset.bodyVisualOffsetY || 0),
        wheelSpinDirection: Number.isFinite(preset.wheelSpinDirection) ? preset.wheelSpinDirection : 1
      });

      state.tireAssetsByAxle = savedTireAssets;
      state.carAsset = savedCarAsset;
      applyPresetState(savedPreset);
      state.activeVehicleKind = 'car';
    }

    // Teleport to the traffic vehicle's position
    const runtime = callbacks.getGameRuntime();
    if (callbacks.getGameRuntime()) {
      if (preset.engineId) {
        applyGarageSnapshot(setEngineType(runtime, preset.engineId));
      }
      const chassisHeight = Number.isFinite(preset.chassisHeight) ? preset.chassisHeight : state.chassisHeight;
      applyGarageSnapshot(setGarageVehicleKind(runtime, 'car'));
      applyGarageSnapshot(setChassisHeight(runtime, chassisHeight));
      applyGarageSnapshot(teleportGarageVehicle(runtime, pos, yaw));
    }

    // Apply suspension overrides from the manifest if present
    const suspensionOverrides = manifest?.preset?.suspension || null;
    applyEffectiveSuspensionOverrides(runtime, suspensionOverrides);
    state.activeCarProxy = null;
    state.activeCarSuspensionOverrides = cloneSuspensionOverrides(suspensionOverrides);
    state.trafficTakeoverBlockGraceSeconds = 1.5;
    scheduleDeferredActiveCarProxyCapture(context, 'traffic');

    return { position: pos, yaw };
  }

  return {
    findNearbyVehicleInteractionCandidate,
    mountCarAsset,
    mountBikeAsset,
    mountStolenTrafficVehicle,
    restoreActiveVehicleFromProxy,
    syncParkedVehicleProxies,
    tryMountNearbyVehicle,
    updateBikeWheelFit
  };
}
