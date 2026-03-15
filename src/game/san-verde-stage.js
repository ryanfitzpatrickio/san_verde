import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { createRoadGraphNavigation } from './autopilot.js';
import {
  BUILDING_ASSET_MODE_FALLBACK,
  BUILDING_ASSET_MODE_GLB_ONLY,
  BUILDING_LOD_DISTANCES,
  catalogEntryHasGlb,
  filterCatalogEntriesForGlb,
  fitCatalogModelToFootprint,
  loadCatalogGlbInstance,
  normalizeCatalogLod,
  prepareCatalogModelInstance
} from './catalog-lod.js';
import { buildRoadGraphAgentNavigation } from './navigation-network.js';
import SAN_VERDE_MAP_DATA from './san-verde-map.json';
import { resolveModelUrl } from '../assets/asset-base-url.js';
import { ChunkGrid } from './chunk-grid.js';

function yieldToMain() {
  if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') {
    return scheduler.yield();
  }
  return new Promise(resolve => setTimeout(resolve, 0));
}

const SAN_VERDE_CATALOG_MODULES = import.meta.glob('./bloomville/catalogs/*.json', {
  eager: true,
  import: 'default'
});

const IMAGE_LOADER = new THREE.ImageLoader();
const TEXTURE_CACHE = new Map();
const TEXTURE_REPEAT = {
  grass_green: [24, 24],
  asphalt: [14, 14],
  concrete_gray: [10, 10],
  sand: [20, 20]
};

function loadTexture(name) {
  if (TEXTURE_CACHE.has(name)) {
    return TEXTURE_CACHE.get(name);
  }
  const texture = new THREE.Texture();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  const repeat = TEXTURE_REPEAT[name];
  if (repeat) {
    texture.repeat.set(repeat[0], repeat[1]);
  }
  IMAGE_LOADER.load(
    resolveModelUrl(`/textures/${name}.png`),
    (image) => { texture.image = image; texture.needsUpdate = true; },
    undefined,
    () => console.warn(`Texture not found: /textures/${name}.png`)
  );
  TEXTURE_CACHE.set(name, texture);
  return texture;
}


const ROAD_KIND_STYLE = {
  boulevard: { roadWidth: 28, sidewalkWidth: 7, medianWidth: 5 },
  avenue: { roadWidth: 22, sidewalkWidth: 6, medianWidth: 0 },
  street: { roadWidth: 18, sidewalkWidth: 5.2, medianWidth: 0 }
};
const RIVER_RUNTIME_WIDTH_SCALE = 1.72;
const TERRAIN_PADDING = 100;
const TERRAIN_TOP_Y = -0.24;
// Match river water level formula (24m ref width: eff=41.28, depth=3.3, waterY = base - (depth*0.84 - 0.08)*0.5)
const OCEAN_Y = TERRAIN_TOP_Y - 1.347;
const GROUND_FIELD_CELL_SIZE = 8;
const ROAD_SURFACE_Y = 0;
const CSG_EVALUATOR = new Evaluator();

const DISTRICT_STYLE = {
  downtown: { ground: '#5a5a5a', treeDensity: 0.02 },
  residential_low: { ground: '#6d845f', treeDensity: 0.6 },
  residential_mid: { ground: '#70815f', treeDensity: 0.38 },
  residential_high: { ground: '#767d68', treeDensity: 0.2 },
  mixed_main: { ground: '#7b755f', treeDensity: 0.14 },
  civic: { ground: '#8a8170', treeDensity: 0.08 },
  commercial_general: { ground: '#817864', treeDensity: 0.08 },
  commercial_regional: { ground: '#847764', treeDensity: 0.04 },
  industrial_light: { ground: '#7b735f', treeDensity: 0.05 },
  industrial_heavy: { ground: '#736a59', treeDensity: 0.02 },
  park: { ground: '#548253', treeDensity: 0.85 }
};

const MATERIALS = {
  ground: new THREE.MeshStandardMaterial({ color: '#667f56', roughness: 0.99, metalness: 0.01, map: loadTexture('grass_green') }),
  road: new THREE.MeshStandardMaterial({ color: '#5c6268', roughness: 0.96, metalness: 0.02, map: loadTexture('asphalt') }),
  roadWide: new THREE.MeshStandardMaterial({ color: '#545a60', roughness: 0.96, metalness: 0.02, map: loadTexture('asphalt') }),
  riverBank: new THREE.MeshStandardMaterial({ color: '#625a4c', roughness: 0.98, metalness: 0.01 }),
  water: new THREE.MeshStandardMaterial({ color: '#58a7c8', roughness: 0.12, metalness: 0.02, emissive: '#0d3342', emissiveIntensity: 0.18 }),
  ocean: new THREE.MeshStandardMaterial({ color: '#3a88b8', roughness: 0.08, metalness: 0.04, emissive: '#0a2a42', emissiveIntensity: 0.22 }),
  beach: new THREE.MeshStandardMaterial({ color: '#c8b878', roughness: 0.96, metalness: 0.0, map: loadTexture('sand') }),
  sidewalk: new THREE.MeshStandardMaterial({ color: '#8a8e91', roughness: 0.95, metalness: 0.02, map: loadTexture('concrete_gray') }),
  median: new THREE.MeshStandardMaterial({ color: '#587548', roughness: 0.99, metalness: 0.01, map: loadTexture('grass_green') }),
  plaza: new THREE.MeshStandardMaterial({ color: '#a19788', roughness: 0.92, metalness: 0.02, map: loadTexture('concrete_gray') }),
  buildingWallWarm: new THREE.MeshStandardMaterial({ color: '#c8b39c', roughness: 0.9, metalness: 0.02 }),
  buildingWallCool: new THREE.MeshStandardMaterial({ color: '#a7adb7', roughness: 0.9, metalness: 0.02 }),
  buildingWallBrick: new THREE.MeshStandardMaterial({ color: '#a06956', roughness: 0.92, metalness: 0.02 }),
  buildingWallIndustrial: new THREE.MeshStandardMaterial({ color: '#8d877d', roughness: 0.95, metalness: 0.02 }),
  buildingRoofDark: new THREE.MeshStandardMaterial({ color: '#444851', roughness: 0.95, metalness: 0.02 }),
  buildingRoofLight: new THREE.MeshStandardMaterial({ color: '#7a7d82', roughness: 0.95, metalness: 0.02 }),
  trunk: new THREE.MeshStandardMaterial({ color: '#5c493d', roughness: 0.92, metalness: 0.02 }),
  leaf: new THREE.MeshStandardMaterial({ color: '#5c7448', roughness: 0.98, metalness: 0.01 })
};

for (const material of Object.values(MATERIALS)) {
  material.userData.shared = true;
}

const PLANE_GEOMETRY_CACHE = new Map();
const BOX_GEOMETRY_CACHE = new Map();
const GABLE_ROOF_GEOMETRY_CACHE = new Map();
const PALETTE_MATERIAL_CACHE = new Map();
const INSTANCE_MATRIX = new THREE.Matrix4();
const INSTANCE_POSITION = new THREE.Vector3();
const INSTANCE_SCALE = new THREE.Vector3();
const INSTANCE_QUATERNION = new THREE.Quaternion();
const IDENTITY_QUATERNION = new THREE.Quaternion();

const TREE_GEOMETRIES = {
  trunk: markSharedGeometry(new THREE.CylinderGeometry(0.8, 1, 1, 8)),
  crown: markSharedGeometry(new THREE.SphereGeometry(1, 10, 8))
};

const BUILDING_GEOMETRIES = {
  body: markSharedGeometry(new THREE.BoxGeometry(1, 1, 1)),
  roof: markSharedGeometry(new THREE.BoxGeometry(1, 0.08, 1))
};

const ZONE_BUILDING_STYLE = {
  downtown: {
    spacing: 36,
    footprintMin: 22,
    footprintMax: 36,
    depthMin: 22,
    depthMax: 36,
    heightMin: 60,
    heightMax: 140,
    setback: 8,
    fillChance: 0.92,
    wallMaterial: 'buildingWallCool',
    roofMaterial: 'buildingRoofDark'
  },
  residential_low: {
    spacing: 22,
    footprintMin: 10,
    footprintMax: 16,
    depthMin: 10,
    depthMax: 15,
    heightMin: 6,
    heightMax: 10,
    setback: 7,
    fillChance: 0.78,
    wallMaterial: 'buildingWallWarm',
    roofMaterial: 'buildingRoofDark'
  },
  residential_mid: {
    spacing: 18,
    footprintMin: 10,
    footprintMax: 18,
    depthMin: 12,
    depthMax: 18,
    heightMin: 10,
    heightMax: 18,
    setback: 7,
    fillChance: 0.82,
    wallMaterial: 'buildingWallCool',
    roofMaterial: 'buildingRoofDark'
  },
  residential_high: {
    spacing: 24,
    footprintMin: 16,
    footprintMax: 26,
    depthMin: 16,
    depthMax: 24,
    heightMin: 24,
    heightMax: 48,
    setback: 9,
    fillChance: 0.86,
    wallMaterial: 'buildingWallCool',
    roofMaterial: 'buildingRoofLight'
  },
  mixed_main: {
    spacing: 20,
    footprintMin: 12,
    footprintMax: 20,
    depthMin: 14,
    depthMax: 22,
    heightMin: 12,
    heightMax: 24,
    setback: 7,
    fillChance: 0.84,
    wallMaterial: 'buildingWallBrick',
    roofMaterial: 'buildingRoofDark'
  },
  commercial_general: {
    spacing: 22,
    footprintMin: 16,
    footprintMax: 24,
    depthMin: 14,
    depthMax: 24,
    heightMin: 14,
    heightMax: 28,
    setback: 8,
    fillChance: 0.82,
    wallMaterial: 'buildingWallCool',
    roofMaterial: 'buildingRoofLight'
  },
  commercial_regional: {
    spacing: 32,
    footprintMin: 26,
    footprintMax: 42,
    depthMin: 24,
    depthMax: 40,
    heightMin: 12,
    heightMax: 22,
    setback: 10,
    fillChance: 0.9,
    wallMaterial: 'buildingWallWarm',
    roofMaterial: 'buildingRoofLight'
  },
  industrial_light: {
    spacing: 26,
    footprintMin: 20,
    footprintMax: 32,
    depthMin: 20,
    depthMax: 30,
    heightMin: 10,
    heightMax: 18,
    setback: 10,
    fillChance: 0.82,
    wallMaterial: 'buildingWallIndustrial',
    roofMaterial: 'buildingRoofLight'
  },
  industrial_heavy: {
    spacing: 34,
    footprintMin: 28,
    footprintMax: 48,
    depthMin: 24,
    depthMax: 44,
    heightMin: 12,
    heightMax: 24,
    setback: 12,
    fillChance: 0.88,
    wallMaterial: 'buildingWallIndustrial',
    roofMaterial: 'buildingRoofDark'
  },
  civic: {
    spacing: 26,
    footprintMin: 18,
    footprintMax: 32,
    depthMin: 18,
    depthMax: 30,
    heightMin: 12,
    heightMax: 24,
    setback: 10,
    fillChance: 0.78,
    wallMaterial: 'buildingWallWarm',
    roofMaterial: 'buildingRoofLight'
  },
  park: {
    spacing: 40,
    footprintMin: 8,
    footprintMax: 12,
    depthMin: 8,
    depthMax: 12,
    heightMin: 4,
    heightMax: 8,
    setback: 15,
    fillChance: 0.1,
    wallMaterial: 'buildingWallWarm',
    roofMaterial: 'buildingRoofDark'
  }
};

async function loadMapData() {
  try {
    const response = await fetch(`/data/san-verde-map.json?ts=${Date.now()}`, {
      cache: 'no-store'
    });
    if (response.ok) {
      return await response.json();
    }
  } catch {}

  return SAN_VERDE_MAP_DATA || {
    name: 'San Verde',
    version: 1,
    bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 },
    spawn: { x: 0, z: 0, yaw: 0 },
    roads: [],
    rivers: [],
    zones: [],
    nodes: []
  };
}

function loadCatalogEntries() {
  return Object.values(SAN_VERDE_CATALOG_MODULES)
    .flatMap((pack) => pack.entries || [])
    .map((entry) => normalizeCatalogEntry(entry))
    .filter(Boolean);
}

function normalizeCatalogEntry(entry) {
  if (!entry?.id || !Array.isArray(entry?.districts) || !Array.isArray(entry?.pieces) || !entry.pieces.length) {
    return null;
  }

  return {
    ...entry,
    weight: entry.weight ?? 1,
    lot: {
      frontage: normalizeRange(entry.lot?.frontage, [12, 18]),
      depth: normalizeRange(entry.lot?.depth, [16, 24]),
      setback: normalizeRange(entry.lot?.setback, [4, 10])
    },
    palette: {
      body: entry.palette?.body || '#cfc3b4',
      accent: entry.palette?.accent || '#867869',
      roof: entry.palette?.roof || '#5c4f49',
      glass: entry.palette?.glass || '#8fa4b6'
    },
    textures: entry.textures || {},
    lod1: normalizeCatalogLod(entry),
    roof: entry.roof || null,
    features: entry.features || {}
  };
}

export async function createSanVerdeStage({ gltfLoader, loadingManager, buildingAssetMode = BUILDING_ASSET_MODE_FALLBACK, onProgress } = {}) {
  const report = (pct, label) => onProgress?.(Math.round(pct), label);

  report(3, 'Loading map data…');
  const data = await loadMapData();

  const catalogs = loadCatalogEntries();
  const activeCatalogs = buildingAssetMode === BUILDING_ASSET_MODE_GLB_ONLY
    ? await filterCatalogEntriesForGlb(catalogs)
    : catalogs;

  const group = new THREE.Group();
  const collisionGroup = new THREE.Group();
  const riverFields = buildRiverFields(data.rivers);
  const coastlineFields = buildCoastlineFields(data.coastlines, data.spawn);
  const roadSurfaceSegments = buildRoadSurfaceSegments(data.roads);
  const graph = buildRoadGraph(data);

  report(7, 'Building terrain…');
  const groundField = await buildGroundField(
    data.bounds,
    roadSurfaceSegments,
    riverFields,
    coastlineFields,
    TERRAIN_TOP_Y,
    GROUND_FIELD_CELL_SIZE,
    (t) => report(7 + t * 10, 'Building terrain…')
  );

  report(18, 'Creating roads & zones…');
  await yieldToMain();
  group.add(createTerrain(groundField));
  group.add(createAllZones(data.zones, data.rivers));
  group.add(createAllRivers(data.rivers, riverFields));
  group.add(createAllRoads(data.roads));
  if (coastlineFields.length > 0) {
    group.add(createOcean());
    group.add(createAllCoastlines(data.coastlines, coastlineFields));
  }

  const chunkGrid = new ChunkGrid(800);
  await createZoneBuildings(
    data.zones, data.roads, activeCatalogs, chunkGrid,
    (t) => report(20 + t * 55, 'Placing buildings…'),
    { gltfLoader, buildingAssetMode }
  );

  report(76, 'Generating city LODs…');
  await chunkGrid.buildMassGeometry(
    (t) => report(76 + t * 9, 'Generating city LODs…')
  );

  report(86, 'Adding trees & clouds…');
  await yieldToMain();
  group.add(chunkGrid.root);
  const skylineMesh = chunkGrid.buildSkylineMesh();
  if (skylineMesh) group.add(skylineMesh);
  group.add(createTrees(data.zones));
  group.add(createClouds(data.bounds));

  collisionGroup.add(createCollisionTerrain(groundField));

  report(89, 'Finalizing…');

  const spawn = data.spawn || { x: 0, z: 0, yaw: 0 };
  const spawnPosition = new THREE.Vector3(spawn.x, 0, spawn.z);

  const stage = {
    id: 'san_verde',
    buildingAssetMode,
    group,
    collisionGroup,
    startPosition: spawnPosition,
    startYaw: spawn.yaw || 0,
    driveBounds: Math.max(Math.abs(data.bounds.maxX), Math.abs(data.bounds.maxZ)) - 20,
    navigation: graph.roads.length > 0 ? createRoadGraphNavigation(graph) : null,
    agentNavigation: graph.roads.length > 0 ? buildRoadGraphAgentNavigation(graph) : null,
    agentNavigationRevision: 0,
    overviewBounds: data.bounds,
    sampleGround: createGroundFieldSampler(groundField),
    update(playerPos) {
      if (playerPos) chunkGrid.update(playerPos);
    }
  };

  return stage;
}

function buildRoadGraph(data) {
  const roads = (data.roads || []).map(road => {
    const points = (road.points || [])
      .map(normalizePoint)
      .filter(Boolean)
      .map((point) => new THREE.Vector3(point.x, 0, point.z));
    if (points.length < 2) return null;
    return {
      id: road.id,
      name: road.id,
      classification: road.type === 'boulevard' ? 'primary' : road.type === 'avenue' ? 'secondary' : 'local',
      width: ROAD_KIND_STYLE[road.type]?.roadWidth || 18,
      points,
      curve: createRoadPath(points)
    };
  }).filter(Boolean);
  
  return {
    roads,
    nodes: data.nodes || [],
    bounds: data.bounds,
    metadata: { source: 'san_verde_editor' }
  };
}

function createTerrain(groundField) {
  const geometry = createGroundFieldGeometry(groundField);
  const mesh = new THREE.Mesh(geometry, MATERIALS.ground.clone());
  mesh.material.shadowSide = THREE.DoubleSide;
  mesh.receiveShadow = true;
  return mesh;
}

function createCollisionTerrain(groundField) {
  const mesh = new THREE.Mesh(
    createGroundFieldGeometry(groundField),
    new THREE.MeshStandardMaterial({ color: '#607751', roughness: 1, metalness: 0 })
  );
  return mesh;
}

function createAllRoads(roads) {
  const group = new THREE.Group();
  for (const road of roads || []) {
    group.add(createRoad(road));
  }
  return group;
}

function createAllRivers(rivers, riverFields = []) {
  const group = new THREE.Group();
  for (let i = 0; i < (rivers || []).length; i += 1) {
    group.add(createRiver(rivers[i], riverFields[i]));
  }
  return group;
}

function createRoad(road) {
  const group = new THREE.Group();
  const points = (road.points || []).map(normalizePoint).filter(Boolean);
  if (points.length < 2) return group;
  
  const style = ROAD_KIND_STYLE[road.type] || ROAD_KIND_STYLE.street;
  const vectors = points.map((point) => new THREE.Vector3(point.x, 0, point.z));
  const curve = createRoadPath(vectors);
  const length = curve.getLength();
  const samples = Math.max(4, Math.round(length / 4));
  
  const shoulder = createTrackRibbon(curve, {
    width: style.roadWidth + style.sidewalkWidth * 2,
    samples,
    y: 0.004,
    uvScale: 0.04
  });
  shoulder.material = MATERIALS.sidewalk.clone();
  shoulder.material.shadowSide = THREE.DoubleSide;
  shoulder.material.polygonOffset = true;
  shoulder.material.polygonOffsetFactor = -2;
  shoulder.material.polygonOffsetUnits = -2;
  shoulder.receiveShadow = true;
  group.add(shoulder);

  const roadMaterial = road.type === 'boulevard' ? MATERIALS.roadWide : MATERIALS.road;
  const roadMesh = createTrackRibbon(curve, {
    width: style.roadWidth,
    samples,
    y: 0.018,
    uvScale: 0.05
  });
  roadMesh.material = roadMaterial.clone();
  roadMesh.material.shadowSide = THREE.DoubleSide;
  roadMesh.material.polygonOffset = true;
  roadMesh.material.polygonOffsetFactor = -4;
  roadMesh.material.polygonOffsetUnits = -4;
  roadMesh.receiveShadow = true;
  group.add(roadMesh);
  
  return group;
}

function createRiver(river, riverField = null) {
  const group = new THREE.Group();
  const points = (river.points || []).map(normalizePoint).filter(Boolean);
  if (points.length < 2) return group;

  const field = riverField || buildRiverField(river);
  if (!field) {
    return group;
  }

  const width = field.width;
  const depth = field.depth;
  const vectors = points.map((point) => new THREE.Vector3(point.x, 0, point.z));
  const curve = createRiverPath(vectors);
  const length = curve.getLength();
  const samples = Math.max(10, Math.round(length / 8));
  const waterY = TERRAIN_TOP_Y - (depth * 0.84 - 0.08) * 0.5;
  const waterWidth = Math.max(6, width * 0.94);

  const water = createTrackRibbon(curve, {
    width: waterWidth,
    samples,
    y: waterY,
    uvScale: 0.035
  });
  water.material = MATERIALS.water.clone();
  water.material.shadowSide = THREE.DoubleSide;
  water.receiveShadow = true;
  group.add(water);

  return group;
}

function createAllZones(zones, rivers = []) {
  const group = new THREE.Group();
  for (const zone of zones || []) {
    group.add(createZone(zone, rivers));
  }
  return group;
}

function createZone(zone, rivers = []) {
  const points = (zone.points || []).map(normalizePoint).filter(Boolean);
  if (points.length < 3) return new THREE.Group();
  
  const style = DISTRICT_STYLE[zone.type] || DISTRICT_STYLE.residential_mid;
  const shape = new THREE.Shape();
  shape.moveTo(points[0].x, points[0].z);
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i].x, points[i].z);
  }
  shape.closePath();
  
  const topY = -0.016;
  const slabDepth = 2.2;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: slabDepth,
    bevelEnabled: false,
    steps: 1,
    curveSegments: Math.max(12, points.length * 2)
  });
  geometry.clearGroups();
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, topY, 0);
  const mesh = new THREE.Mesh(geometry, MATERIALS.ground.clone());
  mesh.material.color.set(style.ground);
  mesh.material.shadowSide = THREE.DoubleSide;
  mesh.receiveShadow = true;
  return applyRiverCutsToGround(mesh, rivers, {
    bounds: getPolygonBounds(points),
    topY,
    slabDepth
  });
}

function createTrees(zones) {
  const placements = [];
  for (const zone of zones || []) {
    const points = (zone.points || []).map(normalizePoint).filter(Boolean);
    if (points.length < 3) continue;
    const style = DISTRICT_STYLE[zone.type] || DISTRICT_STYLE.residential_mid;
    const center = getPolygonCenter(points);
    const area = Math.abs(polygonArea(points));
    const count = Math.floor(area / 400 * style.treeDensity);
    for (let i = 0; i < count; i++) {
      placements.push({
        x: center.x + (Math.random() - 0.5) * Math.sqrt(area) * 0.8,
        z: center.z + (Math.random() - 0.5) * Math.sqrt(area) * 0.8,
        height: 3.8 + Math.random() * 3
      });
    }
  }
  return createTreeInstances(placements);
}

async function createZoneBuildings(zones, roads, catalogs, chunkGrid, onProgress, dependencies = {}) {
  const roadSegments = buildRoadSegments(roads);
  const activeZones = (zones || []).filter(z => z.type !== 'park' && (z.points || []).length >= 3);
  const totalZones = Math.max(activeZones.length, 1);
  let zonesDone = 0;

  for (const zone of activeZones) {
    const points = (zone.points || []).map(normalizePoint).filter(Boolean);
    if (points.length < 3) { zonesDone++; continue; }

    const savedPlots = (zone.plots || [])
      .map(normalizePlot)
      .filter(Boolean);

    const zoneCatalogs = catalogs.filter((entry) => entry.districts.includes(zone.type));
    const activeCatalogs = zoneCatalogs.length
      ? zoneCatalogs
      : catalogs.filter((entry) => entry.districts.includes('mixed_main'));
    if (!activeCatalogs.length) { zonesDone++; continue; }

    const placements = savedPlots.length
      ? savedPlots
      : generateRuntimeZonePlots(points, zone.type, roadSegments);

    let plotIndex = 0;
    for (const plot of placements) {
      const rng = createSeededRandom(hashZonePlot(zone.id || zone.label || zone.type, plotIndex));
      const entry = pickWeightedEntry(activeCatalogs, rng);
      const useExactPlotFootprint = savedPlots.length > 0;
      const frontage = useExactPlotFootprint
        ? Math.max(8, plot.width - Math.max(2.5, plot.width * 0.14))
        : clamp(sampleRange(entry.lot.frontage, rng), Math.max(8, plot.width * 0.65), plot.width);
      const depth = useExactPlotFootprint
        ? Math.max(10, plot.depth - Math.max(3.5, plot.depth * 0.2))
        : clamp(sampleRange(entry.lot.depth, rng), Math.max(10, plot.depth * 0.55), plot.depth);
      const building = createBuildingFromEntry(entry, frontage, depth, rng, {
        exactFootprint: useExactPlotFootprint
      }, dependencies);
      building.position.set(plot.x, 0, plot.z);
      building.quaternion.copy(createPlotQuaternion(plot));
      building.userData.noCollision = true;
      building.userData.noSuspension = true;
      const zoneStyle = ZONE_BUILDING_STYLE[zone.type];
      const estHeight = zoneStyle
        ? (zoneStyle.heightMin + zoneStyle.heightMax) * 0.5
        : 12;
      chunkGrid.addBuilding(building, plot.x, plot.z, frontage, depth, estHeight, plot.angle || 0);

      if (plotIndex % 20 === 0) {
        const t = (zonesDone + plotIndex / Math.max(placements.length, 1)) / totalZones;
        onProgress?.(t);
        await yieldToMain();
      }
      plotIndex += 1;
    }
    zonesDone += 1;
  }
}

function generateRuntimeZonePlots(points, zoneType, roadSegments) {
  const style = ZONE_BUILDING_STYLE[zoneType];
  if (!style) {
    return [];
  }

  const bounds = getPolygonBounds(points);
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const adaptiveSetback = Math.min(style.setback, width * 0.18, depth * 0.18);
  if (width < style.footprintMin + adaptiveSetback * 2 || depth < style.depthMin + adaptiveSetback * 2) {
    return [];
  }

  const startX = bounds.minX + adaptiveSetback;
  const endX = bounds.maxX - adaptiveSetback;
  const startZ = bounds.minZ + adaptiveSetback;
  const endZ = bounds.maxZ - adaptiveSetback;
  const spacing = Math.max(
    14,
    Math.min(style.spacing, Math.max(18, width * 0.5), Math.max(18, depth * 0.5))
  );
  const minEdgeDistance = adaptiveSetback * 0.55;
  const zonePlacements = createFrontagePlacements(points, style, roadSegments, minEdgeDistance);

  for (let x = startX; x <= endX; x += spacing) {
    for (let z = startZ; z <= endZ; z += spacing) {
      if (Math.random() > style.fillChance * 0.55) continue;

      const plotWidth = randomRange(
        style.footprintMin,
        Math.min(style.footprintMax, Math.max(style.footprintMin + 2, width * 0.5))
      );
      const plotDepth = randomRange(
        style.depthMin,
        Math.min(style.depthMax, Math.max(style.depthMin + 2, depth * 0.5))
      );
      const halfWidth = plotWidth * 0.5;
      const halfDepth = plotDepth * 0.5;
      const orientation = getPlacementOrientation(x, z, roadSegments);
      const corners = createPlacementCorners(
        x,
        z,
        halfWidth,
        halfDepth,
        orientation.tangent,
        orientation.normal
      );

      if (!corners.every((corner) => pointInPolygon(corner.x, corner.z, points))) continue;
      if (distanceToPolygonEdges(x, z, points) < minEdgeDistance) continue;
      if (!footprintClearsRoads(x, z, corners, roadSegments)) continue;
      if (placementCollides(zonePlacements, x, z, plotWidth, plotDepth, 10)) continue;

      zonePlacements.push({
        x,
        z,
        width: plotWidth,
        depth: plotDepth,
        angle: Math.atan2(orientation.tangent.x, orientation.tangent.z)
      });
    }
  }

  if (!zonePlacements.length) {
    const fallback = findFallbackPlacement(points, style, roadSegments, minEdgeDistance);
    if (fallback) {
      zonePlacements.push({
        x: fallback.x,
        z: fallback.z,
        width: fallback.width,
        depth: fallback.depth,
        angle: quaternionToYaw(fallback.quaternion)
      });
    }
  }

  return zonePlacements;
}

function createPlotQuaternion(plot) {
  const sin = Math.sin(plot.angle || 0);
  const cos = Math.cos(plot.angle || 0);
  return createPlacementQuaternion(
    { x: sin, z: cos },
    { x: -cos, z: sin }
  );
}

function plotFitsZone(plot, zonePoints, roadSegments) {
  const corners = getPlotCorners(plot);
  if (!corners.length) {
    return false;
  }

  if (!corners.every((corner) => pointInPolygon(corner.x, corner.z, zonePoints))) {
    return false;
  }

  return footprintClearsRoads(plot.x, plot.z, corners, roadSegments);
}

function getPlotCorners(plot) {
  const halfWidth = plot.width * 0.5;
  const halfDepth = plot.depth * 0.5;
  const sin = Math.sin(plot.angle || 0);
  const cos = Math.cos(plot.angle || 0);
  const tangent = { x: sin, z: cos };
  const normal = { x: -cos, z: sin };
  return createPlacementCorners(plot.x, plot.z, halfWidth, halfDepth, tangent, normal);
}

function createTreeInstances(placements) {
  const group = new THREE.Group();
  group.userData.noCollision = true;
  if (!placements.length) return group;
  
  const trunks = new THREE.InstancedMesh(TREE_GEOMETRIES.trunk, MATERIALS.trunk, placements.length);
  const crowns = new THREE.InstancedMesh(TREE_GEOMETRIES.crown, MATERIALS.leaf, placements.length);
  trunks.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  crowns.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  trunks.castShadow = true;
  crowns.castShadow = true;
  
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const crownRadius = p.height * 0.42;
    
    INSTANCE_POSITION.set(p.x, p.height * 0.5, p.z);
    INSTANCE_SCALE.set(0.28, p.height, 0.28);
    INSTANCE_MATRIX.compose(INSTANCE_POSITION, IDENTITY_QUATERNION, INSTANCE_SCALE);
    trunks.setMatrixAt(i, INSTANCE_MATRIX);
    
    INSTANCE_POSITION.set(p.x, p.height * 0.95, p.z);
    INSTANCE_SCALE.set(crownRadius, crownRadius, crownRadius);
    INSTANCE_MATRIX.compose(INSTANCE_POSITION, IDENTITY_QUATERNION, INSTANCE_SCALE);
    crowns.setMatrixAt(i, INSTANCE_MATRIX);
  }
  
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  group.add(trunks, crowns);
  return group;
}

async function buildGroundField(bounds, roadSurfaceSegments, riverFields, coastlineFields, baseY, cellSize, onProgress) {
  const width = bounds.maxX - bounds.minX + TERRAIN_PADDING;
  const depth = bounds.maxZ - bounds.minZ + TERRAIN_PADDING;
  const segmentsX = Math.max(10, Math.round(width / Math.max(4, cellSize)));
  const segmentsZ = Math.max(10, Math.round(depth / Math.max(4, cellSize)));
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
  const minX = centerX - width * 0.5;
  const minZ = centerZ - depth * 0.5;
  const cellSizeX = width / segmentsX;
  const cellSizeZ = depth / segmentsZ;
  const heights = new Float32Array((segmentsX + 1) * (segmentsZ + 1));

  let index = 0;
  for (let zIndex = 0; zIndex <= segmentsZ; zIndex += 1) {
    if (zIndex % 30 === 0) {
      onProgress?.(zIndex / segmentsZ);
      await yieldToMain();
    }
    const z = minZ + cellSizeZ * zIndex;
    for (let xIndex = 0; xIndex <= segmentsX; xIndex += 1) {
      const x = minX + cellSizeX * xIndex;
      heights[index] = sampleBakedGroundHeight(x, z, baseY, roadSurfaceSegments, riverFields, coastlineFields);
      index += 1;
    }
  }

  return {
    width,
    depth,
    segmentsX,
    segmentsZ,
    centerX,
    centerZ,
    minX,
    minZ,
    maxX: minX + width,
    maxZ: minZ + depth,
    cellSizeX,
    cellSizeZ,
    heights
  };
}

function createGroundFieldGeometry(groundField) {
  const geometry = new THREE.PlaneGeometry(
    groundField.width,
    groundField.depth,
    groundField.segmentsX,
    groundField.segmentsZ
  );
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(groundField.centerX, 0, groundField.centerZ);

  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    positions.setY(i, groundField.heights[i]);
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createGroundFieldSampler(groundField) {
  const normal = new THREE.Vector3();

  return function sampleGround(x, z) {
    const height = sampleGroundFieldHeight(groundField, x, z);
    const offsetX = Math.max(groundField.cellSizeX, 0.5);
    const offsetZ = Math.max(groundField.cellSizeZ, 0.5);
    const leftHeight = sampleGroundFieldHeight(groundField, x - offsetX, z);
    const rightHeight = sampleGroundFieldHeight(groundField, x + offsetX, z);
    const backHeight = sampleGroundFieldHeight(groundField, x, z - offsetZ);
    const frontHeight = sampleGroundFieldHeight(groundField, x, z + offsetZ);
    normal.set(leftHeight - rightHeight, offsetX + offsetZ, backHeight - frontHeight);
    if (normal.lengthSq() < 1e-6) {
      normal.set(0, 1, 0);
    } else {
      normal.normalize();
    }

    return {
      height,
      normal: normal.clone(),
      distance: 0
    };
  };
}

function sampleGroundFieldHeight(groundField, x, z) {
  const clampedX = clamp(x, groundField.minX, groundField.maxX);
  const clampedZ = clamp(z, groundField.minZ, groundField.maxZ);
  const localX = ((clampedX - groundField.minX) / groundField.width) * groundField.segmentsX;
  const localZ = ((clampedZ - groundField.minZ) / groundField.depth) * groundField.segmentsZ;
  const x0 = Math.floor(localX);
  const z0 = Math.floor(localZ);
  const x1 = Math.min(groundField.segmentsX, x0 + 1);
  const z1 = Math.min(groundField.segmentsZ, z0 + 1);
  const tx = localX - x0;
  const tz = localZ - z0;

  const h00 = getGroundFieldHeightAt(groundField, x0, z0);
  const h10 = getGroundFieldHeightAt(groundField, x1, z0);
  const h01 = getGroundFieldHeightAt(groundField, x0, z1);
  const h11 = getGroundFieldHeightAt(groundField, x1, z1);
  const h0 = THREE.MathUtils.lerp(h00, h10, tx);
  const h1 = THREE.MathUtils.lerp(h01, h11, tx);
  return THREE.MathUtils.lerp(h0, h1, tz);
}

function getGroundFieldHeightAt(groundField, xIndex, zIndex) {
  return groundField.heights[zIndex * (groundField.segmentsX + 1) + xIndex];
}

function buildRoadSurfaceSegments(roads) {
  const segments = [];

  for (const road of roads || []) {
    const style = ROAD_KIND_STYLE[road.type] || ROAD_KIND_STYLE.street;
    const roadHalfWidth = style.roadWidth * 0.5;
    const shoulderHalfWidth = roadHalfWidth + style.sidewalkWidth;
    const points = (road.points || []).map(normalizePoint).filter(Boolean);

    for (let i = 0; i < points.length - 1; i += 1) {
      const start = new THREE.Vector3(points[i].x, 0, points[i].z);
      const end = new THREE.Vector3(points[i + 1].x, 0, points[i + 1].z);
      if (start.distanceToSquared(end) < 1e-6) {
        continue;
      }

      const padding = shoulderHalfWidth + 2;
      segments.push({
        start,
        end,
        roadHalfWidth,
        shoulderHalfWidth,
        bounds: {
          minX: Math.min(start.x, end.x) - padding,
          maxX: Math.max(start.x, end.x) + padding,
          minZ: Math.min(start.z, end.z) - padding,
          maxZ: Math.max(start.z, end.z) + padding
        }
      });
    }
  }

  return segments;
}

function buildRiverFields(rivers) {
  return (rivers || [])
    .map((river) => buildRiverField(river))
    .filter(Boolean);
}

function buildRiverField(river) {
  const points = (river?.points || []).map(normalizePoint).filter(Boolean);
  if (points.length < 2) {
    return null;
  }

  const width = getEffectiveRiverWidth(river.width);
  const depth = getRiverChannelDepth(width);
  const vectors = points.map((point) => new THREE.Vector3(point.x, 0, point.z));
  const curve = createRiverPath(vectors);
  const length = curve.getLength();
  const samples = Math.max(24, Math.round(length / 6));
  const sampledPoints = curve.getSpacedPoints(samples);
  const segments = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const point of sampledPoints) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }

  for (let i = 0; i < sampledPoints.length - 1; i += 1) {
    const start = sampledPoints[i];
    const end = sampledPoints[i + 1];
    if (start.distanceToSquared(end) < 1e-6) {
      continue;
    }
    segments.push({ start, end });
  }

  return {
    width,
    halfWidth: width * 0.5,
    depth,
    bounds: {
      minX: minX - width,
      maxX: maxX + width,
      minZ: minZ - width,
      maxZ: maxZ + width
    },
    segments
  };
}

function sampleBakedGroundHeight(x, z, baseY, roadSurfaceSegments, riverFields, coastlineFields) {
  const riverTerrainY = sampleRiverCarvedGroundHeight(x, z, baseY, riverFields);
  const terrainY = sampleCoastlineBeachHeight(x, z, riverTerrainY, coastlineFields);
  let stampedY = terrainY;

  for (const segment of roadSurfaceSegments) {
    if (!boundsContainsPoint(segment.bounds, x, z)) {
      continue;
    }

    const distance = pointToSegmentDistance(x, z, segment.start, segment.end);
    if (distance >= segment.shoulderHalfWidth) {
      continue;
    }

    let blend = 1;
    if (distance > segment.roadHalfWidth) {
      const shoulderSpan = Math.max(1e-3, segment.shoulderHalfWidth - segment.roadHalfWidth);
      const t = clamp(1 - (distance - segment.roadHalfWidth) / shoulderSpan, 0, 1);
      blend = t * t * (3 - 2 * t);
    }

    const surfaceY = THREE.MathUtils.lerp(terrainY, ROAD_SURFACE_Y, blend);
    stampedY = Math.max(stampedY, surfaceY);
  }

  return stampedY;
}

function sampleRiverCarvedGroundHeight(x, z, baseY, riverFields) {
  let carveDepth = 0;

  for (const river of riverFields) {
    if (!boundsContainsPoint(river.bounds, x, z)) {
      continue;
    }

    const distance = distanceToRiverSegments(x, z, river.segments);
    if (distance >= river.halfWidth) {
      continue;
    }

    const normalized = clamp(distance / Math.max(1e-6, river.halfWidth), 0, 1);
    const profile = Math.sqrt(Math.max(0, 1 - normalized * normalized));
    carveDepth = Math.max(carveDepth, river.depth * profile);
  }

  return baseY - carveDepth;
}

function signedDistanceToCoastlineSegments(x, z, segments) {
  let minDist = Infinity;
  let sign = 1;

  for (const { start, end } of segments) {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lenSq = dx * dx + dz * dz;
    const t = lenSq > 1e-12 ? clamp(((x - start.x) * dx + (z - start.z) * dz) / lenSq, 0, 1) : 0;
    const cx = start.x + t * dx;
    const cz = start.z + t * dz;
    const dist = Math.hypot(x - cx, z - cz);
    if (dist < minDist) {
      minDist = dist;
      // 2D cross product: positive = left side of segment direction
      sign = dx * (z - start.z) - dz * (x - start.x) > 0 ? 1 : -1;
    }
  }

  return minDist * sign;
}

function sampleCoastlineBeachHeight(x, z, baseY, coastlineFields) {
  if (!coastlineFields || coastlineFields.length === 0) return baseY;

  let bestAbsDist = Infinity;
  let bestLandDist = null;
  let activeBeachWidth = 0;

  for (const coastline of coastlineFields) {
    // Expand bounds to cover full ocean side (world-scale padding)
    const expanded = {
      minX: coastline.bounds.minX - 10000,
      maxX: coastline.bounds.maxX + 10000,
      minZ: coastline.bounds.minZ - 10000,
      maxZ: coastline.bounds.maxZ + 10000
    };
    if (!boundsContainsPoint(expanded, x, z)) continue;

    const signedDist = signedDistanceToCoastlineSegments(x, z, coastline.segments);
    const absDist = Math.abs(signedDist);
    const landDist = signedDist * coastline.landSign; // positive = land side

    if (absDist < bestAbsDist) {
      bestAbsDist = absDist;
      bestLandDist = landDist;
      activeBeachWidth = coastline.beachWidth;
    }
  }

  if (bestLandDist === null) return baseY;

  if (bestLandDist <= 0) {
    // Ocean side — flatten terrain below OCEAN_Y so ocean plane is always visible
    return Math.min(baseY, OCEAN_Y - 0.1);
  }

  if (bestLandDist >= activeBeachWidth) return baseY;

  // Land side — beach slope from OCEAN_Y at shoreline up to baseY at beachWidth
  const normalized = clamp(bestLandDist / Math.max(1e-6, activeBeachWidth), 0, 1);
  const smooth = normalized * normalized * (3 - 2 * normalized);
  const beachY = THREE.MathUtils.lerp(OCEAN_Y, baseY, smooth);
  return Math.min(baseY, beachY);
}

function buildCoastlineFields(coastlines, spawn) {
  return (coastlines || [])
    .map((coastline) => buildCoastlineField(coastline, spawn))
    .filter(Boolean);
}

function buildCoastlineField(coastline, spawn) {
  const points = (coastline?.points || []).map(normalizePoint).filter(Boolean);
  if (points.length < 2) return null;

  const beachWidth = Math.max(10, Number(coastline.beachWidth) || 60);
  const vectors = points.map((point) => new THREE.Vector3(point.x, 0, point.z));
  const curve = createRiverPath(vectors);
  const length = curve.getLength();
  const samples = Math.max(24, Math.round(length / 8));
  const sampledPoints = curve.getSpacedPoints(samples);
  const segments = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

  for (const point of sampledPoints) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }

  for (let i = 0; i < sampledPoints.length - 1; i += 1) {
    const start = sampledPoints[i];
    const end = sampledPoints[i + 1];
    if (start.distanceToSquared(end) < 1e-6) continue;
    segments.push({ start, end });
  }

  // Use spawn point to determine which side is land
  const spawnX = spawn?.x || 0;
  const spawnZ = spawn?.z || 0;
  const spawnSignedDist = signedDistanceToCoastlineSegments(spawnX, spawnZ, segments);
  const landSign = spawnSignedDist >= 0 ? 1 : -1;

  return {
    beachWidth,
    landSign,
    bounds: {
      minX: minX - beachWidth,
      maxX: maxX + beachWidth,
      minZ: minZ - beachWidth,
      maxZ: maxZ + beachWidth
    },
    segments
  };
}

function createOcean() {
  const geo = new THREE.PlaneGeometry(20000, 20000);
  geo.rotateX(-Math.PI / 2);
  const mat = MATERIALS.ocean.clone();
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = 2;
  mat.polygonOffsetUnits = 2;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = OCEAN_Y;
  mesh.receiveShadow = true;
  return mesh;
}

function createAllCoastlines(coastlines, coastlineFields) {
  const group = new THREE.Group();
  for (let i = 0; i < (coastlines || []).length; i += 1) {
    group.add(createCoastline(coastlines[i], coastlineFields[i]));
  }
  return group;
}

function createCoastline(coastline, coastlineField = null) {
  const group = new THREE.Group();
  const points = (coastline.points || []).map(normalizePoint).filter(Boolean);
  if (points.length < 2) return group;

  const field = coastlineField || buildCoastlineField(coastline);
  if (!field) return group;

  const vectors = points.map((point) => new THREE.Vector3(point.x, 0, point.z));
  const curve = createRiverPath(vectors);
  const length = curve.getLength();
  const samples = Math.max(10, Math.round(length / 8));

  // Wide ribbon covers the full ocean side — land side gets buried under rising terrain,
  // ocean side floats just above the ocean plane showing sand texture
  const beach = createTrackRibbon(curve, {
    width: field.beachWidth * 8,
    samples,
    y: OCEAN_Y + 0.04,
    uvScale: 0.018
  });
  beach.material = MATERIALS.beach.clone();
  beach.material.shadowSide = THREE.DoubleSide;
  beach.receiveShadow = true;
  group.add(beach);

  return group;
}

function boundsContainsPoint(bounds, x, z) {
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
}

function distanceToRiverSegments(x, z, segments) {
  let minDistance = Infinity;

  for (const segment of segments) {
    minDistance = Math.min(
      minDistance,
      pointToSegmentDistance(x, z, segment.start, segment.end)
    );
  }

  return minDistance;
}

function createTrackRibbon(curve, options) {
  const ribbonData = {
    positions: [],
    normals: [],
    uvs: [],
    indices: []
  };
  appendTrackRibbonSurface(curve, options, ribbonData);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(ribbonData.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(ribbonData.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(ribbonData.uvs, 2));
  geometry.setIndex(ribbonData.indices);

  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
}

function appendTrackRibbonSurface(curve, options, target) {
  const {
    width,
    samples,
    y,
    uvScale = 0,
    offset = 0,
    endExtension = 0,
    doubleSided = false
  } = options;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let distance = 0;
  let prevPoint = curve.getPointAt(0);
  
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).setY(0).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    
    if (i > 0) distance += point.distanceTo(prevPoint);
    prevPoint = point;

    if (i === 0 && endExtension > 0) {
      point.addScaledVector(tangent, -endExtension);
    } else if (i === samples && endExtension > 0) {
      point.addScaledVector(tangent, endExtension);
    }
    
    const center = point.clone().addScaledVector(side, offset);
    const left = center.clone().addScaledVector(side, width * 0.5);
    const right = center.clone().addScaledVector(side, -width * 0.5);
    left.y = y;
    right.y = y;
    
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    normals.push(0, 1, 0, 0, 1, 0);
    uvs.push(0, distance * uvScale, 1, distance * uvScale);
    
    if (i < samples) {
      const base = i * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      if (doubleSided) {
        indices.push(base + 1, base + 2, base, base + 3, base + 2, base + 1);
      }
    }
  }

  const vertexOffset = target.positions.length / 3;
  target.positions.push(...positions);
  target.normals.push(...normals);
  target.uvs.push(...uvs);
  for (const index of indices) {
    target.indices.push(index + vertexOffset);
  }
}

function createRoadPath(points) {
  const path = new THREE.CurvePath();
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    if (start.distanceToSquared(end) < 1e-6) {
      continue;
    }
    path.add(new THREE.LineCurve3(start.clone(), end.clone()));
  }
  return path;
}

function createRiverPath(points) {
  if (points.length >= 3) {
    return new THREE.CatmullRomCurve3(points.map((point) => point.clone()), false, 'centripetal');
  }
  return createRoadPath(points);
}

function applyRiverCutsToGround(mesh, rivers, options) {
  const { bounds, topY, slabDepth } = options;
  const activeRivers = getIntersectingRivers(rivers, bounds);
  if (!activeRivers.length) {
    return mesh;
  }

  let baseBrush = new Brush(mesh.geometry);
  baseBrush.updateMatrixWorld(true);

  for (const river of activeRivers) {
    const cutterBrush = createRiverCutterBrush(river, topY, slabDepth);
    if (!cutterBrush) {
      continue;
    }
    baseBrush = CSG_EVALUATOR.evaluate(baseBrush, cutterBrush, SUBTRACTION);
    baseBrush.updateMatrixWorld(true);
  }

  mesh.geometry.dispose();
  mesh.geometry = baseBrush.geometry;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  return mesh;
}

function getIntersectingRivers(rivers, bounds) {
  return (rivers || []).filter((river) => boundsOverlap(getRiverBounds(river), bounds));
}

function getRiverBounds(river) {
  const points = (river?.points || []).map(normalizePoint).filter(Boolean);
  const inset = Math.max(8, getEffectiveRiverWidth(river?.width) * 0.65);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }

  return {
    minX: minX - inset,
    maxX: maxX + inset,
    minZ: minZ - inset,
    maxZ: maxZ + inset
  };
}

function boundsOverlap(a, b) {
  return !(
    a.maxX < b.minX ||
    a.minX > b.maxX ||
    a.maxZ < b.minZ ||
    a.minZ > b.maxZ
  );
}

function createRiverCutterBrush(river, topY, slabDepth) {
  const points = (river?.points || []).map(normalizePoint).filter(Boolean);
  if (points.length < 2) {
    return null;
  }

  const width = getEffectiveRiverWidth(river.width);
  const depth = getRiverChannelDepth(width);
  const halfWidth = width * 0.5;
  const topLift = Math.max(1.2, slabDepth * 0.35);
  const vectors = points.map((point) => new THREE.Vector3(point.x, 0, point.z));
  const curve = createRiverPath(vectors);
  const shape = new THREE.Shape();

  shape.moveTo(-halfWidth, topY + topLift);
  shape.lineTo(-halfWidth, topY - depth);
  shape.lineTo(halfWidth, topY - depth);
  shape.lineTo(halfWidth, topY + topLift);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    steps: Math.max(16, Math.round(curve.getLength() / 2.5)),
    bevelEnabled: false,
    extrudePath: curve,
    curveSegments: 8
  });
  geometry.clearGroups();
  const brush = new Brush(geometry);
  brush.updateMatrixWorld(true);
  return brush;
}

function getRiverChannelDepth(width) {
  return clamp(width * 0.08, 0.6, 48);
}

function getEffectiveRiverWidth(width) {
  return clamp((Number(width) || 24) * RIVER_RUNTIME_WIDTH_SCALE, 8, 2000);
}

function getPolygonCenter(points) {
  let cx = 0, cz = 0;
  for (const p of points) {
    cx += p.x;
    cz += p.z;
  }
  return { x: cx / points.length, z: cz / points.length };
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].z;
    area -= points[j].x * points[i].z;
  }
  return area / 2;
}

function getPolygonBounds(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }

  return { minX, maxX, minZ, maxZ };
}

function pointInPolygon(x, z, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i].x;
    const zi = points[i].z;
    const xj = points[j].x;
    const zj = points[j].z;

    const intersects =
      zi > z !== zj > z &&
      x < ((xj - xi) * (z - zi)) / Math.max(1e-9, zj - zi) + xi;

    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToPolygonEdges(x, z, points) {
  let minDistance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    minDistance = Math.min(minDistance, pointToSegmentDistance(x, z, points[i], next));
  }
  return minDistance;
}

function pointToSegmentDistance(px, pz, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-6) {
    return Math.hypot(px - a.x, pz - a.z);
  }

  let t = ((px - a.x) * dx + (pz - a.z) * dz) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const sx = a.x + t * dx;
  const sz = a.z + t * dz;
  return Math.hypot(px - sx, pz - sz);
}

function buildRoadSegments(roads) {
  const segments = [];
  for (const road of roads || []) {
    const style = ROAD_KIND_STYLE[road.type] || ROAD_KIND_STYLE.street;
    const points = (road.points || []).map(normalizePoint).filter(Boolean);
    for (let i = 0; i < points.length - 1; i += 1) {
      const start = points[i];
      const end = points[i + 1];
      if (!start || !end) continue;
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-3) continue;
      const tangent = { x: dx / length, z: dz / length };
      const normal = { x: -tangent.z, z: tangent.x };
      segments.push({
        a: start,
        b: end,
        tangent,
        normal,
        length,
        clearance: style.roadWidth * 0.5 + style.sidewalkWidth + 4
      });
    }
  }
  return segments;
}

function createFrontagePlacements(points, style, roadSegments, minEdgeDistance) {
  const placements = [];
  for (const segment of roadSegments) {
    const sampleStep = Math.max(style.footprintMin + 4, Math.min(style.spacing, style.footprintMax + 8));
    for (let d = sampleStep * 0.6; d <= segment.length - sampleStep * 0.6; d += sampleStep) {
      const roadX = segment.a.x + segment.tangent.x * d;
      const roadZ = segment.a.z + segment.tangent.z * d;
      const footprintWidth = randomRange(style.footprintMin, style.footprintMax);
      const footprintDepth = randomRange(style.depthMin, style.depthMax);
      const halfWidth = footprintWidth * 0.5;
      const halfDepth = footprintDepth * 0.5;

      for (const sideSign of [1, -1]) {
        const normal = {
          x: segment.normal.x * sideSign,
          z: segment.normal.z * sideSign
        };
        const centerX = roadX + normal.x * (segment.clearance + halfDepth + 2.5);
        const centerZ = roadZ + normal.z * (segment.clearance + halfDepth + 2.5);
        const corners = createPlacementCorners(
          centerX,
          centerZ,
          halfWidth,
          halfDepth,
          segment.tangent,
          normal
        );

        if (!corners.every((corner) => pointInPolygon(corner.x, corner.z, points))) continue;
        if (distanceToPolygonEdges(centerX, centerZ, points) < minEdgeDistance * 0.75) continue;
        if (!footprintClearsRoads(centerX, centerZ, corners, roadSegments)) continue;
        if (placementCollides(placements, centerX, centerZ, footprintWidth, footprintDepth, 12)) continue;

        placements.push({
          x: centerX,
          z: centerZ,
          width: footprintWidth,
          depth: footprintDepth,
          quaternion: createPlacementQuaternion(segment.tangent, normal)
        });
        break;
      }
    }
  }
  return placements;
}

function createPlacementCorners(x, z, halfWidth, halfDepth, tangent, normal) {
  return [
    { x: x - tangent.x * halfWidth - normal.x * halfDepth, z: z - tangent.z * halfWidth - normal.z * halfDepth },
    { x: x + tangent.x * halfWidth - normal.x * halfDepth, z: z + tangent.z * halfWidth - normal.z * halfDepth },
    { x: x + tangent.x * halfWidth + normal.x * halfDepth, z: z + tangent.z * halfWidth + normal.z * halfDepth },
    { x: x - tangent.x * halfWidth + normal.x * halfDepth, z: z - tangent.z * halfWidth + normal.z * halfDepth }
  ];
}

function createPlacementQuaternion(tangent, normal) {
  const matrix = new THREE.Matrix4();
  matrix.makeBasis(
    new THREE.Vector3(tangent.x, 0, tangent.z),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(normal.x, 0, normal.z)
  );
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function getPlacementOrientation(x, z, roadSegments) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const segment of roadSegments) {
    const distance = pointToSegmentDistance(x, z, segment.a, segment.b);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = segment;
    }
  }

  if (!nearest) {
    return {
      tangent: { x: 1, z: 0 },
      normal: { x: 0, z: 1 }
    };
  }

  const midX = (nearest.a.x + nearest.b.x) * 0.5;
  const midZ = (nearest.a.z + nearest.b.z) * 0.5;
  const sign = (x - midX) * nearest.normal.x + (z - midZ) * nearest.normal.z >= 0 ? 1 : -1;
  return {
    tangent: nearest.tangent,
    normal: {
      x: nearest.normal.x * sign,
      z: nearest.normal.z * sign
    }
  };
}

function placementCollides(placements, x, z, width, depth, padding = 0) {
  const radius = Math.max(width, depth) * 0.5 + padding;
  for (const placement of placements) {
    const otherRadius = Math.max(placement.width, placement.depth) * 0.5 + padding;
    if (Math.hypot(x - placement.x, z - placement.z) < radius + otherRadius) {
      return true;
    }
  }
  return false;
}

function footprintClearsRoads(x, z, corners, roadSegments) {
  if (!roadSegments.length) {
    return true;
  }

  for (const segment of roadSegments) {
    if (pointToSegmentDistance(x, z, segment.a, segment.b) < segment.clearance) {
      return false;
    }
    for (const corner of corners) {
      if (pointToSegmentDistance(corner.x, corner.z, segment.a, segment.b) < segment.clearance) {
        return false;
      }
    }
  }

  return true;
}

function findFallbackPlacement(points, style, roadSegments, minEdgeDistance) {
  const bounds = getPolygonBounds(points);
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const step = Math.max(10, Math.min(18, Math.min(width, depth) * 0.18));
  let best = null;

  for (let x = bounds.minX + step; x <= bounds.maxX - step; x += step) {
    for (let z = bounds.minZ + step; z <= bounds.maxZ - step; z += step) {
      if (!pointInPolygon(x, z, points)) continue;
      const edgeDistance = distanceToPolygonEdges(x, z, points);
      if (edgeDistance < minEdgeDistance * 0.9) continue;

      const candidateWidth = THREE.MathUtils.clamp(
        Math.min(style.footprintMax, edgeDistance * 1.4, width * 0.2),
        style.footprintMin,
        style.footprintMax
      );
      const candidateDepth = THREE.MathUtils.clamp(
        Math.min(style.depthMax, edgeDistance * 1.4, depth * 0.2),
        style.depthMin,
        style.depthMax
      );
      const halfWidth = candidateWidth * 0.5;
      const halfDepth = candidateDepth * 0.5;
      const corners = [
        { x: x - halfWidth, z: z - halfDepth },
        { x: x + halfWidth, z: z - halfDepth },
        { x: x + halfWidth, z: z + halfDepth },
        { x: x - halfWidth, z: z + halfDepth }
      ];

      if (!corners.every((corner) => pointInPolygon(corner.x, corner.z, points))) continue;
      if (!footprintClearsRoads(x, z, corners, roadSegments)) continue;

      let roadDistance = Infinity;
      for (const segment of roadSegments) {
        roadDistance = Math.min(roadDistance, pointToSegmentDistance(x, z, segment.a, segment.b) - segment.clearance);
      }
      const score = edgeDistance + roadDistance * 1.5;
      if (!best || score > best.score) {
        const orientation = getPlacementOrientation(x, z, roadSegments);
        best = {
          x,
          z,
          width: candidateWidth,
          depth: candidateDepth,
          quaternion: createPlacementQuaternion(orientation.tangent, orientation.normal),
          score
        };
      }
    }
  }

  if (best) {
    return best;
  }

  const center = getPolygonCenter(points);
  const fallbackWidth = THREE.MathUtils.clamp(width * 0.18, style.footprintMin, style.footprintMax);
  const fallbackDepth = THREE.MathUtils.clamp(depth * 0.18, style.depthMin, style.depthMax);
  const halfWidth = fallbackWidth * 0.5;
  const halfDepth = fallbackDepth * 0.5;
  const corners = [
    { x: center.x - halfWidth, z: center.z - halfDepth },
    { x: center.x + halfWidth, z: center.z - halfDepth },
    { x: center.x + halfWidth, z: center.z + halfDepth },
    { x: center.x - halfWidth, z: center.z + halfDepth }
  ];

  if (
    corners.every((corner) => pointInPolygon(corner.x, corner.z, points)) &&
    distanceToPolygonEdges(center.x, center.z, points) >= minEdgeDistance * 0.85 &&
    footprintClearsRoads(center.x, center.z, corners, roadSegments)
  ) {
    return {
      x: center.x,
      z: center.z,
      width: fallbackWidth,
      depth: fallbackDepth,
      quaternion: createPlacementQuaternion({ x: 1, z: 0 }, { x: 0, z: 1 })
    };
  }

  return null;
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function normalizePoint(point) {
  if (!point) {
    return null;
  }

  if (Array.isArray(point) && point.length >= 2) {
    return { x: Number(point[0]), z: Number(point[1]) };
  }

  if (typeof point === 'object') {
    if (Number.isFinite(point.x) && Number.isFinite(point.z)) {
      return { x: Number(point.x), z: Number(point.z) };
    }
    if (Number.isFinite(point[0]) && Number.isFinite(point[1])) {
      return { x: Number(point[0]), z: Number(point[1]) };
    }
  }

  return null;
}

function normalizePlot(plot) {
  if (!plot || typeof plot !== 'object') {
    return null;
  }

  const x = Number(plot.x);
  const z = Number(plot.z);
  const width = Number(plot.width);
  const depth = Number(plot.depth);
  const angle = Number(plot.angle || 0);

  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(width) || !Number.isFinite(depth)) {
    return null;
  }

  return {
    x,
    z,
    width,
    depth,
    angle
  };
}

function pickWeightedEntry(entries, rng) {
  const total = entries.reduce((sum, entry) => sum + (entry.weight || 1), 0);
  let cursor = rng() * total;
  for (const entry of entries) {
    cursor -= entry.weight || 1;
    if (cursor <= 0) {
      return entry;
    }
  }
  return entries[entries.length - 1];
}

function sampleRange(range, rng) {
  return THREE.MathUtils.lerp(range[0], range[1], rng());
}

function normalizeRange(value, fallback) {
  if (Array.isArray(value) && value.length >= 2) {
    return [Number(value[0]), Number(value[1])];
  }
  if (typeof value === 'number') {
    return [value, value];
  }
  return fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const CLOUD_PUFF_GEO = new THREE.IcosahedronGeometry(1, 2);
const CLOUD_MAT = new THREE.MeshLambertMaterial({
  color: '#f0eee8',
  transparent: true,
  opacity: 0.82,
  depthWrite: false
});

function createClouds(bounds) {
  const group = new THREE.Group();
  const rng = createSeededRandom(0xc10045);
  const mapW = (bounds.maxX - bounds.minX) || 400;
  const mapD = (bounds.maxZ - bounds.minZ) || 400;
  const cx = (bounds.maxX + bounds.minX) * 0.5;
  const cz = (bounds.maxZ + bounds.minZ) * 0.5;

  for (let i = 0; i < 28; i++) {
    const cloud = new THREE.Group();
    const puffs = 4 + Math.floor(rng() * 5);
    const spread = 28 + rng() * 55;
    const tall = 10 + rng() * 18;

    for (let p = 0; p < puffs; p++) {
      const mesh = new THREE.Mesh(CLOUD_PUFF_GEO, CLOUD_MAT);
      mesh.scale.set(
        spread * (0.35 + rng() * 0.65),
        tall * (0.5 + rng() * 0.5),
        spread * (0.3 + rng() * 0.5)
      );
      mesh.position.set(
        (rng() - 0.5) * spread * 1.4,
        (rng() - 0.5) * tall * 0.5,
        (rng() - 0.5) * spread * 0.7
      );
      cloud.add(mesh);
    }

    cloud.position.set(
      cx + (rng() - 0.5) * mapW * 1.6,
      130 + rng() * 120,
      cz + (rng() - 0.5) * mapD * 1.6
    );
    group.add(cloud);
  }

  return group;
}

function createSeededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function hashZonePlot(zoneId, plotIndex) {
  let value = 2166136261;
  const source = `${zoneId}:${plotIndex}`;
  for (let i = 0; i < source.length; i += 1) {
    value ^= source.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function quaternionToYaw(quaternion) {
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
  return euler.y;
}

function createProceduralBuildingFromEntry(entry, frontage, depth, rng, options = {}) {
  const { exactFootprint = false } = options;
  const group = new THREE.Group();
  group.userData.stageShadowCaster = true;
  const materials = createPaletteMaterials(entry.palette, entry.textures);

  for (const piece of entry.pieces) {
    const mesh = new THREE.Mesh(
      getBoxGeometry(piece.size),
      materials[piece.material || 'body'] || materials.body
    );
    mesh.position.set(piece.offset[0], piece.offset[1], piece.offset[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  addBuildingFeatures(group, entry, materials);
  if (entry.roof) {
    group.add(createRoofMesh(entry.roof, group, materials));
  }

  const bounds = new THREE.Box3().setFromObject(group);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const targetWidth = exactFootprint
    ? frontage
    : frontage * THREE.MathUtils.lerp(0.76, 0.9, rng());
  const targetDepth = exactFootprint
    ? depth
    : depth * THREE.MathUtils.lerp(0.64, 0.84, rng());
  const scaleX = size.x > 0 ? targetWidth / size.x : 1;
  const scaleZ = size.z > 0 ? targetDepth / size.z : 1;
  const scaleY = THREE.MathUtils.lerp(0.95, 1.12, rng());
  group.scale.set(scaleX, scaleY, scaleZ);
  group.position.sub(new THREE.Vector3(center.x * scaleX, bounds.min.y * scaleY, center.z * scaleZ));
  return group;
}

function createBuildingFromEntry(entry, frontage, depth, rng, options = {}, dependencies = {}) {
  const { gltfLoader, buildingAssetMode = BUILDING_ASSET_MODE_FALLBACK } = dependencies;
  const procedural = createProceduralBuildingFromEntry(entry, frontage, depth, rng, options);

  if (!gltfLoader) {
    return buildingAssetMode === BUILDING_ASSET_MODE_GLB_ONLY ? new THREE.Group() : procedural;
  }

  const lod = new THREE.LOD();
  lod.userData.stageShadowCaster = true;
  if (buildingAssetMode !== BUILDING_ASSET_MODE_GLB_ONLY) {
    lod.addLevel(procedural, BUILDING_LOD_DISTANCES.lod0);
  }

  void attachCatalogLod1(entry, lod, frontage, depth, rng, options, gltfLoader);
  return lod;
}

async function attachCatalogLod1(entry, lod, frontage, depth, rng, options, gltfLoader) {
  if (!await catalogEntryHasGlb(entry)) {
    return;
  }

  const glbRoot = await loadCatalogGlbInstance(entry, gltfLoader);
  if (!glbRoot) {
    return;
  }

  prepareCatalogModelInstance(glbRoot, { stageShadowCaster: true });
  fitCatalogModelToFootprint(glbRoot, frontage, depth, rng, options);
  lod.addLevel(glbRoot, BUILDING_LOD_DISTANCES.lod1);
}

function addBuildingFeatures(group, entry, materials) {
  if (entry.features?.porch) {
    const porch = entry.features.porch;
    const mesh = new THREE.Mesh(
      getBoxGeometry([porch.width, porch.height || 0.4, porch.depth]),
      materials[porch.material || 'accent'] || materials.accent
    );
    mesh.position.set(0, (porch.height || 0.4) * 0.5, porch.depth * 0.5 + 0.4);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (entry.features?.awning) {
    const awning = entry.features.awning;
    const mesh = new THREE.Mesh(
      getBoxGeometry([awning.width, awning.height || 0.22, awning.depth]),
      materials[awning.material || 'accent'] || materials.accent
    );
    mesh.position.set(0, awning.y || 3.4, awning.depth * 0.5 + 0.2);
    mesh.castShadow = true;
    group.add(mesh);
  }

  if (entry.features?.signBand) {
    const band = entry.features.signBand;
    const mesh = new THREE.Mesh(
      getBoxGeometry([band.width, band.height || 0.55, band.depth || 0.25]),
      materials[band.material || 'accent'] || materials.accent
    );
    mesh.position.set(0, band.y || 3.1, band.z || 5.4);
    group.add(mesh);
  }
}

function createRoofMesh(roof, buildingGroup, materials) {
  const bounds = new THREE.Box3().setFromObject(buildingGroup);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());

  if (roof.type === 'gable') {
    const geometry = getGableRoofGeometry(
      size.x + (roof.overhang || 0.6) * 2,
      size.z + (roof.overhang || 0.6) * 2,
      roof.height || 1.8
    );
    const mesh = new THREE.Mesh(geometry, materials[roof.material || 'roof'] || materials.roof);
    mesh.position.set(center.x, bounds.max.y + (roof.height || 1.8) * 0.5 - 0.05, center.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  const flatHeight = roof.height || 0.35;
  const inset = roof.inset || 0.45;
  const mesh = new THREE.Mesh(
    getBoxGeometry([Math.max(1, size.x - inset * 2), flatHeight, Math.max(1, size.z - inset * 2)]),
    materials[roof.material || 'roof'] || materials.roof
  );
  mesh.position.set(center.x, bounds.max.y + flatHeight * 0.5, center.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createPaletteMaterials(palette, textures = {}) {
  const result = {};
  for (const [key, color] of Object.entries(palette)) {
    const textureName = textures[key];
    const materialKey = `${key}|${color}|${textureName || ''}`;
    if (!PALETTE_MATERIAL_CACHE.has(materialKey)) {
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: key === 'glass' ? 0.24 : 0.9,
        metalness: key === 'glass' ? 0.12 : 0.03
      });
      if (textureName) {
        material.map = loadTexture(textureName);
      }
      material.userData.shared = true;
      PALETTE_MATERIAL_CACHE.set(materialKey, material);
    }
    result[key] = PALETTE_MATERIAL_CACHE.get(materialKey);
  }
  return result;
}

function getBoxGeometry(size) {
  const key = size.join(':');
  if (!BOX_GEOMETRY_CACHE.has(key)) {
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    geometry.userData.shared = true;
    BOX_GEOMETRY_CACHE.set(key, geometry);
  }
  return BOX_GEOMETRY_CACHE.get(key);
}

function getGableRoofGeometry(width, depth, height) {
  const key = `${width}:${depth}:${height}`;
  if (!GABLE_ROOF_GEOMETRY_CACHE.has(key)) {
    const halfWidth = width * 0.5;
    const halfDepth = depth * 0.5;
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      -halfWidth, 0, -halfDepth,
      halfWidth, 0, -halfDepth,
      0, height, -halfDepth,

      -halfWidth, 0, halfDepth,
      0, height, halfDepth,
      halfWidth, 0, halfDepth,

      -halfWidth, 0, -halfDepth,
      0, height, -halfDepth,
      0, height, halfDepth,
      -halfWidth, 0, halfDepth,

      halfWidth, 0, -halfDepth,
      halfWidth, 0, halfDepth,
      0, height, halfDepth,
      0, height, -halfDepth,

      -halfWidth, 0, -halfDepth,
      -halfWidth, 0, halfDepth,
      halfWidth, 0, halfDepth,
      halfWidth, 0, -halfDepth
    ]);
    const indices = [
      0, 1, 2,
      3, 4, 5,
      6, 7, 8,
      6, 8, 9,
      10, 11, 12,
      10, 12, 13,
      14, 15, 16,
      14, 16, 17
    ];
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.userData.shared = true;
    GABLE_ROOF_GEOMETRY_CACHE.set(key, geometry);
  }
  return GABLE_ROOF_GEOMETRY_CACHE.get(key);
}

function getPlaneGeometry(width, height) {
  const key = `${width}:${height}`;
  if (!PLANE_GEOMETRY_CACHE.has(key)) {
    PLANE_GEOMETRY_CACHE.set(key, markSharedGeometry(new THREE.PlaneGeometry(width, height)));
  }
  return PLANE_GEOMETRY_CACHE.get(key);
}

function markSharedGeometry(geometry) {
  geometry.userData.shared = true;
  return geometry;
}
