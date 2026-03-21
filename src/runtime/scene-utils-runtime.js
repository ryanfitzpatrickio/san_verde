export function createSceneUtilsRuntime({
  THREE,
  RoundedBoxGeometry,
  config,
  state,
  callbacks
}) {
  const { getStageBehaviorId } = callbacks;

  function createFallbackCar() {
    const group = new THREE.Group();

    const paint = new THREE.MeshPhysicalMaterial({
      color: '#b7c6ff',
      metalness: 0.72,
      roughness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.08
    });

    const glass = new THREE.MeshPhysicalMaterial({
      color: '#d7e6ff',
      transmission: 0.88,
      transparent: true,
      opacity: 0.45,
      roughness: 0.02,
      metalness: 0,
      thickness: 0.18
    });

    const dark = new THREE.MeshStandardMaterial({
      color: '#101820',
      metalness: 0.32,
      roughness: 0.44
    });

    const body = new THREE.Mesh(new RoundedBoxGeometry(2.12, 0.42, 4.7, 6, 0.11), paint);
    body.position.y = 0.74;
    group.add(body);

    const cabin = new THREE.Mesh(new RoundedBoxGeometry(1.62, 0.7, 2.1, 6, 0.12), glass);
    cabin.position.set(0, 1.12, -0.12);
    group.add(cabin);

    const splitter = new THREE.Mesh(new RoundedBoxGeometry(2.02, 0.08, 0.82, 4, 0.04), dark);
    splitter.position.set(0, 0.43, 2.1);
    group.add(splitter);

    const diffuser = new THREE.Mesh(new RoundedBoxGeometry(1.88, 0.08, 0.9, 4, 0.04), dark);
    diffuser.position.set(0, 0.42, -2.06);
    group.add(diffuser);

    return group;
  }

  function focusVehicle(camera, controls, vehicleRoot) {
    camera.far = config.driveCameraFar;
    camera.updateProjectionMatrix();
    controls.minDistance = config.driveCameraMinDistance;
    controls.maxDistance = config.driveCameraMaxDistance;
    vehicleRoot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vehicleRoot);
    if (box.isEmpty()) {
      return;
    }

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    const distance = Math.max(radius * 3.4, 6.5);

    camera.position.set(center.x + distance * 0.72, center.y + radius * 1.15, center.z + distance * 0.96);
    controls.target.copy(center);
    controls.update();
  }

  function focusStage(camera, controls, stage, vehicleRoot) {
    const overviewBounds = stage?.overviewBounds || stage?.cityGraph?.bounds;
    if (!overviewBounds) {
      controls.minDistance = 3.4;
      controls.maxDistance = 24;
      focusVehicle(camera, controls, vehicleRoot);
      return;
    }

    const width = overviewBounds.maxX - overviewBounds.minX;
    const depth = overviewBounds.maxZ - overviewBounds.minZ;
    const span = Math.max(width, depth, 80);
    const isBloomville = stage?.id === 'bloomville';
    const stageCenter = new THREE.Vector3(
      (overviewBounds.minX + overviewBounds.maxX) * 0.5,
      0,
      (overviewBounds.minZ + overviewBounds.maxZ) * 0.5
    );
    const center = stageCenter.clone();

    if (vehicleRoot) {
      vehicleRoot.updateMatrixWorld(true);
      const vehicleBox = new THREE.Box3().setFromObject(vehicleRoot);
      if (!vehicleBox.isEmpty()) {
        const vehicleCenter = vehicleBox.getCenter(new THREE.Vector3());
        center.x = vehicleCenter.x;
        center.y = vehicleCenter.y;
        center.z = vehicleCenter.z;
      }
    }

    camera.far = Math.max(isBloomville ? 50000 : 8000, span * (isBloomville ? 16 : 6.5));
    camera.updateProjectionMatrix();
    controls.minDistance = Math.max(24, span * 0.12);
    controls.maxDistance = Math.max(isBloomville ? 4000 : 520, span * (isBloomville ? 12.5 : 5.2));
    camera.position.set(
      center.x + span * (isBloomville ? 0.55 : 0.32),
      center.y + span * (isBloomville ? 2.8 : 1.95),
      center.z + span * (isBloomville ? 2.05 : 1.22)
    );
    controls.target.copy(center);
    controls.update();
  }

  function shouldUseStageOverview(stageId) {
    stageId = getStageBehaviorId(stageId);
    return stageId === 'city' || stageId === 'bloomville';
  }

  function updateOverviewPan(controls, camera, deltaSeconds) {
    if (state.driveMode || state.characterLoaded || !shouldUseStageOverview(state.selectedStageId)) {
      return;
    }

    const inputX = Number(state.overviewPan.right) - Number(state.overviewPan.left);
    const inputZ = Number(state.overviewPan.backward) - Number(state.overviewPan.forward);
    if (inputX === 0 && inputZ === 0) {
      return;
    }

    const toCamera = new THREE.Vector3().subVectors(camera.position, controls.target);
    const distance = Math.max(toCamera.length(), 1);
    const flatForward = toCamera.clone().setY(0).normalize().multiplyScalar(-1);
    const flatSide = new THREE.Vector3(-flatForward.z, 0, flatForward.x).normalize();
    const panSpeed = Math.max(28, distance * 0.95);
    const move = new THREE.Vector3()
      .addScaledVector(flatSide, inputX * panSpeed * deltaSeconds)
      .addScaledVector(flatForward, inputZ * panSpeed * deltaSeconds);

    camera.position.add(move);
    controls.target.add(move);
    controls.update();
  }

  function clearGroup(group, options = {}) {
    if (!group) {
      return;
    }

    for (const child of [...group.children]) {
      group.remove(child);
      if (options.dispose) {
        disposeObjectTree(child);
      }
    }
  }

  function disposeObjectTree(rootObject, options = {}) {
    const disposeMaterials = options.disposeMaterials ?? true;
    rootObject.traverse((child) => {
      if (child.geometry) {
        child.geometry.dispose();
      }

      if (!disposeMaterials) {
        return;
      }

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) {
          continue;
        }

        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap']) {
          if (material[key]?.isTexture) {
            material[key].dispose();
          }
        }

        material.dispose?.();
      }
    });
  }

  function findObjectByNamePrefix(rootObject, prefix) {
    let match = null;
    rootObject.traverse((child) => {
      if (!match && child.name?.startsWith(prefix)) {
        match = child;
      }
    });
    return match;
  }

  return {
    createFallbackCar,
    focusVehicle,
    focusStage,
    shouldUseStageOverview,
    updateOverviewPan,
    clearGroup,
    disposeObjectTree,
    findObjectByNamePrefix
  };
}
