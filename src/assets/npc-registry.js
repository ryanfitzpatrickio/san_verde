import { resolveModelUrl } from './asset-base-url.js';

const NPC_MANIFEST_MODULES = import.meta.glob('./built-in-npcs/*.json', {
  eager: true,
  import: 'default'
});

function compareBuiltInNpcs(left, right) {
  const leftOrder = Number.isFinite(left.order) ? left.order : Number.MAX_SAFE_INTEGER;
  const rightOrder = Number.isFinite(right.order) ? right.order : Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return String(left.label || left.id).localeCompare(String(right.label || right.id));
}

function resolveAssetMap(assetMap) {
  if (!assetMap || typeof assetMap !== 'object') {
    return assetMap || null;
  }

  const resolved = {};
  for (const [key, value] of Object.entries(assetMap)) {
    resolved[key] = typeof value === 'string' ? resolveModelUrl(value) : value;
  }
  return resolved;
}

function resolveManifestUrls(manifest) {
  return {
    ...manifest,
    presentation: manifest.presentation
      ? {
          ...manifest.presentation,
          modelUrl: manifest.presentation.modelUrl ? resolveModelUrl(manifest.presentation.modelUrl) : null,
          animationUrls: resolveAssetMap(manifest.presentation.animationUrls)
        }
      : null
  };
}

export const BUILT_IN_NPCS = Object.values(NPC_MANIFEST_MODULES)
  .map(resolveManifestUrls)
  .sort(compareBuiltInNpcs);

const BUILT_IN_NPCS_BY_ID = new Map(BUILT_IN_NPCS.map((npc) => [npc.id, npc]));

export function getBuiltInNpcById(id) {
  return BUILT_IN_NPCS_BY_ID.get(id) || null;
}

export function getBuiltInNpcArchetypesForCrowdKind(crowdKind) {
  const matches = BUILT_IN_NPCS.filter((npc) => npc.crowdKind === crowdKind);
  const primary = matches.filter((npc) => npc.role !== 'fallback');
  return primary.length ? primary : matches;
}
