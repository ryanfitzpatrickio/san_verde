import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, simplify, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BUILDINGS_DIR = path.join(ROOT, 'public', 'models', 'buildings');
const LOD_SUFFIX_RE = /\.(high|medium|low)\.glb$/i;
const GLB_RE = /\.glb$/i;

const LOD_CONFIG = Object.freeze({
  high: Object.freeze({
    textures: {
      color: { resize: [2048, 2048], format: 'webp', quality: 88, effort: 6 },
      normal: { resize: [2048, 2048], format: 'webp', quality: 82, effort: 6, lossless: false },
      data: { resize: [2048, 2048], format: 'webp', quality: 84, effort: 6 }
    }
  }),
  medium: Object.freeze({
    ratio: 0.12,
    error: 0.01,
    textures: {
      color: { resize: [1024, 1024], format: 'webp', quality: 78, effort: 6 },
      normal: { resize: [1024, 1024], format: 'webp', quality: 70, effort: 6, lossless: false },
      data: { resize: [1024, 1024], format: 'webp', quality: 72, effort: 6 }
    }
  }),
  low: Object.freeze({
    ratio: 0.04,
    error: 0.03,
    textures: {
      color: { resize: [512, 512], format: 'webp', quality: 60, effort: 6 },
      normal: { resize: [512, 512], format: 'webp', quality: 55, effort: 6, lossless: false },
      data: { resize: [512, 512], format: 'webp', quality: 58, effort: 6 }
    }
  })
});

function getOutputPath(basePath, tier) {
  return basePath.replace(GLB_RE, `.${tier}.glb`);
}

function createIo() {
  return new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
}

async function bakeTier(io, inputPath, outputPath, { ratio, error }) {
  const document = await io.read(inputPath);
  await document.transform(
    dedup(),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio,
      error
    }),
    prune()
  );
  await io.write(outputPath, document);
}

async function bakeHighTier(io, inputPath, outputPath, config) {
  const document = await io.read(inputPath);
  await document.transform(
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
    prune()
  );
  await io.write(outputPath, document);
}

async function bakeTierWithTextures(io, inputPath, outputPath, config) {
  const document = await io.read(inputPath);
  await document.transform(
    dedup(),
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
    prune()
  );
  await io.write(outputPath, document);
}

async function listSourceBuildings() {
  const entries = await fs.readdir(BUILDINGS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && GLB_RE.test(entry.name) && !LOD_SUFFIX_RE.test(entry.name))
    .map((entry) => path.join(BUILDINGS_DIR, entry.name))
    .sort();
}

async function main() {
  await MeshoptSimplifier.ready;
  const io = createIo();
  const sourcePaths = await listSourceBuildings();
  if (!sourcePaths.length) {
    console.log('No base building GLBs found.');
    return;
  }

  for (const sourcePath of sourcePaths) {
    const name = path.basename(sourcePath);
    const highPath = getOutputPath(sourcePath, 'high');
    const mediumPath = getOutputPath(sourcePath, 'medium');
    const lowPath = getOutputPath(sourcePath, 'low');

    await bakeHighTier(io, sourcePath, highPath, LOD_CONFIG.high);
    await bakeTierWithTextures(io, sourcePath, mediumPath, LOD_CONFIG.medium);
    await bakeTierWithTextures(io, sourcePath, lowPath, LOD_CONFIG.low);

    console.log(`Baked ${name}`);
    console.log(`  high   -> ${path.basename(highPath)}`);
    console.log(`  medium -> ${path.basename(mediumPath)}`);
    console.log(`  low    -> ${path.basename(lowPath)}`);
  }
}

await main();
