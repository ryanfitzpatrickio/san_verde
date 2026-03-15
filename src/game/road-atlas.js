import * as THREE from 'three';

export const ROAD_ATLAS_COLUMNS = 3;
export const ROAD_ATLAS_ROWS = 3;

export function extractGridAtlasTiles(rootObject, options = {}) {
  const columns = options.columns ?? ROAD_ATLAS_COLUMNS;
  const rows = options.rows ?? ROAD_ATLAS_ROWS;
  const atlas = rootObject.clone(true);
  atlas.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(atlas);
  if (bounds.isEmpty()) {
    return createEmptyRoadAtlas(columns, rows);
  }

  const size = bounds.getSize(new THREE.Vector3());
  const cellWidth = size.x / columns;
  const cellDepth = size.z / rows;
  const cells = new Map();

  atlas.traverse((child) => {
    if (!child.isMesh || !child.geometry) {
      return;
    }

    const materialArray = Array.isArray(child.material) ? child.material : [child.material];
    const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);

    const positions = geometry.getAttribute('position');
    if (!positions) {
      geometry.dispose();
      return;
    }

    const attributeNames = Object.keys(geometry.attributes);
    for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex += 3) {
      const centroidX =
        (positions.getX(vertexIndex) + positions.getX(vertexIndex + 1) + positions.getX(vertexIndex + 2)) / 3;
      const centroidZ =
        (positions.getZ(vertexIndex) + positions.getZ(vertexIndex + 1) + positions.getZ(vertexIndex + 2)) / 3;
      const column = clampIndex(Math.floor((centroidX - bounds.min.x) / cellWidth), columns);
      const rowFromBottom = clampIndex(Math.floor((centroidZ - bounds.min.z) / cellDepth), rows);
      const row = rows - 1 - rowFromBottom;
      const tileId = createRoadAtlasTileId(column, row);
      const materialIndex = getTriangleMaterialIndex(geometry, vertexIndex);
      const material = materialArray[materialIndex] || materialArray[0];
      const bucket = getRoadAtlasBucket(cells, tileId, column, row, materialIndex, material, attributeNames);

      for (const attributeName of attributeNames) {
        const attribute = geometry.getAttribute(attributeName);
        const values = bucket.attributes[attributeName];
        for (let offset = 0; offset < 3; offset += 1) {
          const sourceIndex = vertexIndex + offset;
          for (let component = 0; component < attribute.itemSize; component += 1) {
            values.push(attribute.array[sourceIndex * attribute.itemSize + component]);
          }
        }
      }
    }

    geometry.dispose();
  });

  return finalizeRoadAtlas(cells, bounds, cellWidth, cellDepth, columns, rows);
}

export function extractRoadAtlasTiles(rootObject, options = {}) {
  return extractGridAtlasTiles(rootObject, options);
}

export function createRoadAtlasTileId(column, row) {
  return `tile_${column}_${row}`;
}

function createEmptyRoadAtlas(columns, rows) {
  const tiles = {};
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      tiles[createRoadAtlasTileId(column, row)] = createRoadAtlasTileEntry(column, row, new THREE.Group(), {
        width: 1,
        depth: 1
      });
    }
  }

  return {
    columns,
    rows,
    bounds: new THREE.Box3(),
    cellWidth: 1,
    cellDepth: 1,
    tiles
  };
}

function getTriangleMaterialIndex(geometry, vertexIndex) {
  if (!geometry.groups?.length) {
    return 0;
  }

  for (const group of geometry.groups) {
    const end = group.start + group.count;
    if (vertexIndex >= group.start && vertexIndex < end) {
      return group.materialIndex ?? 0;
    }
  }

  return 0;
}

function getRoadAtlasBucket(cells, tileId, column, row, materialIndex, material, attributeNames) {
  const cell = cells.get(tileId) || {
    column,
    row,
    materialBuckets: new Map()
  };

  if (!cells.has(tileId)) {
    cells.set(tileId, cell);
  }

  const bucket = cell.materialBuckets.get(materialIndex) || {
    material: material?.clone?.() || material,
    attributeNames,
    attributes: Object.fromEntries(attributeNames.map((name) => [name, []]))
  };

  if (!cell.materialBuckets.has(materialIndex)) {
    cell.materialBuckets.set(materialIndex, bucket);
  }

  return bucket;
}

function finalizeRoadAtlas(cells, bounds, cellWidth, cellDepth, columns, rows) {
  const tiles = {};

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const tileId = createRoadAtlasTileId(column, row);
      const cell = cells.get(tileId);
      const tileGroup = new THREE.Group();

      if (cell) {
        for (const bucket of cell.materialBuckets.values()) {
          const geometry = new THREE.BufferGeometry();
          for (const attributeName of bucket.attributeNames) {
            const values = bucket.attributes[attributeName];
            if (!values.length) {
              continue;
            }

            const itemSize = inferItemSize(attributeName);
            geometry.setAttribute(attributeName, new THREE.Float32BufferAttribute(values, itemSize));
          }
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();

          const mesh = new THREE.Mesh(geometry, bucket.material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          tileGroup.add(mesh);
        }

        normalizeRoadAtlasTile(tileGroup, bounds, cellWidth, cellDepth, column, row, rows);
      }

      tiles[tileId] = createRoadAtlasTileEntry(column, row, tileGroup, {
        width: cellWidth,
        depth: cellDepth
      });
    }
  }

  return {
    columns,
    rows,
    bounds,
    cellWidth,
    cellDepth,
    tiles
  };
}

function createRoadAtlasTileEntry(column, row, group, footprint) {
  group.userData.roadAtlasTile = {
    id: createRoadAtlasTileId(column, row),
    column,
    row,
    footprint
  };

  group.userData.fitFootprint = {
    width: footprint.width,
    depth: footprint.depth
  };

  return {
    id: createRoadAtlasTileId(column, row),
    column,
    row,
    footprint,
    group
  };
}

function normalizeRoadAtlasTile(tileGroup, atlasBounds, cellWidth, cellDepth, column, row, rows) {
  const tileBounds = new THREE.Box3().setFromObject(tileGroup);
  if (tileBounds.isEmpty()) {
    return;
  }

  const cellCenter = new THREE.Vector3(
    atlasBounds.min.x + cellWidth * (column + 0.5),
    0,
    atlasBounds.min.z + cellDepth * (rows - row - 0.5)
  );
  const floorY = tileBounds.min.y;
  tileGroup.traverse((child) => {
    if (!child.isMesh || !child.geometry) {
      return;
    }

    child.geometry.translate(-cellCenter.x, -floorY, -cellCenter.z);
    child.geometry.computeBoundingBox();
    child.geometry.computeBoundingSphere();
  });
}

function inferItemSize(attributeName) {
  if (attributeName === 'uv' || attributeName === 'uv1' || attributeName === 'uv2' || attributeName === 'uv3') {
    return 2;
  }

  if (attributeName === 'tangent') {
    return 4;
  }

  return 3;
}

function clampIndex(index, size) {
  return THREE.MathUtils.clamp(index, 0, size - 1);
}
