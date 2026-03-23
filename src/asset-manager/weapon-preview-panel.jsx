import { For, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MODEL_CONFIG } from '../app-shell.js';
import {
  loadHumanoidActor,
  setHumanoidActorAction,
  stabilizeHumanoidRootMotion,
  updateHumanoidActor
} from '../game/humanoid-actor.js';

const HAND_NAME_PATTERNS = [/mixamorig.*righthand$/i, /right.?hand$/i, /hand_r$/i];
const ARM_NAME_PATTERNS = [/mixamorig.*rightforearm$/i, /right.?forearm$/i, /forearm_r$/i, /right.?wrist$/i, /wrist_r$/i];
const WEAPON_TEMPLATE_CACHE = new Map();
const PROCEDURAL_WEAPON_CACHE = new Map();
const CLOCK = new THREE.Clock();
const TAU = Math.PI * 2;
const BOUNDS = new THREE.Box3();
const BOUNDS_SIZE = new THREE.Vector3();
const BOUNDS_CENTER = new THREE.Vector3();
const BONE_WORLD_SCALE = new THREE.Vector3();
const SOCKET_SCALE = new THREE.Vector3();

const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();

function getWeaponLoadUrl(weaponDraft) {
  return typeof weaponDraft?.asset?.url === 'string' && weaponDraft.asset.url.length > 0
    ? weaponDraft.asset.url
    : null;
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

function syncSocketScale(socket, handBone) {
  if (!socket || !handBone) {
    return;
  }
  handBone.updateMatrixWorld(true);
  handBone.getWorldScale(BONE_WORLD_SCALE);
  SOCKET_SCALE.set(
    BONE_WORLD_SCALE.x !== 0 ? 1 / BONE_WORLD_SCALE.x : 1,
    BONE_WORLD_SCALE.y !== 0 ? 1 / BONE_WORLD_SCALE.y : 1,
    BONE_WORLD_SCALE.z !== 0 ? 1 / BONE_WORLD_SCALE.z : 1
  );
  socket.position.set(0, 0, 0);
  socket.rotation.set(0, 0, 0);
  socket.scale.copy(SOCKET_SCALE);
  socket.updateMatrixWorld(true);
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

async function loadWeaponTemplate(url) {
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

function createProceduralWeaponTemplate(kind) {
  if (kind === 'shotgun') {
    return createProceduralShotgun();
  }
  if (kind === 'pistol') {
    return createProceduralPistol();
  }
  return new THREE.Group();
}

function createProceduralPistol() {
  const root = new THREE.Group();
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

  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.48), slideMaterial);
  slide.position.set(0, 0.05, 0.14);
  slide.castShadow = true;
  slide.receiveShadow = true;
  root.add(slide);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 16), slideMaterial);
  barrel.rotation.x = Math.PI * 0.5;
  barrel.position.set(0, 0.02, 0.26);
  barrel.castShadow = true;
  barrel.receiveShadow = true;
  root.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.26, 0.16), gripMaterial);
  grip.position.set(0, -0.11, -0.03);
  grip.rotation.x = -0.26;
  grip.castShadow = true;
  grip.receiveShadow = true;
  root.add(grip);

  return root;
}

function createProceduralShotgun() {
  const root = new THREE.Group();

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

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 1.05), woodMaterial);
  stock.position.set(0, 0, -0.56);
  stock.castShadow = true;
  stock.receiveShadow = true;
  root.add(stock);

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.34), accentMaterial);
  receiver.position.set(0, 0.02, 0.04);
  receiver.castShadow = true;
  receiver.receiveShadow = true;
  root.add(receiver);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 1.56, 18), barrelMaterial);
  barrel.rotation.x = Math.PI * 0.5;
  barrel.position.set(0, 0.055, 0.92);
  barrel.castShadow = true;
  barrel.receiveShadow = true;
  root.add(barrel);

  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.06, 16), barrelMaterial);
  tube.rotation.x = Math.PI * 0.5;
  tube.position.set(0, -0.018, 0.67);
  tube.castShadow = true;
  tube.receiveShadow = true;
  root.add(tube);

  const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.38), woodMaterial);
  foregrip.position.set(0, -0.028, 0.48);
  foregrip.castShadow = true;
  foregrip.receiveShadow = true;
  root.add(foregrip);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, 0.16), woodMaterial);
  grip.position.set(0, -0.12, -0.06);
  grip.castShadow = true;
  grip.receiveShadow = true;
  root.add(grip);

  return root;
}

function applyWeaponPresentation(instance, weaponDraft) {
  const grip = weaponDraft?.grip || {};
  instance.position.fromArray(grip.offset || [0, 0, 0]);
  const gripRotation = grip.rotation || [0, 0, 0];
  instance.rotation.set(
    unwrapAngleNear(Number(gripRotation[0] || 0), instance.rotation.x),
    unwrapAngleNear(Number(gripRotation[1] || 0), instance.rotation.y),
    unwrapAngleNear(Number(gripRotation[2] || 0), instance.rotation.z)
  );
  const scale = Number.isFinite(Number(grip.scale)) ? Number(grip.scale) : 1;
  instance.scale.setScalar(scale);
}

function unwrapAngleNear(angle, reference) {
  let next = Number.isFinite(angle) ? angle : 0;
  const target = Number.isFinite(reference) ? reference : 0;
  while (next - target > Math.PI) {
    next -= TAU;
  }
  while (next - target < -Math.PI) {
    next += TAU;
  }
  return next;
}

function createSocketMarker(color, position) {
  const marker = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 16, 16),
    new THREE.MeshBasicMaterial({ color })
  );
  marker.add(sphere);

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.005, 0.12, 10),
    new THREE.MeshBasicMaterial({ color })
  );
  stem.position.y = 0.08;
  marker.add(stem);

  marker.position.fromArray(position || [0, 0, 0]);
  return marker;
}

function frameCamera(camera, controls, target) {
  target.updateMatrixWorld(true);
  BOUNDS.setFromObject(target);
  if (BOUNDS.isEmpty()) {
    return;
  }
  BOUNDS.getSize(BOUNDS_SIZE);
  BOUNDS.getCenter(BOUNDS_CENTER);
  const radius = Math.max(BOUNDS_SIZE.x, BOUNDS_SIZE.y, BOUNDS_SIZE.z, 1) * 0.5;
  controls.target.copy(BOUNDS_CENTER);
  camera.position.copy(BOUNDS_CENTER.clone().add(new THREE.Vector3(radius * 1.8, radius * 1.2, radius * 2.2)));
  camera.near = 0.05;
  camera.far = Math.max(100, radius * 40);
  camera.updateProjectionMatrix();
  controls.update();
}

export function WeaponPreviewPanel(props) {
  let viewportRef;
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let transformControls = null;
  let transformHelper = null;
  let resizeObserver = null;
  let animationFrame = 0;
  let previewRoot = null;
  let actor = null;
  let weaponSocket = null;
  let weaponInstance = null;
  let socketMarkers = null;
  let currentLoadToken = 0;
  let lastWeaponSourceKey = '';
  let suppressDraftSync = false;
  let gizmoDragging = false;

  const [status, setStatus] = createSignal('Preview the selected weapon on Norm.');
  const [busy, setBusy] = createSignal(false);
  const [previewSlot, setPreviewSlot] = createSignal('idle');
  const [gizmoMode, setGizmoMode] = createSignal('rotate');

  const previewSlots = createMemo(() => ([
    ['idle', 'Idle'],
    ['walk', 'Walk'],
    ['run', 'Run'],
    ['walkBackward', 'Walk Back'],
    ['runBackward', 'Run Back'],
    ['strafeLeft', 'Strafe Left'],
    ['strafeRight', 'Strafe Right']
  ]));

  function disposePreview() {
    currentLoadToken += 1;
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    resizeObserver?.disconnect?.();
    resizeObserver = null;
    if (transformHelper) {
      scene?.remove(transformHelper);
      transformHelper = null;
    }
    if (transformControls) {
      transformControls.detach();
      transformControls.dispose?.();
      transformControls = null;
    }
    controls?.dispose?.();
    controls = null;
    if (renderer?.domElement?.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    renderer?.dispose?.();
    renderer = null;
    scene = null;
    camera = null;
    previewRoot = null;
    actor = null;
    weaponSocket = null;
    weaponInstance = null;
    socketMarkers = null;
    lastWeaponSourceKey = '';
  }

  function renderFrame() {
    if (!renderer || !scene || !camera) {
      return;
    }
    const deltaSeconds = Math.min(CLOCK.getDelta(), 1 / 24);
    if (actor) {
      updateHumanoidActor(actor, deltaSeconds);
      stabilizeHumanoidRootMotion(actor, { stabilizeVertical: true });
    }
    controls?.update();
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(renderFrame);
  }

  function syncDraftFromGizmo() {
    if (!weaponInstance || !props.onUpdateField) {
      return;
    }
    const position = weaponInstance.position;
    const rotation = weaponInstance.rotation;
    const round = (value) => Number(value.toFixed(4));
    const previousRotation = props.weaponDraft?.grip?.rotation || [0, 0, 0];

    suppressDraftSync = true;
    props.onUpdateField(['grip', 'offset', 0], round(position.x), { numeric: true });
    props.onUpdateField(['grip', 'offset', 1], round(position.y), { numeric: true });
    props.onUpdateField(['grip', 'offset', 2], round(position.z), { numeric: true });
    props.onUpdateField(['grip', 'rotation', 0], round(unwrapAngleNear(rotation.x, Number(previousRotation[0] || 0))), { numeric: true });
    props.onUpdateField(['grip', 'rotation', 1], round(unwrapAngleNear(rotation.y, Number(previousRotation[1] || 0))), { numeric: true });
    props.onUpdateField(['grip', 'rotation', 2], round(unwrapAngleNear(rotation.z, Number(previousRotation[2] || 0))), { numeric: true });
  }

  function draftMatchesWeaponInstance() {
    if (!weaponInstance) {
      return true;
    }
    const offset = props.weaponDraft?.grip?.offset || [0, 0, 0];
    const rotation = props.weaponDraft?.grip?.rotation || [0, 0, 0];
    const round = (value) => Number(value.toFixed(4));
    return (
      round(weaponInstance.position.x) === round(Number(offset[0] || 0))
      && round(weaponInstance.position.y) === round(Number(offset[1] || 0))
      && round(weaponInstance.position.z) === round(Number(offset[2] || 0))
      && round(weaponInstance.rotation.x) === round(Number(rotation[0] || 0))
      && round(weaponInstance.rotation.y) === round(Number(rotation[1] || 0))
      && round(weaponInstance.rotation.z) === round(Number(rotation[2] || 0))
    );
  }

  function attachTransformControls() {
    if (!scene || !camera || !renderer?.domElement || !controls || !weaponInstance) {
      return;
    }

    if (transformHelper) {
      scene.remove(transformHelper);
      transformHelper = null;
    }
    if (transformControls) {
      transformControls.detach();
      transformControls.dispose?.();
      transformControls = null;
    }

    transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode(gizmoMode());
    transformControls.setSpace('local');
    transformControls.size = 0.9;
    transformControls.addEventListener('dragging-changed', (event) => {
      gizmoDragging = Boolean(event.value);
      controls.enabled = !event.value;
      if (!event.value) {
        syncDraftFromGizmo();
      }
    });
    transformControls.addEventListener('objectChange', () => {
      rebuildSocketMarkers();
    });
    transformHelper = transformControls.getHelper();
    scene.add(transformHelper);
    transformControls.attach(weaponInstance);
  }

  function rebuildSocketMarkers() {
    socketMarkers?.clear();
    if (!socketMarkers || !weaponInstance) {
      return;
    }

    socketMarkers.add(createSocketMarker('#ef4444', props.weaponDraft?.sockets?.muzzle || [0, 0, 0.6]));
    socketMarkers.add(createSocketMarker('#22c55e', props.weaponDraft?.sockets?.offHand || [0, -0.04, 0.28]));
    socketMarkers.add(createSocketMarker('#3b82f6', props.weaponDraft?.sockets?.casingEject || [0.04, 0.03, 0.02]));
    socketMarkers.add(createSocketMarker('#f59e0b', props.weaponDraft?.sockets?.aim || [0, 0.04, 0.18]));
  }

  function applyPreviewPose() {
    if (!actor) {
      return;
    }
    const actionName = props.weaponDraft?.locomotionSet?.[previewSlot()] || props.weaponDraft?.locomotionSet?.idle || 'idle';
    setHumanoidActorAction(actor, actionName);
    stabilizeHumanoidRootMotion(actor, { stabilizeVertical: true });
    setStatus(`Previewing ${previewSlot()} using ${actionName}.`);
  }

  async function ensureActorLoaded() {
    if (actor) {
      return actor;
    }

    actor = await loadHumanoidActor({
      fbxLoader,
      modelUrl: MODEL_CONFIG.character.modelUrl,
      animationUrls: MODEL_CONFIG.character.animationUrls,
      config: MODEL_CONFIG.character,
      defaultAction: props.weaponDraft?.locomotionSet?.idle || 'idle'
    });

    previewRoot.add(actor.root);
    stabilizeHumanoidRootMotion(actor, { stabilizeVertical: true });

    const handBone = findRightHandBone(actor.model);
    if (!handBone) {
      throw new Error('Could not find Norm right hand bone for preview.');
    }

    weaponSocket = new THREE.Group();
    weaponSocket.name = 'weapon-preview-socket';
    handBone.add(weaponSocket);
    syncSocketScale(weaponSocket, handBone);
    socketMarkers = new THREE.Group();
    socketMarkers.name = 'weapon-preview-markers';
    weaponSocket.add(socketMarkers);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4.8, 48),
      new THREE.MeshStandardMaterial({ color: '#d9dfdb', roughness: 0.94, metalness: 0.02 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    previewRoot.add(floor);

    return actor;
  }

  async function updateWeaponPreview() {
    if (!previewRoot) {
      return;
    }

    const token = ++currentLoadToken;
    setBusy(true);

    try {
      const currentActor = await ensureActorLoaded();
      if (token !== currentLoadToken) {
        return;
      }

      applyPreviewPose();

      const loadUrl = getWeaponLoadUrl(props.weaponDraft);
      const sourceKey = JSON.stringify({
        loadUrl,
        proceduralModel: props.weaponDraft?.proceduralModel || null
      });

      if (sourceKey !== lastWeaponSourceKey) {
        lastWeaponSourceKey = sourceKey;
        weaponInstance?.removeFromParent?.();
        weaponInstance = null;

        if (loadUrl || props.weaponDraft?.proceduralModel) {
          const template = loadUrl
            ? await loadWeaponTemplate(loadUrl)
            : loadProceduralWeaponTemplate(props.weaponDraft.proceduralModel);
          if (token !== currentLoadToken) {
            return;
          }

          weaponInstance = template.clone(true);
          weaponInstance.name = `${props.weaponDraft?.id || 'weapon'}-preview`;
          weaponSocket.add(weaponInstance);
        }
      }

      syncSocketScale(weaponSocket, findRightHandBone(currentActor.model));

      if (weaponInstance) {
        if (!suppressDraftSync && !gizmoDragging) {
          applyWeaponPresentation(weaponInstance, props.weaponDraft);
        }
      }

      rebuildSocketMarkers();
      attachTransformControls();
      frameCamera(camera, controls, actor?.root || previewRoot);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (token === currentLoadToken) {
        setBusy(false);
      }
    }
  }

  async function initPreview() {
    if (!viewportRef || renderer) {
      return;
    }

    scene = new THREE.Scene();
    scene.background = new THREE.Color('#edf0ee');

    camera = new THREE.PerspectiveCamera(36, 1, 0.05, 200);
    camera.position.set(2.4, 1.5, 3.4);

    renderer = new THREE.WebGPURenderer({
      antialias: true,
      forceWebGL: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(viewportRef.clientWidth || 640, viewportRef.clientHeight || 480);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'validator-canvas';
    viewportRef.appendChild(renderer.domElement);
    await renderer.init();

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 1, 0);

    const hemi = new THREE.HemisphereLight('#ffffff', '#98a29b', 1.45);
    hemi.position.set(0, 4, 0);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fff6e8', 1.85);
    keyLight.position.set(5, 7, 4);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#c8e1ff', 0.7);
    rimLight.position.set(-4, 3, -5);
    scene.add(rimLight);

    previewRoot = new THREE.Group();
    scene.add(previewRoot);

    resizeObserver = new ResizeObserver(() => {
      if (!viewportRef || !renderer || !camera) {
        return;
      }
      const width = Math.max(viewportRef.clientWidth, 1);
      const height = Math.max(viewportRef.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      frameCamera(camera, controls, actor?.root || previewRoot);
    });
    resizeObserver.observe(viewportRef);

    CLOCK.start();
    renderFrame();
  }

  createEffect(() => {
    if (!viewportRef || renderer) {
      return;
    }
    void initPreview().catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Failed to initialize preview.');
    });
  });

  createEffect(() => {
    props.weaponDraft?.id;
    props.weaponDraft?.asset?.url;
    props.weaponDraft?.proceduralModel;
    props.weaponDraft?.grip?.offset?.join(',');
    props.weaponDraft?.grip?.rotation?.join(',');
    props.weaponDraft?.grip?.scale;
    props.weaponDraft?.sockets?.muzzle?.join(',');
    props.weaponDraft?.sockets?.offHand?.join(',');
    props.weaponDraft?.sockets?.casingEject?.join(',');
    props.weaponDraft?.sockets?.aim?.join(',');
    props.weaponDraft?.locomotionSet?.idle;
    props.weaponDraft?.locomotionSet?.walk;
    props.weaponDraft?.locomotionSet?.run;
    props.weaponDraft?.locomotionSet?.walkBackward;
    props.weaponDraft?.locomotionSet?.runBackward;
    props.weaponDraft?.locomotionSet?.strafeLeft;
    props.weaponDraft?.locomotionSet?.strafeRight;
    if (suppressDraftSync && draftMatchesWeaponInstance()) {
      suppressDraftSync = false;
    }
    void updateWeaponPreview();
  });

  createEffect(() => {
    previewSlot();
    applyPreviewPose();
  });

  createEffect(() => {
    const mode = gizmoMode();
    if (!transformControls) {
      return;
    }
    transformControls.setMode(mode);
  });

  onCleanup(() => {
    disposePreview();
  });

  return (
    <section class="subpanel">
      <div class="subpanel-header">
        <h3>Character Preview</h3>
        <span class="preview-meta">{busy() ? 'Loading…' : status()}</span>
      </div>

      <div class="preview-toolbar">
        <label class="field">
          <span>Animation</span>
          <select class="field-select" value={previewSlot()} onChange={(event) => setPreviewSlot(event.currentTarget.value)}>
            <For each={previewSlots()}>
              {([slotId, slotLabel]) => <option value={slotId}>{slotLabel}</option>}
            </For>
          </select>
        </label>
        <div class="preview-mode-group">
          <button
            type="button"
            class={`ghost-button${gizmoMode() === 'rotate' ? ' is-active' : ''}`}
            onClick={() => setGizmoMode('rotate')}
          >
            Rotate Gizmo
          </button>
          <button
            type="button"
            class={`ghost-button${gizmoMode() === 'translate' ? ' is-active' : ''}`}
            onClick={() => setGizmoMode('translate')}
          >
            Move Gizmo
          </button>
        </div>
      </div>

      <div ref={(element) => {
        viewportRef = element;
      }} class="weapon-preview-viewport" />

      <div class="preview-chip-row">
        <span class="preview-chip preview-chip-red">Muzzle</span>
        <span class="preview-chip preview-chip-green">Off hand</span>
        <span class="preview-chip preview-chip-blue">Casing</span>
        <span class="preview-chip preview-chip-gold">Aim</span>
      </div>
    </section>
  );
}
