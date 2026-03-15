import fs from 'fs';
import path from 'path';
import { createCanvas } from 'canvas';

const TEXTURES_DIR = path.join(process.cwd(), 'public/textures');

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function lerpColor(c1, c2, t) {
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * t),
    g: Math.round(c1.g + (c2.g - c1.g) * t),
    b: Math.round(c1.b + (c2.b - c1.b) * t)
  };
}

function addNoise(color, amount) {
  const noise = Math.floor((Math.random() - 0.5) * amount * 2);
  return {
    r: Math.max(0, Math.min(255, color.r + noise)),
    g: Math.max(0, Math.min(255, color.g + noise)),
    b: Math.max(0, Math.min(255, color.b + noise))
  };
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

// ============================================================
// BRICK TEXTURES (15)
// ============================================================

function createBrick(ctx, w, h, baseColor, mortarColor, brickW, brickH) {
  ctx.fillStyle = `rgb(${mortarColor.r},${mortarColor.g},${mortarColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  const mortarSize = 2;
  for (let row = 0; row < h / brickH + 1; row++) {
    const offset = (row % 2) * (brickW / 2);
    for (let col = -1; col < w / brickW + 1; col++) {
      const x = col * brickW + offset;
      const y = row * brickH;
      
      let brickColor;
      const variation = Math.random();
      if (variation < 0.2) {
        brickColor = lerpColor(baseColor, hexToRgb('#000000'), Math.random() * 0.2);
      } else if (variation < 0.4) {
        brickColor = lerpColor(baseColor, hexToRgb('#ffffff'), Math.random() * 0.15);
      } else {
        brickColor = addNoise(baseColor, 20);
      }
      
      ctx.fillStyle = `rgb(${brickColor.r},${brickColor.g},${brickColor.b})`;
      ctx.fillRect(x + mortarSize, y + mortarSize, brickW - mortarSize * 2, brickH - mortarSize * 2);
    }
  }
}

const BRICK_TEXTURES = [
  { name: 'brick_red', fn: (ctx, w, h) => createBrick(ctx, w, h, hexToRgb('#a85848'), hexToRgb('#d8c8b8'), 24, 12) },
  { name: 'brick_brown', fn: (ctx, w, h) => createBrick(ctx, w, h, hexToRgb('#8a6858'), hexToRgb('#c8b8a8'), 24, 12) },
  { name: 'brick_orange', fn: (ctx, w, h) => createBrick(ctx, w, h, hexToRgb('#c87848'), hexToRgb('#d8c8b8'), 24, 12) },
  { name: 'brick_tan', fn: (ctx, w, h) => createBrick(ctx, w, h, hexToRgb('#b89878'), hexToRgb('#e0d8c8'), 24, 12) },
  { name: 'brick_white', fn: (ctx, w, h) => createBrick(ctx, w, h, hexToRgb('#e8e0d8'), hexToRgb('#f0ebe5'), 24, 12) },
  { name: 'brick_gray', fn: (ctx, w, h) => createBrick(ctx, w, h, hexToRgb('#888888'), hexToRgb('#c8c8c8'), 24, 12) },
  { name: 'brick_aged', fn: (ctx, w, h) => createBrick(ctx, w, h, hexToRgb('#987868'), hexToRgb('#b8a898'), 22, 10) },
  { name: 'brick_large_red', fn: (ctx, w, h) => createBrick(ctx, w, h, hexToRgb('#b86050'), hexToRgb('#d0c0b0'), 32, 16) },
  { name: 'brick_thin_brown', fn: (ctx, w, h) => createBrick(ctx, w, h, hexToRgb('#7a5848'), hexToRgb('#b0a090'), 28, 8) },
  { name: 'brick_english', fn: (ctx, w, h) => createBrick(ctx, w, h, hexToRgb('#a05040'), hexToRgb('#c8b8a8'), 20, 10) },
  { name: 'brick_weathered', fn: (ctx, w, h) => {
    createBrick(ctx, w, h, hexToRgb('#907060'), hexToRgb('#a89888'), 24, 12);
    for (let i = 0; i < 100; i++) {
      ctx.fillStyle = `rgba(80,60,50,${Math.random() * 0.15})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, rand(2,8), rand(2,8));
    }
  }},
  { name: 'brick_painted_white', fn: (ctx, w, h) => {
    createBrick(ctx, w, h, hexToRgb('#c8c0b8'), hexToRgb('#d8d0c8'), 24, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(0, 0, w, h);
  }},
  { name: 'brick_painted_cream', fn: (ctx, w, h) => {
    createBrick(ctx, w, h, hexToRgb('#b8b0a8'), hexToRgb('#c8c0b8'), 24, 12);
    ctx.fillStyle = 'rgba(245,240,230,0.5)';
    ctx.fillRect(0, 0, w, h);
  }},
  { name: 'brick_sandstone', fn: (ctx, w, h) => createBrick(ctx, w, h, hexToRgb('#c8a878'), hexToRgb('#e0d0b8'), 26, 12) },
  { name: 'brick_modular', fn: (ctx, w, h) => createBrick(ctx, w, h, hexToRgb('#9a5848'), hexToRgb('#c0b0a0'), 28, 14) },
];

// ============================================================
// SIDING TEXTURES (12)
// ============================================================

function createSiding(ctx, w, h, baseColor, boardH, revealSize) {
  ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  for (let row = 0; row < h / boardH + 1; row++) {
    const y = row * boardH;
    const shade = (row % 2) * 6 - 3;
    const boardColor = addNoise(lerpColor(baseColor, hexToRgb(shade > 0 ? '#ffffff' : '#000000'), Math.abs(shade) / 50), 12);
    ctx.fillStyle = `rgb(${boardColor.r},${boardColor.g},${boardColor.b})`;
    ctx.fillRect(0, y, w, boardH - revealSize);
    
    ctx.fillStyle = `rgba(0,0,0,0.12)`;
    ctx.fillRect(0, y + boardH - revealSize, w, revealSize);
  }
}

const SIDING_TEXTURES = [
  { name: 'siding_beige', fn: (ctx, w, h) => createSiding(ctx, w, h, hexToRgb('#d8c8b0'), 10, 1) },
  { name: 'siding_white', fn: (ctx, w, h) => createSiding(ctx, w, h, hexToRgb('#f0e8dc'), 10, 1) },
  { name: 'siding_gray', fn: (ctx, w, h) => createSiding(ctx, w, h, hexToRgb('#a8a8a8'), 10, 1) },
  { name: 'siding_blue', fn: (ctx, w, h) => createSiding(ctx, w, h, hexToRgb('#7898b8'), 10, 1) },
  { name: 'siding_green', fn: (ctx, w, h) => createSiding(ctx, w, h, hexToRgb('#88a890'), 10, 1) },
  { name: 'siding_tan', fn: (ctx, w, h) => createSiding(ctx, w, h, hexToRgb('#c8b098'), 10, 1) },
  { name: 'siding_cream', fn: (ctx, w, h) => createSiding(ctx, w, h, hexToRgb('#e8dcc8'), 10, 1) },
  { name: 'siding_brown', fn: (ctx, w, h) => createSiding(ctx, w, h, hexToRgb('#8a7060'), 10, 1) },
  { name: 'siding_dutch_lap', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#c8b8a0');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < h / 8 + 1; row++) {
      const y = row * 8;
      const gradient = ctx.createLinearGradient(0, y, 0, y + 8);
      gradient.addColorStop(0, 'rgba(0,0,0,0.1)');
      gradient.addColorStop(0.3, 'rgba(255,255,255,0.05)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.05)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, y, w, 8);
    }
  }},
  { name: 'siding_vertical', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#b8a890');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let col = 0; col < w / 6 + 1; col++) {
      const x = col * 6;
      ctx.fillStyle = `rgba(0,0,0,0.08)`;
      ctx.fillRect(x, 0, 1, h);
    }
  }},
  { name: 'siding_wide', fn: (ctx, w, h) => createSiding(ctx, w, h, hexToRgb('#d0c4b4'), 14, 1.5) },
  { name: 'siding_narrow', fn: (ctx, w, h) => createSiding(ctx, w, h, hexToRgb('#c8bcb0'), 6, 0.8) },
  { name: 'siding_wood_grain', fn: (ctx, w, h) => {
    createSiding(ctx, w, h, hexToRgb('#b8a080'), 10, 1);
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = `rgba(100,80,60,${Math.random() * 0.1})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, rand(20,60), 1);
    }
  }},
];

// ============================================================
// STUCCO TEXTURES (8)
// ============================================================

function createStucco(ctx, w, h, baseColor) {
  ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const size = Math.random() * 3 + 1;
    const noise = addNoise(baseColor, 25);
    ctx.fillStyle = `rgb(${noise.r},${noise.g},${noise.b})`;
    ctx.fillRect(x, y, size, size);
  }
}

const STUCCO_TEXTURES = [
  { name: 'stucco_white', fn: (ctx, w, h) => createStucco(ctx, w, h, hexToRgb('#f0e8dc')) },
  { name: 'stucco_cream', fn: (ctx, w, h) => createStucco(ctx, w, h, hexToRgb('#e8dcc8')) },
  { name: 'stucco_tan', fn: (ctx, w, h) => createStucco(ctx, w, h, hexToRgb('#d8c8a8')) },
  { name: 'stucco_peach', fn: (ctx, w, h) => createStucco(ctx, w, h, hexToRgb('#e8c8a8')) },
  { name: 'stucco_gray', fn: (ctx, w, h) => createStucco(ctx, w, h, hexToRgb('#b8b8b8')) },
  { name: 'stucco_sand', fn: (ctx, w, h) => createStucco(ctx, w, h, hexToRgb('#d0c0a0')) },
  { name: 'stucco_pink', fn: (ctx, w, h) => createStucco(ctx, w, h, hexToRgb('#e0c0b8')) },
  { name: 'stucco_santa_fe', fn: (ctx, w, h) => createStucco(ctx, w, h, hexToRgb('#c8a890')) },
];

// ============================================================
// WOOD TEXTURES (8)
// ============================================================

function createWoodPlank(ctx, w, h, baseColor, plankW) {
  ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  for (let col = 0; col < w / plankW + 1; col++) {
    const x = col * plankW;
    const variation = Math.random();
    let plankColor;
    if (variation < 0.3) {
      plankColor = lerpColor(baseColor, hexToRgb('#000000'), Math.random() * 0.15);
    } else {
      plankColor = addNoise(baseColor, 15);
    }
    
    ctx.fillStyle = `rgb(${plankColor.r},${plankColor.g},${plankColor.b})`;
    ctx.fillRect(x, 0, plankW - 1, h);
    
    ctx.fillStyle = `rgba(0,0,0,0.15)`;
    ctx.fillRect(x + plankW - 1, 0, 1, h);
  }
  
  for (let i = 0; i < 150; i++) {
    ctx.fillStyle = `rgba(60,40,20,${Math.random() * 0.15})`;
    const x = Math.floor(Math.random() * (w / plankW)) * plankW;
    ctx.fillRect(x, Math.random() * h, rand(10, 40), 1);
  }
}

const WOOD_TEXTURES = [
  { name: 'wood_cedar', fn: (ctx, w, h) => createWoodPlank(ctx, w, h, hexToRgb('#a07050'), 12) },
  { name: 'wood_redwood', fn: (ctx, w, h) => createWoodPlank(ctx, w, h, hexToRgb('#885040'), 12) },
  { name: 'wood_pine', fn: (ctx, w, h) => createWoodPlank(ctx, w, h, hexToRgb('#c8a878'), 10) },
  { name: 'wood_oak', fn: (ctx, w, h) => createWoodPlank(ctx, w, h, hexToRgb('#a08060'), 14) },
  { name: 'wood_weathered', fn: (ctx, w, h) => createWoodPlank(ctx, w, h, hexToRgb('#908878'), 12) },
  { name: 'wood_whitewash', fn: (ctx, w, h) => {
    createWoodPlank(ctx, w, h, hexToRgb('#b8a090'), 12);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(0, 0, w, h);
  }},
  { name: 'wood_painted_blue', fn: (ctx, w, h) => {
    createWoodPlank(ctx, w, h, hexToRgb('#808080'), 12);
    ctx.fillStyle = 'rgba(100,140,180,0.7)';
    ctx.fillRect(0, 0, w, h);
  }},
  { name: 'wood_shiplap', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#c8b8a0');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < h / 8 + 1; row++) {
      const y = row * 8;
      ctx.fillStyle = `rgba(0,0,0,0.1)`;
      ctx.fillRect(0, y, w, 2);
      ctx.fillStyle = `rgba(255,255,255,0.05)`;
      ctx.fillRect(0, y + 2, w, 6);
    }
  }},
];

// ============================================================
// CONCRETE TEXTURES (8)
// ============================================================

function createConcrete(ctx, w, h, baseColor, hasJoints = true) {
  ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const noise = addNoise(baseColor, 30);
    ctx.fillStyle = `rgb(${noise.r},${noise.g},${noise.b})`;
    ctx.fillRect(x, y, Math.random() * 4 + 1, Math.random() * 4 + 1);
  }
  
  if (hasJoints) {
    ctx.strokeStyle = `rgba(60,60,60,0.25)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.33);
    ctx.lineTo(w, h * 0.33);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, h * 0.66);
    ctx.lineTo(w, h * 0.66);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w * 0.5, 0);
    ctx.lineTo(w * 0.5, h);
    ctx.stroke();
  }
}

const CONCRETE_TEXTURES = [
  { name: 'concrete_gray', fn: (ctx, w, h) => createConcrete(ctx, w, h, hexToRgb('#a0a0a0')) },
  { name: 'concrete_light', fn: (ctx, w, h) => createConcrete(ctx, w, h, hexToRgb('#c0c0c0')) },
  { name: 'concrete_dark', fn: (ctx, w, h) => createConcrete(ctx, w, h, hexToRgb('#707070')) },
  { name: 'concrete_tan', fn: (ctx, w, h) => createConcrete(ctx, w, h, hexToRgb('#a89888')) },
  { name: 'concrete_poured', fn: (ctx, w, h) => createConcrete(ctx, w, h, hexToRgb('#909090'), false) },
  { name: 'concrete_exposed', fn: (ctx, w, h) => {
    createConcrete(ctx, w, h, hexToRgb('#989898'), false);
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = `rgba(120,110,100,${Math.random() * 0.4})`;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, rand(2,6), 0, Math.PI * 2);
      ctx.fill();
    }
  }},
  { name: 'concrete_block', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#909090');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    const blockH = 16;
    const blockW = 32;
    for (let row = 0; row < h / blockH + 1; row++) {
      const offset = (row % 2) * (blockW / 2);
      for (let col = -1; col < w / blockW + 1; col++) {
        const x = col * blockW + offset;
        const y = row * blockH;
        ctx.strokeStyle = `rgba(60,60,60,0.3)`;
        ctx.strokeRect(x, y, blockW, blockH);
        const noise = addNoise(baseColor, 20);
        ctx.fillStyle = `rgb(${noise.r},${noise.g},${noise.b})`;
        ctx.fillRect(x + 1, y + 1, blockW - 2, blockH - 2);
      }
    }
  }},
  { name: 'concrete_precast', fn: (ctx, w, h) => {
    createConcrete(ctx, w, h, hexToRgb('#a8a8a8'), false);
    ctx.strokeStyle = `rgba(80,80,80,0.2)`;
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, w - 8, h - 8);
  }},
];

// ============================================================
// METAL TEXTURES (8)
// ============================================================

function createCorrugatedMetal(ctx, w, h, baseColor) {
  ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  const ridgeW = 6;
  for (let col = 0; col < w / ridgeW + 1; col++) {
    const x = col * ridgeW;
    const gradient = ctx.createLinearGradient(x, 0, x + ridgeW, 0);
    const light = addNoise(lerpColor(baseColor, hexToRgb('#ffffff'), 0.15), 10);
    const dark = addNoise(lerpColor(baseColor, hexToRgb('#000000'), 0.15), 10);
    gradient.addColorStop(0, `rgb(${dark.r},${dark.g},${dark.b})`);
    gradient.addColorStop(0.5, `rgb(${light.r},${light.g},${light.b})`);
    gradient.addColorStop(1, `rgb(${dark.r},${dark.g},${dark.b})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, 0, ridgeW, h);
  }
  
  for (let i = 0; i < 100; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.1})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, Math.random() * 3, Math.random() * 8);
  }
}

function createMetalPanel(ctx, w, h, baseColor) {
  ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  const panelW = 16;
  for (let col = 0; col < w / panelW + 1; col++) {
    const x = col * panelW;
    const gradient = ctx.createLinearGradient(x, 0, x + panelW, 0);
    const light = addNoise(lerpColor(baseColor, hexToRgb('#ffffff'), 0.1), 8);
    const dark = addNoise(lerpColor(baseColor, hexToRgb('#000000'), 0.1), 8);
    gradient.addColorStop(0, `rgb(${dark.r},${dark.g},${dark.b})`);
    gradient.addColorStop(0.5, `rgb(${light.r},${light.g},${light.b})`);
    gradient.addColorStop(1, `rgb(${dark.r},${dark.g},${dark.b})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, 0, panelW, h);
  }
}

const METAL_TEXTURES = [
  { name: 'metal_corrugated', fn: (ctx, w, h) => createCorrugatedMetal(ctx, w, h, hexToRgb('#707070')) },
  { name: 'metal_corrugated_rust', fn: (ctx, w, h) => {
    createCorrugatedMetal(ctx, w, h, hexToRgb('#806858'));
    for (let i = 0; i < 50; i++) {
      ctx.fillStyle = `rgba(140,80,50,${Math.random() * 0.4})`;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, rand(3,12), 0, Math.PI * 2);
      ctx.fill();
    }
  }},
  { name: 'metal_panel', fn: (ctx, w, h) => createMetalPanel(ctx, w, h, hexToRgb('#888888')) },
  { name: 'metal_panel_blue', fn: (ctx, w, h) => createMetalPanel(ctx, w, h, hexToRgb('#5878a8')) },
  { name: 'metal_panel_green', fn: (ctx, w, h) => createMetalPanel(ctx, w, h, hexToRgb('#689078')) },
  { name: 'metal_standing_seam', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#808080');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let col = 0; col < w; col += 18) {
      ctx.fillStyle = `rgba(255,255,255,0.1)`;
      ctx.fillRect(col, 0, 3, h);
      ctx.fillStyle = `rgba(0,0,0,0.15)`;
      ctx.fillRect(col + 3, 0, 1, h);
    }
  }},
  { name: 'metal_aluminum', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#a8a8a8');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(200,200,200,${Math.random() * 0.2})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, rand(1,3), rand(1,3));
    }
  }},
  { name: 'metal_copper', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#b87858');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = `rgba(60,100,80,${Math.random() * 0.3})`;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, rand(4,15), 0, Math.PI * 2);
      ctx.fill();
    }
  }},
];

// ============================================================
// STONE TEXTURES (8)
// ============================================================

function createStoneVeneer(ctx, w, h, baseColors) {
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);
  
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const stoneW = rand(15, 35);
    const stoneH = rand(10, 25);
    const color = baseColors[randInt(0, baseColors.length - 1)];
    const stoneColor = addNoise(color, 20);
    
    ctx.fillStyle = `rgb(${stoneColor.r},${stoneColor.g},${stoneColor.b})`;
    ctx.beginPath();
    ctx.moveTo(x + rand(0,3), y);
    ctx.lineTo(x + stoneW - rand(0,3), y + rand(0,2));
    ctx.lineTo(x + stoneW, y + stoneH - rand(0,2));
    ctx.lineTo(x + rand(0,3), y + stoneH);
    ctx.closePath();
    ctx.fill();
    
    ctx.strokeStyle = `rgba(0,0,0,0.2)`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

const STONE_TEXTURES = [
  { name: 'stone_fieldstone', fn: (ctx, w, h) => createStoneVeneer(ctx, w, h, [
    hexToRgb('#888078'), hexToRgb('#706860'), hexToRgb('#989088'), hexToRgb('#605850')
  ])},
  { name: 'stone_limestone', fn: (ctx, w, h) => createStoneVeneer(ctx, w, h, [
    hexToRgb('#c8c0b0'), hexToRgb('#b8b0a0'), hexToRgb('#d8d0c0'), hexToRgb('#a8a090')
  ])},
  { name: 'stone_granite', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#888888');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      const colors = ['#ffffff', '#000000', '#a0a0c0', '#c0a0a0'];
      ctx.fillStyle = colors[randInt(0, 3)];
      ctx.fillRect(Math.random() * w, Math.random() * h, rand(1,3), rand(1,3));
    }
  }},
  { name: 'stone_slate', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#505050');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < h / 12 + 1; row++) {
      const y = row * 12;
      const shade = row % 2 === 0 ? 10 : -10;
      ctx.fillStyle = `rgb(${baseColor.r + shade},${baseColor.g + shade},${baseColor.b + shade})`;
      ctx.fillRect(0, y, w, 11);
    }
  }},
  { name: 'stone_rubble', fn: (ctx, w, h) => createStoneVeneer(ctx, w, h, [
    hexToRgb('#786858'), hexToRgb('#887868'), hexToRgb('#685848'), hexToRgb('#8a7a6a')
  ])},
  { name: 'stone_bluestone', fn: (ctx, w, h) => createStoneVeneer(ctx, w, h, [
    hexToRgb('#607080'), hexToRgb('#506070'), hexToRgb('#708090'), hexToRgb('#405060')
  ])},
  { name: 'stone_sandstone', fn: (ctx, w, h) => createStoneVeneer(ctx, w, h, [
    hexToRgb('#c8a878'), hexToRgb('#b89868'), hexToRgb('#d8b888'), hexToRgb('#a88858')
  ])},
  { name: 'stone_cobble', fn: (ctx, w, h) => {
    ctx.fillStyle = '#707070';
    ctx.fillRect(0, 0, w, h);
    const size = 12;
    for (let row = 0; row < h / size + 1; row++) {
      const offset = (row % 2) * (size / 2);
      for (let col = 0; col < w / size + 1; col++) {
        const x = col * size + offset + rand(-1,1);
        const y = row * size + rand(-1,1);
        const color = addNoise(hexToRgb('#606060'), 30);
        ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
        ctx.beginPath();
        ctx.arc(x + size/2, y + size/2, size/2 - 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }},
];

// ============================================================
// ROOF TEXTURES (10)
// ============================================================

function createShingles(ctx, w, h, baseColor) {
  ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  const shingleH = 8;
  const shingleW = 12;
  
  for (let row = 0; row < h / shingleH + 1; row++) {
    const offset = (row % 2) * (shingleW / 2);
    for (let col = -1; col < w / shingleW + 1; col++) {
      const x = col * shingleW + offset;
      const y = row * shingleH;
      
      let shingleColor;
      const variation = Math.random();
      if (variation < 0.25) {
        shingleColor = lerpColor(baseColor, hexToRgb('#ffffff'), Math.random() * 0.1);
      } else if (variation < 0.4) {
        shingleColor = lerpColor(baseColor, hexToRgb('#000000'), Math.random() * 0.15);
      } else {
        shingleColor = addNoise(baseColor, 15);
      }
      
      ctx.fillStyle = `rgb(${shingleColor.r},${shingleColor.g},${shingleColor.b})`;
      ctx.fillRect(x, y, shingleW - 1, shingleH - 1);
    }
  }
}

const ROOF_TEXTURES = [
  { name: 'roof_shingles_brown', fn: (ctx, w, h) => createShingles(ctx, w, h, hexToRgb('#5a4838')) },
  { name: 'roof_shingles_black', fn: (ctx, w, h) => createShingles(ctx, w, h, hexToRgb('#383838')) },
  { name: 'roof_shingles_gray', fn: (ctx, w, h) => createShingles(ctx, w, h, hexToRgb('#606060')) },
  { name: 'roof_shingles_red', fn: (ctx, w, h) => createShingles(ctx, w, h, hexToRgb('#885048')) },
  { name: 'roof_shingles_green', fn: (ctx, w, h) => createShingles(ctx, w, h, hexToRgb('#506048')) },
  { name: 'roof_shingles_blue', fn: (ctx, w, h) => createShingles(ctx, w, h, hexToRgb('#485868')) },
  { name: 'roof_tile_clay', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#b87050');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < h / 10 + 1; row++) {
      for (let col = 0; col < w / 8 + 1; col++) {
        const x = col * 8;
        const y = row * 10;
        const tileColor = addNoise(baseColor, 25);
        ctx.fillStyle = `rgb(${tileColor.r},${tileColor.g},${tileColor.b})`;
        ctx.beginPath();
        ctx.arc(x + 4, y + 10, 6, Math.PI, 0);
        ctx.fill();
      }
    }
  }},
  { name: 'roof_tile_slate', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#404850');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < h / 6 + 1; row++) {
      const offset = (row % 2) * 8;
      for (let col = -1; col < w / 16 + 1; col++) {
        const x = col * 16 + offset;
        const y = row * 6;
        const tileColor = addNoise(baseColor, 15);
        ctx.fillStyle = `rgb(${tileColor.r},${tileColor.g},${tileColor.b})`;
        ctx.fillRect(x, y, 15, 5);
      }
    }
  }},
  { name: 'roof_metal', fn: (ctx, w, h) => createCorrugatedMetal(ctx, w, h, hexToRgb('#606870')) },
  { name: 'roof_flat', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#585858');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1000; i++) {
      const noise = addNoise(baseColor, 20);
      ctx.fillStyle = `rgb(${noise.r},${noise.g},${noise.b})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, rand(2,5), rand(2,5));
    }
  }},
];

// ============================================================
// GLASS TEXTURES (6)
// ============================================================

const GLASS_TEXTURES = [
  { name: 'glass_blue', fn: (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, 'rgb(100,140,180)');
    gradient.addColorStop(0.5, 'rgb(140,180,220)');
    gradient.addColorStop(1, 'rgb(80,120,160)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w * 0.3, 0);
    ctx.lineTo(0, h * 0.2);
    ctx.closePath();
    ctx.fill();
  }},
  { name: 'glass_green', fn: (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, 'rgb(80,140,100)');
    gradient.addColorStop(0.5, 'rgb(120,180,140)');
    gradient.addColorStop(1, 'rgb(60,120,80)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w * 0.4, 0);
    ctx.lineTo(0, h * 0.3);
    ctx.closePath();
    ctx.fill();
  }},
  { name: 'glass_gray', fn: (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, 'rgb(100,110,120)');
    gradient.addColorStop(0.5, 'rgb(140,150,160)');
    gradient.addColorStop(1, 'rgb(80,90,100)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w * 0.35, 0);
    ctx.lineTo(0, h * 0.25);
    ctx.closePath();
    ctx.fill();
  }},
  { name: 'glass_bronze', fn: (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, 'rgb(140,110,80)');
    gradient.addColorStop(0.5, 'rgb(180,140,100)');
    gradient.addColorStop(1, 'rgb(120,90,60)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w * 0.3, 0);
    ctx.lineTo(0, h * 0.2);
    ctx.closePath();
    ctx.fill();
  }},
  { name: 'glass_clear', fn: (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, 'rgb(200,220,240)');
    gradient.addColorStop(0.5, 'rgb(220,240,255)');
    gradient.addColorStop(1, 'rgb(180,200,220)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w * 0.4, 0);
    ctx.lineTo(0, h * 0.3);
    ctx.closePath();
    ctx.fill();
  }},
  { name: 'glass_mirrored', fn: (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, 'rgb(80,100,120)');
    gradient.addColorStop(0.3, 'rgb(120,150,180)');
    gradient.addColorStop(0.7, 'rgb(100,130,160)');
    gradient.addColorStop(1, 'rgb(60,80,100)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w * 0.5, 0);
    ctx.lineTo(0, h * 0.4);
    ctx.closePath();
    ctx.fill();
  }},
];

// ============================================================
// GROUND TEXTURES (10)
// ============================================================

function createGrass(ctx, w, h, baseColor) {
  ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const variation = Math.random();
    let grassColor;
    if (variation < 0.25) {
      grassColor = addNoise(lerpColor(baseColor, hexToRgb('#ffffff'), 0.1), 10);
    } else if (variation < 0.4) {
      grassColor = addNoise(lerpColor(baseColor, hexToRgb('#000000'), 0.15), 10);
    } else {
      grassColor = addNoise(baseColor, 20);
    }
    ctx.fillStyle = `rgb(${grassColor.r},${grassColor.g},${grassColor.b})`;
    ctx.fillRect(x, y, Math.random() * 2 + 1, Math.random() * 2 + 1);
  }
}

const GROUND_TEXTURES = [
  { name: 'grass_green', fn: (ctx, w, h) => createGrass(ctx, w, h, hexToRgb('#4a8848')) },
  { name: 'grass_light', fn: (ctx, w, h) => createGrass(ctx, w, h, hexToRgb('#68a068')) },
  { name: 'grass_dark', fn: (ctx, w, h) => createGrass(ctx, w, h, hexToRgb('#387038')) },
  { name: 'grass_dry', fn: (ctx, w, h) => createGrass(ctx, w, h, hexToRgb('#8a9860')) },
  { name: 'dirt', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#8a7060');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2000; i++) {
      const noise = addNoise(baseColor, 35);
      ctx.fillStyle = `rgb(${noise.r},${noise.g},${noise.b})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, rand(2,6), rand(2,6));
    }
  }},
  { name: 'gravel', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#909090');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) {
      const color = addNoise(hexToRgb('#808080'), 40);
      ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, rand(1,4), 0, Math.PI * 2);
      ctx.fill();
    }
  }},
  { name: 'sand', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#c8b890');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) {
      const noise = addNoise(baseColor, 20);
      ctx.fillStyle = `rgb(${noise.r},${noise.g},${noise.b})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, rand(1,2), rand(1,2));
    }
  }},
  { name: 'mulch', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#685048');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) {
      const color = addNoise(hexToRgb('#5a4038'), 30);
      ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, rand(3,10), rand(1,3));
    }
  }},
  { name: 'paver_brick', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#a86050');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    const size = 8;
    for (let row = 0; row < h / size + 1; row++) {
      const offset = (row % 2) * (size / 2);
      for (let col = 0; col < w / size + 1; col++) {
        const x = col * size + offset;
        const y = row * size;
        const paverColor = addNoise(baseColor, 20);
        ctx.fillStyle = `rgb(${paverColor.r},${paverColor.g},${paverColor.b})`;
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      }
    }
  }},
  { name: 'asphalt', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#3a3a3a');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 800; i++) {
      const noise = addNoise(baseColor, 25);
      ctx.fillStyle = `rgb(${noise.r},${noise.g},${noise.b})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, rand(1,4), rand(1,4));
    }
  }},
];

// ============================================================
// STOREFRONT TEXTURES (5)
// ============================================================

const STOREFRONT_TEXTURES = [
  { name: 'storefront_glass', fn: (ctx, w, h) => {
    const frameColor = hexToRgb('#4a4a4a');
    const glassColor = hexToRgb('#6a8aa8');
    ctx.fillStyle = `rgb(${frameColor.r},${frameColor.g},${frameColor.b})`;
    ctx.fillRect(0, 0, w, h);
    const paneW = 20;
    const paneH = 30;
    const frameSize = 3;
    for (let row = 0; row < h / paneH; row++) {
      for (let col = 0; col < w / paneW; col++) {
        const x = col * paneW + frameSize;
        const y = row * paneH + frameSize;
        const paneColor = addNoise(glassColor, 15);
        ctx.fillStyle = `rgb(${paneColor.r},${paneColor.g},${paneColor.b})`;
        ctx.fillRect(x, y, paneW - frameSize * 2, paneH - frameSize * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(x + 2, y + 2, (paneW - frameSize * 2) / 3, (paneH - frameSize * 2) / 3);
      }
    }
  }},
  { name: 'storefront_aluminum', fn: (ctx, w, h) => {
    const frameColor = hexToRgb('#a0a0a0');
    const glassColor = hexToRgb('#7898b8');
    ctx.fillStyle = `rgb(${frameColor.r},${frameColor.g},${frameColor.b})`;
    ctx.fillRect(0, 0, w, h);
    const paneW = 24;
    const paneH = 32;
    const frameSize = 4;
    for (let row = 0; row < h / paneH; row++) {
      for (let col = 0; col < w / paneW; col++) {
        const x = col * paneW + frameSize;
        const y = row * paneH + frameSize;
        ctx.fillStyle = `rgb(${glassColor.r},${glassColor.g},${glassColor.b})`;
        ctx.fillRect(x, y, paneW - frameSize * 2, paneH - frameSize * 2);
      }
    }
  }},
  { name: 'storefront_wood', fn: (ctx, w, h) => {
    const frameColor = hexToRgb('#685040');
    const glassColor = hexToRgb('#8aa8c0');
    ctx.fillStyle = `rgb(${frameColor.r},${frameColor.g},${frameColor.b})`;
    ctx.fillRect(0, 0, w, h);
    const paneW = 22;
    const paneH = 28;
    const frameSize = 5;
    for (let row = 0; row < h / paneH; row++) {
      for (let col = 0; col < w / paneW; col++) {
        const x = col * paneW + frameSize;
        const y = row * paneH + frameSize;
        ctx.fillStyle = `rgb(${glassColor.r},${glassColor.g},${glassColor.b})`;
        ctx.fillRect(x, y, paneW - frameSize * 2, paneH - frameSize * 2);
        ctx.strokeStyle = `rgb(${frameColor.r},${frameColor.g},${frameColor.b})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + (paneW - frameSize * 2) / 4, y, (paneW - frameSize * 2) / 2, paneH - frameSize * 2);
      }
    }
  }},
  { name: 'awning_striped', fn: (ctx, w, h) => {
    const stripeW = 8;
    for (let col = 0; col < w / stripeW + 1; col++) {
      const x = col * stripeW;
      ctx.fillStyle = col % 2 === 0 ? '#c84838' : '#f0e8d8';
      ctx.fillRect(x, 0, stripeW, h);
    }
    for (let i = 0; i < 100; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.1})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, rand(2,5), rand(2,5));
    }
  }},
  { name: 'awning_solid', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#b85838');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < h / 4 + 1; row++) {
      const y = row * 4;
      const shade = row % 2 === 0 ? 10 : -10;
      ctx.fillStyle = `rgb(${baseColor.r + shade},${baseColor.g + shade},${baseColor.b + shade})`;
      ctx.fillRect(0, y, w, 3);
    }
  }},
];

// ============================================================
// TILE TEXTURES (5)
// ============================================================

const TILE_TEXTURES = [
  { name: 'tile_terracotta', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#b87050');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    const size = 16;
    for (let row = 0; row < h / size + 1; row++) {
      for (let col = 0; col < w / size + 1; col++) {
        const x = col * size;
        const y = row * size;
        const tileColor = addNoise(baseColor, 20);
        ctx.fillStyle = `rgb(${tileColor.r},${tileColor.g},${tileColor.b})`;
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      }
    }
  }},
  { name: 'tile_ceramic_white', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#f0e8e0');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    const size = 12;
    for (let row = 0; row < h / size + 1; row++) {
      for (let col = 0; col < w / size + 1; col++) {
        const x = col * size;
        const y = row * size;
        ctx.strokeStyle = 'rgba(180,180,180,0.5)';
        ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
      }
    }
  }},
  { name: 'tile_mosaic', fn: (ctx, w, h) => {
    ctx.fillStyle = '#e0d8d0';
    ctx.fillRect(0, 0, w, h);
    const colors = ['#a87058', '#7890a8', '#68a078', '#c8a868', '#a87888'];
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = colors[randInt(0, colors.length - 1)];
      ctx.fillRect(
        Math.floor(Math.random() * (w / 4)) * 4,
        Math.floor(Math.random() * (h / 4)) * 4,
        3, 3
      );
    }
  }},
  { name: 'tile_hexagon', fn: (ctx, w, h) => {
    ctx.fillStyle = '#d0c8c0';
    ctx.fillRect(0, 0, w, h);
    const size = 8;
    const colors = ['#c8c0b8', '#b8b0a8', '#d8d0c8'];
    for (let row = 0; row < h / (size * 1.5) + 1; row++) {
      const offset = (row % 2) * (size * 0.866);
      for (let col = 0; col < w / (size * 1.732) + 1; col++) {
        const x = col * size * 1.732 + offset;
        const y = row * size * 1.5;
        ctx.fillStyle = colors[(row + col) % colors.length];
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = Math.PI / 3 * i + Math.PI / 6;
          const px = x + size * Math.cos(angle);
          const py = y + size * Math.sin(angle);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  }},
  { name: 'tile_subway', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#e8e0d8');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    const brickW = 24;
    const brickH = 12;
    for (let row = 0; row < h / brickH + 1; row++) {
      const offset = (row % 2) * (brickW / 2);
      for (let col = -1; col < w / brickW + 1; col++) {
        const x = col * brickW + offset;
        const y = row * brickH;
        ctx.strokeStyle = 'rgba(160,150,140,0.5)';
        ctx.strokeRect(x + 1, y + 1, brickW - 2, brickH - 2);
      }
    }
  }},
];

// ============================================================
// FENCE TEXTURES (5)
// ============================================================

const FENCE_TEXTURES = [
  { name: 'fence_picket', fn: (ctx, w, h) => {
    ctx.fillStyle = '#e8e0d8';
    ctx.fillRect(0, 0, w, h);
    for (let col = 0; col < w; col += 6) {
      ctx.fillStyle = '#d8d0c8';
      ctx.fillRect(col, 0, 4, h);
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      ctx.fillRect(col + 4, 0, 1, h);
    }
    ctx.fillStyle = '#c8c0b8';
    ctx.fillRect(0, 0, w, 4);
    ctx.fillRect(0, h - 4, w, 4);
  }},
  { name: 'fence_board', fn: (ctx, w, h) => {
    ctx.fillStyle = '#786858';
    ctx.fillRect(0, 0, w, h);
    for (let col = 0; col < w; col += 10) {
      const shade = rand(-15, 15);
      ctx.fillStyle = `rgb(${120 + shade},${105 + shade},${88 + shade})`;
      ctx.fillRect(col, 0, 9, h);
    }
  }},
  { name: 'fence_chain_link', fn: (ctx, w, h) => {
    ctx.fillStyle = '#707070';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#888888';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < w; x += 4) {
      for (let y = 0; y < h; y += 4) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 4, y + 4);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 4, y);
        ctx.lineTo(x, y + 4);
        ctx.stroke();
      }
    }
  }},
  { name: 'fence_privacy', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#a89080');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let col = 0; col < w; col += 12) {
      const boardColor = addNoise(baseColor, 15);
      ctx.fillStyle = `rgb(${boardColor.r},${boardColor.g},${boardColor.b})`;
      ctx.fillRect(col, 0, 11, h);
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      ctx.fillRect(col + 11, 0, 1, h);
    }
  }},
  { name: 'fence_rail', fn: (ctx, w, h) => {
    ctx.fillStyle = '#88a070';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#685848';
    ctx.fillRect(0, h * 0.2, w, 4);
    ctx.fillRect(0, h * 0.7, w, 4);
    for (let col = 0; col < w; col += 24) {
      ctx.fillStyle = '#584838';
      ctx.fillRect(col + 2, 0, 4, h);
    }
  }},
];

// ============================================================
// SPECIAL TEXTURES (5)
// ============================================================

const SPECIAL_TEXTURES = [
  { name: 'trim_white', fn: (ctx, w, h) => {
    ctx.fillStyle = '#f8f4f0';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = `rgba(200,195,190,${Math.random() * 0.3})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, rand(1,3), rand(1,3));
    }
  }},
  { name: 'trim_wood', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#a08060');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 100; i++) {
      ctx.fillStyle = `rgba(80,60,40,${Math.random() * 0.15})`;
      ctx.fillRect(0, Math.random() * h, w, rand(1,3));
    }
  }},
  { name: 'door_wood', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#684830');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(w * 0.3, 0, 2, h);
    ctx.fillRect(w * 0.65, 0, 2, h);
    for (let i = 0; i < 100; i++) {
      ctx.fillStyle = `rgba(60,40,20,${Math.random() * 0.2})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, rand(5,20), 1);
    }
  }},
  { name: 'garage_door', fn: (ctx, w, h) => {
    const baseColor = hexToRgb('#c8c0b8');
    ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
    ctx.fillRect(0, 0, w, h);
    const panelH = h / 4;
    for (let row = 0; row < 4; row++) {
      const y = row * panelH;
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(0, y + panelH - 2, w, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(4, y + 4, w - 8, panelH - 10);
    }
  }},
  { name: 'vent_metal', fn: (ctx, w, h) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < h; row += 4) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, row, w, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(0, row + 1, w, 2);
    }
  }},
];

// ============================================================
// GENERATE ALL TEXTURES
// ============================================================

const ALL_TEXTURES = [
  ...BRICK_TEXTURES,
  ...SIDING_TEXTURES,
  ...STUCCO_TEXTURES,
  ...WOOD_TEXTURES,
  ...CONCRETE_TEXTURES,
  ...METAL_TEXTURES,
  ...STONE_TEXTURES,
  ...ROOF_TEXTURES,
  ...GLASS_TEXTURES,
  ...GROUND_TEXTURES,
  ...STOREFRONT_TEXTURES,
  ...TILE_TEXTURES,
  ...FENCE_TEXTURES,
  ...SPECIAL_TEXTURES,
];

async function main() {
  const size = 128;
  
  // Ensure directory exists
  if (!fs.existsSync(TEXTURES_DIR)) {
    fs.mkdirSync(TEXTURES_DIR, { recursive: true });
  }
  
  for (const { name, fn } of ALL_TEXTURES) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    fn(ctx, size, size);
    
    const buffer = canvas.toBuffer('image/png');
    const outPath = path.join(TEXTURES_DIR, `${name}.png`);
    fs.writeFileSync(outPath, buffer);
    console.log(`Generated: ${name}.png`);
  }
  
  console.log(`\nGenerated ${ALL_TEXTURES.length} textures in ${TEXTURES_DIR}`);
}

main().catch(console.error);
