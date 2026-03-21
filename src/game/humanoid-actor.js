import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const HUMANOID_BOX = new THREE.Box3();
const HUMANOID_SIZE = new THREE.Vector3();
const METRIC_WORLD = new THREE.Vector3();
const HUMANOID_MODEL_TEMPLATE_CACHE = new Map();
const HUMANOID_CLIP_CACHE = new Map();

export async function loadHumanoidActor({
  fbxLoader,
  modelUrl,
  animationUrls,
  config,
  defaultAction = 'idle'
}) {
  const template = await loadHumanoidModelTemplate(fbxLoader, modelUrl, config);
  const model = cloneSkeleton(template);

  const metrics = measureHumanoidMetrics(model);
  const root = new THREE.Group();
  root.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map();
  const clips = await loadHumanoidAnimationClipsCached(fbxLoader, animationUrls, template, modelUrl);
  for (const [name, clip] of clips.entries()) {
    const action = mixer.clipAction(clip);
    action.enabled = true;
    actions.set(name, action);
  }

  const actor = {
    actorType: 'humanoid',
    root,
    model,
    mixer,
    actions,
    rootMotion: detectRootMotionSource(model, clips),
    currentAction: '',
    metrics
  };

  setHumanoidActorAction(actor, actions.has(defaultAction) ? defaultAction : actions.keys().next().value || '');
  actor.mixer.update(0);
  return actor;
}

export function setHumanoidActorAction(actor, actionName) {
  if (!actor || !actionName || actor.currentAction === actionName) {
    return;
  }

  const next = actor.actions.get(actionName);
  if (!next) {
    return;
  }

  const previous = actor.actions.get(actor.currentAction);
  next.reset();
  next.fadeIn(previous ? 0.22 : 0);
  next.play();
  if (previous && previous !== next) {
    previous.fadeOut(0.22);
  }
  actor.currentAction = actionName;
  resetHumanoidRootMotionSample(actor);
}

export function setHumanoidActorVisible(actor, visible) {
  if (!actor) {
    return;
  }
  actor.root.visible = visible;
}

export function updateHumanoidActor(actor, deltaSeconds) {
  if (!actor) {
    return;
  }
  actor.mixer.update(deltaSeconds);
}

export function resetHumanoidRootMotionSample(actor) {
  if (!actor?.rootMotion) {
    return;
  }
  actor.rootMotion.resetPending = true;
}

export function stabilizeHumanoidRootMotion(actor, options = {}) {
  const rootMotion = actor?.rootMotion;
  if (!rootMotion?.node) {
    return;
  }

  const localPosition = rootMotion.node.position;
  rootMotion.previousLocalPosition.copy(localPosition);
  rootMotion.sampled = true;
  rootMotion.resetPending = false;
  localPosition.x = rootMotion.neutralLocalPosition.x;
  localPosition.z = rootMotion.neutralLocalPosition.z;
  if (options.stabilizeVertical) {
    localPosition.y = rootMotion.neutralLocalPosition.y;
  }
}

async function loadHumanoidModelTemplate(fbxLoader, modelUrl, config) {
  const cacheKey = `${modelUrl}|${Number(config?.height || 0).toFixed(4)}`;
  if (!HUMANOID_MODEL_TEMPLATE_CACHE.has(cacheKey)) {
    HUMANOID_MODEL_TEMPLATE_CACHE.set(
      cacheKey,
      fbxLoader.loadAsync(modelUrl).then((template) => {
        prepareHumanoidModel(template);

        HUMANOID_BOX.setFromObject(template);
        const size = HUMANOID_BOX.getSize(HUMANOID_SIZE);
        if (!HUMANOID_BOX.isEmpty() && size.y > 0.01) {
          const scale = config.height / size.y;
          template.scale.setScalar(scale);
        }

        template.updateMatrixWorld(true);
        HUMANOID_BOX.setFromObject(template);
        const centeredBox = HUMANOID_BOX.getSize(HUMANOID_SIZE);
        if (!HUMANOID_BOX.isEmpty()) {
          template.position.y -= HUMANOID_BOX.min.y;
          template.position.x -= (HUMANOID_BOX.min.x + centeredBox.x * 0.5);
          template.position.z -= (HUMANOID_BOX.min.z + centeredBox.z * 0.5);
        }
        return template;
      })
    );
  }

  return HUMANOID_MODEL_TEMPLATE_CACHE.get(cacheKey);
}

async function loadHumanoidAnimationClipsCached(fbxLoader, animationUrls, templateModel, modelUrl) {
  const cacheKey = JSON.stringify({
    modelUrl,
    animationUrls: Object.entries(animationUrls || {}).sort(([left], [right]) => left.localeCompare(right))
  });
  if (!HUMANOID_CLIP_CACHE.has(cacheKey)) {
    HUMANOID_CLIP_CACHE.set(cacheKey, loadHumanoidAnimationClips(fbxLoader, animationUrls, templateModel));
  }
  return HUMANOID_CLIP_CACHE.get(cacheKey);
}

async function loadHumanoidAnimationClips(fbxLoader, animationUrls, model) {
  const entries = Object.entries(animationUrls || {}).map(async ([name, url]) => {
    try {
      const asset = await fbxLoader.loadAsync(url);
      const clip = normalizeClipTracks(asset.animations?.[0], model);
      return clip ? [name, clip] : null;
    } catch {
      return null;
    }
  });

  const results = await Promise.all(entries);
  const clips = new Map();
  for (const entry of results) {
    if (entry) {
      clips.set(entry[0], entry[1]);
    }
  }
  return clips;
}

function prepareHumanoidModel(model) {
  model.traverse((child) => {
    if (child.isBone && typeof child.name === 'string') {
      child.name = normalizeMixamoNodeName(child.name);
    }
    if (!child.isMesh) {
      return;
    }
    child.castShadow = true;
    child.receiveShadow = true;
    if (child.material) {
      child.material.side = THREE.FrontSide;
    }
  });
}

function normalizeClipTracks(originalClip, model) {
  if (!originalClip) {
    return null;
  }

  const availableNodes = model ? collectAnimationTargetNames(model) : null;
  const tracks = originalClip.tracks
    .map((track) => {
      const clone = track.clone();
      clone.name = normalizeMixamoTrackName(clone.name);
      return clone;
    })
    .filter((track) => !availableNodes || availableNodes.has(getTrackTargetName(track.name)));
  if (!tracks.length) {
    return null;
  }

  return new THREE.AnimationClip(originalClip.name, originalClip.duration, tracks);
}

function collectAnimationTargetNames(model) {
  const names = new Set();
  model.traverse((child) => {
    if (child?.name) {
      names.add(normalizeMixamoNodeName(child.name));
    }
  });
  return names;
}

function getTrackTargetName(trackName) {
  const value = String(trackName || '');
  const separatorIndex = value.indexOf('.');
  if (separatorIndex <= 0) {
    return normalizeMixamoNodeName(value);
  }
  return normalizeMixamoNodeName(value.slice(0, separatorIndex));
}

function normalizeMixamoNodeName(name) {
  return String(name || '')
    .replace(/^mixamorig\d*:/i, 'mixamorig')
    .replace(/^mixamorig\d*/i, 'mixamorig')
    .replace(/:/g, '');
}

function normalizeMixamoTrackName(name) {
  const value = String(name || '');
  const parts = value.split('.');
  if (!parts.length) {
    return value;
  }
  parts[0] = normalizeMixamoNodeName(parts[0]);
  return parts.join('.');
}

function measureHumanoidMetrics(model) {
  model.updateMatrixWorld(true);
  HUMANOID_BOX.setFromObject(model);
  const size = HUMANOID_BOX.getSize(HUMANOID_SIZE);
  const metrics = {
    height: Number.isFinite(size.y) ? size.y : 0,
    hipHeight: 0
  };

  let hipBone = null;
  model.traverse((child) => {
    if (hipBone || !child.isBone || !child.name) {
      return;
    }
    if (/hip|hips|pelvis/i.test(child.name)) {
      hipBone = child;
    }
  });

  if (hipBone) {
    hipBone.getWorldPosition(METRIC_WORLD);
    metrics.hipHeight = METRIC_WORLD.y;
  } else {
    metrics.hipHeight = metrics.height * 0.53;
  }

  return metrics;
}

function detectRootMotionSource(model, clips) {
  let best = null;

  for (const [clipName, clip] of clips.entries()) {
    for (const track of clip.tracks) {
      if (!track?.name?.endsWith('.position') || !track.values || track.values.length < 6) {
        continue;
      }

      const parsed = THREE.PropertyBinding.parseTrackName(track.name);
      const nodeName = parsed?.nodeName || parsed?.nodePath;
      if (!nodeName) {
        continue;
      }

      const node = THREE.PropertyBinding.findNode(model, nodeName);
      if (!node) {
        continue;
      }

      const values = track.values;
      const startX = values[0];
      const startZ = values[2];
      const endX = values[values.length - 3];
      const endZ = values[values.length - 1];
      const horizontalDistance = Math.hypot(endX - startX, endZ - startZ);
      if (horizontalDistance < 0.05) {
        continue;
      }

      const nameBonus = /hip|hips|pelvis|root/i.test(node.name) ? 0.25 : 0;
      const clipBonus = clipName === 'run' ? 0.1 : clipName === 'walk' ? 0.06 : 0;
      const score = horizontalDistance + nameBonus + clipBonus;
      if (!best || score > best.score) {
        best = {
          score,
          node,
          neutralLocalPosition: node.position.clone(),
          previousLocalPosition: node.position.clone(),
          sampled: false,
          resetPending: true
        };
      }
    }
  }

  return best;
}
