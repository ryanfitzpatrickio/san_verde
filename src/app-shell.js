import * as THREE from 'three';

import { createDefaultEngineState } from './engine-system.js';
import { resolveModelUrl, resolvePublicUrl } from './assets/asset-base-url.js';

export const MODEL_CONFIG = {
  defaultCarId: 'mustang',
  defaultStageId: 'test_course',
  defaultDrivingStyle: 'arcade',
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
    modelUrl: resolvePublicUrl('/models/norm.fbx'),
    animationUrls: {
      idle: resolvePublicUrl('/models/Locomotion Pack/idle.fbx'),
      walk: resolvePublicUrl('/models/Locomotion Pack/walking.fbx'),
      run: resolvePublicUrl('/models/Locomotion Pack/running.fbx'),
      enterCar: resolvePublicUrl('/models/Locomotion Pack/Entering Car.fbx'),
      drive: resolvePublicUrl('/models/Locomotion Pack/Driving.fbx'),
      exitCar: resolvePublicUrl('/models/Locomotion Pack/Exiting Car.fbx'),
      honk: resolvePublicUrl('/models/Locomotion Pack/Honking Horn.fbx')
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
    interactionDistance: 0.6,
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
      <button class="hud-toggle" type="button" data-role="toggle-ui">Show UI</button>
      <div class="performance-overlay" data-role="performance-overlay">
        <div class="performance-chip"><span class="label">FPS 1s</span><span class="value" data-role="perf-fps">0</span></div>
        <div class="performance-chip"><span class="label">CPU Avg</span><span class="value" data-role="perf-frame">0.0 ms</span></div>
        <div class="performance-chip"><span class="label">Draws/Frame</span><span class="value" data-role="perf-draws">0</span></div>
        <div class="performance-chip"><span class="label">Peak/1s</span><span class="value" data-role="perf-peak-draws">0</span></div>
        <div class="performance-chip"><span class="label">Render Total</span><span class="value" data-role="perf-render-calls">0</span></div>
        <div class="performance-chip"><span class="label">Tris</span><span class="value" data-role="perf-triangles">0</span></div>
        <div class="performance-chip"><span class="label">Peak/1s</span><span class="value" data-role="perf-peak-triangles">0</span></div>
        <div class="performance-chip"><span class="label">Geo</span><span class="value" data-role="perf-geometries">0</span></div>
        <div class="performance-chip"><span class="label">Tex</span><span class="value" data-role="perf-textures">0</span></div>
        <div class="performance-breakdown" data-role="perf-breakdown">Top: n/a</div>
      </div>
      <div class="hud is-hidden" data-role="hud">
        <p class="eyebrow">Cruise Vehicle Lab</p>
        <h1>WEBGPU<br />GARAGE</h1>
        <p class="lede">
          High-fidelity car staging for <code>three@0.183.2</code>. Drop in a
          chassis GLB and an optional tire GLB, then orbit, light, and scale the scene.
        </p>
        <div class="status-row">
          <div class="stat-card"><span class="label">Renderer</span><span class="value" data-role="backend">Booting...</span></div>
          <div class="stat-card"><span class="label">Pipeline</span><span class="value" data-role="pipeline">Performance Forward</span></div>
        </div>
        <div class="status-row">
          <div class="stat-card"><span class="label">Status</span><span class="value" data-role="status">Initializing scene</span></div>
          <div class="stat-card"><span class="label">Post FX</span><span class="value">Off</span></div>
        </div>
        <div class="asset-row">
          <div class="asset-card"><span class="label">Car Asset</span><span class="asset-name" data-role="car-name">Placeholder concept</span></div>
          <div class="asset-card"><span class="label">Tire Asset</span><span class="asset-name" data-role="tire-name">Using built-in fallback</span></div>
        </div>
        <p class="hint engine-hint">
          Inspired by <code>engine-sim</code>-style procedural engine sound. Audio unlocks on first click or key press.
          Sim mode uses <code>Q</code>/<code>E</code> to shift and <code>N</code> for neutral; arcade mode shifts automatically.
        </p>
        <label class="control"><span class="control-row"><span>Built-in car</span></span><select data-role="built-in-car"></select></label>
        <label class="control"><span class="control-row"><span>Engine type</span><output data-role="engine-description">390ci V8 / 5-speed manual</output></span><select data-role="engine-type"></select></label>
        <label class="control"><span class="control-row"><span>Driving style</span><output data-role="drive-style-description">Manual transmission / steadier weight transfer</output></span><select data-role="drive-style"></select></label>
        <label class="control"><span class="control-row"><span>Stage</span></span><select data-role="stage-type"></select></label>
        <div class="actions">
          <label class="file-action">Load car GLB<input type="file" accept=".glb" data-role="car-input" /></label>
          <label class="file-action secondary">Load tire GLB<input type="file" accept=".glb" data-role="tire-input" /></label>
          <button class="action secondary" type="button" data-role="toggle-lap">Drive mode: On</button>
          <button class="action secondary" type="button" data-role="toggle-autopilot">Autopilot: Off</button>
          <button class="action secondary" type="button" data-role="toggle-cinematic">Camera: Normal</button>
          <button class="action secondary" type="button" data-role="toggle-nav-debug">Nav Debug: Off</button>
          <button class="action secondary" type="button" data-role="toggle-fog">Fog: On</button>
          <button class="action secondary" type="button" data-role="toggle-door">Door: Closed</button>
          <button class="action secondary" type="button" data-role="toggle-rotation">Auto-rotate: Off</button>
          <button class="action secondary" type="button" data-role="reset-camera">Reset camera</button>
        </div>
        <div class="texture-editor">
          <span class="label">Texture Editor</span>
          <label class="control"><span class="control-row"><span>Car texture slot</span></span><select data-role="texture-slot"></select></label>
          <div class="actions texture-actions">
            <button class="action secondary" type="button" data-role="download-texture">Download texture</button>
            <label class="file-action secondary">Upload texture<input type="file" accept="image/png,image/jpeg,image/webp" data-role="texture-input" /></label>
            <button class="action secondary" type="button" data-role="export-car">Export car GLB</button>
          </div>
          <p class="hint texture-hint" data-role="texture-hint">
            Load a car GLB to inspect its editable base-color texture slots.
          </p>
        </div>
        <div class="controls">
          <label class="control"><span class="control-row"><span>Exposure</span><output data-role="exposure-value">1.15</output></span><input type="range" min="0.6" max="1.8" step="0.01" value="1.15" data-role="exposure" /></label>
          <label class="control"><span class="control-row"><span>Environment</span><output data-role="environment-value">1.20</output></span><input type="range" min="0.4" max="2.4" step="0.01" value="1.2" data-role="environment" /></label>
          <label class="control"><span class="control-row"><span>Tire scale</span><output data-role="tire-scale-value">0.93</output></span><input type="range" min="0.5" max="1.8" step="0.01" value="0.93" data-role="tire-scale" /></label>
          <label class="control"><span class="control-row"><span>Front axle</span><output data-role="front-axle-value">0.180</output></span><input type="range" min="0.16" max="0.3" step="0.005" value="0.18" data-role="front-axle" /></label>
          <label class="control"><span class="control-row"><span>Rear axle</span><output data-role="rear-axle-value">0.245</output></span><input type="range" min="0.14" max="0.28" step="0.005" value="0.245" data-role="rear-axle" /></label>
          <label class="control"><span class="control-row"><span>Ride height</span><output data-role="ride-height-value">0.105</output></span><input type="range" min="-0.08" max="0.18" step="0.005" value="0.105" data-role="ride-height" /></label>
          <label class="control"><span class="control-row"><span>Chassis height</span><output data-role="chassis-height-value">0.110</output></span><input type="range" min="-0.2" max="0.25" step="0.005" value="0.11" data-role="chassis-height" /></label>
          <label class="control"><span class="control-row"><span>Side inset</span><output data-role="side-inset-value">0.070</output></span><input type="range" min="0.05" max="0.18" step="0.005" value="0.07" data-role="side-inset" /></label>
          <label class="control"><span class="control-row"><span>Rotate X</span><output data-role="rotate-x-value">0.00</output></span><input type="range" min="-3.14" max="3.14" step="0.01" value="0" data-role="rotate-x" /></label>
          <label class="control"><span class="control-row"><span>Rotate Y</span><output data-role="rotate-y-value">3.14</output></span><input type="range" min="-3.14" max="3.14" step="0.01" value="3.14" data-role="rotate-y" /></label>
          <label class="control"><span class="control-row"><span>Rotate Z</span><output data-role="rotate-z-value">0.00</output></span><input type="range" min="-3.14" max="3.14" step="0.01" value="0" data-role="rotate-z" /></label>
        </div>
        <div class="controls bike-controls">
          <span class="label">Bike Wheel Tuning</span>
          <label class="control"><span class="control-row"><span>Front roll axis</span></span><select data-role="bike-front-spin-axis"><option value="x">X</option><option value="y">Y</option><option value="z" selected>Z</option></select></label>
          <label class="control"><span class="control-row"><span>Rear roll axis</span></span><select data-role="bike-rear-spin-axis"><option value="x">X</option><option value="y">Y</option><option value="z" selected>Z</option></select></label>
          <label class="control"><span class="control-row"><span>Front offset X</span><output data-role="bike-front-offset-x-value">0.000</output></span><input type="range" min="-0.5" max="0.5" step="0.01" value="0" data-role="bike-front-offset-x" /></label>
          <label class="control"><span class="control-row"><span>Front offset Y</span><output data-role="bike-front-offset-y-value">0.000</output></span><input type="range" min="-0.5" max="0.5" step="0.01" value="0" data-role="bike-front-offset-y" /></label>
          <label class="control"><span class="control-row"><span>Front offset Z</span><output data-role="bike-front-offset-z-value">0.000</output></span><input type="range" min="-0.5" max="0.5" step="0.01" value="0" data-role="bike-front-offset-z" /></label>
          <label class="control"><span class="control-row"><span>Front rotate X</span><output data-role="bike-front-rotate-x-value">0.00</output></span><input type="range" min="-3.14" max="3.14" step="0.01" value="0" data-role="bike-front-rotate-x" /></label>
          <label class="control"><span class="control-row"><span>Front rotate Y</span><output data-role="bike-front-rotate-y-value">0.00</output></span><input type="range" min="-3.14" max="3.14" step="0.01" value="0" data-role="bike-front-rotate-y" /></label>
          <label class="control"><span class="control-row"><span>Front rotate Z</span><output data-role="bike-front-rotate-z-value">0.00</output></span><input type="range" min="-3.14" max="3.14" step="0.01" value="0" data-role="bike-front-rotate-z" /></label>
          <label class="control"><span class="control-row"><span>Rear offset X</span><output data-role="bike-rear-offset-x-value">0.000</output></span><input type="range" min="-0.5" max="0.5" step="0.01" value="0" data-role="bike-rear-offset-x" /></label>
          <label class="control"><span class="control-row"><span>Rear offset Y</span><output data-role="bike-rear-offset-y-value">0.000</output></span><input type="range" min="-0.5" max="0.5" step="0.01" value="0" data-role="bike-rear-offset-y" /></label>
          <label class="control"><span class="control-row"><span>Rear offset Z</span><output data-role="bike-rear-offset-z-value">0.000</output></span><input type="range" min="-0.5" max="0.5" step="0.01" value="0" data-role="bike-rear-offset-z" /></label>
          <label class="control"><span class="control-row"><span>Rear rotate X</span><output data-role="bike-rear-rotate-x-value">0.00</output></span><input type="range" min="-3.14" max="3.14" step="0.01" value="0" data-role="bike-rear-rotate-x" /></label>
          <label class="control"><span class="control-row"><span>Rear rotate Y</span><output data-role="bike-rear-rotate-y-value">0.00</output></span><input type="range" min="-3.14" max="3.14" step="0.01" value="0" data-role="bike-rear-rotate-y" /></label>
          <label class="control"><span class="control-row"><span>Rear rotate Z</span><output data-role="bike-rear-rotate-z-value">0.00</output></span><input type="range" min="-3.14" max="3.14" step="0.01" value="0" data-role="bike-rear-rotate-z" /></label>
        </div>
        <div class="progress" aria-hidden="true"><div class="progress-bar" data-role="progress"></div></div>
        <p class="hint">
          Built-in garage cars live at <code>/public/models/car.glb</code> and
          <code>/public/models/car2.glb</code>; tires still load from
          <code>/public/models/tire.glb</code>. Drag files anywhere into the viewport
          to hot-swap them without changing code.
        </p>
      </div>
      <div class="viewport" data-role="viewport"></div>
      <div class="engine-overlay" data-role="engine-overlay">
        <div class="engine-chip engine-chip-wide"><span class="label">Engine</span><span class="value" data-role="engine-name">Mustang 390ci V8</span></div>
        <div class="engine-chip"><span class="label">Gear</span><span class="value" data-role="engine-gear">1</span></div>
        <div class="engine-chip"><span class="label">RPM</span><span class="value" data-role="engine-rpm">850</span></div>
        <div class="engine-chip"><span class="label">Speed</span><span class="value" data-role="vehicle-speed">0 mph</span></div>
      </div>
      <div class="minimap-overlay is-hidden" data-role="minimap-overlay">
        <div class="minimap-frame">
          <canvas class="minimap-canvas" width="256" height="256" data-role="minimap-canvas"></canvas>
          <div class="minimap-cardinal">N</div>
        </div>
        <div class="minimap-caption">
          <span class="label">Map</span>
          <span class="value" data-role="minimap-label">Bloomville</span>
        </div>
      </div>
      <div class="player-overlay" data-role="player-overlay">
        <span class="label">Target</span>
        <span class="value" data-role="player-mode">On foot</span>
        <span class="player-hint" data-role="player-hint">WASD move, Shift run, F enter car</span>
      </div>
      <div class="viewport-note is-hidden" data-role="viewport-note">
        Orbit with left mouse, pan with right mouse, zoom with wheel. Edit
        <code>MODEL_CONFIG</code> in <code>src/app-shell.js</code> if your tire anchors
        need different positions or rotation. On foot use <code>WASD</code>, hold <code>Shift</code> to run,
        and press <code>F</code> near the car to drive. In the car use <code>WASD</code> to drive,
        with sim-mode manual shifting on <code>Q/E/N</code> and arcade-mode automatic shifting.
      </div>
      <div class="drop-overlay" data-role="drop-overlay">
        <div class="drop-card">
          <strong>Drop GLB files to replace the current assets</strong>
          Car files are inferred from the filename unless it includes
          <code>tire</code>, <code>wheel</code>, or <code>rim</code>.
        </div>
      </div>
    </div>
  `;

  return {
    viewport: root.querySelector('[data-role="viewport"]'),
    engineOverlay: root.querySelector('[data-role="engine-overlay"]'),
    performanceOverlay: root.querySelector('[data-role="performance-overlay"]'),
    hud: root.querySelector('[data-role="hud"]'),
    toggleUi: root.querySelector('[data-role="toggle-ui"]'),
    viewportNote: root.querySelector('[data-role="viewport-note"]'),
    backend: root.querySelector('[data-role="backend"]'),
    pipeline: root.querySelector('[data-role="pipeline"]'),
    status: root.querySelector('[data-role="status"]'),
    carName: root.querySelector('[data-role="car-name"]'),
    tireName: root.querySelector('[data-role="tire-name"]'),
    engineName: root.querySelector('[data-role="engine-name"]'),
    engineGear: root.querySelector('[data-role="engine-gear"]'),
    engineRpm: root.querySelector('[data-role="engine-rpm"]'),
    vehicleSpeed: root.querySelector('[data-role="vehicle-speed"]'),
    perfFps: root.querySelector('[data-role="perf-fps"]'),
    perfFrame: root.querySelector('[data-role="perf-frame"]'),
    perfDraws: root.querySelector('[data-role="perf-draws"]'),
    perfPeakDraws: root.querySelector('[data-role="perf-peak-draws"]'),
    perfRenderCalls: root.querySelector('[data-role="perf-render-calls"]'),
    perfTriangles: root.querySelector('[data-role="perf-triangles"]'),
    perfPeakTriangles: root.querySelector('[data-role="perf-peak-triangles"]'),
    perfGeometries: root.querySelector('[data-role="perf-geometries"]'),
    perfTextures: root.querySelector('[data-role="perf-textures"]'),
    perfBreakdown: root.querySelector('[data-role="perf-breakdown"]'),
    minimapOverlay: root.querySelector('[data-role="minimap-overlay"]'),
    minimapCanvas: root.querySelector('[data-role="minimap-canvas"]'),
    minimapLabel: root.querySelector('[data-role="minimap-label"]'),
    playerOverlay: root.querySelector('[data-role="player-overlay"]'),
    playerMode: root.querySelector('[data-role="player-mode"]'),
    playerHint: root.querySelector('[data-role="player-hint"]'),
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
    carMetrics: null,
    carWheelAnchors: null,
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
    chassisHeight: Number(ui.chassisHeight.value),
    sideInset: Number(ui.sideInset.value),
    tireRotation: [
      Number(ui.rotateX.value),
      Number(ui.rotateY.value),
      Number(ui.rotateZ.value)
    ],
    bikeFrontWheelOffset: MODEL_CONFIG.bikeFrontWheelOffset.clone(),
    bikeRearWheelOffset: MODEL_CONFIG.bikeRearWheelOffset.clone(),
    bikeFrontWheelRotation: [...MODEL_CONFIG.bikeFrontWheelRotation],
    bikeFrontSpinAxis: MODEL_CONFIG.bikeFrontSpinAxis,
    bikeRearWheelRotation: [...MODEL_CONFIG.bikeRearWheelRotation],
    bikeRearSpinAxis: MODEL_CONFIG.bikeRearSpinAxis,
    driveMode: false,
    autopilotEnabled: false,
    cinematicCameraEnabled: false,
    navDebugVisible: false,
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
    driveSpeed: 0,
    steerAngle: 0,
    bikeLeanAngle: 0,
    vehicleYaw: Math.PI,
    vehiclePosition: new THREE.Vector3(),
    cameraOverride: false,
    cameraDetached: false,
    uiOpen: false,
    performanceOpen: false,
    wheelSpin: 0,
    wheelRadius: 0.42,
    autoRotate: false,
    doorOpen: false,
    doorAngle: 0,
    doorRig: null,
    steeringWheelRig: null,
    activeVehicleKind: 'car',
    parkedVehicleProxies: {
      car: null,
      bike: null
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
