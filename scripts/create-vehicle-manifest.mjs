import path from 'node:path';
import {
  DEFAULT_CAR_PRESET,
  builtInVehiclesDir,
  compareVehicleManifests,
  loadVehicleManifests,
  normalizeVehicleManifest,
  writeJsonFile
} from './vehicle-manifest-utils.mjs';

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (!argument.startsWith('--')) {
      continue;
    }

    const [rawKey, rawValue] = argument.slice(2).split('=');
    const key = rawKey.trim();
    const value = rawValue ?? argv[index + 1];

    if (rawValue == null && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      index += 1;
    }

    options[key] = value == null ? true : value;
  }

  return options;
}

function printUsage() {
  console.log('Usage: node scripts/create-vehicle-manifest.mjs --id <id> --label <label> --body <url> [--front-tire <url>] [--rear-tire <url>] [--order <n>] [--kind <kind>] [--force]');
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help || options.h) {
    printUsage();
    process.exit(0);
  }

  if (!options.id || !options.label || !options.body) {
    printUsage();
    process.exit(1);
  }

  const id = String(options.id).trim();
  const label = String(options.label).trim();
  const kind = typeof options.kind === 'string' ? options.kind.trim() : 'car';
  const order = options.order == null ? null : Number(options.order);

  if (options.order != null && !Number.isFinite(order)) {
    throw new Error('Expected numeric value for --order');
  }

  const manifest = normalizeVehicleManifest({
    id,
    label,
    kind,
    order,
    body: {
      url: String(options.body).trim()
    },
    tires: options['front-tire'] || options['rear-tire']
      ? {
          front: { url: String(options['front-tire'] || '').trim() },
          rear: { url: String(options['rear-tire'] || '').trim() }
        }
      : null,
    preset: DEFAULT_CAR_PRESET
  });

  const targetPath = path.join(builtInVehiclesDir, `${manifest.id}.json`);
  const manifests = loadVehicleManifests().filter((entry) => entry.id !== manifest.id);
  manifests.push(manifest);
  manifests.sort(compareVehicleManifests);

  if (!options.force) {
    const duplicate = loadVehicleManifests().find((entry) => entry.id === manifest.id);
    if (duplicate) {
      throw new Error(`Manifest already exists for "${manifest.id}". Re-run with --force to overwrite it.`);
    }
  }

  writeJsonFile(targetPath, manifest);
  console.log(`Wrote ${targetPath}`);
  console.log(`Registry order preview: ${manifests.map((entry) => entry.id).join(', ')}`);
}

main();
