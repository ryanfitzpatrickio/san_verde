import * as THREE from 'three';

import {
  setWeaponName,
  setWeaponWheelOpen,
  setWeaponWheelOptions,
  setWeaponWheelSelection
} from '../ui/hud-store.js';

const TAU = Math.PI * 2;
const WEAPON_TEMPLATE_CACHE = new Map();
const WEAPON_FORWARD = new THREE.Vector3();
const WEAPON_SIDE = new THREE.Vector3();
const WEAPON_POINTER = new THREE.Vector2();
const WEAPON_RAYCASTER = new THREE.Raycaster();
const HAND_NAME_PATTERNS = [/mixamorig.*righthand$/i, /right.?hand$/i, /hand_r$/i];
const ARM_NAME_PATTERNS = [/mixamorig.*rightforearm$/i, /right.?forearm$/i, /forearm_r$/i, /right.?wrist$/i, /wrist_r$/i];
const PROCEDURAL_WEAPON_CACHE = new Map();
const WEAPON_LOAD_WARNINGS = new Set();
const WEAPON_DEBUG = true;
const DIAGONAL_MODE_ENTER_BIAS = 0.16;
const DIAGONAL_MODE_EXIT_BIAS = 0.08;
const WEAPON_WORLD_POSITION = new THREE.Vector3();
const WEAPON_WORLD_SCALE = new THREE.Vector3();
const WEAPON_BOUNDS = new THREE.Box3();
const WEAPON_BOUNDS_SIZE = new THREE.Vector3();
const WEAPON_BONE_WORLD_POSITION = new THREE.Vector3();
const WEAPON_BONE_WORLD_SCALE = new THREE.Vector3();
const WEAPON_SOCKET_SCALE = new THREE.Vector3();

export function createCharacterWeaponRuntime({ state, config, setStatus }) {
  let lastWheelOptionsKey = '';
  let shotCooldownSeconds = 0;
  let lastVisibilityLogKey = '';

  function logWeapon(event, payload) {
    if (!WEAPON_DEBUG) {
      return;
    }
    console.log('[weapon]', event, payload);
    console.log('[weapon-json]', event, JSON.stringify(payload));
  }

  function countWeaponMeshes(root) {
    let meshCount = 0;
    root?.traverse?.((child) => {
      if (child?.isMesh) {
        meshCount += 1;
      }
    });
    return meshCount;
  }

  function measureWeaponInstance(instance) {
    if (!instance) {
      return null;
    }

    instance.updateMatrixWorld(true);
    instance.getWorldPosition(WEAPON_WORLD_POSITION);
    instance.getWorldScale(WEAPON_WORLD_SCALE);
    WEAPON_BOUNDS.setFromObject(instance);
    const hasBounds = !WEAPON_BOUNDS.isEmpty();
    if (hasBounds) {
      WEAPON_BOUNDS.getSize(WEAPON_BOUNDS_SIZE);
    } else {
      WEAPON_BOUNDS_SIZE.set(0, 0, 0);
    }

    return {
      meshCount: countWeaponMeshes(instance),
      worldPosition: WEAPON_WORLD_POSITION.toArray().map((value) => Number(value.toFixed(4))),
      worldScale: WEAPON_WORLD_SCALE.toArray().map((value) => Number(value.toFixed(4))),
      boundsSize: WEAPON_BOUNDS_SIZE.toArray().map((value) => Number(value.toFixed(4))),
      parentName: instance.parent?.name || '(no-parent)'
    };
  }

  function measureBone(bone) {
    if (!bone) {
      return null;
    }
    bone.updateMatrixWorld(true);
    bone.getWorldPosition(WEAPON_BONE_WORLD_POSITION);
    bone.getWorldScale(WEAPON_BONE_WORLD_SCALE);
    return {
      boneWorldPosition: WEAPON_BONE_WORLD_POSITION.toArray().map((value) => Number(value.toFixed(4))),
      boneWorldScale: WEAPON_BONE_WORLD_SCALE.toArray().map((value) => Number(value.toFixed(4)))
    };
  }

  function syncWeaponSocketTransform(controllerWeaponState) {
    const socket = controllerWeaponState?.socket;
    const handBone = controllerWeaponState?.handBone;
    if (!socket || !handBone) {
      return null;
    }

    handBone.updateMatrixWorld(true);
    handBone.getWorldScale(WEAPON_BONE_WORLD_SCALE);
    WEAPON_SOCKET_SCALE.set(
      WEAPON_BONE_WORLD_SCALE.x !== 0 ? 1 / WEAPON_BONE_WORLD_SCALE.x : 1,
      WEAPON_BONE_WORLD_SCALE.y !== 0 ? 1 / WEAPON_BONE_WORLD_SCALE.y : 1,
      WEAPON_BONE_WORLD_SCALE.z !== 0 ? 1 / WEAPON_BONE_WORLD_SCALE.z : 1
    );
    socket.position.set(0, 0, 0);
    socket.rotation.set(0, 0, 0);
    socket.scale.copy(WEAPON_SOCKET_SCALE);
    socket.updateMatrixWorld(true);
    return {
      socketScale: socket.scale.toArray().map((value) => Number(value.toFixed(4)))
    };
  }

  function getWeaponConfig(weaponId) {
    return config.character?.weapons?.[weaponId] || null;
  }

  function getWheelWeaponIds() {
    return (state.weaponInventoryIds || []).filter((weaponId) => getWeaponConfig(weaponId));
  }

  function getDisplayedWeaponId() {
    return state.weaponWheelOpen ? state.weaponWheelSelectionId : state.equippedWeaponId;
  }

  function getWeaponLabel(weaponId) {
    return getWeaponConfig(weaponId)?.label || 'Unknown';
  }

  function getWeaponLoadUrl(weaponConfig) {
    if (typeof weaponConfig?.modelUrl === 'string' && weaponConfig.modelUrl.length > 0) {
      return weaponConfig.modelUrl;
    }
    if (typeof weaponConfig?.asset?.url === 'string' && weaponConfig.asset.url.length > 0) {
      return weaponConfig.asset.url;
    }
    return null;
  }

  function warnWeaponLoadFailure(weaponId, weaponConfig, error) {
    const loadUrl = getWeaponLoadUrl(weaponConfig) || weaponConfig?.proceduralModel || 'unknown-source';
    const warningKey = `${weaponId}:${loadUrl}`;
    if (WEAPON_LOAD_WARNINGS.has(warningKey)) {
      return;
    }
    WEAPON_LOAD_WARNINGS.add(warningKey);
    console.warn('[weapon] failed to load weapon asset, using fallback', {
      weaponId,
      loadUrl,
      error
    });
  }

  function clearCharacterInput() {
    if (!state.characterInput) {
      return;
    }
    state.characterInput.forward = false;
    state.characterInput.backward = false;
    state.characterInput.left = false;
    state.characterInput.right = false;
    state.characterInput.run = false;
    state.characterInput.jump = false;
  }

  function syncHud() {
    const wheelOptions = getWheelWeaponIds().map((weaponId) => ({
      id: weaponId,
      label: getWeaponLabel(weaponId)
    }));
    const wheelOptionsKey = wheelOptions.map((option) => `${option.id}:${option.label}`).join('|');

    setWeaponName(getWeaponLabel(getDisplayedWeaponId()));
    setWeaponWheelOpen(Boolean(state.weaponWheelOpen));
    setWeaponWheelSelection(state.weaponWheelSelectionId || state.equippedWeaponId || 'unarmed');
    if (wheelOptionsKey !== lastWheelOptionsKey) {
      lastWheelOptionsKey = wheelOptionsKey;
      setWeaponWheelOptions(wheelOptions);
    }
  }

  function ensureControllerWeaponState(controller) {
    if (!controller) {
      return null;
    }

    if (!controller.weaponState) {
      controller.weaponState = {
        socket: null,
        handBone: null,
        instances: new Map(),
        locomotionZone: 'forward'
      };
    }

    return controller.weaponState;
  }

  function findRightHandBone(model) {
    let bestHandMatch = null;
    let bestArmMatch = null;
    let bestLooseMatch = null;
    model?.traverse?.((child) => {
      if (!child?.isBone || !child.name) {
        return;
      }

      const name = String(child.name);
      if (HAND_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
        if (!bestHandMatch || name.length < bestHandMatch.name.length) {
          bestHandMatch = child;
        }
        return;
      }

      if (ARM_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
        if (!bestArmMatch || name.length < bestArmMatch.name.length) {
          bestArmMatch = child;
        }
        return;
      }

      const lowerName = name.toLowerCase();
      if (lowerName.includes('right') && (lowerName.includes('hand') || lowerName.includes('wrist') || lowerName.includes('arm'))) {
        if (!bestLooseMatch || name.length < bestLooseMatch.name.length) {
          bestLooseMatch = child;
        }
      }
    });
    return bestHandMatch || bestArmMatch || bestLooseMatch || null;
  }

  async function loadWeaponTemplate(gltfLoader, url) {
    if (!WEAPON_TEMPLATE_CACHE.has(url)) {
      WEAPON_TEMPLATE_CACHE.set(
        url,
        gltfLoader.loadAsync(url).then((asset) => {
          const root = asset?.scene || asset?.scenes?.[0] || new THREE.Group();
          prepareWeaponRenderable(root);
          return root;
        })
      );
    }

    return WEAPON_TEMPLATE_CACHE.get(url);
  }

  function loadProceduralWeaponTemplate(kind) {
    if (!PROCEDURAL_WEAPON_CACHE.has(kind)) {
      PROCEDURAL_WEAPON_CACHE.set(kind, createProceduralWeaponTemplate(kind));
    }
    return PROCEDURAL_WEAPON_CACHE.get(kind);
  }

  function prepareWeaponRenderable(root) {
    root.traverse((child) => {
      if (!child?.isMesh) {
        return;
      }
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) {
        child.material.side = THREE.FrontSide;
      }
    });
  }

  function applyWeaponPresentation(instance, weaponConfig) {
    const templateScaleMultiplier = Number(instance?.userData?.weaponGripScaleMultiplier) || 1;
    const scale = (Number(weaponConfig?.gripScale) || 1) * templateScaleMultiplier;
    instance.position.fromArray(weaponConfig?.gripOffset || [0, 0, 0]);
    instance.rotation.set(...(weaponConfig?.gripRotation || [0, 0, 0]));
    instance.scale.setScalar(scale);
  }

  async function loadCharacterWeaponAssets(context) {
    const controller = context?.characterController;
    if (!controller || !context?.gltfLoader) {
      logWeapon('load:skipped', {
        hasController: Boolean(controller),
        hasGltfLoader: Boolean(context?.gltfLoader)
      });
      syncHud();
      return false;
    }

    const controllerWeaponState = ensureControllerWeaponState(controller);
    if (!controllerWeaponState.handBone) {
      controllerWeaponState.handBone = findRightHandBone(controller.model);
    }
    if (!controllerWeaponState.handBone) {
      console.warn('[weapon] no right-hand bone found, attaching to character root instead');
      controllerWeaponState.handBone = controller.model || controller.root || null;
    }
    if (!controllerWeaponState.handBone) {
      logWeapon('load:no-hand-bone', {
        equippedWeaponId: state.equippedWeaponId,
        inventory: getWheelWeaponIds()
      });
      syncHud();
      return false;
    }
    logWeapon('load:attach-bone', {
      boneName: controllerWeaponState.handBone.name || '(unnamed)',
      inventory: getWheelWeaponIds(),
      equippedWeaponId: state.equippedWeaponId,
      ...measureBone(controllerWeaponState.handBone)
    });
    if (!controllerWeaponState.socket) {
      controllerWeaponState.socket = new THREE.Group();
      controllerWeaponState.socket.name = 'character-weapon-socket';
      controllerWeaponState.handBone.add(controllerWeaponState.socket);
      logWeapon('load:socket-created', {
        parentName: controllerWeaponState.handBone.name || '(unnamed)'
      });
    }
    const socketTransform = syncWeaponSocketTransform(controllerWeaponState);
    if (socketTransform) {
      logWeapon('load:socket-scaled', {
        boneName: controllerWeaponState.handBone.name || '(unnamed)',
        ...socketTransform
      });
    }

    for (const weaponId of getWheelWeaponIds()) {
      if (weaponId === 'unarmed' || controllerWeaponState.instances.has(weaponId)) {
        continue;
      }

      const weaponConfig = getWeaponConfig(weaponId);
      const loadUrl = getWeaponLoadUrl(weaponConfig);
      if (!loadUrl && !weaponConfig?.proceduralModel) {
        continue;
      }

      let template = null;
      let sourceType = 'none';
      try {
        if (loadUrl) {
          sourceType = 'asset';
          template = await loadWeaponTemplate(context.gltfLoader, loadUrl);
        } else if (weaponConfig?.proceduralModel) {
          sourceType = 'procedural';
          template = loadProceduralWeaponTemplate(weaponConfig.proceduralModel);
        }
      } catch (error) {
        warnWeaponLoadFailure(weaponId, weaponConfig, error);
      }

      if (!template) {
        sourceType = 'fallback';
        template = loadProceduralWeaponTemplate(weaponConfig?.proceduralModel || weaponId);
      }

      if (!template) {
        logWeapon('load:template-missing', {
          weaponId,
          loadUrl,
          proceduralModel: weaponConfig?.proceduralModel || null
        });
        continue;
      }

      const instance = template.clone(true);
      instance.name = `${weaponId}-equipped-model`;
      instance.visible = false;
      applyWeaponPresentation(instance, weaponConfig);
      controllerWeaponState.socket.add(instance);
      controllerWeaponState.instances.set(weaponId, instance);
      logWeapon('load:instance-added', {
        weaponId,
        sourceType,
        loadUrl,
        proceduralModel: weaponConfig?.proceduralModel || null,
        boneName: controllerWeaponState.handBone.name || '(unnamed)',
        position: instance.position.toArray().map((value) => Number(value.toFixed(4))),
        rotation: [instance.rotation.x, instance.rotation.y, instance.rotation.z].map((value) => Number(value.toFixed(4))),
        scale: Number(instance.scale.x.toFixed(4)),
        childCount: instance.children.length,
        ...measureWeaponInstance(instance),
        ...measureBone(controllerWeaponState.handBone)
      });
    }

    logWeapon('load:complete', {
      instances: Array.from(controllerWeaponState.instances.keys()),
      equippedWeaponId: state.equippedWeaponId
    });
    syncHud();
    return true;
  }

  function syncCharacterWeapon(context) {
    const controller = context?.characterController;
    const controllerWeaponState = controller ? ensureControllerWeaponState(controller) : null;
    const visibleWeaponId =
      context?.characterController &&
      !state.driveMode &&
      state.characterVehicleState === 'on_foot'
        ? state.equippedWeaponId
        : null;

    for (const [weaponId, instance] of controllerWeaponState?.instances || []) {
      instance.visible = visibleWeaponId === weaponId;
    }

    const visibilitySummary = Array.from(controllerWeaponState?.instances || []).map(([weaponId, instance]) => {
      const metrics = measureWeaponInstance(instance);
      return {
        weaponId,
        visible: instance.visible,
        scale: Number(instance.scale.x.toFixed(4)),
        ...metrics
      };
    });
    const visibilityLogKey = JSON.stringify({
      visibleWeaponId,
      driveMode: state.driveMode,
      characterVehicleState: state.characterVehicleState,
      equippedWeaponId: state.equippedWeaponId,
      instances: visibilitySummary.map((entry) => `${entry.weaponId}:${entry.visible ? '1' : '0'}:${entry.parentName}:${entry.scale}`)
    });
    if (visibilityLogKey !== lastVisibilityLogKey) {
      lastVisibilityLogKey = visibilityLogKey;
      logWeapon('sync:visibility', {
        visibleWeaponId,
        equippedWeaponId: state.equippedWeaponId,
        driveMode: state.driveMode,
        characterVehicleState: state.characterVehicleState,
        instances: visibilitySummary
      });
    }

    syncHud();
  }

  async function equipWeapon(context, weaponId) {
    if (!getWeaponConfig(weaponId)) {
      logWeapon('equip:missing-config', {
        weaponId,
        availableWeaponIds: Object.keys(config.character?.weapons || {})
      });
      return false;
    }

    const previousWeaponId = state.equippedWeaponId;
    logWeapon('equip:start', {
      previousWeaponId,
      nextWeaponId: weaponId,
      driveMode: state.driveMode,
      characterVehicleState: state.characterVehicleState
    });
    state.equippedWeaponId = weaponId;
    state.weaponWheelSelectionId = weaponId;
    await loadCharacterWeaponAssets(context);
    syncCharacterWeapon(context);
    logWeapon('equip:done', {
      previousWeaponId,
      nextWeaponId: weaponId
    });

    if (previousWeaponId !== weaponId) {
      setStatus(weaponId === 'unarmed' ? 'Holstered weapon' : `${getWeaponLabel(weaponId)} equipped`);
    }

    return true;
  }

  function canOpenWeaponWheel(context) {
    return Boolean(
      context?.characterController &&
      state.characterLoaded &&
      !state.driveMode &&
      state.characterVehicleState === 'on_foot'
    );
  }

  function openWeaponWheel(context) {
    if (!canOpenWeaponWheel(context)) {
      return false;
    }

    clearCharacterInput();
    state.weaponWheelOpen = true;
    state.weaponWheelSelectionId = state.equippedWeaponId;
    syncHud();
    return true;
  }

  function canFireWeapon(context) {
    return Boolean(
      context?.camera &&
      context?.renderer?.domElement &&
      state.characterLoaded &&
      !state.driveMode &&
      state.characterVehicleState === 'on_foot' &&
      !state.weaponWheelOpen &&
      state.equippedWeaponId !== 'unarmed' &&
      shotCooldownSeconds <= 0
    );
  }

  function fireEquippedWeapon(context, options = {}) {
    if (!canFireWeapon(context)) {
      return null;
    }

    const weaponConfig = getWeaponConfig(state.equippedWeaponId);
    if (!weaponConfig) {
      return null;
    }

    const domRect = context.renderer.domElement.getBoundingClientRect();
    const clientX = Number.isFinite(options.clientX) ? options.clientX : domRect.left + domRect.width * 0.5;
    const clientY = Number.isFinite(options.clientY) ? options.clientY : domRect.top + domRect.height * 0.5;
    WEAPON_POINTER.set(
      ((clientX - domRect.left) / Math.max(domRect.width, 1)) * 2 - 1,
      -(((clientY - domRect.top) / Math.max(domRect.height, 1)) * 2 - 1)
    );
    WEAPON_RAYCASTER.setFromCamera(WEAPON_POINTER, context.camera);
    shotCooldownSeconds = Math.max(0.05, Number(weaponConfig.fireCooldownSeconds) || 0.12);

    const shot = {
      weaponId: state.equippedWeaponId,
      weaponLabel: weaponConfig.label || state.equippedWeaponId,
      origin: WEAPON_RAYCASTER.ray.origin.clone(),
      direction: WEAPON_RAYCASTER.ray.direction.clone()
    };
    const result = options.onShot?.(shot) || null;
    return {
      ...shot,
      result
    };
  }

  async function closeWeaponWheel(context, options = {}) {
    if (!state.weaponWheelOpen) {
      return false;
    }

    state.weaponWheelOpen = false;
    const nextWeaponId = options.commit === false ? state.equippedWeaponId : state.weaponWheelSelectionId;
    const changed = await equipWeapon(context, nextWeaponId);
    syncHud();
    return changed;
  }

  function updateWeaponWheelPointer(clientX, clientY) {
    if (!state.weaponWheelOpen) {
      return false;
    }

    const weaponIds = getWheelWeaponIds();
    if (!weaponIds.length) {
      return false;
    }

    const centerX = window.innerWidth * 0.5;
    const centerY = window.innerHeight * 0.5;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const distance = Math.hypot(dx, dy);
    if (distance <= 36) {
      state.weaponWheelSelectionId = state.equippedWeaponId;
      syncHud();
      return true;
    }

    const segmentSize = TAU / weaponIds.length;
    const angle = ((Math.atan2(dy, dx) + Math.PI * 0.5) % TAU + TAU) % TAU;
    const index = Math.floor((angle + segmentSize * 0.5) / segmentSize) % weaponIds.length;
    state.weaponWheelSelectionId = weaponIds[index];
    syncHud();
    return true;
  }

  function resolveLocomotionState({ controller, moving, moveDirection, input, cameraForward }) {
    const weaponConfig = getWeaponConfig(state.equippedWeaponId);
    const locomotionSet = weaponConfig?.locomotionSet;
    if (!locomotionSet || state.driveMode || state.characterVehicleState !== 'on_foot') {
      return null;
    }

    const forwardVector = WEAPON_FORWARD.copy(cameraForward).setY(0);
    if (forwardVector.lengthSq() <= 1e-6) {
      forwardVector.set(Math.sin(controller.yaw), 0, Math.cos(controller.yaw));
    } else {
      forwardVector.normalize();
    }
    const targetYaw = Math.atan2(forwardVector.x, forwardVector.z);
    WEAPON_SIDE.set(-forwardVector.z, 0, forwardVector.x);

    let actionName = locomotionSet.idle;
    if (moving && moveDirection.lengthSq() > 1e-6) {
      const controllerWeaponState = ensureControllerWeaponState(controller);
      const forwardAmount = moveDirection.dot(forwardVector);
      const sideAmount = moveDirection.dot(WEAPON_SIDE);
      const absForward = Math.abs(forwardAmount);
      const absSide = Math.abs(sideAmount);
      const previousZone = controllerWeaponState?.locomotionZone || 'forward';

      let nextZone = previousZone;
      if (previousZone === 'strafe') {
        nextZone = absForward > absSide + DIAGONAL_MODE_EXIT_BIAS ? 'forward' : 'strafe';
      } else {
        nextZone = absSide > absForward + DIAGONAL_MODE_ENTER_BIAS ? 'strafe' : 'forward';
      }
      controllerWeaponState.locomotionZone = nextZone;

      if (nextZone === 'forward') {
        actionName = forwardAmount < -0.25
          ? (input.run ? locomotionSet.runBackward : locomotionSet.walkBackward)
          : (input.run ? locomotionSet.run : locomotionSet.walk);
      } else {
        actionName = sideAmount < 0 ? locomotionSet.strafeLeft : locomotionSet.strafeRight;
      }
    } else {
      const controllerWeaponState = ensureControllerWeaponState(controller);
      controllerWeaponState.locomotionZone = 'forward';
    }

    return {
      actionName: resolveAvailableAction(controller, [
        actionName,
        locomotionSet.idle,
        'idle'
      ]),
      targetYaw,
      forceFacing: true
    };
  }

  syncHud();

  return {
    canFireWeapon,
    canOpenWeaponWheel,
    closeWeaponWheel,
    equipWeapon,
    fireEquippedWeapon,
    loadCharacterWeaponAssets,
    openWeaponWheel,
    resolveLocomotionState,
    syncCharacterWeapon,
    syncHud,
    updateFrame(deltaSeconds) {
      shotCooldownSeconds = Math.max(0, shotCooldownSeconds - Math.max(deltaSeconds, 0));
    },
    updateWeaponWheelPointer
  };
}

function createProceduralWeaponTemplate(kind) {
  if (kind === 'pistol') {
    return createProceduralPistol();
  }
  if (kind === 'shotgun') {
    return createProceduralShotgun();
  }
  return createProceduralFallbackWeapon(kind);
}

function createProceduralPistol() {
  const root = new THREE.Group();
  root.name = 'procedural-pistol';
  root.userData.weaponGripScaleMultiplier = 3.5;

  const slideMaterial = new THREE.MeshStandardMaterial({
    color: '#2b313a',
    roughness: 0.42,
    metalness: 0.84
  });
  const gripMaterial = new THREE.MeshStandardMaterial({
    color: '#4e3022',
    roughness: 0.82,
    metalness: 0.04
  });

  const slide = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.12, 0.48),
    slideMaterial
  );
  slide.position.set(0, 0.05, 0.14);
  slide.castShadow = true;
  slide.receiveShadow = true;
  root.add(slide);

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.028, 0.34, 16),
    slideMaterial
  );
  barrel.rotation.x = Math.PI * 0.5;
  barrel.position.set(0, 0.02, 0.26);
  barrel.castShadow = true;
  barrel.receiveShadow = true;
  root.add(barrel);

  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.13, 0.26, 0.16),
    gripMaterial
  );
  grip.position.set(0, -0.11, -0.03);
  grip.rotation.x = -0.26;
  grip.castShadow = true;
  grip.receiveShadow = true;
  root.add(grip);

  const triggerGuard = new THREE.Mesh(
    new THREE.TorusGeometry(0.06, 0.012, 8, 14, Math.PI),
    slideMaterial
  );
  triggerGuard.rotation.z = Math.PI;
  triggerGuard.position.set(0, -0.05, 0.06);
  triggerGuard.castShadow = true;
  root.add(triggerGuard);

  return root;
}

function createProceduralShotgun() {
  const root = new THREE.Group();
  root.name = 'procedural-shotgun';

  const barrelMaterial = new THREE.MeshStandardMaterial({
    color: '#252a31',
    roughness: 0.38,
    metalness: 0.88
  });
  const woodMaterial = new THREE.MeshStandardMaterial({
    color: '#6c482c',
    roughness: 0.78,
    metalness: 0.06
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: '#4d525c',
    roughness: 0.52,
    metalness: 0.64
  });

  const stock = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.12, 1.05),
    woodMaterial
  );
  stock.position.set(0, 0, -0.56);
  stock.castShadow = true;
  stock.receiveShadow = true;
  root.add(stock);

  const receiver = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.16, 0.34),
    accentMaterial
  );
  receiver.position.set(0, 0.02, 0.04);
  receiver.castShadow = true;
  receiver.receiveShadow = true;
  root.add(receiver);

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.032, 1.56, 18),
    barrelMaterial
  );
  barrel.rotation.x = Math.PI * 0.5;
  barrel.position.set(0, 0.055, 0.92);
  barrel.castShadow = true;
  barrel.receiveShadow = true;
  root.add(barrel);

  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 1.06, 16),
    barrelMaterial
  );
  tube.rotation.x = Math.PI * 0.5;
  tube.position.set(0, -0.018, 0.67);
  tube.castShadow = true;
  tube.receiveShadow = true;
  root.add(tube);

  const foregrip = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.12, 0.38),
    woodMaterial
  );
  foregrip.position.set(0, -0.028, 0.48);
  foregrip.castShadow = true;
  foregrip.receiveShadow = true;
  root.add(foregrip);

  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.24, 0.16),
    woodMaterial
  );
  grip.position.set(0, -0.12, -0.06);
  grip.castShadow = true;
  grip.receiveShadow = true;
  root.add(grip);

  const sight = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.06, 0.08),
    accentMaterial
  );
  sight.position.set(0, 0.1, 1.58);
  sight.castShadow = true;
  root.add(sight);

  return root;
}

function createProceduralFallbackWeapon(kind) {
  const root = new THREE.Group();
  root.name = `procedural-${kind || 'weapon'}`;

  const material = new THREE.MeshStandardMaterial({
    color: '#6b7684',
    roughness: 0.48,
    metalness: 0.62
  });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.6),
    material
  );
  body.position.set(0, 0, 0.18);
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  return root;
}

function resolveAvailableAction(controller, candidates) {
  for (const actionName of candidates) {
    if (actionName && controller?.actions?.has(actionName)) {
      return actionName;
    }
  }
  return 'idle';
}
