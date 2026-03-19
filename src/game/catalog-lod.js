import * as THREE from 'three';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import { assetExists } from '../scene-helpers.js';

export const BUILDING_ASSET_MODE_FALLBACK = 'fallback';
export const BUILDING_ASSET_MODE_GLB_ONLY = 'glb_only';
export const BUILDING_ASSET_MODE_PROCEDURAL_ONLY = 'procedural_only';
export const BUILDING_ASSET_MODE_PREVIEW_GLB = 'preview_glb';
export const BUILDING_LOD_DISTANCES = Object.freeze({
  lod1: 0,
  lod0: 50
});

const MODEL_EXISTS_CACHE = new Map();
const MODEL_TEMPLATE_CACHE = new Map();
const MODEL_SIMPLIFIED_TEMPLATE_CACHE = new Map();
const SIMPLIFY_MODIFIER = new SimplifyModifier();
const CATALOG_MODEL_LOD_TIERS = Object.freeze(['high', 'medium', 'low']);

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
    modelUrl,
    tierUrls: resolveCatalogLodTierModelUrls(entry, modelUrl),
    placement: normalizeCatalogPlacement(entry)
  };
}

export function normalizeCatalogPlacement(entry) {
  const placement = entry?.lod1?.placement;
  if (!placement || typeof placement !== 'object') {
    return null;
  }

  const fitMode = placement.fitMode === 'authored' ? 'authored' : 'footprint';
  const uniformScale = Number(placement.uniformScale);
  const yawDegrees = Number(placement.yawDegrees);
  const offset = placement.offset && typeof placement.offset === 'object'
    ? {
        x: Number(placement.offset.x) || 0,
        y: Number(placement.offset.y) || 0,
        z: Number(placement.offset.z) || 0
      }
    : null;

  return {
    fitMode,
    uniformScale: Number.isFinite(uniformScale) && uniformScale > 0 ? uniformScale : 1,
    yawDegrees: Number.isFinite(yawDegrees) ? yawDegrees : 0,
    offset
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

export function resolveCatalogLodTierModelUrls(entry, modelUrl = resolveCatalogLodModelUrl(entry)) {
  if (!modelUrl) {
    return null;
  }

  const explicitModels = entry?.lod1?.models && typeof entry.lod1.models === 'object'
    ? entry.lod1.models
    : null;
  const fallbackBase = stripModelExtension(modelUrl);
  const fallbackExt = pathExtensionOrDefault(modelUrl);

  const tierUrls = {};
  for (const tier of CATALOG_MODEL_LOD_TIERS) {
    const explicitModel = typeof explicitModels?.[tier] === 'string' ? explicitModels[tier].trim() : '';
    if (explicitModel) {
      tierUrls[tier] = normalizeCatalogModelPath(explicitModel);
      continue;
    }

    if (tier === 'high') {
      tierUrls.high = `${fallbackBase}.high${fallbackExt}`;
      continue;
    }

    tierUrls[tier] = `${fallbackBase}.${tier}${fallbackExt}`;
  }

  tierUrls.base = modelUrl;
  return tierUrls;
}

export async function catalogEntryHasGlb(entry) {
  const urls = entry?.lod1?.type === 'glb'
    ? entry.lod1.tierUrls || resolveCatalogLodTierModelUrls(entry, entry.lod1.modelUrl)
    : resolveCatalogLodTierModelUrls(entry);
  if (!urls) {
    return false;
  }

  const [highExists, baseExists] = await Promise.all([
    assetExistsCached(urls.high),
    assetExistsCached(urls.base)
  ]);
  return highExists || baseExists;
}

export async function loadCatalogGlbInstance(entry, gltfLoader) {
  return loadCatalogGlbTierInstance(entry, gltfLoader, { tier: 'high' });
}

export async function loadCatalogGlbTierInstance(entry, gltfLoader, { tier = 'high' } = {}) {
  const modelUrl = await resolveCatalogLodLoadUrl(entry, tier);
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

export async function loadCatalogGlbSimplifiedInstance(entry, gltfLoader, ratio = 0.35) {
  const modelUrl = await resolveCatalogLodLoadUrl(entry, 'high');
  if (!gltfLoader || !modelUrl) {
    return null;
  }

  const cacheKey = `${modelUrl}|${Number(ratio).toFixed(3)}`;
  if (!MODEL_SIMPLIFIED_TEMPLATE_CACHE.has(cacheKey)) {
    MODEL_SIMPLIFIED_TEMPLATE_CACHE.set(
      cacheKey,
      (async () => {
        const template = await loadCatalogGlbInstance(entry, gltfLoader);
        return template ? createSimplifiedModelTemplate(template, ratio) : null;
      })()
    );
  }

  const template = await MODEL_SIMPLIFIED_TEMPLATE_CACHE.get(cacheKey);
  return template ? template.clone(true) : null;
}

export async function loadCatalogGlbMediumInstance(entry, gltfLoader, ratio = 0.35) {
  const baked = await loadCatalogGlbTierInstance(entry, gltfLoader, { tier: 'medium' });
  return baked || loadCatalogGlbSimplifiedInstance(entry, gltfLoader, ratio);
}

export async function loadCatalogGlbLowInstance(entry, gltfLoader, ratio = 0.2) {
  const baked = await loadCatalogGlbTierInstance(entry, gltfLoader, { tier: 'low' });
  return baked || loadCatalogGlbSimplifiedInstance(entry, gltfLoader, ratio);
}

export function fitCatalogModelToFootprint(model, frontage, depth, rng, { exactFootprint = false, preserveAspect = false } = {}) {
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
  const scale = preserveAspect ? Math.min(scaleX, scaleZ) : null;
  model.scale.set(preserveAspect ? scale : scaleX, scaleY, preserveAspect ? scale : scaleZ);
  model.position.sub(new THREE.Vector3(
    center.x * (preserveAspect ? scale : scaleX),
    bounds.min.y * scaleY,
    center.z * (preserveAspect ? scale : scaleZ)
  ));
  model.updateMatrixWorld(true);
  return model;
}

export function placeCatalogModelAtOrigin(model, { uniformScale = 1 } = {}) {
  if (!model) {
    return model;
  }

  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const min = bounds.min.clone();
  model.scale.setScalar(uniformScale);
  model.position.sub(new THREE.Vector3(
    center.x * uniformScale,
    min.y * uniformScale,
    center.z * uniformScale
  ));
  model.updateMatrixWorld(true);
  return model;
}

export function applyCatalogPlacement(model, frontage, depth, rng, options = {}, placement = null) {
  if (!model) {
    return model;
  }

  if (placement?.fitMode === 'authored') {
    placeCatalogModelAtOrigin(model, { uniformScale: placement.uniformScale || 1 });
  } else {
    fitCatalogModelToFootprint(model, frontage, depth, rng, options);
  }

  if (placement?.yawDegrees) {
    model.rotation.y += THREE.MathUtils.degToRad(placement.yawDegrees);
  }

  if (placement?.offset) {
    model.position.x += placement.offset.x;
    model.position.y += placement.offset.y;
    model.position.z += placement.offset.z;
  }

  model.updateMatrixWorld(true);
  return model;
}

function createSimplifiedModelTemplate(root, ratio) {
  const simplifiedRoot = root.clone(true);
  const simplifyRatio = THREE.MathUtils.clamp(Number(ratio) || 0.35, 0.08, 0.95);

  simplifiedRoot.traverse((child) => {
    if (!child.isMesh || !child.geometry?.getAttribute('position')) {
      return;
    }

    const source = child.geometry;
    const positionCount = source.getAttribute('position')?.count || 0;
    const targetCount = Math.max(24, Math.floor(positionCount * simplifyRatio));
    const removeCount = Math.max(0, positionCount - targetCount);

    if (removeCount <= 0 || positionCount < 32) {
      child.geometry = source.clone();
      return;
    }

    try {
      const simplified = SIMPLIFY_MODIFIER.modify(source, removeCount);
      simplified.computeVertexNormals();
      simplified.computeBoundingBox();
      simplified.computeBoundingSphere();
      child.geometry = simplified;
    } catch (error) {
      console.warn(`Failed to simplify ${child.name || 'mesh'} for ${simplifyRatio}:`, error);
      child.geometry = source.clone();
    }
  });

  return simplifiedRoot;
}

async function resolveCatalogLodLoadUrl(entry, tier = 'high') {
  const urls = entry?.lod1?.type === 'glb'
    ? entry.lod1.tierUrls || resolveCatalogLodTierModelUrls(entry, entry.lod1.modelUrl)
    : resolveCatalogLodTierModelUrls(entry);
  if (!urls) {
    return null;
  }

  if (tier === 'high') {
    if (await assetExistsCached(urls.high)) {
      return urls.high;
    }
    return await assetExistsCached(urls.base) ? urls.base : null;
  }

  const tierUrl = urls[tier];
  if (tierUrl && await assetExistsCached(tierUrl)) {
    return tierUrl;
  }

  return null;
}

function stripModelExtension(modelUrl) {
  const match = modelUrl.match(/^(.*?)(\.[^./?]+)?([?#].*)?$/);
  const base = match?.[1] || modelUrl;
  return base;
}

function pathExtensionOrDefault(modelUrl) {
  const match = modelUrl.match(/\.([^.\/?#]+)(?:[?#].*)?$/);
  return match ? `.${match[1]}` : '.glb';
}

function normalizeCatalogModelPath(model) {
  if (/^(https?:)?\/\//.test(model) || model.startsWith('/')) {
    return model;
  }
  return `/models/lod1/${model.replace(/^\/+/, '')}`;
}

function assetExistsCached(modelUrl) {
  if (!modelUrl) {
    return Promise.resolve(false);
  }
  if (!MODEL_EXISTS_CACHE.has(modelUrl)) {
    MODEL_EXISTS_CACHE.set(modelUrl, assetExists(modelUrl));
  }
  return MODEL_EXISTS_CACHE.get(modelUrl);
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
