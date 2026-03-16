import './style.css';
import { resolvePublicUrl } from './assets/asset-base-url.js';
import {
  setEngineName, setEngineGear, setEngineRpm, setVehicleSpeed,
  setUiOpen, setPerformanceOpen, setMinimapVisible, setMinimapLabel,
  minimapCanvasEl,
  setLoadPct, setLoadLabel, setLoadDone,
  setPerfFps, setPerfFrame, setPerfDraws, setPerfPeakDraws, setPerfRenderCalls,
  setPerfTriangles, setPerfPeakTriangles, setPerfGeometries, setPerfTextures, setPerfBreakdown,
} from './ui/hud-store.js';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mrt, normalView, output, pass, renderOutput } from 'three/tsl';
import { createGarageAssetLoader } from './assets/garage-asset-loader.js';
import { BUILT_IN_VEHICLES, getBuiltInVehicleById } from './assets/vehicle-registry.js';
import { EngineAudioSystem, ENGINE_LIBRARY } from './engine-system.js';
import { createNpcCrowdSystem } from './game/npc-crowd-system.js';
import { STAGE_OPTIONS, createStage, getStageLabel } from './game/stages.js';
import { createBounceStagePhysics, destroyBounceStagePhysics } from './game/bounce-physics.js';
import { disposeStageFeedback, initializeStageFeedback } from './game/stage-feedback.js';
import { createStageCollisionSampler, createStageGroundSampler } from './game/stage-sampler.js';
import {
  createGarageRuntime,
  ensureGarageAudioReady,
  refreshGarageStagePhysics,
  getGarageSnapshot,
  setCameraOverride,
  setCinematicCameraEnabled,
  setChassisHeight,
  setDriveInput,
  setDrivingStyle,
  setDriveMode,
  setAutopilotEnabled,
  setEngineType,
  setGarageStage,
  setGarageVehicleKind,
  setSuspensionOverrides,
  setWheelRadius,
  shiftEngineDown,
  shiftEngineNeutral,
  shiftEngineUp,
  snapGarageCamera,
  teleportGarageVehicle,
  syncGarageScene,
  updateGarageRuntime
} from './game/runtime.js';
import { createPlayerSystem } from './player-system.js';
import { MODEL_CONFIG, createAppShell, createInitialState } from './app-shell.js';
import { assetExists, createSceneHelpers } from './scene-helpers.js';
import { renderStageMinimap } from './ui/bloomville-minimap.js';
import { wireMainUi } from './ui/wire-main-ui.js';
import { CarVehicle } from './vehicles/car-vehicle.js';
import { BikeVehicle } from './vehicles/bike-vehicle.js';
import { createVehicleManager } from './vehicles/vehicle-manager.js';

const root = document.querySelector('#app');
// Keep UI markup and initial UI-backed state in app-shell.js.
// main.js is already too large; adding DOM/state shape here creates parallel
// boot paths and is the architectural drift we are actively removing.
const ui = createAppShell(root);
const state = createInitialState(ui);

const BIKE_DEBUG = false;
const PERF_CATEGORY_OTHER = 'other';
const RENDERER_MODE_WEBGL = 'webgl';
const RENDERER_MODE_WEBGPU = 'webgpu';

function getStageBehaviorId(stageId) {
  if (stageId === 'bloomville_glb') {
    return 'bloomville';
  }
  if (stageId === 'san_verde_glb') {
    return 'san_verde';
  }
  return stageId;
}

function logBike(event, payload) {
  if (!BIKE_DEBUG) {
    return;
  }
  console.log(`[bike] ${event} ${JSON.stringify(payload)}`);
}

function getRequestedRendererMode() {
  const params = new URLSearchParams(window.location.search);
  const rendererParam = params.get('renderer')?.trim().toLowerCase();
  const forceWebGLParam = params.get('forceWebGL')?.trim().toLowerCase();

  if (rendererParam === RENDERER_MODE_WEBGL || forceWebGLParam === '1' || forceWebGLParam === 'true') {
    return RENDERER_MODE_WEBGL;
  }

  if (rendererParam === RENDERER_MODE_WEBGPU) {
    return RENDERER_MODE_WEBGPU;
  }

  return RENDERER_MODE_WEBGPU;
}

function describeRendererBackend(renderer, requestedRendererMode) {
  if (renderer.backend?.isWebGLBackend === true) {
    return requestedRendererMode === RENDERER_MODE_WEBGL ? 'WebGL2 forced' : 'WebGL2 fallback';
  }

  if (renderer.backend?.isWebGPUBackend === true) {
    return 'WebGPU ready';
  }

  return 'Renderer ready';
}

function setPerfCategory(object, category) {
  if (!object) {
    return object;
  }

  object.userData = object.userData || {};
  object.userData.perfCategory = category;
  return object;
}

function createPerformanceAttributionTracker() {
  let drawCategories = Object.create(null);

  function resolveCategory(object) {
    let current = object;
    while (current) {
      const category = current.userData?.perfCategory;
      if (category) {
        return category;
      }
      current = current.parent ?? null;
    }
    return PERF_CATEGORY_OTHER;
  }

  function incrementCategory(category) {
    drawCategories[category] = (drawCategories[category] || 0) + 1;
  }

  return {
    resetFrame() {
      drawCategories = Object.create(null);
    },
    recordDraw(object) {
      incrementCategory(resolveCategory(object));
    },
    formatTopSummary(limit = 3) {
      const entries = Object.entries(drawCategories)
        .sort((left, right) => {
          if (right[1] !== left[1]) {
            return right[1] - left[1];
          }
          return left[0].localeCompare(right[0]);
        })
        .slice(0, limit);

      if (entries.length === 0) {
        return 'Top: n/a';
      }

      return `Top: ${entries
        .map(([category, draws]) => `${category} ${draws.toLocaleString()}`)
        .join(' | ')}`;
    }
  };
}

function instrumentRendererInfo(renderer, tracker) {
  const originalUpdate = renderer.info.update.bind(renderer.info);
  renderer.info.update = (object, count, instanceCount) => {
    tracker.recordDraw(object);
    originalUpdate(object, count, instanceCount);
  };
}

const carVehicle = new CarVehicle({
  config: MODEL_CONFIG,
  state,
  helpers: {
    clearGroup,
    normalizeToTargetSpan,
    prepareRenderable,
    measureObjectBounds,
    measureTireProfile,
    collectWheelAnchors,
    collectSteeringWheelRig,
    mountSteeringWheelAttachment,
    createDoorRig,
    createWheelSpinMarker,
    createFallbackMountedWheel,
    axisToRotationProperty
  }
});

const bikeVehicle = new BikeVehicle({
  config: MODEL_CONFIG,
  state,
  helpers: {
    THREE,
    normalizeToTargetSpan,
    prepareRenderable,
    measureObjectBounds,
    measureTireProfile,
    createWheelSpinMarker,
    axisToRotationProperty,
    findNamedObject,
    logBike
  }
});

const vehicleManager = createVehicleManager({
  config: MODEL_CONFIG,
  state,
  ui,
  carVehicle,
  bikeVehicle,
  helpers: {
    clearGroup,
    prepareRenderable,
    measureObjectBounds,
    collectWheelAnchors,
    createDoorRig,
    collectSteeringWheelRig,
    mountSteeringWheelAttachment,
    createFallbackCar
  },
  callbacks: {
    remountTires: (wheelMount) => remountTires(wheelMount),
    applySteeringWheelState: () => applySteeringWheelState(),
    applySceneMaterialState: (carMount, wheelMount) => applySceneMaterialState(carMount, wheelMount),
    syncTextureEditorUi: () => syncTextureEditorUi(),
    applyGarageSnapshot: (snapshot) => applyGarageSnapshot(snapshot),
    syncGarageScene: (runtime) => syncGarageScene(runtime),
    teleportGarageVehicle: (runtime, position, yaw) => teleportGarageVehicle(runtime, position, yaw),
    setGarageVehicleKind: (runtime, vehicleKind) => setGarageVehicleKind(runtime, vehicleKind),
    setChassisHeight: (runtime, chassisHeight) => setChassisHeight(runtime, chassisHeight),
    setSuspensionOverrides: (runtime, overrides) => setSuspensionOverrides(runtime, overrides),
    setStatus: (message) => setStatus(message),
    getGameRuntime: () => gameRuntime,
    getPlayerSystem: () => playerSystem
  }
});

const garageAssetLoader = createGarageAssetLoader({
  state,
  ui,
  config: MODEL_CONFIG,
  assetExists,
  vehicleManager,
  playerSystem: {
    placeCharacterAtVehicle: (...args) => playerSystem.placeCharacterAtVehicle(...args),
    focusCurrentTarget: (...args) => playerSystem.focusCurrentTarget(...args)
  },
  mountSteeringWheelAttachment,
  refreshCarTextureSlots,
  remountTires,
  applyBuiltInCarPreset,
  getSelectedBuiltInCar,
  applySceneMaterialState,
  setSuspensionOverrides,
  setStatus,
  setProgress
});

const engineAudio = new EngineAudioSystem(state.engineTypeId);
const agentSystem = createNpcCrowdSystem({
  config: MODEL_CONFIG,
  state
});
let gameRuntime = null;
let activeStage = null;
let appContext = null;
let playerSystem = null;
let activeStagePhysicsRevision = 0;

initializeBuiltInCarOptions();
initializeEngineOptions();
initializeDrivingStyleOptions();
initializeStageOptions();
applyEngineSnapshot(engineAudio.getSnapshot());
ui.toggleLap.textContent = `Drive mode: ${state.driveMode ? 'On' : 'Off'}`;
ui.toggleAutopilot.textContent = `Autopilot: ${state.autopilotEnabled ? 'On' : 'Off'}`;
ui.toggleCinematic.textContent = `Camera: ${state.cinematicCameraEnabled ? 'Cinematic' : 'Normal'}`;
ui.toggleNavDebug.textContent = `Nav Debug: ${state.navDebugVisible ? 'On' : 'Off'}`;
ui.toggleFog.textContent = `Fog: ${state.fogEnabled ? 'On' : 'Off'}`;
syncControlOutputs();
syncOverlayVisibility();

bootstrap().catch((error) => {
  console.error(error);
  setStatus('Renderer failed');
  ui.backend.textContent = 'Unavailable';
});

async function bootstrap() {
  const clock = new THREE.Timer();
  clock.connect(document);
  const requestedRendererMode = getRequestedRendererMode();
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    forceWebGL: requestedRendererMode === RENDERER_MODE_WEBGL
  });
  const performanceAttribution = createPerformanceAttributionTracker();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MODEL_CONFIG.renderPixelRatioCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = getEffectiveExposure();
  if ('useLegacyLights' in renderer) {
    renderer.useLegacyLights = false;
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  await renderer.init();
  if ('autoReset' in renderer.info) {
    renderer.info.autoReset = false;
  }
  instrumentRendererInfo(renderer, performanceAttribution);
  renderer.domElement.style.touchAction = 'none';
  ui.viewport.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#8fb6dc');
  scene.fog = new THREE.FogExp2('#90b3d5', 0.0065);
  scene.environmentIntensity = getEffectiveEnvironmentIntensity();

  const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 8000);
  camera.position.set(7.5, 2.4, 7.2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 3.4;
  controls.maxDistance = 24;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.enablePan = true;
  controls.target.set(0, 1.0, 0);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyRig = createSkyRig(pmrem, getStageSkyPreset(state.selectedStageId));
  setPerfCategory(skyRig.sky, 'sky');
  scene.add(skyRig.sky);
  scene.background = null;
  scene.environment = skyRig.environment.texture;
  scene.backgroundIntensity = 1;

  const loadingManager = new THREE.LoadingManager();
  const dracoLoader = new DRACOLoader(loadingManager);
  dracoLoader.setDecoderPath(resolvePublicUrl('/vendor/draco/'));

  const ktx2Loader = new KTX2Loader(loadingManager);
  ktx2Loader.setTranscoderPath(resolvePublicUrl('/vendor/basis/'));
  ktx2Loader.detectSupport(renderer);

  const gltfLoader = new GLTFLoader(loadingManager);
  gltfLoader.setDRACOLoader(dracoLoader);
  gltfLoader.setKTX2Loader(ktx2Loader);
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  const fbxLoader = new FBXLoader(loadingManager);

  const lightingRig = createLightingRig();
  const stageMount = new THREE.Group();
  const auxVehicleMount = new THREE.Group();
  const contactShadow = createVehicleContactShadow();
  const agentMount = agentSystem.agentRoot;
  const navigationDebugMount = agentSystem.debugRoot;
  setLoadScreen(2, 'Preparing world…');
  const stage = await createStage(state.selectedStageId, {
    disposeObjectTree,
    gltfLoader,
    loadingManager,
    onProgress: (pct, label) => setLoadScreen(pct, label),
  });
  setLoadScreen(90, 'Loading assets…');
  initializeStageSamplingAndPhysics(stage);
  applyStageShadowPolicy(stage);
  activeStage = stage;
  activeStagePhysicsRevision = stage.physicsRevision ?? 0;
  applyStageAtmosphere(scene, stage.id);
  stageMount.add(stage.group);
  const vehicleRoot = new THREE.Group();
  const carMount = new THREE.Group();
  const wheelMount = new THREE.Group();
  const characterMount = new THREE.Group();
  setPerfCategory(lightingRig, 'lights');
  setPerfCategory(stageMount, 'stage');
  setPerfCategory(auxVehicleMount, 'parked');
  setPerfCategory(contactShadow, 'contact shadow');
  setPerfCategory(agentMount, 'agents');
  setPerfCategory(navigationDebugMount, 'nav debug');
  setPerfCategory(vehicleRoot, 'vehicle');
  setPerfCategory(carMount, 'vehicle body');
  setPerfCategory(wheelMount, 'vehicle wheels');
  setPerfCategory(characterMount, 'character');
  vehicleRoot.add(carMount, wheelMount);
  scene.add(
    lightingRig,
    stageMount,
    auxVehicleMount,
    contactShadow,
    agentMount,
    navigationDebugMount,
    vehicleRoot,
    characterMount
  );

  loadingManager.onProgress = (_url, loaded, total) => {
    const ratio = total > 0 ? loaded / total : 0;
    setLoadScreen(Math.round(90 + ratio * 7), 'Loading assets…');
  };
  loadingManager.onLoad = () => {
    setLoadScreen(97, 'Loading character…');
  };

  vehicleManager.mountCarAsset(carMount, wheelMount, createFallbackCar(), { isFallback: true });
  applySceneMaterialState(carMount, wheelMount);
  ui.backend.textContent = describeRendererBackend(renderer, requestedRendererMode);
  ui.pipeline.textContent = 'Performance Forward';

  const renderPipeline = createRenderPipeline(renderer, scene, camera);
  const gltfExporter = new GLTFExporter();

  gameRuntime = createGarageRuntime({
    config: MODEL_CONFIG,
    stage,
    vehicleRoot,
    carMount,
    wheelMount,
    sampleGround: stage.sampleGround,
    sampleCollision: stage.sampleCollision,
    physics: stage.physics,
    camera,
    controls,
    engineAudio,
    initialState: state
  });
  applyGarageSnapshot(getGarageSnapshot(gameRuntime));

  const context = {
    renderer,
    scene,
    renderPipeline,
    gltfExporter,
    gameRuntime,
    stageMount,
    auxVehicleMount,
    camera,
    controls,
    lightingRig,
    pmrem,
    skyRig,
    gltfLoader,
    loadingManager,
    fbxLoader,
    carMount,
    wheelMount,
    characterMount,
    vehicleRoot,
    stage,
    agentSystem,
    characterController: null,
    applyGarageSnapshot,
    clearGroup,
    contactShadow,
    focusOptions: null
  };
  context.focusOptions = {
    focusVehicle: () => focusVehicle(camera, controls, vehicleRoot),
    focusStage: () => focusStage(camera, controls, stage, vehicleRoot),
    shouldUseStageOverview
  };
  syncStageRenderingMode(context);
  appContext = context;
  playerSystem = createPlayerSystem({
    state,
    ui,
    config: MODEL_CONFIG,
    setStatus,
    getStageLabel
  });
  playerSystem.focusCurrentTarget(context, context.focusOptions);
  playerSystem.syncOverlay(context);
  updateBloomvilleMinimapOverlay(context);

  wireMainUi({
    ui,
    state,
    context,
    vehicleManager,
    playerSystem,
    applyGarageSnapshot,
    setEngineType,
    setStageId: rebuildStage,
    setChassisHeight,
    setDriveInput,
    setDrivingStyle,
    setAutopilotEnabled,
    setCinematicCameraEnabled,
    applyStageAtmosphere,
    shiftEngineUp,
    shiftEngineDown,
    shiftEngineNeutral,
    snapGarageCamera,
    updateGarageRuntime,
    setCameraOverride,
    unlockEngineAudio,
    shouldUseStageOverview,
    syncOverlayVisibility,
    setStatus,
    toggleDoorState,
    loadSelectedBuiltInCar: garageAssetLoader.loadSelectedBuiltInCar,
    loadLocalAsset: garageAssetLoader.loadLocalAsset,
    applySceneMaterialState,
    updateWheelFit,
    usesSocketWheelAnchors,
    syncTextureEditorUi,
    getSelectedCarTextureSlot,
    textureToBlob,
    triggerDownload,
    slugifyFilename,
    stripFileExtension,
    applyUploadedTexture
  });

  await garageAssetLoader.loadDefaultAssets({
    gltfLoader,
    carMount,
    wheelMount,
    auxVehicleMount,
    vehicleRoot,
    camera,
    controls,
    renderer,
    gameRuntime
  });
  await playerSystem.loadCharacterAssets(context);
  agentSystem.syncStage(stage, playerSystem.getActiveStagePosition(context));

  setProgress(100);
  setLoadScreen(100, 'Ready');
  setTimeout(() => {
    setLoadDone(true);
  }, 400);

  if (state.driveMode) {
    applyGarageSnapshot(snapGarageCamera(gameRuntime));
    applyGarageSnapshot(updateGarageRuntime(gameRuntime, 0));
    setStatus(`${getStageLabel(state.selectedStageId)} ready`);
  } else {
    playerSystem.focusCurrentTarget(context, context.focusOptions);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MODEL_CONFIG.renderPixelRatioCap));
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    clock.update();
    const deltaSeconds = clock.getDelta();
    controls.autoRotate = !state.driveMode && state.autoRotate;
    controls.autoRotateSpeed = 0.55;
    updateOverviewPan(context.controls, context.camera, deltaSeconds);
    applyGarageSnapshot(updateGarageRuntime(gameRuntime, deltaSeconds));
    playerSystem.updateFrame(context, deltaSeconds);
    updateDoorAnimation(deltaSeconds);
    contextStageUpdate(context, activeStage, playerSystem.getActiveStagePosition(context));
    if ((activeStage?.physicsRevision ?? 0) !== activeStagePhysicsRevision) {
      refreshActiveStagePhysics(context);
    }
    agentSystem.update(activeStage, playerSystem.getActiveStagePosition(context), deltaSeconds);
    updateBloomvilleMinimapOverlay(context);
    updateKeyLightShadowFocus(context);
    updateVehicleContactShadow(context);
    renderer.info.reset();
    performanceAttribution.resetFrame();
    if (context.useSimpleForwardRender) {
      renderer.render(scene, camera);
    } else {
      renderPipeline.render();
    }
    updatePerformanceOverlay(renderer, deltaSeconds, performanceAttribution);
  });
}

async function rebuildStage(context, stageId) {
  setLoadDone(false);
  setLoadScreen(2, 'Preparing world…');
  destroyStageResources(activeStage);
  const stage = await createStage(stageId, {
    disposeObjectTree,
    gltfLoader: context.gltfLoader,
    loadingManager: context.loadingManager,
    onProgress: (pct, label) => setLoadScreen(pct, label),
  });
  initializeStageSamplingAndPhysics(stage);
  applyStageShadowPolicy(stage);
  activeStage = stage;
  activeStagePhysicsRevision = stage.physicsRevision ?? 0;
  applyStageAtmosphere(context.scene, stage.id);
  clearGroup(context.stageMount, { dispose: true });
  context.stageMount.add(stage.group);
  context.stage = stage;
  context.focusOptions = {
    focusVehicle: () => focusVehicle(context.camera, context.controls, context.vehicleRoot),
    focusStage: () => focusStage(context.camera, context.controls, stage, context.vehicleRoot),
    shouldUseStageOverview
  };
  syncStageRenderingMode(context);
  applyGarageSnapshot(setDriveMode(context.gameRuntime, false));
  applyGarageSnapshot(setGarageStage(context.gameRuntime, stage));
  vehicleManager.syncParkedVehicleProxies(context);
  if (context.characterController && !state.driveMode) {
    playerSystem.directExitVehicle(context);
  }
  contextStageUpdate(context, stage, playerSystem.getActiveStagePosition(context));
  if ((activeStage?.physicsRevision ?? 0) !== activeStagePhysicsRevision) {
    refreshActiveStagePhysics(context);
  }
  updateBloomvilleMinimapOverlay(context);
  agentSystem.syncStage(stage, playerSystem.getActiveStagePosition(context));

  await context.renderer.compileAsync(context.scene, context.camera);
  setLoadScreen(100, 'Ready');
  setTimeout(() => setLoadDone(true), 400);

  if (state.driveMode) {
    applyGarageSnapshot(snapGarageCamera(context.gameRuntime));
    applyGarageSnapshot(updateGarageRuntime(context.gameRuntime, 0));
    setStatus(`${getStageLabel(stageId)} ready`);
    return;
  }

  playerSystem.focusCurrentTarget(context, context.focusOptions);
  setStatus(`${getStageLabel(stageId)} loaded`);
}

let portalTransitionPending = false;

function contextStageUpdate(ctx, stage, followPosition) {
  const action = stage?.update?.(followPosition);
  if (action?.type === 'portal' && !portalTransitionPending) {
    portalTransitionPending = true;
    state.selectedStageId = action.destination;
    ui.stageType.value = action.destination;
    rebuildStage(ctx, action.destination).finally(() => {
      portalTransitionPending = false;
    });
  }
}

function initializeStageSamplingAndPhysics(stage) {
  if (!stage?.group) {
    return stage;
  }

  const collisionRoot = stage.collisionGroup || stage.group;
  initializeStageFeedback(stage, MODEL_CONFIG);
  stage.sampleGround = stage.sampleGround || createStageGroundSampler(collisionRoot, {
    rayStart: MODEL_CONFIG.suspension.sampleRayStart,
    rayDistance: MODEL_CONFIG.suspension.sampleRayDistance,
    minNormalY: MODEL_CONFIG.suspension.supportMinNormalY
  });
  stage.sampleCollision = stage.sampleCollision || createStageCollisionSampler(collisionRoot);
  stage.physics = createBounceStagePhysics(
    stage,
    MODEL_CONFIG,
    state.activeVehicleKind,
    engineAudio.getDefinition().physics.massKg
  );
  return stage;
}

function destroyStagePhysics(stage) {
  if (!stage?.physics) {
    return;
  }

  destroyBounceStagePhysics(stage.physics);
  stage.physics = null;
}

function destroyStageResources(stage) {
  destroyStagePhysics(stage);
  disposeStageFeedback(stage);
}

function refreshActiveStagePhysics(context) {
  if (!activeStage) {
    return;
  }

  destroyStagePhysics(activeStage);
  activeStage.physics = createBounceStagePhysics(
    activeStage,
    MODEL_CONFIG,
    state.activeVehicleKind,
    engineAudio.getDefinition().physics.massKg
  );
  activeStagePhysicsRevision = activeStage.physicsRevision ?? 0;
  applyGarageSnapshot(refreshGarageStagePhysics(context.gameRuntime, activeStage));
}

function initializeBuiltInCarOptions() {
  ui.builtInCar.innerHTML = `
    <option value="" disabled>Uploaded car</option>
    ${BUILT_IN_VEHICLES
      .map(({ id, label }) => `<option value="${id}">${label}</option>`)
      .join('')}
  `;
  ui.builtInCar.value = state.selectedBuiltInCarId;
}

function initializeEngineOptions() {
  ui.engineType.innerHTML = ENGINE_LIBRARY.map(
    ({ id, label, description }) => `<option value="${id}">${label} · ${description}</option>`
  ).join('');
  ui.engineType.value = state.engineTypeId;
}

function initializeStageOptions() {
  ui.stageType.innerHTML = STAGE_OPTIONS
    .map(({ id, label }) => `<option value="${id}">${label}</option>`)
    .join('');
  ui.stageType.value = state.selectedStageId;
}

function initializeDrivingStyleOptions() {
  ui.driveStyle.innerHTML = Object.values(MODEL_CONFIG.drivingStyles)
    .map((style) => `<option value="${style.id}">${style.label}</option>`)
    .join('');
  ui.driveStyle.value = state.drivingStyle;
  ui.driveStyleDescription.textContent =
    MODEL_CONFIG.drivingStyles[state.drivingStyle]?.description || '';
}

function getSelectedBuiltInCar() {
  return getBuiltInVehicleById(state.selectedBuiltInCarId);
}

function cloneSuspensionOverrides(overrides) {
  return overrides ? { ...overrides } : null;
}

function applyBuiltInCarPreset(preset, context) {
  if (!preset) {
    return;
  }

  state.exposure = preset.exposure;
  state.environmentIntensity = preset.environmentIntensity;
  state.tireScale = preset.tireScale;
  state.frontAxleRatio = preset.frontAxleRatio;
  state.rearAxleRatio = preset.rearAxleRatio;
  state.rideHeight = preset.rideHeight;
  state.chassisHeight = preset.chassisHeight;
  state.sideInset = preset.sideInset;
  state.tireRotation = [...preset.tireRotation];
  state.baseCarSuspensionOverrides = cloneSuspensionOverrides(preset.suspension);
  state.suspensionOverrides = cloneSuspensionOverrides(preset.suspension);

  ui.exposure.value = String(state.exposure);
  ui.environment.value = String(state.environmentIntensity);
  ui.tireScale.value = String(state.tireScale);
  ui.frontAxle.value = String(state.frontAxleRatio);
  ui.rearAxle.value = String(state.rearAxleRatio);
  ui.rideHeight.value = String(state.rideHeight);
  ui.chassisHeight.value = String(state.chassisHeight);
  ui.sideInset.value = String(state.sideInset);
  ui.rotateX.value = String(state.tireRotation[0]);
  ui.rotateY.value = String(state.tireRotation[1]);
  ui.rotateZ.value = String(state.tireRotation[2]);

  context.renderer.toneMappingExposure = getEffectiveExposure();
  if (context.gameRuntime) {
    applyGarageSnapshot(setChassisHeight(context.gameRuntime, state.chassisHeight));
    applyGarageSnapshot(setSuspensionOverrides(context.gameRuntime, state.suspensionOverrides));
  }
  syncControlOutputs();
  updateWheelFit(context);
}

function mountSteeringWheelAttachment(rootObject) {
  if (!rootObject || !state.steeringWheelAsset) {
    return null;
  }

  const steeringLocator =
    rootObject.getObjectByName('Locator_Steering') ||
    findNamedObject(rootObject, /^locator[_ ]steering$/i) ||
    findNamedObject(rootObject, /locator.*steering|steering.*locator/i);
  const embeddedWheel =
    rootObject.getObjectByName('steering_wheel') ||
    findNamedObject(rootObject, /^steering[_ ]wheel$/i) ||
    findNamedObject(rootObject, /steering[_ ]wheel|wheel.*steering/i);

  if (!steeringLocator || embeddedWheel) {
    return null;
  }

  const wheel = state.steeringWheelAsset.clone(true);
  wheel.name = 'steering-wheel-attachment';
  const wheelMetrics = measureObjectBounds(wheel);
  if (wheelMetrics) {
    wheel.position.sub(wheelMetrics.center);
  } else {
    wheel.position.set(0, 0, 0);
  }
  wheel.quaternion.setFromEuler(
    new THREE.Euler(...MODEL_CONFIG.steeringWheelRotation)
  );
  steeringLocator.updateWorldMatrix(true, false);
  const parentWorldScale = steeringLocator.getWorldScale(new THREE.Vector3());
  const parentScale = Math.max(parentWorldScale.x, parentWorldScale.y, parentWorldScale.z, 1e-6);
  const rawDiameter = wheelMetrics
    ? Math.max(wheelMetrics.size.x, wheelMetrics.size.y)
    : 1;
  const localScale = MODEL_CONFIG.steeringWheelDiameter / rawDiameter / parentScale;
  wheel.scale.setScalar(localScale);
  prepareRenderable(wheel);
  steeringLocator.add(wheel);
  return createSteeringWheelRig(wheel);
}

function collectSteeringWheelRig(rootObject) {
  const steeringWheel =
    rootObject.getObjectByName('steering_wheel') ||
    findNamedObject(rootObject, /^steering[_ ]wheel$/i) ||
    findNamedObject(rootObject, /steering[_ ]wheel|wheel.*steering/i);

  if (!steeringWheel) {
    return null;
  }

  return createSteeringWheelRig(steeringWheel);
}

function createSteeringWheelRig(object) {
  const axis = inferObjectLocalThinAxis(object);
  return {
    object,
    baseQuaternion: object.quaternion.clone(),
    turnAxis: axisToVector(axis)
  };
}

function applySteeringWheelState() {
  if (!state.steeringWheelRig?.object) {
    return;
  }

  const rig = state.steeringWheelRig;
  const turnQuaternion = new THREE.Quaternion().setFromAxisAngle(
    rig.turnAxis,
    state.steerAngle * MODEL_CONFIG.steeringWheelTurnRatio
  );
  rig.object.quaternion.copy(rig.baseQuaternion).multiply(turnQuaternion);
}

function remountTires(wheelMount) {
  state.wheelRadius = carVehicle.remountWheels({
    wheelMount,
    activeTireAssets: getActiveTireAssets(),
    carMetrics: state.carMetrics,
    carWheelAnchors: state.carWheelAnchors
  });

  if (gameRuntime) {
    applyGarageSnapshot(setWheelRadius(gameRuntime, state.wheelRadius));
  }
}

function normalizeToTargetSpan(object, targetSpan) {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);

  if (bounds.isEmpty()) {
    return;
  }

  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const horizontalSpan = Math.max(size.x, size.z);
  const scale = horizontalSpan > 0 ? targetSpan / horizontalSpan : 1;

  object.position.sub(center);
  object.scale.multiplyScalar(scale);
  object.updateMatrixWorld(true);

  const fittedBounds = new THREE.Box3().setFromObject(object);
  object.position.y -= fittedBounds.min.y;
}

function measureObjectBounds(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);

  if (box.isEmpty()) {
    return null;
  }

  return {
    box,
    size: box.getSize(new THREE.Vector3()),
    center: box.getCenter(new THREE.Vector3()),
    min: box.min.clone(),
    max: box.max.clone()
  };
}

function measureTireProfile(rootObject) {
  const metrics = measureObjectBounds(rootObject);
  if (!metrics) {
    return null;
  }

  const axisSizes = [metrics.size.x, metrics.size.y, metrics.size.z];
  const widthAxis = axisSizes.indexOf(Math.min(...axisSizes));
  const diameterAxes = [0, 1, 2].filter((axis) => axis !== widthAxis);
  const diameter = Math.max(axisSizes[diameterAxes[0]], axisSizes[diameterAxes[1]]);
  const width = axisSizes[widthAxis];

  const alignment = new THREE.Quaternion().setFromUnitVectors(
    axisToVector(widthAxis),
    new THREE.Vector3(1, 0, 0)
  );

  return {
    center: metrics.center,
    socketPosition: collectTireSocketPosition(rootObject) || metrics.center,
    diameter,
    width,
    widthAxis,
    alignment
  };
}

function createFallbackMountedWheel(scale, anchor) {
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.34, 40, 1),
    new THREE.MeshStandardMaterial({
      color: '#111317',
      roughness: 0.84,
      metalness: 0.06
    })
  );
  tire.rotation.z = Math.PI / 2;

  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.24, 0.36, 28, 1),
    new THREE.MeshStandardMaterial({
      color: '#a9b4c4',
      roughness: 0.36,
      metalness: 0.78
    })
  );
  rim.rotation.z = Math.PI / 2;

  const spinPivot = new THREE.Group();
  spinPivot.name = `${anchor.name}-spin`;
  spinPivot.userData.spinAxis = 'x';
  spinPivot.add(tire, rim);
  spinPivot.add(createWheelSpinMarker(0.42, 0.34));

  const wheel = new THREE.Group();
  wheel.add(spinPivot);
  wheel.scale.setScalar(scale);
  wheel.userData.baseQuaternion = wheel.quaternion.clone();
  wheel.userData.canSteer = anchor.name.includes('front');
  wheel.userData.steerSign = anchor.name.includes('right') ? -1 : 1;
  spinPivot.userData.spinSign = anchor.name.includes('left') ? -1 : 1;

  return wheel;
}

function createWheelSpinMarker(radius, width) {
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(
      Math.max(width * 0.2, 0.035),
      Math.max(radius * 0.32, 0.08),
      Math.max(width * 0.08, 0.02)
    ),
    new THREE.MeshStandardMaterial({
      color: '#ff5a36',
      emissive: '#ff5a36',
      emissiveIntensity: 1.4,
      roughness: 0.38,
      metalness: 0.12
    })
  );
  marker.position.set(0, radius * 0.72, 0);
  marker.castShadow = false;
  marker.receiveShadow = false;
  return marker;
}

function collectWheelAnchors(rootObject) {
  const anchors = new Map();

  rootObject.updateMatrixWorld(true);
  rootObject.traverse((child) => {
    if (child === rootObject || !child.name) {
      return;
    }

    const key = normalizeWheelAnchorName(child.name);
    if (!key || anchors.has(key)) {
      return;
    }

    const position = child.getWorldPosition(new THREE.Vector3());
    anchors.set(key, rootObject.worldToLocal(position));
  });

  const orderedKeys = ['front-left', 'front-right', 'rear-left', 'rear-right'];
  if (!orderedKeys.every((key) => anchors.has(key))) {
    return null;
  }

  return orderedKeys.map((key) => ({
    name: key,
    position: anchors.get(key).toArray()
  }));
}

function normalizeWheelAnchorName(name) {
  const lower = name.toLowerCase();
  const isFront = /front|frt/.test(lower);
  const isRear = /rear|back|rr/.test(lower);
  const isLeft = /left|_l\\b|\\.l\\b|-l\\b/.test(lower);
  const isRight = /right|_r\\b|\\.r\\b|-r\\b/.test(lower);

  if ((isFront || isRear) && (isLeft || isRight)) {
    return `${isFront ? 'front' : 'rear'}-${isLeft ? 'left' : 'right'}`;
  }

  return null;
}

function collectTireSocketPosition(rootObject) {
  let socket = null;

  rootObject.traverse((child) => {
    if (!socket && child.name && /socket/i.test(child.name)) {
      socket = child.position.clone();
    }
  });

  return socket;
}

function getActiveTireAssets() {
  return {
    front: state.tireAssetsByAxle.front || state.tireAsset,
    rear: state.tireAssetsByAxle.rear || state.tireAsset
  };
}

function createDoorRig(rootObject) {
  rootObject.updateMatrixWorld(true);
  const hinge =
    rootObject.getObjectByName('Locator_Door_Hinge') ||
    findNamedObject(rootObject, /locator.*door.*hinge|door.*hinge|hinge.*door/i);
  const door = findDoorObject(rootObject);
  const driverWindow = findNamedObject(rootObject, /window.*driver|driver.*window/i);

  if (!hinge || !door || !door.parent) {
    return null;
  }

  const originalParent = door.parent;
  const pivot = new THREE.Group();
  pivot.name = 'door-hinge-pivot';
  pivot.position.copy(originalParent.worldToLocal(hinge.getWorldPosition(new THREE.Vector3())));
  originalParent.add(pivot);
  pivot.updateMatrixWorld(true);
  pivot.attach(door);
  if (driverWindow) {
    pivot.attach(driverWindow);
  }
  pivot.userData.closedQuaternion = pivot.quaternion.clone();

  const hingeWorld = hinge.getWorldPosition(new THREE.Vector3());
  const doorWorldCenter = door.getWorldPosition(new THREE.Vector3());
  const openDirection = doorWorldCenter.x < hingeWorld.x ? -1 : 1;

  return {
    pivot,
    openDirection,
    maxAngle: Math.PI * 0.5
  };
}

function findDoorObject(rootObject) {
  let match = null;

  rootObject.traverse((child) => {
    if (match || !child.name) {
      return;
    }

    if ((child.isMesh || child.children.length > 0) && /(driver.*door|door.*driver|^door$)/i.test(child.name)) {
      match = child;
    }
  });

  return match;
}

function findNamedObject(rootObject, pattern) {
  let match = null;

  rootObject.traverse((child) => {
    if (!match && child.name && pattern.test(child.name)) {
      match = child;
    }
  });

  return match;
}

function shouldCastVehicleShadow(mesh) {
  const name = String(mesh.name || '').toLowerCase();
  if (
    /window|windshield|glass|interior|seat|steering|mirror|locator|tire|wheel|rim|socket|driver/i.test(name)
  ) {
    return false;
  }

  if (!/(chasis|chassis|body|door|hood|roof|quarter|fender|bumper|front|back|panel|shell|node_0012)/i.test(name)) {
    return false;
  }

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    if (!material) {
      continue;
    }
    if (material.transparent || material.opacity < 0.99) {
      return false;
    }
    if ('transmission' in material && material.transmission > 0.01) {
      return false;
    }
  }

  return true;
}

function prepareRenderable(rootObject) {
  rootObject.traverse((child) => {
    if (!child.isMesh) {
      return;
    }

    if (isWindowMesh(child) && !child.userData.windowGlassPrepared) {
      child.material = cloneMaterialSet(child.material);
      child.userData.windowGlassPrepared = true;
    }

    child.castShadow = shouldCastVehicleShadow(child);
    child.receiveShadow = !isWindowMesh(child);

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) {
        continue;
      }

      if ('envMapIntensity' in material) {
        material.envMapIntensity = getEffectiveEnvironmentIntensity();
      }

      if ('roughness' in material && material.roughness < 0.03) {
        material.roughness = 0.03;
      }

      if ('clearcoat' in material && material.clearcoat < 0.2) {
        material.clearcoat = 0.2;
      }

      if (isWindowMesh(child)) {
        applyWindowMaterialState(material, child);
      }

      material.needsUpdate = true;
    }
  });
}

function updateKeyLightShadowFocus(context) {
  const lights = context?.lightingRig?.userData?.lights;
  const key = lights?.key;
  if (!key?.shadow?.camera) {
    return;
  }

  const focusTarget = playerSystem?.getActiveStagePosition?.(context) || state.vehiclePosition;
  if (!focusTarget) {
    return;
  }

  const focusX = focusTarget.x;
  const focusZ = focusTarget.z;
  const followOffset = key.userData?.followOffset;
  if (followOffset) {
    key.position.set(focusX + followOffset.x, followOffset.y, focusZ + followOffset.z);
  }
  key.target.position.set(focusX, 0.4, focusZ);
  const shadowCamera = key.shadow.camera;
  const behaviorStageId = getStageBehaviorId(state.selectedStageId);
  const extent = behaviorStageId === 'test_course' || behaviorStageId === 'san_verde' ? 18 : 26;
  shadowCamera.left = -extent;
  shadowCamera.right = extent;
  shadowCamera.top = extent;
  shadowCamera.bottom = -extent;
  shadowCamera.near = 1;
  shadowCamera.far = behaviorStageId === 'test_course' || behaviorStageId === 'san_verde' ? 70 : 110;
  shadowCamera.updateProjectionMatrix();
}

function shouldUseCheapDirectionalShadows(stageId) {
  stageId = getStageBehaviorId(stageId);
  return stageId === 'test_course' || stageId === 'bloomville' || stageId === 'san_verde';
}

function applyStageShadowPolicy(stage) {
  const root = stage?.group;
  if (!root) {
    return;
  }

  root.traverse((child) => {
    if (!child.isMesh) {
      return;
    }

    // Keep the stage as a receiver in the cheap forward path, but do not let
    // every curb, cone, bump, and prop multiply the directional shadow pass.
    child.castShadow = shouldPreserveStageShadowCaster(child);
  });
}

function shouldPreserveStageShadowCaster(object) {
  let current = object;
  while (current) {
    if (current.userData?.stageShadowCaster === true) {
      return true;
    }
    current = current.parent ?? null;
  }
  return false;
}

function createContactShadowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(
    size * 0.5,
    size * 0.5,
    size * 0.08,
    size * 0.5,
    size * 0.5,
    size * 0.5
  );
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.52)');
  gradient.addColorStop(0.38, 'rgba(0, 0, 0, 0.3)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createVehicleContactShadow() {
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: createContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.42,
      toneMapped: false
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.visible = false;
  shadow.renderOrder = 1;
  shadow.userData.carScale = new THREE.Vector2(4.8, 2.3);
  shadow.userData.bikeScale = new THREE.Vector2(2.6, 1.1);
  return shadow;
}

function updateVehicleContactShadow(context) {
  const shadow = context?.contactShadow;
  if (!shadow) {
    return;
  }

  if (shouldUseCheapDirectionalShadows(state.selectedStageId)) {
    shadow.visible = false;
    return;
  }

  const hasVehicle = context.carMount.children.length > 0 || context.wheelMount.children.length > 0;
  if (!hasVehicle) {
    shadow.visible = false;
    return;
  }

  const sampleGround = activeStage?.sampleGround;
  const support = sampleGround?.(state.vehiclePosition.x, state.vehiclePosition.z, state.vehiclePosition.y);
  if (!support) {
    shadow.visible = false;
    return;
  }

  const heightAboveGround = Math.max(0, state.vehiclePosition.y - support.height);
  const fade = THREE.MathUtils.clamp(1 - heightAboveGround / 2.4, 0, 1);
  const scale =
    state.activeVehicleKind === 'bike' ? shadow.userData.bikeScale : shadow.userData.carScale;

  shadow.visible = fade > 0.02;
  shadow.position.set(state.vehiclePosition.x, support.height + 0.02, state.vehiclePosition.z);
  shadow.scale.set(scale.x, scale.y, 1);
  shadow.rotation.set(-Math.PI / 2, state.vehicleYaw, 0);
  shadow.material.opacity = 0.42 * fade;
}

function applySceneMaterialState(carMount, wheelMount) {
  const effectiveEnvironmentIntensity = getEffectiveEnvironmentIntensity();

  for (const container of [carMount, wheelMount]) {
    container.traverse((child) => {
      if (!child.isMesh) {
        return;
      }

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) {
          continue;
        }

        if (isWindowMesh(child)) {
          applyWindowMaterialState(material, child);
          material.needsUpdate = true;
          continue;
        }

        if ('envMapIntensity' in material) {
          material.envMapIntensity = effectiveEnvironmentIntensity;
        }

        if ('clearcoat' in material && material.clearcoat < 0.35) {
          material.clearcoat = 0.35;
        }

        if ('clearcoatRoughness' in material && material.clearcoatRoughness > 0.18) {
          material.clearcoatRoughness = 0.18;
        }

        if ('anisotropy' in material && material.anisotropy < 0.12) {
          material.anisotropy = 0.12;
        }

        material.needsUpdate = true;
      }
    });
  }
}

function isWindowMesh(mesh) {
  return Boolean(mesh?.name) && /windshield|window(_driver|_passenger|_top)?|glass/i.test(mesh.name);
}

function cloneMaterialSet(material) {
  if (Array.isArray(material)) {
    return material.map((entry) => entry?.clone?.() || entry);
  }

  return material?.clone?.() || material;
}

function getWindowTintProfile(mesh) {
  const useMustangTint =
    state.selectedBuiltInCarId === 'mustang' || /mustang/i.test(String(state.carSource || ''));

  if (!useMustangTint) {
    return {
      color: '#171a1f',
      envBoost: 1.7,
      envFloor: 1.5,
      roughness: 0.03,
      clearcoatRoughness: 0.03,
      transmission: 0.52,
      thickness: 0.22,
      attenuationColor: '#0a0b0d',
      attenuationDistance: 0.32,
      opacity: 0.72
    };
  }

  const name = String(mesh?.name || '').toLowerCase();
  const isWindshield = /windshield|front.*window|window.*front/.test(name);

  if (isWindshield) {
    return {
      color: '#192028',
      envBoost: 1.75,
      envFloor: 1.55,
      roughness: 0.026,
      clearcoatRoughness: 0.026,
      transmission: 0.48,
      thickness: 0.24,
      attenuationColor: '#10141a',
      attenuationDistance: 0.34,
      opacity: 0.78
    };
  }

  return {
    color: '#0d1014',
    envBoost: 1.95,
    envFloor: 1.8,
    roughness: 0.02,
    clearcoatRoughness: 0.02,
    transmission: 0.24,
    thickness: 0.3,
    attenuationColor: '#050608',
    attenuationDistance: 0.16,
    opacity: 0.58
  };
}

function applyWindowMaterialState(material, mesh) {
  const tint = getWindowTintProfile(mesh);
  const effectiveEnvironmentIntensity = getEffectiveEnvironmentIntensity();

  if ('color' in material) {
    material.color.set(tint.color);
  }

  if ('envMapIntensity' in material) {
    material.envMapIntensity = effectiveEnvironmentIntensity <= 0.001
      ? 0
      : Math.max(
        effectiveEnvironmentIntensity * tint.envBoost,
        tint.envFloor * getStageRenderTuning().windowFloorScale
      );
  }

  if ('metalness' in material) {
    material.metalness = 0;
  }

  if ('roughness' in material) {
    material.roughness = tint.roughness;
  }

  if ('clearcoat' in material) {
    material.clearcoat = 1;
  }

  if ('clearcoatRoughness' in material) {
    material.clearcoatRoughness = tint.clearcoatRoughness;
  }

  if ('ior' in material) {
    material.ior = 1.52;
  }

  if ('transmission' in material) {
    material.transmission = tint.transmission;
  }

  if ('thickness' in material) {
    material.thickness = tint.thickness;
  }

  if ('attenuationColor' in material) {
    material.attenuationColor.set(tint.attenuationColor);
  }

  if ('attenuationDistance' in material) {
    material.attenuationDistance = tint.attenuationDistance;
  }

  material.transparent = true;
  material.opacity = tint.opacity;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
}

function createRenderPipeline(renderer, scene, camera) {
  const renderPipeline = new THREE.RenderPipeline(renderer);
  renderPipeline.outputColorTransform = false;

  const scenePass = pass(scene, camera);
  scenePass.setMRT(
    mrt({
      output,
      normal: normalView
    })
  );

  const sceneColor = scenePass.getTextureNode('output');
  const depthNode = scenePass.getTextureNode('depth');
  const normalNode = scenePass.getTextureNode('normal');
  const ssgiPass = ssgi(sceneColor, depthNode, normalNode, camera);
  ssgiPass.radius.value = MODEL_CONFIG.dynamicGiRadius;
  ssgiPass.thickness.value = 1.5;
  ssgiPass.sliceCount.value = MODEL_CONFIG.dynamicGiSliceCount;
  ssgiPass.stepCount.value = MODEL_CONFIG.dynamicGiStepCount;
  ssgiPass.giIntensity.value = MODEL_CONFIG.dynamicGiIntensity;
  ssgiPass.aoIntensity.value = MODEL_CONFIG.dynamicAoIntensity;
  ssgiPass.useTemporalFiltering = false;

  const originalSetSize = ssgiPass.setSize.bind(ssgiPass);
  ssgiPass.setSize = (width, height) =>
    originalSetSize(
      Math.max(1, Math.round(width * MODEL_CONFIG.dynamicGiResolutionScale)),
      Math.max(1, Math.round(height * MODEL_CONFIG.dynamicGiResolutionScale))
    );

  const aoComposite = ssgiPass.w.mul(MODEL_CONFIG.dynamicAoCompositeIntensity).add(
    1 - MODEL_CONFIG.dynamicAoCompositeIntensity
  );
  const giComposite = sceneColor
    .mul(aoComposite)
    .add(ssgiPass.xyz.mul(MODEL_CONFIG.dynamicGiCompositeIntensity));
  const tonedOutput = renderOutput(giComposite, renderer.toneMapping, renderer.outputColorSpace);

  renderPipeline.outputNode = tonedOutput;
  renderPipeline.needsUpdate = true;

  return renderPipeline;
}

function createLightingRig() {
  const rig = new THREE.Group();

  const hemi = new THREE.HemisphereLight('#cfe2ff', '#39506b', 0.42);
  rig.add(hemi);

  const ambient = new THREE.AmbientLight('#dce7f5', 0.05);
  rig.add(ambient);

  const key = new THREE.DirectionalLight('#fff2cf', 6.4);
  key.position.set(32, 42, 18);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(MODEL_CONFIG.shadowMapSize);
  key.shadow.bias = -0.00012;
  key.shadow.normalBias = 0.035;
  key.shadow.radius = 1.6;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 140;
  key.shadow.camera.left = -62;
  key.shadow.camera.right = 62;
  key.shadow.camera.top = 62;
  key.shadow.camera.bottom = -62;
  key.target.position.set(0, 0.5, -28);
  rig.add(key, key.target);

  const fill = new THREE.SpotLight('#8ab3ff', 28, 44, Math.PI * 0.18, 0.34, 1.15);
  fill.position.set(-8, 4.5, 8);
  fill.target.position.set(0, 0.9, 0);
  rig.add(fill, fill.target);

  const rim = new THREE.SpotLight('#7fe8ff', 22, 28, Math.PI * 0.2, 0.35, 1.5);
  rim.position.set(0, 5.8, -9);
  rim.target.position.set(0, 0.8, 0);
  rig.add(rim, rim.target);

  const overheadCard = new THREE.Mesh(
    new THREE.PlaneGeometry(3.8, 1.6),
    new THREE.MeshBasicMaterial({
      color: '#f5fbff',
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide
    })
  );
  overheadCard.position.set(0, 4.8, 0.2);
  overheadCard.rotation.x = Math.PI / 2;
  rig.add(overheadCard);

  const sideCard = overheadCard.clone();
  sideCard.scale.set(0.6, 1.2, 1);
  sideCard.position.set(-3.2, 2.35, -0.8);
  sideCard.rotation.set(0, Math.PI / 2.8, 0);
  rig.add(sideCard);

  rig.userData.lights = {
    hemi,
    ambient,
    key,
    fill,
    rim,
    overheadCard,
    sideCard
  };

  return rig;
}

function syncStageRenderingMode(context) {
  if (!context?.renderer || !context?.stage) {
    return;
  }

  const useSimpleForwardRender = true;
  const useCheapDirectionalShadows = shouldUseCheapDirectionalShadows(state.selectedStageId);
  const renderTuning = getStageRenderTuning(state.selectedStageId);
  context.useSimpleForwardRender = useSimpleForwardRender;
  ui.pipeline.textContent = useCheapDirectionalShadows
    ? 'Performance Forward + Cheap Shadows'
    : 'Performance Forward';
  context.renderer.shadowMap.enabled = useCheapDirectionalShadows;
  context.renderer.shadowMap.needsUpdate = true;
  context.renderer.toneMappingExposure = getEffectiveExposure();
  updateSkyRig(context, state.selectedStageId);
  applySceneMaterialState(context.carMount, context.wheelMount);

  const lights = context.lightingRig?.userData?.lights;
  if (!lights) {
    return;
  }

  lights.fill.visible = false;
  lights.rim.visible = false;
  lights.overheadCard.visible = false;
  lights.sideCard.visible = false;
  lights.key.visible = true;
  lights.key.castShadow = useCheapDirectionalShadows;

  const behaviorStageId = getStageBehaviorId(state.selectedStageId);
  if (behaviorStageId === 'test_course' || behaviorStageId === 'san_verde') {
    lights.key.color.set('#fff1db');
    lights.key.intensity = 2.8;
    lights.key.position.set(18, 22, 10);
    lights.key.userData.followOffset = new THREE.Vector3(18, 22, 10);
    lights.key.shadow.bias = -0.00012;
    lights.key.shadow.normalBias = 0.035;
    lights.hemi.intensity = 0.16;
    lights.ambient.intensity = 0.03;
  } else if (behaviorStageId === 'bloomville') {
    lights.key.color.set('#fff0d6');
    lights.key.intensity = 3.2;
    lights.key.position.set(26, 34, 14);
    lights.key.userData.followOffset = new THREE.Vector3(26, 34, 14);
    lights.key.shadow.bias = -0.00012;
    lights.key.shadow.normalBias = 0.035;
    lights.hemi.intensity = 0.18;
    lights.ambient.intensity = 0.035;
  } else {
    lights.key.color.set('#fff2cf');
    lights.key.intensity = 6.4;
    lights.key.position.set(32, 42, 18);
    lights.key.userData.followOffset = new THREE.Vector3(32, 42, 18);
    lights.key.shadow.bias = -0.00012;
    lights.key.shadow.normalBias = 0.035;
    lights.hemi.intensity = useCheapDirectionalShadows ? 0.44 : 0.48;
    lights.ambient.intensity = useCheapDirectionalShadows ? 0.06 : 0.08;
  }
}

function createSkyRig(pmrem, preset = getStageSkyPreset()) {
  const sky = new SkyMesh();
  sky.scale.setScalar(9000);
  sky.material.depthWrite = false;
  applySkyPresetToObject(sky, preset);
  const environment = buildSkyEnvironment(pmrem, preset);
  return { sky, environment, presetKey: preset.key };
}

function getStageRenderTuning(stageId = state.selectedStageId) {
  stageId = getStageBehaviorId(stageId);
  if (stageId === 'test_course' || stageId === 'san_verde') {
    return {
      exposureScale: 0.68,
      environmentScale: 0.04,
      windowFloorScale: 0
    };
  }

  if (stageId === 'bloomville') {
    return {
      exposureScale: 0.72,
      environmentScale: 0.22,
      windowFloorScale: 0.2
    };
  }

  return {
    exposureScale: 1,
    environmentScale: 1,
    windowFloorScale: 1
  };
}

function getEffectiveExposure(stageId = state.selectedStageId) {
  const tuning = getStageRenderTuning(stageId);
  return state.exposure * 0.98 * tuning.exposureScale;
}

function getEffectiveEnvironmentIntensity(stageId = state.selectedStageId) {
  const tuning = getStageRenderTuning(stageId);
  return state.environmentIntensity * tuning.environmentScale;
}

function getSanVerdeSkyPresetFromTime() {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;

  // t: 0 at 6 am, 1 at 6 pm
  const t = (hour - 6) / 12;
  const elevation = Math.sin(Math.PI * t) * 66 - 3; // peaks ~63° at noon, -3° at 6 am/pm
  const azimuth = 90 + t * 180;                      // east→south→west across the day

  // 0 at dawn/dusk/night, 1 at midday
  const dayFactor = Math.max(0, Math.sin(Math.PI * t));

  return {
    key: `sv_h${Math.floor(hour)}`,
    turbidity:        THREE.MathUtils.lerp(11, 5,     dayFactor),
    rayleigh:         THREE.MathUtils.lerp(1.1, 2.0,  dayFactor),
    mieCoefficient:   THREE.MathUtils.lerp(0.008, 0.003, dayFactor),
    mieDirectionalG:  0.82,
    elevation,
    azimuth,
    environmentScale: elevation > 0 ? THREE.MathUtils.lerp(0.2, 0.5, dayFactor) : 0.02,
  };
}

function getStageSkyPreset(stageId = state.selectedStageId) {
  stageId = getStageBehaviorId(stageId);
  if (stageId === 'san_verde') {
    return getSanVerdeSkyPresetFromTime();
  }

  if (stageId === 'bloomville') {
    return {
      key: 'bloomville_soft_day',
      turbidity: 6.5,
      rayleigh: 1.4,
      mieCoefficient: 0.0035,
      mieDirectionalG: 0.78,
      elevation: 31,
      azimuth: 138,
      environmentScale: 0.5
    };
  }

  return {
    key: 'default_day',
    turbidity: 8,
    rayleigh: 1.9,
    mieCoefficient: 0.006,
    mieDirectionalG: 0.82,
    elevation: 38,
    azimuth: 145,
    environmentScale: 1
  };
}

function updateSkyRig(context, stageId) {
  const skyRig = context?.skyRig;
  const pmrem = context?.pmrem;
  const scene = context?.scene;
  if (!skyRig || !pmrem || !scene) {
    return;
  }

  const preset = getStageSkyPreset(stageId);
  if (skyRig.presetKey === preset.key) {
    applySkyPresetToObject(skyRig.sky, preset);
    scene.environmentIntensity = getEffectiveEnvironmentIntensity(stageId) * preset.environmentScale;
    return;
  }

  applySkyPresetToObject(skyRig.sky, preset);
  const nextEnvironment = buildSkyEnvironment(pmrem, preset);
  scene.background = nextEnvironment.texture;
  scene.environment = nextEnvironment.texture;
  scene.environmentIntensity = getEffectiveEnvironmentIntensity(stageId) * preset.environmentScale;

  skyRig.environment?.dispose?.();
  skyRig.environment = nextEnvironment;
  skyRig.presetKey = preset.key;
}

function applySkyPresetToObject(sky, preset) {
  if (!sky) {
    return;
  }

  sky.turbidity.value = preset.turbidity;
  sky.rayleigh.value = preset.rayleigh;
  sky.mieCoefficient.value = preset.mieCoefficient;
  sky.mieDirectionalG.value = preset.mieDirectionalG;
  sky.sunPosition.value.copy(getSunPositionVector(preset)).multiplyScalar(450000);
}

function buildSkyEnvironment(pmrem, preset) {
  const skyScene = new THREE.Scene();
  const environmentSky = new SkyMesh();
  environmentSky.scale.setScalar(9000);
  applySkyPresetToObject(environmentSky, preset);
  skyScene.add(environmentSky);
  const environment = pmrem.fromScene(skyScene, 0.04);
  environmentSky.geometry.dispose();
  environmentSky.material.dispose();
  return environment;
}

function getSunPositionVector(preset) {
  const phi = THREE.MathUtils.degToRad(90 - preset.elevation);
  const theta = THREE.MathUtils.degToRad(preset.azimuth);
  return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
}

function createFallbackCar() {
  const group = new THREE.Group();

  const paint = new THREE.MeshPhysicalMaterial({
    color: '#b7c6ff',
    metalness: 0.72,
    roughness: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.08
  });

  const glass = new THREE.MeshPhysicalMaterial({
    color: '#d7e6ff',
    transmission: 0.88,
    transparent: true,
    opacity: 0.45,
    roughness: 0.02,
    metalness: 0,
    thickness: 0.18
  });

  const dark = new THREE.MeshStandardMaterial({
    color: '#101820',
    metalness: 0.32,
    roughness: 0.44
  });

  const body = new THREE.Mesh(new RoundedBoxGeometry(2.12, 0.42, 4.7, 6, 0.11), paint);
  body.position.y = 0.74;
  group.add(body);

  const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.62, 0.7, 2.1, 6, 0.12), glass);
  cabin.position.set(0, 1.12, -0.12);
  group.add(cabin);

  const splitter = new THREE.Mesh(new RoundedBoxGeometry(2.02, 0.08, 0.82, 4, 0.04), dark);
  splitter.position.set(0, 0.43, 2.1);
  group.add(splitter);

  const diffuser = new THREE.Mesh(new RoundedBoxGeometry(1.88, 0.08, 0.9, 4, 0.04), dark);
  diffuser.position.set(0, 0.42, -2.06);
  group.add(diffuser);

  return group;
}

function createShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(256, 256, 32, 256, 256, 220);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  gradient.addColorStop(0.45, 'rgba(0, 0, 0, 0.22)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function focusVehicle(camera, controls, vehicleRoot) {
  camera.far = MODEL_CONFIG.driveCameraFar;
  camera.updateProjectionMatrix();
  controls.minDistance = MODEL_CONFIG.driveCameraMinDistance;
  controls.maxDistance = MODEL_CONFIG.driveCameraMaxDistance;
  vehicleRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(vehicleRoot);
  if (box.isEmpty()) {
    return;
  }

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5;
  const distance = Math.max(radius * 3.4, 6.5);

  camera.position.set(center.x + distance * 0.72, center.y + radius * 1.15, center.z + distance * 0.96);
  controls.target.copy(center);
  controls.update();
}

function focusStage(camera, controls, stage, vehicleRoot) {
  const overviewBounds = stage?.overviewBounds || stage?.cityGraph?.bounds;
  if (!overviewBounds) {
    controls.minDistance = 3.4;
    controls.maxDistance = 24;
    focusVehicle(camera, controls, vehicleRoot);
    return;
  }

  const width = overviewBounds.maxX - overviewBounds.minX;
  const depth = overviewBounds.maxZ - overviewBounds.minZ;
  const span = Math.max(width, depth, 80);
  const isBloomville = stage?.id === 'bloomville';
  const stageCenter = new THREE.Vector3(
    (overviewBounds.minX + overviewBounds.maxX) * 0.5,
    0,
    (overviewBounds.minZ + overviewBounds.maxZ) * 0.5
  );
  const center = stageCenter.clone();

  if (vehicleRoot) {
    vehicleRoot.updateMatrixWorld(true);
    const vehicleBox = new THREE.Box3().setFromObject(vehicleRoot);
    if (!vehicleBox.isEmpty()) {
      const vehicleCenter = vehicleBox.getCenter(new THREE.Vector3());
      center.x = vehicleCenter.x;
      center.y = vehicleCenter.y;
      center.z = vehicleCenter.z;
    }
  }

  camera.far = Math.max(isBloomville ? 50000 : 8000, span * (isBloomville ? 16 : 6.5));
  camera.updateProjectionMatrix();
  controls.minDistance = Math.max(24, span * 0.12);
  controls.maxDistance = Math.max(isBloomville ? 4000 : 520, span * (isBloomville ? 12.5 : 5.2));
  camera.position.set(
    center.x + span * (isBloomville ? 0.55 : 0.32),
    center.y + span * (isBloomville ? 2.8 : 1.95),
    center.z + span * (isBloomville ? 2.05 : 1.22)
  );
  controls.target.copy(center);
  controls.update();
}

function shouldUseStageOverview(stageId) {
  stageId = getStageBehaviorId(stageId);
  return stageId === 'city' || stageId === 'bloomville';
}

function createStageSkyBackground(stageId) {
  stageId = getStageBehaviorId(stageId);
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);

  if (stageId === 'san_verde') {
    grad.addColorStop(0, '#1a2a5a');
    grad.addColorStop(0.38, '#4a3888');
    grad.addColorStop(0.68, '#c06040');
    grad.addColorStop(0.85, '#e8904a');
    grad.addColorStop(1, '#f5c06a');
  } else if (stageId === 'bloomville') {
    grad.addColorStop(0, '#5a89c6');
    grad.addColorStop(0.55, '#9ec3ea');
    grad.addColorStop(1, '#dbe8f7');
  } else {
    grad.addColorStop(0, '#4a78c0');
    grad.addColorStop(0.6, '#8ab8e0');
    grad.addColorStop(1, '#d8eaf8');
  }

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

function applyStageAtmosphere(scene, stageId) {
  stageId = getStageBehaviorId(stageId);
  if (!scene) {
    return;
  }

  if (!state.fogEnabled) {
    scene.fog = null;
    return;
  }

  if (stageId === 'city') {
    scene.fog = new THREE.FogExp2('#a8bfd8', 0.00042);
    return;
  }

  if (stageId === 'bloomville') {
    scene.fog = new THREE.FogExp2('#9eb7c7', 0.00005);
    return;
  }

  if (stageId === 'test_course') {
    scene.fog = new THREE.FogExp2('#d8dee6', 0.00016);
    return;
  }

  if (stageId === 'san_verde') {
    scene.fog = new THREE.FogExp2('#c08050', 0.00020);
    return;
  }

  scene.fog = new THREE.FogExp2('#90b3d5', 0.0065);
}

function updateOverviewPan(controls, camera, deltaSeconds) {
  if (state.driveMode || state.characterLoaded || !shouldUseStageOverview(state.selectedStageId)) {
    return;
  }

  const inputX = Number(state.overviewPan.right) - Number(state.overviewPan.left);
  const inputZ = Number(state.overviewPan.backward) - Number(state.overviewPan.forward);
  if (inputX === 0 && inputZ === 0) {
    return;
  }

  const toCamera = new THREE.Vector3().subVectors(camera.position, controls.target);
  const distance = Math.max(toCamera.length(), 1);
  const flatForward = toCamera.clone().setY(0).normalize().multiplyScalar(-1);
  const flatSide = new THREE.Vector3(-flatForward.z, 0, flatForward.x).normalize();
  const panSpeed = Math.max(28, distance * 0.95);
  const move = new THREE.Vector3()
    .addScaledVector(flatSide, inputX * panSpeed * deltaSeconds)
    .addScaledVector(flatForward, inputZ * panSpeed * deltaSeconds);

  camera.position.add(move);
  controls.target.add(move);
  controls.update();
}

function clearGroup(group, options = {}) {
  if (!group) {
    return;
  }

  for (const child of [...group.children]) {
    group.remove(child);
    if (options.dispose) {
      disposeObjectTree(child);
    }
  }
}

function disposeObjectTree(rootObject, options = {}) {
  const disposeMaterials = options.disposeMaterials ?? true;
  rootObject.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
    }

    if (!disposeMaterials) {
      return;
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) {
        continue;
      }

      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap']) {
        if (material[key]?.isTexture) {
          material[key].dispose();
        }
      }

      material.dispose?.();
    }
  });
}

function findObjectByNamePrefix(rootObject, prefix) {
  let match = null;
  rootObject.traverse((child) => {
    if (!match && child.name?.startsWith(prefix)) {
      match = child;
    }
  });
  return match;
}

function axisToVector(axis) {
  if (axis === 0) {
    return new THREE.Vector3(1, 0, 0);
  }

  if (axis === 1) {
    return new THREE.Vector3(0, 1, 0);
  }

  return new THREE.Vector3(0, 0, 1);
}

function axisToRotationProperty(axis) {
  if (axis === 0) {
    return 'x';
  }

  if (axis === 1) {
    return 'y';
  }

  return 'z';
}

function inferObjectLocalThinAxis(rootObject) {
  let targetMesh = null;

  rootObject.traverse((child) => {
    if (!targetMesh && child.isMesh && child.geometry) {
      targetMesh = child;
    }
  });

  if (!targetMesh?.geometry) {
    return 2;
  }

  if (!targetMesh.geometry.boundingBox) {
    targetMesh.geometry.computeBoundingBox();
  }

  const boundingBox = targetMesh.geometry.boundingBox;
  if (!boundingBox) {
    return 2;
  }

  const size = boundingBox.getSize(new THREE.Vector3());
  const axisSizes = [Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)];
  return axisSizes.indexOf(Math.min(...axisSizes));
}

function refreshCarTextureSlots() {
  state.carTextureSlots = collectCarTextureSlots(state.carAsset);

  if (!state.carTextureSlots.length) {
    state.selectedCarTextureSlotId = '';
  } else if (!state.carTextureSlots.some((slot) => slot.id === state.selectedCarTextureSlotId)) {
    state.selectedCarTextureSlotId = state.carTextureSlots[0].id;
  }

  syncTextureEditorUi();
}

function collectCarTextureSlots(rootObject) {
  if (!rootObject) {
    return [];
  }

  const slots = new Map();

  rootObject.traverse((child) => {
    if (!child.isMesh) {
      return;
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material, index) => {
      if (!material?.map) {
        return;
      }

      const texture = material.map;
      const key = `map:${texture.source?.uuid || texture.uuid}`;

      if (!slots.has(key)) {
        const labelBase = material.name || child.name || `Material ${index + 1}`;
        slots.set(key, {
          id: key,
          label: `${labelBase} Base Color`,
          texture,
          bindings: []
        });
      }

      slots.get(key).bindings.push({ material, mesh: child });
    });
  });

  return [...slots.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function syncTextureEditorUi() {
  ui.textureSlot.replaceChildren();

  if (!state.carTextureSlots.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No editable textures found';
    ui.textureSlot.append(option);
    ui.textureSlot.disabled = true;
    ui.textureInput.disabled = true;
    ui.downloadTexture.disabled = true;
    ui.exportCar.disabled = !state.carAsset;
    ui.textureHint.textContent = state.carAsset
      ? 'No base-color texture slots were detected on the current car material set.'
      : 'Load a car GLB to inspect its editable base-color texture slots.';
    return;
  }

  for (const slot of state.carTextureSlots) {
    const option = document.createElement('option');
    option.value = slot.id;
    option.textContent = slot.label;
    ui.textureSlot.append(option);
  }

  ui.textureSlot.value = state.selectedCarTextureSlotId;
  ui.textureSlot.disabled = false;
  ui.textureInput.disabled = false;
  ui.downloadTexture.disabled = false;
  ui.exportCar.disabled = false;

  const selected = getSelectedCarTextureSlot();
  ui.textureHint.textContent = selected
    ? `Selected slot: ${selected.label}. Download it as PNG, replace it with an upscaled image, then export a fresh GLB.`
    : 'Choose a car texture slot to edit.';
}

function getSelectedCarTextureSlot() {
  return state.carTextureSlots.find((slot) => slot.id === state.selectedCarTextureSlotId) || null;
}

async function applyUploadedTexture(file) {
  const slot = getSelectedCarTextureSlot();
  if (!slot) {
    throw new Error('No selected texture slot');
  }

  const imageBitmap = await createImageBitmap(file);
  const replacement = new THREE.Texture(imageBitmap);
  replacement.name = `${slot.label} Replacement`;
  replacement.colorSpace = THREE.SRGBColorSpace;
  replacement.flipY = slot.texture.flipY;
  replacement.wrapS = slot.texture.wrapS;
  replacement.wrapT = slot.texture.wrapT;
  replacement.repeat.copy(slot.texture.repeat);
  replacement.offset.copy(slot.texture.offset);
  replacement.center.copy(slot.texture.center);
  replacement.rotation = slot.texture.rotation;
  replacement.magFilter = slot.texture.magFilter;
  replacement.minFilter = slot.texture.minFilter;
  replacement.anisotropy = slot.texture.anisotropy;
  replacement.generateMipmaps = true;
  replacement.needsUpdate = true;

  for (const binding of slot.bindings) {
    binding.material.map = replacement;
    binding.material.needsUpdate = true;
  }

  refreshCarTextureSlots();
}

async function textureToBlob(texture) {
  const image = texture?.image;
  if (!image) {
    throw new Error('Texture has no image payload');
  }

  if (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) {
    return image.convertToBlob({ type: 'image/png' });
  }

  const width = image.width || image.videoWidth;
  const height = image.height || image.videoHeight;
  if (!width || !height) {
    throw new Error('Texture image dimensions are unavailable');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, width, height);

  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to encode texture'));
      }
    }, 'image/png');
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

function stripFileExtension(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

function slugifyFilename(value) {
  return (
    stripFileExtension(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'car-texture'
  );
}

function setStatus(message) {
  ui.status.textContent = message;
}

function setProgress(value) {
  if (ui.progress) ui.progress.style.width = `${value}%`;
}

function setLoadScreen(pct, label) {
  setLoadPct(pct);
  setLoadLabel(label);
}

function applyGarageSnapshot(snapshot) {
  state.driveMode = snapshot.driveMode;
  state.drivingStyle = snapshot.drivingStyle;
  state.autopilotEnabled = snapshot.autopilotEnabled;
  state.driveSpeed = snapshot.driveSpeed;
  state.steerAngle = snapshot.steerAngle;
  state.bikeLeanAngle = snapshot.bikeLeanAngle || 0;
  state.vehicleYaw = snapshot.vehicleYaw;
  state.vehiclePosition.copy(snapshot.vehiclePosition);
  state.cameraOverride = snapshot.cameraOverride;
  state.cameraDetached = snapshot.cameraDetached;
  state.cinematicCameraEnabled = snapshot.cinematicCameraEnabled;
  state.wheelSpin = snapshot.wheelSpin;
  state.wheelRadius = snapshot.wheelRadius;
  state.chassisHeight = snapshot.chassisHeight;
  applyEngineSnapshot(snapshot.engine);
  applySteeringWheelState();
  ui.toggleLap.textContent = `Drive mode: ${state.driveMode ? 'On' : 'Off'}`;
  ui.toggleAutopilot.textContent = `Autopilot: ${state.autopilotEnabled ? 'On' : 'Off'}`;
  ui.toggleCinematic.textContent = `Camera: ${state.cinematicCameraEnabled ? 'Cinematic' : 'Normal'}`;
  ui.toggleNavDebug.textContent = `Nav Debug: ${state.navDebugVisible ? 'On' : 'Off'}`;
  ui.toggleFog.textContent = `Fog: ${state.fogEnabled ? 'On' : 'Off'}`;
  ui.driveStyle.value = state.drivingStyle;
  ui.driveStyleDescription.textContent =
    MODEL_CONFIG.drivingStyles[state.drivingStyle]?.description || '';
  playerSystem?.syncOverlay(appContext);
}

function toggleDoorState() {
  if (!state.doorRig) {
    setStatus('No hinge-ready door found on the current car');
    return;
  }

  state.doorOpen = !state.doorOpen;
  ui.toggleDoor.textContent = `Door: ${state.doorOpen ? 'Open' : 'Closed'}`;
  setStatus(state.doorOpen ? 'Door opened' : 'Door closed');
}

function applyEngineSnapshot(snapshot) {
  state.engineTypeId = snapshot.engineTypeId;
  state.engineName = snapshot.engineName;
  state.engineDescription = snapshot.engineDescription;
  state.engineRpm = snapshot.engineRpm;
  state.engineThrottle = snapshot.engineThrottle;
  state.engineLoad = snapshot.engineLoad;
  state.engineGearLabel = snapshot.engineGearLabel;
  state.engineAudioReady = snapshot.engineAudioReady;
  syncEngineOutputs();
}

async function unlockEngineAudio(runtime) {
  try {
    applyGarageSnapshot(await ensureGarageAudioReady(runtime));
  } catch (error) {
    console.error(error);
  }
}

function syncEngineOutputs() {
  setEngineName(state.engineName);
  setEngineGear(state.engineGearLabel);
  setEngineRpm(`${Math.round(state.engineRpm).toLocaleString()} rpm`);
  setVehicleSpeed(`${Math.round(Math.abs(state.driveSpeed) * 2.23694).toLocaleString()} mph`);
  ui.engineDescription.textContent = state.engineDescription;
  ui.engineType.value = state.engineTypeId;
}

function updatePerformanceOverlay(renderer, deltaSeconds, performanceAttribution) {
  const perf = state.performance;
  perf.frameAccumulator += deltaSeconds;
  perf.frameCount += 1;
  const renderInfo = renderer.info.render;
  const memoryInfo = renderer.info.memory;
  perf.peakDraws = Math.max(perf.peakDraws, renderInfo.drawCalls);
  perf.peakTriangles = Math.max(perf.peakTriangles, renderInfo.triangles);
  perf.drawCategorySummary = performanceAttribution.formatTopSummary(3);

  if (perf.frameAccumulator >= 1.0) {
    perf.fps = perf.frameCount / Math.max(perf.frameAccumulator, 1e-6);
    perf.frameMs = (perf.frameAccumulator / Math.max(perf.frameCount, 1)) * 1000;
    perf.frameAccumulator = 0;
    perf.frameCount = 0;
    perf.peakDraws = renderInfo.drawCalls;
    perf.peakTriangles = renderInfo.triangles;
  }

  setPerfFps(`${Math.round(perf.fps || 0)}`);
  setPerfFrame(`${(perf.frameMs || deltaSeconds * 1000).toFixed(1)} ms`);
  setPerfDraws(`${renderInfo.drawCalls.toLocaleString()}`);
  setPerfPeakDraws(`${perf.peakDraws.toLocaleString()}`);
  setPerfRenderCalls(`${renderInfo.calls.toLocaleString()}`);
  setPerfTriangles(`${renderInfo.triangles.toLocaleString()}`);
  setPerfPeakTriangles(`${perf.peakTriangles.toLocaleString()}`);
  setPerfGeometries(`${memoryInfo.geometries.toLocaleString()}`);
  setPerfTextures(`${memoryInfo.textures.toLocaleString()}`);
  setPerfBreakdown(perf.drawCategorySummary);
}

function shouldShowBloomvilleMinimap(stageId) {
  stageId = getStageBehaviorId(stageId);
  return stageId === 'bloomville' || stageId === 'san_verde';
}

function updateBloomvilleMinimapOverlay(context) {
  const visible = shouldShowBloomvilleMinimap(state.selectedStageId) && Boolean(minimapCanvasEl);
  setMinimapVisible(visible);

  if (!visible) {
    return;
  }

  const stagePosition = playerSystem?.getActiveStagePosition?.(context) || state.vehiclePosition;
  const yaw =
    state.characterVehicleState === 'on_foot' && context?.characterController
      ? context.characterController.yaw
      : state.vehicleYaw;

  setMinimapLabel(getStageLabel(state.selectedStageId));
  renderStageMinimap(minimapCanvasEl, {
    mode: activeStage?.navigation?.mode,
    center: stagePosition,
    yaw,
    chunkSize: activeStage?.navigation?.chunkSize || 180,
    roads: activeStage?.navigation?.graph?.roads || [],
    bounds: activeStage?.overviewBounds || null
  });
}

function updateDoorAnimation(deltaSeconds) {
  if (!state.doorRig?.pivot) {
    return;
  }

  const targetAngle = state.doorOpen ? state.doorRig.maxAngle : 0;
  const lerpAlpha = 1 - Math.exp(-8 * Math.max(deltaSeconds, 1 / 120));
  state.doorAngle = THREE.MathUtils.lerp(state.doorAngle, targetAngle, lerpAlpha);
  state.doorRig.pivot.quaternion.copy(state.doorRig.pivot.userData.closedQuaternion);
  state.doorRig.pivot.rotateY(state.doorAngle * state.doorRig.openDirection);
}

function updateWheelFit(context) {
  remountTires(context.wheelMount);
  applySceneMaterialState(context.carMount, context.wheelMount);
}

function usesSocketWheelAnchors() {
  return state.carWheelAnchors?.length === 4;
}

function syncControlOutputs() {
  ui.driveStyle.value = state.drivingStyle;
  ui.driveStyleDescription.textContent =
    MODEL_CONFIG.drivingStyles[state.drivingStyle]?.description || '';
  ui.exposureValue.textContent = state.exposure.toFixed(2);
  ui.environmentValue.textContent = state.environmentIntensity.toFixed(2);
  ui.tireScaleValue.textContent = state.tireScale.toFixed(2);
  ui.frontAxleValue.textContent = state.frontAxleRatio.toFixed(3);
  ui.rearAxleValue.textContent = state.rearAxleRatio.toFixed(3);
  ui.rideHeightValue.textContent = state.rideHeight.toFixed(3);
  ui.chassisHeightValue.textContent = state.chassisHeight.toFixed(3);
  ui.sideInsetValue.textContent = state.sideInset.toFixed(3);
  ui.rotateXValue.textContent = state.tireRotation[0].toFixed(2);
  ui.rotateYValue.textContent = state.tireRotation[1].toFixed(2);
  ui.rotateZValue.textContent = state.tireRotation[2].toFixed(2);
  ui.bikeFrontSpinAxis.value = state.bikeFrontSpinAxis;
  ui.bikeRearSpinAxis.value = state.bikeRearSpinAxis;
  ui.bikeFrontOffsetX.value = String(state.bikeFrontWheelOffset.x);
  ui.bikeFrontOffsetY.value = String(state.bikeFrontWheelOffset.y);
  ui.bikeFrontOffsetZ.value = String(state.bikeFrontWheelOffset.z);
  ui.bikeFrontOffsetXValue.textContent = state.bikeFrontWheelOffset.x.toFixed(3);
  ui.bikeFrontOffsetYValue.textContent = state.bikeFrontWheelOffset.y.toFixed(3);
  ui.bikeFrontOffsetZValue.textContent = state.bikeFrontWheelOffset.z.toFixed(3);
  ui.bikeFrontRotateX.value = String(state.bikeFrontWheelRotation[0]);
  ui.bikeFrontRotateY.value = String(state.bikeFrontWheelRotation[1]);
  ui.bikeFrontRotateZ.value = String(state.bikeFrontWheelRotation[2]);
  ui.bikeFrontRotateXValue.textContent = state.bikeFrontWheelRotation[0].toFixed(2);
  ui.bikeFrontRotateYValue.textContent = state.bikeFrontWheelRotation[1].toFixed(2);
  ui.bikeFrontRotateZValue.textContent = state.bikeFrontWheelRotation[2].toFixed(2);
  ui.bikeRearOffsetX.value = String(state.bikeRearWheelOffset.x);
  ui.bikeRearOffsetY.value = String(state.bikeRearWheelOffset.y);
  ui.bikeRearOffsetZ.value = String(state.bikeRearWheelOffset.z);
  ui.bikeRearOffsetXValue.textContent = state.bikeRearWheelOffset.x.toFixed(3);
  ui.bikeRearOffsetYValue.textContent = state.bikeRearWheelOffset.y.toFixed(3);
  ui.bikeRearOffsetZValue.textContent = state.bikeRearWheelOffset.z.toFixed(3);
  ui.bikeRearRotateX.value = String(state.bikeRearWheelRotation[0]);
  ui.bikeRearRotateY.value = String(state.bikeRearWheelRotation[1]);
  ui.bikeRearRotateZ.value = String(state.bikeRearWheelRotation[2]);
  ui.bikeRearRotateXValue.textContent = state.bikeRearWheelRotation[0].toFixed(2);
  ui.bikeRearRotateYValue.textContent = state.bikeRearWheelRotation[1].toFixed(2);
  ui.bikeRearRotateZValue.textContent = state.bikeRearWheelRotation[2].toFixed(2);
  ui.toggleNavDebug.textContent = `Nav Debug: ${state.navDebugVisible ? 'On' : 'Off'}`;
  ui.rideHeight.disabled = usesSocketWheelAnchors();
  ui.rideHeight.title = usesSocketWheelAnchors() ? 'Socketed cars author wheel height in the GLB.' : '';
  syncEngineOutputs();
  syncTextureEditorUi();
}

function syncOverlayVisibility() {
  ui.hud.classList.toggle('is-hidden', !state.uiOpen);
  setUiOpen(state.uiOpen);
  setPerformanceOpen(state.performanceOpen);
  setMinimapVisible(shouldShowBloomvilleMinimap(state.selectedStageId));
}
