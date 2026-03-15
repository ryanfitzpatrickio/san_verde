export function wireMainUi(options) {
  const {
    ui,
    state,
    context,
    vehicleManager,
    playerSystem,
    applyGarageSnapshot,
    setEngineType,
    setStageId,
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
    loadSelectedBuiltInCar,
    loadLocalAsset,
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
  } = options;

  ui.builtInCar.addEventListener('change', async () => {
    const selectedId = ui.builtInCar.value;
    if (!selectedId) {
      return;
    }

    state.selectedBuiltInCarId = selectedId;
    await loadSelectedBuiltInCar(context);
  });

  ui.engineType.addEventListener('change', () => {
    state.engineTypeId = ui.engineType.value;
    applyGarageSnapshot(setEngineType(context.gameRuntime, state.engineTypeId));
    setStatus(`${state.engineName} loaded`);
  });

  ui.driveStyle.addEventListener('change', () => {
    state.drivingStyle = ui.driveStyle.value;
    applyGarageSnapshot(setDrivingStyle(context.gameRuntime, state.drivingStyle));
    setStatus(
      state.drivingStyle === 'arcade'
        ? 'Arcade mode enabled'
        : 'Sim mode enabled'
    );
  });

  ui.stageType.addEventListener('change', async () => {
    state.selectedStageId = ui.stageType.value;
    await setStageId(context, state.selectedStageId);
  });

  ui.exposure.addEventListener('input', () => {
    state.exposure = Number(ui.exposure.value);
    context.renderer.toneMappingExposure = context.stage?.id === 'san_verde' || context.stage?.id === 'test_course'
      ? state.exposure * 0.98 * (context.stage.id === 'san_verde' ? 0.62 : 0.68)
      : state.exposure * 0.98;
    ui.exposureValue.textContent = state.exposure.toFixed(2);
  });

  ui.environment.addEventListener('input', () => {
    state.environmentIntensity = Number(ui.environment.value);
    ui.environmentValue.textContent = state.environmentIntensity.toFixed(2);
    applySceneMaterialState(context.carMount, context.wheelMount);
    if (context.scene) {
      const stageId = context.stage?.id;
      const stageScale = stageId === 'san_verde' ? 0.02 : stageId === 'test_course' ? 0.04 : 1;
      const skyScale = stageId === 'san_verde' ? 0.42 : 1;
      context.scene.environmentIntensity = state.environmentIntensity * stageScale * skyScale;
    }
  });

  ui.tireScale.addEventListener('input', () => {
    state.tireScale = Number(ui.tireScale.value);
    ui.tireScaleValue.textContent = state.tireScale.toFixed(2);
    updateWheelFit(context);
  });

  ui.frontAxle.addEventListener('input', () => {
    state.frontAxleRatio = Number(ui.frontAxle.value);
    ui.frontAxleValue.textContent = state.frontAxleRatio.toFixed(3);
    updateWheelFit(context);
  });

  ui.rearAxle.addEventListener('input', () => {
    state.rearAxleRatio = Number(ui.rearAxle.value);
    ui.rearAxleValue.textContent = state.rearAxleRatio.toFixed(3);
    updateWheelFit(context);
  });

  ui.rideHeight.addEventListener('input', () => {
    state.rideHeight = Number(ui.rideHeight.value);
    ui.rideHeightValue.textContent = state.rideHeight.toFixed(3);

    if (usesSocketWheelAnchors()) {
      return;
    }

    updateWheelFit(context);
  });

  ui.chassisHeight.addEventListener('input', () => {
    state.chassisHeight = Number(ui.chassisHeight.value);
    ui.chassisHeightValue.textContent = state.chassisHeight.toFixed(3);
    applyGarageSnapshot(setChassisHeight(context.gameRuntime, state.chassisHeight));
    if (!state.driveMode) {
      playerSystem.focusCurrentTarget(context, context.focusOptions);
    }
  });

  ui.sideInset.addEventListener('input', () => {
    state.sideInset = Number(ui.sideInset.value);
    ui.sideInsetValue.textContent = state.sideInset.toFixed(3);
    updateWheelFit(context);
  });

  ui.rotateX.addEventListener('input', () => {
    state.tireRotation[0] = Number(ui.rotateX.value);
    ui.rotateXValue.textContent = state.tireRotation[0].toFixed(2);
    updateWheelFit(context);
  });

  ui.rotateY.addEventListener('input', () => {
    state.tireRotation[1] = Number(ui.rotateY.value);
    ui.rotateYValue.textContent = state.tireRotation[1].toFixed(2);
    updateWheelFit(context);
  });

  ui.rotateZ.addEventListener('input', () => {
    state.tireRotation[2] = Number(ui.rotateZ.value);
    ui.rotateZValue.textContent = state.tireRotation[2].toFixed(2);
    updateWheelFit(context);
  });

  const bindBikeVectorSlider = (input, value, vector, axis) => {
    input.addEventListener('input', () => {
      vector[axis] = Number(input.value);
      value.textContent = vector[axis].toFixed(3);
      vehicleManager.updateBikeWheelFit(context);
    });
  };

  const bindBikeRotationSlider = (input, value, rotation, index) => {
    input.addEventListener('input', () => {
      rotation[index] = Number(input.value);
      value.textContent = rotation[index].toFixed(2);
      vehicleManager.updateBikeWheelFit(context);
    });
  };

  ui.bikeFrontSpinAxis.addEventListener('change', () => {
    state.bikeFrontSpinAxis = ui.bikeFrontSpinAxis.value;
    vehicleManager.updateBikeWheelFit(context);
  });

  ui.bikeRearSpinAxis.addEventListener('change', () => {
    state.bikeRearSpinAxis = ui.bikeRearSpinAxis.value;
    vehicleManager.updateBikeWheelFit(context);
  });

  bindBikeVectorSlider(ui.bikeFrontOffsetX, ui.bikeFrontOffsetXValue, state.bikeFrontWheelOffset, 'x');
  bindBikeVectorSlider(ui.bikeFrontOffsetY, ui.bikeFrontOffsetYValue, state.bikeFrontWheelOffset, 'y');
  bindBikeVectorSlider(ui.bikeFrontOffsetZ, ui.bikeFrontOffsetZValue, state.bikeFrontWheelOffset, 'z');
  bindBikeRotationSlider(ui.bikeFrontRotateX, ui.bikeFrontRotateXValue, state.bikeFrontWheelRotation, 0);
  bindBikeRotationSlider(ui.bikeFrontRotateY, ui.bikeFrontRotateYValue, state.bikeFrontWheelRotation, 1);
  bindBikeRotationSlider(ui.bikeFrontRotateZ, ui.bikeFrontRotateZValue, state.bikeFrontWheelRotation, 2);
  bindBikeVectorSlider(ui.bikeRearOffsetX, ui.bikeRearOffsetXValue, state.bikeRearWheelOffset, 'x');
  bindBikeVectorSlider(ui.bikeRearOffsetY, ui.bikeRearOffsetYValue, state.bikeRearWheelOffset, 'y');
  bindBikeVectorSlider(ui.bikeRearOffsetZ, ui.bikeRearOffsetZValue, state.bikeRearWheelOffset, 'z');
  bindBikeRotationSlider(ui.bikeRearRotateX, ui.bikeRearRotateXValue, state.bikeRearWheelRotation, 0);
  bindBikeRotationSlider(ui.bikeRearRotateY, ui.bikeRearRotateYValue, state.bikeRearWheelRotation, 1);
  bindBikeRotationSlider(ui.bikeRearRotateZ, ui.bikeRearRotateZValue, state.bikeRearWheelRotation, 2);

  ui.toggleRotation.addEventListener('click', () => {
    state.autoRotate = !state.autoRotate;
    ui.toggleRotation.textContent = `Auto-rotate: ${state.autoRotate ? 'On' : 'Off'}`;
  });

  ui.toggleLap.addEventListener('click', () => {
    if (state.driveMode) {
      if (state.activeVehicleKind === 'bike') {
        playerSystem.directExitVehicle(context);
      } else {
        playerSystem.exitVehicle(context);
      }
      return;
    }

    if (context.characterController) {
      if (!vehicleManager.tryMountNearbyVehicle(context) && !playerSystem.tryEnterVehicle(context)) {
        setStatus('Move closer to a vehicle to drive');
      }
      return;
    }

    playerSystem.enterVehicle(context);
  });

  ui.toggleAutopilot.addEventListener('click', () => {
    state.autopilotEnabled = !state.autopilotEnabled;
    applyGarageSnapshot(setAutopilotEnabled(context.gameRuntime, state.autopilotEnabled));
    setStatus(state.autopilotEnabled ? 'Autopilot enabled' : 'Autopilot disabled');
  });

  ui.toggleCinematic.addEventListener('click', () => {
    state.cinematicCameraEnabled = !state.cinematicCameraEnabled;
    applyGarageSnapshot(setCinematicCameraEnabled(context.gameRuntime, state.cinematicCameraEnabled));
    setStatus(state.cinematicCameraEnabled ? 'Cinematic camera enabled' : 'Cinematic camera disabled');
  });

  ui.toggleNavDebug.addEventListener('click', () => {
    state.navDebugVisible = !state.navDebugVisible;
    ui.toggleNavDebug.textContent = `Nav Debug: ${state.navDebugVisible ? 'On' : 'Off'}`;
    setStatus(state.navDebugVisible ? 'Navigation debug enabled' : 'Navigation debug disabled');
  });

  ui.toggleFog.addEventListener('click', () => {
    state.fogEnabled = !state.fogEnabled;
    ui.toggleFog.textContent = `Fog: ${state.fogEnabled ? 'On' : 'Off'}`;
    applyStageAtmosphere(context.scene, state.selectedStageId);
    setStatus(state.fogEnabled ? 'Fog enabled' : 'Fog disabled');
  });

  ui.toggleDoor.addEventListener('click', () => {
    toggleDoorState();
  });

  ui.resetCamera.addEventListener('click', () => {
    if (state.driveMode) {
      applyGarageSnapshot(snapGarageCamera(context.gameRuntime));
      applyGarageSnapshot(updateGarageRuntime(context.gameRuntime, 0));
      return;
    }

    playerSystem.focusCurrentTarget(context, context.focusOptions);
  });

  const setDriveKey = (code, active) => {
    if (context.characterController && !state.driveMode && state.characterVehicleState === 'on_foot') {
      if (code === 'KeyW' || code === 'ArrowUp') {
        state.characterInput.forward = active;
        return true;
      }

      if (code === 'KeyS' || code === 'ArrowDown') {
        state.characterInput.backward = active;
        return true;
      }

      if (code === 'KeyA' || code === 'ArrowLeft') {
        state.characterInput.left = active;
        return true;
      }

      if (code === 'KeyD' || code === 'ArrowRight') {
        state.characterInput.right = active;
        return true;
      }

      if (code === 'ShiftLeft' || code === 'ShiftRight') {
        state.characterInput.run = active;
        return true;
      }

      if (code === 'Space') {
        state.characterInput.jump = active;
        return true;
      }
    }

    if (!state.driveMode && state.characterVehicleState === 'on_foot' && shouldUseStageOverview(state.selectedStageId)) {
      if (code === 'KeyW' || code === 'ArrowUp') {
        state.overviewPan.forward = active;
        return true;
      }

      if (code === 'KeyS' || code === 'ArrowDown') {
        state.overviewPan.backward = active;
        return true;
      }

      if (code === 'KeyA' || code === 'ArrowLeft') {
        state.overviewPan.left = active;
        return true;
      }

      if (code === 'KeyD' || code === 'ArrowRight') {
        state.overviewPan.right = active;
        return true;
      }
    }

    if (code === 'KeyW' || code === 'ArrowUp') {
      setDriveInput(context.gameRuntime, 'forward', active);
      return true;
    }

    if (code === 'KeyS' || code === 'ArrowDown') {
      setDriveInput(context.gameRuntime, 'reverse', active);
      return true;
    }

    if (code === 'KeyA' || code === 'ArrowLeft') {
      setDriveInput(context.gameRuntime, 'left', active);
      return true;
    }

    if (code === 'KeyD' || code === 'ArrowRight') {
      setDriveInput(context.gameRuntime, 'right', active);
      return true;
    }

    return false;
  };

  window.addEventListener('keydown', (event) => {
    unlockEngineAudio(context.gameRuntime);

    if (setDriveKey(event.code, true)) {
      event.preventDefault();
      return;
    }

    if (!event.repeat && event.code === 'KeyF') {
      if (state.driveMode) {
        if (state.activeVehicleKind === 'bike') {
          playerSystem.directExitVehicle(context);
        } else {
          playerSystem.exitVehicle(context);
        }
      } else if (context.characterController) {
        if (!vehicleManager.tryMountNearbyVehicle(context) && !playerSystem.tryEnterVehicle(context)) {
          setStatus('Move closer to a vehicle to drive');
        }
      } else {
        playerSystem.enterVehicle(context);
      }
      event.preventDefault();
      return;
    }

    if (!state.driveMode) {
      return;
    }

    if (!event.repeat && event.code === 'KeyU') {
      state.autopilotEnabled = !state.autopilotEnabled;
      applyGarageSnapshot(setAutopilotEnabled(context.gameRuntime, state.autopilotEnabled));
      setStatus(state.autopilotEnabled ? 'Autopilot enabled' : 'Autopilot disabled');
      event.preventDefault();
      return;
    }

    if (!event.repeat && event.code === 'KeyI') {
      state.cinematicCameraEnabled = !state.cinematicCameraEnabled;
      applyGarageSnapshot(setCinematicCameraEnabled(context.gameRuntime, state.cinematicCameraEnabled));
      setStatus(state.cinematicCameraEnabled ? 'Cinematic camera enabled' : 'Cinematic camera disabled');
      event.preventDefault();
      return;
    }

    if (state.drivingStyle === 'arcade') {
      return;
    }

    if (!event.repeat && event.code === 'KeyE') {
      applyGarageSnapshot(shiftEngineUp(context.gameRuntime));
      setStatus(`Shifted to ${state.engineGearLabel}`);
      event.preventDefault();
      return;
    }

    if (!event.repeat && event.code === 'KeyQ') {
      applyGarageSnapshot(shiftEngineDown(context.gameRuntime));
      setStatus(`Shifted to ${state.engineGearLabel}`);
      event.preventDefault();
      return;
    }

    if (!event.repeat && event.code === 'KeyN') {
      applyGarageSnapshot(shiftEngineNeutral(context.gameRuntime));
      setStatus('Shifted to neutral');
      event.preventDefault();
      return;
    }
  });

  window.addEventListener('keyup', (event) => {
    if (setDriveKey(event.code, false)) {
      event.preventDefault();
    }
  });

  context.controls.addEventListener('start', () => {
    applyGarageSnapshot(setCameraOverride(context.gameRuntime, true));
  });

  context.controls.addEventListener('end', () => {
    applyGarageSnapshot(setCameraOverride(context.gameRuntime, false));
  });

  ui.toggleUi.addEventListener('click', () => {
    unlockEngineAudio(context.gameRuntime);
    state.uiOpen = !state.uiOpen;
    syncOverlayVisibility();
  });

  window.addEventListener(
    'pointerdown',
    () => {
      unlockEngineAudio(context.gameRuntime);
    },
    { passive: true }
  );

  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const typingTarget =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable;

    if (event.code === 'KeyO' && !typingTarget && !event.repeat) {
      state.uiOpen = !state.uiOpen;
      syncOverlayVisibility();
      event.preventDefault();
      return;
    }

    if (event.code === 'KeyP' && !typingTarget && !event.repeat) {
      state.performanceOpen = !state.performanceOpen;
      syncOverlayVisibility();
      event.preventDefault();
    }
  });

  ui.carInput.addEventListener('change', async (event) => {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    await loadLocalAsset(file, 'car', context);
    event.target.value = '';
  });

  ui.tireInput.addEventListener('change', async (event) => {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    await loadLocalAsset(file, 'tire', context);
    event.target.value = '';
  });

  ui.textureSlot.addEventListener('change', () => {
    state.selectedCarTextureSlotId = ui.textureSlot.value;
    syncTextureEditorUi();
  });

  ui.downloadTexture.addEventListener('click', async () => {
    const slot = getSelectedCarTextureSlot();
    if (!slot) {
      setStatus('No car texture slot selected');
      return;
    }

    try {
      setStatus(`Preparing ${slot.label} texture`);
      const blob = await textureToBlob(slot.texture);
      triggerDownload(blob, `${slugifyFilename(slot.label)}.png`);
      setStatus('Texture downloaded');
    } catch (error) {
      console.error(error);
      setStatus('Texture download failed');
    }
  });

  ui.textureInput.addEventListener('change', async (event) => {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    try {
      await applyUploadedTexture(file);
      applySceneMaterialState(context.carMount, context.wheelMount);
      setStatus('Replacement texture applied');
    } catch (error) {
      console.error(error);
      setStatus('Texture replacement failed');
    } finally {
      event.target.value = '';
    }
  });

  ui.exportCar.addEventListener('click', async () => {
    if (!state.carAsset) {
      setStatus('Load a car GLB before exporting');
      return;
    }

    try {
      setStatus('Exporting updated car GLB');
      const binary = await context.gltfExporter.parseAsync(state.carAsset, {
        binary: true,
        onlyVisible: false,
        maxTextureSize: 8192
      });
      triggerDownload(
        new Blob([binary], { type: 'model/gltf-binary' }),
        `${slugifyFilename(stripFileExtension(state.carSource || 'car'))}-retouched.glb`
      );
      setStatus('Updated car GLB exported');
    } catch (error) {
      console.error(error);
      setStatus('GLB export failed');
    }
  });

  const showDropOverlay = (active) => {
    ui.dropOverlay.classList.toggle('is-active', active);
  };

  window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    showDropOverlay(true);
  });

  window.addEventListener('dragover', (event) => {
    event.preventDefault();
    showDropOverlay(true);
  });

  window.addEventListener('dragleave', (event) => {
    if (event.target === document.documentElement || event.target === document.body) {
      showDropOverlay(false);
    }
  });

  window.addEventListener('drop', async (event) => {
    event.preventDefault();
    showDropOverlay(false);

    const files = [...(event.dataTransfer?.files || [])].filter((file) => file.name.toLowerCase().endsWith('.glb'));
    if (!files.length) {
      return;
    }

    for (const file of files) {
      const kind = /tire|wheel|rim/i.test(file.name) ? 'tire' : 'car';
      await loadLocalAsset(file, kind, context);
    }
  });
}
