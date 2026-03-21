import { resolvePublicUrl } from './assets/asset-base-url.js';

const ENGINE_LIBRARY = [
  {
    id: 'mustang_390_v8_5mt',
    label: 'Mustang 390ci V8',
    description: '390ci V8 / 5-speed manual',
    cylinders: 8,
    displacementCi: 390,
    idleRpm: 850,
    redlineRpm: 5800,
    limiterRpm: 6100,
    rpmRiseRate: 4200,
    rpmFallRate: 2800,
    freeRevRange: 3500,
    loadedRevGain: 1450,
    transmission: {
      reverseRatio: 2.86,
      gearRatios: [3.25, 1.93, 1.36, 1.0, 0.79],
      finalDrive: 4.05
    },
    physics: {
      massKg: 1440,
      wheelbaseM: 2.74,
      dragCoefficient: 0.39,
      frontalAreaM2: 2.04,
      rollingResistanceCoeff: 0.016,
      drivelineEfficiency: 0.92,
      brakeForceN: 9800,
      tractionCoefficient: 1.08,
      steeringResponse: 5.8,
      steeringReturnRate: 7.2,
      highSpeedSteerFactor: 0.42,
      rwdYawGain: 0.42,
      rwdGripLoss: 0.28,
      corneringDragStrength: 0.11,
      launchSlipSpeedMps: 5.2,
      engineBrakingNm: 150,
      maxVehicleSpeedMps: 82,
      reverseSpeedLimitMps: 14,
      torqueCurveNm: [
        [800, 410],
        [1200, 486],
        [1800, 566],
        [2600, 640],
        [3200, 668],
        [3800, 654],
        [4600, 608],
        [5200, 554],
        [5800, 480],
        [6100, 366]
      ]
    },
    audio: {
      masterGain: 0.12,
      lopeFrequency: 4.2,
      lopeDepth: 0.014,
      subGain: 0.03,
      pulseGain: 0.024,
      bodyGain: 0.03,
      exhaustGain: 0.028,
      raspGain: 0.012,
      intakeGain: 0.02,
      decelGain: 0.018,
      distortionAmount: 0.72,
      samples: {
        idle: resolvePublicUrl('/sounds/idle_h.mp3'),
        low: resolvePublicUrl('/sounds/low.mp3'),
        mid: resolvePublicUrl('/sounds/mid.mp3'),
        full: resolvePublicUrl('/sounds/full.mp3'),
        intake: resolvePublicUrl('/sounds/intake.mp3'),
        decel: resolvePublicUrl('/sounds/decel_h.mp3')
      }
    }
  },
  {
    id: 'cosworth_ra_v12',
    label: 'Cosworth RA V12',
    description: '6.5L NA V12 / 7-speed paddle shift',
    cylinders: 12,
    displacementCi: 396,
    idleRpm: 1050,
    redlineRpm: 10500,
    limiterRpm: 11000,
    rpmRiseRate: 8200,
    rpmFallRate: 5800,
    freeRevRange: 7200,
    loadedRevGain: 2800,
    transmission: {
      reverseRatio: 3.4,
      gearRatios: [3.08, 2.12, 1.62, 1.28, 1.02, 0.85, 0.72],
      finalDrive: 3.15
    },
    physics: {
      massKg: 1050,
      wheelbaseM: 2.67,
      dragCoefficient: 0.33,
      frontalAreaM2: 1.82,
      rollingResistanceCoeff: 0.013,
      drivelineEfficiency: 0.94,
      brakeForceN: 14800,
      tractionCoefficient: 1.32,
      steeringResponse: 8.2,
      steeringReturnRate: 9.0,
      highSpeedSteerFactor: 0.28,
      rwdYawGain: 0.36,
      rwdGripLoss: 0.20,
      corneringDragStrength: 0.07,
      launchSlipSpeedMps: 7.0,
      engineBrakingNm: 290,
      maxVehicleSpeedMps: 110,
      reverseSpeedLimitMps: 12,
      torqueCurveNm: [
        [1000, 360],
        [2500, 490],
        [4000, 590],
        [5500, 648],
        [7000, 700],
        [8000, 718],
        [9000, 698],
        [10000, 638],
        [10500, 540],
        [11000, 390]
      ]
    },
    audio: {
      masterGain: 0.14,
      lopeFrequency: 6.8,
      lopeDepth: 0.007,
      subGain: 0.018,
      pulseGain: 0.016,
      bodyGain: 0.022,
      exhaustGain: 0.042,
      raspGain: 0.024,
      intakeGain: 0.036,
      decelGain: 0.030,
      distortionAmount: 0.52,
      samples: {
        idle: resolvePublicUrl('/sounds/idle_h.mp3'),
        low: resolvePublicUrl('/sounds/low.h.mp3'),
        mid: resolvePublicUrl('/sounds/mid_h.mp3'),
        full: resolvePublicUrl('/sounds/high_h.mp3'),
        intake: resolvePublicUrl('/sounds/intake_h.mp3'),
        decel: resolvePublicUrl('/sounds/decel_h.mp3')
      }
    }
  }
];

const ENGINE_LIBRARY_MAP = new Map(ENGINE_LIBRARY.map((engine) => [engine.id, engine]));

export function getEngineDefinition(engineId) {
  return ENGINE_LIBRARY_MAP.get(engineId) || ENGINE_LIBRARY[0];
}

export function createDefaultEngineState(engineId = ENGINE_LIBRARY[0].id) {
  const definition = getEngineDefinition(engineId);
  return {
    engineTypeId: definition.id,
    engineName: definition.label,
    engineDescription: definition.description,
    engineRpm: Math.round(definition.idleRpm),
    engineThrottle: 0,
    engineLoad: 0,
    engineGearLabel: '1',
    engineAudioReady: false
  };
}

export class EngineAudioSystem {
  constructor(engineId = ENGINE_LIBRARY[0].id) {
    this.definition = getEngineDefinition(engineId);
    this.currentGearIndex = 2;
    this.lastAutomaticDirection = 1;
    this.rpm = this.definition.idleRpm;
    this.throttle = 0;
    this.load = 0;
    this.torqueNm = 0;
    this.wheelForceN = 0;
    this.brakeForceN = 0;
    this.clutchCoupling = 0;
    this.shiftTransient = 0;
    this.shiftDirection = 0;
    this.audioContext = null;
    this.nodes = null;
    this.isReady = false;
    this.samplesReady = false;
  }

  getDefinition() {
    return this.definition;
  }

  getCurrentGear() {
    return getGearSlots(this.definition)[this.currentGearIndex];
  }

  getSnapshot() {
    return {
      engineTypeId: this.definition.id,
      engineName: this.definition.label,
      engineDescription: this.definition.description,
      engineRpm: Math.round(this.rpm),
      engineThrottle: this.throttle,
      engineLoad: this.load,
      engineGearLabel: this.getCurrentGear().label,
      engineGearRatio: this.getCurrentGear().ratio,
      engineTorqueNm: this.torqueNm,
      engineWheelForceN: this.wheelForceN,
      engineBrakeForceN: this.brakeForceN,
      engineClutchCoupling: this.clutchCoupling,
      engineAudioReady: this.isReady
    };
  }

  setEngine(engineId) {
    const prevSamples = this.definition?.audio?.samples;
    this.definition = getEngineDefinition(engineId);
    this.currentGearIndex = 2;
    this.lastAutomaticDirection = 1;
    this.rpm = this.definition.idleRpm;
    this.throttle = 0;
    this.load = 0;
    this.torqueNm = 0;
    this.wheelForceN = 0;
    this.brakeForceN = 0;
    this.clutchCoupling = 0;
    this.shiftTransient = 0;
    this.shiftDirection = 0;
    if (this.nodes && this.audioContext) {
      const newSamples = this.definition.audio?.samples;
      const samplesChanged = JSON.stringify(prevSamples) !== JSON.stringify(newSamples);
      if (samplesChanged) {
        this._reloadSamples();
      } else {
        this.updateAudio();
      }
    }
    return this.getSnapshot();
  }

  _reloadSamples() {
    const sampleKeys = ['sampleIdleSource', 'sampleLowSource', 'sampleMidSource', 'sampleFullSource', 'sampleIntakeSource', 'sampleDecelSource'];
    for (const key of sampleKeys) {
      const src = this.nodes[key];
      if (src) {
        try { src.stop(); } catch {}
        src.disconnect();
        this.nodes[key] = null;
      }
    }
    this.nodes.samplePlayers = false;
    this.nodes.sampleLayerCount = 0;
    loadSampleLayers(this.audioContext, this.nodes, this.definition).then(() => {
      this.samplesReady = Boolean(this.nodes.samplePlayers);
      this.updateAudio();
    });
  }

  reset() {
    this.currentGearIndex = 2;
    this.lastAutomaticDirection = 1;
    this.rpm = this.definition.idleRpm;
    this.throttle = 0;
    this.load = 0;
    this.torqueNm = 0;
    this.wheelForceN = 0;
    this.brakeForceN = 0;
    this.clutchCoupling = 0;
    this.shiftTransient = 0;
    this.shiftDirection = 0;
    if (this.nodes && this.audioContext) {
      this.updateAudio();
    }
    return this.getSnapshot();
  }

  shiftUp() {
    const maxGearIndex = getGearSlots(this.definition).length - 1;
    this.currentGearIndex = Math.min(this.currentGearIndex + 1, maxGearIndex);
    this.lastAutomaticDirection = this.currentGearIndex === 0 ? -1 : 1;
    this.shiftTransient = 0.14;
    this.shiftDirection = -1;
    return this.getSnapshot();
  }

  shiftDown() {
    this.currentGearIndex = Math.max(this.currentGearIndex - 1, 0);
    this.lastAutomaticDirection = this.currentGearIndex === 0 ? -1 : 1;
    this.shiftTransient = 0.18;
    this.shiftDirection = 1;
    return this.getSnapshot();
  }

  shiftToNeutral() {
    this.currentGearIndex = 1;
    this.shiftTransient = 0.1;
    this.shiftDirection = -1;
    return this.getSnapshot();
  }

  async ensureAudioReady() {
    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
      return false;
    }

    if (!this.audioContext) {
      this.audioContext = new window.AudioContext({ latencyHint: 'interactive' });
      this.nodes = createAudioGraph(this.audioContext, this.definition);
      await loadSampleLayers(this.audioContext, this.nodes, this.definition);
      this.samplesReady = Boolean(this.nodes.samplePlayers);
      this.isReady = true;
      this.updateAudio();
    }

    if (this.audioContext.state !== 'running') {
      await this.audioContext.resume();
    }

    return true;
  }

  update({
    deltaSeconds,
    throttleInput,
    brakeInput = 0,
    driveSpeed,
    wheelRadius,
    driveEnabled,
    transmissionMode = 'manual',
    desiredDirection = 1,
    automaticUpshiftRpmMultiplier = 1,
    automaticDownshiftRpmMultiplier = 1
  }) {
    const speedMps = Number.isFinite(driveSpeed) ? driveSpeed : 0;
    const throttle = clamp(Math.max(throttleInput, 0), 0, 1);
    const brake = clamp(Math.max(brakeInput, 0), 0, 1);
    const wheelRpm = Math.abs(speedMps) / (Math.max(wheelRadius, 0.12) * Math.PI * 2) * 60;
    if (transmissionMode === 'automatic') {
      this.updateAutomaticTransmission({
        speedMps,
        wheelRpm,
        throttle,
        desiredDirection,
        automaticUpshiftRpmMultiplier,
        automaticDownshiftRpmMultiplier
      });
    }
    const gear = this.getCurrentGear();
    const idleFloor = this.definition.idleRpm * 0.96;
    const freeRevTarget = this.definition.idleRpm + throttle * this.definition.freeRevRange;
    const shiftBlend = clamp(this.shiftTransient / 0.18, 0, 1);
    const physics = this.definition.physics;

    let targetRpm = this.definition.idleRpm;
    let load = throttle * 0.45;
    let coupledRpm = idleFloor;
    let clutchCoupling = 0;

    if (gear.ratio !== 0) {
      coupledRpm = Math.max(idleFloor, wheelRpm * Math.abs(gear.totalRatio));
      const launchBlend = clamp(1 - Math.abs(speedMps) / physics.launchSlipSpeedMps, 0, 1);
      const slipBlend = clamp(0.18 + throttle * 0.48 + launchBlend * 0.3, 0.16, 0.9);
      clutchCoupling = clamp(1 - slipBlend * 0.82, 0.12, 1);
      targetRpm = lerp(freeRevTarget, coupledRpm + throttle * this.definition.loadedRevGain, clutchCoupling);
      if (throttle < 0.04) {
        targetRpm = Math.max(targetRpm * 0.72, coupledRpm);
      }
      load = clamp(
        0.2 +
          throttle * 0.72 +
          Math.max(coupledRpm - this.rpm, 0) / Math.max(this.definition.redlineRpm, 1),
        0,
        1
      );
    } else {
      targetRpm = freeRevTarget;
      load = clamp(0.16 + throttle * 0.84, 0, 1);
      clutchCoupling = 0;
    }

    if (shiftBlend > 0) {
      targetRpm += this.shiftDirection * 380 * shiftBlend;
      load = clamp(load + 0.18 * shiftBlend, 0, 1);
    }

    if (!driveEnabled && throttle < 0.01) {
      targetRpm = this.definition.idleRpm;
      load *= 0.55;
    }

    const rpmTarget = clamp(targetRpm, idleFloor, this.definition.limiterRpm);
    const responseRate = rpmTarget > this.rpm ? this.definition.rpmRiseRate : this.definition.rpmFallRate;
    this.rpm = moveTowards(this.rpm, rpmTarget, responseRate * deltaSeconds);
    this.throttle = throttle;
    this.load = load;
    this.clutchCoupling = clutchCoupling;
    this.shiftTransient = Math.max(0, this.shiftTransient - deltaSeconds);
    this.torqueNm = sampleTorqueCurve(physics.torqueCurveNm, this.rpm) * throttle;

    const nearStandstill = Math.abs(speedMps) < 0.22;
    const engineBrakingNm =
      gear.ratio !== 0
        ? physics.engineBrakingNm *
          (0.25 + clamp((this.rpm - this.definition.idleRpm) / Math.max(this.definition.redlineRpm - this.definition.idleRpm, 1), 0, 1) * 0.75) *
          (1 - throttle) *
          clutchCoupling
        : 0;
    let netDriveTorqueNm = this.torqueNm - engineBrakingNm;
    if (nearStandstill && throttle < 0.035 && brake < 0.035) {
      netDriveTorqueNm = 0;
    }
    this.wheelForceN =
      gear.ratio !== 0
        ? (netDriveTorqueNm * gear.totalRatio * physics.drivelineEfficiency * clutchCoupling) / Math.max(wheelRadius, 0.12)
        : 0;
    this.brakeForceN = brake * physics.brakeForceN;

    if (this.nodes && this.audioContext) {
      this.updateAudio();
    }

    return this.getSnapshot();
  }

  updateAutomaticTransmission({
    speedMps,
    wheelRpm,
    throttle,
    desiredDirection,
    automaticUpshiftRpmMultiplier = 1,
    automaticDownshiftRpmMultiplier = 1
  }) {
    const gearSlots = getGearSlots(this.definition);
    const maxGearIndex = gearSlots.length - 1;
    const shiftDirection = desiredDirection < 0 ? -1 : 1;
    const directionThreshold = 0.9;

    if (Math.abs(speedMps) < directionThreshold) {
      this.lastAutomaticDirection = shiftDirection;
      const lowSpeedGearIndex = shiftDirection < 0 ? 0 : 2;
      if (this.currentGearIndex !== lowSpeedGearIndex) {
        this.currentGearIndex = lowSpeedGearIndex;
        this.shiftTransient = shiftDirection < 0 ? 0.12 : 0.14;
        this.shiftDirection = shiftDirection < 0 ? 1 : -1;
      }
      return;
    }

    if (speedMps < -directionThreshold) {
      this.lastAutomaticDirection = -1;
      if (this.currentGearIndex !== 0) {
        this.currentGearIndex = 0;
        this.shiftTransient = 0.12;
        this.shiftDirection = 1;
      }
      return;
    }

    this.lastAutomaticDirection = 1;
    let desiredGearIndex = Math.max(this.currentGearIndex, 2);
    if (desiredGearIndex > maxGearIndex) {
      desiredGearIndex = maxGearIndex;
    }

    const upshiftRpm =
      lerp(this.definition.redlineRpm * 0.72, this.definition.redlineRpm * 0.9, throttle) *
      automaticUpshiftRpmMultiplier;
    const downshiftRpm = Math.max(
      this.definition.idleRpm * 1.65,
      this.definition.redlineRpm * 0.34 * automaticDownshiftRpmMultiplier
    );

    while (
      desiredGearIndex < maxGearIndex &&
      wheelRpm * Math.abs(gearSlots[desiredGearIndex].totalRatio) > upshiftRpm
    ) {
      desiredGearIndex += 1;
    }

    while (
      desiredGearIndex > 2 &&
      wheelRpm * Math.abs(gearSlots[desiredGearIndex].totalRatio) < downshiftRpm
    ) {
      desiredGearIndex -= 1;
    }

    if (desiredGearIndex !== this.currentGearIndex) {
      this.shiftTransient = desiredGearIndex > this.currentGearIndex ? 0.14 : 0.16;
      this.shiftDirection = desiredGearIndex > this.currentGearIndex ? -1 : 1;
      this.currentGearIndex = desiredGearIndex;
    }
  }

  updateAudio() {
    if (!this.nodes || !this.audioContext) {
      return;
    }

    const now = this.audioContext.currentTime;
    const rpmRatio = clamp(
      (this.rpm - this.definition.idleRpm) / Math.max(this.definition.redlineRpm - this.definition.idleRpm, 1),
      0,
      1
    );
    const firingHz = Math.max(24, (this.rpm / 60) * (this.definition.cylinders / 2));
    const masterGain = this.definition.audio.masterGain * (0.68 + rpmRatio * 0.32);
    const lopeAmount = this.definition.audio.lopeDepth * (1 - rpmRatio) * (0.4 + (1 - this.throttle) * 0.6);
    const shiftBlend = clamp(this.shiftTransient / 0.18, 0, 1);
    const decelAmount = clamp((1 - this.throttle) * (0.2 + this.load) * rpmRatio, 0, 1);
    const samplePresence = this.nodes.samplePlayers ? 1 : 0;
    const sampleCoverage =
      this.nodes.sampleLayerTargetCount > 0
        ? (this.nodes.sampleLayerCount || 0) / this.nodes.sampleLayerTargetCount
        : 0;
    const proceduralBlend = samplePresence ? Math.max(0, (1 - sampleCoverage) * 0.16) : 1;

    smoothParam(this.nodes.master.gain, driveEnabledGain(this.throttle, masterGain), now, 0.08);
    smoothParam(this.nodes.subOsc.frequency, firingHz * 0.25, now, 0.08);
    smoothParam(this.nodes.pulseOsc.frequency, firingHz * 0.5, now, 0.06);
    smoothParam(this.nodes.bodyOsc.frequency, firingHz * 0.99, now, 0.06);
    smoothParam(this.nodes.exhaustOsc.frequency, firingHz * 0.5, now, 0.06);
    smoothParam(this.nodes.raspOsc.frequency, firingHz * (1.95 + this.throttle * 0.15), now, 0.05);
    smoothParam(this.nodes.lopeOsc.frequency, this.definition.audio.lopeFrequency + this.throttle * 1.8, now, 0.12);
    smoothParam(this.nodes.lopeGain.gain, lopeAmount, now, 0.18);
    smoothParam(
      this.nodes.subGain.gain,
      (this.definition.audio.subGain + this.load * 0.014) * proceduralBlend,
      now,
      0.09
    );
    smoothParam(
      this.nodes.pulseGain.gain,
      (this.definition.audio.pulseGain + this.load * 0.014 + shiftBlend * 0.006) * proceduralBlend,
      now,
      0.08
    );
    smoothParam(
      this.nodes.bodyGain.gain,
      (this.definition.audio.bodyGain + this.throttle * 0.02 + rpmRatio * 0.012) * proceduralBlend,
      now,
      0.08
    );
    smoothParam(
      this.nodes.exhaustGain.gain,
      (this.definition.audio.exhaustGain + this.load * 0.02 + rpmRatio * 0.016 + shiftBlend * 0.014) *
        proceduralBlend,
      now,
      0.08
    );
    smoothParam(
      this.nodes.raspGain.gain,
      (this.definition.audio.raspGain + this.load * 0.014 + rpmRatio * 0.018 + shiftBlend * 0.018) *
        proceduralBlend,
      now,
      0.08
    );
    smoothParam(
      this.nodes.intakeGain.gain,
      (this.definition.audio.intakeGain + this.throttle * 0.025 + rpmRatio * 0.008) * proceduralBlend,
      now,
      0.08
    );
    smoothParam(this.nodes.decelGain.gain, this.definition.audio.decelGain * decelAmount * proceduralBlend, now, 0.08);
    smoothParam(this.nodes.toneFilter.frequency, 520 + rpmRatio * 1400 + this.throttle * 260, now, 0.09);
    smoothParam(this.nodes.bodyFilter.frequency, 220 + rpmRatio * 880, now, 0.08);
    smoothParam(this.nodes.exhaustFilter.frequency, 280 + rpmRatio * 1200 + this.load * 180, now, 0.08);
    smoothParam(this.nodes.raspFilter.frequency, 1200 + rpmRatio * 3800 + shiftBlend * 600, now, 0.09);
    smoothParam(this.nodes.intakeFilter.frequency, 650 + rpmRatio * 3200 + this.throttle * 760, now, 0.1);
    smoothParam(this.nodes.decelFilter.frequency, 1800 + rpmRatio * 2600, now, 0.08);

    if (this.nodes.samplePlayers) {
      const idleSample = bellCurve(rpmRatio, 0.06, 0.12) * (0.9 - this.throttle * 0.45);
      const lowSample = bellCurve(rpmRatio, 0.26, 0.18) * (0.65 + (1 - this.load) * 0.2);
      const midSample = bellCurve(rpmRatio, 0.52, 0.22) * (0.5 + this.load * 0.32);
      const fullSample = smoothstep(0.42, 0.86, rpmRatio) * (0.18 + this.load * 0.82);
      const intakeSample = smoothstep(0.18, 0.92, rpmRatio) * (0.16 + this.throttle * 0.84);
      const decelSample = decelAmount * (0.3 + rpmRatio * 0.7);

      smoothParam(this.nodes.sampleIdleGain.gain, idleSample * 1.2, now, 0.12);
      smoothParam(this.nodes.sampleLowGain.gain, lowSample * 0.92, now, 0.12);
      smoothParam(this.nodes.sampleMidGain.gain, midSample * 0.88, now, 0.1);
      smoothParam(this.nodes.sampleFullGain.gain, fullSample * 0.96, now, 0.1);
      smoothParam(this.nodes.sampleIntakeGain.gain, intakeSample * 0.72, now, 0.08);
      smoothParam(this.nodes.sampleDecelGain.gain, decelSample * 0.34, now, 0.08);

      smoothPlaybackRate(this.nodes.sampleIdleSource, 0.82 + rpmRatio * 0.3, now, 0.16);
      smoothPlaybackRate(this.nodes.sampleLowSource, 0.72 + rpmRatio * 0.48, now, 0.14);
      smoothPlaybackRate(this.nodes.sampleMidSource, 0.68 + rpmRatio * 0.68, now, 0.14);
      smoothPlaybackRate(this.nodes.sampleFullSource, 0.64 + rpmRatio * 0.86 + this.throttle * 0.04, now, 0.12);
      smoothPlaybackRate(this.nodes.sampleIntakeSource, 0.86 + rpmRatio * 0.44 + this.throttle * 0.08, now, 0.1);
      smoothPlaybackRate(this.nodes.sampleDecelSource, 0.84 + rpmRatio * 0.56, now, 0.12);
    }
  }
}

function getGearSlots(engine) {
  const forwardGears = engine.transmission.gearRatios.map((ratio, index) => ({
    label: String(index + 1),
    ratio,
    totalRatio: ratio * engine.transmission.finalDrive
  }));

  return [
    {
      label: 'R',
      ratio: -engine.transmission.reverseRatio,
      totalRatio: -engine.transmission.reverseRatio * engine.transmission.finalDrive
    },
    { label: 'N', ratio: 0, totalRatio: 0 },
    ...forwardGears
  ];
}

function sampleTorqueCurve(curve, rpm) {
  if (!Array.isArray(curve) || curve.length === 0) {
    return 0;
  }

  if (rpm <= curve[0][0]) {
    return curve[0][1];
  }

  for (let index = 1; index < curve.length; index += 1) {
    const [rightRpm, rightTorque] = curve[index];
    const [leftRpm, leftTorque] = curve[index - 1];
    if (rpm <= rightRpm) {
      const t = (rpm - leftRpm) / Math.max(rightRpm - leftRpm, 1);
      return lerp(leftTorque, rightTorque, t);
    }
  }

  return curve[curve.length - 1][1];
}

function createAudioGraph(audioContext, definition) {
  const master = audioContext.createGain();
  master.gain.value = 0;

  const toneFilter = audioContext.createBiquadFilter();
  toneFilter.type = 'lowpass';
  toneFilter.Q.value = 0.7;

  const raspFilter = audioContext.createBiquadFilter();
  raspFilter.type = 'bandpass';
  raspFilter.Q.value = 0.9;

  const intakeFilter = audioContext.createBiquadFilter();
  intakeFilter.type = 'bandpass';
  intakeFilter.Q.value = 0.6;

  const bodyFilter = audioContext.createBiquadFilter();
  bodyFilter.type = 'bandpass';
  bodyFilter.Q.value = 0.9;

  const exhaustFilter = audioContext.createBiquadFilter();
  exhaustFilter.type = 'lowpass';
  exhaustFilter.Q.value = 0.7;

  const decelFilter = audioContext.createBiquadFilter();
  decelFilter.type = 'bandpass';
  decelFilter.Q.value = 1.1;

  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.12;

  const subOsc = audioContext.createOscillator();
  subOsc.type = 'sine';
  const subGain = audioContext.createGain();
  subGain.gain.value = definition.audio.subGain;

  const pulseOsc = audioContext.createOscillator();
  pulseOsc.setPeriodicWave(createPulseWave(audioContext));
  const pulseGain = audioContext.createGain();
  pulseGain.gain.value = definition.audio.pulseGain;

  const bodyOsc = audioContext.createOscillator();
  bodyOsc.type = 'sawtooth';
  const bodyGain = audioContext.createGain();
  bodyGain.gain.value = definition.audio.bodyGain;

  const exhaustOsc = audioContext.createOscillator();
  exhaustOsc.type = 'triangle';
  const exhaustGain = audioContext.createGain();
  exhaustGain.gain.value = definition.audio.exhaustGain;

  const raspOsc = audioContext.createOscillator();
  raspOsc.type = 'square';
  const raspGain = audioContext.createGain();
  raspGain.gain.value = definition.audio.raspGain;

  const lopeOsc = audioContext.createOscillator();
  lopeOsc.type = 'sine';
  const lopeGain = audioContext.createGain();
  lopeGain.gain.value = 0;

  const intakeGain = audioContext.createGain();
  intakeGain.gain.value = definition.audio.intakeGain;
  const intakeNoise = createNoiseSource(audioContext);

  const decelGain = audioContext.createGain();
  decelGain.gain.value = 0;
  const decelNoise = createNoiseSource(audioContext);

  const toneDrive = audioContext.createWaveShaper();
  toneDrive.curve = createSoftClipCurve(definition.audio.distortionAmount);
  toneDrive.oversample = '4x';

  const exhaustDrive = audioContext.createWaveShaper();
  exhaustDrive.curve = createSoftClipCurve(definition.audio.distortionAmount + 0.12);
  exhaustDrive.oversample = '4x';

  const raspDrive = audioContext.createWaveShaper();
  raspDrive.curve = createSoftClipCurve(definition.audio.distortionAmount + 0.2);
  raspDrive.oversample = '4x';

  const pulsePan = audioContext.createStereoPanner();
  pulsePan.pan.value = -0.08;
  const bodyPan = audioContext.createStereoPanner();
  bodyPan.pan.value = -0.03;
  const exhaustPan = audioContext.createStereoPanner();
  exhaustPan.pan.value = 0.06;
  const intakePan = audioContext.createStereoPanner();
  intakePan.pan.value = 0.1;
  const raspPan = audioContext.createStereoPanner();
  raspPan.pan.value = 0.04;

  const sampleBus = audioContext.createGain();
  sampleBus.gain.value = 1.45;

  const sampleIdleGain = audioContext.createGain();
  sampleIdleGain.gain.value = 0;
  const sampleLowGain = audioContext.createGain();
  sampleLowGain.gain.value = 0;
  const sampleMidGain = audioContext.createGain();
  sampleMidGain.gain.value = 0;
  const sampleFullGain = audioContext.createGain();
  sampleFullGain.gain.value = 0;
  const sampleIntakeGain = audioContext.createGain();
  sampleIntakeGain.gain.value = 0;
  const sampleDecelGain = audioContext.createGain();
  sampleDecelGain.gain.value = 0;

  sampleIdleGain.connect(sampleBus);
  sampleLowGain.connect(sampleBus);
  sampleMidGain.connect(sampleBus);
  sampleFullGain.connect(sampleBus);
  sampleIntakeGain.connect(sampleBus);
  sampleDecelGain.connect(sampleBus);

  lopeOsc.connect(lopeGain).connect(pulseGain.gain);
  subOsc.connect(subGain).connect(exhaustDrive);
  pulseOsc.connect(pulseGain).connect(pulsePan).connect(toneDrive);
  bodyOsc.connect(bodyGain).connect(bodyFilter).connect(bodyPan).connect(toneDrive);
  exhaustOsc.connect(exhaustGain).connect(exhaustFilter).connect(exhaustPan).connect(exhaustDrive);
  raspOsc.connect(raspGain).connect(raspFilter).connect(raspPan).connect(raspDrive);
  intakeNoise.connect(intakeFilter).connect(intakePan).connect(intakeGain).connect(compressor);
  decelNoise.connect(decelFilter).connect(decelGain).connect(compressor);

  toneDrive.connect(toneFilter);
  exhaustDrive.connect(toneFilter);
  raspDrive.connect(compressor);
  toneFilter.connect(compressor);
  sampleBus.connect(compressor);
  compressor.connect(master).connect(audioContext.destination);

  subOsc.start();
  pulseOsc.start();
  bodyOsc.start();
  exhaustOsc.start();
  raspOsc.start();
  lopeOsc.start();
  intakeNoise.start();
  decelNoise.start();

  return {
    master,
    toneFilter,
    bodyFilter,
    exhaustFilter,
    raspFilter,
    intakeFilter,
    decelFilter,
    subOsc,
    subGain,
    pulseOsc,
    pulseGain,
    bodyOsc,
    bodyGain,
    exhaustOsc,
    exhaustGain,
    raspOsc,
    raspGain,
    lopeOsc,
    lopeGain,
    intakeGain,
    decelGain,
    sampleIdleGain,
    sampleLowGain,
    sampleMidGain,
    sampleFullGain,
    sampleIntakeGain,
    sampleDecelGain,
    samplePlayers: null,
    sampleLayerCount: 0,
    sampleLayerTargetCount: 0
  };
}

function createNoiseSource(audioContext) {
  const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] = Math.random() * 2 - 1;
  }

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

async function loadSampleLayers(audioContext, nodes, definition) {
  const sampleEntries = Object.entries(definition.audio.samples || {});
  if (!sampleEntries.length) {
    return;
  }

  nodes.sampleLayerTargetCount = sampleEntries.length;

  const settledSamples = await Promise.allSettled(
    sampleEntries.map(async ([key, url]) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}`);
      }
      const encoded = await response.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(encoded.slice(0));
      return [key, decoded];
    })
  );

  const buffers = {};
  for (const result of settledSamples) {
    if (result.status === 'fulfilled') {
      const [key, decoded] = result.value;
      buffers[key] = decoded;
      continue;
    }

    console.warn('Engine sample layer failed to load.', result.reason);
  }

  nodes.sampleIdleSource = createLoopSource(audioContext, buffers.idle, nodes.sampleIdleGain);
  nodes.sampleLowSource = createLoopSource(audioContext, buffers.low, nodes.sampleLowGain);
  nodes.sampleMidSource = createLoopSource(audioContext, buffers.mid, nodes.sampleMidGain);
  nodes.sampleFullSource = createLoopSource(audioContext, buffers.full, nodes.sampleFullGain);
  nodes.sampleIntakeSource = createLoopSource(audioContext, buffers.intake, nodes.sampleIntakeGain);
  nodes.sampleDecelSource = createLoopSource(audioContext, buffers.decel, nodes.sampleDecelGain);

  nodes.sampleLayerCount = [
    nodes.sampleIdleSource,
    nodes.sampleLowSource,
    nodes.sampleMidSource,
    nodes.sampleFullSource,
    nodes.sampleIntakeSource,
    nodes.sampleDecelSource
  ].filter(Boolean).length;
  nodes.samplePlayers = nodes.sampleLayerCount > 0;

  if (!nodes.samplePlayers) {
    console.warn('Engine sample layers failed to load, using procedural fallback.');
  }
}

function createLoopSource(audioContext, buffer, destination) {
  if (!buffer || !destination) {
    return null;
  }

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(destination);
  source.start();
  return source;
}

function createSoftClipCurve(amount) {
  const curve = new Float32Array(1024);
  const k = Math.max(1, amount * 40);
  for (let index = 0; index < curve.length; index += 1) {
    const x = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

function createPulseWave(audioContext) {
  const real = new Float32Array(8);
  const imag = new Float32Array(8);
  imag[1] = 1;
  imag[2] = 0.64;
  imag[3] = 0.42;
  imag[4] = 0.25;
  imag[5] = 0.18;
  imag[6] = 0.1;
  imag[7] = 0.06;
  return audioContext.createPeriodicWave(real, imag);
}

function smoothParam(audioParam, value, time, constant) {
  audioParam.cancelScheduledValues(time);
  audioParam.setTargetAtTime(value, time, constant);
}

function smoothPlaybackRate(source, value, time, constant) {
  if (!source?.playbackRate) {
    return;
  }

  smoothParam(source.playbackRate, value, time, constant);
}

function driveEnabledGain(throttle, masterGain) {
  return masterGain * (0.86 + throttle * 0.14);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function bellCurve(value, center, width) {
  const normalized = (value - center) / Math.max(width, 0.0001);
  return Math.exp(-(normalized * normalized) * 0.5);
}

function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001), 0, 1);
  return x * x * (3 - 2 * x);
}

function moveTowards(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) {
    return target;
  }

  return current + Math.sign(target - current) * maxDelta;
}

export { ENGINE_LIBRARY };
