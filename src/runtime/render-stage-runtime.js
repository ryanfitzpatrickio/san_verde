export function createRenderStageRuntime({
  THREE,
  SkyMesh,
  ssgi,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
  config,
  state,
  ui,
  callbacks
}) {
  const CHARACTER_LIGHT_POSITION = new THREE.Vector3();
  const CHARACTER_LIGHT_TARGET = new THREE.Vector3();
  const CHARACTER_KEY_DIRECTION = new THREE.Vector3();
  const CHARACTER_VIEW_DIRECTION = new THREE.Vector3();
  const CHARACTER_FILL_DIRECTION = new THREE.Vector3();
  const CHARACTER_RIM_DIRECTION = new THREE.Vector3();
  const CHARACTER_CAMERA_BIAS = new THREE.Vector3();
  const CHARACTER_CAMERA_FLAT = new THREE.Vector3();

  const {
    getStageBehaviorId,
    applySceneMaterialState,
    getPlayerSystem
  } = callbacks;

  function updateKeyLightShadowFocus(context) {
    const lights = context?.lightingRig?.userData?.lights;
    const key = lights?.key;
    if (!key?.shadow?.camera) {
      return;
    }

    const focusTarget = getPlayerSystem()?.getActiveStagePosition?.(context) || state.vehiclePosition;
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

  function shouldUseCharacterLighting(context) {
    return Boolean(
      context?.characterController &&
      state.characterLoaded &&
      !state.driveMode &&
      (
        state.characterVehicleState === 'on_foot' ||
        state.characterVehicleState === 'entering' ||
        state.characterVehicleState === 'exiting' ||
        state.characterVehicleState === 'wipeout'
      )
    );
  }

  function hideCharacterLighting(lights) {
    if (!lights) {
      return;
    }

    lights.fill.visible = false;
    lights.rim.visible = false;
    lights.overheadCard.visible = false;
    lights.sideCard.visible = false;
  }

  function getCharacterLightingProfile(stageId = state.selectedStageId) {
    stageId = getStageBehaviorId(stageId);
    if (stageId === 'test_course' || stageId === 'san_verde') {
      return {
        fillIntensity: 12,
        fillBoost: 10,
        rimIntensity: 8,
        rimBoost: 4,
        fillDistance: 24,
        rimDistance: 18
      };
    }

    if (stageId === 'bloomville') {
      return {
        fillIntensity: 10,
        fillBoost: 8,
        rimIntensity: 7,
        rimBoost: 3,
        fillDistance: 22,
        rimDistance: 16
      };
    }

    return {
      fillIntensity: 9,
      fillBoost: 6,
      rimIntensity: 6,
      rimBoost: 2.5,
      fillDistance: 20,
      rimDistance: 15
    };
  }

  function updateCharacterLighting(context) {
    const lights = context?.lightingRig?.userData?.lights;
    if (!lights) {
      return;
    }

    if (!shouldUseCharacterLighting(context)) {
      hideCharacterLighting(lights);
      return;
    }

    const controller = context.characterController;
    const camera = context.camera;
    const key = lights.key;
    if (!controller || !camera || !key) {
      hideCharacterLighting(lights);
      return;
    }

    CHARACTER_LIGHT_POSITION.copy(controller.position);
    CHARACTER_LIGHT_TARGET.copy(controller.position);
    CHARACTER_LIGHT_TARGET.y += 1.15;
    CHARACTER_LIGHT_POSITION.y += 1.1;

    CHARACTER_KEY_DIRECTION.subVectors(key.position, CHARACTER_LIGHT_TARGET);
    CHARACTER_KEY_DIRECTION.y = 0;
    if (CHARACTER_KEY_DIRECTION.lengthSq() < 1e-6) {
      CHARACTER_KEY_DIRECTION.set(0.65, 0, 0.35);
    } else {
      CHARACTER_KEY_DIRECTION.normalize();
    }

    CHARACTER_VIEW_DIRECTION.subVectors(camera.position, CHARACTER_LIGHT_TARGET);
    CHARACTER_VIEW_DIRECTION.y = 0;
    if (CHARACTER_VIEW_DIRECTION.lengthSq() < 1e-6) {
      CHARACTER_VIEW_DIRECTION.set(0, 0, 1);
    } else {
      CHARACTER_VIEW_DIRECTION.normalize();
    }

    const backlightFactor = THREE.MathUtils.clamp(
      (1 - CHARACTER_VIEW_DIRECTION.dot(CHARACTER_KEY_DIRECTION)) * 0.5,
      0,
      1
    );
    const profile = getCharacterLightingProfile(state.selectedStageId);

    CHARACTER_CAMERA_FLAT
      .subVectors(CHARACTER_LIGHT_TARGET, camera.position)
      .setY(0);
    if (CHARACTER_CAMERA_FLAT.lengthSq() < 1e-6) {
      CHARACTER_CAMERA_FLAT.copy(CHARACTER_VIEW_DIRECTION).negate();
    } else {
      CHARACTER_CAMERA_FLAT.normalize();
    }

    CHARACTER_FILL_DIRECTION
      .copy(CHARACTER_KEY_DIRECTION)
      .negate()
      .multiplyScalar(0.74);
    CHARACTER_CAMERA_BIAS.copy(CHARACTER_CAMERA_FLAT).multiplyScalar(0.9);
    CHARACTER_FILL_DIRECTION.add(CHARACTER_CAMERA_BIAS);
    CHARACTER_FILL_DIRECTION.y = 0;
    if (CHARACTER_FILL_DIRECTION.lengthSq() < 1e-6) {
      CHARACTER_FILL_DIRECTION.copy(CHARACTER_CAMERA_FLAT);
    } else {
      CHARACTER_FILL_DIRECTION.normalize();
    }

    lights.fill.visible = true;
    lights.fill.intensity = profile.fillIntensity + backlightFactor * profile.fillBoost;
    lights.fill.distance = profile.fillDistance;
    lights.fill.position.copy(CHARACTER_LIGHT_POSITION)
      .addScaledVector(CHARACTER_FILL_DIRECTION, 2.6)
      .addScaledVector(CHARACTER_KEY_DIRECTION, -0.8);
    lights.fill.position.y += 1.5;
    lights.fill.target.position.copy(CHARACTER_LIGHT_TARGET);

    CHARACTER_RIM_DIRECTION
      .copy(CHARACTER_VIEW_DIRECTION)
      .negate()
      .multiplyScalar(0.68)
      .addScaledVector(CHARACTER_KEY_DIRECTION, 0.7);
    CHARACTER_RIM_DIRECTION.y = 0;
    if (CHARACTER_RIM_DIRECTION.lengthSq() < 1e-6) {
      CHARACTER_RIM_DIRECTION.copy(CHARACTER_KEY_DIRECTION);
    } else {
      CHARACTER_RIM_DIRECTION.normalize();
    }

    lights.rim.visible = backlightFactor > 0.08;
    lights.rim.intensity = profile.rimIntensity + backlightFactor * profile.rimBoost;
    lights.rim.distance = profile.rimDistance;
    lights.rim.position.copy(CHARACTER_LIGHT_POSITION)
      .addScaledVector(CHARACTER_RIM_DIRECTION, 2.2);
    lights.rim.position.y += 2.4;
    lights.rim.target.position.copy(CHARACTER_LIGHT_TARGET);

    lights.overheadCard.visible = false;
    lights.sideCard.visible = false;
  }

  function shouldUseCheapDirectionalShadows(stageId) {
    stageId = getStageBehaviorId(stageId);
    return stageId === 'test_course' || stageId === 'bloomville' || stageId === 'san_verde';
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

  function applyStageShadowPolicy(stage) {
    const root = stage?.group;
    if (!root) {
      return;
    }

    root.traverse((child) => {
      if (!child.isMesh) {
        return;
      }
      child.castShadow = shouldPreserveStageShadowCaster(child);
    });
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

    const sampleGround = context?.stage?.sampleGround;
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
    ssgiPass.radius.value = config.dynamicGiRadius;
    ssgiPass.thickness.value = 1.5;
    ssgiPass.sliceCount.value = config.dynamicGiSliceCount;
    ssgiPass.stepCount.value = config.dynamicGiStepCount;
    ssgiPass.giIntensity.value = config.dynamicGiIntensity;
    ssgiPass.aoIntensity.value = config.dynamicAoIntensity;
    ssgiPass.useTemporalFiltering = false;

    const originalSetSize = ssgiPass.setSize.bind(ssgiPass);
    ssgiPass.setSize = (width, height) =>
      originalSetSize(
        Math.max(1, Math.round(width * config.dynamicGiResolutionScale)),
        Math.max(1, Math.round(height * config.dynamicGiResolutionScale))
      );

    const aoComposite = ssgiPass.w.mul(config.dynamicAoCompositeIntensity).add(
      1 - config.dynamicAoCompositeIntensity
    );
    const giComposite = sceneColor
      .mul(aoComposite)
      .add(ssgiPass.xyz.mul(config.dynamicGiCompositeIntensity));
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
    key.shadow.mapSize.setScalar(config.shadowMapSize);
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
    const t = (hour - 6) / 12;
    const elevation = Math.sin(Math.PI * t) * 66 - 3;
    const azimuth = 90 + t * 180;
    const dayFactor = Math.max(0, Math.sin(Math.PI * t));

    return {
      key: `sv_h${Math.floor(hour)}`,
      turbidity: THREE.MathUtils.lerp(11, 5, dayFactor),
      rayleigh: THREE.MathUtils.lerp(1.1, 2.0, dayFactor),
      mieCoefficient: THREE.MathUtils.lerp(0.008, 0.003, dayFactor),
      mieDirectionalG: 0.82,
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

  function getSunPositionVector(preset) {
    const phi = THREE.MathUtils.degToRad(90 - preset.elevation);
    const theta = THREE.MathUtils.degToRad(preset.azimuth);
    return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
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

  function createSkyRig(pmrem, preset = getStageSkyPreset()) {
    const sky = new SkyMesh();
    sky.scale.setScalar(9000);
    sky.material.depthWrite = false;
    applySkyPresetToObject(sky, preset);
    const environment = buildSkyEnvironment(pmrem, preset);
    return { sky, environment, presetKey: preset.key };
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

  function syncStageRenderingMode(context) {
    if (!context?.renderer || !context?.stage) {
      return;
    }

    const useSimpleForwardRender = true;
    const useCheapDirectionalShadows = shouldUseCheapDirectionalShadows(state.selectedStageId);
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
      const now = new Date();
      const hour = now.getHours() + now.getMinutes() / 60;
      const t = (hour - 6) / 12;
      const dayFactor = Math.max(0, Math.sin(Math.PI * t));
      const isNight = hour < 5 || hour >= 21;
      let fogColor;
      if (isNight) {
        fogColor = '#0d1828';
      } else {
        fogColor = new THREE.Color()
          .lerpColors(new THREE.Color('#c08050'), new THREE.Color('#a0c0d8'), dayFactor)
          .getStyle();
      }
      scene.fog = new THREE.FogExp2(fogColor, 0.00020);
      return;
    }

    scene.fog = new THREE.FogExp2('#90b3d5', 0.0065);
  }

  return {
    updateKeyLightShadowFocus,
    updateCharacterLighting,
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
  };
}
