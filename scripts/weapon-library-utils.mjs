import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..');
export const weaponLibrarySrcPath = path.join(root, 'src', 'assets', 'weapon-library.json');
export const weaponLibraryPublicPath = path.join(root, 'public', 'data', 'weapon-library.json');

function createError(message, sourcePath) {
  return new Error(sourcePath ? `${message} (${sourcePath})` : message);
}

function assertString(value, fieldName, sourcePath) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createError(`Expected non-empty string for "${fieldName}"`, sourcePath);
  }
  return value.trim();
}

function assertOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function normalizeVector3(value, fieldName, sourcePath, fallback = [0, 0, 0]) {
  const raw = Array.isArray(value) ? value : fallback;
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw createError(`Expected "${fieldName}" to be an array of three numbers`, sourcePath);
  }
  return raw.map((entry, index) => {
    const number = Number(entry);
    if (!Number.isFinite(number)) {
      throw createError(`Expected numeric ${fieldName}[${index}]`, sourcePath);
    }
    return number;
  });
}

function normalizeAssetReference(value, sourcePath) {
  const object = assertOptionalObject(value, 'asset', sourcePath);
  if (!object) {
    return null;
  }

  const url = assertString(object.url, 'asset.url', sourcePath);
  const sourceLabel = assertOptionalString(object.sourceLabel) || `public${url}`;
  return {
    url,
    sourceLabel
  };
}

function normalizeSockets(value, sourcePath) {
  const object = assertOptionalObject(value, 'sockets', sourcePath) || {};
  return {
    muzzle: normalizeVector3(object.muzzle, 'sockets.muzzle', sourcePath, [0, 0, 0.6]),
    offHand: normalizeVector3(object.offHand, 'sockets.offHand', sourcePath, [0, -0.04, 0.28]),
    casingEject: normalizeVector3(object.casingEject, 'sockets.casingEject', sourcePath, [0.04, 0.03, 0.02]),
    aim: normalizeVector3(object.aim, 'sockets.aim', sourcePath, [0, 0.04, 0.18])
  };
}

function normalizeLocomotionSet(value, sourcePath) {
  const object = assertOptionalObject(value, 'locomotionSet', sourcePath) || {};
  return {
    idle: assertString(object.idle || 'idle', 'locomotionSet.idle', sourcePath),
    walk: assertString(object.walk || 'walk', 'locomotionSet.walk', sourcePath),
    run: assertString(object.run || 'run', 'locomotionSet.run', sourcePath),
    walkBackward: assertString(object.walkBackward || 'walk', 'locomotionSet.walkBackward', sourcePath),
    runBackward: assertString(object.runBackward || 'run', 'locomotionSet.runBackward', sourcePath),
    strafeLeft: assertString(object.strafeLeft || 'walk', 'locomotionSet.strafeLeft', sourcePath),
    strafeRight: assertString(object.strafeRight || 'walk', 'locomotionSet.strafeRight', sourcePath)
  };
}

export function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function writeJsonFile(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function normalizeWeaponRecord(record, sourcePath = '') {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw createError('Expected weapon record object', sourcePath);
  }

  const id = assertString(record.id, 'id', sourcePath);
  const label = assertString(record.label, 'label', sourcePath);
  const asset = normalizeAssetReference(record.asset, sourcePath);
  const proceduralModel = assertOptionalString(record.proceduralModel);
  if (!asset && !proceduralModel) {
    throw createError('Expected either "asset" or "proceduralModel"', sourcePath);
  }

  const grip = assertOptionalObject(record.grip, 'grip', sourcePath) || {};
  const combat = assertOptionalObject(record.combat, 'combat', sourcePath) || {};

  return {
    id,
    label,
    asset,
    proceduralModel: proceduralModel || null,
    grip: {
      offset: normalizeVector3(grip.offset, 'grip.offset', sourcePath, [0, 0, 0]),
      rotation: normalizeVector3(grip.rotation, 'grip.rotation', sourcePath, [0, 0, 0]),
      scale: Number.isFinite(Number(grip.scale)) ? Number(grip.scale) : 1
    },
    sockets: normalizeSockets(record.sockets, sourcePath),
    combat: {
      fireCooldownSeconds: Number.isFinite(Number(combat.fireCooldownSeconds))
        ? Number(combat.fireCooldownSeconds)
        : 0.12
    },
    locomotionSet: normalizeLocomotionSet(record.locomotionSet, sourcePath),
    notes: assertOptionalString(record.notes)
  };
}

export function compareWeaponRecords(left, right) {
  return String(left.label || left.id).localeCompare(String(right.label || right.id));
}

export function loadWeaponLibrary() {
  const payload = readJsonFile(weaponLibrarySrcPath);
  const weapons = Array.isArray(payload?.weapons) ? payload.weapons : [];
  return weapons.map((record) => normalizeWeaponRecord(record, weaponLibrarySrcPath)).sort(compareWeaponRecords);
}

export function createWeaponLibraryPayload() {
  return {
    weapons: loadWeaponLibrary()
  };
}

export function writeWeaponLibrary(weapons) {
  const normalized = weapons.map((record) => normalizeWeaponRecord(record)).sort(compareWeaponRecords);
  const payload = { weapons: normalized };
  writeJsonFile(weaponLibrarySrcPath, payload);
  writeJsonFile(weaponLibraryPublicPath, payload);
  return payload;
}
