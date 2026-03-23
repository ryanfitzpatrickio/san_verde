import * as THREE from 'three';

const RANGE_RAYCASTER = new THREE.Raycaster();
const LOCAL_HIT_POINT = new THREE.Vector3();

const LANE_COUNT = 3;
const LANE_SPACING = 11;
const START_RADIUS = 3.25;
const SHOT_LIMIT = 10;
const PAPER_WIDTH = 1.1;
const PAPER_HEIGHT = 1.45;
const SCORE_RADIUS = 0.44;
const BULL_RADIUS = 0.065;
const IMPACT_RADIUS = 0.018;

export function createTestCourseShootingRange() {
  const group = new THREE.Group();
  group.position.set(66, 0, 0);

  const lanes = [];
  const sessionState = {
    activeLaneId: null,
    totalScore: 0,
    lastScore: null,
    shotsTaken: 0,
    complete: false
  };
  let nearbyLaneId = null;
  let lastHudState = null;

  group.add(createRangePad());
  group.add(createRangeBackstop());
  group.add(createRangeRoof());
  group.add(createRangeDividerWall(-LANE_SPACING * 1.5));
  group.add(createRangeDividerWall(-LANE_SPACING * 0.5));
  group.add(createRangeDividerWall(LANE_SPACING * 0.5));
  group.add(createRangeDividerWall(LANE_SPACING * 1.5));

  for (let index = 0; index < LANE_COUNT; index += 1) {
    const lane = createLane(index);
    lanes.push(lane);
    group.add(lane.group);
  }

  syncLaneVisuals();

  return {
    group,
    updatePlayer(playerPosition) {
      nearbyLaneId = resolveNearbyLaneId(playerPosition);
      syncLaneVisuals();
    },
    getInteractionHint() {
      const lane = getLaneById(nearbyLaneId);
      if (!lane) {
        return sessionState.activeLaneId
          ? 'Click the paper target to keep shooting'
          : '';
      }

      if (sessionState.activeLaneId === lane.id) {
        return sessionState.complete
          ? `Press E to restart ${lane.label}`
          : `Press E to restart ${lane.label} or click the paper target to shoot`;
      }

      return `Press E to start ${lane.label} session`;
    },
    getHudState() {
      const lane = getLaneById(sessionState.activeLaneId || nearbyLaneId);
      const visible = Boolean(lane || sessionState.activeLaneId);
      if (!visible) {
        lastHudState = {
          visible: false,
          title: '',
          status: '',
          score: '',
          shots: '',
          lastShot: ''
        };
        return lastHudState;
      }

      const title = sessionState.activeLaneId
        ? `${getLaneById(sessionState.activeLaneId)?.label || 'Lane'} Session`
        : lane?.label || 'Shooting Range';
      const status = sessionState.activeLaneId
        ? sessionState.complete
          ? 'Session complete'
          : 'Session active'
        : 'Step into a booth and press E';
      const score = sessionState.activeLaneId
        ? `${sessionState.totalScore.toFixed(1)} pts`
        : '0.0 pts';
      const shots = sessionState.activeLaneId
        ? `${sessionState.shotsTaken}/${SHOT_LIMIT} shots`
        : `0/${SHOT_LIMIT} shots`;
      const lastShot = sessionState.lastScore == null
        ? 'No shots yet'
        : `${sessionState.lastScore.toFixed(1)} pts`;

      lastHudState = { visible, title, status, score, shots, lastShot };
      return lastHudState;
    },
    startSessionAtPlayer(playerPosition) {
      const lane = getLaneById(resolveNearbyLaneId(playerPosition));
      if (!lane) {
        return { ok: false, message: 'Move into a shooting lane to start a session' };
      }

      beginSession(lane);
      syncLaneVisuals();
      return {
        ok: true,
        laneId: lane.id,
        message: `${lane.label} session started`
      };
    },
    handleShotRay(origin, direction) {
      const result = resolveShot(origin, direction);
      syncLaneVisuals();
      return result;
    }
  };

  function getLaneById(laneId) {
    return lanes.find((lane) => lane.id === laneId) || null;
  }

  function createLane(index) {
    const group = new THREE.Group();
    const z = (index - 1) * LANE_SPACING;
    const laneNumber = index + 1;
    const id = `range-lane-${laneNumber}`;
    const label = `Lane ${laneNumber}`;
    group.position.set(0, 0, z);

    group.add(createLaneFloorMark());
    group.add(createLaneBooth());

    const console = createLaneConsole(label);
    console.group.position.set(-4.9, 0, 0);
    group.add(console.group);

    const target = createLaneTarget(label);
    target.group.position.set(40, 0, 0);
    group.add(target.group);

    return {
      id,
      label,
      group,
      startPosition: new THREE.Vector3(-3.2, 0, z),
      console,
      target
    };
  }

  function beginSession(lane) {
    sessionState.activeLaneId = lane.id;
    sessionState.totalScore = 0;
    sessionState.lastScore = null;
    sessionState.shotsTaken = 0;
    sessionState.complete = false;

    for (const candidate of lanes) {
      resetTargetCanvas(candidate.target);
    }
  }

  function resolveNearbyLaneId(playerPosition) {
    if (!playerPosition?.isVector3) {
      return null;
    }

    let closestLane = null;
    let closestDistanceSq = START_RADIUS * START_RADIUS;
    for (const lane of lanes) {
      const startPosition = group.localToWorld(lane.startPosition.clone());
      const distanceSq = startPosition.distanceToSquared(playerPosition);
      if (distanceSq <= closestDistanceSq) {
        closestDistanceSq = distanceSq;
        closestLane = lane;
      }
    }

    return closestLane?.id || null;
  }

  function resolveShot(origin, direction) {
    const targetMeshes = lanes.map((lane) => lane.target.paperMesh);
    RANGE_RAYCASTER.set(origin, direction);
    const hits = RANGE_RAYCASTER.intersectObjects(targetMeshes, false);
    const activeLane = getLaneById(sessionState.activeLaneId);

    if (!hits.length) {
      return registerSessionShot(activeLane, null, {
        message: activeLane ? 'Miss' : 'Start a session in a booth first'
      });
    }

    const hit = hits[0];
    const lane = lanes.find((candidate) => candidate.target.paperMesh === hit.object) || null;
    if (!lane) {
      return { hit: false, message: 'No lane found' };
    }

    lane.target.paperMesh.worldToLocal(LOCAL_HIT_POINT.copy(hit.point));
    stampImpact(lane.target, LOCAL_HIT_POINT.x, LOCAL_HIT_POINT.y);

    if (!activeLane) {
      return {
        hit: true,
        laneId: lane.id,
        message: `${lane.label} hit. Press E in a booth to start scoring`
      };
    }

    if (activeLane.id !== lane.id) {
      return registerSessionShot(activeLane, null, {
        message: `Wrong target. ${activeLane.label} is active`
      });
    }

    const score = computeShotScore(LOCAL_HIT_POINT.x, LOCAL_HIT_POINT.y);
    return registerSessionShot(activeLane, score, {
      hit: true,
      laneId: lane.id
    });
  }

  function registerSessionShot(activeLane, score, result = {}) {
    if (!activeLane || sessionState.complete) {
      return result;
    }

    sessionState.shotsTaken += 1;
    sessionState.lastScore = Number.isFinite(score) ? score : 0;
    sessionState.totalScore += sessionState.lastScore;
    if (sessionState.shotsTaken >= SHOT_LIMIT) {
      sessionState.complete = true;
      return {
        ...result,
        hit: Number.isFinite(score),
        score: sessionState.lastScore,
        message: `${activeLane.label} complete: ${sessionState.totalScore.toFixed(1)} pts`
      };
    }

    return {
      ...result,
      hit: Number.isFinite(score),
      score: sessionState.lastScore,
      message: Number.isFinite(score)
        ? `${activeLane.label}: ${sessionState.lastScore.toFixed(1)} pts`
        : `${activeLane.label}: miss`
    };
  }

  function computeShotScore(localX, localY) {
    const radius = Math.hypot(localX, localY);
    if (radius > SCORE_RADIUS) {
      return 0;
    }
    if (radius <= BULL_RADIUS) {
      return 10;
    }

    const normalized = THREE.MathUtils.clamp(radius / SCORE_RADIUS, 0, 1);
    return Math.round((10 * (1 - normalized)) * 10) / 10;
  }

  function syncLaneVisuals() {
    for (const lane of lanes) {
      const isNearby = lane.id === nearbyLaneId;
      const isActive = lane.id === sessionState.activeLaneId;
      const lightMaterial = lane.console.light.material;
      lightMaterial.color.set(isActive ? '#4de294' : isNearby ? '#7cc6ff' : '#6d7583');
      lightMaterial.emissive?.set?.(isActive ? '#2dd078' : isNearby ? '#4f9ee8' : '#000000');

      const frameMaterial = lane.target.frame.material;
      frameMaterial.color.set(isActive ? '#efe3b3' : '#ddd6c2');
    }
  }
}

function markNoGround(object) {
  object.traverse((child) => {
    if (!child?.isMesh) {
      return;
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material?.userData) {
        material.userData.noGround = true;
      }
    }
  });
  return object;
}

function createRangePad() {
  const group = new THREE.Group();

  const concrete = new THREE.Mesh(
    new THREE.BoxGeometry(52, 0.12, 38),
    new THREE.MeshStandardMaterial({
      color: '#6f747d',
      roughness: 0.98,
      metalness: 0.02
    })
  );
  concrete.position.y = -0.06;
  concrete.receiveShadow = true;
  group.add(concrete);

  const firingLine = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 0.36),
    new THREE.MeshBasicMaterial({ color: '#f7f7f2' })
  );
  firingLine.rotation.x = -Math.PI / 2;
  firingLine.position.set(0, 0.01, 0);
  firingLine.userData.noCollision = true;
  firingLine.userData.noSuspension = true;
  group.add(firingLine);

  return group;
}

function createRangeBackstop() {
  const group = new THREE.Group();

  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 4.4, 38),
    new THREE.MeshStandardMaterial({
      color: '#3b3128',
      roughness: 1
    })
  );
  wall.position.set(42.8, 2.2, 0);
  wall.castShadow = true;
  wall.receiveShadow = true;
  group.add(wall);

  return markNoGround(group);
}

function createRangeRoof() {
  const group = new THREE.Group();
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(14, 0.16, 38),
    new THREE.MeshStandardMaterial({
      color: '#242b34',
      roughness: 0.94,
      metalness: 0.04
    })
  );
  roof.position.set(-3.8, 2.9, 0);
  roof.castShadow = true;
  roof.receiveShadow = true;
  group.add(roof);

  return markNoGround(group);
}

function createRangeDividerWall(z) {
  const divider = new THREE.Mesh(
    new THREE.BoxGeometry(18, 2.4, 0.18),
    new THREE.MeshStandardMaterial({
      color: '#2d3138',
      roughness: 0.96,
      metalness: 0.03
    })
  );
  divider.position.set(-1, 1.2, z);
  divider.castShadow = true;
  divider.receiveShadow = true;
  return markNoGround(divider);
}

function createLaneFloorMark() {
  const group = new THREE.Group();
  const laneStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 8.6),
    new THREE.MeshBasicMaterial({
      color: '#0d141c',
      transparent: true,
      opacity: 0.24
    })
  );
  laneStrip.rotation.x = -Math.PI / 2;
  laneStrip.position.set(17.5, 0.012, 0);
  laneStrip.userData.noCollision = true;
  laneStrip.userData.noSuspension = true;
  group.add(laneStrip);

  return group;
}

function createLaneBooth() {
  const group = new THREE.Group();

  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.18, 2.2),
    new THREE.MeshStandardMaterial({
      color: '#56463a',
      roughness: 0.94
    })
  );
  bench.position.set(-3.7, 1.04, 0);
  bench.castShadow = true;
  bench.receiveShadow = true;
  group.add(bench);

  const legs = [
    [-4.45, 0.52, -0.8],
    [-2.95, 0.52, -0.8],
    [-4.45, 0.52, 0.8],
    [-2.95, 0.52, 0.8]
  ];
  for (const [x, y, z] of legs) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 1.04, 0.12),
      new THREE.MeshStandardMaterial({
        color: '#292b2e',
        roughness: 0.88,
        metalness: 0.2
      })
    );
    leg.position.set(x, y, z);
    leg.castShadow = true;
    group.add(leg);
  }

  return markNoGround(group);
}

function createLaneConsole(label) {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.36, 1.1, 18),
    new THREE.MeshStandardMaterial({
      color: '#313843',
      roughness: 0.86,
      metalness: 0.22
    })
  );
  base.position.y = 0.55;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.12, 18),
    new THREE.MeshStandardMaterial({
      color: '#151d26',
      roughness: 0.58,
      metalness: 0.32
    })
  );
  cap.position.y = 1.14;
  cap.castShadow = true;
  group.add(cap);

  const light = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.04, 18),
    new THREE.MeshStandardMaterial({
      color: '#6d7583',
      emissive: '#000000',
      roughness: 0.24,
      metalness: 0.08
    })
  );
  light.position.y = 1.22;
  group.add(light);

  const labelMesh = createLabelPlane(label, 1.4, 0.34, {
    font: 'bold 48px sans-serif',
    fillStyle: '#e9eef9'
  });
  labelMesh.position.set(0, 1.54, 0);
  labelMesh.rotation.y = -Math.PI * 0.5;
  group.add(labelMesh);

  return { group: markNoGround(group), light };
}

function createLaneTarget(label) {
  const group = new THREE.Group();

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 1.8, 1.42),
    new THREE.MeshStandardMaterial({
      color: '#ddd6c2',
      roughness: 0.88
    })
  );
  frame.position.set(0, 1.55, 0);
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);

  const backer = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, PAPER_HEIGHT + 0.18, PAPER_WIDTH + 0.18),
    new THREE.MeshStandardMaterial({
      color: '#856c4e',
      roughness: 0.92
    })
  );
  backer.position.set(0.02, 1.55, 0);
  backer.castShadow = true;
  backer.receiveShadow = true;
  group.add(backer);

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const paperMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(PAPER_WIDTH, PAPER_HEIGHT),
    new THREE.MeshStandardMaterial({
      map: texture,
      side: THREE.DoubleSide,
      roughness: 0.96
    })
  );
  paperMesh.position.set(-0.05, 1.55, 0);
  paperMesh.rotation.y = Math.PI * 0.5;
  paperMesh.castShadow = true;
  paperMesh.receiveShadow = true;
  group.add(paperMesh);

  const legs = [
    [0.22, 0.8, -0.52],
    [0.22, 0.8, 0.52]
  ];
  for (const [x, y, z] of legs) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 1.6, 0.09),
      new THREE.MeshStandardMaterial({
        color: '#6a563f',
        roughness: 0.94
      })
    );
    leg.position.set(x, y, z);
    leg.castShadow = true;
    group.add(leg);
  }

  const labelMesh = createLabelPlane(label, 1.6, 0.34, {
    font: 'bold 44px sans-serif',
    fillStyle: '#f1f2ee'
  });
  labelMesh.position.set(0.32, 2.55, 0);
  labelMesh.rotation.y = -Math.PI * 0.5;
  group.add(labelMesh);

  const target = {
    group: markNoGround(group),
    frame,
    paperMesh,
    canvas,
    ctx,
    texture
  };
  resetTargetCanvas(target);
  return target;
}

function resetTargetCanvas(target) {
  const { ctx, canvas, texture } = target;
  if (!ctx || !canvas || !texture) {
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#efe8db';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const centerX = canvas.width * 0.5;
  const centerY = canvas.height * 0.5;
  const rings = [
    { radius: 320, fill: '#f2efe8', stroke: '#161616', line: 5 },
    { radius: 244, fill: '#c9433d', stroke: '#161616', line: 5 },
    { radius: 164, fill: '#161616', stroke: '#f3f0e8', line: 4 },
    { radius: 90, fill: '#d1a42b', stroke: '#161616', line: 4 },
    { radius: 48, fill: '#d96855', stroke: '#161616', line: 3 }
  ];

  for (const ring of rings) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, ring.radius, 0, Math.PI * 2);
    ctx.fillStyle = ring.fill;
    ctx.fill();
    ctx.lineWidth = ring.line;
    ctx.strokeStyle = ring.stroke;
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(20, 20, 20, 0.42)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX - 24, centerY);
  ctx.lineTo(centerX + 24, centerY);
  ctx.moveTo(centerX, centerY - 24);
  ctx.lineTo(centerX, centerY + 24);
  ctx.stroke();

  texture.needsUpdate = true;
}

function stampImpact(target, localX, localY) {
  const { ctx, canvas, texture } = target;
  if (!ctx || !canvas || !texture) {
    return;
  }

  const u = THREE.MathUtils.clamp((localX / PAPER_WIDTH) + 0.5, 0, 1);
  const v = THREE.MathUtils.clamp(1 - ((localY / PAPER_HEIGHT) + 0.5), 0, 1);
  const px = u * canvas.width;
  const py = v * canvas.height;
  const radius = IMPACT_RADIUS * canvas.width;

  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#111111';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.stroke();

  texture.needsUpdate = true;
}

function createLabelPlane(label, width, height, style = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = style.font || 'bold 52px sans-serif';
  ctx.fillStyle = style.fillStyle || '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width * 0.5, canvas.height * 0.5);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide
    })
  );
  mesh.userData.noCollision = true;
  mesh.userData.noSuspension = true;
  return mesh;
}
