import * as THREE from 'three';

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const ENTRY_CENTER = new THREE.Vector3();
const ENTRY_ORIGIN_LOCAL = new THREE.Vector3();
const ENTRY_DIRECTION_LOCAL = new THREE.Vector3();
const ENTRY_HIT_POINT = new THREE.Vector3();
const ENTRY_HIT_NORMAL = new THREE.Vector3();
const ENTRY_QUATERNION = new THREE.Quaternion();
const ENTRY_INVERSE_QUATERNION = new THREE.Quaternion();
const ENTRY_TO_CENTER = new THREE.Vector3();

export function createNpcColliderRuntime(stagePhysics) {
  const world = stagePhysics?.world || null;
  if (!world) {
    return null;
  }

  return {
    world,
    terrainBody: stagePhysics?.terrainBody || null,
    entries: new Map(),
    bodyToAgent: new Map()
  };
}

export function createNpcCollider(runtime, agent) {
  if (!runtime?.world || !agent) {
    return null;
  }

  const spec = getColliderSpec(agent.kind);
  const shape = runtime.world.createBox({
    width: spec.width,
    height: spec.height,
    depth: spec.depth
  });
  const body = runtime.world.createKinematicBody({
    shape,
    position: [0, spec.offsetY, 0],
    orientation: [0, 0, 0],
    friction: spec.friction,
    restitution: spec.restitution,
    isSleepingEnabled: false,
    linearDamping: 0,
    angularDamping: 0
  });

  const entry = {
    agent,
    kind: agent.kind,
    shape,
    body,
    width: spec.width,
    height: spec.height,
    depth: spec.depth,
    broadphaseRadius: Math.sqrt(
      spec.width * spec.width +
      spec.height * spec.height +
      spec.depth * spec.depth
    ) * 0.5,
    position: new THREE.Vector3(0, spec.offsetY, 0),
    yaw: 0,
    offsetY: spec.offsetY
  };
  runtime.entries.set(agent, entry);
  runtime.bodyToAgent.set(body, agent);
  agent.collider = entry;
  return entry;
}

export function updateNpcCollider(runtime, agent, position, yaw = 0) {
  const entry = runtime?.entries?.get(agent);
  if (!entry?.body) {
    return;
  }

  const x = Array.isArray(position) ? position[0] || 0 : position?.x || 0;
  const y = Array.isArray(position) ? position[1] || 0 : position?.y || 0;
  const z = Array.isArray(position) ? position[2] || 0 : position?.z || 0;
  entry.position.set(x, y + entry.offsetY, z);
  entry.yaw = yaw;
  entry.body.position.set([x, y + entry.offsetY, z]);
  entry.body.orientation.set([0, yaw, 0]);
  entry.body.commitChanges();
}

export function destroyNpcCollider(runtime, agent) {
  const entry = runtime?.entries?.get(agent);
  if (!entry) {
    return;
  }

  runtime.entries.delete(agent);
  runtime.bodyToAgent.delete(entry.body);
  agent.collider = null;

  if (entry.body) {
    runtime.world.destroyBody(entry.body);
  }
  if (entry.shape) {
    runtime.world.destroyShape(entry.shape);
  }
}

export function destroyNpcColliderRuntime(runtime) {
  if (!runtime) {
    return;
  }

  for (const entry of runtime.entries.values()) {
    if (entry.body) {
      runtime.world.destroyBody(entry.body);
    }
    if (entry.shape) {
      runtime.world.destroyShape(entry.shape);
    }
    if (entry.agent) {
      entry.agent.collider = null;
    }
  }
  runtime.entries.clear();
  runtime.bodyToAgent.clear();
}

export function isNpcColliderTouchingDynamic(runtime, agent) {
  const body = agent?.collider?.body;
  if (!runtime?.world || !body) {
    return false;
  }

  for (const manifold of runtime.world.iterateContactManifolds(body)) {
    const bodyA = manifold.bodyA;
    const bodyB = manifold.bodyB;
    const other = bodyA === body ? bodyB : bodyA;
    if (!other) {
      continue;
    }
    if (other === runtime.terrainBody) {
      continue;
    }
    if (runtime.bodyToAgent.has(other)) {
      return true;
    }
    if (Number(other.inverseMass || 0) > 0) {
      return true;
    }
  }

  return false;
}

export function sampleNpcColliderCollision(runtime, origin, direction, far) {
  if (!runtime?.entries?.size || far <= 0 || !origin || !direction) {
    return null;
  }

  let nearestHit = null;
  for (const entry of runtime.entries.values()) {
    const hit = intersectNpcColliderEntry(entry, origin, direction, far);
    if (!hit) {
      continue;
    }
    if (!nearestHit || hit.distance < nearestHit.distance) {
      nearestHit = hit;
    }
  }

  return nearestHit;
}

function getColliderSpec(kind) {
  if (kind === 'vehicle') {
    return {
      width: 1.9,
      height: 1.45,
      depth: 4.7,
      offsetY: 0.72,
      friction: 0.14,
      restitution: 0.02
    };
  }

  return {
    width: 0.7,
    height: 1.75,
    depth: 0.7,
    offsetY: 0.88,
    friction: 0.4,
    restitution: 0.02
  };
}

function intersectNpcColliderEntry(entry, origin, direction, far) {
  if (!entry?.body) {
    return null;
  }

  ENTRY_TO_CENTER.copy(entry.position || ENTRY_CENTER.set(0, 0, 0)).sub(origin);
  const alongRay = ENTRY_TO_CENTER.dot(direction);
  const broadphaseRadius = Math.max(0.01, Number(entry.broadphaseRadius || 0.5));
  if (alongRay < -broadphaseRadius || alongRay > far + broadphaseRadius) {
    return null;
  }
  const centerDistanceSq = ENTRY_TO_CENTER.lengthSq();
  const closestApproachSq = centerDistanceSq - alongRay * alongRay;
  if (closestApproachSq > broadphaseRadius * broadphaseRadius) {
    return null;
  }

  const yaw = Number(entry.yaw || 0);
  const halfX = Math.max(0.01, Number(entry.width || 0.5) * 0.5);
  const halfY = Math.max(0.01, Number(entry.height || 0.5) * 0.5);
  const halfZ = Math.max(0.01, Number(entry.depth || 0.5) * 0.5);
  ENTRY_CENTER.copy(entry.position || ENTRY_CENTER.set(0, 0, 0));

  ENTRY_QUATERNION.setFromAxisAngle(UP_AXIS, yaw);
  ENTRY_INVERSE_QUATERNION.copy(ENTRY_QUATERNION).invert();
  ENTRY_ORIGIN_LOCAL.copy(origin).sub(ENTRY_CENTER).applyQuaternion(ENTRY_INVERSE_QUATERNION);
  ENTRY_DIRECTION_LOCAL.copy(direction).applyQuaternion(ENTRY_INVERSE_QUATERNION);

  let tMin = -Infinity;
  let tMax = Infinity;
  let hitAxis = null;
  let hitAxisSign = 1;

  for (const axis of ['x', 'y', 'z']) {
    const originValue = ENTRY_ORIGIN_LOCAL[axis];
    const directionValue = ENTRY_DIRECTION_LOCAL[axis];
    const halfExtent = axis === 'x' ? halfX : axis === 'y' ? halfY : halfZ;

    if (Math.abs(directionValue) <= 1e-8) {
      if (originValue < -halfExtent || originValue > halfExtent) {
        return null;
      }
      continue;
    }

    let t1 = (-halfExtent - originValue) / directionValue;
    let t2 = (halfExtent - originValue) / directionValue;
    let nearSign = -1;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
      nearSign = 1;
    }

    if (t1 > tMin) {
      tMin = t1;
      hitAxis = axis;
      hitAxisSign = nearSign;
    }
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) {
      return null;
    }
  }

  const hitDistance = tMin >= 0 ? tMin : (tMax >= 0 ? 0 : null);
  if (!Number.isFinite(hitDistance) || hitDistance > far) {
    return null;
  }

  ENTRY_HIT_POINT.copy(direction).multiplyScalar(hitDistance).add(origin);
  ENTRY_HIT_NORMAL.set(0, 0, 0);
  if (hitAxis) {
    ENTRY_HIT_NORMAL[hitAxis] = hitAxisSign;
    ENTRY_HIT_NORMAL.applyQuaternion(ENTRY_QUATERNION).normalize();
  }

  return {
    point: ENTRY_HIT_POINT.clone(),
    normal: hitAxis ? ENTRY_HIT_NORMAL.clone() : null,
    distance: hitDistance
  };
}
