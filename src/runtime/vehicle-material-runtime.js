export function createVehicleMaterialRuntime({
  THREE,
  state,
  callbacks
}) {
  const {
    getEffectiveEnvironmentIntensity,
    getStageRenderTuning
  } = callbacks;

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

  function getWindowTintProfile(mesh) {
    const useMustangTint =
      state.selectedBuiltInCarId === 'mustang' || /mustang/i.test(String(state.carSource || ''));

    if (!useMustangTint) {
      return {
        color: '#171a1f',
        envBoost: 1.7,
        envFloor: 1.5,
        roughness: 0.03,
        clearcoatRoughness: 0.03,
        transmission: 0.52,
        thickness: 0.22,
        attenuationColor: '#0a0b0d',
        attenuationDistance: 0.32,
        opacity: 0.72
      };
    }

    const name = String(mesh?.name || '').toLowerCase();
    const isWindshield = /windshield|front.*window|window.*front/.test(name);

    if (isWindshield) {
      return {
        color: '#192028',
        envBoost: 1.75,
        envFloor: 1.55,
        roughness: 0.026,
        clearcoatRoughness: 0.026,
        transmission: 0.48,
        thickness: 0.24,
        attenuationColor: '#10141a',
        attenuationDistance: 0.34,
        opacity: 0.78
      };
    }

    return {
      color: '#0d1014',
      envBoost: 1.95,
      envFloor: 1.8,
      roughness: 0.02,
      clearcoatRoughness: 0.02,
      transmission: 0.24,
      thickness: 0.3,
      attenuationColor: '#050608',
      attenuationDistance: 0.16,
      opacity: 0.58
    };
  }

  function applyWindowMaterialState(material, mesh) {
    const tint = getWindowTintProfile(mesh);
    const effectiveEnvironmentIntensity = getEffectiveEnvironmentIntensity();

    if ('color' in material) {
      material.color.set(tint.color);
    }

    if ('envMapIntensity' in material) {
      material.envMapIntensity = effectiveEnvironmentIntensity <= 0.001
        ? 0
        : Math.max(
          effectiveEnvironmentIntensity * tint.envBoost,
          tint.envFloor * getStageRenderTuning().windowFloorScale
        );
    }

    if ('metalness' in material) {
      material.metalness = 0;
    }

    if ('roughness' in material) {
      material.roughness = tint.roughness;
    }

    if ('clearcoat' in material) {
      material.clearcoat = 1;
    }

    if ('clearcoatRoughness' in material) {
      material.clearcoatRoughness = tint.clearcoatRoughness;
    }

    if ('ior' in material) {
      material.ior = 1.52;
    }

    if ('transmission' in material) {
      material.transmission = tint.transmission;
    }

    if ('thickness' in material) {
      material.thickness = tint.thickness;
    }

    if ('attenuationColor' in material) {
      material.attenuationColor.set(tint.attenuationColor);
    }

    if ('attenuationDistance' in material) {
      material.attenuationDistance = tint.attenuationDistance;
    }

    material.transparent = true;
    material.opacity = tint.opacity;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
  }

  function shouldCastVehicleShadow(mesh) {
    const name = String(mesh.name || '').toLowerCase();
    if (
      /window|windshield|glass|interior|seat|steering|mirror|locator|tire|wheel|rim|socket|driver/i.test(name)
    ) {
      return false;
    }

    if (!/(chasis|chassis|body|door|hood|roof|quarter|fender|bumper|front|back|panel|shell|node_0012)/i.test(name)) {
      return false;
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) {
        continue;
      }
      if (material.transparent || material.opacity < 0.99) {
        return false;
      }
      if ('transmission' in material && material.transmission > 0.01) {
        return false;
      }
    }

    return true;
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

      child.castShadow = shouldCastVehicleShadow(child);
      child.receiveShadow = !isWindowMesh(child);

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) {
          continue;
        }

        if ('envMapIntensity' in material) {
          material.envMapIntensity = getEffectiveEnvironmentIntensity();
        }

        if ('roughness' in material && material.roughness < 0.03) {
          material.roughness = 0.03;
        }

        if ('clearcoat' in material && material.clearcoat < 0.2) {
          material.clearcoat = 0.2;
        }

        if (isWindowMesh(child)) {
          applyWindowMaterialState(material, child);
        }

        material.needsUpdate = true;
      }
    });
  }

  function applySceneMaterialState(carMount, wheelMount) {
    const effectiveEnvironmentIntensity = getEffectiveEnvironmentIntensity();

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
            applyWindowMaterialState(material, child);
            material.needsUpdate = true;
            continue;
          }

          if ('envMapIntensity' in material) {
            material.envMapIntensity = effectiveEnvironmentIntensity;
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

  return {
    prepareRenderable,
    applySceneMaterialState,
    findWindowMesh: isWindowMesh
  };
}
