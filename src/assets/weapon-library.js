import weaponLibraryPayload from './weapon-library.json';
import { resolveModelUrl } from './asset-base-url.js';

function compareWeapons(left, right) {
  return String(left.label || left.id).localeCompare(String(right.label || right.id));
}

function cloneVector(vector, fallback) {
  return Array.isArray(vector) && vector.length === 3 ? [...vector] : [...fallback];
}

function resolveWeaponRecord(record) {
  const asset = record?.asset
    ? {
        ...record.asset,
        url: resolveModelUrl(record.asset.url)
      }
    : null;

  return {
    ...record,
    asset,
    modelUrl: asset?.url || null,
    gripOffset: cloneVector(record?.grip?.offset, [0, 0, 0]),
    gripRotation: cloneVector(record?.grip?.rotation, [0, 0, 0]),
    gripScale: Number(record?.grip?.scale) || 1,
    sockets: {
      muzzle: cloneVector(record?.sockets?.muzzle, [0, 0, 0.6]),
      offHand: cloneVector(record?.sockets?.offHand, [0, -0.04, 0.28]),
      casingEject: cloneVector(record?.sockets?.casingEject, [0.04, 0.03, 0.02]),
      aim: cloneVector(record?.sockets?.aim, [0, 0.04, 0.18])
    },
    fireCooldownSeconds: Number(record?.combat?.fireCooldownSeconds) || 0.12,
    locomotionSet: {
      idle: record?.locomotionSet?.idle || 'idle',
      walk: record?.locomotionSet?.walk || 'walk',
      run: record?.locomotionSet?.run || 'run',
      walkBackward: record?.locomotionSet?.walkBackward || 'walk',
      runBackward: record?.locomotionSet?.runBackward || 'run',
      strafeLeft: record?.locomotionSet?.strafeLeft || 'walk',
      strafeRight: record?.locomotionSet?.strafeRight || 'walk'
    }
  };
}

export const BUILT_IN_WEAPONS = Object.freeze(
  (weaponLibraryPayload?.weapons || [])
    .map(resolveWeaponRecord)
    .sort(compareWeapons)
);

const BUILT_IN_WEAPONS_BY_ID = new Map(BUILT_IN_WEAPONS.map((weapon) => [weapon.id, weapon]));

export function getBuiltInWeaponById(id) {
  return BUILT_IN_WEAPONS_BY_ID.get(id) || null;
}
