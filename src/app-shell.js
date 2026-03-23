import * as THREE from 'three';

import { createDefaultEngineState } from './engine-system.js';
import { resolveModelUrl, resolvePublicUrl } from './assets/asset-base-url.js';
import { BUILT_IN_WEAPONS } from './assets/weapon-library.js';
import { mountHUD } from './ui/HUD.jsx';

const BUILT_IN_WEAPON_CONFIGS = Object.fromEntries(
  BUILT_IN_WEAPONS.map((weapon) => [
    weapon.id,
    {
      id: weapon.id,
      label: weapon.label,
      modelUrl: weapon.modelUrl,
      asset: weapon.asset,
      proceduralModel: weapon.proceduralModel,
      gripOffset: [...weapon.gripOffset],
      gripRotation: [...weapon.gripRotation],
      gripScale: weapon.gripScale,
      sockets: {
        muzzle: [...weapon.sockets.muzzle],
        offHand: [...weapon.sockets.offHand],
        casingEject: [...weapon.sockets.casingEject],
        aim: [...weapon.sockets.aim]
      },
      fireCooldownSeconds: weapon.fireCooldownSeconds,
      locomotionSet: { ...weapon.locomotionSet }
    }
  ])
);

const DEFAULT_WEAPON_INVENTORY_IDS = ['unarmed', ...BUILT_IN_WEAPONS.map((weapon) => weapon.id)];

export const MODEL_CONFIG = {
  defaultCarId: 'mustang',
  defaultStageId: 'test_course',
  defaultDrivingStyle: 'hero',
  defaultCarUrl: resolveModelUrl('/models/mustang.glb'),
  defaultTireUrl: resolveModelUrl('/models/tire_s.glb'),
  defaultSteeringWheelUrl: resolveModelUrl('/models/steering_wheel.glb'),
  bikeBodyUrl: resolveModelUrl('/models/triumph.glb'),
  bikeWheelUrl: resolveModelUrl('/models/motorcycle_wheel.glb'),
  steeringWheelDiameter: 0.38,
  steeringWheelRotation: [0, Math.PI, 0],
  steeringWheelTurnRatio: -6.2,
  bikeTargetSpan: 2.35,
  bikeBodyOffsetY: -0.15,
  bikeReferenceWheelDiameter: 0.72,
  bikeFrontWheelOffset: new THREE.Vector3(0, 0, 0),
  bikeRearWheelOffset: new THREE.Vector3(0, 0, 0),
  bikeFrontWheelRotation: [0, 0, 0],
  bikeRearWheelRotation: [0, 0, 0],
  bikeFrontSpinAxis: 'z',
  bikeRearSpinAxis: 'z',
  bikeSpawnPosition: new THREE.Vector3(12, 0, 18),
  bikeSpawnYaw: -Math.PI * 0.5,
  valkyrieSpawnPosition: new THREE.Vector3(-12, 0, 18),
  valkyrieSpawnYaw: Math.PI * 0.5,
  sendanSpawnPosition: new THREE.Vector3(24, 0, 18),
  sendanSpawnYaw: Math.PI,
  dominatorSpawnPosition: new THREE.Vector3(-24, 0, 18),
  dominatorSpawnYaw: Math.PI,
  leftSideTireRotation: [0, 0, 0],
  leftSideTireMirror: false,
  rightSideTireRotation: [Math.PI, 0, 0],
  rightSideTireMirror: false,
  referenceWheelDiameter: 0.84,
  driveAcceleration: 12,
  reverseAcceleration: 8,
  maxForwardSpeed: 16,
  maxReverseSpeed: 6,
  driveDrag: 5.5,
  steeringRate: 6.2,
  steerReturnRate: 7.4,
  maxSteerAngle: 0.5,
  turnSpeed: 1.7,
  chaseCameraHeight: 2.9,
  chaseCameraDistance: 7.8,
  chaseCameraSideBias: 0,
  chaseCameraTurnSideBias: 1.15,
  chaseCameraLookAhead: 4.2,
  chaseCameraPositionLerp: 4.2,
  chaseCameraTargetLerp: 5.6,
  cinematicChaseCameraHeight: 4.8,
  cinematicChaseCameraDistance: 12.5,
  cinematicChaseCameraSideBias: 2.8,
  cinematicChaseCameraLookAhead: 6.5,
  cinematicChaseCameraOrbitRate: 0.22,
  cinematicChaseCameraPositionLerp: 2.4,
  cinematicChaseCameraTargetLerp: 3.1,
  driveCameraFar: 50000,
  driveCameraMinDistance: 3.4,
  driveCameraMaxDistance: 4000,
  autopilotCruiseThrottle: 0.82,
  autopilotBrakeSpeedMps: 19,
  autopilotSteerStrength: 0.85,
  autopilotSteerLookAhead: 18,
  autopilotWanderRate: 0.38,
  autopilotWanderAmplitude: 0.7,
  drivingStyles: {
    sim: {
      id: 'sim',
      label: 'Sim',
      description: 'Manual transmission / steadier weight transfer',
      transmissionMode: 'manual',
      maxSteerAngleMultiplier: 1,
      steeringResponseMultiplier: 1,
      steeringReturnMultiplier: 1,
      highSpeedSteerFactorMultiplier: 1,
      tractionCoefficientMultiplier: 1,
      brakeForceMultiplier: 1,
      corneringDragMultiplier: 1,
      rwdYawGainBoost: 0,
      rwdGripLossBoost: 0,
      autoDirectionShiftSpeedMps: 0.75
    },
    arcade: {
      id: 'arcade',
      label: 'Arcade',
      description: 'Automatic transmission / fast steering / easy oversteer',
      transmissionMode: 'automatic',
      maxSteerAngleMultiplier: 1.24,
      steeringResponseMultiplier: 1.55,
      steeringReturnMultiplier: 1.58,
      highSpeedSteerFactorMultiplier: 1.56,
      throttleCurveExponent: 0.72,
      driveForceMultiplier: 1.16,
      lowSpeedDriveForceMultiplier: 1.34,
      lowSpeedDriveForceBlendSpeedMps: 13,
      tractionCoefficientMultiplier: 0.98,
      brakeForceMultiplier: 1.18,
      corneringDragMultiplier: 0.46,
      rwdYawGainBoost: 0.78,
      rwdGripLossBoost: 0.24,
      autoUpshiftRpmMultiplier: 1.08,
      autoDownshiftRpmMultiplier: 1.1,
      autoDirectionShiftSpeedMps: 0.95
    },
    hero: {
      id: 'hero',
      label: 'Hero',
      description: 'Automatic transmission / extreme acceleration / heavy brakes / aggressive drift assist',
      transmissionMode: 'automatic',
      maxSteerAngleMultiplier: 1.48,
      steeringResponseMultiplier: 2.2,
      steeringReturnMultiplier: 2.05,
      highSpeedSteerFactorMultiplier: 1.92,
      throttleCurveExponent: 0.42,
      driveForceMultiplier: 2.15,
      lowSpeedDriveForceMultiplier: 3.1,
      lowSpeedDriveForceBlendSpeedMps: 22,
      tractionCoefficientMultiplier: 1.12,
      brakeForceMultiplier: 1.95,
      corneringDragMultiplier: 0.16,
      rwdYawGainBoost: 1.42,
      rwdGripLossBoost: 0.42,
      autoUpshiftRpmMultiplier: 1.18,
      autoDownshiftRpmMultiplier: 1.24,
      autoDirectionShiftSpeedMps: 1.05
    }
  },
  suspension: {
    sampleRayStart: 4.5,
    sampleRayDistance: 12,
    supportMinNormalY: 0.45,
    supportDeadzone: 0.04,
    supportContactBuffer: 0.035,
    heaveSpring: 22,
    heaveDamping: 8.5,
    heaveWheelVelocityFactor: 0.03,
    wheelSpring: 150,
    wheelDamping: 10,
    neutralWheelSpring: 120,
    neutralWheelDamping: 9,
    bumpTravel: 0.18,
    droopTravel: 0.14,
    rideCompression: 0.025,
    pitchSpring: 10,
    pitchDamping: 6.5,
    rollSpring: 11,
    rollDamping: 7,
    pitchAccelFactor: 0.012,
    rollAccelFactor: 0.01,
    contactPitchFactor: 0.24,
    contactRollFactor: 0.2,
    maxPitch: 0.18,
    maxRoll: 0.14,
    airborneGravity: 7.5,
    vehicleKinds: {
      car: {
        supportContactBuffer: 0.018,
        rideCompression: 0.012,
        wheelSpring: 115,
        wheelDamping: 6.2,
        neutralWheelSpring: 92,
        neutralWheelDamping: 5.1,
        droopTravel: 0.16,
        heaveSpring: 14.5,
        heaveDamping: 3.9,
        heaveWheelVelocityFactor: 0.09
      },
      bike: {
        supportContactBuffer: 0.014,
        supportDeadzone: 0.02,
        rideCompression: 0.016,
        wheelSpring: 126,
        wheelDamping: 6.3,
        neutralWheelSpring: 132,
        neutralWheelDamping: 7.8,
        bumpTravel: 0.16,
        droopTravel: 0.13,
        heaveSpring: 17,
        heaveDamping: 4.2,
        heaveWheelVelocityFactor: 0.085,
        pitchSpring: 9.8,
        pitchDamping: 5.9,
        rollSpring: 10.8,
        rollDamping: 6.4,
        pitchAccelFactor: 0.021,
        rollAccelFactor: 0.008,
        contactPitchFactor: 0.18,
        contactRollFactor: 0.08,
        maxPitch: 0.18,
        maxRoll: 0.085
      }
    }
  },
  vehicleFeedback: {
    skidMarks: {
      capacity: 320,
      color: '#120f0d',
      opacity: 0.22,
      lift: 0.012
    },
    skidMinSpeed: 6.5,
    skidMinDistance: 0.32,
    skidBrakeForceN: 3800,
    skidLateralAccel: 3.9,
    skidThrottle: 0.72,
    skidTrackLength: 0.58,
    skidTrackWidthScale: 0.62,
    vehicleKinds: {
      car: {
        bodyPitchScale: 0.3,
        bodyRollScale: 0.34,
        exhaustEnabled: true,
        exhaustCount: 2,
        exhaustColor: '#ff7a30',
        exhaustDistance: 1.8,
        exhaustBaseIntensity: 0.02,
        exhaustThrottleIntensity: 0.32,
        exhaustLoadIntensity: 0.24,
        exhaustRpmIntensity: 0.14,
        exhaustRiseRate: 14,
        exhaustFallRate: 5
      },
      bike: {
        bodyPitchScale: 0.18,
        bodyRollScale: 0.1,
        frontSteerScale: 0.92,
        frontSteerSign: 1,
        leanMax: 0.28,
        leanSpeedMps: 9.5,
        leanSteerFactor: 0.78,
        leanLateralFactor: 0.014,
        leanResponse: 3.8,
        riderLeanScale: 0.72,
        exhaustEnabled: true,
        exhaustCount: 1,
        exhaustColor: '#ff8c3b',
        exhaustDistance: 1.2,
        exhaustBaseIntensity: 0.02,
        exhaustThrottleIntensity: 0.22,
        exhaustLoadIntensity: 0.16,
        exhaustRpmIntensity: 0.1,
        exhaustRiseRate: 14,
        exhaustFallRate: 5
      }
    }
  },
  agentTraffic: {
    enabled: true,
    defaultVehicleCount: 8,
    defaultPedestrianCount: 14,
    despawnDistance: 240,
    spawnRadius: 180,
    routeLookAhead: {
      vehicle: 5.5,
      pedestrian: 1.6
    },
    turnResponse: {
      vehicle: 6.5,
      pedestrian: 8.5
    },
    speedRange: {
      vehicle: [7.5, 11.5],
      pedestrian: [1.15, 1.85]
    },
    stageOverrides: {
      city: {
        vehicleCount: 9,
        pedestrianCount: 16
      },
      bloomville: {
        vehicleCount: 12,
        pedestrianCount: 18
      }
    }
  },
  character: {
    modelUrl: resolveModelUrl('/models/norm.fbx'),
    animationUrls: {
      idle: resolveModelUrl('/models/Locomotion Pack/idle.fbx'),
      walk: resolveModelUrl('/models/Locomotion Pack/walking.fbx'),
      run: resolveModelUrl('/models/Locomotion Pack/running.fbx'),
      pistolIdle: resolveModelUrl('/animations/Pistol_Handgun Locomotion Pack/pistol idle.fbx'),
      pistolWalk: resolveModelUrl('/animations/Pistol_Handgun Locomotion Pack/pistol walk.fbx'),
      pistolRun: resolveModelUrl('/animations/Pistol_Handgun Locomotion Pack/pistol run.fbx'),
      pistolWalkBackward: resolveModelUrl('/animations/Pistol_Handgun Locomotion Pack/pistol walk backward.fbx'),
      pistolRunBackward: resolveModelUrl('/animations/Pistol_Handgun Locomotion Pack/pistol run backward.fbx'),
      pistolStrafeLeft: resolveModelUrl('/animations/Pistol_Handgun Locomotion Pack/pistol strafe.fbx'),
      pistolStrafeRight: resolveModelUrl('/animations/Pistol_Handgun Locomotion Pack/pistol strafe (2).fbx'),
      shotgunIdle: resolveModelUrl('/animations/Pro Rifle Pack (1)/idle aiming.fbx'),
      shotgunWalk: resolveModelUrl('/animations/Pro Rifle Pack (1)/walk forward.fbx'),
      shotgunRun: resolveModelUrl('/animations/Pro Rifle Pack (1)/run forward.fbx'),
      shotgunWalkBackward: resolveModelUrl('/animations/Pro Rifle Pack (1)/walk backward.fbx'),
      shotgunRunBackward: resolveModelUrl('/animations/Pro Rifle Pack (1)/run backward.fbx'),
      shotgunStrafeLeft: resolveModelUrl('/animations/Pro Rifle Pack (1)/walk left.fbx'),
      shotgunStrafeRight: resolveModelUrl('/animations/Pro Rifle Pack (1)/walk right.fbx'),
      enterCar: resolveModelUrl('/models/Locomotion Pack/Entering Car.fbx'),
      drive: resolveModelUrl('/models/Locomotion Pack/Driving.fbx'),
      exitCar: resolveModelUrl('/models/Locomotion Pack/Exiting Car.fbx'),
      honk: resolveModelUrl('/models/Locomotion Pack/Honking Horn.fbx'),
      fallingIdle: resolveModelUrl('/animations/Falling Idle.fbx'),
      gettingUp: resolveModelUrl('/animations/Getting Up.fbx')
    },
    weapons: {
      unarmed: {
        id: 'unarmed',
        label: 'Unarmed'
      },
      ...BUILT_IN_WEAPON_CONFIGS
    },
    height: 1.9,
    walkSpeed: 3.4,
    runSpeed: 6.6,
    acceleration: 18,
    deceleration: 20,
    turnRate: 10.5,
    gravity: 28,
    jumpSpeed: 8.6,
    capsuleRadius: 0.34,
    collisionPadding: 0.04,
    groundSnapDistance: 0.18,
    footProbeHeight: 1.2,
    minGroundProbeHeight: 6,
    stepOffset: 0.34,
    cameraHeight: 2.25,
    cameraDistance: 5.6,
    cameraSideBias: 0.2,
    cameraLookAhead: 1.4,
    targetHeight: 1.15,
    cameraPositionLerp: 6.4,
    cameraTargetLerp: 8.8,
    interactionDistance: 1.35,
    interactionSideOffset: -1.05,
    interactionForwardOffset: -0.15,
    doorOpenLeadSeconds: 0.35,
    enterDoorOpenDelaySeconds: 1.35,
    enterDoorCloseAdvanceSeconds: 0,
    exitDoorOpenDelaySeconds: 1.0,
    exitMoveAdvanceSeconds: 2.0,
    exitDoorCloseAdvanceSeconds: 2.0,
    spawnSideOffset: -2.65,
    spawnForwardOffset: -0.8,
    exitSideOffset: -2.7,
    exitForwardOffset: -0.9,
    seatFallbackForwardOffset: 0.8,
    seatFallbackInwardOffset: 0.65,
    seatFallbackHeight: 0.92,
    seatReferenceHipHeight: 0.9,
    seatRootOffsetX: 0,
    seatRootSideOffset: 0.22,
    seatRootOffsetY: -0.72,
    seatRootOffsetZ: -0.24,
    seatLocatorOffsetX: 0,
    seatLocatorSideOffset: -0.03,
    seatLocatorOffsetY: -0.1,
    seatLocatorHipOffsetY: 0.24,
    seatLocatorTransitionHipOffsetY: 0.5,
    seatLocatorExitHipOffsetY: 0.5,
    seatLocatorOffsetZ: -0.06,
    seatLocatorTransitionOffsetY: -0.3,
    seatLocatorExitOffsetY: -0.24,
    seatTransitionOffsetY: -0.28,
    seatTransitionOffsetZ: 0,
    seatExitOffsetY: -0.14,
    seatBackTiltX: -0.18,
    bikeSeatOffsetX: 0,
    bikeSeatOffsetY: 0.0,
    bikeSeatOffsetZ: -0.40,
    bikeSeatTiltX: 0.2
  },
  renderPixelRatioCap: 0.9,
  dynamicGiResolutionScale: 0.35,
  dynamicGiRadius: 1.6,
  dynamicGiSliceCount: 2,
  dynamicGiStepCount: 4,
  dynamicGiIntensity: 0.18,
  dynamicAoIntensity: 0.12,
  dynamicGiCompositeIntensity: 0.08,
  dynamicAoCompositeIntensity: 0.1,
  shadowMapSize: 768,
  sky: {
    turbidity: 6.2,
    rayleigh: 1.7,
    mieCoefficient: 0.008,
    mieDirectionalG: 0.84,
    elevation: 16,
    azimuth: 132
  },
  targetSpan: 5.4,
  tireRotation: [0, Math.PI, 0],
  wheelGroundOffset: -0.04,
  wheelArchInset: 0.07,
  frontAxleRatio: 0.18,
  rearAxleRatio: 0.245,
  targetWheelDiameterRatios: {
    length: 0.16,
    width: 0.36,
    height: 0.64
  },
  manualWheelAnchors: [
    { name: 'front-left', position: [1.08, 0.4, 1.45] },
    { name: 'front-right', position: [-1.08, 0.4, 1.45] },
    { name: 'rear-left', position: [1.08, 0.4, -1.38] },
    { name: 'rear-right', position: [-1.08, 0.4, -1.38] }
  ]
};

export function createAppShell(root) {
  root.innerHTML = `
    <div class="app-shell">
      <div id="hud-root"></div>
      <div style="display:none" data-role="hud">
        <span data-role="backend"></span>
        <span data-role="pipeline"></span>
        <span data-role="status"></span>
        <span data-role="car-name"></span>
        <span data-role="tire-name"></span>
        <span data-role="texture-hint"></span>
        <span data-role="engine-description"></span>
        <span data-role="drive-style-description"></span>
        <select data-role="built-in-car"></select>
        <select data-role="engine-type"></select>
        <select data-role="drive-style"></select>
        <select data-role="stage-type"></select>
        <select data-role="texture-slot"></select>
        <input type="file" accept=".glb" data-role="car-input" />
        <input type="file" accept=".glb" data-role="tire-input" />
        <input type="file" accept="image/png,image/jpeg,image/webp" data-role="texture-input" />
        <button data-role="toggle-lap"></button>
        <button data-role="toggle-autopilot"></button>
        <button data-role="toggle-cinematic"></button>
        <button data-role="toggle-nav-debug"></button>
        <button data-role="toggle-assigned-glb-only"></button>
        <button data-role="toggle-fog"></button>
        <button data-role="toggle-door"></button>
        <button data-role="toggle-rotation"></button>
        <button data-role="reset-camera"></button>
        <button data-role="download-texture"></button>
        <button data-role="export-car"></button>
        <input type="range" data-role="exposure" value="1.15" />
        <output data-role="exposure-value"></output>
        <input type="range" data-role="environment" value="1.2" />
        <output data-role="environment-value"></output>
        <input type="range" data-role="tire-scale" value="0.93" />
        <output data-role="tire-scale-value"></output>
        <input type="range" data-role="front-axle" value="0.18" />
        <output data-role="front-axle-value"></output>
        <input type="range" data-role="rear-axle" value="0.245" />
        <output data-role="rear-axle-value"></output>
        <input type="range" data-role="ride-height" value="0.105" />
        <output data-role="ride-height-value"></output>
        <input type="range" data-role="chassis-height" value="0.11" />
        <output data-role="chassis-height-value"></output>
        <input type="range" data-role="side-inset" value="0.07" />
        <output data-role="side-inset-value"></output>
        <input type="range" data-role="rotate-x" value="0" />
        <output data-role="rotate-x-value"></output>
        <input type="range" data-role="rotate-y" value="3.14" />
        <output data-role="rotate-y-value"></output>
        <input type="range" data-role="rotate-z" value="0" />
        <output data-role="rotate-z-value"></output>
        <select data-role="bike-front-spin-axis"><option value="z" selected>Z</option></select>
        <select data-role="bike-rear-spin-axis"><option value="z" selected>Z</option></select>
        <input type="range" data-role="bike-front-offset-x" value="0" /><output data-role="bike-front-offset-x-value"></output>
        <input type="range" data-role="bike-front-offset-y" value="0" /><output data-role="bike-front-offset-y-value"></output>
        <input type="range" data-role="bike-front-offset-z" value="0" /><output data-role="bike-front-offset-z-value"></output>
        <input type="range" data-role="bike-front-rotate-x" value="0" /><output data-role="bike-front-rotate-x-value"></output>
        <input type="range" data-role="bike-front-rotate-y" value="0" /><output data-role="bike-front-rotate-y-value"></output>
        <input type="range" data-role="bike-front-rotate-z" value="0" /><output data-role="bike-front-rotate-z-value"></output>
        <input type="range" data-role="bike-rear-offset-x" value="0" /><output data-role="bike-rear-offset-x-value"></output>
        <input type="range" data-role="bike-rear-offset-y" value="0" /><output data-role="bike-rear-offset-y-value"></output>
        <input type="range" data-role="bike-rear-offset-z" value="0" /><output data-role="bike-rear-offset-z-value"></output>
        <input type="range" data-role="bike-rear-rotate-x" value="0" /><output data-role="bike-rear-rotate-x-value"></output>
        <input type="range" data-role="bike-rear-rotate-y" value="0" /><output data-role="bike-rear-rotate-y-value"></output>
        <input type="range" data-role="bike-rear-rotate-z" value="0" /><output data-role="bike-rear-rotate-z-value"></output>
        <div class="progress-bar" data-role="progress"></div>
      </div>
      <div class="viewport" data-role="viewport"></div>
      <div class="viewport-note is-hidden" data-role="viewport-note"></div>
      <div class="drop-overlay" data-role="drop-overlay">
        <div class="drop-card">
          <strong>Drop GLB files to replace the current assets</strong>
          Car files are inferred from the filename unless it includes
          <code>tire</code>, <code>wheel</code>, or <code>rim</code>.
        </div>
      </div>
    </div>
  `;

  mountHUD(root.querySelector('#hud-root'));

  return {
    viewport: root.querySelector('[data-role="viewport"]'),
    viewportNote: root.querySelector('[data-role="viewport-note"]'),
    hud: root.querySelector('[data-role="hud"]'),
    toggleUi: null,
    backend: root.querySelector('[data-role="backend"]'),
    pipeline: root.querySelector('[data-role="pipeline"]'),
    status: root.querySelector('[data-role="status"]'),
    carName: root.querySelector('[data-role="car-name"]'),
    tireName: root.querySelector('[data-role="tire-name"]'),
    engineType: root.querySelector('[data-role="engine-type"]'),
    driveStyle: root.querySelector('[data-role="drive-style"]'),
    stageType: root.querySelector('[data-role="stage-type"]'),
    engineDescription: root.querySelector('[data-role="engine-description"]'),
    driveStyleDescription: root.querySelector('[data-role="drive-style-description"]'),
    progress: root.querySelector('[data-role="progress"]'),
    exposure: root.querySelector('[data-role="exposure"]'),
    exposureValue: root.querySelector('[data-role="exposure-value"]'),
    environment: root.querySelector('[data-role="environment"]'),
    environmentValue: root.querySelector('[data-role="environment-value"]'),
    tireScale: root.querySelector('[data-role="tire-scale"]'),
    tireScaleValue: root.querySelector('[data-role="tire-scale-value"]'),
    frontAxle: root.querySelector('[data-role="front-axle"]'),
    frontAxleValue: root.querySelector('[data-role="front-axle-value"]'),
    rearAxle: root.querySelector('[data-role="rear-axle"]'),
    rearAxleValue: root.querySelector('[data-role="rear-axle-value"]'),
    rideHeight: root.querySelector('[data-role="ride-height"]'),
    rideHeightValue: root.querySelector('[data-role="ride-height-value"]'),
    chassisHeight: root.querySelector('[data-role="chassis-height"]'),
    chassisHeightValue: root.querySelector('[data-role="chassis-height-value"]'),
    sideInset: root.querySelector('[data-role="side-inset"]'),
    sideInsetValue: root.querySelector('[data-role="side-inset-value"]'),
    rotateX: root.querySelector('[data-role="rotate-x"]'),
    rotateXValue: root.querySelector('[data-role="rotate-x-value"]'),
    rotateY: root.querySelector('[data-role="rotate-y"]'),
    rotateYValue: root.querySelector('[data-role="rotate-y-value"]'),
    rotateZ: root.querySelector('[data-role="rotate-z"]'),
    rotateZValue: root.querySelector('[data-role="rotate-z-value"]'),
    bikeFrontSpinAxis: root.querySelector('[data-role="bike-front-spin-axis"]'),
    bikeRearSpinAxis: root.querySelector('[data-role="bike-rear-spin-axis"]'),
    bikeFrontOffsetX: root.querySelector('[data-role="bike-front-offset-x"]'),
    bikeFrontOffsetXValue: root.querySelector('[data-role="bike-front-offset-x-value"]'),
    bikeFrontOffsetY: root.querySelector('[data-role="bike-front-offset-y"]'),
    bikeFrontOffsetYValue: root.querySelector('[data-role="bike-front-offset-y-value"]'),
    bikeFrontOffsetZ: root.querySelector('[data-role="bike-front-offset-z"]'),
    bikeFrontOffsetZValue: root.querySelector('[data-role="bike-front-offset-z-value"]'),
    bikeFrontRotateX: root.querySelector('[data-role="bike-front-rotate-x"]'),
    bikeFrontRotateXValue: root.querySelector('[data-role="bike-front-rotate-x-value"]'),
    bikeFrontRotateY: root.querySelector('[data-role="bike-front-rotate-y"]'),
    bikeFrontRotateYValue: root.querySelector('[data-role="bike-front-rotate-y-value"]'),
    bikeFrontRotateZ: root.querySelector('[data-role="bike-front-rotate-z"]'),
    bikeFrontRotateZValue: root.querySelector('[data-role="bike-front-rotate-z-value"]'),
    bikeRearOffsetX: root.querySelector('[data-role="bike-rear-offset-x"]'),
    bikeRearOffsetXValue: root.querySelector('[data-role="bike-rear-offset-x-value"]'),
    bikeRearOffsetY: root.querySelector('[data-role="bike-rear-offset-y"]'),
    bikeRearOffsetYValue: root.querySelector('[data-role="bike-rear-offset-y-value"]'),
    bikeRearOffsetZ: root.querySelector('[data-role="bike-rear-offset-z"]'),
    bikeRearOffsetZValue: root.querySelector('[data-role="bike-rear-offset-z-value"]'),
    bikeRearRotateX: root.querySelector('[data-role="bike-rear-rotate-x"]'),
    bikeRearRotateXValue: root.querySelector('[data-role="bike-rear-rotate-x-value"]'),
    bikeRearRotateY: root.querySelector('[data-role="bike-rear-rotate-y"]'),
    bikeRearRotateYValue: root.querySelector('[data-role="bike-rear-rotate-y-value"]'),
    bikeRearRotateZ: root.querySelector('[data-role="bike-rear-rotate-z"]'),
    bikeRearRotateZValue: root.querySelector('[data-role="bike-rear-rotate-z-value"]'),
    builtInCar: root.querySelector('[data-role="built-in-car"]'),
    carInput: root.querySelector('[data-role="car-input"]'),
    tireInput: root.querySelector('[data-role="tire-input"]'),
    textureSlot: root.querySelector('[data-role="texture-slot"]'),
    textureInput: root.querySelector('[data-role="texture-input"]'),
    downloadTexture: root.querySelector('[data-role="download-texture"]'),
    exportCar: root.querySelector('[data-role="export-car"]'),
    textureHint: root.querySelector('[data-role="texture-hint"]'),
    toggleLap: root.querySelector('[data-role="toggle-lap"]'),
    toggleAutopilot: root.querySelector('[data-role="toggle-autopilot"]'),
    toggleCinematic: root.querySelector('[data-role="toggle-cinematic"]'),
    toggleNavDebug: root.querySelector('[data-role="toggle-nav-debug"]'),
    toggleAssignedGlbOnly: root.querySelector('[data-role="toggle-assigned-glb-only"]'),
    toggleFog: root.querySelector('[data-role="toggle-fog"]'),
    toggleDoor: root.querySelector('[data-role="toggle-door"]'),
    toggleRotation: root.querySelector('[data-role="toggle-rotation"]'),
    resetCamera: root.querySelector('[data-role="reset-camera"]'),
    dropOverlay: root.querySelector('[data-role="drop-overlay"]')
  };
}

export function createInitialState(ui) {
  return {
    carAsset: null,
    tireAsset: null,
    tireAssetsByAxle: {
      front: null,
      rear: null
    },
    steeringWheelAsset: null,
    bikeAsset: null,
    bikeWheelAsset: null,
    valkyrieAsset: null,
    valkyrieTireAsset: null,
    sendanAsset: null,
    sendanTireAssets: {
      front: null,
      rear: null
    },
    dominatorAsset: null,
    carMetrics: null,
    carWheelAnchors: null,
    carEmbeddedWheelAssets: null,
    carTextureSlots: [],
    selectedCarTextureSlotId: '',
    selectedBuiltInCarId: MODEL_CONFIG.defaultCarId,
    selectedStageId: MODEL_CONFIG.defaultStageId,
    drivingStyle: MODEL_CONFIG.defaultDrivingStyle,
    carSource: 'Placeholder concept',
    tireSource: 'Using built-in fallback',
    ...createDefaultEngineState(),
    environmentIntensity: Number(ui.environment.value),
    exposure: Number(ui.exposure.value),
    tireScale: Number(ui.tireScale.value),
    frontAxleRatio: Number(ui.frontAxle.value),
    rearAxleRatio: Number(ui.rearAxle.value),
    rideHeight: Number(ui.rideHeight.value),
    wheelDropRatio: 0,
    chassisHeight: Number(ui.chassisHeight.value),
    sideInset: Number(ui.sideInset.value),
    tireRotation: [
      Number(ui.rotateX.value),
      Number(ui.rotateY.value),
      Number(ui.rotateZ.value)
    ],
    leftSideTireRotation: [...MODEL_CONFIG.leftSideTireRotation],
    leftSideTireMirror: MODEL_CONFIG.leftSideTireMirror,
    rightSideTireRotation: [...MODEL_CONFIG.rightSideTireRotation],
    rightSideTireMirror: MODEL_CONFIG.rightSideTireMirror,
    bikeFrontWheelOffset: MODEL_CONFIG.bikeFrontWheelOffset.clone(),
    bikeRearWheelOffset: MODEL_CONFIG.bikeRearWheelOffset.clone(),
    bikeFrontWheelRotation: [...MODEL_CONFIG.bikeFrontWheelRotation],
    bikeFrontSpinAxis: MODEL_CONFIG.bikeFrontSpinAxis,
    bikeRearWheelRotation: [...MODEL_CONFIG.bikeRearWheelRotation],
    bikeRearSpinAxis: MODEL_CONFIG.bikeRearSpinAxis,
    baseCarSuspensionOverrides: null,
    suspensionOverrides: null,
    driveMode: false,
    autopilotEnabled: false,
    cinematicCameraEnabled: false,
    navDebugVisible: false,
    sanVerdeAssignedGlbOnly: null,
    fogEnabled: true,
    overviewPan: {
      forward: false,
      backward: false,
      left: false,
      right: false
    },
    characterLoaded: false,
    characterInput: {
      forward: false,
      backward: false,
      left: false,
      right: false,
      run: false,
      jump: false
    },
    characterVehicleState: 'on_foot',
    characterEnterTimer: 0,
    canEnterVehicle: false,
    weaponInventoryIds: [...DEFAULT_WEAPON_INVENTORY_IDS],
    equippedWeaponId: 'unarmed',
    weaponWheelOpen: false,
    weaponWheelSelectionId: 'unarmed',
    driveSpeed: 0,
    steerAngle: 0,
    bikeLeanAngle: 0,
    vehicleYaw: Math.PI,
    vehiclePosition: new THREE.Vector3(),
    cameraOverride: false,
    cameraDetached: false,
    uiOpen: !localStorage.getItem('uiDismissed'),
    performanceOpen: false,
    wheelSpin: 0,
    wheelRadius: 0.42,
    autoRotate: false,
    doorOpen: false,
    doorAngle: 0,
    doorRig: null,
    steeringWheelRig: null,
    activeVehicleSource: 'garage',
    activeCarProxy: null,
    activeCarSuspensionOverrides: null,
    trafficTakeoverBlockGraceSeconds: 0,
    activeVehicleKind: 'car',
    parkedVehicleProxies: {
      car: null,
      bike: null,
      valkyrie: null,
      sendan: null,
      dominator: null
    },
    objectUrls: {
      car: null,
      tire: null
    },
    objectTextureUrls: [],
    performance: {
      frameAccumulator: 0,
      frameCount: 0,
      fps: 0,
      frameMs: 0,
      peakDraws: 0,
      peakTriangles: 0,
      drawCategorySummary: 'Top: n/a'
    }
  };
}
