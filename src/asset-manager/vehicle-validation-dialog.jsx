import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import {
  REQUIRED_LOCATOR_NAMES,
  analyzeVehicleScene,
  ensureLocatorHelpers,
  stripEditorHelpers
} from './vehicle-validator.js';

const loader = new GLTFLoader();
const exporter = new GLTFExporter();

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function exportSceneToGlb(root) {
  const exportRoot = root.clone(true);
  stripEditorHelpers(exportRoot);

  return new Promise((resolve, reject) => {
    exporter.parse(
      exportRoot,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result);
          return;
        }
        reject(new Error('Expected binary GLB export.'));
      },
      reject,
      { binary: true, onlyVisible: false }
    );
  });
}

function fitPreviewRoot(previewGroup, modelRoot) {
  modelRoot.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(modelRoot);
  if (bounds.isEmpty()) {
    return;
  }

  const center = bounds.getCenter(new THREE.Vector3());

  previewGroup.position.copy(center).multiplyScalar(-1);
  previewGroup.scale.setScalar(1);
  previewGroup.updateMatrixWorld(true);

  const fittedBounds = new THREE.Box3().setFromObject(modelRoot);
  previewGroup.position.y -= fittedBounds.min.y;
  previewGroup.updateMatrixWorld(true);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.message || payload.error || 'Request failed');
  }

  return payload;
}

function fileToArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
    reader.readAsArrayBuffer(file);
  });
}

export function VehicleValidationDialog(props) {
  let viewportRef;
  let renderer = null;
  let scene = null;
  let camera = null;
  let orbitControls = null;
  let transformControls = null;
  let transformHelper = null;
  let previewRoot = null;
  let resizeObserver = null;
  let animationFrame = 0;
  let activeModelRoot = null;
  let pendingFile = null;
  let sourceFile = null;
  let sourceFileBase64 = '';

  const [status, setStatus] = createSignal('Load a GLB to begin validation.');
  const [validation, setValidation] = createSignal(null);
  const [selectedLocatorName, setSelectedLocatorName] = createSignal(REQUIRED_LOCATOR_NAMES[0]);
  const [saveFilename, setSaveFilename] = createSignal('validated-car.glb');
  const [savedModel, setSavedModel] = createSignal(null);
  const [busy, setBusy] = createSignal(false);
  const [nudgeStep, setNudgeStep] = createSignal(0.02);

  const approved = createMemo(() => Boolean(validation()?.approved));

  function focusLocator(locator) {
    if (!locator || !camera || !orbitControls) {
      return;
    }

    const worldPosition = locator.getWorldPosition(new THREE.Vector3());
    orbitControls.target.copy(worldPosition);
    camera.position.lerp(worldPosition.clone().add(new THREE.Vector3(1.6, 1.1, 1.6)), 1);
    orbitControls.update();
  }

  function frameActiveModel() {
    if (!activeModelRoot || !camera || !orbitControls) {
      return;
    }

    activeModelRoot.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(activeModelRoot);
    if (bounds.isEmpty()) {
      return;
    }

    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1) * 0.5;

    orbitControls.target.copy(center);
    camera.position.copy(center.clone().add(new THREE.Vector3(radius * 1.9, radius * 0.95, radius * 1.9)));
    camera.near = 0.05;
    camera.far = Math.max(200, radius * 40);
    camera.updateProjectionMatrix();
    orbitControls.update();
  }

  function attachSelectedLocator(locatorName = selectedLocatorName()) {
    if (!camera || !renderer?.domElement || !scene || !activeModelRoot) {
      return;
    }

    const locator = activeModelRoot.getObjectByName(locatorName);

    if (transformHelper) {
      scene.remove(transformHelper);
      transformHelper = null;
    }
    if (transformControls) {
      transformControls.detach();
      transformControls.dispose?.();
      transformControls = null;
    }

    if (!locator) {
      return;
    }

    transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode('translate');
    transformControls.setSpace('local');
    transformControls.size = 0.9;
    transformControls.addEventListener('dragging-changed', (event) => {
      orbitControls.enabled = !event.value;
    });
    transformControls.addEventListener('objectChange', () => {
      setSavedModel(null);
      refreshValidation();
    });
    transformHelper = transformControls.getHelper();
    scene.add(transformHelper);
    transformControls.attach(locator);
  }

  function selectLocator(locatorName) {
    setSelectedLocatorName(locatorName);
    attachSelectedLocator(locatorName);
  }

  function refreshValidation(options = {}) {
    if (!activeModelRoot) {
      setValidation(null);
      return;
    }

    ensureLocatorHelpers(activeModelRoot);
    setValidation(analyzeVehicleScene(activeModelRoot));
    if (options.reattach === true) {
      attachSelectedLocator();
    }
  }

  function getSelectedLocator() {
    return activeModelRoot?.getObjectByName(selectedLocatorName()) || null;
  }

  function updateSelectedLocatorAxis(axis, value) {
    const locator = getSelectedLocator();
    if (!locator) {
      return;
    }

    locator.position[axis] = Number(value);
    locator.updateMatrixWorld(true);
    setSavedModel(null);
    refreshValidation();
  }

  function nudgeSelectedLocator(axis, direction) {
    const locator = getSelectedLocator();
    if (!locator) {
      return;
    }

    locator.position[axis] += nudgeStep() * direction;
    locator.updateMatrixWorld(true);
    setSavedModel(null);
    refreshValidation();
  }

  async function loadModelFromUrl(url, label = url) {
    if (!previewRoot) {
      setStatus(`Preparing preview for ${label}...`);
      return;
    }

    setBusy(true);
    try {
      const gltf = await loader.loadAsync(url);
      const modelRoot = gltf.scene || gltf.scenes?.[0];

      if (!modelRoot) {
        throw new Error('GLB contains no scene.');
      }

      previewRoot.clear();
      previewRoot.position.set(0, 0, 0);
      previewRoot.scale.setScalar(1);
      previewRoot.add(modelRoot);
      activeModelRoot = modelRoot;
      fitPreviewRoot(previewRoot, activeModelRoot);
      ensureLocatorHelpers(activeModelRoot);
      setSavedModel(null);
      setStatus(`Loaded ${label}`);
      refreshValidation({ reattach: true });
      frameActiveModel();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadModelFromFile(file) {
    if (!previewRoot) {
      pendingFile = file;
      setStatus(`Preparing preview for ${file.name}...`);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setBusy(true);

    try {
      sourceFile = file;
      sourceFileBase64 = arrayBufferToBase64(await fileToArrayBuffer(file));
      setSaveFilename(file.name.replace(/\.glb$/i, '-validated.glb'));
      await loadModelFromUrl(objectUrl, file.name);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      URL.revokeObjectURL(objectUrl);
      setBusy(false);
    }
  }

  async function autoPlaceLocators() {
    if (!sourceFile || !sourceFileBase64) {
      setStatus('Load a GLB first.');
      return;
    }

    setBusy(true);
    try {
      const payload = await requestJson('/__editor/vehicle-auto-locate', {
        method: 'POST',
        body: JSON.stringify({
          filename: saveFilename(),
          glbBase64: sourceFileBase64
        })
      });

      await loadModelFromUrl(`${payload.url}?t=${Date.now()}`, payload.sourceLabel);
      setSavedModel({
        url: payload.url,
        sourceLabel: payload.sourceLabel
      });
      setValidation((current) => {
        if (!current) {
          return payload.report;
        }
        return {
          ...current,
          ...payload.report
        };
      });
      attachSelectedLocator();
      setStatus(
        payload.report?.addedLocators?.length
          ? `Auto-placed ${payload.report.addedLocators.length} locator${payload.report.addedLocators.length === 1 ? '' : 's'}`
          : 'Auto-locator completed'
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveValidatedModel() {
    if (!activeModelRoot) {
      setStatus('Load a GLB first.');
      return;
    }

    if (!saveFilename().trim()) {
      setStatus('Enter a filename before saving.');
      return;
    }

    setBusy(true);
    try {
      const glb = await exportSceneToGlb(activeModelRoot);
      const payload = await requestJson('/__editor/vehicle-models', {
        method: 'POST',
        body: JSON.stringify({
          filename: saveFilename(),
          glbBase64: arrayBufferToBase64(glb)
        })
      });

      const model = {
        url: payload.url,
        sourceLabel: payload.sourceLabel
      };

      setSavedModel(model);
      sourceFile = null;
      sourceFileBase64 = '';
      setStatus(`Saved ${payload.sourceLabel}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function approveModel() {
    if (!approved() || !savedModel()) {
      return;
    }

    props.onApprove(savedModel());
  }

  createEffect(() => {
    if (!props.open || !activeModelRoot) {
      return;
    }
    attachSelectedLocator(selectedLocatorName());
  });

  createEffect(() => {
    if (!props.open) {
      return;
    }

    if (!renderer && viewportRef) {
      let cancelled = false;

      const initializeViewport = async () => {
      scene = new THREE.Scene();
      scene.background = new THREE.Color('#d6dbde');

      camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
      camera.position.set(4.5, 2.2, 4.6);

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

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(18, 18),
        new THREE.MeshStandardMaterial({ color: '#c7cfca', roughness: 0.95, metalness: 0.02 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.02;
      scene.add(floor);

      previewRoot = new THREE.Group();
      scene.add(previewRoot);

      orbitControls = new OrbitControls(camera, renderer.domElement);
      orbitControls.enableDamping = true;
      orbitControls.target.set(0, 0.8, 0);

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
        orbitControls.update();
        renderer.render(scene, camera);
      };
      tick();

      if (pendingFile) {
        const file = pendingFile;
        pendingFile = null;
        void loadModelFromFile(file);
      }
      };

      void initializeViewport();

      onCleanup(() => {
        cancelled = true;
      });
    }
  });

  onCleanup(() => {
    cancelAnimationFrame(animationFrame);
    resizeObserver?.disconnect();
    transformControls?.dispose?.();
    if (transformHelper) {
      scene?.remove(transformHelper);
    }
    orbitControls?.dispose?.();
    renderer?.dispose?.();
  });

  return (
    <Show when={props.open}>
      <div class="modal-backdrop" onClick={props.onClose}>
        <div class="modal-shell validator-modal" onClick={(event) => event.stopPropagation()}>
          <div class="panel-header">
            <div>
              <p class="panel-label">Validation</p>
              <h2>Repair Vehicle GLB</h2>
            </div>
            <button type="button" class="ghost-button" onClick={props.onClose}>
              Close
            </button>
          </div>

          <div class="validator-layout">
            <div class="validator-sidebar">
              <label class="field">
                <span>Load Local GLB</span>
                <input
                  type="file"
                  accept=".glb"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) {
                      void loadModelFromFile(file);
                    }
                  }}
                />
              </label>

                <div class="asset-inline-actions">
                  <button type="button" class="ghost-button" onClick={autoPlaceLocators} disabled={busy()}>
                  Auto Repair with Blender
                  </button>
                </div>

              <div class="validator-status">
                <strong>{approved() ? 'Approved' : 'Needs Work'}</strong>
                <span>{status()}</span>
              </div>

              <section class="validator-section">
                <h3>Required Locators</h3>
                <div class="preview-footnote">
                  Selected: <code>{selectedLocatorName()}</code>
                </div>
                <div class="locator-list">
                  <For each={validation()?.requiredLocators || []}>
                    {(entry) => (
                      <button
                        type="button"
                        class={`locator-chip${entry.object ? ' is-valid' : ' is-missing'}${selectedLocatorName() === entry.name ? ' is-selected' : ''}`}
                        onClick={() => selectLocator(entry.name)}
                      >
                        {entry.name}
                      </button>
                    )}
                  </For>
                </div>
                <div class="asset-inline-actions locator-actions">
                  <button type="button" class="ghost-button" onClick={() => focusLocator(getSelectedLocator())} disabled={!getSelectedLocator()}>
                    Frame Locator
                  </button>
                  <button type="button" class="ghost-button" onClick={frameActiveModel} disabled={!activeModelRoot}>
                    Frame Model
                  </button>
                </div>
                <Show when={getSelectedLocator()}>
                  <div class="field-grid locator-fields">
                    <label class="field">
                      <span>X</span>
                      <input
                        type="number"
                        step="0.01"
                        value={getSelectedLocator()?.position.x ?? 0}
                        onInput={(event) => updateSelectedLocatorAxis('x', event.currentTarget.value)}
                      />
                    </label>
                    <label class="field">
                      <span>Y</span>
                      <input
                        type="number"
                        step="0.01"
                        value={getSelectedLocator()?.position.y ?? 0}
                        onInput={(event) => updateSelectedLocatorAxis('y', event.currentTarget.value)}
                      />
                    </label>
                    <label class="field">
                      <span>Z</span>
                      <input
                        type="number"
                        step="0.01"
                        value={getSelectedLocator()?.position.z ?? 0}
                        onInput={(event) => updateSelectedLocatorAxis('z', event.currentTarget.value)}
                      />
                    </label>
                    <label class="field">
                      <span>Nudge Step</span>
                      <input
                        type="number"
                        step="0.005"
                        min="0.001"
                        value={nudgeStep()}
                        onInput={(event) => setNudgeStep(Math.max(Number(event.currentTarget.value) || 0.001, 0.001))}
                      />
                    </label>
                  </div>
                  <div class="nudge-grid">
                    <button type="button" class="ghost-button" onClick={() => nudgeSelectedLocator('x', -1)}>
                      X-
                    </button>
                    <button type="button" class="ghost-button" onClick={() => nudgeSelectedLocator('x', 1)}>
                      X+
                    </button>
                    <button type="button" class="ghost-button" onClick={() => nudgeSelectedLocator('y', -1)}>
                      Y-
                    </button>
                    <button type="button" class="ghost-button" onClick={() => nudgeSelectedLocator('y', 1)}>
                      Y+
                    </button>
                    <button type="button" class="ghost-button" onClick={() => nudgeSelectedLocator('z', -1)}>
                      Z-
                    </button>
                    <button type="button" class="ghost-button" onClick={() => nudgeSelectedLocator('z', 1)}>
                      Z+
                    </button>
                  </div>
                </Show>
              </section>

              <section class="validator-section">
                <h3>Parts Scan</h3>
                <ul class="validator-list">
                  <li>Separate tires: {validation()?.minimumRequirements.separateTires ? `yes (${validation()?.minimumRequirements.tireCount})` : `no (${validation()?.minimumRequirements.tireCount || 0})`}</li>
                  <li>Windows: {validation()?.optionalParts.windows.count || 0} / 4</li>
                  <li>Interior: {validation()?.optionalParts.interior.present ? 'yes' : 'missing'}</li>
                  <li>Door: {validation()?.optionalParts.door.present ? 'yes' : 'missing'}</li>
                  <li>Steering wheel: {validation()?.optionalParts.steeringWheel.present ? 'yes' : 'missing'}</li>
                </ul>
              </section>

              <section class="validator-section">
                <h3>Save GLB</h3>
                <label class="field">
                  <span>Output Filename</span>
                  <input value={saveFilename()} onInput={(event) => setSaveFilename(event.currentTarget.value)} />
                </label>
                <div class="asset-inline-actions">
                  <button type="button" class="ghost-button" onClick={saveValidatedModel} disabled={busy()}>
                    Save New GLB
                  </button>
                  <button type="button" class="solid-button" onClick={approveModel} disabled={!approved() || !savedModel() || busy()}>
                    Use Saved Model
                  </button>
                </div>
                <Show when={savedModel()}>
                  <div class="preview-footnote">
                    Saved as <code>{savedModel()?.url}</code>
                  </div>
                </Show>
              </section>
            </div>

            <div class="validator-viewport" ref={viewportRef} />
          </div>
        </div>
      </div>
    </Show>
  );
}
