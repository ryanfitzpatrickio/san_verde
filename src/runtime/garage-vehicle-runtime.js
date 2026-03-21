import { BUILT_IN_VEHICLES, getBuiltInVehicleById } from '../assets/vehicle-registry.js';
import { ENGINE_LIBRARY } from '../engine-system.js';
import { applyMountedCarSteeringWheelPose } from '../vehicles/mounted-car-controller.js';

function cloneSuspensionOverrides(overrides) {
  return overrides ? { ...overrides } : null;
}

export function createGarageVehicleRuntime({
  config,
  state,
  ui,
  carVehicle,
  helpers,
  callbacks
}) {
  const { THREE, gltfExporter } = helpers;
  const {
    getGameRuntime,
    getAppContext,
    getPlayerSystem,
    syncParkedVehicleProxies,
    applyGarageSnapshot,
    setChassisHeight,
    setSuspensionOverrides,
    setWheelRadius,
    getEffectiveExposure,
    setEngineName,
    setEngineGear,
    setEngineRpm,
    setVehicleSpeed,
    setStatus,
    resolveAssignedGlbOnly,
    applySceneMaterialState
  } = callbacks;

  function collectCarTextureSlots(rootObject) {
    if (!rootObject) {
      return [];
    }

    const slots = new Map();

    rootObject.traverse((child) => {
      if (!child.isMesh || !child.material) {
        return;
      }

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material, materialIndex) => {
        const texture = material?.map;
        if (!texture || !texture.isTexture || !texture.image) {
          return;
        }

        const label = material.name?.trim()
          || child.name?.trim()
          || `Mesh ${materialIndex + 1}`;
        const key = `${child.uuid}:${materialIndex}:${label}`;

        if (!slots.has(key)) {
          slots.set(key, {
            id: key,
            label,
            texture,
            bindings: []
          });
        }

        slots.get(key).bindings.push({ material, mesh: child });
      });
    });

    return [...slots.values()].sort((left, right) => left.label.localeCompare(right.label));
  }

  function getSelectedCarTextureSlot() {
    return state.carTextureSlots.find((slot) => slot.id === state.selectedCarTextureSlotId) || null;
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

  function refreshCarTextureSlots() {
    state.carTextureSlots = collectCarTextureSlots(state.carAsset);

    if (!state.carTextureSlots.length) {
      state.selectedCarTextureSlotId = '';
    } else if (!state.carTextureSlots.some((slot) => slot.id === state.selectedCarTextureSlotId)) {
      state.selectedCarTextureSlotId = state.carTextureSlots[0].id;
    }

    syncTextureEditorUi();
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

  async function exportCarAsset() {
    if (!state.carAsset) {
      throw new Error('Load a car GLB before exporting');
    }

    const binary = await gltfExporter.parseAsync(state.carAsset, {
      binary: true,
      onlyVisible: false,
      maxTextureSize: 8192
    });
    const filename = `${slugifyFilename(stripFileExtension(state.carSource || 'car'))}-retouched.glb`;
    triggerDownload(new Blob([binary], { type: 'model/gltf-binary' }), filename);
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

  function initializeDrivingStyleOptions() {
    ui.driveStyle.innerHTML = Object.values(config.drivingStyles)
      .map((style) => `<option value="${style.id}">${style.label}</option>`)
      .join('');
    ui.driveStyle.value = state.drivingStyle;
    ui.driveStyleDescription.textContent =
      config.drivingStyles[state.drivingStyle]?.description || '';
  }

  function usesSocketWheelAnchors() {
    return state.carWheelAnchors?.length === 4;
  }

  function syncEngineOutputs() {
    setEngineName(state.engineName);
    setEngineGear(state.engineGearLabel);
    setEngineRpm(`${Math.round(state.engineRpm).toLocaleString()} rpm`);
    setVehicleSpeed(`${Math.round(Math.abs(state.driveSpeed) * 2.23694).toLocaleString()} mph`);
    ui.engineDescription.textContent = state.engineDescription;
    ui.engineType.value = state.engineTypeId;
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

  function applySteeringWheelState() {
    applyMountedCarSteeringWheelPose(
      state.steeringWheelRig,
      state.steerAngle,
      config.steeringWheelTurnRatio
    );
  }

  function applyGarageRuntimeSnapshot(snapshot) {
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
    ui.toggleAssignedGlbOnly.textContent = `Assigned GLB Test: ${resolveAssignedGlbOnly() ? 'On' : 'Off'}`;
    ui.toggleFog.textContent = `Fog: ${state.fogEnabled ? 'On' : 'Off'}`;
    ui.driveStyle.value = state.drivingStyle;
    ui.driveStyleDescription.textContent =
      config.drivingStyles[state.drivingStyle]?.description || '';
    getPlayerSystem()?.syncOverlay?.(getAppContext());
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

  function syncGarageControlOutputs() {
    ui.driveStyle.value = state.drivingStyle;
    ui.driveStyleDescription.textContent =
      config.drivingStyles[state.drivingStyle]?.description || '';
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
    ui.toggleAssignedGlbOnly.textContent = `Assigned GLB Test: ${resolveAssignedGlbOnly() ? 'On' : 'Off'}`;
    ui.rideHeight.disabled = usesSocketWheelAnchors();
    ui.rideHeight.title = usesSocketWheelAnchors() ? 'Socketed cars author wheel height in the GLB.' : '';
    syncEngineOutputs();
    syncTextureEditorUi();
  }

  function getSelectedBuiltInCar() {
    return getBuiltInVehicleById(state.selectedBuiltInCarId);
  }

  function getActiveTireAssets() {
    return {
      front: state.tireAssetsByAxle.front || state.tireAsset,
      rear: state.tireAssetsByAxle.rear || state.tireAsset
    };
  }

  function remountTires(wheelMount, context = getAppContext()) {
    state.wheelRadius = carVehicle.remountWheels({
      wheelMount,
      activeTireAssets: getActiveTireAssets(),
      carMetrics: state.carMetrics,
      carWheelAnchors: state.carWheelAnchors,
      embeddedWheelAssets: state.carEmbeddedWheelAssets
    });

    const gameRuntime = getGameRuntime();
    if (gameRuntime) {
      applyGarageSnapshot(setWheelRadius(gameRuntime, state.wheelRadius));
    }

    if (context) {
      syncParkedVehicleProxies(context);
    }
  }

  function updateWheelFit(context) {
    remountTires(context.wheelMount, context);
    applySceneMaterialState(context.carMount, context.wheelMount);
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
    state.leftSideTireRotation = Array.isArray(preset.leftSideTireRotation) && preset.leftSideTireRotation.length === 3
      ? [...preset.leftSideTireRotation]
      : [...config.leftSideTireRotation];
    state.leftSideTireMirror = Boolean(
      'leftSideTireMirror' in preset ? preset.leftSideTireMirror : config.leftSideTireMirror
    );
    state.rightSideTireRotation = Array.isArray(preset.rightSideTireRotation) && preset.rightSideTireRotation.length === 3
      ? [...preset.rightSideTireRotation]
      : [...config.rightSideTireRotation];
    state.rightSideTireMirror = Boolean(
      'rightSideTireMirror' in preset ? preset.rightSideTireMirror : config.rightSideTireMirror
    );
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
    const gameRuntime = getGameRuntime();
    if (gameRuntime) {
      applyGarageSnapshot(setChassisHeight(gameRuntime, state.chassisHeight));
      applyGarageSnapshot(setSuspensionOverrides(gameRuntime, state.suspensionOverrides));
    }
    syncGarageControlOutputs();
    updateWheelFit(context);
  }

  return {
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
  };
}
