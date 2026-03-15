import { resolveModelUrl } from './asset-base-url.js';

const VEHICLE_MANIFEST_MODULES = import.meta.glob('./built-in-vehicles/*.json', {
  eager: true,
  import: 'default'
});

function compareBuiltInVehicles(left, right) {
  const leftOrder = Number.isFinite(left.order) ? left.order : Number.MAX_SAFE_INTEGER;
  const rightOrder = Number.isFinite(right.order) ? right.order : Number.MAX_SAFE_INTEGER;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return String(left.label || left.id).localeCompare(String(right.label || right.id));
}

function resolveManifestUrls(manifest) {
  const body = manifest.body
    ? { ...manifest.body, url: resolveModelUrl(manifest.body.url) }
    : null;
  const tires = manifest.tires
    ? {
        front: manifest.tires.front
          ? { ...manifest.tires.front, url: resolveModelUrl(manifest.tires.front.url) }
          : null,
        rear: manifest.tires.rear
          ? { ...manifest.tires.rear, url: resolveModelUrl(manifest.tires.rear.url) }
          : null
      }
    : null;
  return { ...manifest, body, tires, preset: manifest.preset || null };
}

export const BUILT_IN_VEHICLES = Object.values(VEHICLE_MANIFEST_MODULES)
  .map(resolveManifestUrls)
  .sort(compareBuiltInVehicles);

const BUILT_IN_VEHICLES_BY_ID = new Map(BUILT_IN_VEHICLES.map((vehicle) => [vehicle.id, vehicle]));

export function getBuiltInVehicleById(id) {
  return BUILT_IN_VEHICLES_BY_ID.get(id) || null;
}
