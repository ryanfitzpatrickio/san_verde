import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSceneHelpers } from '../scene-helpers.js';
import { MODEL_CONFIG } from '../app-shell.js';
import { CarVehicle } from '../vehicles/car-vehicle.js';
import { buildMountedCarRig } from '../vehicles/car-rig.js';
import {
  collectEmbeddedWheelAssets
} from '../vehicles/car-rig-helpers.js';
import { createMountedCarRuntime } from '../vehicles/car-runtime.js';
import { inferVehicleForwardYawDegrees } from '../vehicles/vehicle-orientation.js';

const loader = new GLTFLoader();

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function createPreviewState(manifest) {
  const preset = manifest?.preset || {};
  return {
    steeringWheelAsset: null,
    steerAngle: 0,
    tireScale: Number.isFinite(preset.tireScale) ? preset.tireScale : 0.93,
    frontAxleRatio: Number.isFinite(preset.frontAxleRatio) ? preset.frontAxleRatio : 0.18,
    rearAxleRatio: Number.isFinite(preset.rearAxleRatio) ? preset.rearAxleRatio : 0.245,
    rideHeight: Number.isFinite(preset.rideHeight) ? preset.rideHeight : 0.105,
    chassisHeight: Number.isFinite(preset.chassisHeight) ? preset.chassisHeight : 0.11,
    bodyVisualOffsetY: Number.isFinite(preset.bodyVisualOffsetY) ? preset.bodyVisualOffsetY : 0,
    sideInset: Number.isFinite(preset.sideInset) ? preset.sideInset : 0.07,
    tireRotation: Array.isArray(preset.tireRotation) ? [...preset.tireRotation] : [0, Math.PI, 0],
    leftSideTireRotation: Array.isArray(preset.leftSideTireRotation)
      ? [...preset.leftSideTireRotation]
      : [...MODEL_CONFIG.leftSideTireRotation],
    leftSideTireMirror: Boolean(
      'leftSideTireMirror' in preset ? preset.leftSideTireMirror : MODEL_CONFIG.leftSideTireMirror
    ),
    rightSideTireRotation: Array.isArray(preset.rightSideTireRotation)
      ? [...preset.rightSideTireRotation]
      : [Math.PI, 0, 0],
    rightSideTireMirror: Boolean(preset.rightSideTireMirror),
    selectedBuiltInCarId: manifest?.id || '',
    wheelRadius: 0.42
  };
}

function fitObjectToGroundAndCenter(group) {
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  if (bounds.isEmpty()) {
    return;
  }
  const center = bounds.getCenter(new THREE.Vector3());
  group.position.x -= center.x;
  group.position.z -= center.z;
  group.position.y -= bounds.min.y;
  group.updateMatrixWorld(true);
}

function frameCamera(camera, controls, target) {
  target.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(target);
  if (bounds.isEmpty()) {
    return;
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 1) * 0.5;
  controls.target.copy(center);
  camera.position.copy(center.clone().add(new THREE.Vector3(radius * 2, radius * 1.1, radius * 2)));
  camera.near = 0.05;
  camera.far = Math.max(200, radius * 40);
  camera.updateProjectionMatrix();
  controls.update();
}

function withCacheBust(url, token) {
  const absolute = new URL(url, window.location.origin);
  absolute.searchParams.set('t', String(token));
  return absolute.toString();
}

export function VehiclePreviewDialog(props) {
  let viewportRef;
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let resizeObserver = null;
  let animationFrame = 0;
  let previewRoot = null;
  let currentLoadToken = 0;
  let mountedVehicle = null;

  const [status, setStatus] = createSignal('Preview current vehicle manifest.');
  const [busy, setBusy] = createSignal(false);
  const [steerAngle, setSteerAngle] = createSignal(0);
  const [wheelSpin, setWheelSpin] = createSignal(0);
  const [suspensionOffset, setSuspensionOffset] = createSignal(0);

  function applySuspensionOffsetToManifest() {
    const currentBodyVisualOffsetY = Number(props.manifest?.preset?.bodyVisualOffsetY || 0);
    const nextBodyVisualOffsetY = currentBodyVisualOffsetY - Number(suspensionOffset() || 0);
    props.onApplyPresetPatch?.({
      bodyVisualOffsetY: nextBodyVisualOffsetY
    });
    setSuspensionOffset(0);
    setStatus(`Applied preview suspension to Body Visual Y (${nextBodyVisualOffsetY.toFixed(3)}).`);
  }

  function disposePreview() {
    currentLoadToken += 1;
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    resizeObserver?.disconnect?.();
    resizeObserver = null;
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
    mountedVehicle = null;
  }

  function applyPose({ steer, spin, suspension }) {
    mountedVehicle?.runtime?.setState({
      steerAngle: steer,
      wheelSpin: spin,
      suspensionOffset: suspension
    });
  }

  async function rebuildVehicle() {
    if (!previewRoot || !props.manifest?.body?.url) {
      return;
    }

    const token = ++currentLoadToken;
    setBusy(true);

    try {
      const manifest = cloneValue(props.manifest);
      const previewState = createPreviewState(manifest);
      const helpers = createSceneHelpers({
        state: previewState,
        ui: {},
        config: MODEL_CONFIG
      });
      const carVehicle = new CarVehicle({
        config: MODEL_CONFIG,
        state: previewState,
        helpers: {
          clearGroup: helpers.clearGroup,
          normalizeToTargetSpan: helpers.normalizeToTargetSpan,
          prepareRenderable: helpers.prepareRenderable,
          measureObjectBounds: helpers.measureObjectBounds,
          measureTireProfile: helpers.measureTireProfile,
          collectWheelAnchors: helpers.collectWheelAnchors,
          collectEmbeddedWheelAssets,
          collectSteeringWheelRig: helpers.collectSteeringWheelRig,
          mountSteeringWheelAttachment: helpers.mountSteeringWheelAttachment,
          createDoorRig: helpers.createDoorRig,
          createWheelSpinMarker: helpers.createWheelSpinMarker,
          createFallbackMountedWheel: helpers.createFallbackMountedWheel,
          axisToRotationProperty: helpers.axisToRotationProperty
        }
      });

      const bodyGltf = await loader.loadAsync(withCacheBust(manifest.body.url, token));
      const frontTireGltf = manifest.tires?.front?.url
        ? await loader.loadAsync(withCacheBust(manifest.tires.front.url, `${token}-front`)).catch(() => null)
        : null;
      const rearTireGltf = manifest.tires?.rear?.url && manifest.tires.rear.url !== manifest.tires?.front?.url
        ? await loader.loadAsync(withCacheBust(manifest.tires.rear.url, `${token}-rear`)).catch(() => null)
        : null;

      if (token !== currentLoadToken) {
        return;
      }

      previewRoot.clear();
      mountedVehicle = null;

      const bodyScene = bodyGltf.scene || bodyGltf.scenes?.[0];
      if (!bodyScene) {
        throw new Error('Vehicle body GLB contains no scene.');
      }
      bodyScene.userData.assetBodyRotationYDeg = Object.hasOwn(manifest.body || {}, 'rotationYDeg')
        ? Number(manifest.body.rotationYDeg || 0)
        : inferVehicleForwardYawDegrees(bodyScene);

      const tireAssets = {
        front: frontTireGltf ? (frontTireGltf.scene || frontTireGltf.scenes?.[0]) : null,
        rear: rearTireGltf
          ? (rearTireGltf.scene || rearTireGltf.scenes?.[0])
          : frontTireGltf
            ? (frontTireGltf.scene || frontTireGltf.scenes?.[0])
            : null
      };

      const vehicleGroup = new THREE.Group();
      const presentation = buildMountedCarRig({
        carVehicle,
        rawAsset: bodyScene,
        activeTireAssets: tireAssets,
        stripEmbeddedWheels: Boolean(manifest.tires?.front || manifest.tires?.rear),
        bodyVisualOffsetY: Number(manifest?.preset?.bodyVisualOffsetY || 0)
      });
      const bodyMount = new THREE.Group();
      const wheelMount = new THREE.Group();
      bodyMount.add(presentation.body);
      for (const child of [...presentation.wheelMount.children]) {
        presentation.wheelMount.remove(child);
        wheelMount.add(child);
      }
      vehicleGroup.add(bodyMount, wheelMount);

      previewRoot.add(vehicleGroup);

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(18, 18),
        new THREE.MeshStandardMaterial({ color: '#d7ddd9', roughness: 0.95, metalness: 0.02 })
      );
      floor.rotation.x = -Math.PI / 2;
      previewRoot.add(floor);

      fitObjectToGroundAndCenter(vehicleGroup);
      floor.position.y = 0;

      mountedVehicle = {
        vehicleGroup,
        bodyMount,
        wheelMount,
        runtime: createMountedCarRuntime({
          bodyMount,
          wheelMount,
          steeringWheelRig: presentation.steeringWheelRig,
          steeringWheelTurnRatio: MODEL_CONFIG.steeringWheelTurnRatio
        })
      };
      applyPose({
        steer: steerAngle(),
        spin: wheelSpin(),
        suspension: suspensionOffset()
      });
      frameCamera(camera, controls, vehicleGroup);
      setStatus(`Previewing ${manifest.label || manifest.id || 'vehicle'} with current manifest settings.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (token === currentLoadToken) {
        setBusy(false);
      }
    }
  }

  createEffect(() => {
    if (!props.open) {
      disposePreview();
      return;
    }

    void rebuildVehicle();
  });

  createEffect(() => {
    if (!props.open) {
      return;
    }
    const steer = steerAngle();
    const spin = wheelSpin();
    const suspension = suspensionOffset();
    applyPose({ steer, spin, suspension });
  });

  createEffect(() => {
    if (!props.open || !viewportRef || renderer) {
      return;
    }

    let cancelled = false;

    const initialize = async () => {
      scene = new THREE.Scene();
      scene.background = new THREE.Color('#d6dbde');

      camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
      camera.position.set(5, 2.4, 5);

      renderer = new THREE.WebGPURenderer({
        antialias: true,
        forceWebGL: true
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(viewportRef.clientWidth || 640, viewportRef.clientHeight || 420);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.className = 'validator-canvas';
      viewportRef.append(renderer.domElement);
      await renderer.init();

      if (cancelled) {
        return;
      }

      const hemi = new THREE.HemisphereLight('#fff7d8', '#73806e', 1.7);
      const sun = new THREE.DirectionalLight('#fff4db', 2.1);
      sun.position.set(4, 7, 5);
      scene.add(hemi, sun);

      previewRoot = new THREE.Group();
      scene.add(previewRoot);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.target.set(0, 0.9, 0);

      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        const width = Math.max(entry.contentRect.width, 320);
        const height = Math.max(entry.contentRect.height, 320);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      });
      resizeObserver.observe(viewportRef);

      const tick = () => {
        animationFrame = requestAnimationFrame(tick);
        controls.update();
        renderer.render(scene, camera);
      };
      tick();

      void rebuildVehicle();
    };

    void initialize();

    onCleanup(() => {
      cancelled = true;
    });
  });

  onCleanup(() => {
    disposePreview();
  });

  return (
    <Show when={props.open}>
      <div class="modal-backdrop" onClick={props.onClose}>
        <div class="modal-shell validator-modal" onClick={(event) => event.stopPropagation()}>
          <div class="panel-header">
            <div>
              <p class="panel-label">Preview</p>
              <h2>Vehicle Manifest Preview</h2>
            </div>
            <button type="button" class="ghost-button" onClick={props.onClose}>
              Close
            </button>
          </div>

          <div class="validator-layout">
            <div class="validator-sidebar">
              <div class="validator-status">
                <strong>{busy() ? 'Loading' : 'Ready'}</strong>
                <span>{status()}</span>
              </div>

              <div class="validator-section">
                <h3>Pose</h3>
                <div class="field-grid">
                  <label class="field field-wide">
                    <span>Steer Angle</span>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.01}
                      value={steerAngle()}
                      onInput={(event) => setSteerAngle(Number(event.currentTarget.value))}
                    />
                  </label>
                  <label class="field field-wide">
                    <span>Wheel Spin</span>
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={0.01}
                      value={wheelSpin()}
                      onInput={(event) => setWheelSpin(Number(event.currentTarget.value))}
                    />
                  </label>
                  <label class="field field-wide">
                    <span>Suspension Offset</span>
                    <input
                      type="range"
                      min={-0.25}
                      max={0.25}
                      step={0.005}
                      value={suspensionOffset()}
                      onInput={(event) => setSuspensionOffset(Number(event.currentTarget.value))}
                    />
                  </label>
                </div>
                <div class="asset-inline-actions">
                  <button
                    type="button"
                    class="ghost-button"
                    onClick={applySuspensionOffsetToManifest}
                  >
                    Apply Suspension To Manifest
                  </button>
                  <button
                    type="button"
                    class="ghost-button"
                    onClick={() => {
                      setSteerAngle(0);
                      setWheelSpin(0);
                      setSuspensionOffset(0);
                    }}
                  >
                    Reset Pose
                  </button>
                </div>
                <p class="preview-footnote">
                  `Suspension Offset` is preview-only until you apply it. It writes to `preset.bodyVisualOffsetY`.
                </p>
              </div>
            </div>

            <div class="validator-viewport" ref={(element) => { viewportRef = element; }} />
          </div>
        </div>
      </div>
    </Show>
  );
}
