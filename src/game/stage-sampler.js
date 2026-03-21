import * as THREE from 'three';

const DOWN = new THREE.Vector3(0, -1, 0);
const ORIGIN = new THREE.Vector3();
const WORLD_NORMAL = new THREE.Vector3();
const BOX = new THREE.Box3();
const BOX_CENTER = new THREE.Vector3();
const BOX_HIT_POINT = new THREE.Vector3();
const BOX_HIT_NORMAL = new THREE.Vector3();

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

    return sampleRootCollision(root, raycaster, origin, direction, far);
  };
}

export function createObjectCollisionSampler(resolveRoots) {
  const raycaster = new THREE.Raycaster();

  return function sampleCollision(origin, direction, far) {
    if (far <= 0) {
      return null;
    }

    const roots = typeof resolveRoots === 'function'
      ? resolveRoots()
      : resolveRoots;
    if (!roots) {
      return null;
    }

    const rootList = Array.isArray(roots) ? roots : [roots];
    let nearestHit = null;
    for (const root of rootList) {
      const hit = sampleRootCollision(root, raycaster, origin, direction, far);
      if (!hit) {
        continue;
      }
      if (!nearestHit || hit.distance < nearestHit.distance) {
        nearestHit = hit;
      }
    }

    return nearestHit;
  };
}

export function createBoundsCollisionSampler(resolveRoots, options = {}) {
  const padding = Number.isFinite(options.padding) ? options.padding : 0;

  return function sampleCollision(origin, direction, far) {
    if (far <= 0) {
      return null;
    }

    const roots = typeof resolveRoots === 'function'
      ? resolveRoots()
      : resolveRoots;
    if (!roots) {
      return null;
    }

    const rootList = Array.isArray(roots) ? roots : [roots];
    let nearestHit = null;

    for (const root of rootList) {
      const hit = sampleBoundsCollision(root, origin, direction, far, padding);
      if (!hit) {
        continue;
      }
      if (!nearestHit || hit.distance < nearestHit.distance) {
        nearestHit = hit;
      }
    }

    return nearestHit;
  };
}

export function createCompositeCollisionSampler(resolveSamplers) {
  return function sampleCollision(origin, direction, far) {
    if (far <= 0) {
      return null;
    }

    const samplers = typeof resolveSamplers === 'function'
      ? resolveSamplers()
      : resolveSamplers;
    if (!samplers?.length) {
      return null;
    }

    let nearestHit = null;
    for (const sampler of samplers) {
      if (typeof sampler !== 'function') {
        continue;
      }
      const hit = sampler(origin, direction, far);
      if (!hit) {
        continue;
      }
      if (!nearestHit || hit.distance < nearestHit.distance) {
        nearestHit = hit;
      }
    }

    return nearestHit;
  };
}

function sampleRootCollision(root, raycaster, origin, direction, far) {
  if (!root) {
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
}

function sampleBoundsCollision(root, origin, direction, far, padding) {
  if (!root?.visible) {
    return null;
  }

  root.updateMatrixWorld(true);
  BOX.setFromObject(root);
  if (BOX.isEmpty()) {
    return null;
  }

  if (padding !== 0) {
    BOX.expandByScalar(padding);
  }

  const hitPoint = BOX.intersectRay(new THREE.Ray(origin, direction), BOX_HIT_POINT);
  if (!hitPoint) {
    return null;
  }

  const distance = origin.distanceTo(hitPoint);
  if (!Number.isFinite(distance) || distance > far) {
    return null;
  }

  BOX.getCenter(BOX_CENTER);
  const dx = Math.abs(hitPoint.x - BOX_CENTER.x);
  const dy = Math.abs(hitPoint.y - BOX_CENTER.y);
  const dz = Math.abs(hitPoint.z - BOX_CENTER.z);
  BOX_HIT_NORMAL.set(0, 0, 0);
  if (dx >= dy && dx >= dz) {
    BOX_HIT_NORMAL.x = hitPoint.x >= BOX_CENTER.x ? 1 : -1;
  } else if (dy >= dx && dy >= dz) {
    BOX_HIT_NORMAL.y = hitPoint.y >= BOX_CENTER.y ? 1 : -1;
  } else {
    BOX_HIT_NORMAL.z = hitPoint.z >= BOX_CENTER.z ? 1 : -1;
  }

  return {
    point: hitPoint.clone(),
    normal: BOX_HIT_NORMAL.clone(),
    distance
  };
}
