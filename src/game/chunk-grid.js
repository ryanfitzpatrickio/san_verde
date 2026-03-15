import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const HALF_DIAGONAL = Math.SQRT2 * 0.5;

const DETAIL_RADIUS = 900;
const MASS_RADIUS = 2200;

const _mat4  = new THREE.Matrix4();
const _quat  = new THREE.Quaternion();
const _pos   = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const MASS_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#8e8880',
  roughness: 0.95,
  metalness: 0.0,
});
MASS_MATERIAL.userData.shared = true;

function yieldToMain() {
  if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') {
    return scheduler.yield();
  }
  return new Promise(resolve => setTimeout(resolve, 0));
}

export class ChunkGrid {
  constructor(cellSize = 800) {
    this.cellSize = cellSize;
    this.chunks = new Map();
    this.root = new THREE.Group();
  }

  _getOrCreate(cx, cz) {
    const key = `${cx},${cz}`;
    if (!this.chunks.has(key)) {
      const detail = new THREE.Group();
      const mass   = new THREE.Group();
      mass.visible = false;
      this.root.add(detail, mass);
      this.chunks.set(key, {
        detail,
        mass,
        cx, cz,
        centerX: (cx + 0.5) * this.cellSize,
        centerZ: (cz + 0.5) * this.cellSize,
        footprints: [],
      });
    }
    return this.chunks.get(key);
  }

  addBuilding(object, x, z, w, d, h, angle = 0) {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const chunk = this._getOrCreate(cx, cz);
    chunk.detail.add(object);
    chunk.footprints.push({ x, z, w, d, h, angle });
  }

  async buildMassGeometry(onProgress) {
    const chunks = [...this.chunks.values()];
    let totalFootprints = 0;
    for (const chunk of chunks) totalFootprints += chunk.footprints.length;

    let processed = 0;

    for (const chunk of chunks) {
      if (!chunk.footprints.length) continue;

      const geos = [];
      for (const fp of chunk.footprints) {
        const geo = new THREE.BoxGeometry(fp.w, fp.h, fp.d);
        _quat.setFromAxisAngle(Y_AXIS, fp.angle);
        _pos.set(fp.x, fp.h * 0.5, fp.z);
        _mat4.compose(_pos, _quat, _scale);
        geo.applyMatrix4(_mat4);
        geos.push(geo);

        processed++;
        if (processed % 25 === 0) {
          onProgress?.(processed / Math.max(totalFootprints, 1));
          await yieldToMain();
        }
      }

      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      chunk.mass.add(new THREE.Mesh(merged, MASS_MATERIAL));
    }
  }

  update(playerPos) {
    const margin         = this.cellSize * HALF_DIAGONAL;
    const detailCutoffSq = (DETAIL_RADIUS + margin) ** 2;
    const massCutoffSq   = (MASS_RADIUS   + margin) ** 2;

    for (const chunk of this.chunks.values()) {
      const dx     = chunk.centerX - playerPos.x;
      const dz     = chunk.centerZ - playerPos.z;
      const distSq = dx * dx + dz * dz;

      const showDetail = distSq <= detailCutoffSq;
      chunk.detail.visible = showDetail;
      chunk.mass.visible   = !showDetail && distSq <= massCutoffSq;
    }
  }

  /**
   * Build a single always-on skyline mesh by merging all per-chunk mass geometries.
   * Must be called after buildMassGeometry(). Returns a Mesh to add to the scene,
   * or null if there are no buildings.
   *
   * Uses polygonOffset to sit behind mass/detail layers so close chunks
   * don't z-fight with the skyline.
   */
  buildSkylineMesh() {
    const chunkGeos = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.mass.children.length) {
        chunkGeos.push(chunk.mass.children[0].geometry);
      }
    }
    if (!chunkGeos.length) return null;

    const merged = mergeGeometries(chunkGeos, false);
    if (!merged) return null;

    const material = new THREE.MeshStandardMaterial({
      color: '#797c82',
      roughness: 0.97,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    });
    material.userData.shared = true;

    const mesh = new THREE.Mesh(merged, material);
    mesh.userData.noCollision = true;
    mesh.userData.noSuspension = true;
    return mesh;
  }

  stats() {
    let detail = 0, mass = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.detail.visible) detail++;
      if (chunk.mass.visible)   mass++;
    }
    return { total: this.chunks.size, detail, mass };
  }
}
