import * as THREE from 'three';
import { primeCarWheelRuntimeState } from './car-rig-helpers.js';

export function resolveActiveCarTireAssets(state) {
  return {
    front: state.tireAssetsByAxle?.front || state.tireAsset || null,
    rear: state.tireAssetsByAxle?.rear || state.tireAsset || null
  };
}

export function buildMountedCarRig({
  carVehicle,
  rawAsset,
  activeTireAssets,
  stripEmbeddedWheels = false,
  bodyVisualOffsetY = 0
}) {
  const display = carVehicle.mountAsset({
    rawAsset,
    stripEmbeddedWheels: Boolean(stripEmbeddedWheels)
  });
  const wheelMount = new THREE.Group();
  const wheelRadius = carVehicle.remountWheels({
    wheelMount,
    activeTireAssets,
    carMetrics: display.metrics,
    carWheelAnchors: display.anchors,
    embeddedWheelAssets: display.embeddedWheels
  });

  primeCarWheelRuntimeState(wheelMount);

  if (Number.isFinite(bodyVisualOffsetY) && bodyVisualOffsetY !== 0) {
    display.body.position.y += bodyVisualOffsetY;
  }

  return {
    ...display,
    wheelMount,
    wheelRadius
  };
}

export function attachMountedCarRig({ carMount, wheelMount, clearGroup, presentation }) {
  clearGroup(carMount);
  clearGroup(wheelMount);
  carMount.add(presentation.body);
  for (const child of [...presentation.wheelMount.children]) {
    presentation.wheelMount.remove(child);
    wheelMount.add(child);
  }
}
