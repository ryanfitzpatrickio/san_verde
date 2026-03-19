import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

class NodeFileReader {
  constructor() {
    this.result = null;
    this.onerror = null;
    this.onload = null;
    this.onloadend = null;
  }

  async readAsArrayBuffer(blob) {
    try {
      this.result = await blob.arrayBuffer();
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    } catch (error) {
      this.onerror?.(error);
    }
  }

  async readAsDataURL(blob) {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimeType = blob.type || 'application/octet-stream';
      this.result = `data:${mimeType};base64,${buffer.toString('base64')}`;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    } catch (error) {
      this.onerror?.(error);
    }
  }
}

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = NodeFileReader;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CATALOG_DIR = path.join(ROOT, 'src', 'game', 'bloomville', 'catalogs');
const OUTPUT_DIR = path.join(ROOT, 'public', 'models', 'buildings');
const DEFAULT_ENTRY_IDS = ['bungalow_urban', 'townhouse_single'];

const exporter = new GLTFExporter();
const BOX_GEOMETRY_CACHE = new Map();
const GABLE_ROOF_GEOMETRY_CACHE = new Map();

const materialCache = new Map();

function getBoxGeometry(size) {
  const key = size.join(':');
  if (!BOX_GEOMETRY_CACHE.has(key)) {
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
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
    GABLE_ROOF_GEOMETRY_CACHE.set(key, geometry);
  }
  return GABLE_ROOF_GEOMETRY_CACHE.get(key);
}

function createMaterials(palette = {}) {
  const result = {};
  for (const [role, color] of Object.entries(palette)) {
    const key = `${role}:${color}`;
    if (!materialCache.has(key)) {
      materialCache.set(
        key,
        new THREE.MeshStandardMaterial({
          color,
          roughness: role === 'glass' ? 0.25 : 0.92,
          metalness: role === 'glass' ? 0.12 : 0.03
        })
      );
    }
    result[role] = materialCache.get(key);
  }
  return result;
}

function mergeByMaterial(group) {
  const buckets = new Map();
  group.updateMatrixWorld(true);

  group.traverse((child) => {
    if (!child.isMesh || !child.geometry || Array.isArray(child.material)) {
      return;
    }

    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);
    const entry = buckets.get(child.material) || [];
    entry.push(geometry);
    buckets.set(child.material, entry);
  });

  const mergedGroup = new THREE.Group();
  for (const [material, geometries] of buckets.entries()) {
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) {
      geometry.dispose();
    }
    if (!merged) {
      continue;
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mergedGroup.add(mesh);
  }

  return mergedGroup;
}

function buildPreviewScene(entry) {
  const group = new THREE.Group();
  group.name = entry.id;
  group.userData.catalogId = entry.id;

  const materials = createMaterials(entry.palette || {});

  for (const piece of entry.pieces || []) {
    const material = materials[piece.material || 'body'] || materials.body || new THREE.MeshStandardMaterial({ color: '#cccccc' });
    const mesh = new THREE.Mesh(
      getBoxGeometry(piece.size),
      material
    );
    mesh.position.set(piece.offset?.[0] || 0, piece.offset?.[1] || 0, piece.offset?.[2] || 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (entry.features?.porch) {
    const porch = entry.features.porch;
    const mesh = new THREE.Mesh(
      getBoxGeometry([porch.width, porch.height || 0.4, porch.depth]),
      materials[porch.material || 'accent'] || materials.accent || materials.body
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
      materials[awning.material || 'accent'] || materials.accent || materials.body
    );
    mesh.position.set(0, awning.y || 3.4, awning.depth * 0.5 + 0.2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (entry.features?.signBand) {
    const band = entry.features.signBand;
    const mesh = new THREE.Mesh(
      getBoxGeometry([band.width, band.height || 0.55, band.depth || 0.25]),
      materials[band.material || 'accent'] || materials.accent || materials.body
    );
    mesh.position.set(0, band.y || 3.1, band.z || 5.4);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());

  if (entry.roof) {
    let roofGeometry;
    const roofMaterial = materials[entry.roof.material || 'roof'] || materials.roof || new THREE.MeshStandardMaterial({ color: '#666666' });
    if (entry.roof.type === 'gable') {
      roofGeometry = getGableRoofGeometry(
        size.x + (entry.roof.overhang || 0.6) * 2,
        size.z + (entry.roof.overhang || 0.6) * 2,
        entry.roof.height || 1.8
      );
    } else {
      const flatHeight = entry.roof.height || 0.35;
      const inset = entry.roof.inset || 0.45;
      roofGeometry = getBoxGeometry([Math.max(1, size.x - inset * 2), flatHeight, Math.max(1, size.z - inset * 2)]);
      const roof = new THREE.Mesh(roofGeometry, roofMaterial);
      roof.position.set(center.x, bounds.max.y + flatHeight * 0.5, center.z);
      roof.castShadow = true;
      roof.receiveShadow = true;
      group.add(roof);
      roofGeometry = null;
    }

    if (roofGeometry) {
      const roof = new THREE.Mesh(roofGeometry, roofMaterial);
      roof.position.set(center.x, bounds.max.y + (entry.roof.height || 1.8) * 0.5 - 0.05, center.z);
      roof.castShadow = true;
      roof.receiveShadow = true;
      group.add(roof);
    }
  }

  group.updateMatrixWorld(true);
  const merged = mergeByMaterial(group);
  merged.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  merged.updateMatrixWorld(true);
  return merged;
}

async function exportGlb(scene, outputPath) {
  const result = await exporter.parseAsync(scene, {
    binary: true,
    trs: true,
    onlyVisible: true
  });
  await fs.writeFile(outputPath, Buffer.from(result));
}

function readCatalogEntries() {
  const entries = [];
  return fs.readdir(CATALOG_DIR, { withFileTypes: true }).then(async (dirEntries) => {
    for (const dirEntry of dirEntries) {
      if (!dirEntry.isFile() || !dirEntry.name.endsWith('.json')) {
        continue;
      }
      const filePath = path.join(CATALOG_DIR, dirEntry.name);
      const raw = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(raw);
      for (const entry of data.entries || []) {
        entries.push(entry);
      }
    }
    return entries;
  });
}

async function main() {
  const requestedIds = process.argv.slice(2).filter(Boolean);
  const targetIds = requestedIds.length ? requestedIds : DEFAULT_ENTRY_IDS;
  const entries = await readCatalogEntries();

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  for (const id of targetIds) {
    const entry = entries.find((item) => item.id === id);
    if (!entry) {
      throw new Error(`Missing catalog entry: ${id}`);
    }

    const scene = buildPreviewScene(entry);
    const outPath = path.join(OUTPUT_DIR, `${id}.glb`);
    await exportGlb(scene, outPath);
    console.log(`Wrote ${path.relative(ROOT, outPath)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
