import { getBuiltInVehicleById } from './vehicle-registry.js';
import { inferVehicleForwardYawDegrees } from '../vehicles/vehicle-orientation.js';

export function createGarageAssetLoader(options) {
  const {
    state,
    ui,
    config,
    assetExists,
    vehicleManager,
    playerSystem,
    mountSteeringWheelAttachment,
    refreshCarTextureSlots,
    remountTires,
    applyBuiltInCarPreset,
    getSelectedBuiltInCar,
    applySceneMaterialState,
    setSuspensionOverrides,
    setStatus,
    setProgress
  } = options;

  async function loadDefaultAssets(context) {
    setStatus('Scanning default asset slots');

    if (await assetExists(config.defaultSteeringWheelUrl)) {
      await loadSteeringWheelAsset(context);
    }

    if (await assetExists(config.bikeBodyUrl) && await assetExists(config.bikeWheelUrl)) {
      await loadBikeAssets(context);
    }

    await loadValkyrieAssets(context);
    await loadSendanAsset(context);
    await loadDominatorAsset(context);

    const selectedBuiltInCar = getSelectedBuiltInCar();
    const carExists = await assetExists(selectedBuiltInCar?.body?.url || config.defaultCarUrl);

    if (carExists && selectedBuiltInCar) {
      await loadSelectedBuiltInCar(context);
    } else {
      state.selectedBuiltInCarId = '';
      ui.builtInCar.value = '';
      setStatus('Using placeholder concept body');
    }

    vehicleManager.syncParkedVehicleProxies(context);
    setStatus('Ready for asset swaps');
  }

  async function loadSteeringWheelAsset(context) {
    try {
      setStatus('Loading steering wheel asset');
      const gltf = await context.gltfLoader.loadAsync(config.defaultSteeringWheelUrl);
      const scene = gltf.scene || gltf.scenes[0];

      if (!scene) {
        throw new Error('Steering wheel GLB contains no scene');
      }

      state.steeringWheelAsset = scene;
      mountSteeringWheelAttachment(context.carMount);
    } catch (error) {
      console.error(error);
      state.steeringWheelAsset = null;
      setStatus('Failed to load steering wheel asset');
    }
  }

  async function loadValkyrieAssets(context) {
    try {
      const valkyrie = getBuiltInVehicleById('valkyrie');
      const bodyUrl = valkyrie?.body?.url || '';
      const frontTireUrl = valkyrie?.tires?.front?.url || '';
      const rearTireUrl = valkyrie?.tires?.rear?.url || frontTireUrl;
      if (!bodyUrl || !await assetExists(bodyUrl)) {
        return;
      }
      setStatus('Loading Valkyrie assets');
      const [bodyGltf, frontTireGltf, rearTireGltf] = await Promise.all([
        context.gltfLoader.loadAsync(bodyUrl),
        frontTireUrl && assetExists(frontTireUrl).then((ok) => ok ? context.gltfLoader.loadAsync(frontTireUrl) : null),
        rearTireUrl && rearTireUrl !== frontTireUrl
          ? assetExists(rearTireUrl).then((ok) => ok ? context.gltfLoader.loadAsync(rearTireUrl) : null)
          : null
      ]);
      state.valkyrieAsset = bodyGltf.scene || bodyGltf.scenes[0];
      const frontTireScene = frontTireGltf ? (frontTireGltf.scene || frontTireGltf.scenes[0]) : null;
      const rearTireScene = rearTireGltf
        ? (rearTireGltf.scene || rearTireGltf.scenes[0])
        : frontTireScene;
      state.valkyrieTireAsset = frontTireScene || rearTireScene;
      vehicleManager.syncParkedVehicleProxies(context);
    } catch (error) {
      console.error(error);
      state.valkyrieAsset = null;
      state.valkyrieTireAsset = null;
    }
  }

  async function loadSendanAsset(context) {
    try {
      const sendan = getBuiltInVehicleById('sendan');
      const bodyUrl = sendan?.body?.url || '';
      const frontTireUrl = sendan?.tires?.front?.url || '';
      const rearTireUrl = sendan?.tires?.rear?.url || frontTireUrl;
      if (!bodyUrl || !await assetExists(bodyUrl)) {
        return;
      }
      setStatus('Loading Sendan asset');
      const [bodyGltf, frontTireGltf, rearTireGltf] = await Promise.all([
        context.gltfLoader.loadAsync(bodyUrl),
        frontTireUrl && assetExists(frontTireUrl).then((ok) => ok ? context.gltfLoader.loadAsync(frontTireUrl) : null),
        rearTireUrl && rearTireUrl !== frontTireUrl
          ? assetExists(rearTireUrl).then((ok) => ok ? context.gltfLoader.loadAsync(rearTireUrl) : null)
          : null
      ]);
      state.sendanAsset = bodyGltf.scene || bodyGltf.scenes[0];
      const frontTireScene = frontTireGltf ? (frontTireGltf.scene || frontTireGltf.scenes[0]) : null;
      const rearTireScene = rearTireGltf
        ? (rearTireGltf.scene || rearTireGltf.scenes[0])
        : frontTireScene;
      state.sendanTireAssets = {
        front: frontTireScene,
        rear: rearTireScene
      };
      vehicleManager.syncParkedVehicleProxies(context);
    } catch (error) {
      console.error(error);
      state.sendanAsset = null;
      state.sendanTireAssets = { front: null, rear: null };
    }
  }

  async function loadDominatorAsset(context) {
    try {
      const dominator = getBuiltInVehicleById('dominator');
      const bodyUrl = dominator?.body?.url || '';
      if (!bodyUrl || !await assetExists(bodyUrl)) {
        return;
      }
      setStatus('Loading Dominator asset');
      const bodyGltf = await context.gltfLoader.loadAsync(bodyUrl);
      state.dominatorAsset = bodyGltf.scene || bodyGltf.scenes[0];
      vehicleManager.syncParkedVehicleProxies(context);
    } catch (error) {
      console.error(error);
      state.dominatorAsset = null;
    }
  }

  async function loadBikeAssets(context) {
    try {
      setStatus('Loading motorcycle assets');
      const [bikeGltf, wheelGltf] = await Promise.all([
        context.gltfLoader.loadAsync(config.bikeBodyUrl),
        context.gltfLoader.loadAsync(config.bikeWheelUrl)
      ]);
      state.bikeAsset = bikeGltf.scene || bikeGltf.scenes[0];
      state.bikeWheelAsset = wheelGltf.scene || wheelGltf.scenes[0];
      if (!state.bikeAsset || !state.bikeWheelAsset) {
        throw new Error('Motorcycle GLB contains no scene');
      }
      vehicleManager.syncParkedVehicleProxies(context);
    } catch (error) {
      console.error(error);
      state.bikeAsset = null;
      state.bikeWheelAsset = null;
      setStatus('Failed to load motorcycle assets');
    }
  }

  async function loadLocalAsset(file, kind, context) {
    if (state.objectUrls[kind]) {
      URL.revokeObjectURL(state.objectUrls[kind]);
    }

    if (kind === 'car') {
      state.selectedBuiltInCarId = '';
      ui.builtInCar.value = '';
      state.baseCarSuspensionOverrides = null;
      state.suspensionOverrides = null;
      if (context.gameRuntime) {
        context.applyGarageSnapshot(setSuspensionOverrides(context.gameRuntime, null));
      }
    }

    const url = URL.createObjectURL(file);
    state.objectUrls[kind] = url;
    await loadAssetFromUrl(url, kind, file.name, context);
  }

  async function loadSelectedBuiltInCar(context) {
    const selectedBuiltInCar = getSelectedBuiltInCar();

    if (!selectedBuiltInCar) {
      return;
    }

    if (!await assetExists(selectedBuiltInCar.body.url)) {
      setStatus(`Missing car asset: ${selectedBuiltInCar.body.sourceLabel}`);
      return;
    }

    const loaded = await loadAssetFromUrl(
      selectedBuiltInCar.body.url,
      'car',
      selectedBuiltInCar.body.sourceLabel,
      context,
      {
        bodyRotationYDeg: Number(selectedBuiltInCar.body.rotationYDeg || 0),
        hasBodyRotation: Object.hasOwn(selectedBuiltInCar.body, 'rotationYDeg'),
        stripEmbeddedWheels: Boolean(selectedBuiltInCar?.tires?.front && selectedBuiltInCar?.tires?.rear)
      }
    );

    if (loaded) {
      await loadBuiltInCarTireAssets(selectedBuiltInCar, context);
      applyBuiltInCarPreset(selectedBuiltInCar.preset, context);
    }
  }

  async function loadAssetFromUrl(url, kind, label, context, options = {}) {
    setStatus(`Loading ${kind} asset`);
    setProgress(16);

    try {
      const gltf = await context.gltfLoader.loadAsync(url);
      const scene = gltf.scene || gltf.scenes[0];

      if (!scene) {
        throw new Error('GLB contains no scene');
      }

      if (kind === 'car') {
        scene.userData.assetBodyRotationYDeg = options.hasBodyRotation
          ? Number(options.bodyRotationYDeg || 0)
          : inferVehicleForwardYawDegrees(scene);
        vehicleManager.mountCarAsset(context.carMount, context.wheelMount, scene, {
          isFallback: false,
          stripEmbeddedWheels: Boolean(options.stripEmbeddedWheels)
        });
        state.carSource = label;
        ui.carName.textContent = label;
        refreshCarTextureSlots();
        if (context.characterController && !state.driveMode) {
          playerSystem.placeCharacterAtVehicle(context);
        }
        playerSystem.focusCurrentTarget(context, context.focusOptions);
      } else {
        state.tireAsset = scene;
        state.tireAssetsByAxle.front = scene;
        state.tireAssetsByAxle.rear = scene;
        state.tireSource = label;
        ui.tireName.textContent = label;
        remountTires(context.wheelMount, context);
      }

      applySceneMaterialState(context.carMount, context.wheelMount);
      setStatus(`${kind === 'car' ? 'Car' : 'Tire'} asset loaded`);
      return true;
    } catch (error) {
      console.error(error);
      setStatus(`Failed to load ${kind} asset`);
      return false;
    } finally {
      setTimeout(() => setProgress(0), 260);
    }
  }

  async function loadBuiltInCarTireAssets(selectedBuiltInCar, context) {
    if (selectedBuiltInCar?.tires?.front && selectedBuiltInCar?.tires?.rear) {
      try {
        setStatus('Loading tire assets');
        const [frontGltf, rearGltf] = await Promise.all([
          context.gltfLoader.loadAsync(selectedBuiltInCar.tires.front.url),
          context.gltfLoader.loadAsync(selectedBuiltInCar.tires.rear.url)
        ]);
        const frontScene = frontGltf.scene || frontGltf.scenes[0];
        const rearScene = rearGltf.scene || rearGltf.scenes[0];

        if (!frontScene || !rearScene) {
          throw new Error('Built-in tire GLB contains no scene');
        }

        state.tireAsset = null;
        state.tireAssetsByAxle.front = frontScene;
        state.tireAssetsByAxle.rear = rearScene;
        state.tireSource =
          `Front: ${selectedBuiltInCar.tires.front.sourceLabel} · Rear: ${selectedBuiltInCar.tires.rear.sourceLabel}`;
        ui.tireName.textContent = state.tireSource;
        remountTires(context.wheelMount, context);
        applySceneMaterialState(context.carMount, context.wheelMount);
        return;
      } catch (error) {
        console.error(error);
        setStatus('Failed to load built-in tire set');
      }
    }

    if (state.carEmbeddedWheelAssets?.length === 4) {
      state.tireAsset = null;
      state.tireAssetsByAxle.front = null;
      state.tireAssetsByAxle.rear = null;
      state.tireSource = 'Using embedded wheels';
      ui.tireName.textContent = state.tireSource;
      remountTires(context.wheelMount, context);
      applySceneMaterialState(context.carMount, context.wheelMount);
      return;
    }

    if (await assetExists(config.defaultTireUrl)) {
      await loadAssetFromUrl(config.defaultTireUrl, 'tire', 'public/models/tire_s.glb', context);
    } else {
      state.tireAsset = null;
      state.tireAssetsByAxle.front = null;
      state.tireAssetsByAxle.rear = null;
      state.tireSource = 'Using built-in fallback';
      ui.tireName.textContent = state.tireSource;
      remountTires(context.wheelMount, context);
    }
  }

  return {
    loadDefaultAssets,
    loadLocalAsset,
    loadSelectedBuiltInCar,
    loadAssetFromUrl
  };
}
