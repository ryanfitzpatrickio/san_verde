import { createVehicleRegistry, publicVehicleRegistryPath, writeJsonFile } from './vehicle-manifest-utils.mjs';

const registry = createVehicleRegistry();
writeJsonFile(publicVehicleRegistryPath, registry);

console.log(`Wrote ${registry.vehicles.length} vehicle manifests to ${publicVehicleRegistryPath}`);
