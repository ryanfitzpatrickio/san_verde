import * as THREE from 'three';
import cityRoadGraphSource from './city-road-graph.json';
import { createRoadGraphNavigation } from './autopilot.js';
import { buildRoadGraphAgentNavigation } from './navigation-network.js';
import { extractGridAtlasTiles, extractRoadAtlasTiles } from './road-atlas.js';
import { collectNodeConnections, createRoadGraphFromGeoJSON, deriveRoadGraphSpawn } from './road-graph.js';

const CITY_KIT_ASSETS = {
  roadAtlas: { id: 'roadAtlas', url: '/models/roadgrid_3x3.glb' },
  buildingAtlas: { id: 'buildingAtlas', url: '/models/buildinggrid_3x3.glb' },
  roadStraight: { id: 'roadStraight', url: '/models/road_straight_2lane.glb' },
  roadCurve: { id: 'roadCurve', url: '/models/road_curve_2lane_45deg.glb' },
  intersection4Way: { id: 'intersection4Way', url: '/models/intersection_4way.glb' },
  intersectionT: { id: 'intersectionT', url: '/models/intersection_t.glb' },
  buildingMidrise: { id: 'buildingMidrise', url: '/models/building_midrise_a.glb' }
};

const BLOCK_LIBRARY = [
  { center: [-156, -154], size: [74, 54], district: 'industrial' },
  { center: [-76, -146], size: [54, 58], district: 'midrise' },
  { center: [12, -150], size: [66, 60], district: 'industrial' },
  { center: [126, -146], size: [82, 62], district: 'industrial' },
  { center: [-162, -66], size: [68, 48], district: 'warehouse' },
  { center: [-72, -58], size: [56, 50], district: 'midrise' },
  { center: [18, -52], size: [58, 52], district: 'midrise' },
  { center: [120, -42], size: [78, 54], district: 'downtown' },
  { center: [-156, 34], size: [70, 50], district: 'park' },
  { center: [-76, 28], size: [52, 46], district: 'midrise' },
  { center: [12, 22], size: [56, 44], district: 'downtown' },
  { center: [110, 38], size: [72, 54], district: 'downtown' },
  { center: [-148, 118], size: [72, 50], district: 'midrise' },
  { center: [-54, 114], size: [54, 44], district: 'park' },
  { center: [28, 112], size: [58, 48], district: 'downtown' },
  { center: [126, 122], size: [78, 56], district: 'tower' }
];

const ROAD_CLASS_STYLES = {
  primary: { laneOffset: 4.4, dashLength: 5.8, gapLength: 5.2, edgeInset: 1.35 },
  secondary: { laneOffset: 3.6, dashLength: 5.2, gapLength: 4.8, edgeInset: 1.1 },
  local: { laneOffset: 2.8, dashLength: 4.2, gapLength: 4.2, edgeInset: 0.95 }
};

const IMPORTED_ROAD_WIDTH_SCALE = 2.15;
const IMPORTED_SHOULDER_EXTRA_WIDTH = 18;
const IMPORTED_ROAD_SHOULDER_Y = 0.12;
const IMPORTED_ROAD_Y = 0.16;
const IMPORTED_MARKING_Y = 0.22;
const IMPORTED_INTERSECTION_Y = 0.165;

const DISTRICT_STYLE = {
  industrial: { baseHeight: 8, variance: 8, accentChance: 0.1, color: '#b7aa97', accent: '#6c737b' },
  warehouse: { baseHeight: 10, variance: 10, accentChance: 0.12, color: '#9e9487', accent: '#707070' },
  midrise: { baseHeight: 18, variance: 26, accentChance: 0.24, color: '#c5beb3', accent: '#7d8799' },
  downtown: { baseHeight: 30, variance: 54, accentChance: 0.42, color: '#d0cbc2', accent: '#6b778e' },
  tower: { baseHeight: 50, variance: 82, accentChance: 0.7, color: '#d7d5d0', accent: '#7786a0' }
};

const ROAD_ATLAS_ROLE_MAP = {
  curveRight: 'tile_0_0',
  straightVerticalA: 'tile_1_0',
  curveLeft: 'tile_2_0',
  straightHorizontalA: 'tile_0_1',
  cross: 'tile_1_1',
  straightHorizontalB: 'tile_2_1',
  teeRight: 'tile_0_2',
  straightVerticalB: 'tile_1_2',
  teeLeft: 'tile_2_2'
};

export function createCityStage(dependencies = {}) {
  const group = new THREE.Group();
  const materials = createCityMaterials();
  const graph = createRoadGraphFromGeoJSON(cityRoadGraphSource);
  const spawn = deriveRoadGraphSpawn(graph);
  const useLegacyBlockLayout = shouldUseLegacyBlockLayout(graph);
  const mounts = {
    terrain: new THREE.Group(),
    roadBed: new THREE.Group(),
    fallbackRoads: new THREE.Group(),
    kitRoads: new THREE.Group(),
    fallbackBlocks: new THREE.Group(),
    kitBlocks: new THREE.Group(),
    fallbackProps: new THREE.Group(),
    kitProps: new THREE.Group()
  };

  mounts.terrain.add(createCityTerrain(materials.terrain));
  mounts.roadBed.add(
    createRoadBed(
      graph.bounds,
      useLegacyBlockLayout ? materials.sidewalk : materials.grass,
      useLegacyBlockLayout ? -0.01 : -0.16
    )
  );
  mounts.fallbackRoads.add(createRoadNetwork(graph, materials));

  if (useLegacyBlockLayout) {
    const blockContent = createCityBlocks(BLOCK_LIBRARY, materials);
    mounts.fallbackBlocks.add(blockContent.group);
  } else {
    mounts.fallbackBlocks.add(createImportedBlockoutBuildings(graph, materials));
  }
  mounts.fallbackProps.add(createStreetFurniture(graph, useLegacyBlockLayout ? BLOCK_LIBRARY : [], materials));
  group.add(
    mounts.terrain,
    mounts.roadBed,
    mounts.fallbackRoads,
    mounts.kitRoads,
    mounts.fallbackBlocks,
    mounts.kitBlocks,
    mounts.fallbackProps,
    mounts.kitProps
  );

  const startPosition = spawn.position.clone();
  const startTangent = spawn.tangent.clone();
  group.add(createOrientedStartLine(startPosition.clone().setY(0.05), startTangent));

  const stage = {
    id: 'city',
    group,
    startPosition,
    startYaw: spawn.yaw,
    driveBounds: Math.max(Math.abs(graph.bounds.maxX), Math.abs(graph.bounds.maxZ)) - 18,
    navigation: createRoadGraphNavigation(graph),
    agentNavigation: buildRoadGraphAgentNavigation(graph),
    agentNavigationRevision: 0,
    cityGraph: graph,
    cityUsesLegacyBlockLayout: useLegacyBlockLayout,
    cityMounts: mounts,
    cityKitLoaded: false,
    cityKitPromise: null,
    cityRoadAtlas: null,
    cityRoadAtlasStatus: 'missing',
    cityBuildingAtlas: null,
    cityBuildingAtlasStatus: 'missing',
    async loadAssets(loadDependencies = {}) {
      if (this.cityKitPromise) {
        return this.cityKitPromise;
      }

      this.cityKitPromise = hydrateCityKit(this, loadDependencies).finally(() => {
        this.cityKitPromise = null;
      });
      return this.cityKitPromise;
    },
    update() {}
  };

  if (dependencies.gltfLoader) {
    stage.loadAssets(dependencies);
  }

  return stage;
}

function createCityMaterials() {
  const asphaltTexture = createAsphaltTextureSet();

  return {
    road: new THREE.MeshPhysicalMaterial({
      color: '#333840',
      roughness: 0.96,
      metalness: 0.03,
      clearcoat: 0.03,
      map: asphaltTexture.map
    }),
    shoulder: new THREE.MeshPhysicalMaterial({
      color: '#565b62',
      roughness: 0.98,
      metalness: 0.02
    }),
    line: new THREE.MeshBasicMaterial({
      color: '#f1eed8',
      transparent: true,
      opacity: 0.9
    }),
    centerLine: new THREE.MeshBasicMaterial({
      color: '#efd788',
      transparent: true,
      opacity: 0.86
    }),
    sidewalk: new THREE.MeshStandardMaterial({
      color: '#86898e',
      roughness: 0.94,
      metalness: 0.02
    }),
    terrain: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.98,
      metalness: 0.02
    }),
    grass: new THREE.MeshStandardMaterial({
      color: '#5d7450',
      roughness: 0.98,
      metalness: 0.02
    }),
    plaza: new THREE.MeshStandardMaterial({
      color: '#9e9587',
      roughness: 0.92,
      metalness: 0.02
    }),
    building: new THREE.MeshStandardMaterial({
      color: '#c7c0b5',
      roughness: 0.9,
      metalness: 0.04
    }),
    accent: new THREE.MeshStandardMaterial({
      color: '#6d7888',
      roughness: 0.76,
      metalness: 0.12
    }),
    glass: new THREE.MeshStandardMaterial({
      color: '#8b9db2',
      roughness: 0.28,
      metalness: 0.18
    }),
    pole: new THREE.MeshStandardMaterial({
      color: '#d2d0cb',
      roughness: 0.68,
      metalness: 0.24
    }),
    lamp: new THREE.MeshBasicMaterial({
      color: '#ffd89d'
    }),
    trunk: new THREE.MeshStandardMaterial({
      color: '#5f4f43',
      roughness: 0.92,
      metalness: 0.02
    }),
    tree: new THREE.MeshStandardMaterial({
      color: '#566b4a',
      roughness: 0.98,
      metalness: 0.02
    }),
    barrier: new THREE.MeshStandardMaterial({
      color: '#a34f3a',
      roughness: 0.86,
      metalness: 0.08
    }),
    importedRoad: new THREE.MeshBasicMaterial({
      color: '#1f2328',
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3
    }),
    importedShoulder: new THREE.MeshBasicMaterial({
      color: '#72786f',
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    }),
    importedCurb: new THREE.MeshBasicMaterial({
      color: '#c8ccb7',
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    })
  };
}

function createCityTerrain(material) {
  const terrain = new THREE.Mesh(new THREE.PlaneGeometry(620, 620, 72, 72), material);
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.y = -0.34;

  const position = terrain.geometry.attributes.position;
  const colors = [];
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const basin = smoothstepScalar(40, 220, Math.abs(x) * 0.7 + Math.abs(z) * 0.45);
    const ridge = Math.sin(x * 0.018) * 3.8 + Math.cos(z * 0.014) * 4.4 + Math.sin((x + z) * 0.01) * 5.8;
    const roll = Math.sin((x - z) * 0.023) * 1.6;
    position.setY(index, basin * (ridge + roll));

    const green = THREE.MathUtils.clamp(0.28 + basin * 0.24, 0, 1);
    const dry = THREE.MathUtils.clamp(0.18 + basin * 0.18, 0, 1);
    colors.push(0.16 + dry * 0.18, 0.21 + green * 0.34, 0.14 + dry * 0.12);
  }

  terrain.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  terrain.geometry.computeVertexNormals();
  terrain.receiveShadow = true;
  return terrain;
}

function createRoadBed(bounds, material, y = -0.01) {
  const margin = 56;
  const width = bounds.maxX - bounds.minX + margin * 2;
  const depth = bounds.maxZ - bounds.minZ + margin * 2;
  const base = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  base.rotation.x = -Math.PI / 2;
  base.position.set((bounds.minX + bounds.maxX) * 0.5, y, (bounds.minZ + bounds.maxZ) * 0.5);
  base.receiveShadow = true;
  return base;
}

function createRoadNetwork(graph, materials) {
  const group = new THREE.Group();
  const denseGraph = graph.roads.length > 1000;
  const importedGraph = graph.metadata?.source === 'osm_overpass';
  const shoulderY = importedGraph ? IMPORTED_ROAD_SHOULDER_Y : 0.014;
  const roadY = importedGraph ? IMPORTED_ROAD_Y : 0.02;
  const markingY = importedGraph ? IMPORTED_MARKING_Y : 0.03;
  const shoulderExtraWidth = importedGraph ? IMPORTED_SHOULDER_EXTRA_WIDTH : 7;
  const roadWidthScale = importedGraph ? IMPORTED_ROAD_WIDTH_SCALE : 1;
  const shoulderMaterial = importedGraph ? materials.importedShoulder : materials.shoulder;
  const roadMaterial = importedGraph ? materials.importedRoad : materials.road;
  const curbY = importedGraph ? roadY + 0.018 : roadY + 0.004;

  for (const road of graph.roads) {
    const length = getPolylineLength(road.points);
    const samples = denseGraph
      ? Math.max(4, Math.round(length / (road.classification === 'primary' ? 12 : 20)))
      : Math.max(18, Math.round(length / 4));
    const shoulder = createTrackRibbon(road.curve, {
      width: road.width * roadWidthScale + shoulderExtraWidth,
      samples,
      y: shoulderY,
      uvScale: 0.04
    });
    shoulder.material = shoulderMaterial;
    shoulder.receiveShadow = true;
    if (importedGraph) {
      shoulder.renderOrder = 6;
    }
    group.add(shoulder);

    const roadMesh = createTrackRibbon(road.curve, {
      width: road.width * roadWidthScale,
      samples,
      y: roadY,
      uvScale: 0.05
    });
    roadMesh.material = roadMaterial;
    roadMesh.receiveShadow = true;
    if (importedGraph) {
      roadMesh.renderOrder = 7;
    }
    group.add(roadMesh);

    if (!(denseGraph && road.classification === 'local')) {
      const endpointTrim = importedGraph ? getImportedRoadEndTrim(road) : 0;
      group.add(
        createRoadLaneLines(road, materials, markingY, {
          simplified: importedGraph,
          startInset: endpointTrim,
          endInset: endpointTrim
        })
      );
    }

    if (importedGraph) {
      const curbOffset = road.width * roadWidthScale * 0.5 + 0.38;
      for (const sideSign of [-1, 1]) {
        const curb = createTrackRibbon(road.curve, {
          width: 0.72,
          samples,
          y: curbY,
          uvScale: 0.08,
          offset: sideSign * curbOffset
        });
        curb.material = materials.importedCurb;
        curb.renderOrder = 8;
        group.add(curb);
      }
    }
  }

  for (const node of graph.nodes) {
    if (node.kind !== 'junction') {
      continue;
    }

    const intersection = importedGraph
      ? createImportedIntersectionPatch(node, materials.importedRoad)
      : createIntersectionPatch(node, materials.road);
    if (intersection) {
      group.add(intersection);
    }

    if (!importedGraph && node.degree >= 2) {
      group.add(createIntersectionCrosswalks(node, materials.line));
    }
  }

  return group;
}

function createImportedIntersectionPatch(node, material) {
  const connections = node.connections || [];
  if (!connections.length) {
    return null;
  }

  const group = new THREE.Group();
  const maxWidth = Math.max(...connections.map((connection) => connection.width * IMPORTED_ROAD_WIDTH_SCALE), 12);
  const centerSize = THREE.MathUtils.clamp(maxWidth * 1.1, 18, 34);

  const centerPad = new THREE.Mesh(new THREE.PlaneGeometry(centerSize, centerSize), material);
  centerPad.rotation.x = -Math.PI / 2;
  centerPad.position.copy(node.point).setY(IMPORTED_INTERSECTION_Y);
  centerPad.receiveShadow = true;
  centerPad.renderOrder = 8;
  group.add(centerPad);

  for (const connection of connections) {
    const armWidth = connection.width * IMPORTED_ROAD_WIDTH_SCALE + 2.2;
    const armLength = THREE.MathUtils.clamp(armWidth * 0.72 + 10, 14, 22);
    const arm = new THREE.Mesh(
      new THREE.PlaneGeometry(armWidth, armLength),
      material
    );
    arm.rotation.x = -Math.PI / 2;
    arm.rotation.z = Math.atan2(connection.direction.x, connection.direction.z);
    arm.position
      .copy(node.point)
      .addScaledVector(connection.direction, armLength * 0.5)
      .setY(IMPORTED_INTERSECTION_Y);
    arm.receiveShadow = true;
    arm.renderOrder = 8;
    group.add(arm);
  }

  return group;
}

function createRoadLaneLines(road, materials, y = 0.03, options = {}) {
  const group = new THREE.Group();
  const style = ROAD_CLASS_STYLES[road.classification];
  const simplified = Boolean(options.simplified);
  const totalLength = getPolylineLength(road.points);
  const startInset = THREE.MathUtils.clamp(options.startInset || 0, 0, totalLength * 0.45);
  const endInset = THREE.MathUtils.clamp(options.endInset || 0, 0, totalLength * 0.45);
  const usableLength = totalLength - startInset - endInset;
  if (usableLength <= 4) {
    return group;
  }

  const startT = startInset / totalLength;
  const endT = 1 - endInset / totalLength;
  const dashCount = Math.max(2, Math.floor(usableLength / (style.dashLength + style.gapLength)));
  const halfWidth = road.width * 0.5;

  if (!simplified) {
    for (const edgeOffset of [-halfWidth + style.edgeInset, halfWidth - style.edgeInset]) {
      const edgeLine = createTrackRibbon(road.curve, {
        width: 0.18,
        samples: Math.max(14, Math.round(totalLength / 5)),
        y,
        uvScale: 0.1,
        offset: edgeOffset,
        tStart: startT,
        tEnd: endT
      });
      edgeLine.material = materials.line;
      group.add(edgeLine);
    }
  }

  if (road.classification !== 'local') {
    const dashGeometry = new THREE.PlaneGeometry(0.28, style.dashLength);
    const dashMesh = new THREE.InstancedMesh(dashGeometry, materials.centerLine, dashCount);
    const dashMatrix = new THREE.Matrix4();
    const dashQuaternion = new THREE.Quaternion();
    const dashPosition = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, 1);

    for (let index = 0; index < dashCount; index += 1) {
      const t = THREE.MathUtils.lerp(startT, endT, (index + 0.35) / dashCount);
      const point = road.curve.getPointAt(Math.min(t, 0.995));
      const tangent = road.curve.getTangentAt(Math.min(t, 0.995)).setY(0).normalize();
      dashPosition.set(point.x, y + 0.002, point.z);
      dashQuaternion.setFromUnitVectors(forward, tangent);
      dashQuaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI * 0.5));
      dashMatrix.compose(dashPosition, dashQuaternion, new THREE.Vector3(1, 1, 1));
      dashMesh.setMatrixAt(index, dashMatrix);
    }

    dashMesh.instanceMatrix.needsUpdate = true;
    dashMesh.renderOrder = 9;
    group.add(dashMesh);
  }

  return group;
}

function getImportedRoadEndTrim(road) {
  if (road.classification === 'primary') {
    return 22;
  }
  if (road.classification === 'secondary') {
    return 18;
  }
  return 14;
}

function createIntersectionPatch(node, material) {
  const boundary = buildIntersectionBoundary(node);
  if (boundary.length < 3) {
    return null;
  }

  const localBoundary = boundary.map((point) => point.clone().sub(node.point));
  const shape = new THREE.Shape();
  shape.moveTo(localBoundary[0].x, -localBoundary[0].z);
  for (let index = 1; index < localBoundary.length; index += 1) {
    shape.lineTo(localBoundary[index].x, -localBoundary[index].z);
  }
  shape.closePath();

  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.copy(node.point).setY(0.021);
  mesh.receiveShadow = true;
  return mesh;
}

function buildIntersectionBoundary(node) {
  const center = node.point;
  const boundary = [];

  for (const connection of node.connections || []) {
    const direction = connection.direction.clone().normalize();
    const side = new THREE.Vector3(-direction.z, 0, direction.x);
    const reach = getIntersectionReach(node, connection);
    const halfWidth = connection.width * 0.5 + 1.4;

    boundary.push(
      center.clone().addScaledVector(direction, reach).addScaledVector(side, halfWidth),
      center.clone().addScaledVector(direction, reach).addScaledVector(side, -halfWidth)
    );
  }

  const deduped = dedupeBoundaryPoints(boundary, center);
  deduped.sort((left, right) => {
    const leftAngle = Math.atan2(left.z - center.z, left.x - center.x);
    const rightAngle = Math.atan2(right.z - center.z, right.x - center.x);
    return leftAngle - rightAngle;
  });
  return deduped;
}

function dedupeBoundaryPoints(points, center) {
  const deduped = [];
  for (const point of points) {
    if (point.distanceToSquared(center) < 1) {
      continue;
    }
    if (deduped.some((existing) => existing.distanceToSquared(point) < 0.36)) {
      continue;
    }
    deduped.push(point);
  }
  return deduped;
}

function getIntersectionReach(node, connection) {
  const maxWidth = Math.max(...(node.connections || []).map((entry) => entry.width), connection.width);
  const baseReach = connection.width * 0.24 + maxWidth * 0.16 + 1.2;
  return THREE.MathUtils.clamp(baseReach, 4.2, 9.2);
}

function createIntersectionCrosswalks(node, material) {
  const group = new THREE.Group();

  for (const connection of node.connections || []) {
    if (connection.width < 10) {
      continue;
    }

    const crosswalk = createSingleCrosswalk(
      Math.max(connection.width - 2.8, 4.8),
      2.4,
      material
    );
    crosswalk.position
      .copy(node.point)
      .addScaledVector(connection.direction, getIntersectionReach(node, connection) + 0.85);
    crosswalk.rotation.y = Math.atan2(connection.direction.x, connection.direction.z);
    group.add(crosswalk);
  }

  return group;
}

function createSingleCrosswalk(width, depth, material) {
  const group = new THREE.Group();
  const stripeCount = Math.max(4, Math.floor(width / 1.5));
  const stride = width / stripeCount;

  for (let index = 0; index < stripeCount; index += 1) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(stride * 0.68, depth), material);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(-width * 0.5 + stride * (index + 0.5), 0.035, 0);
    group.add(stripe);
  }

  return group;
}

function createCityBlocks(blockLibrary, materials) {
  const group = new THREE.Group();
  const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
  const windowBandGeometry = new THREE.BoxGeometry(1, 0.18, 1);
  const matrices = [];
  const accentMatrices = [];

  for (const block of blockLibrary) {
    const [cx, cz] = block.center;
    const [sx, sz] = block.size;
    const district = DISTRICT_STYLE[block.district] || DISTRICT_STYLE.midrise;

    if (block.district === 'park') {
      group.add(createParkBlock(cx, cz, sx, sz, materials));
      continue;
    }

    const podium = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), materials.plaza);
    podium.rotation.x = -Math.PI / 2;
    podium.position.set(cx, 0.016, cz);
    podium.receiveShadow = true;
    group.add(podium);

    const lotInset = 4.5;
    const lotCountX = Math.max(2, Math.floor(sx / 18));
    const lotCountZ = Math.max(2, Math.floor(sz / 18));
    const lotWidth = (sx - lotInset * 2) / lotCountX;
    const lotDepth = (sz - lotInset * 2) / lotCountZ;

    for (let xi = 0; xi < lotCountX; xi += 1) {
      for (let zi = 0; zi < lotCountZ; zi += 1) {
        const seed = seededNoise((cx + xi * 13.2) * 0.17 + (cz + zi * 7.3) * 0.11);
        if (seed < 0.18) {
          continue;
        }

        const footprintX = lotWidth * (0.54 + seed * 0.22);
        const footprintZ = lotDepth * (0.52 + seededNoise(seed * 11.7) * 0.26);
        const height = district.baseHeight + seed * district.variance;
        const x = cx - sx * 0.5 + lotInset + lotWidth * (xi + 0.5);
        const z = cz - sz * 0.5 + lotInset + lotDepth * (zi + 0.5);

        matrices.push({
          x,
          y: height * 0.5,
          z,
          sx: footprintX,
          sy: height,
          sz: footprintZ,
          color: district.color
        });

        if (seed > 1 - district.accentChance) {
          const accentHeight = height * (0.2 + seed * 0.16);
          accentMatrices.push({
            x,
            y: height * 0.72,
            z,
            sx: footprintX * 0.82,
            sy: accentHeight,
            sz: footprintZ * 0.82,
            color: district.accent
          });
        }
      }
    }
  }

  const baseMesh = new THREE.InstancedMesh(buildingGeometry, materials.building, matrices.length);
  const accentMesh = new THREE.InstancedMesh(windowBandGeometry, materials.accent, accentMatrices.length);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  matrices.forEach((instance, index) => {
    position.set(instance.x, instance.y, instance.z);
    scale.set(instance.sx, instance.sy, instance.sz);
    matrix.compose(position, quaternion, scale);
    baseMesh.setMatrixAt(index, matrix);
  });

  accentMatrices.forEach((instance, index) => {
    position.set(instance.x, instance.y, instance.z);
    scale.set(instance.sx, instance.sy, instance.sz);
    matrix.compose(position, quaternion, scale);
    accentMesh.setMatrixAt(index, matrix);
  });

  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  accentMesh.castShadow = true;
  accentMesh.receiveShadow = true;
  group.add(baseMesh, accentMesh);

  return { group };
}

function createParkBlock(cx, cz, sx, sz, materials) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), materials.grass);
  base.rotation.x = -Math.PI / 2;
  base.position.set(cx, 0.018, cz);
  base.receiveShadow = true;
  group.add(base);

  const path = new THREE.Mesh(new THREE.PlaneGeometry(sx * 0.18, sz * 0.92), materials.plaza);
  path.rotation.x = -Math.PI / 2;
  path.position.set(cx, 0.022, cz);
  path.receiveShadow = true;
  group.add(path);

  const crossPath = new THREE.Mesh(new THREE.PlaneGeometry(sx * 0.82, sz * 0.16), materials.plaza);
  crossPath.rotation.x = -Math.PI / 2;
  crossPath.position.set(cx, 0.024, cz);
  crossPath.receiveShadow = true;
  group.add(crossPath);

  for (const [dx, dz] of [
    [-sx * 0.22, -sz * 0.24],
    [sx * 0.24, -sz * 0.2],
    [-sx * 0.18, sz * 0.24],
    [sx * 0.2, sz * 0.18]
  ]) {
    group.add(createTreeCluster(cx + dx, cz + dz, materials));
  }

  return group;
}

function createStreetFurniture(graph, blockLibrary, materials) {
  const group = new THREE.Group();
  const importedGraph = graph.metadata?.source === 'osm_overpass';
  const denseGraph = graph.roads.length > 1000 || importedGraph;
  const maxLights = importedGraph ? 96 : denseGraph ? 180 : Number.POSITIVE_INFINITY;
  let placedLights = 0;
  const lightInstances = [];

  for (const road of graph.roads) {
    if (denseGraph && road.classification === 'local') {
      continue;
    }

    const length = getPolylineLength(road.points);
    const spacing = importedGraph
      ? road.classification === 'primary'
        ? 84
        : 68
      : denseGraph
        ? 64
        : 34;
    const startInset = importedGraph ? getImportedRoadEndTrim(road) + 8 : 0;
    const endInset = importedGraph ? getImportedRoadEndTrim(road) + 8 : 0;
    const usableLength = Math.max(0, length - startInset - endInset);
    if (usableLength <= spacing * 0.65) {
      continue;
    }

    const postCount = Math.max(1, Math.floor(usableLength / spacing));
    const offset = importedGraph
      ? road.width * IMPORTED_ROAD_WIDTH_SCALE * 0.5 + IMPORTED_SHOULDER_EXTRA_WIDTH * 0.36
      : road.width * 0.5 + 3;
    const sideSeed = seededNoise(
      road.points[0].x * 0.011 +
      road.points[0].z * 0.017 +
      length * 0.0023
    );

    for (let index = 0; index <= postCount; index += 1) {
      if (placedLights >= maxLights) {
        break;
      }
      const t = importedGraph
        ? THREE.MathUtils.lerp(startInset / length, 1 - endInset / length, index / postCount)
        : index / postCount;
      const point = road.curve.getPointAt(Math.min(t, 0.998));
      const tangent = road.curve.getTangentAt(Math.min(t, 0.998)).setY(0).normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x);

      const sideSigns = importedGraph
        ? road.classification === 'primary'
          ? [-1, 1]
          : [sideSeed > 0.5 ? 1 : -1]
        : [-1, 1];
      for (const sideSign of sideSigns) {
        lightInstances.push({
          position: point.clone().addScaledVector(side, sideSign * offset).setY(0.02),
          yaw: Math.atan2(tangent.x, tangent.z)
        });
        placedLights += 1;
        if (placedLights >= maxLights) {
          break;
        }
      }
    }
  }

  if (lightInstances.length > 0) {
    group.add(createInstancedStreetLights(materials, lightInstances));
  }

  for (const block of blockLibrary) {
    if (block.district === 'park') {
      continue;
    }

    const [cx, cz] = block.center;
    const [sx, sz] = block.size;
    const barrier = new THREE.Mesh(
      new THREE.BoxGeometry(sx * 0.12, 0.7, 1.1),
      materials.barrier
    );
    barrier.position.set(cx + sx * 0.32, 0.35, cz - sz * 0.34);
    barrier.castShadow = true;
    barrier.receiveShadow = true;
    group.add(barrier);
  }

  return group;
}

function createImportedBlockoutBuildings(graph, materials) {
  const group = new THREE.Group();
  const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
  const accentGeometry = new THREE.BoxGeometry(1, 0.16, 1);
  const buildingInstances = [];
  const accentInstances = [];
  const occupancy = new Set();
  const junctionPoints = graph.nodes.filter((node) => node.kind === 'junction').map((node) => node.point);
  const maxInstances = 980;

  for (const road of graph.roads) {
    if (road.classification === 'local') {
      continue;
    }

    const length = getPolylineLength(road.points);
    if (length < 18) {
      continue;
    }

    for (const sideSign of [-1, 1]) {
      let distance = 10 + seededNoise(length * 0.017 + sideSign * 0.91) * 12;
      let lotIndex = 0;

      while (distance < length - 10 && buildingInstances.length < maxInstances) {
        const t = THREE.MathUtils.clamp(distance / Math.max(length, 0.001), 0.04, 0.96);
        const point = road.curve.getPointAt(t);
        const tangent = road.curve.getTangentAt(t).setY(0).normalize();
        const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
        const yaw = Math.atan2(tangent.x, tangent.z);
        const seed = seededNoise(
          point.x * 0.013 +
          point.z * 0.021 +
          lotIndex * 0.37 +
          sideSign * 1.91
        );
        const junctionRadius =
          road.classification === 'primary'
            ? 30
            : road.classification === 'secondary'
              ? 24
              : 18;

        if (!isPointNearAnyJunction(point, junctionPoints, junctionRadius)) {
          const width = road.classification === 'primary' ? 12 + seed * 9 : 8 + seed * 6;
          const depth = road.classification === 'primary'
            ? 10 + seededNoise(seed * 9.1) * 6
            : 8 + seededNoise(seed * 6.3) * 4;
          const height =
            road.classification === 'primary'
              ? 14 + seed * 38
              : road.classification === 'secondary'
                ? 8 + seed * 18
                : 7 + seed * 12;
          const renderedHalfRoadWidth =
            road.width * IMPORTED_ROAD_WIDTH_SCALE * 0.5 + IMPORTED_SHOULDER_EXTRA_WIDTH * 0.5;
          const setback = renderedHalfRoadWidth + depth * 0.5 + 5 + seed * 4;
          const frontageJitter = (seededNoise(seed * 19.3 + sideSign * 3.1) - 0.5) * 3.2;
          const center = point.clone()
            .addScaledVector(side, sideSign * setback)
            .addScaledVector(tangent, frontageJitter);
          const key = `${Math.round(center.x / 10)}:${Math.round(center.z / 10)}`;

          const roadClearanceRadius = renderedHalfRoadWidth + Math.max(width, depth) * 0.4 + 2.5;
          if (!occupancy.has(key) && !isPointNearAnyRoad(center, graph.roads, roadClearanceRadius)) {
            occupancy.add(key);

            buildingInstances.push({
              x: center.x,
              y: height * 0.5,
              z: center.z,
              sx: width,
              sy: height,
              sz: depth,
              yaw
            });

            if (height > 18 && seededNoise(seed * 31.7) > 0.7) {
              accentInstances.push({
                x: center.x,
                y: height * 0.8,
                z: center.z,
                sx: width * 0.8,
                sy: height * 0.16,
                sz: depth * 0.8,
                yaw
              });
            }
          }

          const lotGap = road.classification === 'primary' ? 2.8 : 2.2;
          distance += width * 0.46 + lotGap + seededNoise(seed * 23.1) * 3.6;
        } else {
          distance += road.classification === 'primary' ? 10 : 8;
        }

        lotIndex += 1;
      }
    }
  }

  if (!buildingInstances.length) {
    return group;
  }

  const chunkSize = 180;
  const chunkMap = new Map();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const yawAxis = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3();

  for (const instance of buildingInstances) {
    const key = getImportedChunkKey(instance.x, instance.z, chunkSize);
    const chunk = chunkMap.get(key) || { buildings: [], accents: [] };
    chunk.buildings.push(instance);
    chunkMap.set(key, chunk);
  }

  for (const instance of accentInstances) {
    const key = getImportedChunkKey(instance.x, instance.z, chunkSize);
    const chunk = chunkMap.get(key) || { buildings: [], accents: [] };
    chunk.accents.push(instance);
    chunkMap.set(key, chunk);
  }

  for (const chunk of chunkMap.values()) {
    if (chunk.buildings.length > 0) {
      const baseMesh = new THREE.InstancedMesh(buildingGeometry, materials.building, chunk.buildings.length);
      chunk.buildings.forEach((instance, index) => {
        position.set(instance.x, instance.y, instance.z);
        quaternion.setFromAxisAngle(yawAxis, instance.yaw || 0);
        scale.set(instance.sx, instance.sy, instance.sz);
        matrix.compose(position, quaternion, scale);
        baseMesh.setMatrixAt(index, matrix);
      });
      baseMesh.castShadow = false;
      baseMesh.receiveShadow = false;
      baseMesh.instanceMatrix.needsUpdate = true;
      baseMesh.computeBoundingBox();
      baseMesh.computeBoundingSphere();
      group.add(baseMesh);
    }

    if (chunk.accents.length > 0) {
      const accentMesh = new THREE.InstancedMesh(accentGeometry, materials.accent, chunk.accents.length);
      chunk.accents.forEach((instance, index) => {
        position.set(instance.x, instance.y, instance.z);
        quaternion.setFromAxisAngle(yawAxis, instance.yaw || 0);
        scale.set(instance.sx, instance.sy, instance.sz);
        matrix.compose(position, quaternion, scale);
        accentMesh.setMatrixAt(index, matrix);
      });
      accentMesh.castShadow = false;
      accentMesh.receiveShadow = false;
      accentMesh.instanceMatrix.needsUpdate = true;
      accentMesh.computeBoundingBox();
      accentMesh.computeBoundingSphere();
      group.add(accentMesh);
    }
  }

  return group;
}

function getImportedChunkKey(x, z, chunkSize) {
  return `${Math.floor(x / chunkSize)}:${Math.floor(z / chunkSize)}`;
}

function isPointNearAnyJunction(point, junctionPoints, radius) {
  const radiusSq = radius * radius;
  for (const junctionPoint of junctionPoints) {
    if (point.distanceToSquared(junctionPoint) <= radiusSq) {
      return true;
    }
  }
  return false;
}

function isPointNearAnyRoad(point, roads, radius) {
  const radiusSq = radius * radius;
  for (const road of roads) {
    if (distancePointToPolylineSqXZ(point, road.points) <= radiusSq) {
      return true;
    }
  }
  return false;
}

function distancePointToPolylineSqXZ(point, polyline) {
  let closestDistanceSq = Number.POSITIVE_INFINITY;
  for (let index = 1; index < polyline.length; index += 1) {
    closestDistanceSq = Math.min(
      closestDistanceSq,
      distancePointToSegmentSqXZ(point, polyline[index - 1], polyline[index])
    );
  }
  return closestDistanceSq;
}

function distancePointToSegmentSqXZ(point, start, end) {
  const segX = end.x - start.x;
  const segZ = end.z - start.z;
  const lengthSq = segX * segX + segZ * segZ;
  if (lengthSq <= 1e-6) {
    const dx = point.x - start.x;
    const dz = point.z - start.z;
    return dx * dx + dz * dz;
  }

  const t = THREE.MathUtils.clamp(
    ((point.x - start.x) * segX + (point.z - start.z) * segZ) / lengthSq,
    0,
    1
  );
  const closestX = start.x + segX * t;
  const closestZ = start.z + segZ * t;
  const dx = point.x - closestX;
  const dz = point.z - closestZ;
  return dx * dx + dz * dz;
}

async function hydrateCityKit(stage, { gltfLoader, disposeObjectTree } = {}) {
  if (!gltfLoader || stage.cityKitLoaded) {
    return stage.cityKitLoaded;
  }

  const kitAssets = await loadCityKitAssets(gltfLoader);
  stage.cityRoadAtlas = kitAssets.roadAtlas || null;
  stage.cityRoadAtlasStatus = stage.cityRoadAtlas ? 'ready' : 'missing';
  stage.cityBuildingAtlas = kitAssets.buildingAtlas || null;
  stage.cityBuildingAtlasStatus = stage.cityBuildingAtlas ? 'ready' : 'missing';

  if (
    !kitAssets.roadAtlas &&
    !kitAssets.buildingAtlas &&
    !kitAssets.roadStraight &&
    !kitAssets.roadCurve &&
    !kitAssets.intersection4Way &&
    !kitAssets.intersectionT &&
    !kitAssets.buildingMidrise
  ) {
    return false;
  }

  clearGroup(stage.cityMounts.kitRoads, disposeObjectTree);
  clearGroup(stage.cityMounts.kitBlocks, disposeObjectTree);
  clearGroup(stage.cityMounts.kitProps, disposeObjectTree);

  if (kitAssets.roadAtlas && shouldUseRoadAtlas(stage.cityGraph)) {
    stage.cityMounts.fallbackRoads.visible = false;
    stage.cityMounts.kitRoads.add(createRoadAtlasGraphLayer(stage.cityGraph, kitAssets.roadAtlas));
  } else {
    stage.cityMounts.fallbackRoads.visible = true;
    if (shouldUseRoadKit(stage.cityGraph)) {
      stage.cityMounts.kitRoads.add(createRoadKitLayer(stage.cityGraph, kitAssets));
      stage.cityMounts.kitProps.add(createIntersectionKitLayer(stage.cityGraph, kitAssets));
    }
  }

  if (stage.cityUsesLegacyBlockLayout) {
    stage.cityMounts.kitBlocks.add(createBuildingKitLayer(BLOCK_LIBRARY, kitAssets));
  }
  stage.cityKitLoaded = true;
  return true;
}

async function loadCityKitAssets(gltfLoader) {
  const entries = await Promise.all(
    Object.values(CITY_KIT_ASSETS).map(async (asset) => {
      try {
        const gltf = await gltfLoader.loadAsync(asset.url);
        const scene = gltf.scene || gltf.scenes[0];
        if (!scene) {
          return [asset.id, null];
        }
        if (asset.id === 'roadAtlas') {
          return [asset.id, extractRoadAtlasTiles(scene)];
        }
        if (asset.id === 'buildingAtlas') {
          return [asset.id, extractGridAtlasTiles(scene)];
        }
        return [asset.id, scene];
      } catch {
        return [asset.id, null];
      }
    })
  );

  return Object.fromEntries(entries);
}

function createRoadKitLayer(graph, kitAssets) {
  const group = new THREE.Group();
  const straightTemplate = kitAssets.roadStraight;
  const curveTemplate = kitAssets.roadCurve;

  if (!straightTemplate && !curveTemplate) {
    return group;
  }

  for (const road of graph.roads) {
    const segmentLength = 22;
    const totalLength = getPolylineLength(road.points);
    const straightCount = Math.max(1, Math.floor(totalLength / segmentLength));

    if (straightTemplate) {
      for (let index = 0; index < straightCount; index += 1) {
        const t = (index + 0.5) / straightCount;
        const point = road.curve.getPointAt(Math.min(t, 0.995));
        const tangent = road.curve.getTangentAt(Math.min(t, 0.995)).setY(0).normalize();
        const straight = createFittedAssetClone(straightTemplate, {
          width: road.width + 4.5,
          depth: segmentLength,
          height: null
        });
        straight.position.set(point.x, 0.026, point.z);
        straight.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
        group.add(straight);
      }
    }

    if (curveTemplate) {
      for (let index = 1; index < road.points.length - 1; index += 1) {
        const prev = road.points[index - 1];
        const current = road.points[index];
        const next = road.points[index + 1];
        const inDirection = current.clone().sub(prev).setY(0).normalize();
        const outDirection = next.clone().sub(current).setY(0).normalize();
        const turnAngle = Math.acos(THREE.MathUtils.clamp(inDirection.dot(outDirection), -1, 1));

        if (turnAngle < 0.14) {
          continue;
        }

        const curve = createFittedAssetClone(curveTemplate, {
          width: road.width + 5.2,
          depth: road.width + 5.2,
          height: null
        });
        curve.position.set(current.x, 0.028, current.z);
        curve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), outDirection);
        group.add(curve);
      }
    }
  }

  return group;
}

function shouldUseLegacyBlockLayout(graph) {
  return graph.metadata?.source !== 'osm_overpass';
}

function shouldUseRoadAtlas(graph) {
  return graph.metadata?.source !== 'osm_overpass' && graph.roads.length <= 160;
}

function shouldUseRoadKit(graph) {
  return graph.metadata?.source !== 'osm_overpass' && graph.roads.length <= 240;
}

function createRoadAtlasGraphLayer(graph, roadAtlas) {
  const group = new THREE.Group();

  for (const road of graph.roads) {
    const totalLength = getPolylineLength(road.points);
    const segmentLength = Math.max(18, roadAtlas.cellDepth * 0.92);
    const straightCount = Math.max(1, Math.floor(totalLength / segmentLength));

    for (let index = 0; index < straightCount; index += 1) {
      const t = (index + 0.5) / straightCount;
      const point = road.curve.getPointAt(Math.min(t, 0.995));
      const tangent = road.curve.getTangentAt(Math.min(t, 0.995)).setY(0).normalize();
      const straightTemplate = pickStraightAtlasTile(road, index, tangent, roadAtlas);
      if (!straightTemplate) {
        continue;
      }

      const straight = createFittedAssetClone(straightTemplate.group, {
        width: road.width + 7.2,
        depth: segmentLength,
        height: null
      });
      straight.position.set(point.x, 0.024, point.z);
      straight.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      group.add(straight);
    }
  }

  for (const node of graph.nodes) {
    const connections = node.connections?.length ? node.connections : collectNodeConnections(graph, node);
    const feature = createRoadAtlasNodeFeature(node, connections, roadAtlas);
    if (!feature) {
      continue;
    }

    group.add(feature);
  }

  return group;
}

function createIntersectionKitLayer(graph, kitAssets) {
  const group = new THREE.Group();

  for (const node of graph.nodes) {
    if (node.kind !== 'junction') {
      continue;
    }

    const template =
      node.roads.size >= 4 ? kitAssets.intersection4Way || kitAssets.intersectionT : kitAssets.intersectionT;

    if (!template || node.roads.size < 3) {
      continue;
    }

    const footprint = 16 + Math.min(node.roads.size, 4) * 4;
    const intersection = createFittedAssetClone(template, {
      width: footprint,
      depth: footprint,
      height: null
    });
    intersection.position.copy(node.point).setY(0.024);
    group.add(intersection);
  }

  return group;
}

function createBuildingKitLayer(blockLibrary, kitAssets) {
  const group = new THREE.Group();
  if (kitAssets.buildingAtlas) {
    return createBuildingAtlasLayer(blockLibrary, kitAssets.buildingAtlas);
  }

  const template = kitAssets.buildingMidrise;

  if (!template) {
    return group;
  }

  for (const block of blockLibrary) {
    if (block.district === 'park') {
      continue;
    }

    const [cx, cz] = block.center;
    const [sx, sz] = block.size;
    const district = DISTRICT_STYLE[block.district] || DISTRICT_STYLE.midrise;
    const lotInset = 5.4;
    const lotCountX = Math.max(1, Math.floor(sx / 24));
    const lotCountZ = Math.max(1, Math.floor(sz / 24));
    const lotWidth = (sx - lotInset * 2) / lotCountX;
    const lotDepth = (sz - lotInset * 2) / lotCountZ;

    for (let xi = 0; xi < lotCountX; xi += 1) {
      for (let zi = 0; zi < lotCountZ; zi += 1) {
        const seed = seededNoise((cx + xi * 11.4) * 0.21 + (cz + zi * 5.7) * 0.19);
        if (seed < 0.34) {
          continue;
        }

        const x = cx - sx * 0.5 + lotInset + lotWidth * (xi + 0.5);
        const z = cz - sz * 0.5 + lotInset + lotDepth * (zi + 0.5);
        const width = lotWidth * (0.7 + seed * 0.18);
        const depth = lotDepth * (0.68 + seededNoise(seed * 8.2) * 0.16);
        const height = district.baseHeight + seed * district.variance;
        const building = createFittedAssetClone(template, { width, depth, height });
        building.position.set(x, 0.02, z);
        if ((xi + zi) % 2 === 1) {
          building.rotation.y = Math.PI * 0.5;
        }
        group.add(building);
      }
    }
  }

  return group;
}

function createBuildingAtlasLayer(blockLibrary, buildingAtlas) {
  const group = new THREE.Group();
  const tileIds = Object.keys(buildingAtlas.tiles || {});
  if (!tileIds.length) {
    return group;
  }

  for (const block of blockLibrary) {
    if (block.district === 'park') {
      continue;
    }

    const [cx, cz] = block.center;
    const [sx, sz] = block.size;
    const district = DISTRICT_STYLE[block.district] || DISTRICT_STYLE.midrise;
    const lotInset = 5.4;
    const lotCountX = Math.max(1, Math.floor(sx / 24));
    const lotCountZ = Math.max(1, Math.floor(sz / 24));
    const lotWidth = (sx - lotInset * 2) / lotCountX;
    const lotDepth = (sz - lotInset * 2) / lotCountZ;

    for (let xi = 0; xi < lotCountX; xi += 1) {
      for (let zi = 0; zi < lotCountZ; zi += 1) {
        const seed = seededNoise((cx + xi * 11.4) * 0.21 + (cz + zi * 5.7) * 0.19);
        if (seed < 0.28) {
          continue;
        }

        const tile = pickBuildingAtlasTile(buildingAtlas, block.district, seed, xi, zi);
        if (!tile?.group?.children?.length) {
          continue;
        }

        const x = cx - sx * 0.5 + lotInset + lotWidth * (xi + 0.5);
        const z = cz - sz * 0.5 + lotInset + lotDepth * (zi + 0.5);
        const width = lotWidth * (0.72 + seed * 0.16);
        const depth = lotDepth * (0.7 + seededNoise(seed * 8.2) * 0.14);
        const height = district.baseHeight + seed * district.variance;
        const building = createFittedAssetClone(tile.group, { width, depth, height });
        building.position.set(x, 0.02, z);
        building.rotation.y = pickBuildingFacing(block, xi, zi);
        group.add(building);
      }
    }
  }

  return group;
}

function pickBuildingAtlasTile(buildingAtlas, district, seed, xi, zi) {
  const rowPreference =
    district === 'tower' || district === 'downtown'
      ? [0, 1, 2]
      : district === 'industrial' || district === 'warehouse'
        ? [1, 2, 0]
        : [2, 1, 0];
  const row = rowPreference[Math.floor(seed * rowPreference.length) % rowPreference.length];
  const column = Math.floor(seededNoise(seed * 37.1 + xi * 3.1 + zi * 5.7) * 3) % 3;
  const tileId = `tile_${column}_${row}`;
  return buildingAtlas.tiles?.[tileId] || null;
}

function pickBuildingFacing(block, xi, zi) {
  const eastWestBias = block.size[0] >= block.size[1];
  if (eastWestBias) {
    return zi % 2 === 0 ? 0 : Math.PI;
  }

  return xi % 2 === 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
}

function createFittedAssetClone(template, target) {
  const clone = template.clone(true);
  const wrapper = new THREE.Group();
  wrapper.add(clone);
  fitObjectToFootprint(clone, target);
  prepareRenderable(wrapper);
  return wrapper;
}

function createRoadAtlasNodeFeature(node, connections, roadAtlas) {
  const directions = connections.map((connection) => connection.direction.clone());
  const degree = directions.length;
  if (degree < 2) {
    return null;
  }

  if (degree >= 4) {
    const template = getRoadAtlasTile(roadAtlas, ROAD_ATLAS_ROLE_MAP.cross);
    if (!template) {
      return null;
    }

    const feature = createFittedAssetClone(template.group, { width: 28, depth: 28, height: null });
    feature.position.copy(node.point).setY(0.026);
    const heading = Math.atan2(directions[0].x, directions[0].z);
    feature.rotation.y = heading;
    return feature;
  }

  if (degree === 3) {
    const [axisForward, axisBackward, branch] = extractTeeAxes(directions);
    const templateId = isBranchOnLeft(axisForward, branch)
      ? ROAD_ATLAS_ROLE_MAP.teeLeft
      : ROAD_ATLAS_ROLE_MAP.teeRight;
    const template = getRoadAtlasTile(roadAtlas, templateId);
    if (!template) {
      return null;
    }

    const feature = createFittedAssetClone(template.group, { width: 26, depth: 26, height: null });
    feature.position.copy(node.point).setY(0.026);
    feature.rotation.y = Math.atan2(axisForward.x, axisForward.z);
    return feature;
  }

  const dot = directions[0].dot(directions[1]);
  if (dot > -0.82) {
    const forward = directions[0].clone().normalize();
    const sideDirection = directions[1].clone().normalize();
    const templateId = isBranchOnLeft(forward, sideDirection)
      ? ROAD_ATLAS_ROLE_MAP.curveLeft
      : ROAD_ATLAS_ROLE_MAP.curveRight;
    const template = getRoadAtlasTile(roadAtlas, templateId);
    if (!template) {
      return null;
    }

    const feature = createFittedAssetClone(template.group, { width: 24, depth: 24, height: null });
    feature.position.copy(node.point).setY(0.026);
    feature.rotation.y = Math.atan2(forward.x, forward.z) + Math.PI;
    return feature;
  }

  return null;
}

function extractTeeAxes(directions) {
  let bestPair = [directions[0], directions[1]];
  let bestDot = Number.POSITIVE_INFINITY;

  for (let leftIndex = 0; leftIndex < directions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < directions.length; rightIndex += 1) {
      const dot = directions[leftIndex].dot(directions[rightIndex]);
      if (dot < bestDot) {
        bestDot = dot;
        bestPair = [directions[leftIndex], directions[rightIndex]];
      }
    }
  }

  const branch =
    directions.find((direction) => direction !== bestPair[0] && direction !== bestPair[1]) || directions[0];
  const axisForward = bestPair[0].clone().normalize();
  const axisBackward = bestPair[1].clone().normalize();
  return [axisForward, axisBackward, branch.clone().normalize()];
}

function isBranchOnLeft(forward, branch) {
  const left = new THREE.Vector3(-forward.z, 0, forward.x);
  return branch.dot(left) > 0;
}

function pickStraightAtlasTile(road, index, tangent, roadAtlas) {
  const useVertical = Math.abs(tangent.z) >= Math.abs(tangent.x);

  if (useVertical) {
    const tileId = index % 2 === 0 ? ROAD_ATLAS_ROLE_MAP.straightVerticalA : ROAD_ATLAS_ROLE_MAP.straightVerticalB;
    return getRoadAtlasTile(roadAtlas, tileId);
  }

  const tileId = index % 2 === 0 ? ROAD_ATLAS_ROLE_MAP.straightHorizontalA : ROAD_ATLAS_ROLE_MAP.straightHorizontalB;
  return getRoadAtlasTile(roadAtlas, tileId);
}

function getRoadAtlasTile(roadAtlas, tileId) {
  return roadAtlas?.tiles?.[tileId] || null;
}

function fitObjectToFootprint(object, { width, depth, height = null }) {
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) {
    return;
  }

  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const footprint = object.userData.fitFootprint || object.userData.roadAtlasTile?.footprint || null;
  object.position.sub(center);
  object.position.y += size.y * 0.5;

  const safeWidth = Math.max(footprint?.width ?? size.x, 0.001);
  const safeDepth = Math.max(footprint?.depth ?? size.z, 0.001);
  const safeHeight = Math.max(size.y, 0.001);
  object.scale.set(
    width ? width / safeWidth : 1,
    height ? height / safeHeight : 1,
    depth ? depth / safeDepth : 1
  );

  object.updateMatrixWorld(true);
  const fittedBounds = new THREE.Box3().setFromObject(object);
  object.position.y -= fittedBounds.min.y;
}

function prepareRenderable(rootObject) {
  rootObject.traverse((child) => {
    if (!child.isMesh) {
      return;
    }

    child.castShadow = true;
    child.receiveShadow = true;
  });
}

function clearGroup(group, disposeObjectTree) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObjectTree?.(child);
  }
}

function createStreetLight(materials) {
  const group = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 6.8, 10), materials.pole);
  stem.position.y = 3.4;
  stem.castShadow = true;
  stem.receiveShadow = true;

  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.08), materials.pole);
  arm.position.set(0.54, 6.26, 0);
  arm.castShadow = true;
  arm.receiveShadow = true;

  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.28), materials.lamp);
  lamp.position.set(1.04, 6.1, 0);

  group.add(stem, arm, lamp);
  return group;
}

function createInstancedStreetLights(materials, instances) {
  const group = new THREE.Group();
  const stemGeometry = new THREE.CylinderGeometry(0.09, 0.11, 6.8, 10);
  const armGeometry = new THREE.BoxGeometry(1.3, 0.08, 0.08);
  const lampGeometry = new THREE.BoxGeometry(0.24, 0.18, 0.28);
  const stemMesh = new THREE.InstancedMesh(stemGeometry, materials.pole, instances.length);
  const armMesh = new THREE.InstancedMesh(armGeometry, materials.pole, instances.length);
  const lampMesh = new THREE.InstancedMesh(lampGeometry, materials.lamp, instances.length);
  const matrix = new THREE.Matrix4();
  const baseQuaternion = new THREE.Quaternion();
  const localQuaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);

  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index];
    baseQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), instance.yaw || 0);

    position.copy(instance.position).add(new THREE.Vector3(0, 3.4, 0));
    matrix.compose(position, baseQuaternion, scale);
    stemMesh.setMatrixAt(index, matrix);

    position.copy(instance.position).add(new THREE.Vector3(0.54, 6.26, 0).applyQuaternion(baseQuaternion));
    localQuaternion.copy(baseQuaternion);
    matrix.compose(position, localQuaternion, scale);
    armMesh.setMatrixAt(index, matrix);

    position.copy(instance.position).add(new THREE.Vector3(1.04, 6.1, 0).applyQuaternion(baseQuaternion));
    matrix.compose(position, baseQuaternion, scale);
    lampMesh.setMatrixAt(index, matrix);
  }

  stemMesh.instanceMatrix.needsUpdate = true;
  armMesh.instanceMatrix.needsUpdate = true;
  lampMesh.instanceMatrix.needsUpdate = true;
  stemMesh.castShadow = false;
  stemMesh.receiveShadow = false;
  armMesh.castShadow = false;
  armMesh.receiveShadow = false;
  lampMesh.castShadow = false;
  lampMesh.receiveShadow = false;
  group.add(stemMesh, armMesh, lampMesh);
  return group;
}

function createTreeCluster(x, z, materials) {
  const group = new THREE.Group();
  for (const [dx, dz, scale] of [
    [-1.4, -0.8, 1.1],
    [1.2, -0.4, 0.95],
    [-0.6, 1.3, 1.05]
  ]) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 2.2, 8), materials.trunk);
    trunk.position.set(dx, 1.1, dz);
    trunk.castShadow = true;
    trunk.receiveShadow = true;

    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.45, 0), materials.tree);
    crown.position.set(dx, 3.1, dz);
    crown.scale.setScalar(scale);
    crown.castShadow = true;
    crown.receiveShadow = true;
    group.add(trunk, crown);
  }

  group.position.set(x, 0, z);
  return group;
}

function createOrientedStartLine(position, tangent) {
  const group = new THREE.Group();
  const heading = Math.atan2(tangent.x, tangent.z);

  for (let index = 0; index < 10; index += 1) {
    const tile = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.6),
      new THREE.MeshBasicMaterial({
        color: index % 2 === 0 ? '#f5f7ff' : '#121720',
        side: THREE.DoubleSide
      })
    );
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(-4.95 + index * 1.1, 0, 0);
    group.add(tile);
  }

  group.rotation.y = heading;
  group.position.copy(position);
  return group;
}

function createTrackRibbon(curve, options) {
  const {
    width,
    samples,
    y,
    uvScale,
    offset = 0,
    tStart = 0,
    tEnd = 1
  } = options;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let distance = 0;
  let previousPoint = curve.getPointAt(tStart);

  for (let index = 0; index <= samples; index += 1) {
    const t = THREE.MathUtils.lerp(tStart, tEnd, index / samples);
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).setY(0).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);

    if (index > 0) {
      distance += point.distanceTo(previousPoint);
    }
    previousPoint = point;

    const center = point.clone().addScaledVector(side, offset);
    const left = center.clone().addScaledVector(side, width * 0.5);
    const right = center.clone().addScaledVector(side, -width * 0.5);
    left.y = y;
    right.y = y;

    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    normals.push(0, 1, 0, 0, 1, 0);
    uvs.push(0, distance * uvScale, 1, distance * uvScale);

    if (index < samples) {
      const base = index * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
}

function createAsphaltTextureSet() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');

  context.fillStyle = '#4a4f56';
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < 3800; index += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const value = 38 + Math.random() * 48;
    context.fillStyle = `rgba(${value}, ${value}, ${value}, ${0.08 + Math.random() * 0.08})`;
    context.fillRect(x, y, 2, 2);
  }

  context.strokeStyle = 'rgba(30, 34, 38, 0.42)';
  context.lineWidth = 1.2;
  for (let index = 0; index < 16; index += 1) {
    context.beginPath();
    const startX = Math.random() * canvas.width;
    const startY = Math.random() * canvas.height;
    context.moveTo(startX, startY);
    context.bezierCurveTo(
      startX + 24 + Math.random() * 64,
      startY + Math.random() * 32,
      startX + 80 + Math.random() * 80,
      startY - 20 - Math.random() * 34,
      startX + 132 + Math.random() * 96,
      startY + 12 + Math.random() * 24
    );
    context.stroke();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(6.4, 32);
  map.anisotropy = 8;
  map.colorSpace = THREE.SRGBColorSpace;
  return { map };
}

function getPolylineLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += points[index].distanceTo(points[index - 1]);
  }
  return total;
}

function smoothstepScalar(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001), 0, 1);
  return t * t * (3 - 2 * t);
}

function seededNoise(seed) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}
