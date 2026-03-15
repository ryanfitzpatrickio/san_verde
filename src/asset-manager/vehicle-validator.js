import * as THREE from 'three';

export const REQUIRED_LOCATOR_NAMES = [
  'Locator_Front_Left',
  'Locator_Front_Right',
  'Locator_Rear_Left',
  'Locator_Rear_Right',
  'Locator_Steering',
  'Locator_Door_Hinge',
  'Locator_Seat',
  'Locator_Door_Spot'
];

export const REQUIRED_WINDOW_COUNT = 4;
export const EDITOR_HELPER_NAME = '__asset_manager_locator_helper__';

const WINDOW_PATTERN = /windshield|window(_driver|_passenger|_top)?|glass/i;
const DOOR_PATTERN = /(driver.*door|door.*driver|^door$)/i;
const STEERING_WHEEL_PATTERN = /steering[_ ]wheel|wheel.*steering/i;
const INTERIOR_PATTERN = /interior/i;
const TIRE_PATTERN = /(tire|wheel|rim)/i;
const HELPER_PATTERN = /^__asset_manager_/i;

function getNodeWorldCenter(root, node) {
  const box = new THREE.Box3().setFromObject(node);
  if (!box.isEmpty()) {
    return root.worldToLocal(box.getCenter(new THREE.Vector3()));
  }

  return root.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
}

function getNodeWorldBounds(node) {
  const box = new THREE.Box3().setFromObject(node);
  return box.isEmpty() ? null : box;
}

function collectRenderableBounds(root) {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) {
    return null;
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  return {
    box,
    center,
    size
  };
}

function getDescendantMeshCount(root) {
  let count = 0;
  root.traverse((child) => {
    if (child.isMesh && !child.userData.assetManagerHelper) {
      count += 1;
    }
  });
  return count;
}

function collectDistinctNamedNodes(root, pattern, options = {}) {
  const matches = [];
  root.traverse((child) => {
    if (child === root || child.userData.assetManagerHelper || !child.name || HELPER_PATTERN.test(child.name)) {
      return;
    }

    if (!pattern.test(child.name)) {
      return;
    }

    if (options.exclude && options.exclude.test(child.name)) {
      return;
    }

    if (options.meshLike && !child.isMesh && getDescendantMeshCount(child) === 0) {
      return;
    }

    matches.push(child);
  });

  return matches.filter((node) => {
    return !matches.some((other) => other !== node && other.children.includes(node));
  });
}

function collectLocatorPlacementHints(root) {
  const tireNodes = collectDistinctNamedNodes(root, TIRE_PATTERN, {
    exclude: /steering/i,
    meshLike: true
  });
  const steeringWheelNodes = collectDistinctNamedNodes(root, STEERING_WHEEL_PATTERN, {
    meshLike: true
  });
  const seatNodes = collectDistinctNamedNodes(root, /seat/i, {
    meshLike: true
  });
  const interiorNodes = collectDistinctNamedNodes(root, INTERIOR_PATTERN, {
    meshLike: true
  });
  const doorNodes = collectDistinctNamedNodes(root, DOOR_PATTERN, {
    meshLike: true
  });

  const tireCenters = tireNodes
    .map((node) => ({
      node,
      center: getNodeWorldCenter(root, node)
    }))
    .sort((left, right) => {
      if (Math.abs(right.center.z - left.center.z) > 1e-4) {
        return right.center.z - left.center.z;
      }
      return left.center.x - right.center.x;
    });

  return {
    tireCenters,
    steeringWheel: steeringWheelNodes[0] ? getNodeWorldCenter(root, steeringWheelNodes[0]) : null,
    seat: seatNodes[0]
      ? getNodeWorldCenter(root, seatNodes[0])
      : interiorNodes[0]
        ? getNodeWorldCenter(root, interiorNodes[0])
        : null,
    doorNode: doorNodes[0] || null
  };
}

function inferLocatorPositionFromParts(root, locatorName) {
  const hints = collectLocatorPlacementHints(root);

  if (hints.tireCenters.length >= 4) {
    const frontPair = hints.tireCenters.slice(0, 2).sort((left, right) => left.center.x - right.center.x);
    const rearPair = hints.tireCenters.slice(2, 4).sort((left, right) => left.center.x - right.center.x);

    const tireMap = {
      Locator_Front_Left: frontPair[0]?.center || null,
      Locator_Front_Right: frontPair[1]?.center || null,
      Locator_Rear_Left: rearPair[0]?.center || null,
      Locator_Rear_Right: rearPair[1]?.center || null
    };

    if (tireMap[locatorName]) {
      return tireMap[locatorName].clone();
    }
  }

  if (locatorName === 'Locator_Steering' && hints.steeringWheel) {
    return hints.steeringWheel.clone();
  }

  if (locatorName === 'Locator_Seat' && hints.seat) {
    return hints.seat.clone();
  }

  if ((locatorName === 'Locator_Door_Hinge' || locatorName === 'Locator_Door_Spot') && hints.doorNode) {
    const bounds = getNodeWorldBounds(hints.doorNode);
    if (bounds) {
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const sideSign = center.x < 0 ? -1 : 1;
      const hinge = root.worldToLocal(new THREE.Vector3(
        center.x + sideSign * size.x * 0.42,
        bounds.max.y - size.y * 0.12,
        bounds.max.z - size.z * 0.1
      ));
      const doorSpot = root.worldToLocal(new THREE.Vector3(
        center.x + sideSign * size.x * 0.95,
        center.y,
        center.z
      ));

      if (locatorName === 'Locator_Door_Hinge') {
        return hinge;
      }
      return doorSpot;
    }
  }

  return null;
}

export function createLocatorHelper(locator) {
  const existing = locator.children.find((child) => child.userData.assetManagerHelper === true);
  if (existing) {
    return existing;
  }

  const helper = new THREE.Group();
  helper.name = EDITOR_HELPER_NAME;
  helper.userData.assetManagerHelper = true;

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 18, 12),
    new THREE.MeshBasicMaterial({ color: '#f97316' })
  );
  sphere.userData.assetManagerHelper = true;

  const axes = new THREE.AxesHelper(0.22);
  axes.userData.assetManagerHelper = true;

  helper.add(sphere);
  helper.add(axes);
  locator.add(helper);
  return helper;
}

export function ensureLocatorHelpers(root) {
  for (const locatorName of REQUIRED_LOCATOR_NAMES) {
    const locator = root.getObjectByName(locatorName);
    if (locator) {
      createLocatorHelper(locator);
    }
  }
}

export function stripEditorHelpers(root) {
  const doomed = [];
  root.traverse((child) => {
    if (child.userData.assetManagerHelper === true || child.name === EDITOR_HELPER_NAME) {
      doomed.push(child);
    }
  });

  for (const child of doomed) {
    child.parent?.remove(child);
  }
}

export function createReferenceTemplate(root) {
  const bounds = collectRenderableBounds(root);
  if (!bounds) {
    return null;
  }

  const locators = {};
  for (const locatorName of REQUIRED_LOCATOR_NAMES) {
    const locator = root.getObjectByName(locatorName);
    if (!locator) {
      continue;
    }

    const ratio = locator.position.clone().sub(bounds.center).divide(
      new THREE.Vector3(
        Math.max(bounds.size.x, 1e-6),
        Math.max(bounds.size.y, 1e-6),
        Math.max(bounds.size.z, 1e-6)
      )
    );

    locators[locatorName] = ratio.toArray();
  }

  return {
    locators
  };
}

function getCandidateLocalPosition(root, referenceTemplate, locatorName) {
  const ratio = referenceTemplate?.locators?.[locatorName];
  if (!ratio) {
    return null;
  }

  const bounds = collectRenderableBounds(root);
  if (!bounds) {
    return null;
  }

  return new THREE.Vector3(
    bounds.center.x + ratio[0] * bounds.size.x,
    bounds.center.y + ratio[1] * bounds.size.y,
    bounds.center.z + ratio[2] * bounds.size.z
  );
}

export function addMissingLocatorsFromReference(root, referenceTemplate) {
  const added = [];

  for (const locatorName of REQUIRED_LOCATOR_NAMES) {
    if (root.getObjectByName(locatorName)) {
      continue;
    }

    const estimatedPosition =
      inferLocatorPositionFromParts(root, locatorName) ||
      getCandidateLocalPosition(root, referenceTemplate, locatorName);
    if (!estimatedPosition) {
      continue;
    }

    const locator = new THREE.Group();
    locator.name = locatorName;
    locator.position.copy(estimatedPosition);
    createLocatorHelper(locator);
    root.add(locator);
    added.push(locator);
  }

  return added;
}

export function analyzeVehicleScene(root) {
  const requiredLocators = REQUIRED_LOCATOR_NAMES.map((locatorName) => {
    return {
      name: locatorName,
      object: root.getObjectByName(locatorName) || null
    };
  });

  const tireNodes = collectDistinctNamedNodes(root, TIRE_PATTERN, {
    exclude: /steering/i,
    meshLike: true
  });
  const windowNodes = collectDistinctNamedNodes(root, WINDOW_PATTERN, {
    meshLike: true
  });
  const interiorNodes = collectDistinctNamedNodes(root, INTERIOR_PATTERN, {
    meshLike: true
  });
  const doorNodes = collectDistinctNamedNodes(root, DOOR_PATTERN, {
    meshLike: true
  });
  const steeringWheelNodes = collectDistinctNamedNodes(root, STEERING_WHEEL_PATTERN, {
    meshLike: true
  });

  const missingLocators = requiredLocators.filter((entry) => !entry.object).map((entry) => entry.name);
  const separateTires = tireNodes.length >= 4;
  const hasWheelLocatorSet =
    requiredLocators
      .filter((entry) => /Locator_(Front|Rear)_(Left|Right)/.test(entry.name))
      .every((entry) => Boolean(entry.object));

  return {
    approved: missingLocators.length === 0 && (separateTires || hasWheelLocatorSet),
    requiredLocators,
    missingLocators,
    minimumRequirements: {
      separateTires,
      tireCount: tireNodes.length,
      hasWheelLocatorSet
    },
    optionalParts: {
      windows: {
        present: windowNodes.length >= REQUIRED_WINDOW_COUNT,
        count: windowNodes.length,
        expected: REQUIRED_WINDOW_COUNT
      },
      interior: {
        present: interiorNodes.length > 0,
        count: interiorNodes.length
      },
      door: {
        present: doorNodes.length > 0,
        count: doorNodes.length
      },
      steeringWheel: {
        present: steeringWheelNodes.length > 0,
        count: steeringWheelNodes.length
      }
    }
  };
}
