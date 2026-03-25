/**
 * optimize-web-assets.mjs
 *
 * Produces a web-ready copy of public/ assets in web-assets/:
 *   - GLB models  → Draco-compressed (typically 5-15x smaller)
 *   - PNG textures → WebP (typically 30-50% smaller, same quality)
 *   - Audio/other  → copied as-is
 *
 * Usage:
 *   npm run assets:optimize              # models + textures
 *   npm run assets:optimize:models       # GLBs only (faster)
 *   npm run assets:optimize:buildings    # San Verde building GLBs only
 *   npm run assets:optimize:vehicles     # Built-in car/tire GLBs only
 *
 * Output folder: web-assets/
 * Upload web-assets/ to your storage bucket as a drop-in replacement.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { draco, dedup, prune, resample, simplify, textureCompress } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'web-assets');
const MODELS_ONLY = process.argv.includes('--models-only');
const BUILDINGS_ONLY = process.argv.includes('--buildings-only');
const VEHICLES_ONLY = process.argv.includes('--vehicles-only');
const SHOULD_PROCESS_TEXTURES = !MODELS_ONLY && !BUILDINGS_ONLY && !VEHICLES_ONLY;
const BUILT_IN_VEHICLES_DIR = path.join(ROOT, 'src', 'assets', 'built-in-vehicles');

const VEHICLE_BODY_OPTIMIZATION = Object.freeze({
  ratio: 0.82,
  error: 0.0008,
  textures: {
    color: { resize: [2048, 2048], format: 'webp', quality: 86, effort: 6 },
    normal: { resize: [2048, 2048], format: 'webp', quality: 82, effort: 6, lossless: false },
    data: { resize: [2048, 2048], format: 'webp', quality: 82, effort: 6 }
  }
});

const VEHICLE_TIRE_OPTIMIZATION = Object.freeze({
  ratio: 0.92,
  error: 0.0005,
  textures: {
    color: { resize: [1024, 1024], format: 'webp', quality: 82, effort: 6 },
    normal: { resize: [1024, 1024], format: 'webp', quality: 78, effort: 6, lossless: false },
    data: { resize: [1024, 1024], format: 'webp', quality: 78, effort: 6 }
  }
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} KB`;
  return `${n} B`;
}

async function fileSize(p) {
  try { return (await fs.stat(p)).size; } catch { return 0; }
}

let totalIn = 0;
let totalOut = 0;

async function report(label, inPath, outPath) {
  const before = await fileSize(inPath);
  const after = await fileSize(outPath);
  totalIn += before;
  totalOut += after;
  const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0;
  console.log(`  ${label.padEnd(52)} ${fmtBytes(before).padStart(8)} → ${fmtBytes(after).padStart(8)}  (-${pct}%)`);
}

// ─── GLB optimization ─────────────────────────────────────────────────────────

let _io = null;
async function getIO() {
  if (_io) return _io;
  const [encoder, decoder] = await Promise.all([
    draco3d.createEncoderModule(),
    draco3d.createDecoderModule()
  ]);
  _io = new NodeIO()
    .registerExtensions(KHRONOS_EXTENSIONS)
    .registerDependencies({
      'draco3d.encoder': encoder,
      'draco3d.decoder': decoder
    });
  return _io;
}

async function optimizeGlb(inputPath, outputPath) {
  const io = await getIO();
  const doc = await io.read(inputPath);
  await doc.transform(
    dedup(),
    resample(),
    draco({ quantizationVolume: 'scene' })
  );
  await io.write(outputPath, doc);
}

async function optimizeVehicleGlb(inputPath, outputPath, config) {
  await MeshoptSimplifier.ready;
  const io = await getIO();
  const doc = await io.read(inputPath);
  await doc.transform(
    dedup(),
    resample(),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: config.ratio,
      error: config.error
    }),
    textureCompress({
      encoder: sharp,
      targetFormat: config.textures.color.format,
      resize: config.textures.color.resize,
      quality: config.textures.color.quality,
      effort: config.textures.color.effort,
      slots: /(baseColorTexture|emissiveTexture)$/i
    }),
    textureCompress({
      encoder: sharp,
      targetFormat: config.textures.normal.format,
      resize: config.textures.normal.resize,
      quality: config.textures.normal.quality,
      effort: config.textures.normal.effort,
      lossless: config.textures.normal.lossless,
      slots: /normalTexture/i
    }),
    textureCompress({
      encoder: sharp,
      targetFormat: config.textures.data.format,
      resize: config.textures.data.resize,
      quality: config.textures.data.quality,
      effort: config.textures.data.effort,
      slots: /(metallicRoughnessTexture|occlusionTexture)$/i
    }),
    // Vehicle runtime depends on authored empty locator nodes for wheel anchors,
    // steering, seat, and door interaction points. Preserve leaf transforms so
    // production-optimized GLBs still support entering cars and door rigs.
    prune({ keepLeaves: true }),
    draco({ quantizationVolume: 'scene' })
  );
  await io.write(outputPath, doc);
}

// ─── texture optimization ─────────────────────────────────────────────────────

async function optimizePng(inputPath, outputPath) {
  // Compress PNG in-place — keeps filenames identical, no code changes needed
  await sharp(inputPath)
    .png({ quality: 85, compressionLevel: 9, effort: 10 })
    .toFile(outputPath);
  return outputPath;
}

// ─── directory walker ─────────────────────────────────────────────────────────

async function processDir(inputDir, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });

  let entries;
  try {
    entries = await fs.readdir(inputDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const inPath = path.join(inputDir, entry.name);
    const outPath = path.join(outputDir, entry.name);

    if (entry.isDirectory()) {
      await processDir(inPath, outPath);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    const relPath = path.relative(PUBLIC, inPath).split(path.sep).join('/');

    if (ext === '.glb') {
      if (VEHICLES_ONLY && !VEHICLE_GLB_PATHS.has(relPath)) {
        continue;
      }
      process.stdout.write(`  Compressing ${entry.name}...`);
      try {
        if (VEHICLE_GLB_PATHS.has(relPath)) {
          const config = relPath.includes('tire') ? VEHICLE_TIRE_OPTIMIZATION : VEHICLE_BODY_OPTIMIZATION;
          await optimizeVehicleGlb(inPath, outPath, config);
        } else {
          await optimizeGlb(inPath, outPath);
        }
        process.stdout.write('\r');
        await report(entry.name, inPath, outPath);
      } catch (err) {
        process.stdout.write('\r');
        console.warn(`  ! Skipped ${entry.name}: ${err.message}`);
        await fs.copyFile(inPath, outPath);
      }
    } else if (!MODELS_ONLY && ext === '.png') {
      try {
        const actualOut = await optimizePng(inPath, outPath);
        await report(entry.name, inPath, actualOut);
      } catch (err) {
        console.warn(`  ! Skipped ${entry.name}: ${err.message}`);
        await fs.copyFile(inPath, outPath);
      }
    } else {
      await fs.copyFile(inPath, outPath);
    }
  }
}

async function loadBuiltInVehicleGlbPaths() {
  let entries = [];
  try {
    entries = await fs.readdir(BUILT_IN_VEHICLES_DIR, { withFileTypes: true });
  } catch {
    return new Set();
  }

  const paths = new Set();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    const manifestPath = path.join(BUILT_IN_VEHICLES_DIR, entry.name);
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    addVehicleModelPath(paths, manifest?.body?.url);
    addVehicleModelPath(paths, manifest?.tires?.front?.url);
    addVehicleModelPath(paths, manifest?.tires?.rear?.url);
  }

  return paths;
}

function addVehicleModelPath(paths, assetUrl) {
  if (typeof assetUrl !== 'string' || !assetUrl.startsWith('/models/') || !assetUrl.endsWith('.glb')) {
    return;
  }
  paths.add(assetUrl.slice(1));
}

// ─── main ─────────────────────────────────────────────────────────────────────

console.log(`\nOptimizing assets → web-assets/\n`);
const VEHICLE_GLB_PATHS = await loadBuiltInVehicleGlbPaths();

// Models
console.log('── Models ────────────────────────────────────────────────────────');
if (BUILDINGS_ONLY) {
  await processDir(path.join(PUBLIC, 'models', 'buildings'), path.join(OUT, 'models', 'buildings'));
} else {
  await processDir(path.join(PUBLIC, 'models'), path.join(OUT, 'models'));
}

// Textures (skip if --models-only)
if (SHOULD_PROCESS_TEXTURES) {
  console.log('\n── Textures ──────────────────────────────────────────────────────');
  await processDir(path.join(PUBLIC, 'textures'), path.join(OUT, 'textures'));

  console.log('\n── Full Textures ─────────────────────────────────────────────────');
  await processDir(path.join(PUBLIC, 'full textures'), path.join(OUT, 'full textures'));
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`  Total: ${fmtBytes(totalIn)} → ${fmtBytes(totalOut)}  (-${Math.round((1 - totalOut / totalIn) * 100)}%)`);
console.log(`\nDone. Upload web-assets/ to your storage bucket.\n`);
