import fs from 'fs';
import path from 'path';

const CATALOGS_DIR = path.join(process.cwd(), 'src/game/bloomville/catalogs');

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function getBrightness(color) {
  return (color.r + color.g + color.b) / 3;
}

function getWarmth(color) {
  return color.r - color.b;
}

function getSaturation(color) {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  return max === 0 ? 0 : (max - min) / max;
}

function isReddish(color) {
  return color.r > color.g && color.r > color.b * 1.2;
}

function isGreenish(color) {
  return color.g > color.r * 0.9 && color.g > color.b * 1.1;
}

function isBluish(color) {
  return color.b > color.r * 0.9 && color.b > color.g * 0.9;
}

function isBrownish(color) {
  return color.r > color.g && color.g > color.b && (color.r - color.b) > 30;
}

function isGrayish(color) {
  const sat = getSaturation(color);
  return sat < 0.15;
}

function isWarm(color) {
  return getWarmth(color) > 15;
}

function pickTexture(materialName, color, rng) {
  const rgb = hexToRgb(color.toLowerCase());
  if (!rgb) return 'concrete_gray';
  
  const brightness = getBrightness(rgb);
  const warmth = getWarmth(rgb);
  
  const rand = rng();
  
  if (materialName === 'body') {
    if (brightness > 200) {
      const options = ['stucco_white', 'stucco_cream', 'siding_white', 'siding_cream', 'brick_white'];
      return options[Math.floor(rand * options.length)];
    }
    if (isReddish(rgb) || isBrownish(rgb)) {
      if (brightness < 140) {
        const options = ['brick_brown', 'brick_aged', 'wood_cedar', 'wood_redwood', 'siding_brown'];
        return options[Math.floor(rand * options.length)];
      }
      const options = ['brick_red', 'brick_orange', 'brick_tan', 'siding_tan', 'stucco_peach'];
      return options[Math.floor(rand * options.length)];
    }
    if (isGrayish(rgb)) {
      if (brightness < 120) {
        const options = ['concrete_dark', 'metal_panel', 'metal_aluminum', 'concrete_block'];
        return options[Math.floor(rand * options.length)];
      }
      const options = ['concrete_gray', 'siding_gray', 'metal_panel', 'stucco_gray'];
      return options[Math.floor(rand * options.length)];
    }
    if (isBluish(rgb)) {
      const options = ['siding_blue', 'metal_panel_blue', 'stone_bluestone'];
      return options[Math.floor(rand * options.length)];
    }
    if (isGreenish(rgb)) {
      const options = ['siding_green', 'metal_panel_green'];
      return options[Math.floor(rand * options.length)];
    }
    if (warmth > 20 && brightness > 160) {
      const options = ['stucco_sand', 'stucco_tan', 'siding_beige', 'stone_sandstone', 'brick_sandstone'];
      return options[Math.floor(rand * options.length)];
    }
    const options = ['siding_beige', 'siding_tan', 'stucco_tan', 'wood_pine', 'brick_tan'];
    return options[Math.floor(rand * options.length)];
  }
  
  if (materialName === 'accent') {
    if (brightness < 100) {
      const options = ['metal_panel', 'concrete_dark', 'metal_corrugated', 'trim_wood'];
      return options[Math.floor(rand * options.length)];
    }
    if (isReddish(rgb) || isBrownish(rgb)) {
      const options = ['brick_red', 'brick_brown', 'wood_oak', 'stone_fieldstone', 'awning_solid'];
      return options[Math.floor(rand * options.length)];
    }
    if (isGrayish(rgb)) {
      const options = ['concrete_gray', 'metal_panel', 'metal_aluminum', 'concrete_block'];
      return options[Math.floor(rand * options.length)];
    }
    if (isBluish(rgb)) {
      const options = ['glass_blue', 'metal_panel_blue', 'storefront_aluminum'];
      return options[Math.floor(rand * options.length)];
    }
    if (brightness > 180 && warmth < 10) {
      const options = ['concrete_light', 'trim_white', 'concrete_precast'];
      return options[Math.floor(rand * options.length)];
    }
    const options = ['concrete_gray', 'brick_weathered', 'wood_weathered', 'stone_limestone'];
    return options[Math.floor(rand * options.length)];
  }
  
  if (materialName === 'roof') {
    if (warmth > 15 || isBrownish(rgb)) {
      const options = ['roof_shingles_brown', 'roof_shingles_red', 'roof_tile_clay', 'wood_cedar'];
      return options[Math.floor(rand * options.length)];
    }
    if (isGrayish(rgb)) {
      const options = ['roof_shingles_gray', 'roof_shingles_black', 'roof_metal', 'roof_tile_slate'];
      return options[Math.floor(rand * options.length)];
    }
    if (isBluish(rgb)) {
      const options = ['roof_shingles_blue', 'metal_panel_blue', 'metal_corrugated'];
      return options[Math.floor(rand * options.length)];
    }
    if (isGreenish(rgb)) {
      return 'roof_shingles_green';
    }
    const options = ['roof_shingles_gray', 'roof_flat', 'roof_metal'];
    return options[Math.floor(rand * options.length)];
  }
  
  if (materialName === 'glass') {
    if (brightness < 130) {
      const options = ['glass_gray', 'glass_bronze', 'glass_mirrored'];
      return options[Math.floor(rand * options.length)];
    }
    if (isBluish(rgb)) {
      const options = ['glass_blue', 'glass_green', 'glass_clear'];
      return options[Math.floor(rand * options.length)];
    }
    if (getWarmth(rgb) > 10) {
      return 'glass_bronze';
    }
    const options = ['glass_blue', 'glass_gray', 'glass_clear'];
    return options[Math.floor(rand * options.length)];
  }
  
  return 'concrete_gray';
}

function createSeededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0xffffffff;
  };
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function updateCatalog(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const catalog = JSON.parse(content);
  
  for (const entry of catalog.entries) {
    if (entry.palette) {
      const rng = createSeededRandom(hashString(entry.id));
      const textures = {};
      for (const [matName, color] of Object.entries(entry.palette)) {
        textures[matName] = pickTexture(matName, color, rng);
      }
      entry.textures = textures;
    }
    
    if (entry.roof && entry.roof.material && entry.palette) {
      const roofMat = entry.roof.material;
      if (entry.palette[roofMat]) {
        const rng = createSeededRandom(hashString(entry.id + '_roof'));
        entry.roof.texture = pickTexture(roofMat, entry.palette[roofMat], rng);
      }
    }
    
    if (entry.features) {
      for (const [featName, feat] of Object.entries(entry.features)) {
        if (feat.material && entry.palette && entry.palette[feat.material]) {
          const rng = createSeededRandom(hashString(entry.id + '_' + featName));
          feat.texture = pickTexture(feat.material, entry.palette[feat.material], rng);
        }
      }
    }
  }
  
  fs.writeFileSync(filePath, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`Updated: ${path.basename(filePath)}`);
}

function main() {
  const files = fs.readdirSync(CATALOGS_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    updateCatalog(path.join(CATALOGS_DIR, file));
  }
  console.log(`\nUpdated ${files.length} catalog files`);
}

main();
