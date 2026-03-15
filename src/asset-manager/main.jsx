import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import './style.css';
import { VehicleValidationDialog } from './vehicle-validation-dialog.jsx';

const DEFAULT_PRESET = {
  exposure: 1.15,
  environmentIntensity: 1.2,
  tireScale: 0.93,
  frontAxleRatio: 0.18,
  rearAxleRatio: 0.245,
  rideHeight: 0.105,
  chassisHeight: 0.11,
  sideInset: 0.07,
  tireRotation: [0, Math.PI, 0]
};

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function createBlankVehicle() {
  return {
    id: '',
    order: 999,
    label: '',
    kind: 'car',
    body: {
      url: '',
      sourceLabel: ''
    },
    tires: null,
    preset: cloneValue(DEFAULT_PRESET)
  };
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

function updateDraftValue(draft, path, value) {
  const next = cloneValue(draft);
  let cursor = next;

  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    if (cursor[key] == null) {
      cursor[key] = typeof path[index + 1] === 'number' ? [] : {};
    }
    cursor = cursor[key];
  }

  cursor[path[path.length - 1]] = value;
  return next;
}

function app() {
  const [vehicles, setVehicles] = createSignal([]);
  const [selectedId, setSelectedId] = createSignal('');
  const [draft, setDraft] = createSignal(createBlankVehicle());
  const [previousId, setPreviousId] = createSignal('');
  const [status, setStatus] = createSignal('Loading vehicle manifests...');
  const [busy, setBusy] = createSignal(false);
  const [registryPath, setRegistryPath] = createSignal('public/data/vehicle-registry.json');
  const [validatorOpen, setValidatorOpen] = createSignal(false);

  const selectedVehicle = createMemo(() => {
    return vehicles().find((vehicle) => vehicle.id === selectedId()) || null;
  });

  const jsonPreview = createMemo(() => JSON.stringify(draft(), null, 2));

  async function loadVehicles(selectedVehicleId = selectedId()) {
    setBusy(true);
    try {
      const payload = await requestJson('/__editor/vehicles');
      setVehicles(payload.vehicles || []);
      setRegistryPath(payload.registryPath || registryPath());

      const fallbackId = payload.vehicles?.[0]?.id || '';
      const nextSelectedId = selectedVehicleId && payload.vehicles.some((vehicle) => vehicle.id === selectedVehicleId)
        ? selectedVehicleId
        : fallbackId;

      setSelectedId(nextSelectedId);

      const nextVehicle = payload.vehicles.find((vehicle) => vehicle.id === nextSelectedId) || createBlankVehicle();
      setDraft(cloneValue(nextVehicle));
      setPreviousId(nextVehicle.id || '');
      setStatus(`Loaded ${payload.vehicles.length} vehicle manifests`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function selectVehicle(vehicle) {
    setSelectedId(vehicle.id);
    setDraft(cloneValue(vehicle));
    setPreviousId(vehicle.id);
    setStatus(`Editing ${vehicle.label}`);
  }

  function updateField(path, rawValue, options = {}) {
    const value = options.numeric ? Number(rawValue) : rawValue;
    setDraft((current) => updateDraftValue(current, path, value));
  }

  function toggleTireSet(enabled) {
    setDraft((current) => {
      const next = cloneValue(current);
      next.tires = enabled
        ? {
            front: { url: '', sourceLabel: '' },
            rear: { url: '', sourceLabel: '' }
          }
        : null;
      return next;
    });
  }

  function createVehicle() {
    setSelectedId('');
    setPreviousId('');
    setDraft(createBlankVehicle());
    setStatus('Creating new vehicle manifest');
  }

  function applyValidatedModel(model) {
    setDraft((current) => {
      const next = cloneValue(current);
      next.body = {
        url: model.url,
        sourceLabel: model.sourceLabel
      };
      return next;
    });
    setValidatorOpen(false);
    setStatus(`Selected validated model ${model.sourceLabel}`);
  }

  async function saveVehicle() {
    setBusy(true);
    try {
      const payload = await requestJson('/__editor/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          action: 'save',
          previousId: previousId(),
          manifest: draft()
        })
      });

      setVehicles(payload.vehicles || []);
      setRegistryPath(payload.registryPath || registryPath());
      setSelectedId(payload.vehicle.id);
      setPreviousId(payload.vehicle.id);
      setDraft(cloneValue(payload.vehicle));
      setStatus(`Saved ${payload.vehicle.label}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteVehicle() {
    const current = draft();
    if (!current.id) {
      setStatus('Save the vehicle before deleting it.');
      return;
    }

    setBusy(true);
    try {
      const payload = await requestJson('/__editor/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          action: 'delete',
          id: current.id
        })
      });

      setVehicles(payload.vehicles || []);
      const nextVehicle = payload.vehicles?.[0] || createBlankVehicle();
      setSelectedId(nextVehicle.id || '');
      setPreviousId(nextVehicle.id || '');
      setDraft(cloneValue(nextVehicle));
      setStatus(`Deleted ${current.label || current.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function rebuildRegistry() {
    setBusy(true);
    try {
      const payload = await requestJson('/__editor/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          action: 'rebuild'
        })
      });
      setVehicles(payload.vehicles || []);
      setStatus(`Rebuilt vehicle registry at ${payload.registryPath || registryPath()}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  onMount(() => {
    loadVehicles();
  });

  return (
    <div class="asset-manager-shell">
      <header class="asset-header">
        <div>
          <p class="asset-kicker">Cruise Pipeline</p>
          <h1>Vehicle Asset Manager</h1>
          <p class="asset-subtitle">
            Edit manifest source files, then rebuild the browser registry used by the game and future tools.
          </p>
        </div>
        <div class="asset-actions">
          <button type="button" class="ghost-button" onClick={() => window.location.assign('/')}>
            Open Garage
          </button>
          <button type="button" class="ghost-button" onClick={() => loadVehicles()} disabled={busy()}>
            Refresh
          </button>
          <button type="button" class="ghost-button" onClick={rebuildRegistry} disabled={busy()}>
            Rebuild Registry
          </button>
          <button type="button" class="solid-button" onClick={saveVehicle} disabled={busy()}>
            Save Manifest
          </button>
        </div>
      </header>

      <div class="asset-status-bar">
        <span>{status()}</span>
        <span>{registryPath()}</span>
      </div>

      <main class="asset-grid">
        <aside class="asset-sidebar panel">
          <div class="panel-header">
            <div>
              <p class="panel-label">Vehicles</p>
              <h2>{vehicles().length} manifests</h2>
            </div>
            <button type="button" class="ghost-button" onClick={createVehicle} disabled={busy()}>
              New
            </button>
          </div>

          <div class="vehicle-list">
            <For each={vehicles()}>
              {(vehicle) => (
                <button
                  type="button"
                  class={`vehicle-list-item${selectedId() === vehicle.id ? ' is-active' : ''}`}
                  onClick={() => selectVehicle(vehicle)}
                >
                  <span class="vehicle-title">{vehicle.label}</span>
                  <span class="vehicle-meta">{vehicle.id}</span>
                </button>
              )}
            </For>
          </div>
        </aside>

        <section class="panel asset-form-panel">
          <div class="panel-header">
            <div>
              <p class="panel-label">Manifest</p>
              <h2>{draft().label || 'New vehicle'}</h2>
            </div>
            <div class="asset-inline-actions">
              <button type="button" class="ghost-button" onClick={createVehicle} disabled={busy()}>
                Reset
              </button>
              <button type="button" class="danger-button" onClick={deleteVehicle} disabled={busy() || !draft().id}>
                Delete
              </button>
            </div>
          </div>

          <div class="field-grid">
            <label class="field">
              <span>ID</span>
              <input value={draft().id} onInput={(event) => updateField(['id'], event.currentTarget.value)} />
            </label>
            <label class="field">
              <span>Label</span>
              <input value={draft().label} onInput={(event) => updateField(['label'], event.currentTarget.value)} />
            </label>
            <label class="field">
              <span>Order</span>
              <input
                type="number"
                value={draft().order ?? 999}
                onInput={(event) => updateField(['order'], event.currentTarget.value, { numeric: true })}
              />
            </label>
            <label class="field">
              <span>Kind</span>
              <input value={draft().kind} onInput={(event) => updateField(['kind'], event.currentTarget.value)} />
            </label>
          </div>

          <section class="subpanel">
            <div class="subpanel-header">
              <h3>Body Asset</h3>
            </div>
            <div class="field-grid">
              <label class="field field-wide">
                <span>Body URL</span>
                <input
                  value={draft().body?.url || ''}
                  onInput={(event) => updateField(['body', 'url'], event.currentTarget.value)}
                />
              </label>
              <label class="field field-wide">
                <span>Body Source Label</span>
                <input
                  value={draft().body?.sourceLabel || ''}
                  onInput={(event) => updateField(['body', 'sourceLabel'], event.currentTarget.value)}
                />
              </label>
            </div>
            <div class="asset-inline-actions">
              <button type="button" class="ghost-button" onClick={() => setValidatorOpen(true)}>
                Validate / Repair GLB
              </button>
            </div>
          </section>

          <section class="subpanel">
            <div class="subpanel-header">
              <h3>Tires</h3>
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={Boolean(draft().tires)}
                  onChange={(event) => toggleTireSet(event.currentTarget.checked)}
                />
                <span>Custom front/rear tires</span>
              </label>
            </div>
            <Show when={draft().tires}>
              <div class="field-grid">
                <label class="field field-wide">
                  <span>Front Tire URL</span>
                  <input
                    value={draft().tires?.front?.url || ''}
                    onInput={(event) => updateField(['tires', 'front', 'url'], event.currentTarget.value)}
                  />
                </label>
                <label class="field field-wide">
                  <span>Front Tire Source Label</span>
                  <input
                    value={draft().tires?.front?.sourceLabel || ''}
                    onInput={(event) => updateField(['tires', 'front', 'sourceLabel'], event.currentTarget.value)}
                  />
                </label>
                <label class="field field-wide">
                  <span>Rear Tire URL</span>
                  <input
                    value={draft().tires?.rear?.url || ''}
                    onInput={(event) => updateField(['tires', 'rear', 'url'], event.currentTarget.value)}
                  />
                </label>
                <label class="field field-wide">
                  <span>Rear Tire Source Label</span>
                  <input
                    value={draft().tires?.rear?.sourceLabel || ''}
                    onInput={(event) => updateField(['tires', 'rear', 'sourceLabel'], event.currentTarget.value)}
                  />
                </label>
              </div>
            </Show>
          </section>

          <section class="subpanel">
            <div class="subpanel-header">
              <h3>Preset</h3>
            </div>
            <div class="field-grid">
              <label class="field"><span>Exposure</span><input type="number" step="0.01" value={draft().preset?.exposure ?? 0} onInput={(event) => updateField(['preset', 'exposure'], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Env Intensity</span><input type="number" step="0.01" value={draft().preset?.environmentIntensity ?? 0} onInput={(event) => updateField(['preset', 'environmentIntensity'], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Tire Scale</span><input type="number" step="0.01" value={draft().preset?.tireScale ?? 0} onInput={(event) => updateField(['preset', 'tireScale'], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Front Axle</span><input type="number" step="0.001" value={draft().preset?.frontAxleRatio ?? 0} onInput={(event) => updateField(['preset', 'frontAxleRatio'], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Rear Axle</span><input type="number" step="0.001" value={draft().preset?.rearAxleRatio ?? 0} onInput={(event) => updateField(['preset', 'rearAxleRatio'], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Ride Height</span><input type="number" step="0.001" value={draft().preset?.rideHeight ?? 0} onInput={(event) => updateField(['preset', 'rideHeight'], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Chassis Height</span><input type="number" step="0.001" value={draft().preset?.chassisHeight ?? 0} onInput={(event) => updateField(['preset', 'chassisHeight'], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Side Inset</span><input type="number" step="0.001" value={draft().preset?.sideInset ?? 0} onInput={(event) => updateField(['preset', 'sideInset'], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Rot X</span><input type="number" step="0.01" value={draft().preset?.tireRotation?.[0] ?? 0} onInput={(event) => updateField(['preset', 'tireRotation', 0], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Rot Y</span><input type="number" step="0.01" value={draft().preset?.tireRotation?.[1] ?? 0} onInput={(event) => updateField(['preset', 'tireRotation', 1], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Rot Z</span><input type="number" step="0.01" value={draft().preset?.tireRotation?.[2] ?? 0} onInput={(event) => updateField(['preset', 'tireRotation', 2], event.currentTarget.value, { numeric: true })} /></label>
            </div>
          </section>
        </section>

        <aside class="panel asset-preview-panel">
          <div class="panel-header">
            <div>
              <p class="panel-label">Preview</p>
              <h2>Manifest JSON</h2>
            </div>
          </div>
          <pre class="json-preview">{jsonPreview()}</pre>
          <Show when={selectedVehicle()}>
            <div class="preview-footnote">
              Runtime asset: <code>{selectedVehicle()?.body?.url}</code>
            </div>
          </Show>
        </aside>
      </main>

      <VehicleValidationDialog
        open={validatorOpen()}
        onClose={() => setValidatorOpen(false)}
        onApprove={applyValidatedModel}
      />
    </div>
  );
}

render(() => app(), document.getElementById('asset-manager-app'));
