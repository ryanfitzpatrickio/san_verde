import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const AXIS_VECTORS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1)
];

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function axisToRotationProperty(axis) {
  if (axis === 1) {
    return 'y';
  }
  if (axis === 2) {
    return 'z';
  }
  return 'x';
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

function collectTireSocketPosition(rootObject) {
  let socket = null;
  rootObject.traverse((child) => {
    if (!socket && child.name && /socket/i.test(child.name)) {
      socket = child.position.clone();
    }
  });
  return socket;
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
    AXIS_VECTORS[widthAxis],
    AXIS_VECTORS[0]
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

function setDoubleSided(rootObject) {
  rootObject.traverse((child) => {
    if (!child?.isMesh) {
      return;
    }
    child.material = Array.isArray(child.material)
      ? child.material.map((entry) => {
          const clone = entry?.clone?.() || entry;
          if (clone && 'side' in clone) {
            clone.side = THREE.DoubleSide;
          }
          return clone;
        })
      : (() => {
          const clone = child.material?.clone?.() || child.material;
          if (clone && 'side' in clone) {
            clone.side = THREE.DoubleSide;
          }
          return clone;
        })();
  });
}

function quaternionFromEulerArray(values) {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(values[0] || 0, values[1] || 0, values[2] || 0)
  );
}

export function TireValidationDialog(props) {
  let viewportRef;
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let resizeObserver = null;
  let animationFrame = 0;
  let previewRoot = null;
  let sourceTireRoot = null;
  let currentLoadToken = 0;

  const [status, setStatus] = createSignal('Load a tire asset to preview.');
  const [busy, setBusy] = createSignal(false);
  const [tireRotation, setTireRotation] = createSignal([0, Math.PI, 0]);
  const [rightSideTireRotation, setRightSideTireRotation] = createSignal([Math.PI, 0, 0]);
  const [rightSideTireMirror, setRightSideTireMirror] = createSignal(false);
  const [tireScale, setTireScale] = createSignal(1);

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
    sourceTireRoot = null;
  }

  function syncFromPreset(preset) {
    setTireRotation(cloneValue(preset?.tireRotation || [0, Math.PI, 0]));
    setRightSideTireRotation(cloneValue(preset?.rightSideTireRotation || [Math.PI, 0, 0]));
    setRightSideTireMirror(Boolean(preset?.rightSideTireMirror));
    setTireScale(Number(preset?.tireScale || 1));
  }

  function renderFrame() {
    if (!renderer || !scene || !camera) {
      return;
    }
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(renderFrame);
  }

  function framePreview() {
    if (!camera || !controls || !previewRoot) {
      return;
    }

    const bounds = new THREE.Box3().setFromObject(previewRoot);
    if (bounds.isEmpty()) {
      return;
    }

    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1) * 0.5;
    controls.target.copy(center);
    camera.position.copy(center.clone().add(new THREE.Vector3(radius * 2.2, radius * 1.2, radius * 2.2)));
    camera.near = 0.05;
    camera.far = Math.max(50, radius * 30);
    camera.updateProjectionMatrix();
    controls.update();
  }

  function rebuildPreview() {
    if (!previewRoot) {
      return;
    }

    previewRoot.clear();

    if (!sourceTireRoot) {
      return;
    }

    const profile = measureTireProfile(sourceTireRoot);
    if (!profile) {
      setStatus('Unable to measure tire asset.');
      return;
    }

    const axleLine = new THREE.Mesh(
      new THREE.BoxGeometry(3.8, 0.03, 0.03),
      new THREE.MeshBasicMaterial({ color: '#32413a' })
    );
    axleLine.position.y = profile.diameter * 0.12;
    previewRoot.add(axleLine);

    const leftWheel = buildPreviewWheel({
      isRight: false,
      profile
    });
    leftWheel.position.x = -1.2;
    previewRoot.add(leftWheel);

    const rightWheel = buildPreviewWheel({
      isRight: true,
      profile
    });
    rightWheel.position.x = 1.2;
    previewRoot.add(rightWheel);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshBasicMaterial({ color: '#d7ddd9' })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.001;
    previewRoot.add(floor);

    framePreview();
  }

  function buildPreviewWheel({ isRight, profile }) {
    const wheel = new THREE.Group();
    const asset = sourceTireRoot.clone(true);
    asset.position.sub(profile.socketPosition || profile.center);

    if (isRight && rightSideTireMirror()) {
      asset.scale[axisToRotationProperty(profile.widthAxis)] *= -1;
      setDoubleSided(asset);
    }

    wheel.add(asset);
    wheel.scale.setScalar(tireScale());
    wheel.quaternion.copy(profile.alignment);
    wheel.quaternion.multiply(quaternionFromEulerArray(tireRotation()));

    if (isRight) {
      wheel.quaternion.multiply(quaternionFromEulerArray(rightSideTireRotation()));
    }

    return wheel;
  }

  async function loadTire(url) {
    if (!url) {
      sourceTireRoot = null;
      rebuildPreview();
      return;
    }

    const token = ++currentLoadToken;
    setBusy(true);
    setStatus(`Loading tire ${url}`);
    try {
      const gltf = await loader.loadAsync(url);
      if (token !== currentLoadToken) {
        return;
      }
      sourceTireRoot = gltf.scene || gltf.scenes?.[0] || null;
      rebuildPreview();
      setStatus('Adjust rotation and mirroring until the left/right sidewalls look correct.');
    } catch (error) {
      console.error(error);
      sourceTireRoot = null;
      setStatus(error instanceof Error ? error.message : 'Failed to load tire asset.');
      rebuildPreview();
    } finally {
      if (token === currentLoadToken) {
        setBusy(false);
      }
    }
  }

  function updateTriple(signal, index, value) {
    signal((current) => {
      const next = [...current];
      next[index] = Number(value);
      return next;
    });
  }

  function applyChanges() {
    props.onApply?.({
      tireRotation: cloneValue(tireRotation()),
      rightSideTireRotation: cloneValue(rightSideTireRotation()),
      rightSideTireMirror: Boolean(rightSideTireMirror()),
      tireScale: Number(tireScale())
    });
  }

  createEffect(() => {
    if (!props.open) {
      disposePreview();
      return;
    }

    syncFromPreset(props.initialPreset || {});
    queueMicrotask(() => {
      if (!viewportRef || renderer) {
        return;
      }

      const initializeViewport = async () => {
        scene = new THREE.Scene();
        scene.background = new THREE.Color('#eef2ef');
        scene.add(new THREE.HemisphereLight('#ffffff', '#8ca19a', 1.6));
        const keyLight = new THREE.DirectionalLight('#ffffff', 1.8);
        keyLight.position.set(5, 7, 6);
        scene.add(keyLight);

        camera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
        renderer = new THREE.WebGPURenderer({
          antialias: true,
          forceWebGL: true
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(viewportRef.clientWidth || 640, viewportRef.clientHeight || 420);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.className = 'validator-canvas';
        viewportRef.appendChild(renderer.domElement);
        await renderer.init();

        if (!props.open) {
          return;
        }

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(0, 0.4, 0);

        previewRoot = new THREE.Group();
        scene.add(previewRoot);

        resizeObserver = new ResizeObserver(() => {
          if (!viewportRef || !renderer || !camera) {
            return;
          }
          const width = Math.max(viewportRef.clientWidth || 1, 320);
          const height = Math.max(viewportRef.clientHeight || 1, 320);
          renderer.setSize(width, height);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        });
        resizeObserver.observe(viewportRef);
        renderFrame();
        loadTire(props.tireUrl);
      };

      initializeViewport().catch((error) => {
        console.error(error);
        setStatus(error instanceof Error ? error.message : 'Failed to initialize tire preview.');
      });
    });
  });

  createEffect(() => {
    if (!props.open || !renderer) {
      return;
    }
    loadTire(props.tireUrl);
  });

  createEffect(() => {
    if (!props.open) {
      return;
    }
    rebuildPreview();
  });

  onCleanup(() => {
    disposePreview();
  });

  return (
    <Show when={props.open}>
      <div class="modal-backdrop">
        <div class="modal-shell validator-modal">
          <div class="panel-header">
            <div>
              <p class="panel-label">Tire Preview</p>
              <h2>{props.title || props.tireLabel || 'Tire setup'}</h2>
              <p class="asset-subtitle">{status()}</p>
            </div>
            <div class="asset-inline-actions">
              <button type="button" class="ghost-button" onClick={props.onClose}>
                Close
              </button>
              <button type="button" class="solid-button" onClick={applyChanges} disabled={busy()}>
                Apply
              </button>
            </div>
          </div>

          <div class="tire-preview-layout">
            <aside class="validator-sidebar">
              <section class="validator-section">
                <h3>Asset</h3>
                <div class="field-grid">
                  <label class="field field-wide">
                    <span>URL</span>
                    <input value={props.tireUrl || ''} readOnly />
                  </label>
                </div>
              </section>

              <section class="validator-section">
                <h3>Shared Rotation</h3>
                <div class="field-grid">
                  <label class="field"><span>Rot X</span><input type="number" step="0.01" value={tireRotation()[0]} onInput={(event) => updateTriple(setTireRotation, 0, event.currentTarget.value)} /></label>
                  <label class="field"><span>Rot Y</span><input type="number" step="0.01" value={tireRotation()[1]} onInput={(event) => updateTriple(setTireRotation, 1, event.currentTarget.value)} /></label>
                  <label class="field"><span>Rot Z</span><input type="number" step="0.01" value={tireRotation()[2]} onInput={(event) => updateTriple(setTireRotation, 2, event.currentTarget.value)} /></label>
                  <label class="field"><span>Tire Scale</span><input type="number" step="0.01" value={tireScale()} onInput={(event) => setTireScale(Number(event.currentTarget.value))} /></label>
                </div>
              </section>

              <section class="validator-section">
                <h3>Right Side</h3>
                <div class="field-grid">
                  <label class="field"><span>Rot X</span><input type="number" step="0.01" value={rightSideTireRotation()[0]} onInput={(event) => updateTriple(setRightSideTireRotation, 0, event.currentTarget.value)} /></label>
                  <label class="field"><span>Rot Y</span><input type="number" step="0.01" value={rightSideTireRotation()[1]} onInput={(event) => updateTriple(setRightSideTireRotation, 1, event.currentTarget.value)} /></label>
                  <label class="field"><span>Rot Z</span><input type="number" step="0.01" value={rightSideTireRotation()[2]} onInput={(event) => updateTriple(setRightSideTireRotation, 2, event.currentTarget.value)} /></label>
                  <label class="field field-checkbox">
                    <span>Mirror Right</span>
                    <input type="checkbox" checked={rightSideTireMirror()} onChange={(event) => setRightSideTireMirror(event.currentTarget.checked)} />
                  </label>
                </div>
              </section>
            </aside>

            <div class="tire-preview-viewport" ref={viewportRef} />
          </div>
        </div>
      </div>
    </Show>
  );
}
