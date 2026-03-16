import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..');
export const builtInVehiclesDir = path.join(root, 'src', 'assets', 'built-in-vehicles');
export const publicVehicleRegistryPath = path.join(root, 'public', 'data', 'vehicle-registry.json');

export const DEFAULT_CAR_PRESET = {
  exposure: 1.15,
  environmentIntensity: 1.2,
  tireScale: 0.93,
  frontAxleRatio: 0.18,
  rearAxleRatio: 0.245,
  rideHeight: 0.105,
  chassisHeight: 0.11,
  sideInset: 0.07,
  tireRotation: [0, Math.PI, 0],
  suspension: {
    supportMinNormalY: 0.45,
    supportDeadzone: 0.04,
    supportContactBuffer: 0.018,
    heaveSpring: 14.5,
    heaveDamping: 3.9,
    heaveWheelVelocityFactor: 0.09,
    wheelSpring: 115,
    wheelDamping: 6.2,
    neutralWheelSpring: 92,
    neutralWheelDamping: 5.1,
    bumpTravel: 0.18,
    droopTravel: 0.16,
    rideCompression: 0.012,
    pitchSpring: 10,
    pitchDamping: 6.5,
    rollSpring: 11,
    rollDamping: 7,
    pitchAccelFactor: 0.012,
    rollAccelFactor: 0.01,
    contactPitchFactor: 0.24,
    contactRollFactor: 0.2,
    maxPitch: 0.18,
    maxRoll: 0.14,
    airborneGravity: 7.5
  }
};

function createError(message, sourcePath) {
  return new Error(sourcePath ? `${message} (${sourcePath})` : message);
}

function assertString(value, fieldName, sourcePath) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createError(`Expected non-empty string for "${fieldName}"`, sourcePath);
  }
  return value.trim();
}

function assertOptionalObject(value, fieldName, sourcePath) {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createError(`Expected object for "${fieldName}"`, sourcePath);
  }

  return value;
}

function normalizeAssetReference(reference, fieldName, sourcePath) {
  const object = assertOptionalObject(reference, fieldName, sourcePath);
  if (!object) {
    return null;
  }

  const url = assertString(object.url, `${fieldName}.url`, sourcePath);
  const sourceLabel = typeof object.sourceLabel === 'string' && object.sourceLabel.trim().length > 0
    ? object.sourceLabel.trim()
    : `public${url}`;

  return {
    url,
    sourceLabel
  };
}

function normalizeTireRotation(preset, sourcePath) {
  if (!Array.isArray(preset.tireRotation) || preset.tireRotation.length !== 3) {
    throw createError('Expected "preset.tireRotation" to be an array of three numbers', sourcePath);
  }

  return preset.tireRotation.map((value, index) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw createError(`Expected numeric tire rotation at index ${index}`, sourcePath);
    }
    return value;
  });
}

function normalizePreset(preset, sourcePath) {
  const object = assertOptionalObject(preset, 'preset', sourcePath);
  if (!object) {
    return null;
  }

  const normalized = { ...object };
  normalized.tireRotation = normalizeTireRotation(normalized, sourcePath);
  return normalized;
}

export function compareVehicleManifests(left, right) {
  const leftOrder = Number.isFinite(left.order) ? left.order : Number.MAX_SAFE_INTEGER;
  const rightOrder = Number.isFinite(right.order) ? right.order : Number.MAX_SAFE_INTEGER;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return String(left.label || left.id).localeCompare(String(right.label || right.id));
}

export function normalizeVehicleManifest(manifest, sourcePath = '') {
  const object = assertOptionalObject(manifest, 'manifest', sourcePath);
  if (!object) {
    throw createError('Expected manifest object', sourcePath);
  }

  const id = assertString(object.id, 'id', sourcePath);
  const label = assertString(object.label, 'label', sourcePath);
  const kind = typeof object.kind === 'string' && object.kind.trim().length > 0 ? object.kind.trim() : 'car';
  const body = normalizeAssetReference(object.body, 'body', sourcePath);

  if (!body) {
    throw createError('Expected "body" asset reference', sourcePath);
  }

  const tires = assertOptionalObject(object.tires, 'tires', sourcePath);
  const normalizedTires = tires
    ? {
        front: normalizeAssetReference(tires.front, 'tires.front', sourcePath),
        rear: normalizeAssetReference(tires.rear, 'tires.rear', sourcePath)
      }
    : null;

  if (normalizedTires && (!normalizedTires.front || !normalizedTires.rear)) {
    throw createError('Expected both tires.front and tires.rear when tires are defined', sourcePath);
  }

  const order = Number.isFinite(object.order) ? object.order : null;

  return {
    id,
    order,
    label,
    kind,
    body,
    tires: normalizedTires,
    preset: normalizePreset(object.preset, sourcePath)
  };
}

export function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function writeJsonFile(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function loadVehicleManifests() {
  const fileNames = readdirSync(builtInVehiclesDir)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));

  const manifests = fileNames.map((fileName) => {
    const filePath = path.join(builtInVehiclesDir, fileName);
    return normalizeVehicleManifest(readJsonFile(filePath), filePath);
  });

  manifests.sort(compareVehicleManifests);
  return manifests;
}

export function createVehicleRegistry() {
  const vehicles = loadVehicleManifests();
  return {
    vehicles
  };
}
