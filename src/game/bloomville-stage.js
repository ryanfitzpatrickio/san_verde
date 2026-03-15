import * as THREE from 'three';
import { createBloomvilleGridNavigation } from './autopilot.js';
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
import { buildBloomvilleGridAgentNavigation } from './navigation-network.js';
import { resolveModelUrl } from '../assets/asset-base-url.js';

// Bloomville is an endless procedural city driven by JSON building packs.
// Drop new files into ./bloomville/catalogs/*.json and they will be picked up automatically.
const BLOOMVILLE_CATALOG_MODULES = import.meta.glob('./bloomville/catalogs/*.json', {
  eager: true,
  import: 'default'
});

const IMAGE_LOADER = new THREE.ImageLoader();
const TEXTURE_CACHE = new Map();

function loadTexture(name) {
  if (TEXTURE_CACHE.has(name)) {
    return TEXTURE_CACHE.get(name);
  }
  const texture = new THREE.Texture();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  IMAGE_LOADER.load(
    resolveModelUrl(`/textures/${name}.png`),
    (image) => { texture.image = image; texture.needsUpdate = true; },
    undefined,
    () => console.warn(`Texture not found: /textures/${name}.png`)
  );
  TEXTURE_CACHE.set(name, texture);
  return texture;
}


// Preload commonly used textures
const COMMON_TEXTURES = [
  'grass_green', 'grass_light', 'grass_dark', 'grass_dry',
  'asphalt', 'concrete_gray', 'concrete_light', 'concrete_dark',
  'siding_beige', 'siding_white', 'siding_gray', 'siding_tan',
  'stucco_white', 'stucco_cream', 'stucco_tan',
  'brick_red', 'brick_brown', 'brick_tan',
  'roof_shingles_brown', 'roof_shingles_gray', 'roof_shingles_black',
  'glass_blue', 'glass_gray', 'glass_clear',
  'metal_panel', 'metal_corrugated', 'metal_corrugated_rust',
  'wood_cedar', 'wood_pine',
  'stone_fieldstone', 'stone_limestone',
  'storefront_glass', 'storefront_aluminum',
];
COMMON_TEXTURES.forEach(loadTexture);

const CHUNK_SIZE = 180;
const ACTIVE_CHUNK_RADIUS = 1;
const GC_CHUNK_RADIUS = 2;
const ROAD_CLEARANCE = 18;
const INTERSECTION_CLEARANCE = 20;
const LIGHT_CLEARANCE = 22;
const CROSSWALK_DEPTH = 8.4;
const COLLISION_GROUND_TOP_Y = -0.24;
const COLLISION_GROUND_HEIGHT = 0.24;
const COLLISION_ROAD_TOP_Y = 0.022;
const COLLISION_ROAD_HEIGHT = 0.18;
const COLLISION_CURB_TOP_Y = 0.086;
const COLLISION_CURB_HEIGHT = 0.12;
const COLLISION_CURB_WIDTH = 0.46;
const COLLISION_MEDIAN_TOP_Y = 0.132;
const COLLISION_MEDIAN_HEIGHT = 0.18;

const MATERIALS = {
  ground: new THREE.MeshStandardMaterial({ color: '#667f56', roughness: 0.99, metalness: 0.01, map: loadTexture('grass_green') }),
  road: new THREE.MeshStandardMaterial({ color: '#35393f', roughness: 0.98, metalness: 0.02, map: loadTexture('asphalt') }),
  roadWide: new THREE.MeshStandardMaterial({ color: '#2f3439', roughness: 0.98, metalness: 0.02, map: loadTexture('asphalt') }),
  sidewalk: new THREE.MeshStandardMaterial({ color: '#8a8e91', roughness: 0.95, metalness: 0.02, map: loadTexture('concrete_gray') }),
  lane: new THREE.MeshBasicMaterial({ color: '#efe2a8', transparent: true, opacity: 0.82 }),
  crosswalk: new THREE.MeshBasicMaterial({ color: '#eee9d8', transparent: true, opacity: 0.9 }),
  median: new THREE.MeshStandardMaterial({ color: '#587548', roughness: 0.99, metalness: 0.01, map: loadTexture('grass_green') }),
  plaza: new THREE.MeshStandardMaterial({ color: '#a19788', roughness: 0.92, metalness: 0.02, map: loadTexture('concrete_light') }),
  lampPole: new THREE.MeshStandardMaterial({ color: '#c7c4bd', roughness: 0.7, metalness: 0.22 }),
  lampHead: new THREE.MeshBasicMaterial({ color: '#ffd6a3' }),
  trunk: new THREE.MeshStandardMaterial({ color: '#5c493d', roughness: 0.92, metalness: 0.02 }),
  leaf: new THREE.MeshStandardMaterial({ color: '#5c7448', roughness: 0.98, metalness: 0.01 })
};

const COLLISION_MATERIALS = {
  ground: new THREE.MeshStandardMaterial({ color: '#607751', roughness: 1, metalness: 0 }),
  road: new THREE.MeshStandardMaterial({ color: '#2f3439', roughness: 1, metalness: 0 }),
  curb: new THREE.MeshStandardMaterial({ color: '#8c8f93', roughness: 1, metalness: 0 }),
  median: new THREE.MeshStandardMaterial({ color: '#5b744c', roughness: 1, metalness: 0 })
};

for (const material of Object.values(MATERIALS)) {
  material.userData.shared = true;
}
for (const material of Object.values(COLLISION_MATERIALS)) {
  material.userData.shared = true;
}

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
  park: { ground: '#648253', treeDensity: 0.85 }
};

const DISTRICT_LOT_TUNING = {
  downtown: { minFrontage: 24, maxFrontage: 56, depthFactor: 0.92, minGap: 4, maxGap: 8, edgeInset: 6 },
  residential_low: { minFrontage: 14, maxFrontage: 36, depthFactor: 0.8, minGap: 5, maxGap: 9, edgeInset: 7 },
  residential_mid: { minFrontage: 12, maxFrontage: 30, depthFactor: 0.76, minGap: 4, maxGap: 8, edgeInset: 6 },
  residential_high: { minFrontage: 18, maxFrontage: 48, depthFactor: 0.88, minGap: 6, maxGap: 10, edgeInset: 8 },
  mixed_main: { minFrontage: 10, maxFrontage: 28, depthFactor: 0.74, minGap: 3.2, maxGap: 7.4, edgeInset: 6 },
  civic: { minFrontage: 18, maxFrontage: 56, depthFactor: 0.9, minGap: 6, maxGap: 11, edgeInset: 8 },
  commercial_general: { minFrontage: 14, maxFrontage: 40, depthFactor: 0.84, minGap: 4, maxGap: 8, edgeInset: 7 },
  commercial_regional: { minFrontage: 18, maxFrontage: 60, depthFactor: 0.92, minGap: 6, maxGap: 12, edgeInset: 9 },
  industrial_light: { minFrontage: 16, maxFrontage: 46, depthFactor: 0.88, minGap: 5, maxGap: 10, edgeInset: 8 },
  industrial_heavy: { minFrontage: 20, maxFrontage: 68, depthFactor: 0.95, minGap: 7, maxGap: 14, edgeInset: 10 }
};

const ROAD_KIND_STYLE = {
  boulevard: {
    roadWidth: 28,
    sidewalkWidth: 7,
    medianWidth: 5,
    laneOffsets: [-7.4, 7.4],
    laneMarkLength: 7
  },
  avenue: {
    roadWidth: 22,
    sidewalkWidth: 6,
    medianWidth: 0,
    laneOffsets: [0],
    laneMarkLength: 5.8
  },
  street: {
    roadWidth: 18,
    sidewalkWidth: 5.2,
    medianWidth: 0,
    laneOffsets: [],
    laneMarkLength: 0
  }
};

const BOX_GEOMETRY_CACHE = new Map();
const GABLE_ROOF_GEOMETRY_CACHE = new Map();
const PLANE_GEOMETRY_CACHE = new Map();
const PALETTE_MATERIAL_CACHE = new Map();
const INSTANCE_MATRIX = new THREE.Matrix4();
const INSTANCE_POSITION = new THREE.Vector3();
const INSTANCE_SCALE = new THREE.Vector3();
const INSTANCE_QUATERNION = new THREE.Quaternion();
const DOWNWARD_PLANE_QUATERNION = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const IDENTITY_QUATERNION = new THREE.Quaternion();

const STREETLIGHT_GEOMETRIES = {
  stem: markSharedGeometry(new THREE.CylinderGeometry(0.08, 0.11, 6.2, 6)),
  arm: markSharedGeometry(new THREE.BoxGeometry(1.4, 0.08, 0.08)),
  head: markSharedGeometry(new THREE.SphereGeometry(0.15, 8, 6))
};

const TREE_GEOMETRIES = {
  trunk: markSharedGeometry(new THREE.CylinderGeometry(0.8, 1, 1, 8)),
  crown: markSharedGeometry(new THREE.SphereGeometry(1, 10, 8))
};

export async function createBloomvilleStage({ gltfLoader, loadingManager, buildingAssetMode = BUILDING_ASSET_MODE_FALLBACK } = {}) {
  const catalogs = loadCatalogEntries();
  const activeCatalogs = buildingAssetMode === BUILDING_ASSET_MODE_GLB_ONLY
    ? await filterCatalogEntriesForGlb(catalogs)
    : catalogs;
  const catalogDistricts = collectCatalogDistricts(activeCatalogs);
  const group = new THREE.Group();
  const chunkRoot = new THREE.Group();
  const collisionGroup = new THREE.Group();
  const collisionChunkRoot = new THREE.Group();
  group.add(chunkRoot);
  collisionGroup.add(collisionChunkRoot);

  const stage = {
    id: 'bloomville',
    buildingAssetMode,
    group,
    collisionGroup,
    startPosition: new THREE.Vector3(0, 0, CHUNK_SIZE * 0.38),
    startYaw: Math.PI,
    driveBounds: Number.POSITIVE_INFINITY,
    navigation: createBloomvilleGridNavigation(CHUNK_SIZE),
    agentNavigation: null,
    agentNavigationRevision: 0,
    overviewBounds: createOverviewBounds([-2, 2], [-2, 2]),
    catalogDistricts,
    chunkRoot,
    collisionChunkRoot,
    chunks: new Map(),
    activeChunkX: null,
    activeChunkZ: null,
    physicsRevision: 0,
    update(vehiclePosition = new THREE.Vector3()) {
      const chunkX = getChunkAnchorIndex(vehiclePosition.x);
      const chunkZ = getChunkAnchorIndex(vehiclePosition.z);
      if (chunkX === this.activeChunkX && chunkZ === this.activeChunkZ && this.chunks.size) {
        return;
      }

      this.activeChunkX = chunkX;
      this.activeChunkZ = chunkZ;
      const addedChunks = ensureChunkNeighborhood(this, activeCatalogs, catalogDistricts, chunkX, chunkZ, {
        gltfLoader,
        buildingAssetMode
      });
      const removedChunks = collectDistantChunks(this, chunkX, chunkZ);
      this.overviewBounds = createOverviewBounds(
        [chunkX - ACTIVE_CHUNK_RADIUS, chunkX + ACTIVE_CHUNK_RADIUS],
        [chunkZ - ACTIVE_CHUNK_RADIUS, chunkZ + ACTIVE_CHUNK_RADIUS]
      );
      refreshBloomvilleAgentNavigation(this);
      if (addedChunks || removedChunks) {
        this.physicsRevision += 1;
      }
    }
  };

  refreshBloomvilleAgentNavigation(stage);
  stage.update(new THREE.Vector3(0, 0, 0));
  return stage;
}

function refreshBloomvilleAgentNavigation(stage) {
  stage.agentNavigation = buildBloomvilleGridAgentNavigation({
    chunkSize: CHUNK_SIZE,
    centerChunkX: stage.activeChunkX ?? 0,
    centerChunkZ: stage.activeChunkZ ?? 0,
    radius: GC_CHUNK_RADIUS,
    horizontalKindAt: pickHorizontalRoadKind,
    verticalKindAt: pickVerticalRoadKind,
    roadStyles: ROAD_KIND_STYLE
  });
  applyBloomvilleAgentSpawnPoints(stage);
  stage.agentNavigationRevision += 1;
}

function getChunkAnchorIndex(position) {
  // Shift streaming/physics refreshes to chunk midpoints instead of road seams.
  return Math.floor(position / CHUNK_SIZE + 0.5);
}

function ensureChunkNeighborhood(stage, catalogs, catalogDistricts, centerChunkX, centerChunkZ, dependencies = {}) {
  let changed = false;
  for (let chunkZ = centerChunkZ - ACTIVE_CHUNK_RADIUS; chunkZ <= centerChunkZ + ACTIVE_CHUNK_RADIUS; chunkZ += 1) {
    for (let chunkX = centerChunkX - ACTIVE_CHUNK_RADIUS; chunkX <= centerChunkX + ACTIVE_CHUNK_RADIUS; chunkX += 1) {
      const key = getChunkKey(chunkX, chunkZ);
      if (stage.chunks.has(key)) {
        continue;
      }

        const chunk = createBloomvilleChunk(chunkX, chunkZ, catalogs, catalogDistricts, dependencies);
      stage.chunks.set(key, chunk);
      stage.chunkRoot.add(chunk.group);
      stage.collisionChunkRoot.add(chunk.collisionGroup);
      changed = true;
    }
  }
  return changed;
}

function collectDistantChunks(stage, centerChunkX, centerChunkZ) {
  let changed = false;
  for (const [key, chunk] of stage.chunks.entries()) {
    const distanceX = Math.abs(chunk.chunkX - centerChunkX);
    const distanceZ = Math.abs(chunk.chunkZ - centerChunkZ);
    if (distanceX <= GC_CHUNK_RADIUS && distanceZ <= GC_CHUNK_RADIUS) {
      continue;
    }

    stage.chunkRoot.remove(chunk.group);
    stage.collisionChunkRoot.remove(chunk.collisionGroup);
    disposeChunk(chunk.group);
    disposeChunk(chunk.collisionGroup);
    stage.chunks.delete(key);
    changed = true;
  }
  return changed;
}

function createBloomvilleChunk(chunkX, chunkZ, catalogs, catalogDistricts, dependencies = {}) {
  const group = new THREE.Group();
  const collisionGroup = new THREE.Group();
  group.position.set(chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE);
  collisionGroup.position.copy(group.position);

  const rng = createSeededRandom(hash2D(chunkX, chunkZ));
  const district = pickChunkDistrict(chunkX, chunkZ, rng, catalogDistricts);
  const districtStyle = getDistrictStyle(district);
  const horizontalRoadKind = pickHorizontalRoadKind(chunkZ);
  const verticalRoadKind = pickVerticalRoadKind(chunkX);
  const horizontalRoad = createChunkRoad('horizontal', horizontalRoadKind);
  const verticalRoad = createChunkRoad('vertical', verticalRoadKind);

  group.add(createChunkGround(districtStyle.ground));
  group.add(createRoadShell(horizontalRoad));
  group.add(createRoadShell(verticalRoad));
  group.add(createIntersectionPatch(horizontalRoad, verticalRoad));
  group.add(createCrosswalkGroup(horizontalRoad, verticalRoad));
  group.add(createRoadMarkGroup(horizontalRoad, verticalRoad));
  group.add(createStreetLightGroup(horizontalRoad, verticalRoad));
  const parcelData = createChunkParcels(horizontalRoad, verticalRoad, district, catalogs, rng, dependencies);
  group.add(parcelData.group);
  group.add(createChunkTrees(horizontalRoad, verticalRoad, districtStyle.treeDensity, rng));

  collisionGroup.add(createCollisionGround());
  collisionGroup.add(createCollisionRoadShell(horizontalRoad));
  collisionGroup.add(createCollisionRoadShell(verticalRoad));
  collisionGroup.add(createCollisionIntersectionPatch(horizontalRoad, verticalRoad));

  return {
    chunkX,
    chunkZ,
    group,
    collisionGroup,
    vehicleSpawnPoints: parcelData.vehicleSpawnPoints,
    pedestrianSpawnPoints: parcelData.pedestrianSpawnPoints
  };
}

function createChunkGround(color) {
  const mesh = new THREE.Mesh(getPlaneGeometry(CHUNK_SIZE, CHUNK_SIZE), MATERIALS.ground.clone());
  mesh.material.color.set(color);
  if (mesh.material.map) {
    mesh.material.map = mesh.material.map.clone();
    mesh.material.map.repeat.set(CHUNK_SIZE / 16, CHUNK_SIZE / 16);
    mesh.material.map.needsUpdate = true;
  }
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.24;
  mesh.receiveShadow = true;
  return mesh;
}

function createCollisionGround() {
  return createCollisionBox(
    CHUNK_SIZE,
    CHUNK_SIZE,
    COLLISION_GROUND_TOP_Y,
    COLLISION_GROUND_HEIGHT,
    COLLISION_MATERIALS.ground
  );
}

function createChunkRoad(orientation, kind) {
  const style = ROAD_KIND_STYLE[kind];
  return {
    orientation,
    kind,
    ...style,
    halfRoad: style.roadWidth * 0.5,
    halfOuter: (style.roadWidth + style.sidewalkWidth * 2) * 0.5
  };
}

function createRoadShell(road) {
  const group = new THREE.Group();
  const shoulder = createOrientedPlane(CHUNK_SIZE, road.roadWidth + road.sidewalkWidth * 2, road.orientation, 0.004);
  shoulder.material = MATERIALS.sidewalk.clone();
  if (shoulder.material.map) {
    shoulder.material.map = shoulder.material.map.clone();
    shoulder.material.map.repeat.set(CHUNK_SIZE / 8, (road.roadWidth + road.sidewalkWidth * 2) / 8);
    shoulder.material.map.needsUpdate = true;
  }
  shoulder.receiveShadow = true;
  group.add(shoulder);

  const roadMaterial = road.kind === 'boulevard' ? MATERIALS.roadWide : MATERIALS.road;
  const asphalt = createOrientedPlane(CHUNK_SIZE, road.roadWidth, road.orientation, 0.018);
  asphalt.material = roadMaterial.clone();
  if (asphalt.material.map) {
    asphalt.material.map = asphalt.material.map.clone();
    asphalt.material.map.repeat.set(CHUNK_SIZE / 8, road.roadWidth / 8);
    asphalt.material.map.needsUpdate = true;
  }
  asphalt.receiveShadow = true;
  group.add(asphalt);

  if (road.medianWidth > 0) {
    const totalMedianLength = CHUNK_SIZE - 12;
    const intersectionGap = Math.max(road.roadWidth + 12, INTERSECTION_CLEARANCE * 2);
    const segmentLength = Math.max(0, (totalMedianLength - intersectionGap) * 0.5);

    if (segmentLength > 0.1) {
      for (const sign of [-1, 1]) {
        const median = createOrientedPlane(segmentLength, road.medianWidth, road.orientation, 0.026);
        median.material = MATERIALS.median.clone();
        if (median.material.map) {
          median.material.map = median.material.map.clone();
          median.material.map.repeat.set(segmentLength / 8, road.medianWidth / 8);
          median.material.map.needsUpdate = true;
        }
        const segmentOffset = sign * (intersectionGap * 0.5 + segmentLength * 0.5);
        if (road.orientation === 'horizontal') {
          median.position.x = segmentOffset;
        } else {
          median.position.z = segmentOffset;
        }
        median.receiveShadow = true;
        group.add(median);
      }
    }
  }

  return group;
}

function createCollisionRoadShell(road) {
  const group = new THREE.Group();
  group.add(
    createCollisionOrientedBox(
      CHUNK_SIZE,
      road.roadWidth,
      road.orientation,
      COLLISION_ROAD_TOP_Y,
      COLLISION_ROAD_HEIGHT,
      COLLISION_MATERIALS.road
    )
  );

  const curbHalfOffset = road.halfRoad + COLLISION_CURB_WIDTH * 0.5;
  const curbSegmentHalf = CHUNK_SIZE * 0.5 - INTERSECTION_CLEARANCE;
  const curbSegmentLength = Math.max(0, curbSegmentHalf * 2);
  if (curbSegmentLength > 0.1) {
    for (const lateral of [-curbHalfOffset, curbHalfOffset]) {
      for (const sign of [-1, 1]) {
        const curb = createCollisionOrientedBox(
          curbSegmentHalf - 1.2,
          COLLISION_CURB_WIDTH,
          road.orientation,
          COLLISION_CURB_TOP_Y,
          COLLISION_CURB_HEIGHT,
          COLLISION_MATERIALS.curb
        );
        const segmentOffset = sign * (INTERSECTION_CLEARANCE + (curbSegmentHalf - 1.2) * 0.5);
        if (road.orientation === 'horizontal') {
          curb.position.set(segmentOffset, curb.position.y, lateral);
        } else {
          curb.position.set(lateral, curb.position.y, segmentOffset);
        }
        group.add(curb);
      }
    }
  }

  if (road.medianWidth > 0) {
    const totalMedianLength = CHUNK_SIZE - 12;
    const intersectionGap = Math.max(road.roadWidth + 12, INTERSECTION_CLEARANCE * 2);
    const segmentLength = Math.max(0, (totalMedianLength - intersectionGap) * 0.5);
    if (segmentLength > 0.1) {
      for (const sign of [-1, 1]) {
        const median = createCollisionOrientedBox(
          segmentLength,
          road.medianWidth,
          road.orientation,
          COLLISION_MEDIAN_TOP_Y,
          COLLISION_MEDIAN_HEIGHT,
          COLLISION_MATERIALS.median
        );
        const segmentOffset = sign * (intersectionGap * 0.5 + segmentLength * 0.5);
        if (road.orientation === 'horizontal') {
          median.position.x = segmentOffset;
        } else {
          median.position.z = segmentOffset;
        }
        group.add(median);
      }
    }
  }

  return group;
}

function createIntersectionPatch(horizontalRoad, verticalRoad) {
  const width = Math.max(horizontalRoad.roadWidth, verticalRoad.roadWidth) + 2;
  const patch = new THREE.Mesh(
    getPlaneGeometry(width, width),
    horizontalRoad.kind === 'boulevard' || verticalRoad.kind === 'boulevard' ? MATERIALS.roadWide : MATERIALS.road
  );
  patch.rotation.x = -Math.PI / 2;
  patch.position.y = 0.022;
  patch.receiveShadow = true;
  return patch;
}

function createCollisionIntersectionPatch(horizontalRoad, verticalRoad) {
  const group = new THREE.Group();
  const width = Math.max(horizontalRoad.roadWidth, verticalRoad.roadWidth) + 2;
  group.add(
    createCollisionBox(
      width,
      width,
      COLLISION_ROAD_TOP_Y,
      COLLISION_ROAD_HEIGHT,
      COLLISION_MATERIALS.road
    )
  );
  return group;
}

function createCrosswalkGroup(horizontalRoad, verticalRoad) {
  const group = new THREE.Group();
  const intersectionHalfSpan = Math.max(horizontalRoad.roadWidth, verticalRoad.roadWidth) * 0.5 + 1;
  const offset = intersectionHalfSpan + CROSSWALK_DEPTH * 0.5;
  group.add(createCrosswalk('horizontal', 0, -offset, CROSSWALK_DEPTH, verticalRoad.roadWidth));
  group.add(createCrosswalk('horizontal', 0, offset, CROSSWALK_DEPTH, verticalRoad.roadWidth));
  group.add(createCrosswalk('vertical', -offset, 0, CROSSWALK_DEPTH, horizontalRoad.roadWidth));
  group.add(createCrosswalk('vertical', offset, 0, CROSSWALK_DEPTH, horizontalRoad.roadWidth));
  return group;
}

function createCrosswalk(orientation, x, z, stripeLength, span) {
  const group = new THREE.Group();
  const stripeWidth = 1.2;
  const stripeGap = 0.92;
  const stripeCount = Math.max(1, Math.floor((span + stripeGap) / (stripeWidth + stripeGap)));
  const usedSpan = stripeCount * stripeWidth + (stripeCount - 1) * stripeGap;
  const startOffset = -usedSpan * 0.5 + stripeWidth * 0.5;
  const stripeGeometry = getPlaneGeometry(
    orientation === 'horizontal' ? stripeWidth : stripeLength,
    orientation === 'horizontal' ? stripeLength : stripeWidth
  );
  for (let index = 0; index < stripeCount; index += 1) {
    const stripeOffset = startOffset + index * (stripeWidth + stripeGap);
    const stripe = new THREE.Mesh(stripeGeometry, MATERIALS.crosswalk);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(
      x + (orientation === 'horizontal' ? stripeOffset : 0),
      0.03,
      z + (orientation === 'horizontal' ? 0 : stripeOffset)
    );
    group.add(stripe);
  }
  return group;
}

function createRoadMarkGroup(horizontalRoad, verticalRoad) {
  const group = new THREE.Group();
  group.add(createSingleRoadMarks(horizontalRoad));
  group.add(createSingleRoadMarks(verticalRoad));
  return group;
}

function createSingleRoadMarks(road) {
  const group = new THREE.Group();
  if (!road.laneOffsets.length || !road.laneMarkLength) {
    return group;
  }

  const stride = road.laneMarkLength + 5.2;
  const half = CHUNK_SIZE * 0.5 - INTERSECTION_CLEARANCE;
  const placements = [];
  for (const laneOffset of road.laneOffsets) {
    for (let along = -half; along < half; along += stride) {
      if (Math.abs(along) < INTERSECTION_CLEARANCE) {
        continue;
      }
      placements.push({
        x: road.orientation === 'horizontal' ? along : laneOffset,
        z: road.orientation === 'horizontal' ? laneOffset : along
      });
    }
  }

  if (!placements.length) {
    return group;
  }

  const dashes = new THREE.InstancedMesh(
    getPlaneGeometry(
      road.orientation === 'horizontal' ? road.laneMarkLength : 0.28,
      road.orientation === 'horizontal' ? 0.28 : road.laneMarkLength
    ),
    MATERIALS.lane,
    placements.length
  );
  dashes.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    INSTANCE_POSITION.set(placement.x, 0.028, placement.z);
    INSTANCE_QUATERNION.copy(DOWNWARD_PLANE_QUATERNION);
    INSTANCE_SCALE.set(1, 1, 1);
    INSTANCE_MATRIX.compose(INSTANCE_POSITION, INSTANCE_QUATERNION, INSTANCE_SCALE);
    dashes.setMatrixAt(index, INSTANCE_MATRIX);
  }

  dashes.instanceMatrix.needsUpdate = true;
  group.add(dashes);
  return group;
}

function createStreetLightGroup(horizontalRoad, verticalRoad) {
  const group = new THREE.Group();
  group.add(createRoadStreetLights(horizontalRoad));
  group.add(createRoadStreetLights(verticalRoad));
  return group;
}

function createRoadStreetLights(road) {
  const sideOffset = road.halfRoad + road.sidewalkWidth - 1.1;
  const positions = road.kind === 'street' ? [sideOffset] : [sideOffset, -sideOffset];
  const segmentHalf = CHUNK_SIZE * 0.5 - LIGHT_CLEARANCE;
  const placements = [];
  for (let along = -segmentHalf; along <= segmentHalf; along += 42) {
    if (Math.abs(along) < LIGHT_CLEARANCE) {
      continue;
    }
    for (const lateral of positions) {
      placements.push({
        x: road.orientation === 'horizontal' ? along : lateral,
        z: road.orientation === 'horizontal' ? lateral : along
      });
    }
  }
  return createStreetLightInstances(placements);
}

function createStreetLightInstances(placements) {
  const group = new THREE.Group();
  group.userData.noCollision = true;
  group.userData.noSuspension = true;
  if (!placements.length) {
    return group;
  }

  const stems = new THREE.InstancedMesh(STREETLIGHT_GEOMETRIES.stem, MATERIALS.lampPole, placements.length);
  const arms = new THREE.InstancedMesh(STREETLIGHT_GEOMETRIES.arm, MATERIALS.lampPole, placements.length);
  const heads = new THREE.InstancedMesh(STREETLIGHT_GEOMETRIES.head, MATERIALS.lampHead, placements.length);
  stems.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  arms.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  heads.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  stems.castShadow = true;
  stems.receiveShadow = true;
  arms.castShadow = true;

  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];

    INSTANCE_QUATERNION.copy(IDENTITY_QUATERNION);

    INSTANCE_POSITION.set(placement.x, 3.1, placement.z);
    INSTANCE_SCALE.set(1, 1, 1);
    INSTANCE_MATRIX.compose(INSTANCE_POSITION, INSTANCE_QUATERNION, INSTANCE_SCALE);
    stems.setMatrixAt(index, INSTANCE_MATRIX);

    INSTANCE_POSITION.set(placement.x + 0.6, 5.95, placement.z);
    INSTANCE_MATRIX.compose(INSTANCE_POSITION, INSTANCE_QUATERNION, INSTANCE_SCALE);
    arms.setMatrixAt(index, INSTANCE_MATRIX);

    INSTANCE_POSITION.set(placement.x + 1.24, 5.9, placement.z);
    INSTANCE_MATRIX.compose(INSTANCE_POSITION, INSTANCE_QUATERNION, INSTANCE_SCALE);
    heads.setMatrixAt(index, INSTANCE_MATRIX);
  }

  stems.instanceMatrix.needsUpdate = true;
  arms.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  group.add(stems, arms, heads);
  return group;
}

function createChunkParcels(horizontalRoad, verticalRoad, district, catalogs, rng, dependencies = {}) {
  const group = new THREE.Group();
  const vehicleSpawnPoints = [];
  const pedestrianSpawnPoints = [];
  const parcels = createChunkQuadrants(horizontalRoad, verticalRoad);
  const districtCatalogs = catalogs.filter((entry) => entry.districts.includes(district));
  const fallbackCatalogs = catalogs.filter((entry) => entry.districts.includes('mixed_main'));
  const activeCatalogs = districtCatalogs.length ? districtCatalogs : fallbackCatalogs;

  for (const parcel of parcels) {
    if (district === 'park' && rng() < 0.75) {
      group.add(createPocketPark(parcel, rng));
      continue;
    }

    if (district === 'civic' && rng() < 0.28) {
      group.add(createChunkPlaza(parcel));
      continue;
    }

    populateParcel(group, parcel, district, activeCatalogs, rng, vehicleSpawnPoints, pedestrianSpawnPoints, dependencies);
  }

  return { group, vehicleSpawnPoints, pedestrianSpawnPoints };
}

function createChunkQuadrants(horizontalRoad, verticalRoad) {
  const left = -CHUNK_SIZE * 0.5 + ROAD_CLEARANCE;
  const right = CHUNK_SIZE * 0.5 - ROAD_CLEARANCE;
  const bottom = -CHUNK_SIZE * 0.5 + ROAD_CLEARANCE;
  const top = CHUNK_SIZE * 0.5 - ROAD_CLEARANCE;
  const innerX = verticalRoad.halfOuter + 5;
  const innerZ = horizontalRoad.halfOuter + 5;

  return [
    createParcel('northwest', left, -innerX, innerZ, top, ['south', 'east']),
    createParcel('northeast', innerX, right, innerZ, top, ['south', 'west']),
    createParcel('southwest', left, -innerX, bottom, -innerZ, ['north', 'east']),
    createParcel('southeast', innerX, right, bottom, -innerZ, ['north', 'west'])
  ];
}

function createParcel(id, minX, maxX, minZ, maxZ, frontageSides) {
  return {
    id,
    minX,
    maxX,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    centerX: (minX + maxX) * 0.5,
    centerZ: (minZ + maxZ) * 0.5,
    frontageSides
  };
}

function populateParcel(group, parcel, district, catalogs, rng, vehicleSpawnPoints, pedestrianSpawnPoints, dependencies = {}) {
  if (!catalogs.length) {
    return;
  }

  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(parcel.width, parcel.depth),
    new THREE.MeshStandardMaterial({
      color: '#706b58',
      roughness: 0.98,
      metalness: 0.01
    })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(parcel.centerX, -0.018, parcel.centerZ);
  pad.receiveShadow = true;
  group.add(pad);

  for (const side of parcel.frontageSides) {
    populateParcelEdge(group, parcel, side, district, catalogs, rng, vehicleSpawnPoints, pedestrianSpawnPoints, dependencies);
  }
}

function populateParcelEdge(group, parcel, side, district, catalogs, rng, vehicleSpawnPoints, pedestrianSpawnPoints, dependencies = {}) {
  const horizontal = side === 'north' || side === 'south';
  const span = horizontal ? parcel.width : parcel.depth;
  const lotTuning = getDistrictLotTuning(district);
  let cursor = -span * 0.5 + lotTuning.edgeInset;
  const maxSpan = span * 0.5 - lotTuning.edgeInset;

  while (cursor < maxSpan) {
    const entry = pickWeightedEntry(catalogs, rng);
    const frontage = clamp(sampleRange(entry.lot.frontage, rng), lotTuning.minFrontage, Math.min(lotTuning.maxFrontage, span - lotTuning.edgeInset * 2));
    const lotDepth = clamp(
      sampleRange(entry.lot.depth, rng),
      12,
      horizontal ? parcel.depth * lotTuning.depthFactor : parcel.width * lotTuning.depthFactor
    );
    const setback = clamp(sampleRange(entry.lot.setback, rng), 2, 9);
    const alongCenter = cursor + frontage * 0.5;
    if (alongCenter > maxSpan) {
      break;
    }

    const building = createBuildingFromEntry(entry, frontage, lotDepth, rng, {}, dependencies);
    const pose = resolveParcelBuildingPose(parcel, side, alongCenter, lotDepth, setback);
    building.position.set(pose.position.x, pose.position.y, pose.position.z);
    building.rotation.y = pose.yaw;
    group.add(building);

    const frontageData = resolveFrontageSpawnPose(parcel, side, alongCenter, lotDepth, setback);
    pedestrianSpawnPoints.push({
      id: `${parcel.id}:${side}:ped:${Math.round(cursor * 10)}`,
      position: frontageData.pedestrianPosition,
      yaw: frontageData.yaw,
      tangent: frontageData.tangent,
      tags: { district, parcel: parcel.id, side, kind: 'pedestrian_frontage' }
    });
    vehicleSpawnPoints.push({
      id: `${parcel.id}:${side}:veh:${Math.round(cursor * 10)}`,
      position: frontageData.vehiclePosition,
      yaw: frontageData.yaw,
      tangent: frontageData.tangent,
      tags: { district, parcel: parcel.id, side, kind: 'vehicle_frontage' }
    });

    cursor += frontage + THREE.MathUtils.lerp(lotTuning.minGap, lotTuning.maxGap, rng());
  }
}

function resolveParcelBuildingPose(parcel, side, alongCenter, lotDepth, setback) {
  if (side === 'north') {
    return {
      position: new THREE.Vector3(parcel.centerX + alongCenter, 0, parcel.maxZ - setback - lotDepth * 0.5),
      yaw: 0
    };
  }

  if (side === 'south') {
    return {
      position: new THREE.Vector3(parcel.centerX + alongCenter, 0, parcel.minZ + setback + lotDepth * 0.5),
      yaw: Math.PI
    };
  }

  if (side === 'east') {
    return {
      position: new THREE.Vector3(parcel.maxX - setback - lotDepth * 0.5, 0, parcel.centerZ + alongCenter),
      yaw: -Math.PI * 0.5
    };
  }

  return {
    position: new THREE.Vector3(parcel.minX + setback + lotDepth * 0.5, 0, parcel.centerZ + alongCenter),
    yaw: Math.PI * 0.5
  };
}

function resolveFrontageSpawnPose(parcel, side, alongCenter, lotDepth, setback) {
  const outward = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const pedestrianPosition = new THREE.Vector3();
  const vehiclePosition = new THREE.Vector3();
  let baseX = parcel.centerX;
  let baseZ = parcel.centerZ;
  let yaw = 0;

  if (side === 'north') {
    baseX += alongCenter;
    baseZ = parcel.maxZ - setback - lotDepth;
    outward.set(0, 0, 1);
    tangent.set(0, 0, 1);
    yaw = 0;
  } else if (side === 'south') {
    baseX += alongCenter;
    baseZ = parcel.minZ + setback + lotDepth;
    outward.set(0, 0, -1);
    tangent.set(0, 0, -1);
    yaw = Math.PI;
  } else if (side === 'east') {
    baseX = parcel.maxX - setback - lotDepth;
    baseZ += alongCenter;
    outward.set(1, 0, 0);
    tangent.set(1, 0, 0);
    yaw = Math.PI * 0.5;
  } else {
    baseX = parcel.minX + setback + lotDepth;
    baseZ += alongCenter;
    outward.set(-1, 0, 0);
    tangent.set(-1, 0, 0);
    yaw = -Math.PI * 0.5;
  }

  pedestrianPosition.set(baseX, 0.02, baseZ).addScaledVector(outward, 1.3);
  vehiclePosition.copy(pedestrianPosition).addScaledVector(outward, 3.6);

  return {
    pedestrianPosition,
    vehiclePosition,
    tangent,
    yaw
  };
}

function applyBloomvilleAgentSpawnPoints(stage) {
  const vehicleLayer = stage.agentNavigation?.layers?.vehicle;
  const pedestrianLayer = stage.agentNavigation?.layers?.pedestrian;
  if (!vehicleLayer || !pedestrianLayer) {
    return;
  }

  const vehicleSpawnPoints = [];
  const pedestrianSpawnPoints = [];

  for (const chunk of stage.chunks.values()) {
    const chunkOffset = new THREE.Vector3(chunk.chunkX * CHUNK_SIZE, 0, chunk.chunkZ * CHUNK_SIZE);

    for (const spawnPoint of chunk.vehicleSpawnPoints || []) {
      vehicleSpawnPoints.push({
        ...spawnPoint,
        position: spawnPoint.position.clone().add(chunkOffset),
        tangent: spawnPoint.tangent.clone()
      });
    }

    for (const spawnPoint of chunk.pedestrianSpawnPoints || []) {
      pedestrianSpawnPoints.push({
        ...spawnPoint,
        position: spawnPoint.position.clone().add(chunkOffset),
        tangent: spawnPoint.tangent.clone()
      });
    }
  }

  if (vehicleSpawnPoints.length) {
    vehicleLayer.spawnPoints = vehicleSpawnPoints;
  }
  if (pedestrianSpawnPoints.length) {
    pedestrianLayer.spawnPoints = pedestrianSpawnPoints;
  }
}

function createPocketPark(parcel, rng) {
  const group = new THREE.Group();
  const pad = new THREE.Mesh(getPlaneGeometry(parcel.width, parcel.depth), MATERIALS.ground.clone());
  if (pad.material.map) {
    pad.material.map = pad.material.map.clone();
    pad.material.map.repeat.set(parcel.width / 16, parcel.depth / 16);
    pad.material.map.needsUpdate = true;
  }
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(parcel.centerX, -0.016, parcel.centerZ);
  pad.receiveShadow = true;
  group.add(pad);
  group.add(
    createTreeInstances(
      collectTreePlacements(
        parcel.centerX,
        parcel.centerZ,
        parcel.width - 12,
        parcel.depth - 12,
        12 + Math.floor(rng() * 8),
        rng
      )
    )
  );
  return group;
}

function createChunkPlaza(parcel) {
  const group = new THREE.Group();
  const pad = new THREE.Mesh(getPlaneGeometry(parcel.width, parcel.depth), MATERIALS.plaza.clone());
  if (pad.material.map) {
    pad.material.map = pad.material.map.clone();
    pad.material.map.repeat.set(parcel.width / 8, parcel.depth / 8);
    pad.material.map.needsUpdate = true;
  }
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(parcel.centerX, -0.012, parcel.centerZ);
  pad.receiveShadow = true;
  group.add(pad);

  const monument = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 1.2, 7.2, 8),
    new THREE.MeshStandardMaterial({ color: '#c9c4ba', roughness: 0.72, metalness: 0.08 })
  );
  monument.position.set(parcel.centerX, 3.6, parcel.centerZ);
  monument.castShadow = true;
  monument.receiveShadow = true;
  group.add(monument);
  return group;
}

function createChunkTrees(horizontalRoad, verticalRoad, density, rng) {
  if (density <= 0) {
    return new THREE.Group();
  }

  const parcels = createChunkQuadrants(horizontalRoad, verticalRoad);
  const placements = [];
  for (const parcel of parcels) {
    const count = Math.max(0, Math.round(((parcel.width + parcel.depth) / 24) * density));
    placements.push(
      ...collectTreePlacements(parcel.centerX, parcel.centerZ, parcel.width - 14, parcel.depth - 14, count, rng)
    );
  }
  return createTreeInstances(placements);
}

function collectTreePlacements(centerX, centerZ, width, depth, count, rng) {
  const placements = [];
  for (let index = 0; index < count; index += 1) {
    placements.push({
      x: centerX + (rng() - 0.5) * width,
      z: centerZ + (rng() - 0.5) * depth,
      height: THREE.MathUtils.lerp(3.8, 6.8, rng())
    });
  }
  return placements;
}

function createTreeInstances(placements) {
  const group = new THREE.Group();
  group.userData.noCollision = true;
  group.userData.noSuspension = true;
  if (!placements.length) {
    return group;
  }

  const trunks = new THREE.InstancedMesh(TREE_GEOMETRIES.trunk, MATERIALS.trunk, placements.length);
  const crowns = new THREE.InstancedMesh(TREE_GEOMETRIES.crown, MATERIALS.leaf, placements.length);
  trunks.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  crowns.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  crowns.castShadow = true;
  crowns.receiveShadow = true;

  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    const crownRadius = placement.height * 0.42;

    INSTANCE_QUATERNION.copy(IDENTITY_QUATERNION);

    INSTANCE_POSITION.set(placement.x, placement.height * 0.5, placement.z);
    INSTANCE_SCALE.set(0.28, placement.height, 0.28);
    INSTANCE_MATRIX.compose(INSTANCE_POSITION, INSTANCE_QUATERNION, INSTANCE_SCALE);
    trunks.setMatrixAt(index, INSTANCE_MATRIX);

    INSTANCE_POSITION.set(placement.x, placement.height * 0.95, placement.z);
    INSTANCE_SCALE.set(crownRadius, crownRadius, crownRadius);
    INSTANCE_MATRIX.compose(INSTANCE_POSITION, INSTANCE_QUATERNION, INSTANCE_SCALE);
    crowns.setMatrixAt(index, INSTANCE_MATRIX);
  }

  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  group.add(trunks, crowns);
  return group;
}

function createProceduralBuildingFromEntry(entry, frontage, depth, rng) {
  const group = new THREE.Group();
  const materials = createPaletteMaterials(entry.palette, entry.textures);

  for (const piece of entry.pieces) {
    const mesh = new THREE.Mesh(getBoxGeometry(piece.size), materials[piece.material || 'body'] || materials.body);
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
  const targetWidth = frontage * THREE.MathUtils.lerp(0.76, 0.9, rng());
  const targetDepth = depth * THREE.MathUtils.lerp(0.64, 0.84, rng());
  const scaleX = size.x > 0 ? targetWidth / size.x : 1;
  const scaleZ = size.z > 0 ? targetDepth / size.z : 1;
  const scaleY = THREE.MathUtils.lerp(0.95, 1.12, rng());
  group.scale.set(scaleX, scaleY, scaleZ);
  group.position.sub(new THREE.Vector3(center.x * scaleX, bounds.min.y * scaleY, center.z * scaleZ));
  return group;
}

function createBuildingFromEntry(entry, frontage, depth, rng, options = {}, dependencies = {}) {
  const { gltfLoader, buildingAssetMode = BUILDING_ASSET_MODE_FALLBACK } = dependencies;
  const procedural = createProceduralBuildingFromEntry(entry, frontage, depth, rng);

  if (!gltfLoader) {
    return buildingAssetMode === BUILDING_ASSET_MODE_GLB_ONLY ? new THREE.Group() : procedural;
  }

  const lod = new THREE.LOD();
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

  prepareCatalogModelInstance(glbRoot);
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

function loadCatalogEntries() {
  return Object.values(BLOOMVILLE_CATALOG_MODULES)
    .flatMap((pack) => pack.entries || [])
    .map((entry) => normalizeCatalogEntry(entry))
    .filter(Boolean);
}

function collectCatalogDistricts(catalogs) {
  const districts = new Set(['mixed_main', 'park']);
  for (const entry of catalogs) {
    for (const district of entry.districts) {
      districts.add(district);
    }
  }
  return districts;
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

function getDistrictStyle(district) {
  return DISTRICT_STYLE[district] || DISTRICT_STYLE.mixed_main;
}

function getDistrictLotTuning(district) {
  return DISTRICT_LOT_TUNING[district] || DISTRICT_LOT_TUNING.mixed_main;
}

function createOrientedPlane(length, width, orientation, y) {
  const horizontal = orientation === 'horizontal';
  const mesh = new THREE.Mesh(getPlaneGeometry(horizontal ? length : width, horizontal ? width : length));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

function createCollisionOrientedBox(length, width, orientation, topY, height, material) {
  return createCollisionBox(
    orientation === 'horizontal' ? length : width,
    orientation === 'horizontal' ? width : length,
    topY,
    height,
    material
  );
}

function createCollisionBox(width, depth, topY, height, material) {
  const mesh = new THREE.Mesh(getBoxGeometry([width, height, depth]), material);
  mesh.position.y = topY - height * 0.5;
  return mesh;
}

function pickChunkDistrict(chunkX, chunkZ, rng, availableDistricts = new Set()) {
  const radius = Math.max(Math.abs(chunkX), Math.abs(chunkZ));
  const onBoulevard = chunkX % 4 === 0 || chunkZ % 4 === 0;
  const onAvenue = !onBoulevard && (chunkX % 2 === 0 || chunkZ % 2 === 0);
  if (radius === 0) {
    return pickAvailableDistrict(
      [
        ['mixed_main', 5],
        ['commercial_general', 2],
        ['civic', 2],
        ['residential_high', 1]
      ],
      availableDistricts,
      rng,
      'mixed_main'
    );
  }

  if (radius === 1) {
    if (onBoulevard) {
      return pickAvailableDistrict(
        [
          ['commercial_general', 4],
          ['mixed_main', 4],
          ['civic', 2],
          ['commercial_regional', 1],
          ['residential_high', 2],
          ['park', 1]
        ],
        availableDistricts,
        rng,
        'mixed_main'
      );
    }
    if (onAvenue) {
      return pickAvailableDistrict(
        [
          ['mixed_main', 4],
          ['residential_high', 3],
          ['commercial_general', 2],
          ['residential_mid', 2],
          ['civic', 1],
          ['park', 1]
        ],
        availableDistricts,
        rng,
        'mixed_main'
      );
    }
    return pickAvailableDistrict(
      [
        ['residential_mid', 4],
        ['residential_high', 2],
        ['mixed_main', 2],
        ['residential_low', 1],
        ['park', 1]
      ],
      availableDistricts,
      rng,
      'residential_mid'
    );
  }

  if (radius <= 3) {
    if (onBoulevard) {
      return pickAvailableDistrict(
        [
          ['commercial_general', 4],
          ['commercial_regional', 3],
          ['mixed_main', 3],
          ['civic', 1],
          ['residential_high', 2],
          ['industrial_light', 1],
          ['park', 1]
        ],
        availableDistricts,
        rng,
        'commercial_general'
      );
    }
    if (onAvenue) {
      return pickAvailableDistrict(
        [
          ['residential_high', 3],
          ['commercial_general', 3],
          ['mixed_main', 3],
          ['residential_mid', 3],
          ['commercial_regional', 1],
          ['park', 1]
        ],
        availableDistricts,
        rng,
        'residential_mid'
      );
    }
    return pickAvailableDistrict(
      [
        ['residential_mid', 4],
        ['residential_low', 3],
        ['mixed_main', 2],
        ['residential_high', 1],
        ['park', 1]
      ],
      availableDistricts,
      rng,
      'residential_mid'
    );
  }

  if (onBoulevard) {
    return pickAvailableDistrict(
      [
        ['industrial_heavy', 4],
        ['industrial_light', 3],
        ['commercial_regional', 2],
        ['commercial_general', 1],
        ['park', 1]
      ],
      availableDistricts,
      rng,
      'industrial_light'
    );
  }
  if (onAvenue) {
    return pickAvailableDistrict(
      [
        ['industrial_light', 3],
        ['commercial_general', 2],
        ['residential_mid', 2],
        ['residential_low', 2],
        ['park', 1]
      ],
      availableDistricts,
      rng,
      'residential_mid'
    );
  }
  return pickAvailableDistrict(
    [
      ['residential_low', 5],
      ['residential_mid', 3],
      ['industrial_light', 2],
      ['industrial_heavy', 1],
      ['park', 1]
    ],
    availableDistricts,
    rng,
    'residential_low'
  );
}

function pickAvailableDistrict(weightedDistricts, availableDistricts, rng, fallbackDistrict) {
  const activeDistricts = weightedDistricts.filter(([district]) => availableDistricts.has(district));
  if (!activeDistricts.length) {
    return availableDistricts.has(fallbackDistrict) ? fallbackDistrict : 'mixed_main';
  }
  const totalWeight = activeDistricts.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = rng() * totalWeight;
  for (const [district, weight] of activeDistricts) {
    cursor -= weight;
    if (cursor <= 0) {
      return district;
    }
  }
  return activeDistricts[activeDistricts.length - 1][0];
}

function pickHorizontalRoadKind(chunkZ) {
  if (chunkZ % 4 === 0) {
    return 'boulevard';
  }
  if (chunkZ % 2 === 0) {
    return 'avenue';
  }
  return 'street';
}

function pickVerticalRoadKind(chunkX) {
  if (chunkX % 4 === 0) {
    return 'boulevard';
  }
  if (chunkX % 2 === 0) {
    return 'avenue';
  }
  return 'street';
}

function createOverviewBounds(chunkRangeX, chunkRangeZ) {
  return {
    minX: chunkRangeX[0] * CHUNK_SIZE - CHUNK_SIZE * 0.5,
    maxX: chunkRangeX[1] * CHUNK_SIZE + CHUNK_SIZE * 0.5,
    minZ: chunkRangeZ[0] * CHUNK_SIZE - CHUNK_SIZE * 0.5,
    maxZ: chunkRangeZ[1] * CHUNK_SIZE + CHUNK_SIZE * 0.5
  };
}

function getChunkKey(chunkX, chunkZ) {
  return `${chunkX}:${chunkZ}`;
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

function hash2D(x, z) {
  let value = ((x * 374761393) ^ (z * 668265263)) >>> 0;
  value = (value ^ (value >> 13)) * 1274126177;
  return value >>> 0;
}

function createSeededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0xffffffff;
  };
}

function disposeChunk(root) {
  root.traverse((child) => {
    if (child.geometry && !child.geometry.userData?.shared) {
      child.geometry.dispose?.();
    }
    if (!child.material) {
      return;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material?.userData?.shared) {
        continue;
      }
      material?.dispose?.();
    }
  });
}
