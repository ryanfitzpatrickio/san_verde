import * as THREE from 'three';

const DEFAULT_COLOR = new THREE.Color('#ff7a30');
const CORE_GEOMETRY = new THREE.SphereGeometry(0.04, 12, 10);

function findNamedPoints(root, pattern) {
  const found = [];
  root?.traverse?.((child) => {
    if (child?.name && pattern.test(child.name)) {
      found.push(child);
    }
  });
  return found;
}

function createEmitter(color, distance) {
  const coreMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.1,
    depthWrite: false
  });
  coreMaterial.userData.noGround = true;

  const core = new THREE.Mesh(CORE_GEOMETRY, coreMaterial);
  core.castShadow = false;
  core.receiveShadow = false;

  const light = new THREE.PointLight(color, 0, distance, 2);
  light.castShadow = false;

  const holder = new THREE.Group();
  holder.add(core, light);

  return { holder, core, light, intensity: 0 };
}

function getFallbackPositions(kind, metrics) {
  const size = metrics?.size;
  const min = metrics?.min;
  const max = metrics?.max;
  if (!size || !min || !max) {
    return kind === 'bike'
      ? [new THREE.Vector3(0.3, 0.45, -0.8)]
      : [new THREE.Vector3(-0.48, 0.34, -1.9), new THREE.Vector3(0.48, 0.34, -1.9)];
  }

  if (kind === 'bike') {
    return [
      new THREE.Vector3(
        max.x - size.x * 0.16,
        min.y + size.y * 0.26,
        min.z + size.z * 0.18
      )
    ];
  }

  return [
    new THREE.Vector3(
      min.x + size.x * 0.22,
      min.y + size.y * 0.18,
      min.z + size.z * 0.07
    ),
    new THREE.Vector3(
      max.x - size.x * 0.22,
      min.y + size.y * 0.18,
      min.z + size.z * 0.07
    )
  ];
}

export function attachVehicleExhaustEffects({ body, metrics, kind, config }) {
  const effectConfig = config.vehicleFeedback?.vehicleKinds?.[kind];
  if (!body || !effectConfig?.exhaustEnabled) {
    return null;
  }

  const group = new THREE.Group();
  group.name = `${kind}-exhaust-effects`;
  const color = new THREE.Color(effectConfig.exhaustColor || DEFAULT_COLOR);
  const namedTargets = findNamedPoints(body, /exhaust|tailpipe|muffler/i)
    .slice(0, effectConfig.exhaustCount || 1)
    .map((target) => body.worldToLocal(target.getWorldPosition(new THREE.Vector3())));
  const fallbackPositions = getFallbackPositions(kind, metrics);
  const positions = namedTargets.length ? namedTargets : fallbackPositions;
  const emitters = positions.slice(0, effectConfig.exhaustCount || positions.length).map((position) => {
    const emitter = createEmitter(color, effectConfig.exhaustDistance || 1.6);
    emitter.holder.position.copy(position);
    group.add(emitter.holder);
    return emitter;
  });

  body.add(group);
  return { group, emitters };
}

export function updateVehicleExhaustEffects(effectSystem, engineSnapshot, deltaSeconds, feedbackConfig, kind) {
  if (!effectSystem?.emitters?.length || !engineSnapshot) {
    return;
  }

  const settings = feedbackConfig?.vehicleKinds?.[kind];
  if (!settings?.exhaustEnabled) {
    return;
  }

  const rpmNormalized = THREE.MathUtils.clamp(
    (engineSnapshot.engineRpm - 700) / 5600,
    0,
    1
  );
  const load = THREE.MathUtils.clamp(engineSnapshot.engineLoad || 0, 0, 1);
  const throttle = THREE.MathUtils.clamp(engineSnapshot.engineThrottle || 0, 0, 1);
  const targetIntensity =
    settings.exhaustBaseIntensity +
    throttle * settings.exhaustThrottleIntensity +
    load * settings.exhaustLoadIntensity +
    rpmNormalized * settings.exhaustRpmIntensity;
  const riseRate = settings.exhaustRiseRate || 12;
  const fallRate = settings.exhaustFallRate || 5;
  const alpha = 1 - Math.exp(-(targetIntensity > 0.001 ? riseRate : fallRate) * Math.max(deltaSeconds, 1 / 120));

  for (const emitter of effectSystem.emitters) {
    emitter.intensity = THREE.MathUtils.lerp(
      emitter.intensity,
      targetIntensity,
      alpha
    );
    const intensity = emitter.intensity;
    emitter.light.intensity = intensity;
    emitter.light.distance = settings.exhaustDistance || 1.6;
    emitter.core.material.opacity = THREE.MathUtils.clamp(intensity * 0.45, 0, 0.65);
    const coreScale = 0.55 + intensity * 1.8;
    emitter.core.scale.setScalar(coreScale);
  }
}
