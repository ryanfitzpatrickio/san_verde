import * as THREE from 'three';
import { assetExists } from '../scene-helpers.js';

export const BUILDING_ASSET_MODE_FALLBACK = 'fallback';
export const BUILDING_ASSET_MODE_GLB_ONLY = 'glb_only';
export const BUILDING_LOD_DISTANCES = Object.freeze({
  lod1: 0,
  lod0: 50
});

const MODEL_EXISTS_CACHE = new Map();
const MODEL_TEMPLATE_CACHE = new Map();

export function normalizeCatalogLod(entry) {
  if (!entry?.lod1 || typeof entry.lod1 !== 'object') {
    return null;
  }

  if (entry.lod1.type === 'procedural') {
    return {
      ...entry.lod1,
      type: 'procedural'
    };
  }

  const modelUrl = resolveCatalogLodModelUrl(entry);
  if (!modelUrl) {
    return null;
  }

  return {
    ...entry.lod1,
    type: 'glb',
    modelUrl
  };
}

export function resolveCatalogLodModelUrl(entry) {
  if (!entry?.id) {
    return null;
  }

  const model = typeof entry.lod1?.model === 'string' ? entry.lod1.model.trim() : '';
  if (!model) {
    return `/models/buildings/${entry.id}.glb`;
  }

  if (/^(https?:)?\/\//.test(model) || model.startsWith('/')) {
    return model;
  }

  return `/models/lod1/${model.replace(/^\/+/, '')}`;
}

export async function catalogEntryHasGlb(entry) {
  const modelUrl = entry?.lod1?.type === 'glb' ? entry.lod1.modelUrl : resolveCatalogLodModelUrl(entry);
  if (!modelUrl) {
    return false;
  }
  if (!MODEL_EXISTS_CACHE.has(modelUrl)) {
    MODEL_EXISTS_CACHE.set(modelUrl, assetExists(modelUrl));
  }
  return MODEL_EXISTS_CACHE.get(modelUrl);
}

export async function loadCatalogGlbInstance(entry, gltfLoader) {
  const modelUrl = entry?.lod1?.type === 'glb' ? entry.lod1.modelUrl : resolveCatalogLodModelUrl(entry);
  if (!gltfLoader || !modelUrl) {
    return null;
  }

  if (!MODEL_TEMPLATE_CACHE.has(modelUrl)) {
    MODEL_TEMPLATE_CACHE.set(
      modelUrl,
      gltfLoader.loadAsync(modelUrl).then((gltf) => gltf.scene || null)
    );
  }

  const template = await MODEL_TEMPLATE_CACHE.get(modelUrl);
  return template ? template.clone(true) : null;
}

export function fitCatalogModelToFootprint(model, frontage, depth, rng, { exactFootprint = false } = {}) {
  if (!model) {
    return model;
  }

  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
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
  model.scale.set(scaleX, scaleY, scaleZ);
  model.position.sub(new THREE.Vector3(center.x * scaleX, bounds.min.y * scaleY, center.z * scaleZ));
  model.updateMatrixWorld(true);
  return model;
}

export function prepareCatalogModelInstance(root, { stageShadowCaster = false } = {}) {
  if (!root) {
    return root;
  }

  root.userData = root.userData || {};
  if (stageShadowCaster) {
    root.userData.stageShadowCaster = true;
  }

  root.traverse((child) => {
    if (!child.isMesh) {
      return;
    }
    child.castShadow = true;
    child.receiveShadow = true;
    if (stageShadowCaster) {
      child.userData = child.userData || {};
      child.userData.stageShadowCaster = true;
    }
  });
  return root;
}

export async function filterCatalogEntriesForGlb(catalogs) {
  const checks = await Promise.all(
    (catalogs || []).map(async (entry) => ({
      entry,
      hasGlb: await catalogEntryHasGlb(entry)
    }))
  );
  return checks.filter((item) => item.hasGlb).map((item) => item.entry);
}
