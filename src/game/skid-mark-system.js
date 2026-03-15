import * as THREE from 'three';

const SIDE = new THREE.Vector3();
const FORWARD = new THREE.Vector3();
const NORMAL = new THREE.Vector3();
const SCALE = new THREE.Vector3();
const MATRIX = new THREE.Matrix4();
const BASIS = new THREE.Matrix4();
const DEFAULT_OPTIONS = {
  capacity: 384,
  color: '#120f0d',
  opacity: 0.24,
  lift: 0.015
};

export function createSkidMarkSystem(parent, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    color: settings.color,
    transparent: true,
    opacity: settings.opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  material.userData.noGround = true;

  const mesh = new THREE.InstancedMesh(geometry, material, settings.capacity);
  mesh.name = 'skid-marks';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.noSuspension = true;
  mesh.userData.noCollision = true;

  parent.add(mesh);

  return {
    mesh,
    capacity: settings.capacity,
    nextIndex: 0,
    lift: settings.lift
  };
}

export function emitSkidMark(system, { position, normal, forward, width, length }) {
  if (!system?.mesh || !position || !normal || !forward) {
    return;
  }

  NORMAL.copy(normal).normalize();
  FORWARD.copy(forward).projectOnPlane(NORMAL);
  if (FORWARD.lengthSq() < 1e-6) {
    return;
  }
  FORWARD.normalize();
  SIDE.crossVectors(FORWARD, NORMAL);
  if (SIDE.lengthSq() < 1e-6) {
    return;
  }
  SIDE.normalize();

  BASIS.makeBasis(SIDE, FORWARD, NORMAL);
  SCALE.set(width, length, 1);
  MATRIX.copy(BASIS).scale(SCALE);
  MATRIX.setPosition(
    position.x + NORMAL.x * system.lift,
    position.y + NORMAL.y * system.lift,
    position.z + NORMAL.z * system.lift
  );

  system.mesh.setMatrixAt(system.nextIndex, MATRIX);
  system.mesh.instanceMatrix.needsUpdate = true;
  system.mesh.count = Math.min(system.capacity, Math.max(system.mesh.count, system.nextIndex + 1));
  system.nextIndex = (system.nextIndex + 1) % system.capacity;
}

export function disposeSkidMarkSystem(system) {
  if (!system?.mesh) {
    return;
  }

  if (system.mesh.parent) {
    system.mesh.parent.remove(system.mesh);
  }
  system.mesh.geometry.dispose();
  system.mesh.material.dispose();
}
