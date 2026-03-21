import * as THREE from 'three';
import { createHighwayNavigation, createWaypointLoopNavigation } from './autopilot.js';
import { createBloomvilleStage } from './bloomville-stage.js';
import { BUILDING_ASSET_MODE_GLB_ONLY } from './catalog-lod.js';
import { createCityStage } from './city-stage.js';
import { createSanVerdeStage } from './san-verde-stage.js';
import { resolveModelUrl } from '../assets/asset-base-url.js';

let testGroundTexture = null;

export const STAGE_OPTIONS = [
  { id: 'test_course', label: 'Test Course' },
  { id: 'highway', label: 'Highway' },
  { id: 'city', label: 'City Grid' },
  { id: 'bloomville', label: 'Bloomville' },
  { id: 'bloomville_glb', label: 'Bloomville GLB' },
  { id: 'san_verde', label: 'San Verde' },
  { id: 'san_verde_test', label: 'San Verde (Test)' },
  { id: 'san_verde_glb', label: 'San Verde GLB' }
];

export function getStageLabel(stageId) {
  return STAGE_OPTIONS.find((stage) => stage.id === stageId)?.label || 'Stage';
}

export async function createStage(stageId = 'test_course', dependencies = {}) {
  if (stageId === 'bloomville') {
    return createBloomvilleStage(dependencies);
  }

  if (stageId === 'bloomville_glb') {
    return createBloomvilleStage({
      ...dependencies,
      buildingAssetMode: BUILDING_ASSET_MODE_GLB_ONLY
    });
  }

  if (stageId === 'city') {
    return createCityStage(dependencies);
  }

  if (stageId === 'highway') {
    return createHighwayStage(dependencies);
  }

  if (stageId === 'san_verde') {
    return createSanVerdeStage(dependencies);
  }

  if (stageId === 'san_verde_test') {
    return createSanVerdeStage({
      ...dependencies,
      assignedGlbOnly: true
    });
  }

  if (stageId === 'san_verde_glb') {
    return createSanVerdeStage({
      ...dependencies,
      buildingAssetMode: BUILDING_ASSET_MODE_GLB_ONLY
    });
  }

  return createTestCourseStage();
}

function createTestCourseStage() {
  const group = new THREE.Group();
  const groundTexture = getTestGroundTexture();

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(120, 144),
    new THREE.MeshPhysicalMaterial({
      color: '#071019',
      roughness: 0.9,
      metalness: 0.04
    })
  );
  floor.material.userData.noGround = true;
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 160),
    new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      roughness: 0.94,
      metalness: 0.04,
      clearcoat: 0.06,
      map: groundTexture
    })
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.y = 0.014;
  asphalt.receiveShadow = true;
  group.add(asphalt);

  const padBorder = new THREE.Mesh(
    new THREE.RingGeometry(78, 85, 128),
    new THREE.MeshBasicMaterial({
      color: '#14304c',
      transparent: true,
      opacity: 0.42
    })
  );
  padBorder.userData.noSuspension = true;
  padBorder.userData.noCollision = true;
  padBorder.rotation.x = -Math.PI / 2;
  padBorder.position.y = 0.018;
  group.add(padBorder);

  // Drift ring marker
  const driftRing = new THREE.Mesh(
    new THREE.RingGeometry(34, 35.2, 128),
    new THREE.MeshBasicMaterial({ color: '#f4f1df', transparent: true, opacity: 0.5 })
  );
  driftRing.userData.noSuspension = true;
  driftRing.userData.noCollision = true;
  driftRing.rotation.x = -Math.PI / 2;
  driftRing.position.y = 0.022;
  group.add(driftRing);

  group.add(createSandboxStartLine(new THREE.Vector3(0, 0.03, 26)));
  group.add(createSandboxGuideMarks());
  group.add(createSandboxCones(55));
  group.add(createSuspensionTestFeatures());
  group.add(createCourseBoundaryWalls());

  // Portal
  const PORTAL_SPECS = [
    { position: new THREE.Vector3(-10, 0, -75), label: 'San Verde', color: '#00e5ff', target: 'san_verde', rotY: Math.PI },
    { position: new THREE.Vector3(10, 0, -75), label: 'San Verde (Test)', color: '#ff4343', target: 'san_verde_test', rotY: Math.PI }
  ];

  const portalObjects = PORTAL_SPECS.map((spec) => {
    const portalGroup = createPortalObject(spec.label, spec.color);
    portalGroup.position.copy(spec.position);
    portalGroup.rotation.y = spec.rotY;
    group.add(portalGroup);
    return { mesh: portalGroup, position: spec.position.clone(), target: spec.target };
  });

  return {
    id: 'test_course',
    group,
    startPosition: new THREE.Vector3(0, 0, 21),
    startYaw: Math.PI,
    driveBounds: 74,
    navigation: createWaypointLoopNavigation([
      new THREE.Vector3(0, 0, 55),
      new THREE.Vector3(42, 0, 38),
      new THREE.Vector3(55, 0, 0),
      new THREE.Vector3(38, 0, -42),
      new THREE.Vector3(0, 0, -55),
      new THREE.Vector3(-42, 0, -38),
      new THREE.Vector3(-55, 0, 0),
      new THREE.Vector3(-38, 0, 42)
    ]),
    agentNavigation: null,
    agentNavigationRevision: 0,
    update(vehiclePosition) {
      const t = performance.now() * 0.001;
      for (const portal of portalObjects) {
        portal.mesh.userData.ring.rotation.z = t * 0.7;
      }
      for (const portal of portalObjects) {
        const dx = vehiclePosition.x - portal.position.x;
        const dz = vehiclePosition.z - portal.position.z;
        if (dx * dx + dz * dz < 36) {
          return { type: 'portal', destination: portal.target };
        }
      }
    }
  };
}

function createPortalObject(label, color) {
  const group = new THREE.Group();
  group.userData.noSuspension = true;
  group.userData.noCollision = true;

  const RADIUS = 3.4;
  const centerY = RADIUS + 0.4;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(RADIUS, 0.22, 16, 72),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
  );
  ring.position.y = centerY;
  group.userData.ring = ring;
  group.add(ring);


  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 66px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 256, 64);
  const labelMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(5.8, 1.45),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      side: THREE.DoubleSide
    })
  );
  labelMesh.position.y = centerY + RADIUS + 0.9;
  labelMesh.rotation.y = Math.PI;
  group.add(labelMesh);

  return group;
}

function getTestGroundTexture() {
  if (testGroundTexture) {
    return testGroundTexture;
  }

  testGroundTexture = new THREE.TextureLoader().load(resolveModelUrl('/texture.png'));
  testGroundTexture.wrapS = THREE.RepeatWrapping;
  testGroundTexture.wrapT = THREE.RepeatWrapping;
  testGroundTexture.repeat.set(5, 5);
  testGroundTexture.anisotropy = 8;
  testGroundTexture.colorSpace = THREE.SRGBColorSpace;
  return testGroundTexture;
}

function createHighwayStage({ disposeObjectTree } = {}) {
  const group = new THREE.Group();
  const chunkRoot = new THREE.Group();
  group.add(chunkRoot);
  const highway = createStreamingHighway(chunkRoot, { disposeObjectTree });
  const startPoint = highway.chunks[1]?.meta.start.clone() || new THREE.Vector3(0, 0, -60);
  const startHeading = highway.chunks[1]?.meta.heading ?? 0;
  group.add(
    createOrientedStartLine(
      startPoint.clone().setY(0.048),
      new THREE.Vector3(Math.sin(startHeading), 0, Math.cos(startHeading))
    )
  );

  return {
    id: 'highway',
    group,
    startPosition: startPoint.clone().setY(0),
    startYaw: startHeading,
    driveBounds: Number.POSITIVE_INFINITY,
    navigation: createHighwayNavigation(highway),
    agentNavigation: null,
    agentNavigationRevision: 0,
    physicsRevision: 0,
    update(vehiclePosition) {
      if (highway.update(vehiclePosition)) {
        this.physicsRevision += 1;
      }
    }
  };
}

function createStreamingHighway(group, { disposeObjectTree } = {}) {
  const disposeChunk = disposeObjectTree || (() => {});
  const materials = {
    road: new THREE.MeshPhysicalMaterial({
      color: '#3a3f45',
      roughness: 0.97,
      metalness: 0.04,
      clearcoat: 0.03,
      map: createAsphaltTextureSet().map
    }),
    shoulder: new THREE.MeshPhysicalMaterial({
      color: '#60656b',
      roughness: 0.98,
      metalness: 0.02,
      map: createShoulderTextureSet().map
    }),
    edgeLine: new THREE.MeshBasicMaterial({
      color: '#f4f1df',
      transparent: true,
      opacity: 0.88
    }),
    centerLine: new THREE.MeshBasicMaterial({
      color: '#f6e5a2',
      transparent: true,
      opacity: 0.84
    }),
    guard: new THREE.MeshStandardMaterial({
      color: '#c2c8d2',
      roughness: 0.42,
      metalness: 0.74
    }),
    post: new THREE.MeshStandardMaterial({
      color: '#dad9d2',
      roughness: 0.74,
      metalness: 0.12
    }),
    reflector: new THREE.MeshBasicMaterial({
      color: '#ff6f5a'
    })
  };

  const highway = {
    chunks: [],
    nextIndex: 0,
    cursor: new THREE.Vector3(0, 0, -220),
    heading: 0,
    minAheadDistance: 260,
    maxRetainedChunks: 14,
    retainBehindDistance: 360,
    update(vehiclePosition) {
      let changed = false;
      const minAheadDistanceSq = this.minAheadDistance * this.minAheadDistance;
      const retainBehindDistanceSq = this.retainBehindDistance * this.retainBehindDistance;

      while (
        !this.chunks.length ||
        vehiclePosition.distanceToSquared(this.chunks[this.chunks.length - 1].meta.end) < minAheadDistanceSq
      ) {
        const chunk = createHighwayChunk(this.nextIndex, this.cursor, this.heading, materials);
        this.chunks.push(chunk);
        group.add(chunk.group);
        this.cursor = chunk.meta.end.clone();
        this.heading = chunk.meta.endHeading;
        this.nextIndex += 1;
        changed = true;
      }

      while (
        this.chunks.length > this.maxRetainedChunks &&
        vehiclePosition.distanceToSquared(this.chunks[0].meta.end) > retainBehindDistanceSq
      ) {
        const staleChunk = this.chunks.shift();
        group.remove(staleChunk.group);
        disposeChunk(staleChunk.group, { disposeMaterials: false });
        changed = true;
      }

      return changed;
    }
  };

  highway.update(new THREE.Vector3(0, 0, -120));
  return highway;
}

function createHighwayChunk(index, start, heading, materials) {
  const spec = getHighwayChunkSpec(index);
  const { points, end, endHeading, approximateLength } = buildHighwayChunkPath(start, heading, spec);
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.2);
  const samples = Math.max(Math.round(approximateLength / 3.2), 14);
  const group = new THREE.Group();

  const shoulder = createTrackRibbon(curve, {
    width: 18.4,
    samples,
    y: 0.032,
    uvScale: 0.07
  });
  shoulder.material = materials.shoulder;
  shoulder.receiveShadow = true;
  group.add(shoulder);

  const road = createTrackRibbon(curve, {
    width: 14.2,
    samples,
    y: 0.04,
    uvScale: 0.076
  });
  road.material = materials.road;
  road.receiveShadow = true;
  group.add(road);

  const centerMarks = createTrackLaneMarks(curve, {
    count: Math.max(Math.round(approximateLength / 10), 6),
    width: 0.22,
    length: 5.2,
    y: 0.046
  });
  centerMarks.traverse((child) => {
    if (child.isMesh) {
      child.material = materials.centerLine;
    }
  });
  group.add(centerMarks);

  for (const offset of [-6.65, 6.65]) {
    const edgeLine = createTrackRibbon(curve, {
      width: 0.2,
      samples,
      y: 0.048,
      uvScale: 0.14,
      offset
    });
    edgeLine.material = materials.edgeLine;
    group.add(edgeLine);
  }

  const leftGuard = createTrackRibbon(curve, {
    width: 0.28,
    samples,
    y: 0.56,
    uvScale: 0.034,
    offset: 9.6
  });
  leftGuard.material = materials.guard;
  group.add(leftGuard);

  const rightGuard = createTrackRibbon(curve, {
    width: 0.28,
    samples,
    y: 0.56,
    uvScale: 0.034,
    offset: -9.6
  });
  rightGuard.material = materials.guard;
  group.add(rightGuard);

  group.add(createChunkTerrainPatch(points, approximateLength, heading, spec.turn, 1, index));
  group.add(createChunkTerrainPatch(points, approximateLength, heading, spec.turn, -1, index));
  group.add(createHighwayChunkPosts(curve, Math.max(Math.round(approximateLength / 16), 4), 10, materials));

  return {
    group,
    meta: {
      index,
      start: start.clone(),
      end,
      heading,
      endHeading,
      midpoint: curve.getPointAt(0.5),
      approximateLength,
      points,
      curve
    }
  };
}

function getHighwayChunkSpec(index) {
  if (index < 3) {
    return { type: 'straight', length: 96, turn: 0 };
  }

  const turnChance = seededNoise(index * 17.13);
  if (turnChance < 0.38) {
    const direction = seededNoise(index * 29.41) > 0.5 ? 1 : -1;
    return {
      type: 'bend',
      length: 68 + seededNoise(index * 11.7) * 34,
      turn: direction * (0.18 + seededNoise(index * 7.3) * 0.28)
    };
  }

  return {
    type: 'straight',
    length: 84 + seededNoise(index * 13.9) * 42,
    turn: 0
  };
}

function buildHighwayChunkPath(start, heading, spec) {
  const points = [start.clone()];
  let cursor = start.clone();
  let currentHeading = heading;
  const segments = Math.max(Math.round(spec.length / 12), 5);

  for (let index = 0; index < segments; index += 1) {
    if (spec.type === 'bend') {
      currentHeading += spec.turn / segments;
    }

    const stepLength = spec.length / segments;
    cursor = cursor.clone().add(new THREE.Vector3(
      Math.sin(currentHeading) * stepLength,
      0,
      Math.cos(currentHeading) * stepLength
    ));
    points.push(cursor.clone());
  }

  return {
    points,
    end: cursor.clone(),
    endHeading: currentHeading,
    approximateLength: spec.length
  };
}

function createChunkTerrainPatch(points, length, heading, turn, sideSign, seed) {
  const midpoint = points[Math.floor(points.length * 0.5)].clone();
  const meanHeading = heading + turn * 0.5;
  const side = new THREE.Vector3(-Math.cos(meanHeading), 0, Math.sin(meanHeading)).multiplyScalar(sideSign);
  const patch = new THREE.Mesh(
    new THREE.PlaneGeometry(54, length + 26, 12, 26),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0.02
    })
  );
  patch.rotation.x = -Math.PI / 2;
  patch.rotation.z = -meanHeading;
  patch.position.copy(midpoint).addScaledVector(side, 34);
  patch.position.y = -0.08;

  const geometry = patch.geometry;
  const position = geometry.attributes.position;
  const colors = [];
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const shoulderBlend = smoothstepScalar(10, 26, Math.abs(x));
    const height =
      (Math.sin((x + seed * 3.1) * 0.12) * 1.6 +
        Math.cos((z - seed * 1.7) * 0.055) * 2.1 +
        Math.sin((x + z + seed * 2.3) * 0.04) * 3.4) *
      shoulderBlend;
    position.setY(index, height);

    const tint = 0.16 + shoulderBlend * 0.22;
    colors.push(0.1 + tint * 0.24, 0.19 + tint * 0.48, 0.11 + tint * 0.18);
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  patch.receiveShadow = true;
  return patch;
}

function createHighwayChunkPosts(curve, count, offset, materials) {
  const group = new THREE.Group();
  const stemGeometry = new THREE.BoxGeometry(0.08, 0.72, 0.08);
  const reflectorGeometry = new THREE.BoxGeometry(0.12, 0.08, 0.04);

  for (let index = 0; index < count; index += 1) {
    const t = index / Math.max(count - 1, 1);
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).setY(0).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);

    for (const direction of [-1, 1]) {
      const post = new THREE.Group();
      const stem = new THREE.Mesh(stemGeometry, materials.post);
      stem.position.y = 0.36;
      const reflector = new THREE.Mesh(reflectorGeometry, materials.reflector);
      reflector.position.set(0, 0.54, direction > 0 ? -0.04 : 0.04);
      post.add(stem, reflector);
      post.position.copy(point).addScaledVector(side, offset * direction);
      post.position.y = 0.05;
      post.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      group.add(post);
    }
  }

  return group;
}

function createCourseBoundaryWalls() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: '#1c222c',
    roughness: 0.88,
    metalness: 0.06
  });
  const H = 0.52;
  const T = 0.55;
  const HALF = 76;
  const walls = [
    { x: 0,     z:  HALF, w: HALF * 2 + T * 2, d: T },
    { x: 0,     z: -HALF, w: HALF * 2 + T * 2, d: T },
    { x:  HALF, z: 0,     w: T, d: HALF * 2 },
    { x: -HALF, z: 0,     w: T, d: HALF * 2 }
  ];
  for (const wall of walls) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(wall.w, H, wall.d), material);
    mesh.position.set(wall.x, H * 0.5, wall.z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

function createSandboxStartLine(position) {
  const group = new THREE.Group();
  group.userData.noSuspension = true;
  group.userData.noCollision = true;

  for (let index = 0; index < 10; index += 1) {
    const tile = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.6),
      new THREE.MeshBasicMaterial({
        color: index % 2 === 0 ? '#f5f7ff' : '#121720',
        side: THREE.DoubleSide
      })
    );
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(position.x - 4.95 + index * 1.1, position.y, position.z);
    group.add(tile);
  }

  return group;
}

function createSandboxGuideMarks() {
  const group = new THREE.Group();
  group.userData.noSuspension = true;
  group.userData.noCollision = true;
  const material = new THREE.MeshBasicMaterial({
    color: '#f1edd2',
    transparent: true,
    opacity: 0.78
  });
  const strips = [
    { x: -12, z: 8, rotation: 0 },
    { x: 12, z: 8, rotation: 0 },
    { x: -12, z: -6, rotation: 0 },
    { x: 12, z: -6, rotation: 0 },
    { x: 0, z: -18, rotation: Math.PI * 0.5 },
    { x: 0, z: 2, rotation: Math.PI * 0.5 }
  ];

  for (const strip of strips) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 6.2), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = strip.rotation;
    mesh.position.set(strip.x, 0.03, strip.z);
    group.add(mesh);
  }

  return group;
}

function createSandboxCones(ringRadius = 30) {
  const group = new THREE.Group();
  const coneMaterial = new THREE.MeshStandardMaterial({
    color: '#ff8748',
    roughness: 0.72,
    metalness: 0.05
  });
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: '#11141b',
    roughness: 0.86,
    metalness: 0.08
  });
  const positions = [];
  const ringCount = 64;
  for (let index = 0; index < ringCount; index += 1) {
    const angle = (index / ringCount) * Math.PI * 2;
    positions.push([
      Math.cos(angle) * ringRadius,
      0,
      Math.sin(angle) * ringRadius
    ]);
  }

  for (const [x, y, z] of positions) {
    const cone = new THREE.Group();
    cone.name = 'sandbox-cone';
    cone.userData.bounceDynamic = 'cone';
    cone.userData.bounceConeSpec = {
      radius: 0.16,
      height: 0.92,
      mass: 1.5,
      friction: 0.08,
      restitution: 0.06
    };
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.28, 0.9, 20), coneMaterial);
    top.position.y = y + 0.48;
    top.castShadow = true;
    top.receiveShadow = true;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 20), baseMaterial);
    base.position.y = y + 0.04;
    base.castShadow = true;
    base.receiveShadow = true;
    cone.add(top, base);
    cone.position.set(x, 0, z);
    group.add(cone);
  }

  return group;
}

function createSuspensionTestFeatures() {
  const group = new THREE.Group();
  const asphalt = new THREE.MeshStandardMaterial({
    color: '#343a41',
    roughness: 0.96,
    metalness: 0.03
  });
  const stripe = new THREE.MeshBasicMaterial({
    color: '#efe2a8',
    transparent: true,
    opacity: 0.82
  });

  const speedBump = createRoundedBump(asphalt, 8.4, 1.92, 0.16);
  speedBump.position.set(0, 0, 12);
  speedBump.castShadow = true;
  speedBump.receiveShadow = true;
  group.add(speedBump);
  group.add(createFeatureStripe(0, 12.02, 8.6, 0.34));

  const whoopPositions = [-8.5, -2.5, 3.5];
  for (const x of whoopPositions) {
    const mound = createRoundedBump(asphalt, 4.4, 1.44, 0.12);
    mound.position.set(x, 0, -2);
    mound.castShadow = true;
    mound.receiveShadow = true;
    group.add(mound);
  }

  const staggeredBumpPositions = [
    { x: -14.2, z: -11.4 },
    { x: -10.8, z: -8.4 },
    { x: -14.2, z: -5.4 },
    { x: -10.8, z: -2.4 },
    { x: -14.2, z: 0.6 },
    { x: -10.8, z: 3.6 }
  ];
  for (const bump of staggeredBumpPositions) {
    const mound = createEllipsoidBump(asphalt, 1.95, 2.75, 0.22);
    mound.position.set(bump.x, 0, bump.z);
    mound.castShadow = true;
    mound.receiveShadow = true;
    group.add(mound);
  }
  group.add(createFeatureStripe(-12.5, -3.9, 5.9, 19.5));

  const ramp = createSandboxRamp(asphalt, 4.8, 7.6, 0.75);
  ramp.position.set(16, 0, -13.8);
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  group.add(ramp);
  group.add(createFeatureStripe(16, -10.1, 4.4, 0.34));

  const landingPad = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 10.5), new THREE.MeshBasicMaterial({
    color: '#dfe5ef',
    transparent: true,
    opacity: 0.28
  }));
  landingPad.userData.noSuspension = true;
  landingPad.userData.noCollision = true;
  landingPad.rotation.x = -Math.PI / 2;
  landingPad.position.set(16, 0.026, -18);
  group.add(landingPad);

  return group;
}

function createFeatureStripe(x, z, width, depth) {
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({
      color: '#f4f1df',
      transparent: true,
      opacity: 0.78
    })
  );
  stripe.userData.noSuspension = true;
  stripe.userData.noCollision = true;
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(x, 0.036, z);
  return stripe;
}

function createRoundedBump(material, length, width, height, segments = 18) {
  const shape = new THREE.Shape();
  shape.moveTo(-width * 0.5, 0);

  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const angle = Math.PI - t * Math.PI;
    const x = Math.cos(angle) * width * 0.5;
    const y = Math.sin(angle) * height;
    shape.lineTo(x, y);
  }

  shape.lineTo(width * 0.5, 0);
  shape.lineTo(-width * 0.5, 0);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    bevelEnabled: false,
    steps: 1
  });
  geometry.translate(0, 0, -length * 0.5);
  geometry.rotateY(Math.PI * 0.5);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function createEllipsoidBump(material, width, length, height) {
  const bump = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), material);
  bump.scale.set(width * 0.5, height, length * 0.5);
  bump.position.y = height * 0.5;
  return bump;
}

function createSandboxRamp(material, width, length, height) {
  const halfWidth = width * 0.5;
  const halfLength = length * 0.5;
  const positions = new Float32Array([
    -halfWidth, 0, halfLength,
    halfWidth, 0, halfLength,
    -halfWidth, height, -halfLength,
    halfWidth, height, -halfLength,
    -halfWidth, 0, -halfLength,
    halfWidth, 0, -halfLength
  ]);
  const indices = [
    0, 1, 2, 1, 3, 2, // slope
    4, 2, 5, 5, 2, 3, // back
    0, 4, 1, 1, 4, 5, // bottom
    0, 2, 4,          // left
    1, 5, 3           // right
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const ramp = new THREE.Mesh(geometry, material);
  return ramp;
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

function createAsphaltTextureSet() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');

  context.fillStyle = '#4c5158';
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < 4200; index += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const value = 36 + Math.random() * 54;
    context.fillStyle = `rgba(${value}, ${value}, ${value}, ${0.08 + Math.random() * 0.08})`;
    context.fillRect(x, y, 2, 2);
  }

  context.strokeStyle = 'rgba(32, 35, 39, 0.46)';
  context.lineWidth = 1.2;
  for (let index = 0; index < 18; index += 1) {
    context.beginPath();
    const startX = Math.random() * canvas.width;
    const startY = Math.random() * canvas.height;
    context.moveTo(startX, startY);
    context.bezierCurveTo(
      startX + 30 + Math.random() * 70,
      startY + Math.random() * 30,
      startX + 80 + Math.random() * 60,
      startY - 20 - Math.random() * 30,
      startX + 140 + Math.random() * 90,
      startY + 10 + Math.random() * 25
    );
    context.stroke();
  }

  context.fillStyle = 'rgba(92, 97, 104, 0.18)';
  for (let index = 0; index < 80; index += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const width = 12 + Math.random() * 28;
    const height = 6 + Math.random() * 18;
    context.fillRect(x, y, width, height);
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(5.5, 26);
  map.anisotropy = 8;
  map.colorSpace = THREE.SRGBColorSpace;
  return { map };
}

function createShoulderTextureSet() {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 384;
  const context = canvas.getContext('2d');

  context.fillStyle = '#747170';
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < 5400; index += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const shade = 80 + Math.random() * 90;
    const alpha = 0.08 + Math.random() * 0.18;
    const size = 1 + Math.random() * 3;
    context.fillStyle = `rgba(${shade}, ${shade - 4}, ${shade - 10}, ${alpha})`;
    context.beginPath();
    context.arc(x, y, size, 0, Math.PI * 2);
    context.fill();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(7, 28);
  map.anisotropy = 8;
  map.colorSpace = THREE.SRGBColorSpace;
  return { map };
}

function createTrackRibbon(curve, options) {
  const { width, samples, y, uvScale, offset = 0 } = options;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let distance = 0;
  let previousPoint = curve.getPointAt(0);

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
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
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
}

function createTrackLaneMarks(curve, options) {
  const { count, width, length, y } = options;
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: '#f7f3cf',
    transparent: true,
    opacity: 0.88
  });

  for (let index = 0; index < count; index += 1) {
    const t = index / count;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).setY(0).normalize();
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(width, length), material);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(point.x, y, point.z);
    dash.quaternion.multiply(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent)
    );
    group.add(dash);
  }

  return group;
}

function smoothstepScalar(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001), 0, 1);
  return t * t * (3 - 2 * t);
}

function seededNoise(seed) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}
