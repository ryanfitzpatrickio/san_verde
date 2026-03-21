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
import { EngineAudioSystem } from './engine-system.js';
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
import {
  createAppContextRuntime,
  createAssetLoaderRuntime,
  createRendererViewportRuntime,
  createSceneAssemblyRuntime
} from './runtime/bootstrap-runtime.js';
import { createGarageVehicleRuntime } from './runtime/garage-vehicle-runtime.js';
import { createRenderStageRuntime } from './runtime/render-stage-runtime.js';
import { createSceneUtilsRuntime } from './runtime/scene-utils-runtime.js';
import { createStageRuntime } from './runtime/stage-runtime.js';
import { createVehicleMaterialRuntime } from './runtime/vehicle-material-runtime.js';
import { assetExists, createSceneHelpers } from './scene-helpers.js';
import { renderStageMinimap } from './ui/bloomville-minimap.js';
import { wireMainUi } from './ui/wire-main-ui.js';
import { CarVehicle } from './vehicles/car-vehicle.js';
import { BikeVehicle } from './vehicles/bike-vehicle.js';
import { collectEmbeddedWheelAssets } from './vehicles/car-rig-helpers.js';
import { createVehicleManager } from './vehicles/vehicle-manager.js';

const root = document.querySelector('#app');
// Keep UI markup and initial UI-backed state in app-shell.js.
// main.js is already too large; adding DOM/state shape here creates parallel
// boot paths and is the architectural drift we are actively removing.
const ui = createAppShell(root);
const state = createInitialState(ui);
const vehicleSceneHelpers = createSceneHelpers({ state, ui, config: MODEL_CONFIG });
const {
  mountSteeringWheelAttachment,
  collectSteeringWheelRig,
  normalizeToTargetSpan,
  measureObjectBounds,
  measureTireProfile,
  createFallbackMountedWheel,
  collectWheelAnchors,
  createDoorRig,
  findNamedObject,
  axisToRotationProperty
} = vehicleSceneHelpers;

const sceneUtilsRuntime = createSceneUtilsRuntime({
  THREE,
  RoundedBoxGeometry,
  config: MODEL_CONFIG,
  state,
  callbacks: {
    getStageBehaviorId
  }
});
const {
  createFallbackCar,
  focusVehicle,
  focusStage,
  shouldUseStageOverview,
  updateOverviewPan,
  clearGroup,
  disposeObjectTree,
  findObjectByNamePrefix
} = sceneUtilsRuntime;

let playerSystem = null;

const renderStageRuntime = createRenderStageRuntime({
  THREE,
  SkyMesh,
  ssgi,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
  config: MODEL_CONFIG,
  state,
  ui,
  callbacks: {
    getStageBehaviorId,
    applySceneMaterialState: (carMount, wheelMount) => applySceneMaterialState(carMount, wheelMount),
    getPlayerSystem: () => playerSystem
  }
});
const {
  updateKeyLightShadowFocus,
  shouldUseCheapDirectionalShadows,
  applyStageShadowPolicy,
  createVehicleContactShadow,
  updateVehicleContactShadow,
  createRenderPipeline,
  createLightingRig,
  syncStageRenderingMode,
  createSkyRig,
  getStageRenderTuning,
  getEffectiveExposure,
  getEffectiveEnvironmentIntensity,
  getStageSkyPreset,
  updateSkyRig,
  applyStageAtmosphere
} = renderStageRuntime;

const vehicleMaterialRuntime = createVehicleMaterialRuntime({
  THREE,
  state,
  callbacks: {
    getEffectiveEnvironmentIntensity: () => getEffectiveEnvironmentIntensity(),
    getStageRenderTuning: () => getStageRenderTuning()
  }
});
const {
  prepareRenderable,
  applySceneMaterialState
} = vehicleMaterialRuntime;

const BIKE_DEBUG = false;
const PERF_CATEGORY_OTHER = 'other';
const RENDERER_MODE_WEBGL = 'webgl';
const RENDERER_MODE_WEBGPU = 'webgpu';

function getStageBehaviorId(stageId) {
  if (stageId === 'bloomville_glb') {
    return 'bloomville';
  }
  if (stageId === 'san_verde_test') {
    return 'san_verde';
  }
  if (stageId === 'san_verde_glb') {
    return 'san_verde';
  }
  return stageId;
}

function isSanVerdeStageId(stageId) {
  return stageId === 'san_verde' || stageId === 'san_verde_glb' || stageId === 'san_verde_test';
}

function resolveSanVerdeAssignedGlbOnly(stage = appContext?.stage ?? null) {
  if (typeof state.sanVerdeAssignedGlbOnly === 'boolean') {
    return state.sanVerdeAssignedGlbOnly;
  }
  return stage?.bakeConfig?.assignedGlbOnly === true;
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
    },
    formatPrefixSummary(prefix, limit = 3) {
      const entries = Object.entries(drawCategories)
        .filter(([category]) => category.startsWith(prefix))
        .sort((left, right) => {
          if (right[1] !== left[1]) {
            return right[1] - left[1];
          }
          return left[0].localeCompare(right[0]);
        })
        .slice(0, limit);

      if (entries.length === 0) {
        return '';
      }

      return entries
        .map(([category, draws]) => `${category} ${draws.toLocaleString()}`)
        .join(' | ');
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
    collectEmbeddedWheelAssets,
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

let applyGarageSnapshot = null;
const gltfExporter = new GLTFExporter();

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

const garageVehicleRuntime = createGarageVehicleRuntime({
  config: MODEL_CONFIG,
  state,
  ui,
  carVehicle,
  helpers: {
    THREE,
    gltfExporter
  },
  callbacks: {
    getAppContext: () => appContext,
    getGameRuntime: () => gameRuntime,
    getPlayerSystem: () => playerSystem,
    syncParkedVehicleProxies: (context) => vehicleManager.syncParkedVehicleProxies(context),
    applyGarageSnapshot: (snapshot) => applyGarageSnapshot(snapshot),
    setChassisHeight: (runtime, chassisHeight) => setChassisHeight(runtime, chassisHeight),
    setSuspensionOverrides: (runtime, overrides) => setSuspensionOverrides(runtime, overrides),
    setWheelRadius: (runtime, wheelRadius) => setWheelRadius(runtime, wheelRadius),
    getEffectiveExposure: () => getEffectiveExposure(),
    setEngineName: (value) => setEngineName(value),
    setEngineGear: (value) => setEngineGear(value),
    setEngineRpm: (value) => setEngineRpm(value),
    setVehicleSpeed: (value) => setVehicleSpeed(value),
    setStatus: (message) => setStatus(message),
    resolveAssignedGlbOnly: () => resolveSanVerdeAssignedGlbOnly(),
    applySceneMaterialState: (carMount, wheelMount) => applySceneMaterialState(carMount, wheelMount)
  }
});
const {
  initializeBuiltInCarOptions,
  initializeEngineOptions,
  initializeDrivingStyleOptions,
  usesSocketWheelAnchors,
  applyEngineSnapshot,
  syncEngineOutputs,
  applySteeringWheelState,
  applyGarageRuntimeSnapshot,
  toggleDoorState,
  updateDoorAnimation,
  syncGarageControlOutputs,
  getSelectedBuiltInCar,
  applyBuiltInCarPreset,
  remountTires,
  updateWheelFit,
  refreshCarTextureSlots,
  syncTextureEditorUi,
  getSelectedCarTextureSlot,
  applyUploadedTexture,
  textureToBlob,
  triggerDownload,
  stripFileExtension,
  slugifyFilename,
  exportCarAsset
} = garageVehicleRuntime;
applyGarageSnapshot = applyGarageRuntimeSnapshot;

const stageRuntime = createStageRuntime({
  config: MODEL_CONFIG,
  state,
  ui,
  helpers: {
    clearGroup,
    disposeObjectTree,
    focusVehicle,
    focusStage
  },
  callbacks: {
    stageOptions: STAGE_OPTIONS,
    getPlayerSystem: () => playerSystem,
    createStage,
    getStageLabel,
    getStageBehaviorId,
    isSanVerdeStageId,
    resolveAssignedGlbOnly: (stage) => resolveSanVerdeAssignedGlbOnly(stage),
    initializeStageFeedback,
    disposeStageFeedback,
    createStageGroundSampler,
    createStageCollisionSampler,
    createBounceStagePhysics,
    destroyBounceStagePhysics,
    getVehicleMassKg: () => engineAudio.getDefinition().physics.massKg,
    applyStageShadowPolicy,
    applyStageAtmosphere,
    shouldUseStageOverview,
    syncStageRenderingMode,
    applyGarageSnapshot: (snapshot) => applyGarageSnapshot(snapshot),
    setDriveMode,
    setGarageStage,
    snapGarageCamera,
    updateGarageRuntime,
    refreshGarageStagePhysics,
    setLoadDone,
    setLoadScreen,
    setStatus: (message) => setStatus(message),
    minimapCanvasEl,
    renderStageMinimap,
    setMinimapVisible,
    setMinimapLabel,
    syncParkedVehicleProxies: (context) => vehicleManager.syncParkedVehicleProxies(context),
    syncAgentStage: (stage, position) => agentSystem.syncStage(stage, position)
  }
});
const {
  initializeStageOptions,
  loadInitialStage,
  initializeStageSamplingAndPhysics,
  destroyStageResources,
  refreshActiveStagePhysics,
  rebuildStage,
  contextStageUpdate,
  shouldShowStageMinimap,
  updateStageMinimapOverlay,
  getCurrentStage,
  getCurrentStagePhysicsRevision
} = stageRuntime;

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
let appContext = null;

initializeBuiltInCarOptions();
initializeEngineOptions();
initializeDrivingStyleOptions();
initializeStageOptions();
applyEngineSnapshot(engineAudio.getSnapshot());
ui.toggleLap.textContent = `Drive mode: ${state.driveMode ? 'On' : 'Off'}`;
ui.toggleAutopilot.textContent = `Autopilot: ${state.autopilotEnabled ? 'On' : 'Off'}`;
ui.toggleCinematic.textContent = `Camera: ${state.cinematicCameraEnabled ? 'Cinematic' : 'Normal'}`;
ui.toggleNavDebug.textContent = `Nav Debug: ${state.navDebugVisible ? 'On' : 'Off'}`;
ui.toggleAssignedGlbOnly.textContent = `Assigned GLB Test: ${resolveSanVerdeAssignedGlbOnly() ? 'On' : 'Off'}`;
ui.toggleFog.textContent = `Fog: ${state.fogEnabled ? 'On' : 'Off'}`;
syncGarageControlOutputs();
syncOverlayVisibility();

bootstrap().catch((error) => {
  console.error(error);
  setStatus('Renderer failed');
  ui.backend.textContent = 'Unavailable';
});

async function bootstrap() {
  const {
    clock,
    requestedRendererMode,
    renderer,
    performanceAttribution,
    scene,
    camera,
    controls
  } = await createRendererViewportRuntime({
    THREE,
    OrbitControls,
    ui,
    config: MODEL_CONFIG,
    getRequestedRendererMode,
    getEffectiveExposure,
    getEffectiveEnvironmentIntensity,
    createPerformanceAttributionTracker,
    instrumentRendererInfo
  });

  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyRig = createSkyRig(pmrem, getStageSkyPreset(state.selectedStageId));
  setPerfCategory(skyRig.sky, 'sky');
  scene.add(skyRig.sky);
  scene.background = null;
  scene.environment = skyRig.environment.texture;
  scene.backgroundIntensity = 1;

  const {
    loadingManager,
    gltfLoader,
    fbxLoader
  } = createAssetLoaderRuntime({
    THREE,
    GLTFLoader,
    FBXLoader,
    DRACOLoader,
    KTX2Loader,
    MeshoptDecoder,
    renderer,
    resolvePublicUrl
  });

  const lightingRig = createLightingRig();
  const contactShadow = createVehicleContactShadow();
  const agentMount = agentSystem.agentRoot;
  const navigationDebugMount = agentSystem.debugRoot;
  const bootstrapStageMount = new THREE.Group();
  const stage = await loadInitialStage({
    stageId: state.selectedStageId,
    context: {
      scene,
      stageMount: bootstrapStageMount,
      gltfLoader,
      loadingManager
    }
  });
  const {
    stageMount,
    auxVehicleMount,
    vehicleRoot,
    carMount,
    wheelMount,
    characterMount
  } = createSceneAssemblyRuntime({
    THREE,
    scene,
    stage,
    lightingRig,
    contactShadow,
    agentMount,
    navigationDebugMount,
    setPerfCategory
  });

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

  const context = createAppContextRuntime({
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
    applyGarageSnapshot,
    clearGroup,
    contactShadow,
    focusVehicle,
    focusStage,
    shouldUseStageOverview
  });
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
  updateStageMinimapOverlay(context);

  wireMainUi({
    ui,
    state,
    context,
    vehicleManager,
    playerSystem,
    applyGarageSnapshot,
    setEngineType,
    setStageId: rebuildStage,
    rebuildStage,
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
    applyUploadedTexture,
    exportCarAsset
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
    const currentStage = getCurrentStage();
    controls.autoRotate = !state.driveMode && state.autoRotate;
    controls.autoRotateSpeed = 0.55;
    updateOverviewPan(context.controls, context.camera, deltaSeconds);
    applyGarageSnapshot(updateGarageRuntime(gameRuntime, deltaSeconds));
    playerSystem.updateFrame(context, deltaSeconds);
    updateDoorAnimation(deltaSeconds);
    contextStageUpdate(context, currentStage, playerSystem.getActiveStagePosition(context));
    if ((currentStage?.physicsRevision ?? 0) !== getCurrentStagePhysicsRevision()) {
      refreshActiveStagePhysics(context);
    }
    agentSystem.update(currentStage, playerSystem.getActiveStagePosition(context), deltaSeconds);
    updateStageMinimapOverlay(context);
    updateKeyLightShadowFocus(context);
    updateVehicleContactShadow(context);
    renderer.info.reset();
    performanceAttribution.resetFrame();
    if (context.useSimpleForwardRender) {
      renderer.render(scene, camera);
    } else {
      renderPipeline.render();
    }
    updatePerformanceOverlay(renderer, deltaSeconds, performanceAttribution, currentStage);
  });
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


function collectTireSocketPosition(rootObject) {
  let socket = null;

  rootObject.traverse((child) => {
    if (!socket && child.name && /socket/i.test(child.name)) {
      socket = child.position.clone();
    }
  });

  return socket;
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

async function unlockEngineAudio(runtime) {
  try {
    applyGarageSnapshot(await ensureGarageAudioReady(runtime));
  } catch (error) {
    console.error(error);
  }
}

function updatePerformanceOverlay(renderer, deltaSeconds, performanceAttribution, stage = null) {
  const perf = state.performance;
  perf.frameAccumulator += deltaSeconds;
  perf.frameCount += 1;
  const renderInfo = renderer.info.render;
  const memoryInfo = renderer.info.memory;
  perf.peakDraws = Math.max(perf.peakDraws, renderInfo.drawCalls);
  perf.peakTriangles = Math.max(perf.peakTriangles, renderInfo.triangles);
  const topSummary = performanceAttribution.formatTopSummary(3);
  const sanVerdeChunkSummary = getStageBehaviorId(stage?.id) === 'san_verde'
    ? performanceAttribution.formatPrefixSummary('sv:', 3)
    : '';
  perf.drawCategorySummary = sanVerdeChunkSummary
    ? `${topSummary} || SV: ${sanVerdeChunkSummary}`
    : topSummary;

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

function syncOverlayVisibility() {
  ui.hud.classList.toggle('is-hidden', !state.uiOpen);
  setUiOpen(state.uiOpen);
  setPerformanceOpen(state.performanceOpen);
  setMinimapVisible(shouldShowStageMinimap(state.selectedStageId));
}
