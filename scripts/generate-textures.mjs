import fs from 'fs';
import path from 'path';
import { createCanvas } from 'canvas';

const TEXTURES_DIR = path.join(process.cwd(), 'src/game/bloomville/textures');

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

function createBrickWall(ctx, w, h) {
  const baseColor = hexToRgb('#a86048');
  const mortarColor = hexToRgb('#d8c8b8');
  
  ctx.fillStyle = `rgb(${mortarColor.r},${mortarColor.g},${mortarColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  const brickH = 12;
  const brickW = 24;
  const mortarSize = 2;
  
  for (let row = 0; row < h / brickH + 1; row++) {
    const offset = (row % 2) * (brickW / 2);
    for (let col = -1; col < w / brickW + 1; col++) {
      const x = col * brickW + offset;
      const y = row * brickH;
      
      const variation = Math.random();
      let brickColor;
      if (variation < 0.3) {
        brickColor = lerpColor(baseColor, hexToRgb('#8a4838'), Math.random() * 0.5);
      } else if (variation < 0.6) {
        brickColor = lerpColor(baseColor, hexToRgb('#b87058'), Math.random() * 0.5);
      } else {
        brickColor = addNoise(baseColor, 15);
      }
      
      ctx.fillStyle = `rgb(${brickColor.r},${brickColor.g},${brickColor.b})`;
      ctx.fillRect(x + mortarSize, y + mortarSize, brickW - mortarSize * 2, brickH - mortarSize * 2);
    }
  }
}

function createRoad(ctx, w, h) {
  const asphaltColor = hexToRgb('#3a3a3a');
  
  ctx.fillStyle = `rgb(${asphaltColor.r},${asphaltColor.g},${asphaltColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const shade = Math.random() * 30 - 15;
    const noise = addNoise(asphaltColor, 25);
    ctx.fillStyle = `rgba(${noise.r},${noise.g},${noise.b},0.3)`;
    ctx.fillRect(x, y, Math.random() * 4 + 1, Math.random() * 4 + 1);
  }
}

function createSiding(ctx, w, h) {
  const baseColor = hexToRgb('#d8c8b8');
  
  ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  const boardH = 10;
  for (let row = 0; row < h / boardH + 1; row++) {
    const y = row * boardH;
    const shade = (row % 2) * 8 - 4;
    const boardColor = addNoise(lerpColor(baseColor, hexToRgb('#c8b8a8'), shade / 20), 10);
    ctx.fillStyle = `rgb(${boardColor.r},${boardColor.g},${boardColor.b})`;
    ctx.fillRect(0, y, w, boardH - 1);
    
    ctx.fillStyle = `rgba(0,0,0,0.08)`;
    ctx.fillRect(0, y + boardH - 1, w, 1);
  }
}

function createWhiteStucco(ctx, w, h) {
  const baseColor = hexToRgb('#f0e8dc');
  
  ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const size = Math.random() * 3 + 1;
    const noise = addNoise(baseColor, 20);
    ctx.fillStyle = `rgb(${noise.r},${noise.g},${noise.b})`;
    ctx.fillRect(x, y, size, size);
  }
}

function createGrass(ctx, w, h) {
  const baseColor = hexToRgb('#4a8848');
  
  ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const variation = Math.random();
    let grassColor;
    if (variation < 0.3) {
      grassColor = addNoise(hexToRgb('#5a9858'), 15);
    } else if (variation < 0.5) {
      grassColor = addNoise(hexToRgb('#3a7838'), 15);
    } else {
      grassColor = addNoise(baseColor, 20);
    }
    ctx.fillStyle = `rgb(${grassColor.r},${grassColor.g},${grassColor.b})`;
    ctx.fillRect(x, y, Math.random() * 2 + 1, Math.random() * 2 + 1);
  }
}

function createStorefront(ctx, w, h) {
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
      
      ctx.fillStyle = `rgba(255,255,255,0.15)`;
      ctx.fillRect(x + 2, y + 2, (paneW - frameSize * 2) / 3, (paneH - frameSize * 2) / 3);
    }
  }
}

function createConcrete(ctx, w, h) {
  const baseColor = hexToRgb('#a0a0a0');
  
  ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  for (let i = 0; i < 1500; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const noise = addNoise(baseColor, 25);
    ctx.fillStyle = `rgb(${noise.r},${noise.g},${noise.b})`;
    ctx.fillRect(x, y, Math.random() * 4 + 1, Math.random() * 4 + 1);
  }
  
  ctx.strokeStyle = `rgba(80,80,80,0.2)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.3);
  ctx.lineTo(w, h * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, h * 0.7);
  ctx.lineTo(w, h * 0.7);
  ctx.stroke();
}

function createMetalPanel(ctx, w, h) {
  const baseColor = hexToRgb('#8a8a8a');
  
  ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  const panelW = 16;
  for (let col = 0; col < w / panelW + 1; col++) {
    const x = col * panelW;
    
    const gradient = ctx.createLinearGradient(x, 0, x + panelW, 0);
    const light = addNoise(hexToRgb('#9a9a9a'), 10);
    const dark = addNoise(hexToRgb('#7a7a7a'), 10);
    gradient.addColorStop(0, `rgb(${dark.r},${dark.g},${dark.b})`);
    gradient.addColorStop(0.5, `rgb(${light.r},${light.g},${light.b})`);
    gradient.addColorStop(1, `rgb(${dark.r},${dark.g},${dark.b})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, 0, panelW, h);
  }
}

function createRoofShingles(ctx, w, h) {
  const baseColor = hexToRgb('#4a4038');
  
  ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  const shingleH = 8;
  const shingleW = 12;
  
  for (let row = 0; row < h / shingleH + 1; row++) {
    const offset = (row % 2) * (shingleW / 2);
    for (let col = -1; col < w / shingleW + 1; col++) {
      const x = col * shingleW + offset;
      const y = row * shingleH;
      
      const variation = Math.random();
      let shingleColor;
      if (variation < 0.3) {
        shingleColor = addNoise(hexToRgb('#5a5048'), 15);
      } else if (variation < 0.5) {
        shingleColor = addNoise(hexToRgb('#3a3028'), 15);
      } else {
        shingleColor = addNoise(baseColor, 15);
      }
      
      ctx.fillStyle = `rgb(${shingleColor.r},${shingleColor.g},${shingleColor.b})`;
      ctx.fillRect(x, y, shingleW - 1, shingleH - 1);
    }
  }
}

function createCorrugatedMetal(ctx, w, h) {
  const baseColor = hexToRgb('#707070');
  
  ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
  ctx.fillRect(0, 0, w, h);
  
  const ridgeW = 6;
  for (let col = 0; col < w / ridgeW + 1; col++) {
    const x = col * ridgeW;
    
    const gradient = ctx.createLinearGradient(x, 0, x + ridgeW, 0);
    const light = addNoise(hexToRgb('#888888'), 10);
    const dark = addNoise(hexToRgb('#585858'), 10);
    gradient.addColorStop(0, `rgb(${dark.r},${dark.g},${dark.b})`);
    gradient.addColorStop(0.5, `rgb(${light.r},${light.g},${light.b})`);
    gradient.addColorStop(1, `rgb(${dark.r},${dark.g},${dark.b})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, 0, ridgeW, h);
  }
  
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    ctx.fillStyle = `rgba(100,100,100,0.3)`;
    ctx.fillRect(x, y, Math.random() * 3, Math.random() * 8);
  }
}

function createGlass(ctx, w, h) {
  const baseColor = hexToRgb('#7aa0c0');
  
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, `rgb(122,160,192)`);
  gradient.addColorStop(0.5, `rgb(142,180,212)`);
  gradient.addColorStop(1, `rgb(102,140,172)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  
  ctx.fillStyle = `rgba(255,255,255,0.2)`;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w * 0.4, 0);
  ctx.lineTo(0, h * 0.3);
  ctx.closePath();
  ctx.fill();
}

const TEXTURES = [
  { name: 'brick_wall', generator: createBrickWall },
  { name: 'road', generator: createRoad },
  { name: 'siding', generator: createSiding },
  { name: 'white_stucco', generator: createWhiteStucco },
  { name: 'grass', generator: createGrass },
  { name: 'storefront', generator: createStorefront },
  { name: 'concrete', generator: createConcrete },
  { name: 'metal_panel', generator: createMetalPanel },
  { name: 'roof_shingles', generator: createRoofShingles },
  { name: 'corrugated_metal', generator: createCorrugatedMetal },
  { name: 'glass', generator: createGlass },
];

async function main() {
  const size = 128;
  
  for (const { name, generator } of TEXTURES) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    generator(ctx, size, size);
    
    const buffer = canvas.toBuffer('image/png');
    const outPath = path.join(TEXTURES_DIR, `${name}.png`);
    fs.writeFileSync(outPath, buffer);
    console.log(`Generated: ${name}.png`);
  }
  
  console.log(`\nGenerated ${TEXTURES.length} textures in ${TEXTURES_DIR}`);
}

main().catch(console.error);
