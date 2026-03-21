import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { mrt, normalView, output, pass, renderOutput } from 'three/tsl';
import { normalizeWheelAnchorName } from './vehicles/vehicle-orientation.js';

export function createSceneHelpers({ state, ui, config }) {
  function mountSteeringWheelAttachment(rootObject) {
    if (!rootObject || !state.steeringWheelAsset) {
      return null;
    }

    const steeringLocator =
      rootObject.getObjectByName('Locator_Steering') ||
      findNamedObject(rootObject, /^locator[_ ]steering$/i) ||
      findNamedObject(rootObject, /locator.*steering|steering.*locator/i);
    const embeddedWheel =
      rootObject.getObjectByName('steering_wheel') ||
      findNamedObject(rootObject, /^steering[_ ]wheel$/i) ||
      findNamedObject(rootObject, /steering[_ ]wheel|wheel.*steering/i);

    if (!steeringLocator || embeddedWheel) {
      return null;
    }

    const wheel = state.steeringWheelAsset.clone(true);
    wheel.name = 'steering-wheel-attachment';
    const wheelMetrics = measureObjectBounds(wheel);
    if (wheelMetrics) {
      wheel.position.sub(wheelMetrics.center);
    } else {
      wheel.position.set(0, 0, 0);
    }
    wheel.quaternion.setFromEuler(new THREE.Euler(...config.steeringWheelRotation));
    steeringLocator.updateWorldMatrix(true, false);
    const parentWorldScale = steeringLocator.getWorldScale(new THREE.Vector3());
    const parentScale = Math.max(parentWorldScale.x, parentWorldScale.y, parentWorldScale.z, 1e-6);
    const rawDiameter = wheelMetrics ? Math.max(wheelMetrics.size.x, wheelMetrics.size.y) : 1;
    const localScale = config.steeringWheelDiameter / rawDiameter / parentScale;
    wheel.scale.setScalar(localScale);
    prepareRenderable(wheel);
    steeringLocator.add(wheel);
    return createSteeringWheelRig(wheel);
  }

  function collectSteeringWheelRig(rootObject) {
    const steeringWheel =
      rootObject.getObjectByName('steering_wheel') ||
      findNamedObject(rootObject, /^steering[_ ]wheel$/i) ||
      findNamedObject(rootObject, /steering[_ ]wheel|wheel.*steering/i);

    if (!steeringWheel) {
      return null;
    }

    return createSteeringWheelRig(steeringWheel);
  }

  function createSteeringWheelRig(object) {
    const axis = inferObjectLocalThinAxis(object);
    return {
      object,
      baseQuaternion: object.quaternion.clone(),
      turnAxis: axisToVector(axis)
    };
  }

  function applySteeringWheelState() {
    if (!state.steeringWheelRig?.object) {
      return;
    }

    const rig = state.steeringWheelRig;
    const turnQuaternion = new THREE.Quaternion().setFromAxisAngle(
      rig.turnAxis,
      state.steerAngle * config.steeringWheelTurnRatio
    );
    rig.object.quaternion.copy(rig.baseQuaternion).multiply(turnQuaternion);
  }

  function normalizeToTargetSpan(object, targetSpan) {
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) {
      return;
    }

    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const horizontalSpan = Math.max(size.x, size.z);
    const scale = horizontalSpan > 0 ? targetSpan / horizontalSpan : 1;

    object.position.sub(center);
    object.scale.multiplyScalar(scale);
    object.updateMatrixWorld(true);

    const fittedBounds = new THREE.Box3().setFromObject(object);
    object.position.y -= fittedBounds.min.y;
  }

  function measureObjectBounds(object) {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) {
      return null;
    }
    return {
      box,
      size: box.getSize(new THREE.Vector3()),
      center: box.getCenter(new THREE.Vector3()),
      min: box.min.clone(),
      max: box.max.clone()
    };
  }

  function measureTireProfile(rootObject) {
    const metrics = measureObjectBounds(rootObject);
    if (!metrics) {
      return null;
    }

    const axisSizes = [metrics.size.x, metrics.size.y, metrics.size.z];
    const widthAxis = axisSizes.indexOf(Math.min(...axisSizes));
    const diameterAxes = [0, 1, 2].filter((axis) => axis !== widthAxis);
    const diameter = Math.max(axisSizes[diameterAxes[0]], axisSizes[diameterAxes[1]]);
    const width = axisSizes[widthAxis];
    const alignment = new THREE.Quaternion().setFromUnitVectors(
      axisToVector(widthAxis),
      new THREE.Vector3(1, 0, 0)
    );

    return {
      center: metrics.center,
      socketPosition: collectTireSocketPosition(rootObject) || metrics.center,
      diameter,
      width,
      widthAxis,
      alignment
    };
  }

  function createFallbackMountedWheel(scale, anchor) {
    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.34, 40, 1),
      new THREE.MeshStandardMaterial({
        color: '#111317',
        roughness: 0.84,
        metalness: 0.06
      })
    );
    tire.rotation.z = Math.PI / 2;

    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.36, 28, 1),
      new THREE.MeshStandardMaterial({
        color: '#a9b4c4',
        roughness: 0.36,
        metalness: 0.78
      })
    );
    rim.rotation.z = Math.PI / 2;

    const spinPivot = new THREE.Group();
    spinPivot.name = `${anchor.name}-spin`;
    spinPivot.userData.spinAxis = 'x';
    spinPivot.add(tire, rim);
    spinPivot.add(createWheelSpinMarker(0.42, 0.34));

    const wheel = new THREE.Group();
    wheel.add(spinPivot);
    wheel.scale.setScalar(scale);
    wheel.userData.baseQuaternion = wheel.quaternion.clone();
    wheel.userData.canSteer = anchor.name.includes('front');
    wheel.userData.steerSign = anchor.name.includes('right') ? -1 : 1;
    spinPivot.userData.spinSign = anchor.name.includes('left') ? -1 : 1;
    return wheel;
  }

  function createWheelSpinMarker(radius, width) {
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(
        Math.max(width * 0.2, 0.035),
        Math.max(radius * 0.32, 0.08),
        Math.max(width * 0.08, 0.02)
      ),
      new THREE.MeshStandardMaterial({
        color: '#ff5a36',
        emissive: '#ff5a36',
        emissiveIntensity: 1.4,
        roughness: 0.38,
        metalness: 0.12
      })
    );
    marker.position.set(0, radius * 0.72, 0);
    marker.castShadow = true;
    marker.receiveShadow = true;
    return marker;
  }

  function collectWheelAnchors(rootObject) {
    const anchors = new Map();
    rootObject.updateMatrixWorld(true);
    rootObject.traverse((child) => {
      if (child === rootObject || !child.name) {
        return;
      }
      const key = normalizeWheelAnchorName(child.name);
      if (!key || anchors.has(key)) {
        return;
      }
      const position = child.getWorldPosition(new THREE.Vector3());
      anchors.set(key, rootObject.worldToLocal(position));
    });

    const orderedKeys = ['front-left', 'front-right', 'rear-left', 'rear-right'];
    if (!orderedKeys.every((key) => anchors.has(key))) {
      return null;
    }

    return orderedKeys.map((key) => ({
      name: key,
      position: anchors.get(key).toArray()
    }));
  }

  function collectTireSocketPosition(rootObject) {
    let socket = null;
    rootObject.traverse((child) => {
      if (!socket && child.name && /socket/i.test(child.name)) {
        socket = child.position.clone();
      }
    });
    return socket;
  }

  function createDoorRig(rootObject) {
    rootObject.updateMatrixWorld(true);
    const hinge =
      rootObject.getObjectByName('Locator_Door_Hinge') ||
      findNamedObject(rootObject, /locator.*door.*hinge|door.*hinge|hinge.*door/i);
    const door = findDoorObject(rootObject);
    const driverWindow = findNamedObject(rootObject, /window.*driver|driver.*window/i);

    if (!hinge || !door || !door.parent) {
      return null;
    }

    const originalParent = door.parent;
    const pivot = new THREE.Group();
    pivot.name = 'door-hinge-pivot';
    pivot.position.copy(originalParent.worldToLocal(hinge.getWorldPosition(new THREE.Vector3())));
    originalParent.add(pivot);
    pivot.updateMatrixWorld(true);
    pivot.attach(door);
    if (driverWindow) {
      pivot.attach(driverWindow);
    }
    pivot.userData.closedQuaternion = pivot.quaternion.clone();

    const hingeWorld = hinge.getWorldPosition(new THREE.Vector3());
    const doorWorldCenter = door.getWorldPosition(new THREE.Vector3());
    const openDirection = doorWorldCenter.x < hingeWorld.x ? -1 : 1;

    return {
      pivot,
      openDirection,
      maxAngle: Math.PI * 0.5
    };
  }

  function findDoorObject(rootObject) {
    let match = null;
    rootObject.traverse((child) => {
      if (match || !child.name) {
        return;
      }
      if ((child.isMesh || child.children.length > 0) && /(driver.*door|door.*driver|^door$)/i.test(child.name)) {
        match = child;
      }
    });
    return match;
  }

  function findNamedObject(rootObject, pattern) {
    let match = null;
    rootObject.traverse((child) => {
      if (!match && child.name && pattern.test(child.name)) {
        match = child;
      }
    });
    return match;
  }

  function prepareRenderable(rootObject) {
    rootObject.traverse((child) => {
      if (!child.isMesh) {
        return;
      }

      if (isInteriorCollisionExclusion(child)) {
        child.userData.noCollision = true;
        child.userData.noSuspension = true;
        child.userData.noGround = true;
      }

      if (isWindowMesh(child) && !child.userData.windowGlassPrepared) {
        child.material = cloneMaterialSet(child.material);
        child.userData.windowGlassPrepared = true;
      }

      child.castShadow = true;
      child.receiveShadow = true;

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) {
          continue;
        }

        if ('envMapIntensity' in material) {
          material.envMapIntensity = state.environmentIntensity;
        }
        if ('roughness' in material && material.roughness < 0.03) {
          material.roughness = 0.03;
        }
        if ('clearcoat' in material && material.clearcoat < 0.2) {
          material.clearcoat = 0.2;
        }
        if (isWindowMesh(child)) {
          applyWindowMaterialState(material);
        }
        material.needsUpdate = true;
      }
    });
  }

  function applySceneMaterialState(carMount, wheelMount) {
    for (const container of [carMount, wheelMount]) {
      container.traverse((child) => {
        if (!child.isMesh) {
          return;
        }

        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          if (!material) {
            continue;
          }

          if (isWindowMesh(child)) {
            applyWindowMaterialState(material);
            material.needsUpdate = true;
            continue;
          }

          if ('envMapIntensity' in material) {
            material.envMapIntensity = state.environmentIntensity;
          }
          if ('clearcoat' in material && material.clearcoat < 0.35) {
            material.clearcoat = 0.35;
          }
          if ('clearcoatRoughness' in material && material.clearcoatRoughness > 0.18) {
            material.clearcoatRoughness = 0.18;
          }
          if ('anisotropy' in material && material.anisotropy < 0.12) {
            material.anisotropy = 0.12;
          }
          material.needsUpdate = true;
        }
      });
    }
  }

  function isWindowMesh(mesh) {
    return Boolean(mesh?.name) && /windshield|window(_driver|_passenger|_top)?|glass/i.test(mesh.name);
  }

  function isInteriorCollisionExclusion(mesh) {
    return Boolean(mesh?.name) && /^interior$/i.test(String(mesh.name).trim());
  }

  function cloneMaterialSet(material) {
    if (Array.isArray(material)) {
      return material.map((entry) => entry?.clone?.() || entry);
    }
    return material?.clone?.() || material;
  }

  function applyWindowMaterialState(material) {
    if ('color' in material) {
      material.color.set('#171a1f');
    }
    if ('envMapIntensity' in material) {
      material.envMapIntensity = Math.max(state.environmentIntensity * 1.7, 1.5);
    }
    if ('metalness' in material) {
      material.metalness = 0;
    }
    if ('roughness' in material) {
      material.roughness = 0.03;
    }
    if ('clearcoat' in material) {
      material.clearcoat = 1;
    }
    if ('clearcoatRoughness' in material) {
      material.clearcoatRoughness = 0.03;
    }
    if ('ior' in material) {
      material.ior = 1.52;
    }
    if ('transmission' in material) {
      material.transmission = 0.52;
    }
    if ('thickness' in material) {
      material.thickness = 0.22;
    }
    if ('attenuationColor' in material) {
      material.attenuationColor.set('#0a0b0d');
    }
    if ('attenuationDistance' in material) {
      material.attenuationDistance = 0.32;
    }
    material.transparent = true;
    material.opacity = 0.72;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
  }

  function createRenderPipeline(renderer, scene, camera) {
    const renderPipeline = new THREE.RenderPipeline(renderer);
    renderPipeline.outputColorTransform = false;

    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, normal: normalView }));

    const sceneColor = scenePass.getTextureNode('output');
    const depthNode = scenePass.getTextureNode('depth');
    const normalNode = scenePass.getTextureNode('normal');
    const ssgiPass = ssgi(sceneColor, depthNode, normalNode, camera);
    ssgiPass.radius.value = config.dynamicGiRadius;
    ssgiPass.thickness.value = 1.5;
    ssgiPass.sliceCount.value = config.dynamicGiSliceCount;
    ssgiPass.stepCount.value = config.dynamicGiStepCount;
    ssgiPass.giIntensity.value = config.dynamicGiIntensity;
    ssgiPass.aoIntensity.value = config.dynamicAoIntensity;
    ssgiPass.useTemporalFiltering = false;

    const originalSetSize = ssgiPass.setSize.bind(ssgiPass);
    ssgiPass.setSize = (width, height) =>
      originalSetSize(
        Math.max(1, Math.round(width * config.dynamicGiResolutionScale)),
        Math.max(1, Math.round(height * config.dynamicGiResolutionScale))
      );

    const aoComposite = ssgiPass.w.mul(config.dynamicAoCompositeIntensity).add(1 - config.dynamicAoCompositeIntensity);
    const giComposite = sceneColor.mul(aoComposite).add(ssgiPass.xyz.mul(config.dynamicGiCompositeIntensity));
    const tonedOutput = renderOutput(giComposite, renderer.toneMapping, renderer.outputColorSpace);

    renderPipeline.outputNode = fxaa(tonedOutput);
    renderPipeline.needsUpdate = true;
    return renderPipeline;
  }

  function createLightingRig() {
    const rig = new THREE.Group();
    const hemi = new THREE.HemisphereLight('#cfe2ff', '#39506b', 0.42);
    const ambient = new THREE.AmbientLight('#dce7f5', 0.05);
    const key = new THREE.DirectionalLight('#fff2cf', 6.4);
    key.position.set(32, 42, 18);
    key.castShadow = true;
    key.shadow.mapSize.setScalar(config.shadowMapSize);
    key.shadow.bias = -0.00012;
    key.shadow.normalBias = 0.035;
    key.shadow.radius = 1.6;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 140;
    key.shadow.camera.left = -62;
    key.shadow.camera.right = 62;
    key.shadow.camera.top = 62;
    key.shadow.camera.bottom = -62;
    key.target.position.set(0, 0.5, -28);

    const fill = new THREE.SpotLight('#8ab3ff', 28, 44, Math.PI * 0.18, 0.34, 1.15);
    fill.position.set(-8, 4.5, 8);
    fill.target.position.set(0, 0.9, 0);

    const rim = new THREE.SpotLight('#7fe8ff', 22, 28, Math.PI * 0.2, 0.35, 1.5);
    rim.position.set(0, 5.8, -9);
    rim.target.position.set(0, 0.8, 0);

    const overheadCard = new THREE.Mesh(
      new THREE.PlaneGeometry(3.8, 1.6),
      new THREE.MeshBasicMaterial({
        color: '#f5fbff',
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide
      })
    );
    overheadCard.position.set(0, 4.8, 0.2);
    overheadCard.rotation.x = Math.PI / 2;

    const sideCard = overheadCard.clone();
    sideCard.scale.set(0.6, 1.2, 1);
    sideCard.position.set(-3.2, 2.35, -0.8);
    sideCard.rotation.set(0, Math.PI / 2.8, 0);

    rig.add(hemi, ambient, key, key.target, fill, fill.target, rim, rim.target, overheadCard, sideCard);
    rig.userData.lights = { hemi, ambient, key, fill, rim, overheadCard, sideCard };
    return rig;
  }

  function createSkyRig(pmrem) {
    const skyTexture = createSkyDomeTexture();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(9000, 48, 32),
      new THREE.MeshBasicMaterial({
        map: skyTexture,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false
      })
    );
    const skyScene = new THREE.Scene();
    skyScene.add(sky.clone());
    const environment = pmrem.fromScene(skyScene, 0.18);
    return { sky, environment };
  }

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

  function createSkyDomeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const context = canvas.getContext('2d');

    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#5a89c6');
    gradient.addColorStop(0.42, '#9ec3ea');
    gradient.addColorStop(0.72, '#dbe8f7');
    gradient.addColorStop(1, '#eef1e5');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const sun = context.createRadialGradient(canvas.width * 0.72, canvas.height * 0.24, 18, canvas.width * 0.72, canvas.height * 0.24, 120);
    sun.addColorStop(0, 'rgba(255, 247, 214, 0.95)');
    sun.addColorStop(0.34, 'rgba(255, 234, 174, 0.42)');
    sun.addColorStop(1, 'rgba(255, 234, 174, 0)');
    context.fillStyle = sun;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = 'rgba(255, 255, 255, 0.18)';
    for (let index = 0; index < 12; index += 1) {
      const x = 40 + Math.random() * (canvas.width - 180);
      const y = 44 + Math.random() * 120;
      const width = 90 + Math.random() * 160;
      const height = 18 + Math.random() * 24;
      context.beginPath();
      context.ellipse(x, y, width, height, 0, 0, Math.PI * 2);
      context.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function focusVehicle(camera, controls, vehicleRoot) {
    camera.far = 120;
    camera.updateProjectionMatrix();
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
    if (stage?.id !== 'city') {
      controls.minDistance = 3.4;
      controls.maxDistance = 24;
      focusVehicle(camera, controls, vehicleRoot);
      return;
    }

    const bounds = stage.cityGraph?.bounds;
    if (!bounds) {
      controls.minDistance = 3.4;
      controls.maxDistance = 24;
      focusVehicle(camera, controls, vehicleRoot);
      return;
    }

    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    const span = Math.max(width, depth, 80);
    const stageCenter = new THREE.Vector3((bounds.minX + bounds.maxX) * 0.5, 0, (bounds.minZ + bounds.maxZ) * 0.5);
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

    camera.far = Math.max(8000, span * 6.5);
    camera.updateProjectionMatrix();
    controls.minDistance = Math.max(24, span * 0.12);
    controls.maxDistance = Math.max(520, span * 5.2);
    camera.position.set(center.x + span * 0.32, center.y + span * 1.95, center.z + span * 1.22);
    controls.target.copy(center);
    controls.update();
  }

  function shouldUseStageOverview(stageId) {
    return stageId === 'city';
  }

  function applyStageAtmosphere(scene, stageId) {
    if (!scene) {
      return;
    }
    scene.fog = stageId === 'city'
      ? new THREE.FogExp2('#a8bfd8', 0.00042)
      : new THREE.FogExp2('#90b3d5', 0.0065);
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

  function axisToVector(axis) {
    if (axis === 0) {
      return new THREE.Vector3(1, 0, 0);
    }
    if (axis === 1) {
      return new THREE.Vector3(0, 1, 0);
    }
    return new THREE.Vector3(0, 0, 1);
  }

  function axisToRotationProperty(axis) {
    if (axis === 0) {
      return 'x';
    }
    if (axis === 1) {
      return 'y';
    }
    return 'z';
  }

  function inferObjectLocalThinAxis(rootObject) {
    let targetMesh = null;
    rootObject.traverse((child) => {
      if (!targetMesh && child.isMesh && child.geometry) {
        targetMesh = child;
      }
    });
    if (!targetMesh?.geometry) {
      return 2;
    }
    if (!targetMesh.geometry.boundingBox) {
      targetMesh.geometry.computeBoundingBox();
    }
    const boundingBox = targetMesh.geometry.boundingBox;
    if (!boundingBox) {
      return 2;
    }
    const size = boundingBox.getSize(new THREE.Vector3());
    const axisSizes = [Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)];
    return axisSizes.indexOf(Math.min(...axisSizes));
  }

  return {
    mountSteeringWheelAttachment,
    collectSteeringWheelRig,
    applySteeringWheelState,
    normalizeToTargetSpan,
    measureObjectBounds,
    measureTireProfile,
    createFallbackMountedWheel,
    createWheelSpinMarker,
    collectWheelAnchors,
    createDoorRig,
    findNamedObject,
    prepareRenderable,
    applySceneMaterialState,
    createRenderPipeline,
    createLightingRig,
    createSkyRig,
    createFallbackCar,
    focusVehicle,
    focusStage,
    shouldUseStageOverview,
    applyStageAtmosphere,
    updateOverviewPan,
    clearGroup,
    disposeObjectTree,
    axisToRotationProperty
  };
}

export async function assetExists(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}
