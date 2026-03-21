import * as THREE from 'three';

const TEMP_WORLD = new THREE.Vector3();
const TEMP_LOCAL = new THREE.Vector3();
export const WHEEL_ANCHOR_KEYS = ['front-left', 'front-right', 'rear-left', 'rear-right'];

function normalizeWheelNameSource(name) {
  return String(name || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

function expandWheelAliasTokens(source) {
  const tokens = source
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const dense = source.replace(/[^a-z0-9]+/g, '');

  const expanded = new Set(tokens);
  const aliasPairs = [
    ['fl', ['front', 'left']],
    ['lf', ['front', 'left']],
    ['fr', ['front', 'right']],
    ['rf', ['front', 'right']],
    ['rl', ['rear', 'left']],
    ['lr', ['rear', 'left']],
    ['bl', ['back', 'left']],
    ['lb', ['back', 'left']],
    ['rr', ['rear', 'right']],
    ['rb', ['rear', 'right']],
    ['br', ['back', 'right']]
  ];

  for (const token of tokens) {
    const pair = aliasPairs.find(([alias]) => alias === token);
    if (!pair) {
      continue;
    }
    for (const part of pair[1]) {
      expanded.add(part);
    }
  }

  const densePairs = [
    ['frontleft', ['front', 'left']],
    ['leftfront', ['front', 'left']],
    ['frontright', ['front', 'right']],
    ['rightfront', ['front', 'right']],
    ['rearleft', ['rear', 'left']],
    ['leftrear', ['rear', 'left']],
    ['backleft', ['back', 'left']],
    ['leftback', ['back', 'left']],
    ['rearright', ['rear', 'right']],
    ['rightrear', ['rear', 'right']],
    ['backright', ['back', 'right']],
    ['rightback', ['back', 'right']]
  ];

  for (const [alias, parts] of densePairs) {
    if (!dense.includes(alias)) {
      continue;
    }
    for (const part of parts) {
      expanded.add(part);
    }
  }

  return expanded;
}

export function normalizeWheelAnchorName(name) {
  const source = normalizeWheelNameSource(name);
  const dense = source.replace(/[^a-z0-9]+/g, '');
  const tokens = expandWheelAliasTokens(source);
  const isFront = tokens.has('front') || tokens.has('frt') || tokens.has('fwd') || dense.includes('front');
  const isRear = tokens.has('rear') || tokens.has('back') || tokens.has('aft') || dense.includes('rear') || dense.includes('back');
  const isLeft = tokens.has('left') || dense.includes('left');
  const isRight = tokens.has('right') || dense.includes('right');

  if ((isFront || isRear) && (isLeft || isRight)) {
    return `${isFront ? 'front' : 'rear'}-${isLeft ? 'left' : 'right'}`;
  }

  return null;
}

export function inferVehicleForwardYawRadians(rootObject) {
  if (!rootObject?.isObject3D) {
    return 0;
  }

  const anchors = new Map();
  rootObject.updateMatrixWorld(true);
  rootObject.traverse((child) => {
    if (child === rootObject || !child?.name) {
      return;
    }

    const key = normalizeWheelAnchorName(child.name);
    if (!key || anchors.has(key)) {
      return;
    }

    child.getWorldPosition(TEMP_WORLD);
    TEMP_LOCAL.copy(TEMP_WORLD);
    anchors.set(key, rootObject.worldToLocal(TEMP_LOCAL.clone()));
  });

  const frontLeft = anchors.get('front-left');
  const frontRight = anchors.get('front-right');
  const rearLeft = anchors.get('rear-left');
  const rearRight = anchors.get('rear-right');
  if (!frontLeft || !frontRight || !rearLeft || !rearRight) {
    return 0;
  }

  const frontCenter = frontLeft.clone().add(frontRight).multiplyScalar(0.5);
  const rearCenter = rearLeft.clone().add(rearRight).multiplyScalar(0.5);
  const localForward = frontCenter.sub(rearCenter).setY(0);
  if (localForward.lengthSq() <= 1e-6) {
    return 0;
  }

  const currentYaw = Math.atan2(localForward.x, localForward.z);
  return -currentYaw;
}

export function inferVehicleForwardYawDegrees(rootObject) {
  return THREE.MathUtils.radToDeg(inferVehicleForwardYawRadians(rootObject));
}
