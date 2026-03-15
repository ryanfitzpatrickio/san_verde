import * as THREE from 'three';
import { World } from '@perplexdotgg/bounce';

const WORLD_POSITION = new THREE.Vector3();
const FORWARD_VECTOR = new THREE.Vector3();
const RIGHT_VECTOR = new THREE.Vector3();
const LINEAR_VELOCITY = new THREE.Vector3();
const PLANAR_VELOCITY = new THREE.Vector3();
const ROTATION_EULER = new THREE.Euler();
const TEMP_MATRIX = new THREE.Matrix4();
const UPRIGHT_QUATERNION = new THREE.Quaternion();
const DYNAMIC_WORLD_POSITION = new THREE.Vector3();
const DYNAMIC_WORLD_QUATERNION = new THREE.Quaternion();
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const FRONT_AXLE_POINT = new THREE.Vector3();
const REAR_AXLE_POINT = new THREE.Vector3();
const FRONT_AXLE_OFFSET = new THREE.Vector3();
const REAR_AXLE_OFFSET = new THREE.Vector3();
const FRONT_STEER_VECTOR = new THREE.Vector3();
const FRONT_SIDE_VECTOR = new THREE.Vector3();
const FRONT_POINT_VELOCITY = new THREE.Vector3();
const REAR_POINT_VELOCITY = new THREE.Vector3();
const DRIVE_FORCE_VECTOR = new THREE.Vector3();
const BRAKE_FORCE_VECTOR = new THREE.Vector3();
const FRONT_BRAKE_FORCE = new THREE.Vector3();
const REAR_BRAKE_FORCE = new THREE.Vector3();
const FRONT_LATERAL_FORCE = new THREE.Vector3();
const REAR_LATERAL_FORCE = new THREE.Vector3();
const BODY_UP_VECTOR = new THREE.Vector3();
const WHEEL_WORLD_POINT = new THREE.Vector3();
const WHEEL_BODY_POINT = new THREE.Vector3();
const WHEEL_OFFSET_WORLD = new THREE.Vector3();
const ANGULAR_VELOCITY = new THREE.Vector3();
const WHEEL_POINT_VELOCITY = new THREE.Vector3();
const WHEEL_FORWARD_VECTOR = new THREE.Vector3();
const WHEEL_SIDE_VECTOR = new THREE.Vector3();
const WHEEL_FORCE_VECTOR = new THREE.Vector3();
const WHEEL_BRAKE_VECTOR = new THREE.Vector3();
const WHEEL_LATERAL_VECTOR = new THREE.Vector3();
const WHEEL_CONTACT_NORMAL = new THREE.Vector3();
const WHEEL_CONTACT_POINT = new THREE.Vector3();
const WHEEL_BASE_LOCAL = new THREE.Vector3();
const WHEEL_REST_LOCAL = new THREE.Vector3();
const WHEEL_ROOT_LOCAL = new THREE.Vector3();
const WHEEL_SUSPENSION_DIRECTION = new THREE.Vector3();
const WHEEL_PROJECTED_FORWARD = new THREE.Vector3();
const WHEEL_PROJECTED_RIGHT = new THREE.Vector3();
const WHEEL_POINT_ANGULAR_VELOCITY = new THREE.Vector3();
const WHEEL_RELATIVE_POINT = new THREE.Vector3();
const WHEEL_NORMAL_FORCE = new THREE.Vector3();
const ANTIROLL_FORCE_VECTOR = new THREE.Vector3();
const AVERAGE_GROUND_NORMAL = new THREE.Vector3();
const GROUND_ALIGN_FORWARD = new THREE.Vector3();
const GROUND_ALIGN_RIGHT = new THREE.Vector3();
const GROUND_ALIGN_MATRIX = new THREE.Matrix4();
const GROUND_ALIGN_QUATERNION = new THREE.Quaternion();
const FRONT_STEER_FOLLOW_VECTOR = new THREE.Vector3();
const BIKE_FRONT_CONTACT_POINT = new THREE.Vector3();
const BIKE_REAR_CONTACT_POINT = new THREE.Vector3();
const BIKE_FRONT_CONTACT_NORMAL = new THREE.Vector3();
const BIKE_REAR_CONTACT_NORMAL = new THREE.Vector3();
const BIKE_FRONT_BODY_POINT = new THREE.Vector3();
const BIKE_REAR_BODY_POINT = new THREE.Vector3();
const BIKE_FRONT_OFFSET_WORLD = new THREE.Vector3();
const BIKE_REAR_OFFSET_WORLD = new THREE.Vector3();
const BIKE_FRONT_POINT_VELOCITY = new THREE.Vector3();
const BIKE_REAR_POINT_VELOCITY = new THREE.Vector3();
const KINEMATIC_FORWARD = new THREE.Vector3();
const KINEMATIC_EULER = new THREE.Euler();
const KINEMATIC_QUATERNION = new THREE.Quaternion();

function shouldUseColliderMaterial(material) {
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

function hasDynamicColliderAncestor(object) {
  let current = object;
  while (current) {
    if (current.userData?.bounceDynamic) {
      return true;
    }
    if (current.userData?.noCollision) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function collectTriangleMeshData(root) {
  if (!root) {
    return null;
  }

  root.updateMatrixWorld(true);
  const positions = [];
  const indices = [];
  let vertexOffset = 0;

  root.traverse((object) => {
    if (!object?.isMesh || !object.visible || !object.geometry?.attributes?.position) {
      return;
    }
    if (hasDynamicColliderAncestor(object)) {
      return;
    }

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some(shouldUseColliderMaterial)) {
      return;
    }

    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    const position = geometry.attributes.position;
    TEMP_MATRIX.copy(object.matrixWorld);

    for (let index = 0; index < position.count; index += 1) {
      WORLD_POSITION.fromBufferAttribute(position, index).applyMatrix4(TEMP_MATRIX);
      positions.push(WORLD_POSITION.x, WORLD_POSITION.y, WORLD_POSITION.z);
      indices.push(vertexOffset + index);
    }

    vertexOffset += position.count;
    geometry.dispose();
  });

  if (!positions.length || !indices.length) {
    return null;
  }

  return {
    vertexPositions: new Float32Array(positions),
    faceIndices: new Uint32Array(indices)
  };
}

function getVehicleSpec(config, vehicleKind, massKg) {
  if (vehicleKind === 'bike') {
    return {
      shapeType: 'bikeHull',
      width: 0.22,
      height: 0.42,
      depth: 1.16,
      bodyOffsetY: 0.14,
      wheelRadius: 0.34,
      wheelCenterY: 0,
      wheelHalfBase: 0.72,
      rootOffsetY: 0.44,
      friction: 0.1,
      massKg: 260,
      uprightStrength: 420,
      uprightVelocityDamping: 0.78,
      uprightSlerp: 0.1,
      uprightSteerPenalty: 0.72,
      straightBalanceStrength: 520,
      straightBalanceRollLimit: 0.24,
      straightBalanceRollDamping: 0.84,
      groundedLateralForce: 620,
      groundedYawDamping: 0.972,
      highSpeedGroundedLateralForce: 980,
      highSpeedGroundedYawDamping: 0.94,
      highSpeedRecoverySpeedMps: 18,
      steerAngleScale: 0.68,
      steerAuthoritySpeedMps: 18,
      minSteeringAuthority: 0.55,
      casterSpeedStartMps: 4,
      casterSpeedEndMps: 18,
      casterDeadzoneLow: 0.015,
      casterDeadzoneHigh: 0.08,
      casterResponseScaleHigh: 0.54,
      casterReturnScaleHigh: 2.4,
      straightLineYawDamping: 0.82,
      straightLineLateralForce: 3200,
      steerResponseMultiplier: 1,
      driveForceMultiplier: 0.92,
      pitchBalanceStrength: 240,
      pitchBalanceDampingForce: 90,
      rollBalanceStrength: 560,
      rollBalanceDampingForce: 130,
      physicsLeanTarget: 0.02,
      yawControlGainLow: 40,
      yawControlGainHigh: 90,
      yawNoSteerDamping: 0.88,
      yawTorqueGain: 0,
      effectiveWheelbaseScale: 0.96,
      driveDirectionBlend: 0.02,
      frontSteerFollowStrength: 700,
      velocityFollowStrength: 0,
      rearDriveSteerBlend: 0.015,
      lowSpeedTurnYawFollow: 2.2,
      lowSpeedTurnSpeedMps: 12,
      lowSpeedYawAssist: 0,
      highSpeedYawAssist: 0
    };
  }

  return {
    shapeType: 'compound',
    width: 1.18,
    height: 0.32,
    depth: 2.2,
    bodyOffsetY: 0.18,
    wheelRadius: 0.34,
    wheelCenterY: -0.06,
    wheelHalfTrack: 0.68,
    wheelHalfBase: 1.18,
    rootOffsetY: 0.4,
    friction: 0.13,
    massKg: massKg || 1500,
    uprightStrength: 320,
    uprightVelocityDamping: 0.72,
    uprightSlerp: 0.35,
    uprightSteerPenalty: 0.8,
    frontCorneringStiffness: 1650,
    rearCorneringStiffness: 1080,
    brakeFrontBias: 0.62,
    lowSpeedYawAssist: 0.34,
    highSpeedYawAssist: 0.09,
    straightLineYawDamping: 0.82,
    straightLineLateralForce: 620,
    suspensionFrequency: 1.45,
    suspensionDamping: 0.82,
    maxSuspensionForce: 24000,
    frictionSlip: 1.55,
    sideFrictionStiffness: 1.08,
    antiRollStiffness: 5200
  };
}

function getWheelMountMetrics(wheelMount) {
  const wheels = wheelMount?.children?.filter((wheel) => wheel?.isObject3D) || [];
  if (wheels.length < 2) {
    return null;
  }

  const entries = wheels.map((wheel) => {
    const anchorName = String(wheel.userData.anchorName || '');
    const restPosition = wheel.userData.restPosition || wheel.position;
    return {
      anchorName,
      canSteer: Boolean(wheel.userData.canSteer || anchorName.includes('front')),
      position: restPosition,
      radius: Number(wheel.userData.wheelRadius || 0)
    };
  });

  let frontWheel = entries.find((entry) => entry.canSteer || entry.anchorName.includes('front')) || null;
  let rearWheel = entries.find((entry) => entry !== frontWheel && (!entry.canSteer || entry.anchorName.includes('rear'))) || null;

  if (!frontWheel) {
    frontWheel = entries.reduce((best, entry) => (!best || entry.position.z > best.position.z ? entry : best), null);
  }
  if (!rearWheel) {
    rearWheel = entries.reduce((best, entry) => (!best || entry.position.z < best.position.z ? entry : best), null);
  }
  if (!frontWheel || !rearWheel) {
    return null;
  }

  const wheelbase = Math.max(Math.abs(frontWheel.position.z - rearWheel.position.z), 0.9);
  const radii = entries
    .map((entry) => entry.radius)
    .filter((radius) => Number.isFinite(radius) && radius > 0.08);
  const averageRadius = radii.length
    ? radii.reduce((sum, radius) => sum + radius, 0) / radii.length
    : 0.34;

  return {
    averageRadius: THREE.MathUtils.clamp(averageRadius, 0.24, 0.45),
    averageCenterY: (frontWheel.position.y + rearWheel.position.y) * 0.5,
    wheelHalfBase: wheelbase * 0.5,
    wheelbase
  };
}

function resolveBikeSpec(baseSpec, wheelMount) {
  const metrics = getWheelMountMetrics(wheelMount);
  if (!metrics) {
    return baseSpec;
  }

  return {
    ...baseSpec,
    wheelRadius: metrics.averageRadius,
    wheelCenterY: metrics.averageCenterY,
    wheelHalfBase: metrics.wheelHalfBase,
    depth: THREE.MathUtils.clamp(metrics.wheelbase * 0.82, 1.02, 1.3),
    rootOffsetY: THREE.MathUtils.clamp(metrics.averageCenterY + metrics.averageRadius, 0.38, 0.68)
  };
}

function createWorldFromStage(root) {
  const meshData = collectTriangleMeshData(root);
  if (!meshData) {
    return null;
  }

  const world = new World({
    gravity: [0, -9.81, 0],
    timeStepSizeSeconds: 1 / 60,
    linearDamping: 0.08,
    angularDamping: 0.1,
    maxLinearSpeed: 80,
    maxAngularSpeed: 40
  });

  const terrainShape = world.createTriangleMesh({
    vertexPositions: meshData.vertexPositions,
    faceIndices: meshData.faceIndices,
    forceCreateConvexHull: false
  });

  const terrainBody = world.createStaticBody({
    shape: terrainShape,
    friction: 0.18,
    restitution: 0.02
  });

  return { world, terrainShape, terrainBody };
}

function createDynamicBodiesFromStage(root, world) {
  if (!root || !world) {
    return [];
  }

  root.updateMatrixWorld(true);
  const dynamicBodies = [];

  root.traverse((object) => {
    if (!object?.userData?.bounceDynamic) {
      return;
    }

    if (object.userData.bounceDynamic !== 'cone') {
      return;
    }

    const spec = object.userData.bounceConeSpec || {};
    const radius = Math.max(0.04, spec.radius ?? 0.18);
    const height = Math.max(0.1, spec.height ?? 0.78);
    const mass = Math.max(0.1, spec.mass ?? 2.1);
    const bodyOffsetY = height * 0.5 + 0.02;

    object.getWorldPosition(DYNAMIC_WORLD_POSITION);
    object.getWorldQuaternion(DYNAMIC_WORLD_QUATERNION);

    const shape = world.createBox({
      width: radius * 2,
      height,
      depth: radius * 2
    });
    const body = world.createDynamicBody({
      shape,
      position: [
        DYNAMIC_WORLD_POSITION.x,
        DYNAMIC_WORLD_POSITION.y + bodyOffsetY,
        DYNAMIC_WORLD_POSITION.z
      ],
      orientation: [
        DYNAMIC_WORLD_QUATERNION.x,
        DYNAMIC_WORLD_QUATERNION.y,
        DYNAMIC_WORLD_QUATERNION.z,
        DYNAMIC_WORLD_QUATERNION.w
      ],
      mass,
      friction: Math.max(0.01, spec.friction ?? 0.08),
      restitution: Math.max(0, spec.restitution ?? 0.04),
      isSleepingEnabled: false,
      linearDamping: 0.04,
      angularDamping: 0.02
    });

    dynamicBodies.push({
      type: 'cone',
      mesh: object,
      shape,
      body,
      bodyOffsetY
    });
  });

  return dynamicBodies;
}

function syncDynamicBodies(bundle) {
  if (!bundle?.dynamicBodies?.length) {
    return;
  }

  for (const dynamicBody of bundle.dynamicBodies) {
    if (!dynamicBody?.mesh || !dynamicBody.body) {
      continue;
    }

    dynamicBody.mesh.position.set(
      dynamicBody.body.position.x,
      dynamicBody.body.position.y - dynamicBody.bodyOffsetY,
      dynamicBody.body.position.z
    );
    dynamicBody.mesh.quaternion.set(
      dynamicBody.body.orientation.x,
      dynamicBody.body.orientation.y,
      dynamicBody.body.orientation.z,
      dynamicBody.body.orientation.w
    );
  }
}

export function createBounceStagePhysics(stage, config, vehicleKind = 'car', massKg = 0) {
  const colliderRoot = stage?.collisionGroup || stage?.group;
  if (!colliderRoot) {
    return null;
  }

  const built = createWorldFromStage(colliderRoot);
  if (!built) {
    return null;
  }

  const bundle = {
    enabled: true,
    stageId: stage.id,
    vehicleKind,
    defaultVehicleKind: vehicleKind,
    rootOffsetY: 0,
    chassisShape: null,
    chassisBody: null,
    dynamicBodies: createDynamicBodiesFromStage(stage.group, built.world),
    ...built
  };

  configureBounceVehicle(bundle, config, vehicleKind, massKg, stage.startPosition, stage.startYaw);
  return bundle;
}

export function destroyBounceStagePhysics(bundle) {
  if (!bundle?.world) {
    return;
  }

  if (bundle.dynamicBodies?.length) {
    for (const dynamicBody of bundle.dynamicBodies) {
      if (dynamicBody.body) {
        bundle.world.destroyBody(dynamicBody.body);
      }
      if (dynamicBody.shape) {
        bundle.world.destroyShape(dynamicBody.shape);
      }
    }
    bundle.dynamicBodies = [];
  }

  if (bundle.chassisBody) {
    bundle.world.destroyBody(bundle.chassisBody);
    bundle.chassisBody = null;
  }
  if (bundle.chassisShape) {
    bundle.world.destroyShape(bundle.chassisShape);
    bundle.chassisShape = null;
  }
  if (bundle.terrainBody) {
    bundle.world.destroyBody(bundle.terrainBody);
    bundle.terrainBody = null;
  }
  if (bundle.terrainShape) {
    bundle.world.destroyShape(bundle.terrainShape);
    bundle.terrainShape = null;
  }
}

export function configureBounceVehicle(bundle, config, vehicleKind, massKg, position, yaw, wheelMount = null) {
  if (!bundle?.world) {
    return bundle;
  }

  let spec = getVehicleSpec(config, vehicleKind, massKg);
  if (vehicleKind === 'bike') {
    spec = resolveBikeSpec(spec, wheelMount);
  }
  bundle.vehicleKind = vehicleKind;
  bundle.rootOffsetY = spec.rootOffsetY;
  bundle.vehicleSpec = spec;
  bundle.bikeSupportState = {
    frontCompression: 0,
    rearCompression: 0
  };

  if (bundle.chassisBody) {
    bundle.world.destroyBody(bundle.chassisBody);
    bundle.chassisBody = null;
  }
  if (bundle.chassisShape) {
    bundle.world.destroyShape(bundle.chassisShape);
    bundle.chassisShape = null;
  }

  if (spec.shapeType === 'compound') {
    const centerBox = bundle.world.createBox({
      width: spec.width,
      height: spec.height,
      depth: spec.depth
    });
    const wheelSphere = bundle.world.createSphere({ radius: spec.wheelRadius });

    bundle.chassisShape = bundle.world.createCompoundShape([
      { shape: centerBox, transform: { position: [0, spec.bodyOffsetY, 0] } },
      {
        shape: wheelSphere,
        transform: { position: [spec.wheelHalfTrack, spec.wheelCenterY, spec.wheelHalfBase] }
      },
      {
        shape: wheelSphere,
        transform: { position: [-spec.wheelHalfTrack, spec.wheelCenterY, spec.wheelHalfBase] }
      },
      {
        shape: wheelSphere,
        transform: { position: [spec.wheelHalfTrack, spec.wheelCenterY, -spec.wheelHalfBase] }
      },
      {
        shape: wheelSphere,
        transform: { position: [-spec.wheelHalfTrack, spec.wheelCenterY, -spec.wheelHalfBase] }
      }
    ]);
  } else if (spec.shapeType === 'bikeHull') {
    const centerBox = bundle.world.createBox({
      width: spec.width,
      height: spec.height,
      depth: spec.depth
    });

    bundle.chassisShape = bundle.world.createCompoundShape([
      { shape: centerBox, transform: { position: [0, spec.bodyOffsetY, 0] } }
    ]);
  } else {
    bundle.chassisShape = bundle.world.createBox({
      width: spec.width,
      height: spec.height,
      depth: spec.depth
    });
  }

  if (spec.shapeType === 'bikeHull') {
    bundle.chassisBody = bundle.world.createKinematicBody({
      shape: bundle.chassisShape,
      position: [position.x, position.y + spec.rootOffsetY, position.z],
      orientation: [0, yaw, 0],
      friction: spec.friction,
      restitution: 0.02
    });
    bundle.isKinematic = true;
    bundle.kinematicState = { speed: 0, yaw, pitch: 0, lean: 0 };
  } else {
    bundle.chassisBody = bundle.world.createDynamicBody({
      shape: bundle.chassisShape,
      position: [position.x, position.y + spec.rootOffsetY, position.z],
      orientation: [0, yaw, 0],
      friction: spec.friction,
      restitution: 0.02,
      mass: spec.massKg,
      isSleepingEnabled: false,
      linearDamping: 0.12,
      angularDamping: 0.18
    });
    bundle.isKinematic = false;
  }

  bundle.wheelStates = [];

  return bundle;
}

export function resetBounceVehicle(bundle, position, yaw) {
  if (!bundle?.chassisBody) {
    return;
  }

  bundle.chassisBody.position.set([position.x, position.y + bundle.rootOffsetY, position.z]);
  bundle.chassisBody.orientation.set([0, yaw, 0]);
  bundle.chassisBody.commitChanges();
  if (bundle.kinematicState) {
    bundle.kinematicState.speed = 0;
    bundle.kinematicState.yaw = yaw;
    bundle.kinematicState.pitch = 0;
    bundle.kinematicState.lean = 0;
  } else {
    bundle.chassisBody.linearVelocity.zero();
    bundle.chassisBody.angularVelocity.zero();
    bundle.chassisBody.clearForces();
    bundle.chassisBody.commitChanges();
  }
}

export function settleBounceVehicle(bundle, steps = 20) {
  if (!bundle?.world || !bundle?.chassisBody) {
    return;
  }

  if (bundle.isKinematic) {
    // Kinematic bodies are positioned manually — nothing to settle.
    syncDynamicBodies(bundle);
    return;
  }

  bundle.chassisBody.linearVelocity.zero();
  bundle.chassisBody.angularVelocity.zero();
  bundle.chassisBody.clearForces();
  bundle.chassisBody.commitChanges();

  for (let step = 0; step < steps; step += 1) {
    bundle.world.takeOneStep(1 / 60);
    bundle.chassisBody.linearVelocity.zero();
    bundle.chassisBody.angularVelocity.zero();
    bundle.chassisBody.clearForces();
    bundle.chassisBody.commitChanges();
  }

  syncDynamicBodies(bundle);
}

function stepKinematicBike(bundle, params) {
  const {
    deltaSeconds,
    wheelForce,
    brakeForce,
    steerInput,
    steerAngle,
    sampleGround,
    maxVehicleSpeedMps,
    reverseSpeedLimitMps,
    wheelbaseM
  } = params;

  const body = bundle.chassisBody;
  const spec = bundle.vehicleSpec || {};
  const state = bundle.kinematicState;
  const dt = Math.max(deltaSeconds, 1 / 120);

  // --- Speed integration ---
  const mass = spec.massKg ?? 260;
  const brakeSign = Math.sign(state.speed || 1);
  state.speed += (wheelForce / mass) * dt;
  state.speed -= (brakeForce / mass) * brakeSign * dt;
  state.speed -= state.speed * 0.18 * dt; // rolling resistance / drag
  state.speed = THREE.MathUtils.clamp(
    state.speed,
    -(reverseSpeedLimitMps ?? 8),
    maxVehicleSpeedMps ?? 58
  );

  // --- Steering: blends handlebar (low speed) → lean-to-steer (high speed) ---
  const speedAbs = Math.abs(state.speed);
  const effectiveWheelbase = Math.max(wheelbaseM * (spec.effectiveWheelbaseScale ?? 1), 0.01);

  // Blend factor: 0 = full handlebar, 1 = full lean-to-steer
  const steerSpeedBlend = THREE.MathUtils.clamp((speedAbs - 18) / 22, 0, 1); // 18–40 m/s transition

  // Low speed: direct handlebar yaw rate, tight scale so slow circles are just barely possible
  const handlebarSteer = steerAngle * 0.28;
  const handlebarYawRate = speedAbs > 0.2
    ? -(state.speed / effectiveWheelbase) * Math.tan(handlebarSteer)
    : -steerInput * speedAbs * 0.18;

  // High speed: lean drives turning (physics: yawRate = g * lean / speed)
  const maxLean = THREE.MathUtils.lerp(0.06, 0.50, steerSpeedBlend);
  const targetLean = steerInput * maxLean;
  const leanSmoothing = THREE.MathUtils.lerp(0.10, 0.12, steerSpeedBlend);
  state.lean = THREE.MathUtils.lerp(state.lean, targetLean, leanSmoothing);
  const leanYawRate = speedAbs > 1 ? -(9.81 * state.lean) / speedAbs : 0;

  // Blend and apply
  const yawRate = THREE.MathUtils.lerp(handlebarYawRate, leanYawRate, steerSpeedBlend);
  state.yaw += yawRate * dt;

  // --- Forward vector from yaw ---
  KINEMATIC_FORWARD.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));

  // --- Position ---
  const newX = body.position.x + KINEMATIC_FORWARD.x * state.speed * dt;
  const newZ = body.position.z + KINEMATIC_FORWARD.z * state.speed * dt;

  // --- Ground height from sampleGround ---
  const halfBase = spec.wheelHalfBase ?? 0.72;
  const wheelRadius = spec.wheelRadius ?? 0.34;
  const rootOffsetY = spec.rootOffsetY ?? 0.44;
  let newY = body.position.y;
  let targetPitch = 0;

  if (sampleGround) {
    const frontHit = sampleGround(
      newX + KINEMATIC_FORWARD.x * halfBase,
      newZ + KINEMATIC_FORWARD.z * halfBase
    );
    const rearHit = sampleGround(
      newX - KINEMATIC_FORWARD.x * halfBase,
      newZ - KINEMATIC_FORWARD.z * halfBase
    );
    if (frontHit && rearHit) {
      const avgGroundY = (frontHit.height + rearHit.height) * 0.5;
      // body.y = ground + rootOffsetY + wheelRadius - averageCenterY
      // Since rootOffsetY = averageCenterY + wheelRadius this collapses to ground + 2*wheelRadius,
      // but use explicit averageCenterY (from resolveBikeSpec) if available for accuracy.
      const wheelCenterInModel = spec.averageCenterY ?? (rootOffsetY - wheelRadius);
      const targetBodyY = avgGroundY + rootOffsetY + wheelRadius - wheelCenterInModel;
      newY = THREE.MathUtils.lerp(body.position.y, targetBodyY, 0.35);
      targetPitch = Math.atan2(frontHit.height - rearHit.height, halfBase * 2);
    } else if (frontHit || rearHit) {
      const hit = frontHit ?? rearHit;
      const wheelCenterInModel = spec.averageCenterY ?? (rootOffsetY - wheelRadius);
      newY = THREE.MathUtils.lerp(body.position.y, hit.height + rootOffsetY + wheelRadius - wheelCenterInModel, 0.35);
    }
  }

  // --- Orientation: pitch from terrain slope, lean already computed in steering ---
  state.pitch = THREE.MathUtils.lerp(state.pitch, targetPitch, 0.12);

  KINEMATIC_EULER.set(state.pitch, state.yaw, state.lean, 'YXZ');
  KINEMATIC_QUATERNION.setFromEuler(KINEMATIC_EULER);

  body.position.set([newX, newY, newZ]);
  body.orientation.set([
    KINEMATIC_QUATERNION.x,
    KINEMATIC_QUATERNION.y,
    KINEMATIC_QUATERNION.z,
    KINEMATIC_QUATERNION.w
  ]);
  body.commitChanges();

  bundle.world.takeOneStep(dt);
  syncDynamicBodies(bundle);

  return {
    position: new THREE.Vector3(newX, newY - rootOffsetY, newZ),
    quaternion: KINEMATIC_QUATERNION.clone(),
    yaw: state.yaw,
    speed: state.speed,
    yawRate
  };
}

export function stepBounceVehicle(bundle, params) {
  if (!bundle?.chassisBody) {
    return null;
  }

  if (bundle.isKinematic) {
    return stepKinematicBike(bundle, params);
  }

  const {
    deltaSeconds,
    wheelForce,
    brakeForce,
    throttle,
    tractionForceLimit,
    steerAngle,
    steerInput,
    maxSteerAngle,
    wheelbaseM,
    highSpeedSteerFactor,
    rwdYawGain = 0,
    rwdGripLoss = 0,
    reverseSpeedLimitMps,
    maxVehicleSpeedMps,
    sampleGround,
    wheelMount,
    suspensionConfig
  } = params;

  const body = bundle.chassisBody;
  const vehicleSpec = bundle.vehicleSpec || {};
  const isBike = bundle.vehicleKind === 'bike';
  const q = new THREE.Quaternion(body.orientation.x, body.orientation.y, body.orientation.z, body.orientation.w);
  FORWARD_VECTOR.set(0, 0, 1).applyQuaternion(q).setY(0);
  if (FORWARD_VECTOR.lengthSq() < 1e-6) {
    FORWARD_VECTOR.set(0, 0, 1);
  } else {
    FORWARD_VECTOR.normalize();
  }
  RIGHT_VECTOR.set(-FORWARD_VECTOR.z, 0, FORWARD_VECTOR.x);

  LINEAR_VELOCITY.set(body.linearVelocity.x, body.linearVelocity.y, body.linearVelocity.z);
  PLANAR_VELOCITY.copy(LINEAR_VELOCITY).setY(0);
  const planarVelocity = PLANAR_VELOCITY;
  const forwardSpeed = planarVelocity.dot(FORWARD_VECTOR);
  const lateralSpeed = planarVelocity.dot(RIGHT_VECTOR);
  const steerAuthoritySpeedMps = Number(vehicleSpec.steerAuthoritySpeedMps ?? 28);
  const speedFactor = THREE.MathUtils.clamp(Math.abs(forwardSpeed) / Math.max(steerAuthoritySpeedMps, 0.001), 0, 1);
  const steeringAuthority = Math.max(
    THREE.MathUtils.lerp(1, highSpeedSteerFactor, speedFactor),
    Number(vehicleSpec.minSteeringAuthority ?? 0)
  );
  const effectiveSteer = steerAngle * steeringAuthority * Number(vehicleSpec.steerAngleScale ?? 1);
  const normalizedThrottle = THREE.MathUtils.clamp(Math.abs(throttle || 0), 0, 1);
  const tractionLoad = tractionForceLimit > 1e-3
    ? THREE.MathUtils.clamp(Math.abs(wheelForce) / tractionForceLimit, 0, 1)
    : normalizedThrottle;
  const rwdEffect =
    bundle.vehicleKind === 'car'
      ? tractionLoad * THREE.MathUtils.clamp(Math.abs(forwardSpeed) / 12, 0, 1)
      : 0;
  const effectiveWheelbase = Math.max(
    wheelbaseM * Number(vehicleSpec.effectiveWheelbaseScale ?? 1),
    0.01
  );
  const targetYawRate =
    Math.abs(forwardSpeed) > 0.05 && Math.abs(effectiveSteer) > 0.0001
      ? (forwardSpeed / effectiveWheelbase) * Math.tan(effectiveSteer)
      : 0;
  const targetYawRateWithDriveBias =
    targetYawRate * (1 + rwdEffect * rwdYawGain);

  body.clearForces();
  const brakeDirectionSign = Math.sign(forwardSpeed || wheelForce || 1);
  const wheelCenterY = Number(vehicleSpec.wheelCenterY ?? -0.08);
  const wheelHalfBase = Number(vehicleSpec.wheelHalfBase ?? Math.max(wheelbaseM * 0.5, 0.1));
  DRIVE_FORCE_VECTOR.copy(FORWARD_VECTOR).multiplyScalar(wheelForce);
  BRAKE_FORCE_VECTOR.copy(FORWARD_VECTOR).multiplyScalar(-brakeForce * brakeDirectionSign);

  const lateralGripScale =
    bundle.vehicleKind === 'car'
      ? THREE.MathUtils.lerp(1, Math.max(0.45, 1 - rwdGripLoss), rwdEffect)
      : 1;

  let wheelStates = null;
  let averageGroundNormalY = 1;
  let bikeFrontGroundedWheel = null;
  AVERAGE_GROUND_NORMAL.set(0, 1, 0);
  const useRaycastWheelModel =
    sampleGround &&
    wheelMount?.children?.length;
  if (useRaycastWheelModel) {
    wheelStates = computeWheelStates(
      bundle,
      wheelMount,
      sampleGround,
      suspensionConfig,
      q,
      body,
      effectiveSteer
    );
    if (wheelStates?.length) {
      const groundedNormals = wheelStates.filter((wheel) => wheel.grounded);
      if (isBike && groundedNormals.length) {
        bikeFrontGroundedWheel = groundedNormals.find((wheel) => wheel.canSteer) || groundedNormals[0];
      }
      if (groundedNormals.length) {
        averageGroundNormalY =
          groundedNormals.reduce((sum, wheel) => sum + (wheel.contactNormal?.y ?? 1), 0) /
          groundedNormals.length;
        AVERAGE_GROUND_NORMAL.set(0, 0, 0);
        for (const wheel of groundedNormals) {
          AVERAGE_GROUND_NORMAL.add(wheel.contactNormal || UP_AXIS);
        }
        if (AVERAGE_GROUND_NORMAL.lengthSq() > 1e-6) {
          AVERAGE_GROUND_NORMAL.normalize();
        } else {
          AVERAGE_GROUND_NORMAL.set(0, 1, 0);
        }
      }
    }
  } else {
    bundle.wheelStates = [];
  }

  if (isBike && !wheelStates?.length) {
    return stepDedicatedBike(bundle, params, {
      body,
      vehicleSpec,
      quaternion: q,
      forwardSpeed,
      lateralSpeed,
      effectiveSteer,
      wheelStates
    });
  }

  if (isBike) {
    if (wheelStates?.length) {
      const groundedWheels = wheelStates.filter((wheel) => wheel.grounded);

      for (const wheelState of wheelStates) {
        if (!wheelState.grounded) {
          continue;
        }

        if (wheelState.suspensionForce > 0) {
          WHEEL_FORCE_VECTOR.copy(wheelState.contactNormal).multiplyScalar(wheelState.suspensionForce);
          body.applyForce(WHEEL_FORCE_VECTOR, wheelState.bodyPoint, true);
        }

        const maxTractionForce = Math.max(0, Number(wheelState.maxTractionForce || 0));
        const lateralStiffness = Number(wheelState.corneringStiffness || 920);
        const desiredLateralForce =
          -wheelState.lateralSpeed *
          lateralStiffness *
          Number(wheelState.sideFrictionStiffness || 1) *
          lateralGripScale;
        const lateralForce = THREE.MathUtils.clamp(desiredLateralForce, -maxTractionForce, maxTractionForce);
        const remainingLongitudinalForce = Math.sqrt(
          Math.max(0, maxTractionForce * maxTractionForce - lateralForce * lateralForce)
        );
        let desiredLongitudinalForce = 0;
        desiredLongitudinalForce += -brakeForce * brakeDirectionSign * Number(wheelState.brakeBias || 0.5);
        const longitudinalForce = THREE.MathUtils.clamp(
          desiredLongitudinalForce,
          -remainingLongitudinalForce,
          remainingLongitudinalForce
        );

        if (Math.abs(longitudinalForce) > 1e-3) {
          WHEEL_FORCE_VECTOR.copy(wheelState.forward).multiplyScalar(longitudinalForce);
          body.applyForce(WHEEL_FORCE_VECTOR, wheelState.bodyPoint, true);
        }

        if (Math.abs(lateralForce) > 1e-3) {
          WHEEL_LATERAL_VECTOR.copy(wheelState.side).multiplyScalar(lateralForce);
          body.applyForce(WHEEL_LATERAL_VECTOR, wheelState.bodyPoint, true);
        }
      }

      if (groundedWheels.length) {
        const rearGroundedWheel =
          groundedWheels.find((wheel) => wheel.driveScale > 0) ||
          groundedWheels.find((wheel) => !wheel.canSteer) ||
          groundedWheels[groundedWheels.length - 1];
        const bikeDriveDirection = WHEEL_FORCE_VECTOR.copy(
          rearGroundedWheel?.forward || FORWARD_VECTOR
        );
        if (bikeFrontGroundedWheel?.forward) {
          bikeDriveDirection.lerp(
            bikeFrontGroundedWheel.forward,
            THREE.MathUtils.clamp(Number(vehicleSpec.rearDriveSteerBlend ?? 0), 0, 1)
          );
        }
        bikeDriveDirection.setY(0);
        if (bikeDriveDirection.lengthSq() > 1e-6) {
          bikeDriveDirection.normalize();
        } else {
          bikeDriveDirection.copy(FORWARD_VECTOR);
        }
        if (Math.abs(wheelForce) > 1e-3 && rearGroundedWheel?.bodyPoint) {
          body.applyForce(
            {
              x: bikeDriveDirection.x * wheelForce,
              y: 0,
              z: bikeDriveDirection.z * wheelForce
            },
            rearGroundedWheel.bodyPoint,
            true
          );
        } else {
          body.applyLinearForce({
            x: bikeDriveDirection.x * wheelForce,
            y: 0,
            z: bikeDriveDirection.z * wheelForce
          });
        }
        if (Math.abs(brakeForce) > 1e-3) {
          if (rearGroundedWheel?.bodyPoint) {
            body.applyForce(BRAKE_FORCE_VECTOR, rearGroundedWheel.bodyPoint, true);
          } else {
            body.applyLinearForce({
              x: BRAKE_FORCE_VECTOR.x,
              y: 0,
              z: BRAKE_FORCE_VECTOR.z
            });
          }
        }

        const groundedLateralForce = Number(vehicleSpec.groundedLateralForce ?? 0);
        if (groundedLateralForce > 0) {
          const speedRecoveryBlend = THREE.MathUtils.clamp(
            Math.abs(forwardSpeed) / Math.max(Number(vehicleSpec.highSpeedRecoverySpeedMps ?? 16), 0.1),
            0,
            1
          );
          const lateralForceAtSpeed = THREE.MathUtils.lerp(
            groundedLateralForce,
            Number(vehicleSpec.highSpeedGroundedLateralForce ?? groundedLateralForce),
            speedRecoveryBlend
          );
          const steerHoldFloor = THREE.MathUtils.lerp(0.28, 0.72, speedRecoveryBlend);
          const steerHoldFactor = THREE.MathUtils.lerp(
            1,
            steerHoldFloor,
            THREE.MathUtils.clamp(Math.abs(steerInput), 0, 1)
          );
          body.applyLinearForce({
            x: -RIGHT_VECTOR.x * lateralSpeed * lateralForceAtSpeed * lateralGripScale * steerHoldFactor,
            y: 0,
            z: -RIGHT_VECTOR.z * lateralSpeed * lateralForceAtSpeed * lateralGripScale * steerHoldFactor
          });
        }
        if (bikeFrontGroundedWheel?.forward) {
          FRONT_STEER_FOLLOW_VECTOR.copy(bikeFrontGroundedWheel.forward).setY(0);
          if (FRONT_STEER_FOLLOW_VECTOR.lengthSq() > 1e-6) {
            FRONT_STEER_FOLLOW_VECTOR.normalize();
            const frontFollowAngle = Math.atan2(
              FORWARD_VECTOR.x * FRONT_STEER_FOLLOW_VECTOR.z - FORWARD_VECTOR.z * FRONT_STEER_FOLLOW_VECTOR.x,
              FORWARD_VECTOR.x * FRONT_STEER_FOLLOW_VECTOR.x + FORWARD_VECTOR.z * FRONT_STEER_FOLLOW_VECTOR.z
            );
            const frontSteerFollowStrength = Number(vehicleSpec.frontSteerFollowStrength ?? 0);
            if (frontSteerFollowStrength > 0) {
              body.applyAngularForce({
                x: 0,
                y:
                  -frontFollowAngle *
                  frontSteerFollowStrength *
                  THREE.MathUtils.clamp(Math.abs(forwardSpeed) / 8, 0.25, 1),
                z: 0
              });
            }
          }
        }
        const yawTorqueGain = Number(vehicleSpec.yawTorqueGain ?? 0);
        if (yawTorqueGain > 0 && Math.abs(steerInput) > 1e-3 && Math.abs(forwardSpeed) > 0.25) {
          body.applyAngularForce({
            x: 0,
            y: -steerInput * Math.sign(forwardSpeed) * yawTorqueGain * THREE.MathUtils.clamp(Math.abs(forwardSpeed) / 10, 0.2, 1),
            z: 0
          });
        }
        const groundedYawDamping = Number(vehicleSpec.groundedYawDamping ?? 1);
        const yawDampingAtSpeed = THREE.MathUtils.lerp(
          groundedYawDamping,
          Number(vehicleSpec.highSpeedGroundedYawDamping ?? groundedYawDamping),
          THREE.MathUtils.clamp(
            Math.abs(forwardSpeed) / Math.max(Number(vehicleSpec.highSpeedRecoverySpeedMps ?? 16), 0.1),
            0,
            1
          )
        );
        const yawDampingWhileSteering = THREE.MathUtils.lerp(
          yawDampingAtSpeed,
          0.995,
          THREE.MathUtils.clamp(Math.abs(steerInput), 0, 1)
        );
        body.angularVelocity.y *= yawDampingWhileSteering;
        if (
          Math.abs(steerInput) < 0.08 &&
          Math.abs(forwardSpeed) > 3 &&
          Math.abs(lateralSpeed) > 0.02
        ) {
          const straightLineLateralForce = Number(vehicleSpec.straightLineLateralForce ?? 0);
          if (straightLineLateralForce > 0) {
            body.applyLinearForce({
              x: -RIGHT_VECTOR.x * lateralSpeed * straightLineLateralForce * lateralGripScale,
              y: 0,
              z: -RIGHT_VECTOR.z * lateralSpeed * straightLineLateralForce * lateralGripScale
            });
          }
          body.angularVelocity.y *= Number(vehicleSpec.straightLineYawDamping ?? 1);
        }
      } else {
        body.applyLinearForce({
          x: DRIVE_FORCE_VECTOR.x + BRAKE_FORCE_VECTOR.x,
          y: 0,
          z: DRIVE_FORCE_VECTOR.z + BRAKE_FORCE_VECTOR.z
        });
        body.applyLinearForce({
          x: -RIGHT_VECTOR.x * lateralSpeed * 850 * lateralGripScale,
          y: 0,
          z: -RIGHT_VECTOR.z * lateralSpeed * 850 * lateralGripScale
        });
      }
    } else {
      body.applyLinearForce({
        x: DRIVE_FORCE_VECTOR.x + BRAKE_FORCE_VECTOR.x,
        y: 0,
        z: DRIVE_FORCE_VECTOR.z + BRAKE_FORCE_VECTOR.z
      });

      // Fallback for bikes without raycast-ready wheel data.
      body.applyLinearForce({
        x: -RIGHT_VECTOR.x * lateralSpeed * 850 * lateralGripScale,
        y: 0,
        z: -RIGHT_VECTOR.z * lateralSpeed * 850 * lateralGripScale
      });
    }
  } else {
    const frontCorneringStiffness = Number(vehicleSpec.frontCorneringStiffness || 1480);
    const rearCorneringStiffness = Number(vehicleSpec.rearCorneringStiffness || 920);
    const brakeFrontBias = THREE.MathUtils.clamp(Number(vehicleSpec.brakeFrontBias ?? 0.62), 0.5, 0.8);
    if (wheelStates?.length) {
      const frontWheels = wheelStates.filter((wheel) => wheel.canSteer && wheel.grounded);
      const rearWheels = wheelStates.filter((wheel) => !wheel.canSteer && wheel.grounded);
      const drivenWheels = rearWheels.length ? rearWheels : wheelStates.filter((wheel) => wheel.grounded);
      const frontBrakeShare = frontWheels.length ? brakeFrontBias / frontWheels.length : 0;
      const rearBrakeShare = rearWheels.length ? (1 - brakeFrontBias) / rearWheels.length : 0;
      const driveShare = drivenWheels.length ? 1 / drivenWheels.length : 0;
      const groundedWheels = wheelStates.filter((wheel) => wheel.grounded);
      const baseWheelTractionLimit = groundedWheels.length ? tractionForceLimit / groundedWheels.length : tractionForceLimit;

      for (const wheelState of wheelStates) {
        if (!wheelState.grounded) {
          continue;
        }

        if (wheelState.suspensionForce > 0) {
          WHEEL_FORCE_VECTOR.copy(wheelState.contactNormal).multiplyScalar(wheelState.suspensionForce);
          body.applyForce(WHEEL_FORCE_VECTOR, wheelState.bodyPoint, true);
        }
        const brakeShare = wheelState.canSteer ? frontBrakeShare : rearBrakeShare;
        const lateralStiffness = wheelState.canSteer ? frontCorneringStiffness : rearCorneringStiffness;
        const maxTractionForce = Math.max(
          0,
          Math.min(baseWheelTractionLimit, Number(wheelState.maxTractionForce || 0))
        );
        const desiredLateralForce =
          -wheelState.lateralSpeed *
          lateralStiffness *
          Number(wheelState.sideFrictionStiffness || 1) *
          (wheelState.canSteer ? 1 : lateralGripScale);
        const lateralForce = THREE.MathUtils.clamp(desiredLateralForce, -maxTractionForce, maxTractionForce);
        const remainingLongitudinalForce = Math.sqrt(
          Math.max(0, maxTractionForce * maxTractionForce - lateralForce * lateralForce)
        );
        let desiredLongitudinalForce = 0;
        if (wheelState.driveScale > 0 && driveShare > 0) {
          desiredLongitudinalForce += wheelForce * driveShare * wheelState.driveScale;
        }
        if (brakeShare > 0) {
          desiredLongitudinalForce += -brakeForce * brakeDirectionSign * brakeShare;
        }
        const longitudinalForce = THREE.MathUtils.clamp(
          desiredLongitudinalForce,
          -remainingLongitudinalForce,
          remainingLongitudinalForce
        );

        if (Math.abs(longitudinalForce) > 1e-3) {
          WHEEL_FORCE_VECTOR.copy(wheelState.forward).multiplyScalar(longitudinalForce);
          body.applyForce(WHEEL_FORCE_VECTOR, wheelState.bodyPoint, true);
        }

        if (Math.abs(lateralForce) > 1e-3) {
          WHEEL_LATERAL_VECTOR.copy(wheelState.side).multiplyScalar(lateralForce);
          body.applyForce(WHEEL_LATERAL_VECTOR, wheelState.bodyPoint, true);
        }
      }

      applyAntiRollForce(wheelStates, body, vehicleSpec.antiRollStiffness ?? 0);
    } else {
      FRONT_AXLE_POINT.set(0, wheelCenterY, wheelHalfBase);
      REAR_AXLE_POINT.set(0, wheelCenterY, -wheelHalfBase);

      // Rear axle remains the propulsion source, while braking is distributed with a front bias.
      body.applyForce(DRIVE_FORCE_VECTOR, REAR_AXLE_POINT, true);
      FRONT_BRAKE_FORCE.copy(BRAKE_FORCE_VECTOR).multiplyScalar(brakeFrontBias);
      REAR_BRAKE_FORCE.copy(BRAKE_FORCE_VECTOR).multiplyScalar(1 - brakeFrontBias);
      body.applyForce(FRONT_BRAKE_FORCE, FRONT_AXLE_POINT, true);
      body.applyForce(REAR_BRAKE_FORCE, REAR_AXLE_POINT, true);

      FRONT_STEER_VECTOR.copy(FORWARD_VECTOR).applyAxisAngle(UP_AXIS, -effectiveSteer).normalize();
      FRONT_SIDE_VECTOR.set(-FRONT_STEER_VECTOR.z, 0, FRONT_STEER_VECTOR.x);

      FRONT_AXLE_OFFSET.copy(FORWARD_VECTOR).multiplyScalar(wheelHalfBase);
      REAR_AXLE_OFFSET.copy(FORWARD_VECTOR).multiplyScalar(-wheelHalfBase);

      FRONT_POINT_VELOCITY.copy(planarVelocity);
      FRONT_POINT_VELOCITY.x += body.angularVelocity.y * FRONT_AXLE_OFFSET.z;
      FRONT_POINT_VELOCITY.z -= body.angularVelocity.y * FRONT_AXLE_OFFSET.x;

      REAR_POINT_VELOCITY.copy(planarVelocity);
      REAR_POINT_VELOCITY.x += body.angularVelocity.y * REAR_AXLE_OFFSET.z;
      REAR_POINT_VELOCITY.z -= body.angularVelocity.y * REAR_AXLE_OFFSET.x;

      const frontLateralSpeed = FRONT_POINT_VELOCITY.dot(FRONT_SIDE_VECTOR);
      const rearLateralSpeed = REAR_POINT_VELOCITY.dot(RIGHT_VECTOR);

      // Front axle cornering force is the primary steering source.
      FRONT_LATERAL_FORCE.copy(FRONT_SIDE_VECTOR).multiplyScalar(-frontLateralSpeed * frontCorneringStiffness);
      REAR_LATERAL_FORCE.copy(RIGHT_VECTOR).multiplyScalar(
        -rearLateralSpeed * rearCorneringStiffness * lateralGripScale
      );
      body.applyForce(FRONT_LATERAL_FORCE, FRONT_AXLE_POINT, true);
      body.applyForce(REAR_LATERAL_FORCE, REAR_AXLE_POINT, true);
    }

    if (
      Math.abs(steerInput) < 0.08 &&
      Math.abs(effectiveSteer) < maxSteerAngle * 0.12 &&
      Math.abs(forwardSpeed) > 2
    ) {
      const straightLineLateralForce = Number(vehicleSpec.straightLineLateralForce ?? 0);
      if (straightLineLateralForce > 0) {
        REAR_LATERAL_FORCE.copy(RIGHT_VECTOR).multiplyScalar(-lateralSpeed * straightLineLateralForce);
        body.applyLinearForce({
          x: REAR_LATERAL_FORCE.x,
          y: 0,
          z: REAR_LATERAL_FORCE.z
        });
      }
      body.angularVelocity.y *= Number(vehicleSpec.straightLineYawDamping ?? 1);
    }
  }

  const shouldSelfRight = isBike
    ? (
        averageGroundNormalY > 0.88 &&
        Math.abs(lateralSpeed) < 2.8 &&
        Math.abs(forwardSpeed) < 14 &&
        Math.abs(steerInput) < 0.35 &&
        Math.abs(body.angularVelocity.x) < 1.4 &&
        Math.abs(body.angularVelocity.z) < 1.4
      )
    : (
        averageGroundNormalY > 0.94 &&
        Math.abs(steerInput) < 0.14 &&
        Math.abs(effectiveSteer) < maxSteerAngle * 0.2 &&
        Math.abs(lateralSpeed) < 2.2
      );

  if (shouldSelfRight) {
    ROTATION_EULER.setFromQuaternion(q, 'YXZ');
    const uprightStrength = Number(vehicleSpec.uprightStrength || 320);
    body.applyAngularForce({
      x: -ROTATION_EULER.x * uprightStrength,
      y: 0,
      z: -ROTATION_EULER.z * uprightStrength
    });
    const uprightVelocityDamping = Number(vehicleSpec.uprightVelocityDamping || 0.72);
    body.angularVelocity.x *= uprightVelocityDamping;
    body.angularVelocity.z *= uprightVelocityDamping;
  }

  if (isBike && !shouldSelfRight) {
    ROTATION_EULER.setFromQuaternion(q, 'YXZ');
    const straightBalanceRollLimit = Number(vehicleSpec.straightBalanceRollLimit ?? 0.22);
    if (
      Math.abs(steerInput) < 0.12 &&
      Math.abs(forwardSpeed) > 2 &&
      Math.abs(ROTATION_EULER.z) < straightBalanceRollLimit
    ) {
      const straightBalanceStrength = Number(vehicleSpec.straightBalanceStrength ?? 0);
      if (straightBalanceStrength > 0) {
        body.applyAngularForce({
          x: 0,
          y: 0,
          z: -ROTATION_EULER.z * straightBalanceStrength
        });
        body.angularVelocity.z *= Number(vehicleSpec.straightBalanceRollDamping ?? 0.9);
      }
    }
  }

  if (isBike) {
    body.angularVelocity.x *= 0.975;
    body.angularVelocity.z *= 0.965;
  } else {
    body.angularVelocity.x *= 0.985;
    body.angularVelocity.z *= 0.985;
  }
  const yawAssistStrength = isBike
    ? 0
    : THREE.MathUtils.lerp(
        Number(vehicleSpec.lowSpeedYawAssist ?? 0.16),
        Number(vehicleSpec.highSpeedYawAssist ?? 0.04),
        THREE.MathUtils.clamp(Math.abs(forwardSpeed) / 18, 0, 1)
      );
  if (!isBike) {
    body.angularVelocity.y = THREE.MathUtils.lerp(
      body.angularVelocity.y,
      -targetYawRateWithDriveBias,
      Math.min(deltaSeconds * 5.5 * yawAssistStrength, yawAssistStrength)
    );
  }

  bundle.world.takeOneStep(deltaSeconds);
  syncDynamicBodies(bundle);

  const nextQ = new THREE.Quaternion(
    body.orientation.x,
    body.orientation.y,
    body.orientation.z,
    body.orientation.w
  );
  const bikeRollMagnitude =
    isBike ? Math.abs(ROTATION_EULER.setFromQuaternion(nextQ, 'YXZ').z) : 0;
  if (
    isBike &&
    bikeFrontGroundedWheel?.forward &&
    Math.abs(steerInput) > 0.08 &&
    Math.abs(forwardSpeed) < Number(vehicleSpec.lowSpeedTurnSpeedMps ?? 8.5) &&
    bikeRollMagnitude < 0.42 &&
    Math.abs(body.angularVelocity.x) < 1.8 &&
    Math.abs(body.angularVelocity.z) < 1.8
  ) {
    FRONT_STEER_FOLLOW_VECTOR.copy(bikeFrontGroundedWheel.forward).setY(0);
    if (FRONT_STEER_FOLLOW_VECTOR.lengthSq() > 1e-6) {
      FRONT_STEER_FOLLOW_VECTOR.normalize();
      const targetYaw = Math.atan2(FRONT_STEER_FOLLOW_VECTOR.x, FRONT_STEER_FOLLOW_VECTOR.z);
      UPRIGHT_QUATERNION.setFromAxisAngle(UP_AXIS, targetYaw);
      nextQ.slerp(
        UPRIGHT_QUATERNION,
        Math.min(
          deltaSeconds *
            Number(vehicleSpec.lowSpeedTurnYawFollow ?? 0) *
            THREE.MathUtils.clamp(Math.abs(steerInput), 0.2, 1),
          0.24
        )
      );
      body.orientation.set([nextQ.x, nextQ.y, nextQ.z, nextQ.w]);
      body.commitChanges();
    }
  }
  const nextPlanarVelocity = LINEAR_VELOCITY.set(body.linearVelocity.x, 0, body.linearVelocity.z);
  const nextForwardVector = FORWARD_VECTOR.set(0, 0, 1).applyQuaternion(nextQ).setY(0).normalize();
  if (!isBike && wheelStates?.some((wheel) => wheel.grounded) && averageGroundNormalY < 0.995) {
    GROUND_ALIGN_FORWARD.set(0, 0, 1).applyQuaternion(nextQ);
    GROUND_ALIGN_FORWARD.addScaledVector(
      AVERAGE_GROUND_NORMAL,
      -GROUND_ALIGN_FORWARD.dot(AVERAGE_GROUND_NORMAL)
    );
    if (GROUND_ALIGN_FORWARD.lengthSq() > 1e-6) {
      GROUND_ALIGN_FORWARD.normalize();
      GROUND_ALIGN_RIGHT.crossVectors(AVERAGE_GROUND_NORMAL, GROUND_ALIGN_FORWARD).normalize();
      GROUND_ALIGN_FORWARD.crossVectors(GROUND_ALIGN_RIGHT, AVERAGE_GROUND_NORMAL).normalize();
      GROUND_ALIGN_MATRIX.makeBasis(GROUND_ALIGN_RIGHT, AVERAGE_GROUND_NORMAL, GROUND_ALIGN_FORWARD);
      GROUND_ALIGN_QUATERNION.setFromRotationMatrix(GROUND_ALIGN_MATRIX);
      nextQ.slerp(GROUND_ALIGN_QUATERNION, Math.min(deltaSeconds * 3.5, 0.22));
      body.orientation.set([nextQ.x, nextQ.y, nextQ.z, nextQ.w]);
      body.commitChanges();
      nextForwardVector.set(0, 0, 1).applyQuaternion(nextQ).setY(0).normalize();
    }
  }
  if (shouldSelfRight) {
    const currentYaw = Math.atan2(nextForwardVector.x, nextForwardVector.z);
    UPRIGHT_QUATERNION.setFromAxisAngle(new THREE.Vector3(0, 1, 0), currentYaw);
    const uprightBlend =
      Number(vehicleSpec.uprightSlerp || 0.35) *
      THREE.MathUtils.clamp(1 - Math.abs(steerInput) * Number(vehicleSpec.uprightSteerPenalty || 0.8), 0.3, 1);
    nextQ.slerp(UPRIGHT_QUATERNION, Math.min(deltaSeconds * 7.5, uprightBlend));
    body.orientation.set([nextQ.x, nextQ.y, nextQ.z, nextQ.w]);
    body.angularVelocity.x *= isBike ? 0.12 : 0.35;
    body.angularVelocity.z *= isBike ? 0.12 : 0.35;
    body.commitChanges();
    nextForwardVector.set(0, 0, 1).applyQuaternion(nextQ).setY(0).normalize();
  }
  ROTATION_EULER.setFromQuaternion(nextQ, 'YXZ');
  const nextSpeed = nextPlanarVelocity.dot(nextForwardVector);

  if (nextSpeed > maxVehicleSpeedMps || nextSpeed < -reverseSpeedLimitMps) {
    const clampedSpeed = THREE.MathUtils.clamp(nextSpeed, -reverseSpeedLimitMps, maxVehicleSpeedMps);
    body.linearVelocity.set(
      nextForwardVector.x * clampedSpeed,
      body.linearVelocity.y,
      nextForwardVector.z * clampedSpeed
    );
  }

  return {
    position: new THREE.Vector3(
      body.position.x,
      body.position.y - bundle.rootOffsetY,
      body.position.z
    ),
    quaternion: nextQ,
    yaw: Math.atan2(nextForwardVector.x, nextForwardVector.z),
    speed: nextSpeed,
    yawRate: body.angularVelocity.y
  };
}

function stepDedicatedBike(bundle, params, context) {
  const {
    deltaSeconds,
    wheelForce,
    brakeForce,
    sampleGround,
    suspensionConfig,
    maxSteerAngle,
    wheelbaseM,
    reverseSpeedLimitMps,
    maxVehicleSpeedMps
  } = params;
  const { body, vehicleSpec, quaternion, forwardSpeed, lateralSpeed, effectiveSteer, wheelStates } = context;

  const groundedWheels = wheelStates?.filter((wheel) => wheel.grounded) || [];
  const bikeUp = BODY_UP_VECTOR.set(0, 1, 0).applyQuaternion(quaternion).normalize();
  const uprightness = bikeUp.y;
  const emergencyUprightBlend = THREE.MathUtils.clamp((0.45 - uprightness) / 0.9, 0, 1);
  const frontWheel = groundedWheels.find((wheel) => wheel.canSteer) || wheelStates?.find((wheel) => wheel.canSteer) || null;
  const rearWheel =
    groundedWheels.find((wheel) => wheel.driveScale > 0) ||
    groundedWheels.find((wheel) => !wheel.canSteer) ||
    wheelStates?.find((wheel) => wheel.driveScale > 0) ||
    wheelStates?.find((wheel) => !wheel.canSteer) ||
    null;

  const brakeDirectionSign = Math.sign(forwardSpeed || wheelForce || 1);

  body.clearForces();

  GROUND_ALIGN_FORWARD.copy(FORWARD_VECTOR).set(0, 0, 1).applyQuaternion(quaternion).setY(0);
  if (GROUND_ALIGN_FORWARD.lengthSq() < 1e-6) {
    GROUND_ALIGN_FORWARD.set(0, 0, 1);
  } else {
    GROUND_ALIGN_FORWARD.normalize();
  }
  GROUND_ALIGN_RIGHT.set(-GROUND_ALIGN_FORWARD.z, 0, GROUND_ALIGN_FORWARD.x).normalize();

  FRONT_STEER_VECTOR.copy(GROUND_ALIGN_FORWARD).applyAxisAngle(UP_AXIS, -effectiveSteer).setY(0);
  if (FRONT_STEER_VECTOR.lengthSq() < 1e-6) {
    FRONT_STEER_VECTOR.copy(GROUND_ALIGN_FORWARD);
  } else {
    FRONT_STEER_VECTOR.normalize();
  }
  FRONT_SIDE_VECTOR.set(-FRONT_STEER_VECTOR.z, 0, FRONT_STEER_VECTOR.x).normalize();

  const wheelRadius = Number(vehicleSpec.wheelRadius ?? 0.16);
  const wheelCenterY = Number(vehicleSpec.wheelCenterY ?? -0.1);
  const wheelHalfBase = Number(vehicleSpec.wheelHalfBase ?? Math.max(wheelbaseM * 0.5, 0.1));
  const rideCompression = Number(suspensionConfig?.rideCompression ?? 0);
  const bumpTravel = Number(suspensionConfig?.bumpTravel ?? 0.18);
  const droopTravel = Number(suspensionConfig?.droopTravel ?? 0.14);
  const supportRange = bumpTravel + rideCompression;
  const frontSuspensionFrequency = Number(frontWheel?.vehiclePhysics?.suspensionFrequency ?? 1.42);
  const rearSuspensionFrequency = Number(rearWheel?.vehiclePhysics?.suspensionFrequency ?? 1.38);
  const frontSuspensionDamping = Number(frontWheel?.vehiclePhysics?.suspensionDamping ?? 0.82);
  const rearSuspensionDamping = Number(rearWheel?.vehiclePhysics?.suspensionDamping ?? 0.8);
  const frontMaxSuspensionForce = Number(frontWheel?.vehiclePhysics?.maxSuspensionForce ?? 12000);
  const rearMaxSuspensionForce = Number(rearWheel?.vehiclePhysics?.maxSuspensionForce ?? 13800);
  const frontFrictionSlip = Number(frontWheel?.vehiclePhysics?.frictionSlip ?? 2.35);
  const rearFrictionSlip = Number(rearWheel?.vehiclePhysics?.frictionSlip ?? 1.82);
  const frontCorneringStiffness = Number(frontWheel?.vehiclePhysics?.corneringStiffness ?? 2380);
  const rearCorneringStiffness = Number(rearWheel?.vehiclePhysics?.corneringStiffness ?? 1120);
  const frontSideFrictionStiffness = Number(frontWheel?.vehiclePhysics?.sideFrictionStiffness ?? 1.6);
  const rearSideFrictionStiffness = Number(rearWheel?.vehiclePhysics?.sideFrictionStiffness ?? 1.05);
  const bikeSupportState = bundle.bikeSupportState || (bundle.bikeSupportState = {
    frontCompression: 0,
    rearCompression: 0
  });

  const buildBikeSupportContact = ({
    supportKey,
    samplePoint,
    bodyPoint,
    offsetWorld,
    contactPoint,
    contactNormal,
    forwardDirection,
    sideDirection,
    suspensionFrequency,
    suspensionDamping,
    maxSuspensionForce,
    frictionSlip,
    brakeBias,
    corneringStiffness,
    sideFrictionStiffness
  }) => {
    if (!sampleGround) {
      return null;
    }
    const hit = sampleGround(samplePoint.x, samplePoint.z, samplePoint.y + 0.5);
    if (!hit) {
      return null;
    }

    const desiredCenterY = hit.height + wheelRadius;
    const verticalDelta = desiredCenterY - samplePoint.y;
    const grounded = verticalDelta > -droopTravel;
    if (!grounded) {
      bikeSupportState[supportKey] = 0;
      return null;
    }

    const targetCompression = THREE.MathUtils.clamp(verticalDelta + rideCompression, 0, supportRange);
    const previousCompression = Number(bikeSupportState[supportKey] || 0);
    const filteredCompression = THREE.MathUtils.lerp(previousCompression, targetCompression, 0.32);
    bikeSupportState[supportKey] = filteredCompression;
    const omega = Math.PI * 2 * suspensionFrequency;
    // Split the chassis mass across the two sampled supports so the bike can
    // actually hold itself up without relying on collider penetration.
    const effectiveMass = Number(vehicleSpec.massKg || 260) * 0.5;
    const springStiffness = effectiveMass * omega * omega;
    const dampingStrength = 2 * effectiveMass * suspensionDamping * omega;
    const supportCompressionVelocity =
      (filteredCompression - previousCompression) / Math.max(deltaSeconds, 1 / 120);
    const suspensionForce = THREE.MathUtils.clamp(
      filteredCompression * springStiffness - supportCompressionVelocity * dampingStrength,
      0,
      maxSuspensionForce
    );

    contactPoint.set(samplePoint.x, hit.height, samplePoint.z);
    contactNormal.copy(hit.normal || UP_AXIS);
    WHEEL_FORCE_VECTOR.copy(contactNormal).multiplyScalar(suspensionForce);
    body.applyForce(WHEEL_FORCE_VECTOR, bodyPoint, true);

    WHEEL_POINT_VELOCITY.set(body.linearVelocity.x, body.linearVelocity.y, body.linearVelocity.z);
    WHEEL_POINT_ANGULAR_VELOCITY.set(
      body.angularVelocity.x,
      body.angularVelocity.y,
      body.angularVelocity.z
    ).cross(offsetWorld);
    WHEEL_POINT_VELOCITY.add(WHEEL_POINT_ANGULAR_VELOCITY);

    return {
      grounded: true,
      bodyPoint,
      contactPoint,
      contactNormal,
      forward: forwardDirection,
      side: sideDirection,
      longitudinalSpeed: WHEEL_POINT_VELOCITY.dot(forwardDirection),
      lateralSpeed: WHEEL_POINT_VELOCITY.dot(sideDirection),
      maxTractionForce: suspensionForce * frictionSlip,
      supportFloorY: hit.height + wheelRadius - bumpTravel - offsetWorld.y,
      brakeBias,
      corneringStiffness,
      sideFrictionStiffness
    };
  };

  BIKE_FRONT_BODY_POINT.set(0, wheelCenterY, wheelHalfBase);
  BIKE_REAR_BODY_POINT.set(0, wheelCenterY, -wheelHalfBase);
  BIKE_FRONT_OFFSET_WORLD.copy(BIKE_FRONT_BODY_POINT).applyQuaternion(quaternion);
  BIKE_REAR_OFFSET_WORLD.copy(BIKE_REAR_BODY_POINT).applyQuaternion(quaternion);
  BIKE_FRONT_CONTACT_POINT.set(
    body.position.x + BIKE_FRONT_OFFSET_WORLD.x,
    body.position.y + BIKE_FRONT_OFFSET_WORLD.y,
    body.position.z + BIKE_FRONT_OFFSET_WORLD.z
  );
  BIKE_REAR_CONTACT_POINT.set(
    body.position.x + BIKE_REAR_OFFSET_WORLD.x,
    body.position.y + BIKE_REAR_OFFSET_WORLD.y,
    body.position.z + BIKE_REAR_OFFSET_WORLD.z
  );

  const frontSupport = buildBikeSupportContact({
    supportKey: 'frontCompression',
    samplePoint: BIKE_FRONT_CONTACT_POINT,
    bodyPoint: BIKE_FRONT_BODY_POINT,
    offsetWorld: BIKE_FRONT_OFFSET_WORLD,
    contactPoint: BIKE_FRONT_CONTACT_POINT,
    contactNormal: BIKE_FRONT_CONTACT_NORMAL,
    forwardDirection: FRONT_STEER_VECTOR,
    sideDirection: FRONT_SIDE_VECTOR,
    suspensionFrequency: frontSuspensionFrequency,
    suspensionDamping: frontSuspensionDamping,
    maxSuspensionForce: frontMaxSuspensionForce,
    frictionSlip: frontFrictionSlip,
    brakeBias: Number(frontWheel?.brakeBias ?? 0.68),
    corneringStiffness: frontCorneringStiffness,
    sideFrictionStiffness: frontSideFrictionStiffness
  });
  const rearSupport = buildBikeSupportContact({
    supportKey: 'rearCompression',
    samplePoint: BIKE_REAR_CONTACT_POINT,
    bodyPoint: BIKE_REAR_BODY_POINT,
    offsetWorld: BIKE_REAR_OFFSET_WORLD,
    contactPoint: BIKE_REAR_CONTACT_POINT,
    contactNormal: BIKE_REAR_CONTACT_NORMAL,
    forwardDirection: GROUND_ALIGN_FORWARD,
    sideDirection: GROUND_ALIGN_RIGHT,
    suspensionFrequency: rearSuspensionFrequency,
    suspensionDamping: rearSuspensionDamping,
    maxSuspensionForce: rearMaxSuspensionForce,
    frictionSlip: rearFrictionSlip,
    brakeBias: Number(rearWheel?.brakeBias ?? 0.32),
    corneringStiffness: rearCorneringStiffness,
    sideFrictionStiffness: rearSideFrictionStiffness
  });
  const supportContacts = [frontSupport, rearSupport].filter(Boolean);

  const applyBikeWheelForces = (wheelState, forwardDirection, sideDirection, driveForce, brakeShare) => {
    if (!wheelState?.grounded) {
      return;
    }

    WHEEL_OFFSET_WORLD.copy(wheelState.bodyPoint).applyQuaternion(quaternion);
    WHEEL_POINT_VELOCITY.set(body.linearVelocity.x, body.linearVelocity.y, body.linearVelocity.z);
    WHEEL_POINT_ANGULAR_VELOCITY.set(
      body.angularVelocity.x,
      body.angularVelocity.y,
      body.angularVelocity.z
    ).cross(WHEEL_OFFSET_WORLD);
    WHEEL_POINT_VELOCITY.add(WHEEL_POINT_ANGULAR_VELOCITY);

    const planarLongitudinalSpeed = WHEEL_POINT_VELOCITY.dot(forwardDirection);
    const planarLateralSpeed = WHEEL_POINT_VELOCITY.dot(sideDirection);
    const maxTractionForce = Math.max(0, Number(wheelState.maxTractionForce || 0));
    const corneringStiffness = Number(wheelState.corneringStiffness || 1000);
    const desiredLateralForce =
      -planarLateralSpeed *
      corneringStiffness *
      Number(wheelState.sideFrictionStiffness || 1);
    const lateralForce = THREE.MathUtils.clamp(desiredLateralForce, -maxTractionForce, maxTractionForce);
    const remainingLongitudinalForce = Math.sqrt(
      Math.max(0, maxTractionForce * maxTractionForce - lateralForce * lateralForce)
    );
    const desiredLongitudinalForce = driveForce - brakeForce * brakeDirectionSign * brakeShare;
    const longitudinalForce = THREE.MathUtils.clamp(
      desiredLongitudinalForce,
      -remainingLongitudinalForce,
      remainingLongitudinalForce
    );

    if (Math.abs(longitudinalForce) > 1e-3) {
      WHEEL_FORCE_VECTOR.copy(forwardDirection).multiplyScalar(longitudinalForce);
      body.applyForce(WHEEL_FORCE_VECTOR, wheelState.bodyPoint, true);
    }

    if (Math.abs(lateralForce) > 1e-3) {
      WHEEL_LATERAL_VECTOR.copy(sideDirection).multiplyScalar(lateralForce);
      body.applyForce(WHEEL_LATERAL_VECTOR, wheelState.bodyPoint, true);
    }
  };

  if (uprightness > 0.35 && supportContacts.length) {
    applyBikeWheelForces(frontSupport, FRONT_STEER_VECTOR, FRONT_SIDE_VECTOR, 0, Number(frontSupport?.brakeBias ?? 0.68));
    applyBikeWheelForces(rearSupport, GROUND_ALIGN_FORWARD, GROUND_ALIGN_RIGHT, 0, Number(rearSupport?.brakeBias ?? 0.32));

    const rearGroundedSupport = rearSupport || frontSupport;
    const driveDirection = DRIVE_FORCE_VECTOR.copy(rearGroundedSupport?.forward || GROUND_ALIGN_FORWARD);
    driveDirection.setY(0);
    if (frontSupport?.forward && rearGroundedSupport === rearSupport) {
      driveDirection.lerp(
        FRONT_STEER_VECTOR,
        THREE.MathUtils.clamp(Number(vehicleSpec.rearDriveSteerBlend ?? 0), 0, 1)
      );
      driveDirection.setY(0);
    }
    if (driveDirection.lengthSq() < 1e-6) {
      driveDirection.copy(GROUND_ALIGN_FORWARD);
    } else {
      driveDirection.normalize();
    }

    if (Math.abs(wheelForce) > 1e-3) {
      const drivePoint = rearGroundedSupport?.bodyPoint || BIKE_REAR_BODY_POINT;
      body.applyForce(
        {
          x: driveDirection.x * wheelForce,
          y: 0,
          z: driveDirection.z * wheelForce
        },
        drivePoint,
        true
      );
    }
  } else if (uprightness > 0.35) {
    DRIVE_FORCE_VECTOR.copy(GROUND_ALIGN_FORWARD).multiplyScalar(wheelForce);
    BRAKE_FORCE_VECTOR.copy(GROUND_ALIGN_FORWARD).multiplyScalar(-brakeForce * brakeDirectionSign);
    body.applyLinearForce({
      x: DRIVE_FORCE_VECTOR.x + BRAKE_FORCE_VECTOR.x,
      y: 0,
      z: DRIVE_FORCE_VECTOR.z + BRAKE_FORCE_VECTOR.z
    });
  }

  if (uprightness > 0.35 && Math.abs(lateralSpeed) > 1e-4) {
    const straightLineLateralForce = Number(vehicleSpec.straightLineLateralForce ?? 0);
    const steerBlend = THREE.MathUtils.clamp(Math.abs(params.steerInput ?? 0), 0, 1);
    const lateralRecoveryForce = THREE.MathUtils.lerp(
      straightLineLateralForce,
      Number(vehicleSpec.groundedLateralForce ?? straightLineLateralForce),
      steerBlend
    );
    body.applyLinearForce({
      x: -GROUND_ALIGN_RIGHT.x * lateralSpeed * lateralRecoveryForce,
      y: 0,
      z: -GROUND_ALIGN_RIGHT.z * lateralSpeed * lateralRecoveryForce
    });
  }

  ROTATION_EULER.setFromQuaternion(quaternion, 'YXZ');
  const speedBlend = THREE.MathUtils.clamp(Math.abs(forwardSpeed) / 18, 0, 1);
  const targetRoll = -(params.steerInput || 0) * Number(vehicleSpec.physicsLeanTarget ?? 0) * speedBlend;
  const rollError = ROTATION_EULER.z - targetRoll;
  const pitchError = ROTATION_EULER.x;
  body.applyAngularForce({
    x:
      -pitchError * Number(vehicleSpec.pitchBalanceStrength ?? 0) -
      body.angularVelocity.x * Number(vehicleSpec.pitchBalanceDampingForce ?? 0),
    y: 0,
    z:
      -rollError * Number(vehicleSpec.rollBalanceStrength ?? 0) -
      body.angularVelocity.z * Number(vehicleSpec.rollBalanceDampingForce ?? 0)
  });

  if (emergencyUprightBlend > 0) {
    const emergencyStrength = THREE.MathUtils.lerp(0, 920, emergencyUprightBlend);
    const emergencyDamping = THREE.MathUtils.lerp(0, 180, emergencyUprightBlend);
    body.applyAngularForce({
      x: -pitchError * emergencyStrength - body.angularVelocity.x * emergencyDamping,
      y: 0,
      z: -ROTATION_EULER.z * emergencyStrength - body.angularVelocity.z * emergencyDamping
    });
    body.angularVelocity.y *= THREE.MathUtils.lerp(1, 0.82, emergencyUprightBlend);
  }

  const effectiveWheelbase = Math.max(
    wheelbaseM * Number(vehicleSpec.effectiveWheelbaseScale ?? 1),
    0.01
  );
  const targetYawRate =
    Math.abs(forwardSpeed) > 0.05 && Math.abs(effectiveSteer) > 0.0001
      ? (forwardSpeed / effectiveWheelbase) * Math.tan(effectiveSteer)
      : 0;
  const desiredYawRate = -targetYawRate;
  const yawControlGain = THREE.MathUtils.lerp(
    Number(vehicleSpec.yawControlGainLow ?? 0),
    Number(vehicleSpec.yawControlGainHigh ?? 0),
    speedBlend
  );
  body.applyAngularForce({
    x: 0,
    y: (desiredYawRate - body.angularVelocity.y) * yawControlGain,
    z: 0
  });

  if (Math.abs(params.steerInput || 0) < 0.05) {
    body.angularVelocity.y *= Number(vehicleSpec.yawNoSteerDamping ?? 1);
  }

  if (supportContacts.length) {
    body.angularVelocity.x *= 0.97;
    body.angularVelocity.z *= 0.9;
  } else {
    body.angularVelocity.x *= 0.985;
    body.angularVelocity.z *= 0.965;
  }

  bundle.world.takeOneStep(deltaSeconds);
  syncDynamicBodies(bundle);

  if (supportContacts.length && uprightness > 0.35) {
    let supportFloorY = -Infinity;
    for (const contact of supportContacts) {
      supportFloorY = Math.max(supportFloorY, Number(contact.supportFloorY ?? -Infinity));
    }
    if (Number.isFinite(supportFloorY) && body.position.y < supportFloorY) {
      body.position.y = supportFloorY;
      if (body.linearVelocity.y < 0) {
        body.linearVelocity.y = 0;
      }
      body.commitChanges();
    }
  }

  const nextQ = new THREE.Quaternion(
    body.orientation.x,
    body.orientation.y,
    body.orientation.z,
    body.orientation.w
  );
  const nextUp = BODY_UP_VECTOR.set(0, 1, 0).applyQuaternion(nextQ).normalize();
  const nextForwardVector = FORWARD_VECTOR.set(0, 0, 1).applyQuaternion(nextQ).setY(0);
  if (nextForwardVector.lengthSq() < 1e-6) {
    nextForwardVector.copy(GROUND_ALIGN_FORWARD);
  } else {
    nextForwardVector.normalize();
  }
  if (nextUp.y < 0.2) {
    UPRIGHT_QUATERNION.setFromAxisAngle(UP_AXIS, Math.atan2(nextForwardVector.x, nextForwardVector.z));
    nextQ.slerp(UPRIGHT_QUATERNION, 0.24);
    body.orientation.set([nextQ.x, nextQ.y, nextQ.z, nextQ.w]);
    body.angularVelocity.x *= 0.2;
    body.angularVelocity.z *= 0.2;
    body.commitChanges();
    nextForwardVector.set(0, 0, 1).applyQuaternion(nextQ).setY(0).normalize();
  }
  const nextPlanarVelocity = LINEAR_VELOCITY.set(body.linearVelocity.x, 0, body.linearVelocity.z);
  const nextSpeed = nextPlanarVelocity.dot(nextForwardVector);

  if (nextSpeed > maxVehicleSpeedMps || nextSpeed < -reverseSpeedLimitMps) {
    const clampedSpeed = THREE.MathUtils.clamp(nextSpeed, -reverseSpeedLimitMps, maxVehicleSpeedMps);
    body.linearVelocity.set(
      nextForwardVector.x * clampedSpeed,
      body.linearVelocity.y,
      nextForwardVector.z * clampedSpeed
    );
  }

  return {
    position: new THREE.Vector3(
      body.position.x,
      body.position.y - bundle.rootOffsetY,
      body.position.z
    ),
    quaternion: nextQ,
    yaw: Math.atan2(nextForwardVector.x, nextForwardVector.z),
    speed: nextSpeed,
    yawRate: body.angularVelocity.y
  };
}

function applyAntiRollForce(wheelStates, body, antiRollStiffness) {
  if (!wheelStates?.length || antiRollStiffness <= 0) {
    return;
  }

  const frontLeft = wheelStates.find((wheel) => wheel.grounded && String(wheel.anchorName || '').includes('front') && String(wheel.anchorName || '').includes('left'));
  const frontRight = wheelStates.find((wheel) => wheel.grounded && String(wheel.anchorName || '').includes('front') && String(wheel.anchorName || '').includes('right'));
  const rearLeft = wheelStates.find((wheel) => wheel.grounded && String(wheel.anchorName || '').includes('rear') && String(wheel.anchorName || '').includes('left'));
  const rearRight = wheelStates.find((wheel) => wheel.grounded && String(wheel.anchorName || '').includes('rear') && String(wheel.anchorName || '').includes('right'));

  applyAntiRollPair(body, frontLeft, frontRight, antiRollStiffness);
  applyAntiRollPair(body, rearLeft, rearRight, antiRollStiffness);
}

function applyAntiRollPair(body, leftWheel, rightWheel, antiRollStiffness) {
  if (!leftWheel || !rightWheel) {
    return;
  }

  const force = (leftWheel.springCompression - rightWheel.springCompression) * antiRollStiffness;
  if (Math.abs(force) < 1e-3) {
    return;
  }

  ANTIROLL_FORCE_VECTOR.copy(leftWheel.contactNormal).multiplyScalar(-force);
  body.applyForce(ANTIROLL_FORCE_VECTOR, leftWheel.bodyPoint, true);
  ANTIROLL_FORCE_VECTOR.copy(rightWheel.contactNormal).multiplyScalar(force);
  body.applyForce(ANTIROLL_FORCE_VECTOR, rightWheel.bodyPoint, true);
}

function computeWheelStates(bundle, wheelMount, sampleGround, suspensionConfig, quaternion, body, effectiveSteer) {
  const wheels = wheelMount.children.filter((wheel) => wheel?.isObject3D);
  if (!wheels.length) {
    bundle.wheelStates = [];
    return null;
  }

  const states = bundle.wheelStates || [];
  const bodyUp = BODY_UP_VECTOR.set(0, 1, 0).applyQuaternion(quaternion).normalize();
  const bodyForward = WHEEL_FORWARD_VECTOR.set(0, 0, 1).applyQuaternion(quaternion).normalize();
  const bodyRight = WHEEL_SIDE_VECTOR.set(1, 0, 0).applyQuaternion(quaternion).normalize();
  const wheelContactsEnabled = bundle.vehicleKind !== 'bike' || bodyUp.y > 0.35;
  const baseLocalPosition =
    wheelMount.userData.physicsBaseLocalPosition ||
    wheelMount.userData.baseLocalPosition ||
    wheelMount.position;
  WHEEL_BASE_LOCAL.copy(baseLocalPosition);
  ANGULAR_VELOCITY.set(body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z);

  for (let index = 0; index < wheels.length; index += 1) {
    const wheel = wheels[index];
    const state = states[index] || {};
    const restPosition = wheel.userData.restPosition || wheel.position;
    const wheelRadius = Number(wheel.userData.wheelRadius || bundle.vehicleSpec?.wheelRadius || 0.34);
    const canSteer = Boolean(wheel.userData.canSteer);
    const wheelPhysics = wheel.userData.vehiclePhysics || null;

    WHEEL_REST_LOCAL.copy(restPosition);
    WHEEL_ROOT_LOCAL.copy(WHEEL_BASE_LOCAL).add(WHEEL_REST_LOCAL);
    WHEEL_BODY_POINT.copy(WHEEL_ROOT_LOCAL);
    WHEEL_BODY_POINT.y -= bundle.rootOffsetY;
    state.bodyPoint = state.bodyPoint || new THREE.Vector3();
    state.bodyPoint.copy(WHEEL_BODY_POINT);

    WHEEL_OFFSET_WORLD.copy(WHEEL_BODY_POINT).applyQuaternion(quaternion);
    WHEEL_WORLD_POINT.set(
      body.position.x + WHEEL_OFFSET_WORLD.x,
      body.position.y + WHEEL_OFFSET_WORLD.y,
      body.position.z + WHEEL_OFFSET_WORLD.z
    );

    const hit = sampleGround(WHEEL_WORLD_POINT.x, WHEEL_WORLD_POINT.z, WHEEL_WORLD_POINT.y);
    const driveScale = typeof wheelPhysics?.driven === 'boolean' ? (wheelPhysics.driven ? 1 : 0) : (canSteer ? 0 : 1);
    const rideCompression = Number(suspensionConfig?.rideCompression ?? 0);
    const contactBuffer = Number(suspensionConfig?.supportContactBuffer ?? 0);
    const bumpTravel = Number(suspensionConfig?.bumpTravel ?? 0.18);
    const droopTravel = Number(suspensionConfig?.droopTravel ?? 0.14);
    const suspensionFrequency = Number(wheelPhysics?.suspensionFrequency ?? bundle.vehicleSpec?.suspensionFrequency ?? 1.45);
    const suspensionDampingRatio = Number(wheelPhysics?.suspensionDamping ?? bundle.vehicleSpec?.suspensionDamping ?? 0.82);
    const maxSuspensionForce = Number(wheelPhysics?.maxSuspensionForce ?? bundle.vehicleSpec?.maxSuspensionForce ?? 24000);
    const frictionSlip = Number(wheelPhysics?.frictionSlip ?? bundle.vehicleSpec?.frictionSlip ?? 1.55);
    const sideFrictionStiffness = Number(wheelPhysics?.sideFrictionStiffness ?? bundle.vehicleSpec?.sideFrictionStiffness ?? 1.08);
    const brakeBias = Number(wheelPhysics?.brakeBias ?? (canSteer ? 0.62 : 0.38));
    const corneringStiffness = Number(
      wheelPhysics?.corneringStiffness ??
      (canSteer
        ? bundle.vehicleSpec?.frontCorneringStiffness || 1480
        : bundle.vehicleSpec?.rearCorneringStiffness || 920)
    );

    let localTravel = -droopTravel;
    let grounded = false;
    if (hit && wheelContactsEnabled) {
      const desiredCenterY = hit.height + wheelRadius;
      const verticalDelta = desiredCenterY - WHEEL_WORLD_POINT.y;
      localTravel = bodyUp.y > 1e-4 ? verticalDelta / bodyUp.y : 0;
      grounded = localTravel > -droopTravel;
    }

    const effectiveTravel = THREE.MathUtils.clamp(
      localTravel - contactBuffer,
      -droopTravel,
      bumpTravel + rideCompression
    );
    const springCompression = grounded
      ? THREE.MathUtils.clamp(effectiveTravel + rideCompression, 0, bumpTravel + rideCompression)
      : 0;

    WHEEL_POINT_VELOCITY.set(body.linearVelocity.x, body.linearVelocity.y, body.linearVelocity.z);
    WHEEL_POINT_ANGULAR_VELOCITY.copy(ANGULAR_VELOCITY).cross(WHEEL_OFFSET_WORLD);
    WHEEL_POINT_VELOCITY.add(WHEEL_POINT_ANGULAR_VELOCITY);

    state.contactPoint = state.contactPoint || new THREE.Vector3();
    state.contactNormal = state.contactNormal || new THREE.Vector3();
    if (hit) {
      WHEEL_CONTACT_POINT.set(WHEEL_WORLD_POINT.x, hit.height, WHEEL_WORLD_POINT.z);
      state.contactPoint.copy(WHEEL_CONTACT_POINT);
      state.contactNormal.copy(hit.normal || UP_AXIS);
    } else {
      state.contactPoint.copy(WHEEL_WORLD_POINT);
      state.contactNormal.copy(bodyUp);
    }

    WHEEL_SUSPENSION_DIRECTION.copy(bodyUp).multiplyScalar(-1);
    const contactDotSuspension = grounded
      ? state.contactNormal.dot(WHEEL_SUSPENSION_DIRECTION)
      : -1;
    const clippedInvContactDotSuspension =
      contactDotSuspension >= -0.1 ? 10 : -1 / contactDotSuspension;
    const projectedVelocity = grounded ? WHEEL_POINT_VELOCITY.dot(state.contactNormal) : 0;
    const suspensionRelativeVelocity = grounded
      ? projectedVelocity * clippedInvContactDotSuspension
      : 0;

    const previousCompression = Number(state.springCompression || 0);
    state.springVelocity = (springCompression - previousCompression) / Math.max(1 / 120, bundle.world?.timeStepSizeSeconds || 1 / 60);
    state.springCompression = springCompression;
    state.localTravel = localTravel;
    state.targetOffset = THREE.MathUtils.clamp(
      effectiveTravel,
      -droopTravel,
      bumpTravel + rideCompression
    );
    state.grounded = grounded;
    state.driveScale = driveScale;
    state.canSteer = canSteer;
    state.anchorName = wheel.userData.anchorName || '';
    state.wheelRadius = wheelRadius;
    state.clippedInvContactDotSuspension = clippedInvContactDotSuspension;
    state.suspensionRelativeVelocity = suspensionRelativeVelocity;
    state.brakeBias = brakeBias;
    state.corneringStiffness = corneringStiffness;
    state.gripScale = THREE.MathUtils.clamp(
      hit?.normal ? hit.normal.y / Math.max(0.2, suspensionConfig?.supportMinNormalY ?? 0.72) : 1,
      0.35,
      1
    );
    if (grounded) {
      const invMass = Number(body.motionProperties?.invMass ?? (bundle.vehicleSpec?.massKg ? 1 / bundle.vehicleSpec.massKg : 0.0007));
      const invInertia = body.motionProperties?.invInertiaDiagonal;
      WHEEL_RELATIVE_POINT.copy(WHEEL_BODY_POINT);
      const rCrossUpX = WHEEL_RELATIVE_POINT.z;
      const rCrossUpY = 0;
      const rCrossUpZ = -WHEEL_RELATIVE_POINT.x;
      const angularContribution = invInertia
        ? rCrossUpX * rCrossUpX * invInertia.x +
          rCrossUpY * rCrossUpY * invInertia.y +
          rCrossUpZ * rCrossUpZ * invInertia.z
        : 0;
      const effectiveMass = 1 / Math.max(invMass + angularContribution, 1e-4);
      const omega = Math.PI * 2 * suspensionFrequency;
      const springStiffness = effectiveMass * omega * omega * clippedInvContactDotSuspension;
      const dampingStrength = 2 * effectiveMass * suspensionDampingRatio * omega * clippedInvContactDotSuspension;
      state.suspensionForce = THREE.MathUtils.clamp(
        springCompression * springStiffness - suspensionRelativeVelocity * dampingStrength,
        0,
        maxSuspensionForce
      );
    } else {
      state.suspensionForce = 0;
    }

    WHEEL_PROJECTED_FORWARD.copy(bodyForward);
    if (canSteer) {
      WHEEL_PROJECTED_FORWARD.applyAxisAngle(bodyUp, -effectiveSteer);
    }
    WHEEL_PROJECTED_FORWARD.addScaledVector(
      state.contactNormal,
      -WHEEL_PROJECTED_FORWARD.dot(state.contactNormal)
    );
    if (WHEEL_PROJECTED_FORWARD.lengthSq() < 1e-6) {
      WHEEL_PROJECTED_FORWARD.copy(bodyForward);
    }
    WHEEL_PROJECTED_FORWARD.normalize();

    WHEEL_PROJECTED_RIGHT.copy(bodyRight);
    WHEEL_PROJECTED_RIGHT.addScaledVector(
      state.contactNormal,
      -WHEEL_PROJECTED_RIGHT.dot(state.contactNormal)
    );
    if (WHEEL_PROJECTED_RIGHT.lengthSq() < 1e-6) {
      WHEEL_PROJECTED_RIGHT.crossVectors(state.contactNormal, WHEEL_PROJECTED_FORWARD);
    }
    WHEEL_PROJECTED_RIGHT.normalize();
    WHEEL_PROJECTED_RIGHT.crossVectors(state.contactNormal, WHEEL_PROJECTED_FORWARD).normalize();

    state.forward = state.forward || new THREE.Vector3();
    state.side = state.side || new THREE.Vector3();
    state.forward.copy(WHEEL_PROJECTED_FORWARD);
    state.side.copy(WHEEL_PROJECTED_RIGHT);
    state.lateralSpeed = WHEEL_POINT_VELOCITY.dot(WHEEL_PROJECTED_RIGHT);
    state.longitudinalSpeed = WHEEL_POINT_VELOCITY.dot(WHEEL_PROJECTED_FORWARD);
    state.worldPoint = state.worldPoint || new THREE.Vector3();
    state.worldPoint.copy(WHEEL_WORLD_POINT);
    state.maxTractionForce = state.suspensionForce * frictionSlip * state.gripScale;
    state.sideFrictionStiffness = sideFrictionStiffness;

    states[index] = state;
  }

  states.length = wheels.length;
  bundle.wheelStates = states;
  return states;
}
