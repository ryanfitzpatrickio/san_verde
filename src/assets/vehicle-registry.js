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

export const BUILT_IN_VEHICLES = Object.values(VEHICLE_MANIFEST_MODULES)
  .map((manifest) => ({
    ...manifest,
    body: manifest.body || null,
    tires: manifest.tires || null,
    preset: manifest.preset || null
  }))
  .sort(compareBuiltInVehicles);

const BUILT_IN_VEHICLES_BY_ID = new Map(BUILT_IN_VEHICLES.map((vehicle) => [vehicle.id, vehicle]));

export function getBuiltInVehicleById(id) {
  return BUILT_IN_VEHICLES_BY_ID.get(id) || null;
}
