const ROAD_KIND_STYLE = {
  boulevard: {
    outerWidth: 42,
    roadWidth: 28,
    medianWidth: 5
  },
  avenue: {
    outerWidth: 34,
    roadWidth: 22,
    medianWidth: 0
  },
  street: {
    outerWidth: 28.4,
    roadWidth: 18,
    medianWidth: 0
  }
};

const MAP_STYLE = {
  background: '#0b1017',
  district: '#18212b',
  shoulder: '#80868d',
  road: '#2b3138',
  median: '#567349',
  border: '#d9e4f7',
  ring: '#2c3b50',
  playerFill: '#f4f8ff',
  playerStroke: '#0b1017'
};

function pickHorizontalRoadKind(chunkZ) {
  if (chunkZ % 4 === 0) {
    return 'boulevard';
  }
  if (chunkZ % 2 === 0) {
    return 'avenue';
  }
  return 'street';
}

function pickVerticalRoadKind(chunkX) {
  if (chunkX % 4 === 0) {
    return 'boulevard';
  }
  if (chunkX % 2 === 0) {
    return 'avenue';
  }
  return 'street';
}

function getCanvasContext(canvas) {
  if (!canvas) {
    return null;
  }
  return canvas.getContext('2d');
}

function clearCanvas(ctx, canvas) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function worldToMap(worldX, worldZ, centerX, centerZ, cosYaw, sinYaw, scale, mapCenterX, mapCenterY) {
  const deltaX = worldX - centerX;
  const deltaZ = worldZ - centerZ;
  const rotatedX = deltaX * cosYaw + deltaZ * sinYaw;
  const rotatedZ = -deltaX * sinYaw + deltaZ * cosYaw;
  return {
    x: mapCenterX + rotatedX * scale,
    y: mapCenterY - rotatedZ * scale
  };
}

function drawStrip(ctx, from, to, width, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

function drawRoadLine(ctx, options) {
  const {
    orientation,
    lineCoord,
    extent,
    style,
    centerX,
    centerZ,
    cosYaw,
    sinYaw,
    scale,
    mapCenterX,
    mapCenterY
  } = options;

  const from = orientation === 'vertical'
    ? worldToMap(lineCoord, centerZ - extent, centerX, centerZ, cosYaw, sinYaw, scale, mapCenterX, mapCenterY)
    : worldToMap(centerX - extent, lineCoord, centerX, centerZ, cosYaw, sinYaw, scale, mapCenterX, mapCenterY);
  const to = orientation === 'vertical'
    ? worldToMap(lineCoord, centerZ + extent, centerX, centerZ, cosYaw, sinYaw, scale, mapCenterX, mapCenterY)
    : worldToMap(centerX + extent, lineCoord, centerX, centerZ, cosYaw, sinYaw, scale, mapCenterX, mapCenterY);

  drawStrip(ctx, from, to, style.outerWidth * scale, MAP_STYLE.shoulder);
  drawStrip(ctx, from, to, style.roadWidth * scale, MAP_STYLE.road);
}

function drawBoulevardMedian(ctx, options) {
  const {
    orientation,
    lineCoord,
    chunkStart,
    chunkEnd,
    chunkSize,
    medianWidth,
    centerX,
    centerZ,
    cosYaw,
    sinYaw,
    scale,
    mapCenterX,
    mapCenterY
  } = options;

  if (medianWidth <= 0) {
    return;
  }

  const halfChunk = chunkSize * 0.5;
  const centerGap = 40;

  for (let chunkIndex = chunkStart; chunkIndex <= chunkEnd; chunkIndex += 1) {
    const axisCenter = chunkIndex * chunkSize;
    const lowerStart = axisCenter - halfChunk + 8;
    const lowerEnd = axisCenter - centerGap * 0.5;
    const upperStart = axisCenter + centerGap * 0.5;
    const upperEnd = axisCenter + halfChunk - 8;

    if (lowerEnd - lowerStart > 1) {
      const from = orientation === 'vertical'
        ? worldToMap(lineCoord, lowerStart, centerX, centerZ, cosYaw, sinYaw, scale, mapCenterX, mapCenterY)
        : worldToMap(lowerStart, lineCoord, centerX, centerZ, cosYaw, sinYaw, scale, mapCenterX, mapCenterY);
      const to = orientation === 'vertical'
        ? worldToMap(lineCoord, lowerEnd, centerX, centerZ, cosYaw, sinYaw, scale, mapCenterX, mapCenterY)
        : worldToMap(lowerEnd, lineCoord, centerX, centerZ, cosYaw, sinYaw, scale, mapCenterX, mapCenterY);
      drawStrip(ctx, from, to, medianWidth * scale, MAP_STYLE.median);
    }

    if (upperEnd - upperStart > 1) {
      const from = orientation === 'vertical'
        ? worldToMap(lineCoord, upperStart, centerX, centerZ, cosYaw, sinYaw, scale, mapCenterX, mapCenterY)
        : worldToMap(upperStart, lineCoord, centerX, centerZ, cosYaw, sinYaw, scale, mapCenterX, mapCenterY);
      const to = orientation === 'vertical'
        ? worldToMap(lineCoord, upperEnd, centerX, centerZ, cosYaw, sinYaw, scale, mapCenterX, mapCenterY)
        : worldToMap(upperEnd, lineCoord, centerX, centerZ, cosYaw, sinYaw, scale, mapCenterX, mapCenterY);
      drawStrip(ctx, from, to, medianWidth * scale, MAP_STYLE.median);
    }
  }
}

function drawPlayerMarker(ctx, centerX, centerY, size) {
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, size * 0.9);
  ctx.lineTo(0, size * 0.45);
  ctx.lineTo(-size * 0.7, size * 0.9);
  ctx.closePath();
  ctx.fillStyle = MAP_STYLE.playerFill;
  ctx.strokeStyle = MAP_STYLE.playerStroke;
  ctx.lineWidth = 3;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function renderBloomvilleMinimap(canvas, options) {
  const ctx = getCanvasContext(canvas);
  if (!ctx || !options?.center) {
    return;
  }

  const {
    center,
    yaw = 0,
    chunkSize = 180
  } = options;

  const width = canvas.width;
  const height = canvas.height;
  const mapCenterX = width * 0.5;
  const mapCenterY = height * 0.5;
  const radius = Math.min(width, height) * 0.5 - 16;
  const rangeMeters = chunkSize * 1.38;
  const scale = radius / rangeMeters;
  const rotation = -yaw;
  const cosYaw = Math.cos(rotation);
  const sinYaw = Math.sin(rotation);
  const extent = rangeMeters * 1.25;
  const chunkPadding = 2;

  clearCanvas(ctx, canvas);

  ctx.save();
  ctx.beginPath();
  ctx.arc(mapCenterX, mapCenterY, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = MAP_STYLE.background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = MAP_STYLE.district;
  ctx.fillRect(mapCenterX - radius, mapCenterY - radius, radius * 2, radius * 2);

  const minChunkX = Math.floor((center.x - extent) / chunkSize) - chunkPadding;
  const maxChunkX = Math.ceil((center.x + extent) / chunkSize) + chunkPadding;
  const minChunkZ = Math.floor((center.z - extent) / chunkSize) - chunkPadding;
  const maxChunkZ = Math.ceil((center.z + extent) / chunkSize) + chunkPadding;

  for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
    const worldX = chunkX * chunkSize;
    const kind = pickVerticalRoadKind(chunkX);
    const style = ROAD_KIND_STYLE[kind];
    drawRoadLine(ctx, {
      orientation: 'vertical',
      lineCoord: worldX,
      extent,
      style,
      centerX: center.x,
      centerZ: center.z,
      cosYaw,
      sinYaw,
      scale,
      mapCenterX,
      mapCenterY
    });
    if (style.medianWidth > 0) {
      drawBoulevardMedian(ctx, {
        orientation: 'vertical',
        lineCoord: worldX,
        chunkStart: minChunkZ,
        chunkEnd: maxChunkZ,
        chunkSize,
        medianWidth: style.medianWidth,
        centerX: center.x,
        centerZ: center.z,
        cosYaw,
        sinYaw,
        scale,
        mapCenterX,
        mapCenterY
      });
    }
  }

  for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) {
    const worldZ = chunkZ * chunkSize;
    const kind = pickHorizontalRoadKind(chunkZ);
    const style = ROAD_KIND_STYLE[kind];
    drawRoadLine(ctx, {
      orientation: 'horizontal',
      lineCoord: worldZ,
      extent,
      style,
      centerX: center.x,
      centerZ: center.z,
      cosYaw,
      sinYaw,
      scale,
      mapCenterX,
      mapCenterY
    });
    if (style.medianWidth > 0) {
      drawBoulevardMedian(ctx, {
        orientation: 'horizontal',
        lineCoord: worldZ,
        chunkStart: minChunkX,
        chunkEnd: maxChunkX,
        chunkSize,
        medianWidth: style.medianWidth,
        centerX: center.x,
        centerZ: center.z,
        cosYaw,
        sinYaw,
        scale,
        mapCenterX,
        mapCenterY
      });
    }
  }

  ctx.restore();

  ctx.save();
  ctx.strokeStyle = MAP_STYLE.ring;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(mapCenterX, mapCenterY, radius + 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  drawPlayerMarker(ctx, mapCenterX, mapCenterY, 14);
}

function drawRoadGraphLine(ctx, options) {
  const {
    road,
    centerX,
    centerZ,
    cosYaw,
    sinYaw,
    scale,
    mapCenterX,
    mapCenterY
  } = options;

  if (!road?.points?.length) {
    return;
  }

  const roadWidth = road.width || 18;
  const shoulderWidth = roadWidth + 8;

  const projectedPoints = road.points.map((point) =>
    worldToMap(point.x, point.z, centerX, centerZ, cosYaw, sinYaw, scale, mapCenterX, mapCenterY)
  );

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.strokeStyle = MAP_STYLE.shoulder;
  ctx.lineWidth = shoulderWidth * scale;
  ctx.beginPath();
  ctx.moveTo(projectedPoints[0].x, projectedPoints[0].y);
  for (let index = 1; index < projectedPoints.length; index += 1) {
    ctx.lineTo(projectedPoints[index].x, projectedPoints[index].y);
  }
  ctx.stroke();

  ctx.strokeStyle = MAP_STYLE.road;
  ctx.lineWidth = roadWidth * scale;
  ctx.beginPath();
  ctx.moveTo(projectedPoints[0].x, projectedPoints[0].y);
  for (let index = 1; index < projectedPoints.length; index += 1) {
    ctx.lineTo(projectedPoints[index].x, projectedPoints[index].y);
  }
  ctx.stroke();

  ctx.restore();
}

function renderRoadGraphMinimap(canvas, options) {
  const ctx = getCanvasContext(canvas);
  if (!ctx || !options?.center) {
    return;
  }

  const {
    center,
    yaw = 0,
    roads = [],
    bounds = null
  } = options;

  const width = canvas.width;
  const height = canvas.height;
  const mapCenterX = width * 0.5;
  const mapCenterY = height * 0.5;
  const radius = Math.min(width, height) * 0.5 - 16;
  const spanX = bounds ? bounds.maxX - bounds.minX : 420;
  const spanZ = bounds ? bounds.maxZ - bounds.minZ : 420;
  const rangeMeters = Math.max(180, Math.min(Math.max(spanX, spanZ) * 0.35, 320));
  const scale = radius / rangeMeters;
  const rotation = -yaw;
  const cosYaw = Math.cos(rotation);
  const sinYaw = Math.sin(rotation);

  clearCanvas(ctx, canvas);

  ctx.save();
  ctx.beginPath();
  ctx.arc(mapCenterX, mapCenterY, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = MAP_STYLE.background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = MAP_STYLE.district;
  ctx.fillRect(mapCenterX - radius, mapCenterY - radius, radius * 2, radius * 2);

  for (const road of roads) {
    drawRoadGraphLine(ctx, {
      road,
      centerX: center.x,
      centerZ: center.z,
      cosYaw,
      sinYaw,
      scale,
      mapCenterX,
      mapCenterY
    });
  }

  ctx.restore();

  ctx.save();
  ctx.strokeStyle = MAP_STYLE.ring;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(mapCenterX, mapCenterY, radius + 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  drawPlayerMarker(ctx, mapCenterX, mapCenterY, 14);
}

export function renderStageMinimap(canvas, options) {
  if (options?.mode === 'roadGraph') {
    renderRoadGraphMinimap(canvas, options);
    return;
  }

  renderBloomvilleMinimap(canvas, options);
}
