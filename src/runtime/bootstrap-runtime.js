export async function createRendererViewportRuntime({
  THREE,
  OrbitControls,
  ui,
  config,
  getRequestedRendererMode,
  getEffectiveExposure,
  getEffectiveEnvironmentIntensity,
  createPerformanceAttributionTracker,
  instrumentRendererInfo
}) {
  const clock = new THREE.Timer();
  clock.connect(document);
  const requestedRendererMode = getRequestedRendererMode();
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    forceWebGL: requestedRendererMode === 'webgl'
  });
  const performanceAttribution = createPerformanceAttributionTracker();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.renderPixelRatioCap));
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

  return {
    clock,
    requestedRendererMode,
    renderer,
    performanceAttribution,
    scene,
    camera,
    controls
  };
}

export function createAssetLoaderRuntime({
  THREE,
  GLTFLoader,
  FBXLoader,
  DRACOLoader,
  KTX2Loader,
  MeshoptDecoder,
  renderer,
  resolvePublicUrl
}) {
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

  return {
    loadingManager,
    dracoLoader,
    ktx2Loader,
    gltfLoader,
    fbxLoader
  };
}

export function createSceneAssemblyRuntime({
  THREE,
  scene,
  stage,
  lightingRig,
  contactShadow,
  agentMount,
  navigationDebugMount,
  setPerfCategory
}) {
  const stageMount = new THREE.Group();
  const auxVehicleMount = new THREE.Group();
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
  stageMount.add(stage.group);
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

  return {
    stageMount,
    auxVehicleMount,
    vehicleRoot,
    carMount,
    wheelMount,
    characterMount
  };
}

export function createAppContextRuntime({
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
}) {
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

  return context;
}
