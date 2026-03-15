import * as THREE from 'three';

export class BaseVehicle {
  constructor({ config, state, helpers }) {
    this.config = config;
    this.state = state;
    this.helpers = helpers;
  }

  createBodyWrapper(rawAsset, { wrapperName, targetSpan }) {
    const asset = rawAsset.clone(true);
    const body = new THREE.Group();
    body.name = wrapperName;
    body.add(asset);
    this.helpers.normalizeToTargetSpan(asset, targetSpan);
    this.helpers.prepareRenderable(body);
    return { asset, body };
  }

  createMountedWheelShell(rawAsset, tireProfile, scale, anchorName, spinSign) {
    const asset = rawAsset.clone(true);
    asset.position.sub(tireProfile.socketPosition || tireProfile.center);

    const wheel = new THREE.Group();
    const spinPivot = new THREE.Group();
    spinPivot.name = `${anchorName}-spin`;
    spinPivot.userData.spinAxis = this.helpers.axisToRotationProperty(tireProfile.widthAxis);
    spinPivot.userData.spinSign = spinSign;
    spinPivot.add(asset);
    spinPivot.add(this.helpers.createWheelSpinMarker(tireProfile.diameter * 0.5, tireProfile.width));
    wheel.add(spinPivot);
    wheel.scale.setScalar(scale);
    wheel.userData.anchorName = anchorName;
    wheel.userData.wheelRadius = tireProfile.diameter * scale * 0.5;
    return { wheel, spinPivot };
  }

  applyRuntimeWheelMetadata() {}
}
