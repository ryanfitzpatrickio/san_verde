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
 *
 * Output folder: web-assets/
 * Upload web-assets/ to your storage bucket as a drop-in replacement.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { draco, dedup, prune, resample } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'web-assets');
const MODELS_ONLY = process.argv.includes('--models-only');

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
    prune(),
    resample(),
    draco({ quantizationVolume: 'scene' })
  );
  await io.write(outputPath, doc);
}

// ─── texture optimization ─────────────────────────────────────────────────────

async function optimizePng(inputPath, outputPath) {
  // Convert to WebP — same visual quality, ~40% smaller
  const webpPath = outputPath.replace(/\.png$/i, '.webp');
  await sharp(inputPath)
    .webp({ quality: 85, effort: 6 })
    .toFile(webpPath);
  return webpPath;
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

    if (ext === '.glb') {
      process.stdout.write(`  Compressing ${entry.name}...`);
      try {
        await optimizeGlb(inPath, outPath);
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
        await report(entry.name + ' → .webp', inPath, actualOut);
      } catch (err) {
        console.warn(`  ! Skipped ${entry.name}: ${err.message}`);
        await fs.copyFile(inPath, outPath);
      }
    } else {
      await fs.copyFile(inPath, outPath);
    }
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

console.log(`\nOptimizing assets → web-assets/\n`);

// Models
console.log('── Models ────────────────────────────────────────────────────────');
await processDir(path.join(PUBLIC, 'models'), path.join(OUT, 'models'));

// Textures (skip if --models-only)
if (!MODELS_ONLY) {
  console.log('\n── Textures ──────────────────────────────────────────────────────');
  await processDir(path.join(PUBLIC, 'textures'), path.join(OUT, 'textures'));

  console.log('\n── Full Textures ─────────────────────────────────────────────────');
  await processDir(path.join(PUBLIC, 'full textures'), path.join(OUT, 'full textures'));
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`  Total: ${fmtBytes(totalIn)} → ${fmtBytes(totalOut)}  (-${Math.round((1 - totalOut / totalIn) * 100)}%)`);
console.log(`\nDone. Upload web-assets/ to your storage bucket.\n`);
