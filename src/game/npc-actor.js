import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  loadHumanoidActor,
  setHumanoidActorAction,
  stabilizeHumanoidRootMotion,
  updateHumanoidActor
} from './humanoid-actor.js';
import { inferVehicleForwardYawRadians } from '../vehicles/vehicle-orientation.js';
import { loadTrafficVehicleActor } from './traffic-vehicle-actor.js';

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const ORIENT_QUAT = new THREE.Quaternion();
const VEHICLE_COLORS = ['#f25f5c', '#247ba0', '#f4d35e', '#70c1b3', '#9b5de5', '#ef476f'];
const PEDESTRIAN_COLORS = ['#f2b880', '#8ecae6', '#a7c957', '#e5989b', '#ffb703', '#cdb4db'];
const SHARED_GEOMETRIES = {
  vehicleBody: new THREE.BoxGeometry(1.86, 0.56, 4.12),
  vehicleCabin: new THREE.BoxGeometry(1.28, 0.42, 1.84),
  pedestrianBody: new THREE.CapsuleGeometry(0.18, 0.72, 4, 8),
  pedestrianHead: new THREE.SphereGeometry(0.16, 10, 8)
};
const MATERIAL_CACHE = new Map();
const SHARED_FBX_LOADER = new FBXLoader();
const SHARED_GLTF_LOADER = new GLTFLoader();
const VEHICLE_TEMPLATE_CACHE = new Map();
const HUMANOID_IDLE_SPEED = 0.08;
const HUMANOID_RUN_SPEED = 2.4;

export function createNpcActor({ archetype, crowdKind, index = 0, gltfLoader = SHARED_GLTF_LOADER }) {
  const resolvedArchetype = archetype || createFallbackArchetype(crowdKind);
  const root = new THREE.Group();
  root.name = `${resolvedArchetype.id}:${index}`;
  const visualMount = new THREE.Group();
  root.add(visualMount);

  const primitiveFallback = createPrimitiveRoot(resolvedArchetype, crowdKind, index);
  let activeVisual = primitiveFallback;
  let humanoid = null;
  let glbVehicle = null;
  let trafficVehicle = null;
  let disposed = false;
  visualMount.add(primitiveFallback);

  if (resolvedArchetype.presentation?.driver === 'humanoid_fbx' && resolvedArchetype.presentation?.modelUrl) {
    loadHumanoidActor({
      fbxLoader: SHARED_FBX_LOADER,
      modelUrl: resolvedArchetype.presentation.modelUrl,
      animationUrls: resolvedArchetype.presentation.animationUrls,
      config: {
        height: resolvedArchetype.presentation.height || resolvedArchetype.collisionProxy?.height || 1.8
      }
    }).then((actor) => {
      if (disposed) {
        return;
      }
      humanoid = actor;
      visualMount.remove(activeVisual);
      activeVisual = actor.root;
      visualMount.add(actor.root);
    }).catch((error) => {
      console.error(`[npc-actor] failed to load ${resolvedArchetype.id}`, error);
    });
  } else if (resolvedArchetype.presentation?.driver === 'traffic_vehicle_runtime') {
    loadTrafficVehicleActor(resolvedArchetype, { gltfLoader }).then((actor) => {
      if (disposed) {
        return;
      }
      trafficVehicle = actor;
      root.position.set(0, 0, 0);
      root.quaternion.identity();
      visualMount.remove(activeVisual);
      activeVisual = actor.root;
      visualMount.add(actor.root);
    }).catch((error) => {
      console.error(`[npc-actor] failed to load ${resolvedArchetype.id}`, error);
    });
  } else if (resolvedArchetype.presentation?.driver === 'vehicle_glb' && resolvedArchetype.presentation?.modelUrl) {
    loadVehicleActor(resolvedArchetype, { gltfLoader }).then((actor) => {
      if (disposed) {
        return;
      }
      glbVehicle = actor;
      visualMount.remove(activeVisual);
      activeVisual = actor.root;
      visualMount.add(actor.root);
    }).catch((error) => {
      console.error(`[npc-actor] failed to load ${resolvedArchetype.id}`, error);
    });
  }

  return {
    id: `${resolvedArchetype.id}:${index}`,
    kind: crowdKind,
    subtype: resolvedArchetype.subtype || crowdKind,
    archetype: resolvedArchetype,
    root,
    claimMountedRig() {
      return trafficVehicle?.claimMountedRig?.() || null;
    },
    updatePresentation({
      position,
      yaw = 0,
      speed = 0,
      timeSeconds = 0,
      deltaSeconds = 0,
      velocity = null,
      desiredVelocity = null,
      corners = null,
      laneTargetPoint = null,
      laneTargetTangent = null,
      laneDesiredSpeed = null,
      targetPosition = null,
      targetState = null
    }) {
      if (trafficVehicle) {
        trafficVehicle.update({
          position,
          yaw,
          speed,
          velocity,
          desiredVelocity,
          corners,
          laneTargetPoint,
          laneTargetTangent,
          laneDesiredSpeed,
          targetPosition,
          targetState,
          deltaSeconds
        });
        return;
      }

      if (position?.isVector3) {
        root.position.copy(position);
      } else if (Array.isArray(position)) {
        root.position.set(position[0] || 0, position[1] || 0, position[2] || 0);
      } else if (position && typeof position === 'object') {
        root.position.set(position.x || 0, position.y || 0, position.z || 0);
      }

      ORIENT_QUAT.setFromAxisAngle(UP_AXIS, yaw);
      root.quaternion.copy(ORIENT_QUAT);

      if (humanoid) {
        const placementOffsetY = Number(resolvedArchetype.presentation?.offsetY || 0);
        humanoid.root.position.y = placementOffsetY;
        const nextAction = speed <= HUMANOID_IDLE_SPEED
          ? 'idle'
          : speed >= HUMANOID_RUN_SPEED && humanoid.actions.has('run')
            ? 'run'
            : humanoid.actions.has('walk')
              ? 'walk'
              : 'idle';
        setHumanoidActorAction(humanoid, nextAction);
        updateHumanoidActor(humanoid, deltaSeconds);
        stabilizeHumanoidRootMotion(humanoid, { stabilizeVertical: true });
        return;
      }

      if (glbVehicle) {
        updateVehicleWheelPresentation(glbVehicle, speed, deltaSeconds);
        return;
      }

      if (resolvedArchetype.presentation?.primitive === 'pedestrian') {
        const bob = speed > 0.05 ? Math.sin(timeSeconds * 7.5 + index * 0.37) * 0.03 : 0;
        root.position.y += bob;
      }
    },
    dispose() {
      disposed = true;
      humanoid?.root?.removeFromParent?.();
      glbVehicle?.root?.removeFromParent?.();
      trafficVehicle?.root?.removeFromParent?.();
      root.removeFromParent();
    }
  };
}

async function loadVehicleActor(archetype, { gltfLoader = SHARED_GLTF_LOADER } = {}) {
  const template = await loadVehicleTemplate(archetype.presentation.modelUrl, gltfLoader);
  const root = template.clone(true);
  normalizeVehicleToTargetSpan(root, archetype.presentation.targetSpan || 5.4);
  const hasExplicitYaw = Object.hasOwn(archetype.presentation || {}, 'yawDegrees');
  root.rotation.y += hasExplicitYaw
    ? THREE.MathUtils.degToRad(Number(archetype.presentation.yawDegrees || 0))
    : inferVehicleForwardYawRadians(root);
  prepareVehicleRenderable(root);
  const wheels = collectVehicleWheelNodes(root);
  return { root, wheels };
}

async function loadVehicleTemplate(modelUrl, gltfLoader = SHARED_GLTF_LOADER) {
  const cacheKey = `${modelUrl}::${gltfLoader === SHARED_GLTF_LOADER ? 'shared' : 'custom'}`;
  if (!VEHICLE_TEMPLATE_CACHE.has(cacheKey)) {
    VEHICLE_TEMPLATE_CACHE.set(
      cacheKey,
      gltfLoader.loadAsync(modelUrl).then((gltf) => gltf.scene || gltf.scenes?.[0] || null)
    );
  }
  return VEHICLE_TEMPLATE_CACHE.get(cacheKey);
}

function normalizeVehicleToTargetSpan(root, targetSpan) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) {
    return;
  }

  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const horizontalSpan = Math.max(size.x, size.z);
  const scale = horizontalSpan > 0 ? targetSpan / horizontalSpan : 1;

  root.position.sub(center);
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);

  const fittedBounds = new THREE.Box3().setFromObject(root);
  root.position.y -= fittedBounds.min.y;
}

function prepareVehicleRenderable(root) {
  root.traverse((child) => {
    if (!child.isMesh) {
      return;
    }

    child.castShadow = true;
    child.receiveShadow = true;
    if (isVehicleWindowMesh(child)) {
      child.material = cloneMaterialSet(child.material);
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        material.transparent = true;
        material.opacity = /windshield|front.*window|window.*front/i.test(String(child.name || '').toLowerCase()) ? 0.72 : 0.58;
        if ('depthWrite' in material) {
          material.depthWrite = false;
        }
      }
    }
  });
}

function collectVehicleWheelNodes(root) {
  const wheels = [];
  root.traverse((child) => {
    if (!child?.isObject3D || !child.name) {
      return;
    }
    if (/tire|wheel|rim/i.test(child.name)) {
      wheels.push({
        object: child,
        baseRotationX: child.rotation.x
      });
    }
  });
  return wheels;
}

function updateVehicleWheelPresentation(vehicle, speed, deltaSeconds) {
  const spin = speed * deltaSeconds * 2.6;
  for (const wheel of vehicle.wheels || []) {
    wheel.object.rotation.x = wheel.baseRotationX - spin;
  }
}

function isVehicleWindowMesh(mesh) {
  return Boolean(mesh?.name) && /windshield|window|glass/i.test(mesh.name);
}

function cloneMaterialSet(material) {
  if (Array.isArray(material)) {
    return material.map((entry) => entry?.clone?.() || entry);
  }
  return material?.clone?.() || material;
}

function createFallbackArchetype(crowdKind) {
  return {
    id: `${crowdKind}_fallback`,
    label: `${crowdKind} fallback`,
    crowdKind,
    subtype: crowdKind === 'vehicle' ? 'traffic_vehicle' : 'pedestrian',
    presentation: {
      driver: 'primitive',
      primitive: crowdKind === 'vehicle' ? 'vehicle' : 'pedestrian',
      palette: crowdKind === 'vehicle' ? 'vehicle' : 'pedestrian'
    }
  };
}

function createPrimitiveRoot(archetype, crowdKind, index) {
  const primitive = archetype?.presentation?.primitive || (crowdKind === 'vehicle' ? 'vehicle' : 'pedestrian');
  return primitive === 'vehicle'
    ? createVehiclePrimitive(archetype, index)
    : createPedestrianPrimitive(archetype, index);
}

function createVehiclePrimitive(archetype, index) {
  const group = new THREE.Group();
  group.name = `${archetype.id}:vehicle`;

  const body = new THREE.Mesh(
    SHARED_GEOMETRIES.vehicleBody,
    getCachedMaterial(`vehicle-body:${index % VEHICLE_COLORS.length}`, () =>
      new THREE.MeshStandardMaterial({
        color: VEHICLE_COLORS[index % VEHICLE_COLORS.length],
        roughness: 0.68,
        metalness: 0.18
      })
    )
  );
  body.position.y = 0.38;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(
    SHARED_GEOMETRIES.vehicleCabin,
    getCachedMaterial('vehicle-cabin', () =>
      new THREE.MeshStandardMaterial({
        color: '#a9b5c4',
        roughness: 0.28,
        metalness: 0.04
      })
    )
  );
  cabin.position.y = 0.72;
  cabin.castShadow = true;
  cabin.receiveShadow = true;
  group.add(cabin);
  return group;
}

function createPedestrianPrimitive(archetype, index) {
  const group = new THREE.Group();
  group.name = `${archetype.id}:pedestrian`;

  const body = new THREE.Mesh(
    SHARED_GEOMETRIES.pedestrianBody,
    getCachedMaterial(`pedestrian-body:${index % PEDESTRIAN_COLORS.length}`, () =>
      new THREE.MeshStandardMaterial({
        color: PEDESTRIAN_COLORS[index % PEDESTRIAN_COLORS.length],
        roughness: 0.92,
        metalness: 0.02
      })
    )
  );
  body.position.y = 0.58;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    SHARED_GEOMETRIES.pedestrianHead,
    getCachedMaterial('pedestrian-head', () =>
      new THREE.MeshStandardMaterial({
        color: '#f0c39b',
        roughness: 0.9,
        metalness: 0.01
      })
    )
  );
  head.position.y = 1.16;
  head.castShadow = true;
  head.receiveShadow = true;
  group.add(head);
  return group;
}

function getCachedMaterial(key, factory) {
  if (!MATERIAL_CACHE.has(key)) {
    MATERIAL_CACHE.set(key, factory());
  }
  return MATERIAL_CACHE.get(key);
}
