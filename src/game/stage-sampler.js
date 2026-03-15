import * as THREE from 'three';

const DOWN = new THREE.Vector3(0, -1, 0);
const ORIGIN = new THREE.Vector3();
const WORLD_NORMAL = new THREE.Vector3();

function hasAncestorFlag(object, flag) {
  let current = object;
  while (current) {
    if (current.userData?.[flag]) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function shouldBlock(material) {
  if (!material) {
    return false;
  }
  if (material.userData?.noGround) {
    return false;
  }
  if (material.isMeshBasicMaterial) {
    return false;
  }
  if (material.transparent && Number(material.opacity ?? 1) < 0.98) {
    return false;
  }
  return true;
}

export function createStageGroundSampler(root, options = {}) {
  const raycaster = new THREE.Raycaster();
  const rayStart = options.rayStart ?? 4.5;
  const rayDistance = options.rayDistance ?? 12;
  const minNormalY = options.minNormalY ?? -1;

  return function sampleGround(x, z, referenceY = 0) {
    if (!root) {
      return null;
    }

    root.updateMatrixWorld(true);
    ORIGIN.set(x, referenceY + rayStart, z);
    raycaster.set(ORIGIN, DOWN);
    raycaster.far = rayStart + rayDistance;

    const intersections = raycaster.intersectObject(root, true);
    for (const hit of intersections) {
      if (!hit.object?.visible) {
        continue;
      }
      if (hasAncestorFlag(hit.object, 'noSuspension')) {
        continue;
      }

      const materials = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material];
      const blocksSuspension = materials.some(shouldBlock);

      if (!blocksSuspension) {
        continue;
      }

      const normal = hit.face
        ? WORLD_NORMAL.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize().clone()
        : null;

      if (normal && normal.y < minNormalY) {
        continue;
      }

      return {
        height: hit.point.y,
        normal,
        distance: hit.distance
      };
    }

    return null;
  };
}

export function createStageCollisionSampler(root) {
  const raycaster = new THREE.Raycaster();

  return function sampleCollision(origin, direction, far) {
    if (!root || far <= 0) {
      return null;
    }

    root.updateMatrixWorld(true);
    raycaster.set(origin, direction);
    raycaster.far = far;

    const intersections = raycaster.intersectObject(root, true);
    for (const hit of intersections) {
      if (!hit.object?.visible) {
        continue;
      }
      if (hasAncestorFlag(hit.object, 'noCollision')) {
        continue;
      }

      const materials = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material];
      if (!materials.some(shouldBlock)) {
        continue;
      }

      const normal = hit.face
        ? WORLD_NORMAL.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize().clone()
        : null;

      return {
        point: hit.point.clone(),
        normal,
        distance: hit.distance
      };
    }

    return null;
  };
}
