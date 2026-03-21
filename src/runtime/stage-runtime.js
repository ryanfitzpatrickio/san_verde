export function createStageRuntime({
  config,
  state,
  ui,
  helpers,
  callbacks
}) {
  const {
    clearGroup,
    disposeObjectTree,
    focusVehicle,
    focusStage
  } = helpers;
  const {
    getPlayerSystem,
    createStage,
    getStageLabel,
    getStageBehaviorId,
    isSanVerdeStageId,
    resolveAssignedGlbOnly,
    initializeStageFeedback,
    disposeStageFeedback,
    createStageGroundSampler,
    createStageCollisionSampler,
    createBounceStagePhysics,
    destroyBounceStagePhysics,
    getVehicleMassKg,
    applyStageShadowPolicy,
    applyStageAtmosphere,
    shouldUseStageOverview,
    syncStageRenderingMode,
    applyGarageSnapshot,
    setDriveMode,
    setGarageStage,
    snapGarageCamera,
    updateGarageRuntime,
    refreshGarageStagePhysics,
    setLoadDone,
    setLoadScreen,
    setStatus,
    minimapCanvasEl,
    renderStageMinimap,
    setMinimapVisible,
    setMinimapLabel,
    syncParkedVehicleProxies,
    syncAgentStage
  } = callbacks;

  let activeStage = null;
  let activeStagePhysicsRevision = 0;
  let portalTransitionPending = false;

  function initializeStageOptions() {
    ui.stageType.innerHTML = callbacks.stageOptions
      .map(({ id, label }) => `<option value="${id}">${label}</option>`)
      .join('');
    ui.stageType.value = state.selectedStageId;
  }

  async function loadInitialStage({ stageId, context }) {
    setLoadScreen(2, 'Preparing world…');
    const stage = await createStage(stageId, {
      disposeObjectTree,
      gltfLoader: context.gltfLoader,
      loadingManager: context.loadingManager,
      onProgress: (pct, label) => setLoadScreen(pct, label),
    });
    setLoadScreen(90, 'Loading assets…');
    initializeStageSamplingAndPhysics(stage);
    applyStageShadowPolicy(stage);
    activeStage = stage;
    activeStagePhysicsRevision = stage.physicsRevision ?? 0;
    applyStageAtmosphere(context.scene, stage.id);
    context.stageMount.add(stage.group);
    return stage;
  }

  function initializeStageSamplingAndPhysics(stage) {
    if (!stage?.group) {
      return stage;
    }

    const collisionRoot = stage.collisionGroup || stage.group;
    initializeStageFeedback(stage, config);
    stage.sampleGround = stage.sampleGround || createStageGroundSampler(collisionRoot, {
      rayStart: config.suspension.sampleRayStart,
      rayDistance: config.suspension.sampleRayDistance,
      minNormalY: config.suspension.supportMinNormalY
    });
    stage.sampleCollision = stage.sampleCollision || createStageCollisionSampler(collisionRoot);
    stage.physics = createBounceStagePhysics(
      stage,
      config,
      state.activeVehicleKind,
      getVehicleMassKg()
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
      config,
      state.activeVehicleKind,
      getVehicleMassKg()
    );
    activeStagePhysicsRevision = activeStage.physicsRevision ?? 0;
    applyGarageSnapshot(refreshGarageStagePhysics(context.gameRuntime, activeStage));
  }

  async function rebuildStage(context, stageId) {
    const playerSystem = getPlayerSystem();
    setLoadDone(false);
    setLoadScreen(2, 'Preparing world…');
    destroyStageResources(activeStage);
    const stage = await createStage(stageId, {
      disposeObjectTree,
      gltfLoader: context.gltfLoader,
      loadingManager: context.loadingManager,
      assignedGlbOnly: stageId === 'san_verde_test'
        ? true
        : isSanVerdeStageId(stageId)
          ? resolveAssignedGlbOnly()
          : undefined,
      onProgress: (pct, label) => setLoadScreen(pct, label),
    });
    initializeStageSamplingAndPhysics(stage);
    applyStageShadowPolicy(stage);
    activeStage = stage;
    if (isSanVerdeStageId(stageId)) {
      state.sanVerdeAssignedGlbOnly = stage.bakeConfig?.assignedGlbOnly === true;
    }
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
    syncParkedVehicleProxies(context);
    if (context.characterController && !state.driveMode) {
      playerSystem.directExitVehicle(context);
    }
    contextStageUpdate(context, stage, playerSystem.getActiveStagePosition(context));
    if ((activeStage?.physicsRevision ?? 0) !== activeStagePhysicsRevision) {
      refreshActiveStagePhysics(context);
    }
    updateStageMinimapOverlay(context);
    syncAgentStage(stage, playerSystem.getActiveStagePosition(context));
    ui.toggleAssignedGlbOnly.textContent = `Assigned GLB Test: ${resolveAssignedGlbOnly(stage) ? 'On' : 'Off'}`;

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

  function contextStageUpdate(context, stage, followPosition) {
    const action = stage?.update?.(followPosition);
    if (action?.type === 'portal' && !portalTransitionPending) {
      portalTransitionPending = true;
      state.selectedStageId = action.destination;
      ui.stageType.value = action.destination;
      rebuildStage(context, action.destination).finally(() => {
        portalTransitionPending = false;
      });
    }
  }

  function shouldShowStageMinimap(stageId) {
    stageId = getStageBehaviorId(stageId);
    return stageId === 'bloomville' || stageId === 'san_verde';
  }

  function updateStageMinimapOverlay(context) {
    const playerSystem = getPlayerSystem();
    const visible = shouldShowStageMinimap(state.selectedStageId) && Boolean(minimapCanvasEl);
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

  function getCurrentStage() {
    return activeStage;
  }

  function getCurrentStagePhysicsRevision() {
    return activeStagePhysicsRevision;
  }

  return {
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
  };
}
