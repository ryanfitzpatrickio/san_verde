import { BaseVehicle } from './base-vehicle.js';
import * as THREE from 'three';

const BIKE_WHEEL_DEBUG_MATERIAL = false;

export class BikeVehicle extends BaseVehicle {
  mountAsset({ rawAsset, rawWheelAsset }) {
    const { body } = this.createBodyWrapper(rawAsset, {
      wrapperName: 'bike-wrapper',
      targetSpan: this.config.bikeTargetSpan
    });
    const anchors = this.collectWheelAnchors(body);
    const steeringRig = this.collectSteeringRig(body, anchors);
    const wheels = new this.helpers.THREE.Group();
    const embeddedWheels = anchors?.length ? this.collectEmbeddedWheels(body, anchors) : null;

    if (embeddedWheels?.length) {
      this.helpers.logBike(
        'embedded:wheels',
        embeddedWheels.map((wheel) => ({
          anchorName: wheel.anchor.name,
          meshName: wheel.mesh.name,
          center: wheel.center.toArray(),
          size: wheel.size.toArray()
        }))
      );

      for (const entry of embeddedWheels) {
        const wheel = this.createEmbeddedWheel(entry);
        this.applySteeringMetadata(wheel, steeringRig, entry.anchor.name);
        this.helpers.prepareRenderable(wheel);
        wheels.add(wheel);
      }
    } else if (rawWheelAsset && anchors?.length) {
      const tireProfile = this.helpers.measureTireProfile(rawWheelAsset);
      const tireScale = tireProfile?.diameter
        ? this.config.bikeReferenceWheelDiameter / tireProfile.diameter
        : 1;
      this.helpers.logBike('display:profile', {
        tireScale,
        tireProfile: tireProfile
          ? {
              diameter: tireProfile.diameter,
              width: tireProfile.width,
              widthAxis: tireProfile.widthAxis,
              center: tireProfile.center.toArray(),
              socketPosition: tireProfile.socketPosition.toArray(),
              alignment: tireProfile.alignment.toArray()
            }
          : null,
        anchors
      });

      for (const anchor of anchors) {
        const wheel = this.createMountedWheel(rawWheelAsset, tireProfile, tireScale, anchor);
        this.applySteeringMetadata(wheel, steeringRig, anchor.name);
        wheel.position.set(...anchor.position);
        this.helpers.prepareRenderable(wheel);
        wheels.add(wheel);
      }
    }

    return {
      body,
      wheels,
      anchors,
      steeringRig,
      metrics: this.helpers.measureObjectBounds(body)
    };
  }

  collectSteeringRig(rootObject, anchors) {
    const primaryFrontObject =
      rootObject.getObjectByName('front') ||
      rootObject.getObjectByName('fork') ||
      rootObject.getObjectByName('handlebar') ||
      rootObject.getObjectByName('handlebars') ||
      this.helpers.findNamedObject(rootObject, /(^front$|fork|handlebar|handlebars|bars?)/i);

    const targets = [];
    let steerAxis = null;
    if (primaryFrontObject) {
      const pivot = this.createSteeringPivot(rootObject, primaryFrontObject, anchors);
      if (pivot) {
        steerAxis = pivot.userData.steerAxis?.clone?.() || null;
        targets.push({
          object: pivot,
          baseQuaternion: pivot.quaternion.clone()
        });
      }
    }

    if (!targets.length) {
      return null;
    }

    return {
      steerScale: this.config.vehicleFeedback?.vehicleKinds?.bike?.frontSteerScale ?? 0.92,
      steerSign: this.config.vehicleFeedback?.vehicleKinds?.bike?.frontSteerSign ?? 1,
      steerAxis,
      targets
    };
  }

  createSteeringPivot(rootObject, targetObject, anchors) {
    if (!targetObject || targetObject.parent === null) {
      return null;
    }

    rootObject.updateMatrixWorld(true);
    targetObject.updateMatrixWorld(true);

    const frontAnchor = anchors?.find((anchor) => anchor.name === 'front-center');
    const rearAnchor = anchors?.find((anchor) => anchor.name === 'rear-center');
    const targetMetrics = this.helpers.measureObjectBounds(targetObject);
    if (!targetMetrics) {
      return null;
    }

    const topWorld = new THREE.Vector3(
      targetMetrics.center.x,
      targetMetrics.max.y,
      targetMetrics.center.z
    );
    const pivotRootLocal = rootObject.worldToLocal(topWorld.clone());

    if (frontAnchor && rearAnchor) {
      pivotRootLocal.z = THREE.MathUtils.lerp(rearAnchor.position[2], frontAnchor.position[2], 0.78);
    }

    const parent = targetObject.parent;
    const pivotWorld = rootObject.localToWorld(pivotRootLocal.clone());
    const pivotLocal = parent.worldToLocal(pivotWorld.clone());
    const targetWorldMatrix = targetObject.matrixWorld.clone();
    const pivot = new THREE.Group();
    pivot.name = `${targetObject.name || 'bike-front'}-steer-pivot`;
    pivot.position.copy(pivotLocal);
    parent.add(pivot);
    pivot.updateMatrixWorld(true);

    parent.remove(targetObject);
    pivot.add(targetObject);
    pivot.updateMatrixWorld(true);

    const pivotInverse = new THREE.Matrix4().copy(pivot.matrixWorld).invert();
    const localMatrix = new THREE.Matrix4().multiplyMatrices(pivotInverse, targetWorldMatrix);
    const localPosition = new THREE.Vector3();
    const localQuaternion = new THREE.Quaternion();
    const localScale = new THREE.Vector3();
    localMatrix.decompose(localPosition, localQuaternion, localScale);

    targetObject.position.copy(localPosition);
    targetObject.quaternion.copy(localQuaternion);
    targetObject.scale.copy(localScale);
    if (frontAnchor) {
      const frontAnchorWorld = rootObject.localToWorld(
        new THREE.Vector3(...frontAnchor.position)
      );
      const steerAxis = pivot.worldToLocal(frontAnchorWorld.clone());
      if (steerAxis.lengthSq() > 1e-6) {
        steerAxis.normalize();
        pivot.userData.steerAxis = steerAxis;
      }
    }
    return pivot;
  }

  applySteeringMetadata(wheel, steeringRig, anchorName) {
    if (!wheel?.isObject3D || !String(anchorName).includes('front')) {
      return;
    }
    if (steeringRig?.steerAxis) {
      wheel.userData.steerAxis = steeringRig.steerAxis.clone();
    }
    if (typeof steeringRig?.steerSign === 'number') {
      wheel.userData.steerSign = steeringRig.steerSign;
    }
  }

  collectEmbeddedWheels(rootObject, anchors) {
    const namedFront =
      rootObject.getObjectByName('front_wheel') ||
      rootObject.getObjectByName('front-wheel') ||
      this.helpers.findNamedObject(rootObject, /^front[_ -]?wheel$/i);
    const namedRear =
      rootObject.getObjectByName('rear_wheel') ||
      rootObject.getObjectByName('rear-wheel') ||
      rootObject.getObjectByName('back_wheel') ||
      rootObject.getObjectByName('back-wheel') ||
      this.helpers.findNamedObject(rootObject, /^(rear|back)[_ -]?wheel$/i);

    if (namedFront?.isMesh && namedRear?.isMesh) {
      return [
        this.createEmbeddedWheelEntry(rootObject, anchors.find((anchor) => anchor.name === 'front-center'), namedFront),
        this.createEmbeddedWheelEntry(rootObject, anchors.find((anchor) => anchor.name === 'rear-center'), namedRear)
      ].filter(Boolean);
    }

    const candidates = [];
    rootObject.updateMatrixWorld(true);

    rootObject.traverse((child) => {
      if (!child.isMesh || child.name?.startsWith('Locator_')) {
        return;
      }

      const bounds = this.helpers.measureObjectBounds(child);
      if (!bounds) {
        return;
      }

      const axisSizes = [bounds.size.x, bounds.size.y, bounds.size.z].sort((a, b) => b - a);
      const largest = axisSizes[0];
      const second = axisSizes[1];
      const smallest = axisSizes[2];

      if (largest < 0.2 || smallest < 0.02) {
        return;
      }

      // Wheel-like meshes are roughly circular in two axes and thinner in the third.
      if (second / largest < 0.55 || smallest / largest > 0.8) {
        return;
      }

      candidates.push({
        mesh: child,
        bounds,
        center: bounds.center,
        size: bounds.size
      });
    });

    if (candidates.length < 2) {
      return null;
    }

    const used = new Set();
    const embedded = [];

    for (const anchor of anchors) {
      const anchorVector = new THREE.Vector3(...anchor.position);
      let best = null;
      let bestScore = Infinity;

      for (const candidate of candidates) {
        if (used.has(candidate.mesh.uuid)) {
          continue;
        }

        const distance = candidate.center.distanceTo(anchorVector);
        if (distance < bestScore) {
          best = candidate;
          bestScore = distance;
        }
      }

      if (!best) {
        continue;
      }

      used.add(best.mesh.uuid);
      embedded.push({
        anchor,
        mesh: best.mesh,
        center: best.center,
        size: best.size,
        rootObject
      });
    }

    return embedded.length === anchors.length ? embedded : null;
  }

  createEmbeddedWheelEntry(rootObject, anchor, mesh) {
    if (!anchor || !mesh) {
      return null;
    }

    const bounds = this.helpers.measureObjectBounds(mesh);
    if (!bounds) {
      return null;
    }

    rootObject.updateMatrixWorld(true);
    mesh.updateMatrixWorld(true);
    const rootInverse = new THREE.Matrix4().copy(rootObject.matrixWorld).invert();
    const meshLocalMatrix = new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld);
    const localPosition = new THREE.Vector3();
    const localQuaternion = new THREE.Quaternion();
    const localScale = new THREE.Vector3();
    meshLocalMatrix.decompose(localPosition, localQuaternion, localScale);

    return {
      anchor,
      mesh,
      center: bounds.center,
      size: bounds.size,
      rootObject,
      localPosition,
      localQuaternion,
      localScale
    };
  }

  collectWheelAnchors(rootObject) {
    rootObject.updateMatrixWorld(true);
    const frontLocator =
      rootObject.getObjectByName('Locator_Front_tire') ||
      this.helpers.findNamedObject(rootObject, /locator.*front.*tire|front.*tire/i);
    const rearLocator =
      rootObject.getObjectByName('Locator_Back_tire') ||
      this.helpers.findNamedObject(rootObject, /locator.*(back|rear).*tire|(back|rear).*tire/i);

    if (!frontLocator || !rearLocator) {
      return null;
    }

    const anchors = [
      {
        name: 'front-center',
        position: rootObject.worldToLocal(frontLocator.getWorldPosition(new this.helpers.THREE.Vector3())).toArray()
      },
      {
        name: 'rear-center',
        position: rootObject.worldToLocal(rearLocator.getWorldPosition(new this.helpers.THREE.Vector3())).toArray()
      }
    ];

    const frontOffset = this.state.bikeFrontWheelOffset || this.config.bikeFrontWheelOffset;
    if (frontOffset) {
      anchors[0].position[0] += frontOffset.x;
      anchors[0].position[1] += frontOffset.y;
      anchors[0].position[2] += frontOffset.z;
    }

    const rearOffset = this.state.bikeRearWheelOffset || this.config.bikeRearWheelOffset;
    if (rearOffset) {
      anchors[1].position[0] += rearOffset.x;
      anchors[1].position[1] += rearOffset.y;
      anchors[1].position[2] += rearOffset.z;
    }

    this.helpers.logBike('anchors', anchors);
    return anchors;
  }

  createEmbeddedWheel(entry) {
    const wheel = new THREE.Group();
    const spinPivot = new THREE.Group();
    const clone = entry.mesh.clone(true);
    const tireProfile = this.helpers.measureTireProfile(entry.mesh);
    const offset = entry.anchor.name.includes('front')
      ? this.state.bikeFrontWheelOffset || this.config.bikeFrontWheelOffset
      : this.state.bikeRearWheelOffset || this.config.bikeRearWheelOffset;
    const rotation = entry.anchor.name.includes('front')
      ? this.state.bikeFrontWheelRotation || this.config.bikeFrontWheelRotation
      : this.state.bikeRearWheelRotation || this.config.bikeRearWheelRotation;

    clone.position.set(0, 0, 0);
    clone.quaternion.identity();
    clone.scale.copy(entry.localScale);
    spinPivot.quaternion.copy(entry.localQuaternion).multiply(
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rotation[0], rotation[1], rotation[2])
      )
    );

    entry.mesh.visible = false;

    spinPivot.name = `${entry.anchor.name}-spin`;
    spinPivot.userData.spinAxis = this.helpers.axisToRotationProperty(tireProfile?.widthAxis ?? 2);
    spinPivot.userData.spinSign = 1;
    spinPivot.add(clone);
    wheel.position.copy(entry.localPosition);
    if (offset) {
      wheel.position.add(offset);
    }
    wheel.add(spinPivot);
    wheel.userData.baseQuaternion = wheel.quaternion.clone();
    wheel.userData.anchorName = entry.anchor.name;
    wheel.userData.wheelRadius = Math.max(entry.size.y, entry.size.z) * 0.5;
    wheel.userData.canSteer = entry.anchor.name.includes('front');
    wheel.userData.steerSign = this.config.vehicleFeedback?.vehicleKinds?.bike?.frontSteerSign ?? 1;
    wheel.userData.steerScale = this.config.vehicleFeedback?.vehicleKinds?.bike?.frontSteerScale ?? 0.92;
    return wheel;
  }

  createMountedWheel(rawAsset, tireProfile, scale, anchor) {
    const { wheel, spinPivot } = this.createMountedWheelShell(
      rawAsset,
      tireProfile,
      scale,
      anchor.name,
      1
    );
    const assetRoot = spinPivot.children[0];

    spinPivot.userData.spinAxis = this.helpers.axisToRotationProperty(tireProfile.widthAxis);

    if (BIKE_WHEEL_DEBUG_MATERIAL) {
      const assetRoot = spinPivot.children[0];
      assetRoot?.traverse?.((child) => {
        if (!child.isMesh) {
          return;
        }
        const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
        const debugMaterials = sourceMaterials.map((sourceMaterial) => {
          const nextMaterial = sourceMaterial?.clone?.() || sourceMaterial;
          if (!nextMaterial) {
            return nextMaterial;
          }
          if ('color' in nextMaterial) {
            nextMaterial.color.set('#00ff66');
          }
          if ('emissive' in nextMaterial) {
            nextMaterial.emissive.set('#00ff55');
            nextMaterial.emissiveIntensity = 0.9;
          }
          if ('roughness' in nextMaterial) {
            nextMaterial.roughness = 0.18;
          }
          if ('metalness' in nextMaterial) {
            nextMaterial.metalness = 0.08;
          }
          return nextMaterial;
        });
        child.material = Array.isArray(child.material) ? debugMaterials : debugMaterials[0];
      });
    }

    const rotation = anchor.name.includes('front')
      ? this.state.bikeFrontWheelRotation || this.config.bikeFrontWheelRotation
      : this.state.bikeRearWheelRotation || this.config.bikeRearWheelRotation;
    if (assetRoot?.isObject3D) {
      assetRoot.quaternion.multiply(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rotation[0], rotation[1], rotation[2])
        )
      );
    }
    wheel.quaternion.copy(tireProfile.alignment);
    wheel.userData.baseQuaternion = wheel.quaternion.clone();
    wheel.userData.canSteer = anchor.name.includes('front');
    wheel.userData.steerSign = this.config.vehicleFeedback?.vehicleKinds?.bike?.frontSteerSign ?? 1;
    wheel.userData.steerScale = this.config.vehicleFeedback?.vehicleKinds?.bike?.frontSteerScale ?? 0.92;
    this.helpers.logBike('wheel:mounted', {
      anchorName: anchor.name,
      anchorPosition: anchor.position,
      wheelQuaternion: wheel.quaternion.toArray(),
      baseQuaternion: wheel.userData.baseQuaternion.toArray(),
      spinAxis: spinPivot.userData.spinAxis,
      spinSign: spinPivot.userData.spinSign
    });
    return wheel;
  }

  applyRuntimeWheelMetadata(wheelRoot) {
    if (!wheelRoot?.children?.length) {
      return;
    }

    for (const wheel of wheelRoot.children) {
      if (!wheel?.isObject3D) {
        continue;
      }

      const anchorName = String(wheel.userData.anchorName || '');
      const isFront = anchorName.includes('front');
      const physicsProfile = isFront
        ? {
            driven: false,
            brakeBias: 0.68,
            corneringStiffness: 2380,
            suspensionFrequency: 1.42,
            suspensionDamping: 0.82,
            maxSuspensionForce: 12000,
            frictionSlip: 2.35,
            sideFrictionStiffness: 1.6
          }
        : {
            driven: true,
            brakeBias: 0.32,
            corneringStiffness: 1120,
            suspensionFrequency: 1.38,
            suspensionDamping: 0.8,
            maxSuspensionForce: 13800,
            frictionSlip: 1.82,
            sideFrictionStiffness: 1.05
          };

      wheel.userData.vehiclePhysics = {
        kind: 'bike',
        ...physicsProfile
      };
    }
  }
}
