import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const HALF_DIAGONAL = Math.SQRT2 * 0.5;

const DEFAULT_DETAIL_RADIUS = 900;
const DEFAULT_MASS_RADIUS = 2200;

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

function collectChunkMergeBuckets(root, resolveBakeMaterial) {
  const buckets = new Map();
  root.updateMatrixWorld(true);

  root.traverse((child) => {
    if (!child.isMesh || child.isInstancedMesh || !child.geometry || Array.isArray(child.material)) {
      return;
    }

    const resolved = resolveBakeMaterial?.(child, child.material) || {
      key: child.material,
      material: child.material
    };
    const bucketKey = resolved.key ?? child.material;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        material: resolved.material ?? child.material,
        geometries: []
      };
      buckets.set(bucketKey, bucket);
    }

    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);
    bucket.geometries.push(geometry);
  });

  return buckets;
}

function disposeChunkDetailChildren(root) {
  root.traverse((child) => {
    if (child.isMesh && child.userData?.chunkBakedDetail && child.geometry) {
      child.geometry.dispose();
    }
  });
}

export class ChunkGrid {
  constructor(cellSize = 800, options = {}) {
    this.cellSize = cellSize;
    this.perfLabelPrefix = options.perfLabelPrefix || '';
    this.detailRadius = Number.isFinite(options.detailRadius) ? options.detailRadius : DEFAULT_DETAIL_RADIUS;
    this.massRadius = Number.isFinite(options.massRadius) ? options.massRadius : DEFAULT_MASS_RADIUS;
    this.chunks = new Map();
    this.root = new THREE.Group();
  }

  _getOrCreate(cx, cz) {
    const key = `${cx},${cz}`;
    if (!this.chunks.has(key)) {
      const detail = new THREE.Group();
      const mass   = new THREE.Group();
      detail.visible = false;
      mass.visible = false;
      if (this.perfLabelPrefix) {
        detail.userData.perfCategory = `${this.perfLabelPrefix}:detail ${cx},${cz}`;
        mass.userData.perfCategory = `${this.perfLabelPrefix}:mass ${cx},${cz}`;
      }
      this.chunks.set(key, {
        detail,
        mass,
        cx, cz,
        centerX: (cx + 0.5) * this.cellSize,
        centerZ: (cz + 0.5) * this.cellSize,
        footprints: [],
        mountedMode: 'none'
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

  async bakeDetailGeometry(onProgress, options = {}) {
    const chunks = [...this.chunks.values()].filter((chunk) => chunk.detail.children.length > 0);
    const totalChunks = Math.max(chunks.length, 1);

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const buckets = collectChunkMergeBuckets(chunk.detail, options.resolveBakeMaterial);
      if (!buckets.size) {
        onProgress?.((index + 1) / totalChunks);
        continue;
      }

      disposeChunkDetailChildren(chunk.detail);
      chunk.detail.clear();

      for (const bucket of buckets.values()) {
        const merged = mergeGeometries(bucket.geometries, false);
        for (const geometry of bucket.geometries) {
          geometry.dispose();
        }
        if (!merged) {
          continue;
        }

        const mesh = new THREE.Mesh(merged, bucket.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.noCollision = true;
        mesh.userData.noSuspension = true;
        mesh.userData.stageShadowCaster = true;
        mesh.userData.chunkBakedDetail = true;
        chunk.detail.add(mesh);
      }

      onProgress?.((index + 1) / totalChunks);
      if (index % 4 === 0) {
        await yieldToMain();
      }
    }
  }

  update(playerPos) {
    const margin         = this.cellSize * HALF_DIAGONAL;
    const detailCutoffSq = (this.detailRadius + margin) ** 2;
    const massCutoffSq   = (this.massRadius + margin) ** 2;

    for (const chunk of this.chunks.values()) {
      const dx     = chunk.centerX - playerPos.x;
      const dz     = chunk.centerZ - playerPos.z;
      const distSq = dx * dx + dz * dz;

      const showDetail = distSq <= detailCutoffSq;
      const showMass = !showDetail && distSq <= massCutoffSq;

      if (showDetail) {
        this._setChunkMode(chunk, 'detail');
      } else if (showMass) {
        this._setChunkMode(chunk, 'mass');
      } else {
        this._setChunkMode(chunk, 'none');
      }
    }
  }

  _setChunkMode(chunk, mode) {
    if (chunk.mountedMode === mode) {
      chunk.detail.visible = mode === 'detail';
      chunk.mass.visible = mode === 'mass';
      return;
    }

    if (chunk.detail.parent === this.root) {
      this.root.remove(chunk.detail);
    }
    if (chunk.mass.parent === this.root) {
      this.root.remove(chunk.mass);
    }

    chunk.detail.visible = false;
    chunk.mass.visible = false;

    if (mode === 'detail') {
      this.root.add(chunk.detail);
      chunk.detail.visible = true;
    } else if (mode === 'mass') {
      this.root.add(chunk.mass);
      chunk.mass.visible = true;
    }

    chunk.mountedMode = mode;
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
    if (this.perfLabelPrefix) {
      mesh.userData.perfCategory = `${this.perfLabelPrefix}:skyline`;
    }
    return mesh;
  }

  stats() {
    let detail = 0, mass = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.mountedMode === 'detail') detail++;
      if (chunk.mountedMode === 'mass')   mass++;
    }
    return { total: this.chunks.size, detail, mass };
  }
}
