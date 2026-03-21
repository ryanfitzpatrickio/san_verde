import * as THREE from 'three';
import { normalizeWheelAnchorName } from './vehicle-orientation.js';

const ORDERED_WHEEL_KEYS = ['front-left', 'front-right', 'rear-left', 'rear-right'];

function scoreEmbeddedWheelCandidate(object) {
  if (!object) {
    return -Infinity;
  }

  let score = 0;
  const name = String(object.name || '').toLowerCase();
  if (object.isMesh) {
    score += 4;
  }
  score += object.children.length * 2;
  if (/\.|001|002|003/.test(name)) {
    score -= 3;
  }

  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  if (!bounds.isEmpty()) {
    const size = bounds.getSize(new THREE.Vector3());
    score += Math.max(size.x, size.y, size.z);
  }

  return score;
}

function measureEmbeddedWheelCandidateSize(object) {
  if (!object) {
    return 0;
  }

  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) {
    return 0;
  }

  const size = bounds.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z);
}

function selectBestEmbeddedWheelCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => scoreEmbeddedWheelCandidate(right) - scoreEmbeddedWheelCandidate(left))[0];
}

function reconcileEmbeddedWheelPair(selectedSources, leftKey, rightKey) {
  const left = selectedSources.get(leftKey);
  const right = selectedSources.get(rightKey);
  if (!left?.source || !right?.source) {
    return;
  }

  const minRatio = 0.45;
  if (left.size > 0 && right.size > 0 && right.size < left.size * minRatio) {
    selectedSources.set(rightKey, { ...right, source: left.source, size: left.size });
    return;
  }

  if (left.size > 0 && right.size > 0 && left.size < right.size * minRatio) {
    selectedSources.set(leftKey, { ...left, source: right.source, size: right.size });
  }
}

export function collectEmbeddedWheelAssets(rootObject) {
  const wheels = new Map();

  rootObject.updateMatrixWorld(true);
  rootObject.traverse((child) => {
    if (child === rootObject || !child?.name) {
      return;
    }

    const key = normalizeWheelAnchorName(child.name);
    if (!key || (!child.isMesh && child.children.length === 0)) {
      return;
    }

    if (!wheels.has(key)) {
      wheels.set(key, []);
    }
    wheels.get(key).push(child);
  });

  if (!ORDERED_WHEEL_KEYS.every((key) => wheels.has(key))) {
    return null;
  }

  const selectedSources = new Map(
    ORDERED_WHEEL_KEYS.map((key) => {
      const candidates = wheels.get(key);
      const source = selectBestEmbeddedWheelCandidate(candidates);
      return [key, { candidates, source, size: measureEmbeddedWheelCandidateSize(source) }];
    })
  );

  reconcileEmbeddedWheelPair(selectedSources, 'front-left', 'front-right');
  reconcileEmbeddedWheelPair(selectedSources, 'rear-left', 'rear-right');

  return ORDERED_WHEEL_KEYS.map((key) => {
    const selected = selectedSources.get(key);
    const candidates = selected?.candidates || [];
    const source = selected?.source;
    if (!source) {
      return null;
    }
    const asset = source.clone(true);
    for (const candidate of candidates) {
      candidate.parent?.remove(candidate);
    }
    return { name: key, asset };
  }).filter(Boolean);
}

export function primeCarWheelRuntimeState(wheelMount) {
  if (!wheelMount) {
    return;
  }

  for (const wheel of wheelMount.children) {
    if (!wheel?.isObject3D) {
      continue;
    }

    wheel.userData.baseQuaternion = wheel.quaternion.clone();
    wheel.userData.restPosition = wheel.position.clone();
    wheel.userData.restContactHeight = undefined;
    wheel.userData.suspensionOffset = 0;

    const spinPivot = wheel.children[0];
    if (spinPivot?.isObject3D) {
      const axis = spinPivot.userData.spinAxis || 'x';
      spinPivot.rotation.x = 0;
      spinPivot.rotation.y = 0;
      spinPivot.rotation.z = 0;
      spinPivot.rotation[axis] = 0;
    }
  }
}

export function applyCarWheelPose(wheelMount, { steerAngle = 0, wheelSpin = 0, suspensionOffset = 0 } = {}) {
  if (!wheelMount) {
    return;
  }

  for (const wheel of wheelMount.children) {
    if (!wheel?.isObject3D) {
      continue;
    }

    const baseQuaternion = wheel.userData.baseQuaternion || wheel.quaternion.clone();
    wheel.quaternion.copy(baseQuaternion);
    if (wheel.userData.canSteer) {
      const steerQuaternion = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        steerAngle * Number(wheel.userData.steerSign || 1)
      );
      wheel.quaternion.multiply(steerQuaternion);
    }

    if (wheel.userData.restPosition) {
      wheel.position.copy(wheel.userData.restPosition);
      wheel.position.y += suspensionOffset;
    }

    const spinPivot = wheel.children[0];
    if (spinPivot?.isObject3D) {
      const axis = spinPivot.userData.spinAxis || 'x';
      spinPivot.rotation.x = 0;
      spinPivot.rotation.y = 0;
      spinPivot.rotation.z = 0;
      spinPivot.rotation[axis] = wheelSpin * Number(spinPivot.userData.spinSign || 1);
    }
  }
}
