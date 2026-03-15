import * as THREE from 'three';

import { BaseVehicle } from './base-vehicle.js';

export class CarVehicle extends BaseVehicle {
  mountAsset({ rawAsset }) {
    const { body } = this.createBodyWrapper(rawAsset, {
      wrapperName: 'car-wrapper',
      targetSpan: this.config.targetSpan
    });
    const doorRig = this.helpers.createDoorRig(body);
    const steeringWheelRig =
      this.helpers.collectSteeringWheelRig(body) || this.helpers.mountSteeringWheelAttachment(body);

    return {
      body,
      doorRig,
      steeringWheelRig,
      metrics: this.helpers.measureObjectBounds(body),
      anchors: this.helpers.collectWheelAnchors(body)
    };
  }

  remountWheels({ wheelMount, activeTireAssets, carMetrics, carWheelAnchors }) {
    this.helpers.clearGroup(wheelMount);

    if (!activeTireAssets.front && !activeTireAssets.rear) {
      this.state.wheelRadius = 0.42;

      const fallbackProfile = {
        diameter: this.state.wheelRadius * 2,
        width: 0.34
      };
      const wheelLayout = this.deriveWheelLayout(carMetrics, fallbackProfile, carWheelAnchors);

      for (const anchor of wheelLayout.anchors) {
        const wheel = this.helpers.createFallbackMountedWheel(wheelLayout.scale, anchor);
        wheel.position.set(...anchor.position);
        this.helpers.prepareRenderable(wheel);
        wheelMount.add(wheel);
      }

      return this.state.wheelRadius;
    }

    const frontProfile = activeTireAssets.front ? this.helpers.measureTireProfile(activeTireAssets.front) : null;
    const rearProfile = activeTireAssets.rear ? this.helpers.measureTireProfile(activeTireAssets.rear) : frontProfile;
    const baseProfile = frontProfile || rearProfile;
    const wheelLayout = this.deriveWheelLayout(carMetrics, baseProfile, carWheelAnchors);
    const frontScale = frontProfile?.diameter
      ? (this.config.referenceWheelDiameter / frontProfile.diameter) * this.state.tireScale
      : wheelLayout.scale;
    const rearScale = rearProfile?.diameter
      ? (this.config.referenceWheelDiameter / rearProfile.diameter) * this.state.tireScale
      : wheelLayout.scale;
    const frontRadius = frontProfile ? frontProfile.diameter * frontScale * 0.5 : 0;
    const rearRadius = rearProfile ? rearProfile.diameter * rearScale * 0.5 : frontRadius;
    this.state.wheelRadius = frontRadius && rearRadius
      ? (frontRadius + rearRadius) * 0.5
      : frontRadius || rearRadius || 0.42;

    for (const anchor of wheelLayout.anchors) {
      const useFrontTire = anchor.name.includes('front');
      const rawAsset = useFrontTire
        ? activeTireAssets.front || activeTireAssets.rear
        : activeTireAssets.rear || activeTireAssets.front;
      const tireProfile = useFrontTire ? frontProfile || rearProfile : rearProfile || frontProfile;
      const tireScale = useFrontTire ? frontScale : rearScale;
      const wheel = this.createMountedWheel(rawAsset, tireProfile, tireScale, anchor);
      wheel.position.set(...anchor.position);
      this.helpers.prepareRenderable(wheel);
      wheelMount.add(wheel);
    }

    return this.state.wheelRadius;
  }

  deriveWheelLayout(carMetrics, tireProfile, carWheelAnchors) {
    const anchorOverride = this.getWheelAnchorOverride(carWheelAnchors);

    if (!carMetrics || !tireProfile || tireProfile.diameter <= 0) {
      return {
        anchors: anchorOverride || this.config.manualWheelAnchors,
        scale: this.state.tireScale
      };
    }

    if (anchorOverride) {
      return {
        anchors: anchorOverride.map((anchor) => ({
          name: anchor.name,
          position: [...anchor.position]
        })),
        scale: (this.config.referenceWheelDiameter / tireProfile.diameter) * this.state.tireScale
      };
    }

    const targetDiameter = Math.min(
      carMetrics.size.z * this.config.targetWheelDiameterRatios.length,
      carMetrics.size.x * this.config.targetWheelDiameterRatios.width,
      carMetrics.size.y * this.config.targetWheelDiameterRatios.height
    );
    const autoScale = targetDiameter / tireProfile.diameter;
    const scale = autoScale * this.state.tireScale;
    const scaledWidth = tireProfile.width * scale;
    const scaledDiameter = tireProfile.diameter * scale;
    const wheelY = carMetrics.min.y + scaledDiameter * 0.5 + this.state.rideHeight;
    const sideInset = carMetrics.size.x * this.state.sideInset;
    const leftX = carMetrics.max.x - sideInset - scaledWidth * 0.18;
    const rightX = carMetrics.min.x + sideInset + scaledWidth * 0.18;
    const frontZ = carMetrics.max.z - carMetrics.size.z * this.state.frontAxleRatio;
    const rearZ = carMetrics.min.z + carMetrics.size.z * this.state.rearAxleRatio;

    return {
      scale,
      anchors: [
        { name: 'front-left', position: [leftX, wheelY, frontZ] },
        { name: 'front-right', position: [rightX, wheelY, frontZ] },
        { name: 'rear-left', position: [leftX, wheelY, rearZ] },
        { name: 'rear-right', position: [rightX, wheelY, rearZ] }
      ]
    };
  }

  getWheelAnchorOverride(carWheelAnchors) {
    if (carWheelAnchors?.length === 4) {
      return carWheelAnchors;
    }

    return this.state.selectedBuiltInCarId ? this.config.manualWheelAnchors : null;
  }

  createMountedWheel(rawAsset, tireProfile, scale, anchor) {
    const { wheel, spinPivot } = this.createMountedWheelShell(
      rawAsset,
      tireProfile,
      scale,
      anchor.name,
      anchor.name.includes('left') ? -1 : 1
    );

    wheel.quaternion.copy(tireProfile.alignment);
    wheel.quaternion.multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...this.state.tireRotation))
    );

    if (anchor.name.includes('right')) {
      wheel.rotateX(Math.PI);
    }

    wheel.userData.baseQuaternion = wheel.quaternion.clone();
    wheel.userData.canSteer = anchor.name.includes('front');
    wheel.userData.steerSign = anchor.name.includes('right') ? -1 : 1;
    spinPivot.userData.spinSign = anchor.name.includes('left') ? -1 : 1;
    return wheel;
  }
}
