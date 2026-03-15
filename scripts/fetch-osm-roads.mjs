import fs from 'node:fs/promises';
import path from 'node:path';

const METERS_PER_DEGREE_LAT = 111320;
const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const DEFAULT_OUTPUT = 'src/game/city-road-graph.json';

const PRESETS = {
  toronto_downtown: {
    label: 'Downtown Toronto',
    bounds: {
      west: -79.4025,
      south: 43.6425,
      east: -79.3715,
      north: 43.6598
    }
  }
};

const DRIVABLE_HIGHWAYS = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link'
]);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const preset = PRESETS[options.preset];
  if (!preset) {
    throw new Error(`Unknown preset "${options.preset}". Available: ${Object.keys(PRESETS).join(', ')}`);
  }

  const bounds = preset.bounds;
  const query = buildOverpassQuery(bounds);
  const response = await fetch(options.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      accept: 'application/json'
    },
    body: query
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Overpass request failed (${response.status}): ${body.slice(0, 400)}`);
  }

  const payload = await response.json();
  const featureCollection = convertOverpassToLocalGeoJSON(payload, preset);
  const outputPath = path.resolve(process.cwd(), options.out);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(featureCollection, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        preset: options.preset,
        label: preset.label,
        endpoint: options.endpoint,
        out: outputPath,
        featureCount: featureCollection.features.length
      },
      null,
      2
    )
  );
}

function parseArgs(args) {
  const options = {
    preset: 'toronto_downtown',
    out: DEFAULT_OUTPUT,
    endpoint: DEFAULT_ENDPOINT
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--preset' && args[index + 1]) {
      options.preset = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--out' && args[index + 1]) {
      options.out = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--endpoint' && args[index + 1]) {
      options.endpoint = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/fetch-osm-roads.mjs [--preset toronto_downtown] [--out ${DEFAULT_OUTPUT}]`);
}

function buildOverpassQuery(bounds) {
  return [
    '[out:json][timeout:90];',
    `(`,
    `  way["highway"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});`,
    ');',
    'out geom;'
  ].join('\n');
}

function convertOverpassToLocalGeoJSON(payload, preset) {
  const centerLng = (preset.bounds.west + preset.bounds.east) * 0.5;
  const centerLat = (preset.bounds.south + preset.bounds.north) * 0.5;
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((centerLat * Math.PI) / 180);
  const features = [];

  for (const element of Array.isArray(payload?.elements) ? payload.elements : []) {
    if (element?.type !== 'way') {
      continue;
    }

    const tags = element.tags && typeof element.tags === 'object' ? element.tags : {};
    const highway = normalizeHighway(tags.highway);
    if (!DRIVABLE_HIGHWAYS.has(highway)) {
      continue;
    }

    const geometry = Array.isArray(element.geometry) ? element.geometry : [];
    const coordinates = geometry
      .map((point) => {
        const lng = Number(point?.lon);
        const lat = Number(point?.lat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          return null;
        }
        return [
          roundCoord((lng - centerLng) * metersPerDegreeLng),
          roundCoord((lat - centerLat) * METERS_PER_DEGREE_LAT)
        ];
      })
      .filter(Boolean);

    if (coordinates.length < 2) {
      continue;
    }

    features.push({
      type: 'Feature',
      properties: {
        id: `osm_way_${element.id}`,
        osmId: element.id,
        name: tags.name || '',
        highway,
        lanes: sanitizeNumericTag(tags.lanes),
        width: sanitizeNumericTag(tags.width),
        oneway: tags.oneway || ''
      },
      geometry: {
        type: 'LineString',
        coordinates
      }
    });
  }

  return {
    type: 'FeatureCollection',
    properties: {
      coordinateSystem: 'local',
      source: 'osm_overpass',
      preset: preset.label,
      bbox: preset.bounds
    },
    features
  };
}

function normalizeHighway(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'motorway_link') return 'motorway';
  if (text === 'trunk_link') return 'trunk';
  if (text === 'primary_link') return 'primary';
  if (text === 'secondary_link') return 'secondary';
  if (text === 'tertiary_link') return 'tertiary';
  return text;
}

function sanitizeNumericTag(value) {
  if (value == null || value === '') {
    return undefined;
  }
  const numeric = Number.parseFloat(String(value).match(/-?\d+(\.\d+)?/)?.[0] || '');
  return Number.isFinite(numeric) ? numeric : undefined;
}

function roundCoord(value) {
  return Number(value.toFixed(3));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
