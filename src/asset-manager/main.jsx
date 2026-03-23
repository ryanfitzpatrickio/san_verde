import { For, Match, Show, Switch, createMemo, createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import './style.css';
import { VehicleValidationDialog } from './vehicle-validation-dialog.jsx';
import { TireValidationDialog } from './tire-validation-dialog.jsx';
import { VehiclePreviewDialog } from './vehicle-preview-dialog.jsx';
import { CarBuilder } from './car-builder.jsx';
import { WeaponTab } from './weapon-tab.jsx';

const DEFAULT_PRESET = {
  exposure: 1.15,
  environmentIntensity: 1.2,
  tireScale: 0.93,
  parkedWheelOffsetY: 0,
  frontAxleRatio: 0.18,
  rearAxleRatio: 0.245,
  rideHeight: 0.105,
  chassisHeight: 0.11,
  bodyVisualOffsetY: 0,
  sideInset: 0.07,
  tireRotation: [0, Math.PI, 0],
  leftSideTireRotation: [0, 0, 0],
  leftSideTireMirror: false,
  rightSideTireRotation: [Math.PI, 0, 0],
  rightSideTireMirror: false
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

function createBlankTire() {
  return {
    id: '',
    label: '',
    url: '',
    sourceLabel: '',
    notes: ''
  };
}

function createBlankWeapon() {
  return {
    id: '',
    label: '',
    asset: {
      url: '',
      sourceLabel: ''
    },
    proceduralModel: null,
    grip: {
      offset: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1
    },
    sockets: {
      muzzle: [0, 0, 0.6],
      offHand: [0, -0.04, 0.28],
      casingEject: [0.04, 0.03, 0.02],
      aim: [0, 0.04, 0.18]
    },
    combat: {
      fireCooldownSeconds: 0.12
    },
    locomotionSet: {
      idle: 'idle',
      walk: 'walk',
      run: 'run',
      walkBackward: 'walk',
      runBackward: 'run',
      strafeLeft: 'walk',
      strafeRight: 'walk'
    },
    notes: ''
  };
}

function createIdFromFilename(filename) {
  return String(filename || '')
    .replace(/\.glb$/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function createLabelFromId(id) {
  return String(id || '')
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
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
  let tireImportInputRef;
  let weaponImportInputRef;
  const [vehicles, setVehicles] = createSignal([]);
  const [tireLibrary, setTireLibrary] = createSignal([]);
  const [weaponLibrary, setWeaponLibrary] = createSignal([]);
  const [selectedId, setSelectedId] = createSignal('');
  const [activeTab, setActiveTab] = createSignal('vehicles');
  const [selectedTireId, setSelectedTireId] = createSignal('');
  const [selectedWeaponId, setSelectedWeaponId] = createSignal('');
  const [draft, setDraft] = createSignal(createBlankVehicle());
  const [tireDraft, setTireDraft] = createSignal(createBlankTire());
  const [weaponDraft, setWeaponDraft] = createSignal(createBlankWeapon());
  const [previousId, setPreviousId] = createSignal('');
  const [previousTireId, setPreviousTireId] = createSignal('');
  const [previousWeaponId, setPreviousWeaponId] = createSignal('');
  const [status, setStatus] = createSignal('Loading vehicle manifests...');
  const [busy, setBusy] = createSignal(false);
  const [registryPath, setRegistryPath] = createSignal('public/data/vehicle-registry.json');
  const [tireLibraryPath, setTireLibraryPath] = createSignal('public/data/tire-library.json');
  const [weaponLibraryPath, setWeaponLibraryPath] = createSignal('public/data/weapon-library.json');
  const [validatorOpen, setValidatorOpen] = createSignal(false);
  const [tirePreviewConfig, setTirePreviewConfig] = createSignal(null);
  const [vehiclePreviewOpen, setVehiclePreviewOpen] = createSignal(false);
  const [builderOpen, setBuilderOpen] = createSignal(false);

  const selectedVehicle = createMemo(() => {
    return vehicles().find((vehicle) => vehicle.id === selectedId()) || null;
  });

  const tireRecords = createMemo(() => {
    const usageMap = new Map();

    for (const tire of tireLibrary()) {
      usageMap.set(tire.id, {
        ...cloneValue(tire),
        usages: [],
        vehicleCount: 0,
        frontCount: 0,
        rearCount: 0
      });
    }

    for (const vehicle of vehicles()) {
      if (!vehicle?.tires) {
        continue;
      }

      for (const position of ['front', 'rear']) {
        const asset = vehicle.tires[position];
        if (!asset?.url) {
          continue;
        }
        const matchingTire = tireLibrary().find((entry) => entry.url === asset.url);
        if (!matchingTire) {
          continue;
        }
        const record = usageMap.get(matchingTire.id);
        record.usages.push({
          vehicleId: vehicle.id,
          vehicleLabel: vehicle.label,
          position,
          preset: cloneValue(vehicle.preset || {})
        });
        if (position === 'front') {
          record.frontCount += 1;
        } else {
          record.rearCount += 1;
        }
      }
    }

    return [...usageMap.values()]
      .map((record) => ({
        ...record,
        vehicleCount: new Set(record.usages.map((usage) => usage.vehicleId)).size,
        usages: record.usages.sort((left, right) => {
          if (left.vehicleLabel !== right.vehicleLabel) {
            return String(left.vehicleLabel).localeCompare(String(right.vehicleLabel));
          }
          return String(left.position).localeCompare(String(right.position));
        })
      }))
      .sort((left, right) => String(left.label || left.id).localeCompare(String(right.label || right.id)));
  });

  const selectedTireRecord = createMemo(() => {
    return tireRecords().find((record) => record.id === selectedTireId()) || tireRecords()[0] || null;
  });

  const jsonPreview = createMemo(() => JSON.stringify(draft(), null, 2));
  const tireJsonPreview = createMemo(() => JSON.stringify(tireDraft(), null, 2));
  const weaponJsonPreview = createMemo(() => JSON.stringify(weaponDraft(), null, 2));
  const weaponPresentationMode = createMemo(() => {
    return weaponDraft().proceduralModel ? 'procedural' : 'asset';
  });

  async function loadAssets(
    selectedVehicleId = selectedId(),
    selectedLibraryTireId = selectedTireId(),
    selectedLibraryWeaponId = selectedWeaponId()
  ) {
    setBusy(true);
    try {
      const [vehiclePayload, tirePayload, weaponPayload] = await Promise.all([
        requestJson('/__editor/vehicles'),
        requestJson('/__editor/tires'),
        requestJson('/__editor/weapons')
      ]);
      setVehicles(vehiclePayload.vehicles || []);
      setTireLibrary(tirePayload.tires || []);
      setWeaponLibrary(weaponPayload.weapons || []);
      setRegistryPath(vehiclePayload.registryPath || registryPath());
      setTireLibraryPath(tirePayload.libraryPath || tireLibraryPath());
      setWeaponLibraryPath(weaponPayload.libraryPath || weaponLibraryPath());

      const fallbackId = vehiclePayload.vehicles?.[0]?.id || '';
      const nextSelectedId = selectedVehicleId && vehiclePayload.vehicles.some((vehicle) => vehicle.id === selectedVehicleId)
        ? selectedVehicleId
        : fallbackId;

      setSelectedId(nextSelectedId);

      const nextVehicle = vehiclePayload.vehicles.find((vehicle) => vehicle.id === nextSelectedId) || createBlankVehicle();
      setDraft(cloneValue(nextVehicle));
      setPreviousId(nextVehicle.id || '');
      const fallbackTireId = tirePayload.tires?.[0]?.id || '';
      const nextSelectedTireId = selectedLibraryTireId && tirePayload.tires.some((tire) => tire.id === selectedLibraryTireId)
        ? selectedLibraryTireId
        : fallbackTireId;
      setSelectedTireId(nextSelectedTireId);
      const nextTire = tirePayload.tires.find((tire) => tire.id === nextSelectedTireId) || createBlankTire();
      setTireDraft(cloneValue(nextTire));
      setPreviousTireId(nextTire.id || '');
      const fallbackWeaponId = weaponPayload.weapons?.[0]?.id || '';
      const nextSelectedWeaponId = selectedLibraryWeaponId && weaponPayload.weapons.some((weapon) => weapon.id === selectedLibraryWeaponId)
        ? selectedLibraryWeaponId
        : fallbackWeaponId;
      setSelectedWeaponId(nextSelectedWeaponId);
      const nextWeapon = weaponPayload.weapons.find((weapon) => weapon.id === nextSelectedWeaponId) || createBlankWeapon();
      setWeaponDraft(cloneValue(nextWeapon));
      setPreviousWeaponId(nextWeapon.id || '');
      setStatus(
        `Loaded ${vehiclePayload.vehicles.length} vehicle manifests, ${tirePayload.tires.length} tire records, and ${weaponPayload.weapons.length} weapon records`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function selectVehicle(vehicle) {
    setActiveTab('vehicles');
    setSelectedId(vehicle.id);
    setDraft(cloneValue(vehicle));
    setPreviousId(vehicle.id);
    setStatus(`Editing ${vehicle.label}`);
  }

  function selectTire(record) {
    setActiveTab('tires');
    setSelectedTireId(record.id);
    setTireDraft(cloneValue(record));
    setPreviousTireId(record.id);
    setStatus(`Editing tire ${record.label}`);
  }

  function selectWeapon(record) {
    setActiveTab('weapons');
    setSelectedWeaponId(record.id);
    setWeaponDraft(cloneValue(record));
    setPreviousWeaponId(record.id);
    setStatus(`Editing weapon ${record.label}`);
  }

  function editVehicleFromTireUsage(usage) {
    const vehicle = vehicles().find((entry) => entry.id === usage.vehicleId);
    if (!vehicle) {
      return;
    }
    selectVehicle(vehicle);
    setStatus(`Editing ${vehicle.label} for ${usage.position} tire setup`);
  }

  function openTirePreview(config) {
    setTirePreviewConfig(config);
  }

  function closeTirePreview() {
    setTirePreviewConfig(null);
  }

  function previewStandaloneTire() {
    const current = tireDraft();
    if (!current.url) {
      setStatus('Import or enter a tire URL first.');
      return;
    }

    openTirePreview({
      title: `${current.label || current.id || 'Tire'} preview`,
      tireUrl: current.url,
      tireLabel: current.sourceLabel || current.url,
      initialPreset: cloneValue(DEFAULT_PRESET),
      onApply: () => {
        setStatus('Tire preview updated. Orientation settings are applied per vehicle manifest, not stored on the tire record.');
        closeTirePreview();
      }
    });
  }

  function applyTirePreviewToCurrentDraft(presetPatch) {
    setDraft((current) => updateDraftValue(
      updateDraftValue(
        updateDraftValue(
          updateDraftValue(current, ['preset', 'tireRotation'], cloneValue(presetPatch.tireRotation)),
          ['preset', 'rightSideTireRotation'],
          cloneValue(presetPatch.rightSideTireRotation)
        ),
        ['preset', 'rightSideTireMirror'],
        Boolean(presetPatch.rightSideTireMirror)
      ),
      ['preset', 'tireScale'],
      Number(presetPatch.tireScale)
    ));
    setStatus('Applied tire preview settings to current vehicle. Save manifest to persist.');
    closeTirePreview();
  }

  function applyVehiclePreviewToCurrentDraft(presetPatch) {
    setDraft((current) => updateDraftValue(
      current,
      ['preset', 'bodyVisualOffsetY'],
      Number(presetPatch.bodyVisualOffsetY)
    ));
    setStatus('Applied vehicle preview offset to current vehicle. Save manifest to persist.');
  }

  function applyTirePreviewToVehicle(vehicleId, presetPatch) {
    const vehicle = vehicles().find((entry) => entry.id === vehicleId);
    if (!vehicle) {
      return;
    }
    const nextVehicle = cloneValue(vehicle);
    nextVehicle.preset = nextVehicle.preset || cloneValue(DEFAULT_PRESET);
    nextVehicle.preset.tireRotation = cloneValue(presetPatch.tireRotation);
    nextVehicle.preset.rightSideTireRotation = cloneValue(presetPatch.rightSideTireRotation);
    nextVehicle.preset.rightSideTireMirror = Boolean(presetPatch.rightSideTireMirror);
    nextVehicle.preset.tireScale = Number(presetPatch.tireScale);
    selectVehicle(nextVehicle);
    setStatus(`Applied tire preview settings to ${nextVehicle.label}. Save manifest to persist.`);
    closeTirePreview();
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

  function createTire() {
    setActiveTab('tires');
    setSelectedTireId('');
    setPreviousTireId('');
    setTireDraft(createBlankTire());
    setStatus('Creating new tire library record');
  }

  function createWeapon() {
    setActiveTab('weapons');
    setSelectedWeaponId('');
    setPreviousWeaponId('');
    setWeaponDraft(createBlankWeapon());
    setStatus('Creating new weapon library record');
  }

  async function importTireFile(file) {
    if (!file) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/__editor/tire-models?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: await file.arrayBuffer()
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || payload.error || 'Request failed');
      }

      const inferredId = createIdFromFilename(file.name);
      setActiveTab('tires');
      setSelectedTireId('');
      setPreviousTireId('');
      setTireDraft((current) => ({
        ...createBlankTire(),
        ...current,
        id: current.id || inferredId,
        label: current.label || createLabelFromId(inferredId),
        url: payload.url,
        sourceLabel: payload.sourceLabel
      }));
      setStatus(`Imported tire GLB ${payload.sourceLabel}. Save Tire to add it to the library.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (tireImportInputRef) {
        tireImportInputRef.value = '';
      }
      setBusy(false);
    }
  }

  async function importWeaponFile(file) {
    if (!file) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/__editor/weapon-models?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: await file.arrayBuffer()
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || payload.error || 'Request failed');
      }

      const inferredId = createIdFromFilename(file.name);
      setActiveTab('weapons');
      setSelectedWeaponId('');
      setPreviousWeaponId('');
      setWeaponDraft((current) => ({
        ...createBlankWeapon(),
        ...current,
        id: current.id || inferredId,
        label: current.label || createLabelFromId(inferredId),
        asset: {
          url: payload.url,
          sourceLabel: payload.sourceLabel
        },
        proceduralModel: null
      }));
      setStatus(`Imported weapon GLB ${payload.sourceLabel}. Save Weapon to add it to the library.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (weaponImportInputRef) {
        weaponImportInputRef.value = '';
      }
      setBusy(false);
    }
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

  async function saveTire() {
    setBusy(true);
    try {
      const payload = await requestJson('/__editor/tires', {
        method: 'POST',
        body: JSON.stringify({
          action: 'save',
          previousId: previousTireId(),
          record: tireDraft()
        })
      });

      setTireLibrary(payload.tires || []);
      setTireLibraryPath(payload.libraryPath || tireLibraryPath());
      setSelectedTireId(payload.tire.id);
      setPreviousTireId(payload.tire.id);
      setTireDraft(cloneValue(payload.tire));
      setStatus(`Saved tire ${payload.tire.label}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveWeapon() {
    setBusy(true);
    try {
      const payload = await requestJson('/__editor/weapons', {
        method: 'POST',
        body: JSON.stringify({
          action: 'save',
          previousId: previousWeaponId(),
          record: weaponDraft()
        })
      });

      setWeaponLibrary(payload.weapons || []);
      setWeaponLibraryPath(payload.libraryPath || weaponLibraryPath());
      setSelectedWeaponId(payload.weapon.id);
      setPreviousWeaponId(payload.weapon.id);
      setWeaponDraft(cloneValue(payload.weapon));
      setStatus(`Saved weapon ${payload.weapon.label}`);
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

  async function deleteTire() {
    const current = tireDraft();
    if (!current.id) {
      setStatus('Save the tire before deleting it.');
      return;
    }

    setBusy(true);
    try {
      const payload = await requestJson('/__editor/tires', {
        method: 'POST',
        body: JSON.stringify({
          action: 'delete',
          id: current.id
        })
      });
      setTireLibrary(payload.tires || []);
      const nextTire = payload.tires?.[0] || createBlankTire();
      setSelectedTireId(nextTire.id || '');
      setPreviousTireId(nextTire.id || '');
      setTireDraft(cloneValue(nextTire));
      setStatus(`Deleted tire ${current.label || current.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteWeapon() {
    const current = weaponDraft();
    if (!current.id) {
      setStatus('Save the weapon before deleting it.');
      return;
    }

    setBusy(true);
    try {
      const payload = await requestJson('/__editor/weapons', {
        method: 'POST',
        body: JSON.stringify({
          action: 'delete',
          id: current.id
        })
      });
      setWeaponLibrary(payload.weapons || []);
      const nextWeapon = payload.weapons?.[0] || createBlankWeapon();
      setSelectedWeaponId(nextWeapon.id || '');
      setPreviousWeaponId(nextWeapon.id || '');
      setWeaponDraft(cloneValue(nextWeapon));
      setStatus(`Deleted weapon ${current.label || current.id}`);
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

  async function rebuildTireLibraryRecords() {
    setBusy(true);
    try {
      const payload = await requestJson('/__editor/tires', {
        method: 'POST',
        body: JSON.stringify({
          action: 'rebuild'
        })
      });
      setTireLibrary(payload.tires || []);
      setTireLibraryPath(payload.libraryPath || tireLibraryPath());
      setStatus(`Rebuilt tire library at ${payload.libraryPath || tireLibraryPath()}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function rebuildWeaponLibraryRecords() {
    setBusy(true);
    try {
      const payload = await requestJson('/__editor/weapons', {
        method: 'POST',
        body: JSON.stringify({
          action: 'rebuild'
        })
      });
      setWeaponLibrary(payload.weapons || []);
      setWeaponLibraryPath(payload.libraryPath || weaponLibraryPath());
      setStatus(`Rebuilt weapon library at ${payload.libraryPath || weaponLibraryPath()}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  onMount(() => {
    loadAssets();
  });

  function updateTireField(path, rawValue) {
    setTireDraft((current) => updateDraftValue(current, path, rawValue));
  }

  function updateWeaponField(path, rawValue, options = {}) {
    const value = options.numeric ? Number(rawValue) : rawValue;
    setWeaponDraft((current) => updateDraftValue(current, path, value));
  }

  function setWeaponPresentationMode(mode) {
    setWeaponDraft((current) => {
      const next = cloneValue(current);
      if (mode === 'procedural') {
        next.asset = null;
        next.proceduralModel = next.proceduralModel || 'shotgun';
      } else {
        next.asset = next.asset || { url: '', sourceLabel: '' };
        next.proceduralModel = null;
      }
      return next;
    });
  }

  function openWeaponImportDialog() {
    weaponImportInputRef?.click();
  }

  function findLibraryTireByUrl(url) {
    return tireLibrary().find((entry) => entry.url === url) || null;
  }

  function assignLibraryTire(position, tireId) {
    const tire = tireLibrary().find((entry) => entry.id === tireId) || null;
    setDraft((current) => {
      const next = cloneValue(current);
      if (!tire) {
        if (next.tires?.[position]) {
          next.tires[position] = { url: '', sourceLabel: '' };
        }
        return next;
      }
      next.tires = next.tires || {
        front: { url: '', sourceLabel: '' },
        rear: { url: '', sourceLabel: '' }
      };
      next.tires[position] = {
        url: tire.url,
        sourceLabel: tire.sourceLabel
      };
      return next;
    });
  }

  function saveActiveTab() {
    if (activeTab() === 'vehicles') {
      void saveVehicle();
      return;
    }
    if (activeTab() === 'tires') {
      void saveTire();
      return;
    }
    void saveWeapon();
  }

  function rebuildActiveTab() {
    if (activeTab() === 'vehicles') {
      void rebuildRegistry();
      return;
    }
    if (activeTab() === 'tires') {
      void rebuildTireLibraryRecords();
      return;
    }
    void rebuildWeaponLibraryRecords();
  }

  function getActiveAssetPath() {
    if (activeTab() === 'vehicles') {
      return registryPath();
    }
    if (activeTab() === 'tires') {
      return tireLibraryPath();
    }
    return weaponLibraryPath();
  }

  function getActiveSaveLabel() {
    if (activeTab() === 'vehicles') {
      return 'Save Manifest';
    }
    if (activeTab() === 'tires') {
      return 'Save Tire';
    }
    return 'Save Weapon';
  }

  function getActiveRebuildLabel() {
    return activeTab() === 'vehicles' ? 'Rebuild Registry' : 'Rebuild Library';
  }

  return (
    <Show when={!builderOpen()} fallback={<CarBuilder onClose={() => setBuilderOpen(false)} />}>
    <div class="asset-manager-shell">
      <header class="asset-header">
        <div>
          <p class="asset-kicker">Cruise Pipeline</p>
          <h1>Asset Manager</h1>
          <p class="asset-subtitle">
            Edit vehicle, tire, and weapon source records, then rebuild the browser data used by the game and tools.
          </p>
        </div>
        <div class="asset-actions">
          <button type="button" class="ghost-button" onClick={() => setBuilderOpen(true)}>
            Car Builder
          </button>
          <button type="button" class="ghost-button" onClick={() => window.location.assign('/')}>
            Open Garage
          </button>
          <button type="button" class="ghost-button" onClick={() => loadAssets()} disabled={busy()}>
            Refresh
          </button>
          <button type="button" class="ghost-button" onClick={rebuildActiveTab} disabled={busy()}>
            {getActiveRebuildLabel()}
          </button>
          <button type="button" class="solid-button" onClick={saveActiveTab} disabled={busy()}>
            {getActiveSaveLabel()}
          </button>
        </div>
      </header>

      <div class="asset-status-bar">
        <span>{status()}</span>
        <span>{getActiveAssetPath()}</span>
      </div>

      <div class="asset-tabs">
        <button
          type="button"
          class={`asset-tab${activeTab() === 'vehicles' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('vehicles')}
        >
          Vehicles
        </button>
        <button
          type="button"
          class={`asset-tab${activeTab() === 'tires' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('tires')}
        >
          Tires
        </button>
        <button
          type="button"
          class={`asset-tab${activeTab() === 'weapons' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('weapons')}
        >
          Weapons
        </button>
      </div>

      <Switch>
        <Match when={activeTab() === 'tires'}>
          <main class="asset-grid">
            <aside class="asset-sidebar panel">
              <div class="panel-header">
                <div>
                  <p class="panel-label">Tires</p>
                  <h2>{tireRecords().length} configured</h2>
                </div>
                <button type="button" class="ghost-button" onClick={createTire} disabled={busy()}>
                  New
                </button>
              </div>

              <div class="vehicle-list">
                <For each={tireRecords()}>
                  {(record) => (
                    <button
                      type="button"
                      class={`vehicle-list-item${selectedTireId() === record.id ? ' is-active' : ''}`}
                      onClick={() => selectTire(record)}
                    >
                      <span class="vehicle-title">{record.label}</span>
                      <span class="vehicle-meta">{record.id}</span>
                      <span class="vehicle-meta">{record.vehicleCount} vehicles · F {record.frontCount} · R {record.rearCount}</span>
                    </button>
                  )}
                </For>
              </div>
            </aside>

            <section class="panel asset-form-panel">
              <div class="panel-header">
                <div>
                  <p class="panel-label">Tire Record</p>
                  <h2>{tireDraft().label || 'New tire'}</h2>
                </div>
                <div class="asset-inline-actions">
                  <button type="button" class="ghost-button" onClick={createTire} disabled={busy()}>
                    Reset
                  </button>
                  <button type="button" class="danger-button" onClick={deleteTire} disabled={busy() || !tireDraft().id}>
                    Delete
                  </button>
                </div>
              </div>

              <section class="subpanel">
                <div class="subpanel-header">
                  <h3>Record</h3>
                  <div class="asset-inline-actions">
                    <button type="button" class="ghost-button" onClick={() => tireImportInputRef?.click()} disabled={busy()}>
                      Import GLB
                    </button>
                  </div>
                </div>
                <input
                  ref={(element) => {
                    tireImportInputRef = element;
                  }}
                  class="hidden-file-input"
                  type="file"
                  accept=".glb"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) {
                      void importTireFile(file);
                    }
                  }}
                />
                <div class="field-grid">
                  <label class="field">
                    <span>ID</span>
                    <input value={tireDraft().id} onInput={(event) => updateTireField(['id'], event.currentTarget.value)} />
                  </label>
                  <label class="field">
                    <span>Label</span>
                    <input value={tireDraft().label} onInput={(event) => updateTireField(['label'], event.currentTarget.value)} />
                  </label>
                  <label class="field field-wide">
                    <span>URL</span>
                    <input value={tireDraft().url} onInput={(event) => updateTireField(['url'], event.currentTarget.value)} />
                  </label>
                  <label class="field field-wide">
                    <span>Source Label</span>
                    <input value={tireDraft().sourceLabel} onInput={(event) => updateTireField(['sourceLabel'], event.currentTarget.value)} />
                  </label>
                  <label class="field field-wide">
                    <span>Notes</span>
                    <textarea
                      class="field-textarea"
                      value={tireDraft().notes || ''}
                      onInput={(event) => updateTireField(['notes'], event.currentTarget.value)}
                    />
                  </label>
                </div>
              </section>

              <Show when={selectedTireRecord()} fallback={<div class="subpanel"><p>Save this tire record to start tracking which vehicles use it.</p></div>}>
                <section class="subpanel">
                <div class="subpanel-header">
                  <h3>Asset</h3>
                  <div class="asset-inline-actions">
                    <button
                      type="button"
                      class="ghost-button"
                      onClick={previewStandaloneTire}
                      disabled={!tireDraft().url}
                    >
                      Preview Tire
                    </button>
                  </div>
                </div>
                <div class="field-grid">
                  <label class="field field-wide">
                    <span>URL</span>
                      <input value={selectedTireRecord()?.url || ''} readOnly />
                    </label>
                    <label class="field field-wide">
                      <span>Source Label</span>
                      <input value={selectedTireRecord()?.sourceLabel || ''} readOnly />
                    </label>
                  </div>
                </section>

                <section class="subpanel">
                  <div class="subpanel-header">
                    <h3>Usage</h3>
                  </div>
                  <Show
                    when={(selectedTireRecord()?.usages || []).length > 0}
                    fallback={<p>This tire is not assigned to any vehicle yet.</p>}
                  >
                    <div class="tire-usage-list">
                      <For each={selectedTireRecord()?.usages || []}>
                        {(usage) => (
                          <div class="tire-usage-card">
                            <div>
                              <div class="tire-usage-title">{usage.vehicleLabel}</div>
                              <div class="tire-usage-meta">{usage.position} axle</div>
                            </div>
                            <div class="tire-usage-settings">
                              <span>Rot {JSON.stringify(usage.preset?.tireRotation || [])}</span>
                              <span>Right Rot {JSON.stringify(usage.preset?.rightSideTireRotation || [])}</span>
                              <span>Right Mirror {usage.preset?.rightSideTireMirror ? 'yes' : 'no'}</span>
                            </div>
                            <div class="asset-inline-actions">
                              <button
                                type="button"
                                class="ghost-button"
                                onClick={() => openTirePreview({
                                  title: `${usage.vehicleLabel} ${usage.position} tire`,
                                  tireUrl: selectedTireRecord()?.url,
                                  tireLabel: selectedTireRecord()?.sourceLabel,
                                  initialPreset: usage.preset,
                                  onApply: (presetPatch) => applyTirePreviewToVehicle(usage.vehicleId, presetPatch)
                                })}
                              >
                                Preview Setup
                              </button>
                              <button
                                type="button"
                                class="ghost-button"
                                onClick={() => editVehicleFromTireUsage(usage)}
                              >
                                Edit Vehicle
                              </button>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </section>
              </Show>
            </section>

            <aside class="panel asset-preview-panel">
              <div class="panel-header">
                <div>
                  <p class="panel-label">Preview</p>
                  <h2>Tire JSON</h2>
                </div>
              </div>
              <pre class="json-preview">{tireJsonPreview()}</pre>
            </aside>
          </main>
        </Match>
        <Match when={activeTab() === 'weapons'}>
          <WeaponTab
            busy={busy()}
            weaponLibrary={weaponLibrary()}
            selectedWeaponId={selectedWeaponId()}
            weaponDraft={weaponDraft()}
            weaponJsonPreview={weaponJsonPreview()}
            presentationMode={weaponPresentationMode()}
            setImportInputRef={(element) => {
              weaponImportInputRef = element;
            }}
            onCreateWeapon={createWeapon}
            onDeleteWeapon={deleteWeapon}
            onImportWeaponFile={importWeaponFile}
            onOpenImportDialog={openWeaponImportDialog}
            onSelectWeapon={selectWeapon}
            onSetPresentationMode={setWeaponPresentationMode}
            onUpdateField={updateWeaponField}
          />
        </Match>
        <Match when={true}>
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
              <button type="button" class="ghost-button" onClick={() => setVehiclePreviewOpen(true)} disabled={!draft().body?.url}>
                Preview Vehicle
              </button>
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
                  <span>Front Tire Library</span>
                  <select
                    class="field-select"
                    value={findLibraryTireByUrl(draft().tires?.front?.url || '')?.id || ''}
                    onChange={(event) => assignLibraryTire('front', event.currentTarget.value)}
                  >
                    <option value="">Select tire record</option>
                    <For each={tireLibrary()}>
                      {(tire) => <option value={tire.id}>{tire.label} ({tire.id})</option>}
                    </For>
                  </select>
                </label>
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
                  <span>Rear Tire Library</span>
                  <select
                    class="field-select"
                    value={findLibraryTireByUrl(draft().tires?.rear?.url || '')?.id || ''}
                    onChange={(event) => assignLibraryTire('rear', event.currentTarget.value)}
                  >
                    <option value="">Select tire record</option>
                    <For each={tireLibrary()}>
                      {(tire) => <option value={tire.id}>{tire.label} ({tire.id})</option>}
                    </For>
                  </select>
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
              <div class="asset-inline-actions">
                <button
                  type="button"
                  class="ghost-button"
                  onClick={() => openTirePreview({
                    title: `${draft().label || draft().id || 'Vehicle'} tire setup`,
                    tireUrl: draft().tires?.front?.url || draft().tires?.rear?.url || '',
                    tireLabel: draft().tires?.front?.sourceLabel || draft().tires?.rear?.sourceLabel || '',
                    initialPreset: draft().preset || cloneValue(DEFAULT_PRESET),
                    onApply: applyTirePreviewToCurrentDraft
                  })}
                >
                  Preview Tire Setup
                </button>
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
              <label class="field"><span>Parked Wheel Y</span><input type="number" step="0.001" value={draft().preset?.parkedWheelOffsetY ?? 0} onInput={(event) => updateField(['preset', 'parkedWheelOffsetY'], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Front Axle</span><input type="number" step="0.001" value={draft().preset?.frontAxleRatio ?? 0} onInput={(event) => updateField(['preset', 'frontAxleRatio'], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Rear Axle</span><input type="number" step="0.001" value={draft().preset?.rearAxleRatio ?? 0} onInput={(event) => updateField(['preset', 'rearAxleRatio'], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Ride Height</span><input type="number" step="0.001" value={draft().preset?.rideHeight ?? 0} onInput={(event) => updateField(['preset', 'rideHeight'], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Chassis Height</span><input type="number" step="0.001" value={draft().preset?.chassisHeight ?? 0} onInput={(event) => updateField(['preset', 'chassisHeight'], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Body Visual Y</span><input type="number" step="0.001" value={draft().preset?.bodyVisualOffsetY ?? 0} onInput={(event) => updateField(['preset', 'bodyVisualOffsetY'], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Side Inset</span><input type="number" step="0.001" value={draft().preset?.sideInset ?? 0} onInput={(event) => updateField(['preset', 'sideInset'], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Rot X</span><input type="number" step="0.01" value={draft().preset?.tireRotation?.[0] ?? 0} onInput={(event) => updateField(['preset', 'tireRotation', 0], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Rot Y</span><input type="number" step="0.01" value={draft().preset?.tireRotation?.[1] ?? 0} onInput={(event) => updateField(['preset', 'tireRotation', 1], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Rot Z</span><input type="number" step="0.01" value={draft().preset?.tireRotation?.[2] ?? 0} onInput={(event) => updateField(['preset', 'tireRotation', 2], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Left Rot X</span><input type="number" step="0.01" value={draft().preset?.leftSideTireRotation?.[0] ?? 0} onInput={(event) => updateField(['preset', 'leftSideTireRotation', 0], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Left Rot Y</span><input type="number" step="0.01" value={draft().preset?.leftSideTireRotation?.[1] ?? 0} onInput={(event) => updateField(['preset', 'leftSideTireRotation', 1], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Left Rot Z</span><input type="number" step="0.01" value={draft().preset?.leftSideTireRotation?.[2] ?? 0} onInput={(event) => updateField(['preset', 'leftSideTireRotation', 2], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field field-checkbox">
                <span>Left Mirror</span>
                <input
                  type="checkbox"
                  checked={Boolean(draft().preset?.leftSideTireMirror)}
                  onChange={(event) => updateField(['preset', 'leftSideTireMirror'], event.currentTarget.checked)}
                />
              </label>
              <label class="field"><span>Right Rot X</span><input type="number" step="0.01" value={draft().preset?.rightSideTireRotation?.[0] ?? 0} onInput={(event) => updateField(['preset', 'rightSideTireRotation', 0], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Right Rot Y</span><input type="number" step="0.01" value={draft().preset?.rightSideTireRotation?.[1] ?? 0} onInput={(event) => updateField(['preset', 'rightSideTireRotation', 1], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field"><span>Right Rot Z</span><input type="number" step="0.01" value={draft().preset?.rightSideTireRotation?.[2] ?? 0} onInput={(event) => updateField(['preset', 'rightSideTireRotation', 2], event.currentTarget.value, { numeric: true })} /></label>
              <label class="field field-checkbox">
                <span>Right Mirror</span>
                <input
                  type="checkbox"
                  checked={Boolean(draft().preset?.rightSideTireMirror)}
                  onChange={(event) => updateField(['preset', 'rightSideTireMirror'], event.currentTarget.checked)}
                />
              </label>
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
        </Match>
      </Switch>

      <VehicleValidationDialog
        open={validatorOpen()}
        onClose={() => setValidatorOpen(false)}
        onApprove={applyValidatedModel}
      />
      <VehiclePreviewDialog
        open={vehiclePreviewOpen()}
        manifest={draft()}
        onApplyPresetPatch={applyVehiclePreviewToCurrentDraft}
        onClose={() => setVehiclePreviewOpen(false)}
      />
      <TireValidationDialog
        open={Boolean(tirePreviewConfig())}
        title={tirePreviewConfig()?.title}
        tireUrl={tirePreviewConfig()?.tireUrl}
        tireLabel={tirePreviewConfig()?.tireLabel}
        initialPreset={tirePreviewConfig()?.initialPreset}
        onClose={closeTirePreview}
        onApply={(presetPatch) => tirePreviewConfig()?.onApply?.(presetPatch)}
      />
    </div>
    </Show>
  );
}

render(() => app(), document.getElementById('asset-manager-app'));
